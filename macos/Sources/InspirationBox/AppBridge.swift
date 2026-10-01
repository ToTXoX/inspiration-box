import AppKit
import Foundation
import InspirationCore
import WebKit

@MainActor final class AppBridge: NSObject, WKScriptMessageHandlerWithReply {
    let storage: AppStorage
    let previews: LinkPreviewService
    init(storage: AppStorage) {
        self.storage = storage
        previews = LinkPreviewService(storage: storage)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == "inspiration",
              message.frameInfo.request.url?.host == "app",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String else {
            replyHandler(nil, "请求来源无效。"); return
        }
        do {
            switch method {
            case "readState": replyHandler(try storage.readState() as Any? ?? NSNull(), nil)
            case "writeState":
                guard let value = body["value"] as? String else { throw AppFailure.message("缺少收藏数据。") }
                try storage.writeState(value)
                replyHandler(true, nil)
            case "saveImage":
                guard let value = body["base64"] as? String, value.utf8.count <= 17 * 1024 * 1024,
                      let data = Data(base64Encoded: value) else { throw AppFailure.message("图片读取失败。") }
                replyHandler(try storage.saveImage(data), nil)
            case "preview":
                guard let value = body["url"] as? String, let id = body["requestID"] as? String else {
                    throw AppFailure.message("缺少链接地址。")
                }
                let url = try LinkPreviewService.validatedURL(value)
                previews.fetch(url, requestID: id) { result in
                    switch result {
                    case .success(let preview): replyHandler(preview.dictionary, nil)
                    case .failure(let error): replyHandler(nil, error.localizedDescription)
                    }
                }
            case "cancelPreview":
                if let id = body["requestID"] as? String { previews.cancel(id) }
                replyHandler(true, nil)
            default: throw AppFailure.message("不支持此操作。")
            }
        } catch { replyHandler(nil, error.localizedDescription) }
    }
}
