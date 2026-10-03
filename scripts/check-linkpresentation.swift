import AppKit
import CryptoKit
import Foundation
import LinkPresentation

// Pass shared links as arguments. Reports contain paths and titles, never query tokens.
guard CommandLine.arguments.count > 2 else {
    print("Usage: check-linkpresentation '<output directory>' '<URL>' [<URL>…]")
    exit(1)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
NSApplication.shared.setActivationPolicy(.prohibited)

func log(_ value: String) { FileHandle.standardOutput.write(Data((value + "\n").utf8)) }

func readImage(_ provider: NSItemProvider?, destination: URL,
               completion: @escaping ([String: Any]) -> Void) {
    guard let provider else { completion(["present": false]); return }
    let types = provider.registeredTypeIdentifiers
    provider.loadObject(ofClass: NSImage.self) { object, error in
        var result: [String: Any] = ["present": true, "registeredTypes": types]
        if let image = object as? NSImage, let tiff = image.tiffRepresentation,
           let bitmap = NSBitmapImageRep(data: tiff),
           let png = bitmap.representation(using: .png, properties: [:]) {
            do {
                try png.write(to: destination, options: .atomic)
                result["width"] = bitmap.pixelsWide
                result["height"] = bitmap.pixelsHigh
                result["bytes"] = png.count
                result["sha256"] = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
                result["file"] = destination.lastPathComponent
            } catch { result["error"] = error.localizedDescription }
        } else { result["error"] = error?.localizedDescription ?? "No decodable image" }
        completion(result)
    }
}

var reports: [[String: Any]] = []
for value in CommandLine.arguments.dropFirst(2) {
    guard let original = URL(string: value), ["http", "https"].contains(original.scheme ?? "") else { continue }
    let note = original.lastPathComponent
    var exploreParts = URLComponents(url: original, resolvingAgainstBaseURL: false)!
    if exploreParts.host?.hasSuffix("xiaohongshu.com") == true {
        exploreParts.path = "/explore/" + note
    }
    for mode in ["url-after-callback", "url-held-callback", "request-safari-held", "explore-held"] {
        let prefix = note + "-" + mode
        let url = mode == "explore-held" ? (exploreParts.url ?? original) : original
        let provider = LPMetadataProvider()
        provider.timeout = 30
        provider.shouldFetchSubresources = true
        var complete = false
        var report: [String: Any] = ["noteID": note, "mode": mode]
        log("START " + prefix)
        let callback: (LPLinkMetadata?, Error?) -> Void = { metadata, error in
            guard let metadata else {
                DispatchQueue.main.async {
                    report["error"] = error?.localizedDescription ?? "No metadata"
                    complete = true
                }
                return
            }
            let details: [String: Any] = [
                "title": metadata.title ?? "", "finalPath": metadata.url?.path ?? "",
                "imageTypes": metadata.imageProvider?.registeredTypeIdentifiers ?? [],
                "iconTypes": metadata.iconProvider?.registeredTypeIdentifiers ?? []
            ]
            if mode == "url-after-callback" {
                // Deliberately wait until this callback has returned, matching the app's current flow.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    report.merge(details) { _, new in new }
                    readImage(metadata.imageProvider, destination: output.appendingPathComponent(prefix + ".png")) { image in
                        DispatchQueue.main.async { report["image"] = image; complete = true }
                    }
                }
            } else {
                // Diagnostic only: keep this background callback alive until image data is copied.
                // Bound the wait so a stalled item provider cannot hang the probe.
                let group = DispatchGroup()
                let lock = NSLock()
                var images: [String: Any] = [:]
                for (kind, item) in [("image", metadata.imageProvider), ("icon", metadata.iconProvider)] {
                    group.enter()
                    readImage(item, destination: output.appendingPathComponent(prefix + "-" + kind + ".png")) { image in
                        lock.lock(); images[kind] = image; lock.unlock()
                        group.leave()
                    }
                }
                let held = group.wait(timeout: .now() + 10) == .success
                lock.lock(); let copied = images; lock.unlock()
                DispatchQueue.main.async {
                    report.merge(details) { _, new in new }
                    report.merge(copied) { _, new in new }
                    report["copiedBeforeCallbackReturn"] = held
                    complete = true
                }
            }
        }
        if mode == "request-safari-held" {
            var request = URLRequest(url: url)
            request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
            provider.startFetchingMetadata(for: request, completionHandler: callback)
        } else { provider.startFetchingMetadata(for: url, completionHandler: callback) }
        let deadline = Date().addingTimeInterval(45)
        while !complete && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
        if !complete { provider.cancel(); report["error"] = "Probe timeout" }
        reports.append(report)
        let data = try JSONSerialization.data(withJSONObject: reports, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: output.appendingPathComponent("report.json"), options: .atomic)
        log("DONE " + prefix + ": " + (report["title"] as? String ?? "FAILED"))
    }
}
log("Report saved: " + output.appendingPathComponent("report.json").path)
