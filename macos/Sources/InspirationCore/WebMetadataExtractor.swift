import Foundation
import WebKit

struct WebImageCandidate {
    let url: URL
    let inPage: Bool
}

struct WebPageMetadata {
    let title: String
    let description: String
    let url: URL
    let images: [WebImageCandidate]
}

/// A separate web view with no app bridge, local file access or persistent cookies.
@MainActor final class WebMetadataExtractor: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private var continuation: CheckedContinuation<WebPageMetadata, Error>?
    private var timeout: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private var original: URL?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1024, height: 768), configuration: configuration)
        super.init()
        webView.navigationDelegate = self
    }

    func fetch(_ url: URL) async throws -> WebPageMetadata {
        try Task.checkCancellation()
        original = url
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            timeout = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
                self?.complete(.failure(AppFailure.message("链接解析超时，请重试。")))
            }
            webView.load(URLRequest(url: url))
        }
    }

    func cancel() { complete(.failure(CancellationError())) }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = ["http", "https"].contains(action.request.url?.scheme?.lowercased() ?? "")
        decisionHandler(allowed && action.targetFrame != nil ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard continuation != nil else { return }
        polling?.cancel()
        polling = Task { [weak self] in
            guard let self else { return }
            // Allow hydrated pages to add meta tags; finish once their list settles.
            var lastMetadata: [String] = []
            var stable = 0
            for attempt in 0..<10 {
                do {
                    try Task.checkCancellation()
                    let value = try await self.webView.evaluateJavaScript(Self.script)
                    guard let dictionary = value as? [String: Any],
                          let records = dictionary["images"] as? [[String: Any]],
                          let url = self.webView.url ?? self.original else { break }
                    let images = records.compactMap { record -> WebImageCandidate? in
                        guard let value = record["url"] as? String,
                              let address = try? LinkPreviewService.validatedURL(value) else { return nil }
                        return WebImageCandidate(url: address, inPage: record["inPage"] as? Bool ?? false)
                    }
                    let title = dictionary["title"] as? String ?? ""
                    let description = dictionary["description"] as? String ?? ""
                    let metadata = [title, description, url.absoluteString] + images.map { $0.url.absoluteString }
                    stable = metadata == lastMetadata ? stable + 1 : 0
                    lastMetadata = metadata
                    if (attempt >= 4 && !images.isEmpty && stable >= 2) || attempt == 9 {
                        self.complete(.success(WebPageMetadata(title: title, description: description,
                                                               url: url, images: images)))
                        return
                    }
                    try await Task.sleep(nanoseconds: 500_000_000)
                } catch {
                    if !Task.isCancelled { self.complete(.failure(error)) }
                    return
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        complete(.failure(error))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        complete(.failure(error))
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        complete(.failure(AppFailure.message("链接解析中断，请重试。")))
    }

    private func complete(_ result: Result<WebPageMetadata, Error>) {
        guard let callback = continuation else { return }
        continuation = nil
        polling?.cancel(); polling = nil
        timeout?.cancel(); timeout = nil
        webView.stopLoading()
        callback.resume(with: result)
    }

    private static let script = #"""
    (() => {
      const path = value => { try { const u = new URL(value, document.baseURI); return u.host + u.pathname; } catch { return ''; } };
      const bodyImages = new Map(Array.from(document.images)
        .filter(i => i.naturalWidth >= 200 && i.naturalHeight >= 200)
        .map(i => [path(i.currentSrc || i.src), i.currentSrc || i.src]));
      const seen = new Set();
      const images = [];
      for (const m of document.querySelectorAll('meta[property="og:image"], meta[name="og:image"]')) {
        try {
          const u = new URL(m.content, document.baseURI);
          if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || seen.has(u.href)) continue;
          seen.add(u.href);
          const matched = bodyImages.get(path(u.href));
          // Use the matching gallery's HTTPS address when a meta tag still declares HTTP.
          const resolved = matched && u.protocol === 'http:' && matched.startsWith('https:') ? matched : u.href;
          images.push({url: resolved, inPage: !!matched});
        } catch {}
        if (images.length >= 12) break;
      }
      const firstText = (...values) => values.map(v => (v || '').trim()).find(Boolean) || '';
      const title = firstText(document.querySelector('meta[property="og:title"], meta[name="og:title"]')?.content, document.title);
      const description = firstText(document.querySelector('meta[property="og:description"], meta[name="og:description"]')?.content,
                                    document.querySelector('meta[name="description"]')?.content);
      return {title, description, images};
    })()
    """#
}
