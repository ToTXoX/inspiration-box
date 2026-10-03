import AppKit
import CryptoKit
import Foundation

public struct LinkPreview {
    public let title: String
    public let finalURL: String
    public let description: String
    public let image: String?
    public let images: [String]
    public let warning: String?
    public var dictionary: [String: Any] {
        ["title": title, "finalUrl": finalURL, "image": image as Any? ?? NSNull(),
         "images": images, "description": description, "warning": warning as Any? ?? NSNull()]
    }
}

@MainActor public final class LinkPreviewService {
    @MainActor private final class Request {
        let web = WebMetadataExtractor()
        let session: URLSession
        let completion: (Result<LinkPreview, Error>) -> Void
        var task: Task<Void, Never>?
        init(completion: @escaping (Result<LinkPreview, Error>) -> Void) {
            self.completion = completion
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 8
            configuration.timeoutIntervalForResource = 10
            session = URLSession(configuration: configuration)
        }
        func stop() {
            task?.cancel(); task = nil
            web.cancel(); session.invalidateAndCancel()
        }
    }
    private let storage: AppStorage
    private var requests: [String: Request] = [:]
    private var cache: [String: (Date, LinkPreview)] = [:]

    public init(storage: AppStorage) { self.storage = storage }

    nonisolated public static func validatedURL(_ value: String) throws -> URL {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else {
            throw AppFailure.message("请粘贴有效的网页链接。")
        }
        return url
    }

    public func fetch(_ url: URL, requestID: String,
                      completion: @escaping (Result<LinkPreview, Error>) -> Void) {
        cancel(requestID)
        if let (date, result) = cache[url.absoluteString], Date().timeIntervalSince(date) < 600 {
            completion(.success(result)); return
        }
        let request = Request(completion: completion)
        requests[requestID] = request
        request.task = Task { [weak self] in
            guard !Task.isCancelled else { return }
            do {
                // The remote page is loaded once, in a web view without the app bridge.
                let page = try await request.web.fetch(url)
                guard let self, !Task.isCancelled else { return }
                let preview = try await self.makePreview(page: page, request: request)
                try Task.checkCancellation()
                if self.cache.count > 100 { self.cache.removeAll() }
                // Partial results should remain retryable instead of caching a temporary failure.
                if preview.warning == nil { self.cache[url.absoluteString] = (Date(), preview) }
                self.finish(requestID, request: request, .success(preview))
            } catch {
                let failure = error is AppFailure ? error
                    : AppFailure.message("未能获取链接预览，请重试或手动填写。")
                self?.finish(requestID, request: request, .failure(failure))
            }
        }
    }

    public func cancel(_ requestID: String) {
        guard let request = requests.removeValue(forKey: requestID) else { return }
        request.stop()
        request.completion(.failure(AppFailure.message("已取消链接解析。")))
    }

    private static func isBlocked(title: String, url: URL) -> Bool {
        url.path.range(of: "/(login|signin|passport|captcha)(/|$)",
                       options: [.regularExpression, .caseInsensitive]) != nil ||
        (url.host?.hasSuffix("xiaohongshu.com") == true && title == "小红书 - 你的生活兴趣社区")
    }

    private func makePreview(page: WebPageMetadata, request: Request) async throws -> LinkPreview {
        guard !Self.isBlocked(title: page.title, url: page.url) else {
            throw AppFailure.message("网站返回了登录或验证页，未获取到笔记内容。")
        }
        let title = page.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalURL = page.url
        let candidates = page.images
        // Collect concurrently, then restore declaration order. No expired remote URL is persisted.
        let downloads = await withTaskGroup(of: (Int, Data?).self) { group in
            for (index, candidate) in candidates.enumerated() {
                group.addTask {
                    (index, try? await Self.download(candidate.url, referer: finalURL, session: request.session))
                }
            }
            var result: [Int: Data] = [:]
            for await (index, data) in group { if let data { result[index] = data } }
            return result
        }
        try Task.checkCancellation()
        var seen = Set<String>()
        var decoded: [(data: Data, priority: Int, index: Int)] = []
        var failed = 0
        for (index, candidate) in candidates.enumerated() {
            guard let data = downloads[index], let normalized = Self.normalized(data) else { failed += 1; continue }
            let digest = SHA256.hash(data: normalized).description
            guard seen.insert(digest).inserted else { continue }
            let logo = candidate.url.path.range(of: "(^|[/_-])(logo|icon|favicon|avatar|brand)([./_-]|$)",
                options: [.regularExpression, .caseInsensitive]) != nil
            decoded.append((normalized, (candidate.inPage ? 2 : 0) - (logo ? 4 : 0), index))
        }
        decoded.sort { $0.priority == $1.priority ? $0.index < $1.index : $0.priority > $1.priority }
        guard !title.isEmpty || !decoded.isEmpty else {
            throw AppFailure.message("该链接没有提供可用的预览信息。")
        }
        var paths: [String] = []
        do {
            for item in decoded { paths.append(try storage.saveImage(item.data)) }
        } catch {
            for path in paths {
                if let file = storage.uploadURL(for: String(path.dropFirst("/uploads/".count))) {
                    try? FileManager.default.removeItem(at: file)
                }
            }
            throw error
        }
        let warning: String? = failed > 0 ? "部分候选图片未能保存，可重试或上传封面。" : nil
        return LinkPreview(title: title, finalURL: finalURL.absoluteString,
                           description: page.description, image: paths.first, images: paths, warning: warning)
    }

    private static func normalized(_ data: Data) -> Data? {
        guard data.count <= 12 * 1024 * 1024, let image = NSBitmapImageRep(data: data),
              image.pixelsWide > 0, image.pixelsHigh > 0,
              image.pixelsWide <= 16_384, image.pixelsHigh <= 16_384,
              image.pixelsWide * image.pixelsHigh <= 80_000_000 else { return nil }
        return image.representation(using: .png, properties: [:])
    }

    nonisolated private static func download(_ url: URL, referer: URL, session: URLSession) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue(referer.absoluteString, forHTTPHeaderField: "Referer")
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              response.expectedContentLength <= 12 * 1024 * 1024 else {
            throw AppFailure.message("图片下载失败。")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 12 * 1024 * 1024 else { throw AppFailure.message("图片超过 12 MB。") }
            data.append(byte)
        }
        return data
    }

    private func finish(_ id: String, request: Request, _ result: Result<LinkPreview, Error>) {
        guard requests[id] === request else { return }
        requests.removeValue(forKey: id)
        request.stop()
        request.completion(result)
    }
}
