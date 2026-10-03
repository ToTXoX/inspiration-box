import AppKit
import Foundation
import LinkPresentation

// Development probe: pass the URL at runtime so share tokens never enter source files.
final class PreviewDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var linkView: LPLinkView!
    private let provider = LPMetadataProvider()
    private let status = NSTextField(wrappingLabelWithString: "正在获取 Apple 链接预览…")
    private let export = NSButton(title: "保存预览 PNG", target: nil, action: nil)
    private let outputDirectory: URL
    private let url: URL

    init(url: URL, outputDirectory: URL) { self.url = url; self.outputDirectory = outputDirectory }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 600),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "LPLinkView 原生预览"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 600, height: 500)
        let container = NSView()
        window.contentView = container
        status.font = .systemFont(ofSize: 13)
        status.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(status)
        export.target = self
        export.action = #selector(savePreview)
        export.isEnabled = false
        export.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(export)
        linkView = LPLinkView(url: url)
        linkView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(linkView)
        NSLayoutConstraint.activate([
            status.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
            status.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            linkView.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 20),
            linkView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            linkView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            linkView.bottomAnchor.constraint(lessThanOrEqualTo: export.topAnchor, constant: -20),
            export.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            export.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -20)
        ])
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出原生预览", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        menu.addItem(item)
        NSApp.mainMenu = menu
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        provider.timeout = 30
        provider.shouldFetchSubresources = true
        provider.startFetchingMetadata(for: url) { [weak self] metadata, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let metadata else {
                    self.status.stringValue = "解析失败：" + (error?.localizedDescription ?? "没有返回元数据")
                    print(self.status.stringValue)
                    return
                }
                self.linkView.metadata = metadata
                self.window.contentView?.layoutSubtreeIfNeeded()
                self.status.stringValue = "Apple 原生 LPLinkView · " + (metadata.title ?? "无标题")
                self.export.isEnabled = true
                print("title: " + (metadata.title ?? ""))
                print("final path: " + (metadata.url?.path ?? ""))
                print("imageProvider: \(metadata.imageProvider != nil), iconProvider: \(metadata.iconProvider != nil)")
                if let imageProvider = metadata.imageProvider {
                    imageProvider.loadObject(ofClass: NSImage.self) { object, _ in
                        guard let image = object as? NSImage, let tiff = image.tiffRepresentation,
                              let bitmap = NSBitmapImageRep(data: tiff),
                              let png = bitmap.representation(using: .png, properties: [:]) else { return }
                        try? png.write(to: self.outputDirectory.appendingPathComponent("image-provider.png"), options: .atomic)
                        print("imageProvider bitmap: \(bitmap.pixelsWide) × \(bitmap.pixelsHigh)")
                    }
                }
            }
        }
    }

    @objc private func savePreview() {
        linkView.layoutSubtreeIfNeeded()
        guard let bitmap = linkView.bitmapImageRepForCachingDisplay(in: linkView.bounds) else {
            status.stringValue = "无法创建预览位图。"; return
        }
        linkView.cacheDisplay(in: linkView.bounds, to: bitmap)
        do {
            guard let png = bitmap.representation(using: .png, properties: [:]) else { return }
            let destination = outputDirectory.appendingPathComponent("linkview-preview.png")
            try png.write(to: destination, options: .atomic)
            status.stringValue = "已保存原生预览：" + destination.lastPathComponent
            print("saved: " + destination.path)
        } catch { status.stringValue = "保存失败：" + error.localizedDescription }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

guard CommandLine.arguments.count >= 3,
      let targetURL = URL(string: CommandLine.arguments[1]),
      ["http", "https"].contains(targetURL.scheme ?? "") else {
    print("Usage: LinkViewPreview '<URL>' '<output directory>'")
    exit(1)
}
let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = PreviewDelegate(url: targetURL, outputDirectory: directory)
application.delegate = delegate
application.run()
withExtendedLifetime(delegate) {}
