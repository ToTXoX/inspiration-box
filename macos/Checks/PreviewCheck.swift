import AppKit
import Foundation
import InspirationCore

@main enum PreviewCheck {
@MainActor static func main() throws {
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
guard CommandLine.arguments.count > 1 else {
    print("Usage: swift run --package-path macos PreviewCheck '<URL>'")
    exit(1)
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent("inspiration-preview-check-" + UUID().uuidString)
let storage = try AppStorage(root: root)
let previews = LinkPreviewService(storage: storage)
let target = try LinkPreviewService.validatedURL(CommandLine.arguments[1])
var finished = false
var exitCode: Int32 = 1
var cancellationCount = 0
let checkCancellation = CommandLine.arguments.contains("--cancel-first")
let completion: (Result<LinkPreview, Error>) -> Void = { result in
    switch result {
    case .success(let preview):
        var output: [String: Any] = ["title": preview.title, "description": preview.description,
                                    "finalPath": URL(string: preview.finalURL)?.path ?? ""]
        let images: [[String: Any]] = preview.images.compactMap { path in
            guard let file = storage.uploadURL(for: String(path.dropFirst("/uploads/".count))),
                  let data = try? Data(contentsOf: file), let bitmap = NSBitmapImageRep(data: data) else { return nil }
            return ["imageBytes": data.count, "imageWidth": bitmap.pixelsWide,
                    "imageHeight": bitmap.pixelsHigh, "path": path]
        }
        output["images"] = images
        output["imageCount"] = images.count
        output["warning"] = preview.warning as Any? ?? NSNull()
        output["defaultIsFirst"] = preview.image == preview.images.first
        output["cancellationCount"] = cancellationCount
        let expected = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2]) : nil
        if (expected == 0 || !images.isEmpty) && images.count == preview.images.count && preview.image == preview.images.first &&
            (expected == nil || expected == images.count) &&
            (!checkCancellation || cancellationCount == 1) { exitCode = 0 }
        print(String(data: try! JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    case .failure(let error): print("FAILED: " + error.localizedDescription)
    }
    finished = true
}
if checkCancellation {
    previews.fetch(target, requestID: "smoke-check") { result in
        if case .failure = result { cancellationCount += 1 }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        // Reusing an ID cancels its pending web view and metadata request before starting again.
        previews.fetch(target, requestID: "smoke-check", completion: completion)
    }
} else {
    previews.fetch(target, requestID: "smoke-check", completion: completion)
}
let deadline = Date().addingTimeInterval(50)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
if !finished { print("FAILED: timeout"); previews.cancel("smoke-check") }
try? FileManager.default.removeItem(at: root)
exit(exitCode)
}
}
