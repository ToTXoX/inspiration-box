import AppKit
import Foundation
import LinkPresentation

public struct LinkPreview {
    public let title: String
    public let finalURL: String
    public let image: String?
    public var dictionary: [String: Any] {
        ["title": title, "finalUrl": finalURL, "image": image as Any? ?? NSNull()]
    }
}

@MainActor public final class LinkPreviewService {
    private struct Request {
        let provider: LPMetadataProvider
        let completion: (Result<LinkPreview, Error>) -> Void
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
        if let (date, result) = cache[url.absoluteString], Date().timeIntervalSince(date) < 600 {
            completion(.success(result)); return
        }
        cancel(requestID)
        let provider = LPMetadataProvider()
        provider.timeout = 30
        provider.shouldFetchSubresources = true
        requests[requestID] = Request(provider: provider, completion: completion)
        provider.startFetchingMetadata(for: url) { [weak self] metadata, error in
            DispatchQueue.main.async {
                self?.received(metadata, error: error, original: url, requestID: requestID)
            }
        }
    }

    public func cancel(_ requestID: String) {
        guard let request = requests.removeValue(forKey: requestID) else { return }
        request.provider.cancel()
        request.completion(.failure(AppFailure.message("已取消链接解析。")))
    }

    private func received(_ metadata: LPLinkMetadata?, error: Error?, original: URL, requestID: String) {
        guard requests[requestID] != nil else { return }
        if let error {
            let message = (error as NSError).code == LPError.Code.metadataFetchTimedOut.rawValue
                ? "链接解析超时，请重试。" : "未能获取笔记预览，请重试或手动填写。"
            finish(requestID, .failure(AppFailure.message(message))); return
        }
        guard let metadata else {
            finish(requestID, .failure(AppFailure.message("该链接没有提供可用的预览信息。"))); return
        }
        let finalURL = metadata.url ?? original
        let title = metadata.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if finalURL.path.range(of: "/(login|signin|passport|captcha)(/|$)",
                              options: [.regularExpression, .caseInsensitive]) != nil ||
            (finalURL.host?.hasSuffix("xiaohongshu.com") == true && title == "小红书 - 你的生活兴趣社区") {
            finish(requestID, .failure(AppFailure.message("网站返回了登录或验证页，未获取到笔记内容。"))); return
        }
        guard !title.isEmpty || metadata.imageProvider != nil else {
            finish(requestID, .failure(AppFailure.message("该链接没有提供可用的预览信息。"))); return
        }
        guard let imageProvider = metadata.imageProvider else {
            succeeded(requestID, original: original, title: title, finalURL: finalURL, image: nil); return
        }
        // Read the provider inside the metadata callback lifecycle; persist its image immediately.
        imageProvider.loadObject(ofClass: NSImage.self) { [weak self] object, error in
            DispatchQueue.main.async {
                guard let self, self.requests[requestID] != nil else { return }
                guard let image = object as? NSImage, let data = image.tiffRepresentation else {
                    self.finish(requestID, .failure(AppFailure.message("封面读取失败，请重试或上传自己的图片。"))); return
                }
                do {
                    let imagePath = try self.storage.saveImage(data)
                    self.succeeded(requestID, original: original, title: title,
                                   finalURL: finalURL, image: imagePath)
                } catch { self.finish(requestID, .failure(error)) }
            }
        }
    }

    private func succeeded(_ requestID: String, original: URL, title: String, finalURL: URL, image: String?) {
        let result = LinkPreview(title: title, finalURL: finalURL.absoluteString, image: image)
        if cache.count > 100 { cache.removeAll() }
        cache[original.absoluteString] = (Date(), result)
        finish(requestID, .success(result))
    }

    private func finish(_ requestID: String, _ result: Result<LinkPreview, Error>) {
        guard let request = requests.removeValue(forKey: requestID) else { return }
        request.completion(result)
    }
}
