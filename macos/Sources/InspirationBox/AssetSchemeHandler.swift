import Foundation
import InspirationCore
import UniformTypeIdentifiers
import WebKit

final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let resources: URL
    private let storage: AppStorage
    private var downloads: [ObjectIdentifier: URLSessionDataTask] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        return URLSession(configuration: config)
    }()

    init(resources: URL, storage: AppStorage) { self.resources = resources; self.storage = storage }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else {
            task.didFailWithError(URLError(.badURL)); return
        }
        if url.path == "/api/img" { loadRemote(url, task: task); return }
        let file: URL?
        if url.path.hasPrefix("/uploads/") {
            let name = String(url.path.dropFirst("/uploads/".count))
            guard let saved = storage.uploadURL(for: name) else {
                task.didFailWithError(URLError(.noPermissionsToReadFile)); return
            }
            file = FileManager.default.fileExists(atPath: saved.path) ? saved
                : resources.appendingPathComponent("uploads").appendingPathComponent(name)
        } else {
            let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
            let base = resources.appendingPathComponent("web", isDirectory: true).resolvingSymlinksInPath()
            let candidate = base.appendingPathComponent(path).resolvingSymlinksInPath().standardizedFileURL
            file = candidate.path.hasPrefix(base.path + "/") ? candidate : nil
        }
        do {
            guard let file else { throw URLError(.noPermissionsToReadFile) }
            let data = try Data(contentsOf: file)
            let mime: String
            switch file.pathExtension.lowercased() {
            case "js": mime = "text/javascript"
            case "css": mime = "text/css"
            case "html": mime = "text/html"
            default: mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            }
            respond(task, url: url, data: data, mime: mime)
        } catch { task.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        downloads.removeValue(forKey: ObjectIdentifier(task as AnyObject))?.cancel()
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, data: Data, mime: String) {
        task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
        task.didReceive(data)
        task.didFinish()
    }

    private func loadRemote(_ url: URL, task: WKURLSchemeTask) {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let value = parts.first(where: { $0.name == "url" })?.value,
              let target = try? LinkPreviewService.validatedURL(value) else {
            task.didFailWithError(URLError(.badURL)); return
        }
        var request = URLRequest(url: target)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        if let ref = parts.first(where: { $0.name == "ref" })?.value,
           let reference = URL(string: ref), let host = reference.host,
           let scheme = reference.scheme, ["http", "https"].contains(scheme) {
            request.setValue("\(scheme)://\(host)/", forHTTPHeaderField: "Referer")
        }
        let key = ObjectIdentifier(task as AnyObject)
        let download = session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self, self.downloads.removeValue(forKey: key) != nil else { return }
                guard error == nil, let data, data.count <= 12 * 1024 * 1024,
                      let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                      let mime = response.mimeType, mime.hasPrefix("image/") else {
                    task.didFailWithError(error ?? URLError(.badServerResponse)); return
                }
                self.respond(task, url: url, data: data, mime: mime)
            }
        }
        downloads[key] = download
        download.resume()
    }
}
