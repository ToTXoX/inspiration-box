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
previews.fetch(target, requestID: "smoke-check") { result in
    switch result {
    case .success(let preview):
        var output: [String: Any] = ["title": preview.title, "finalPath": URL(string: preview.finalURL)?.path ?? ""]
        if let image = preview.image, let file = storage.uploadURL(for: String(image.dropFirst("/uploads/".count))),
           let data = try? Data(contentsOf: file), let bitmap = NSBitmapImageRep(data: data) {
            output["imageBytes"] = data.count
            output["imageWidth"] = bitmap.pixelsWide
            output["imageHeight"] = bitmap.pixelsHigh
            exitCode = 0
        }
        print(String(data: try! JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    case .failure(let error): print("FAILED: " + error.localizedDescription)
    }
    finished = true
}
let deadline = Date().addingTimeInterval(45)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
if !finished { print("FAILED: timeout"); previews.cancel("smoke-check") }
try? FileManager.default.removeItem(at: root)
exit(exitCode)
}
}
