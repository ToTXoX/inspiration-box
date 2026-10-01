import AppKit
import Foundation

public enum AppFailure: LocalizedError {
    case message(String)
    public var errorDescription: String? {
        switch self { case .message(let text): return text }
    }
}

public final class AppStorage {
    public let root: URL
    public let uploads: URL
    private let stateFile: URL

    public init(root: URL? = nil) throws {
        let base = try root ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("com.chenyun.inspiration-box", isDirectory: true)
        self.root = base
        uploads = base.appendingPathComponent("uploads", isDirectory: true)
        stateFile = base.appendingPathComponent("state.json")
        try FileManager.default.createDirectory(at: uploads, withIntermediateDirectories: true)
    }

    public func readState() throws -> String? {
        guard FileManager.default.fileExists(atPath: stateFile.path) else { return nil }
        let data = try Data(contentsOf: stateFile)
        try Self.validateState(data)
        guard let value = String(data: data, encoding: .utf8) else {
            throw AppFailure.message("收藏数据无法读取，原文件已保留。")
        }
        return value
    }

    public func writeState(_ value: String) throws {
        let data = Data(value.utf8)
        try Self.validateState(data)
        try data.write(to: stateFile, options: .atomic)
    }

    private static func validateState(_ data: Data) throws {
        guard data.count <= 32 * 1024 * 1024,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let state = object["state"] as? [String: Any],
              state["ideas"] is [[String: Any]], state["boards"] is [[String: Any]],
              state["categories"] is [String], state["canvasNotes"] is [[String: Any]] else {
            throw AppFailure.message("收藏数据格式不正确，原文件已保留。")
        }
    }

    /// Decode and normalize an image, rather than trusting a filename or MIME type.
    public func saveImage(_ data: Data) throws -> String {
        guard !data.isEmpty, data.count <= 12 * 1024 * 1024,
              let image = NSBitmapImageRep(data: data),
              image.pixelsWide > 0, image.pixelsHigh > 0,
              image.pixelsWide <= 16_384, image.pixelsHigh <= 16_384,
              image.pixelsWide * image.pixelsHigh <= 80_000_000,
              let png = image.representation(using: .png, properties: [:]) else {
            throw AppFailure.message("请选择有效的图片，文件不能超过 12 MB。")
        }
        let name = UUID().uuidString.lowercased() + ".png"
        try png.write(to: uploads.appendingPathComponent(name), options: .atomic)
        return "/uploads/" + name
    }

    public func uploadURL(for name: String) -> URL? {
        guard !name.isEmpty, name != ".", name != "..",
              name.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil else { return nil }
        let base = uploads.resolvingSymlinksInPath()
        let candidate = base.appendingPathComponent(name).resolvingSymlinksInPath()
        guard candidate.deletingLastPathComponent().path == base.path else { return nil }
        return candidate
    }
}
