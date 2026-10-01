import AppKit
import Foundation
import InspirationCore

private func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !value() { throw AppFailure.message("CHECK FAILED: " + message) }
}
private func expectFailure(_ operation: () throws -> Void) throws {
    var failed = false
    do { try operation() } catch { failed = true }
    try require(failed, "expected an error")
}

@main enum StateCheck {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = try AppStorage(root: root)
        defer { try? FileManager.default.removeItem(at: root) }
        let state = "{\"state\":{\"ideas\":[],\"boards\":[],\"categories\":[\"穿搭\"],\"canvasNotes\":[]},\"version\":0}"
        try require(storage.readState() == nil, "new storage must be empty")
        try storage.writeState(state)
        try require(AppStorage(root: root).readState() == state, "state must survive reopening")
        print("PASS: state survives reopening")
        try expectFailure { try storage.writeState("{}") }
        try require(storage.readState() == state, "invalid writes must preserve existing data")
        print("PASS: invalid writes preserve data")
        let file = root.appendingPathComponent("state.json")
        try Data("broken-json".utf8).write(to: file)
        try expectFailure { _ = try storage.readState() }
        try require(String(contentsOf: file) == "broken-json", "corrupt files must not be overwritten")
        print("PASS: corrupt files are reported and preserved")

        let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        for y in 0..<2 { for x in 0..<2 { image.setColor(.cyan, atX: x, y: y) } }
        let path = try storage.saveImage(image.representation(using: .png, properties: [:])!)
        let name = String(path.dropFirst("/uploads/".count))
        try require(NSBitmapImageRep(data: Data(contentsOf: storage.uploadURL(for: name)!)) != nil, "saved images must decode")
        try require(storage.uploadURL(for: "../state.json") == nil, "path traversal must fail")
        try require(storage.uploadURL(for: "cover-silk.jpg") != nil, "missing local files must allow bundled image fallback")
        let alias = root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: root)
        defer { try? FileManager.default.removeItem(at: alias) }
        try require(AppStorage(root: alias).uploadURL(for: "cover-silk.jpg") != nil, "bundled image fallback must work through a directory alias")
        try expectFailure { _ = try storage.saveImage(Data("not an image".utf8)) }
        try FileManager.default.createSymbolicLink(at: storage.uploads.appendingPathComponent("escape.png"), withDestinationURL: file)
        try require(storage.uploadURL(for: "escape.png") == nil, "symlink escape must fail")
        print("PASS: image saving and path containment")

        let link = "https://www.xiaohongshu.com/explore/abc?xsec_token=abc%2B123%3D&xsec_source=pc_share"
        try require(LinkPreviewService.validatedURL(link).absoluteString == link, "share token must survive")
        try expectFailure { _ = try LinkPreviewService.validatedURL("file:///etc/passwd") }
        try expectFailure { _ = try LinkPreviewService.validatedURL("https://user:password@example.com") }
        print("PASS: URL validation and share token preservation")
    }
}
