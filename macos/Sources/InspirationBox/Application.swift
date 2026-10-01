import AppKit
import Foundation
import InspirationCore
import UniformTypeIdentifiers
import WebKit

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var bridge: AppBridge!
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let dataRoot = ProcessInfo.processInfo.environment["INSPIRATION_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            let storage = try AppStorage(root: dataRoot)
            bridge = AppBridge(storage: storage)
            guard let resources = Bundle.main.resourceURL,
                  FileManager.default.fileExists(atPath: resources.appendingPathComponent("web/index.html").path) else {
                throw AppFailure.message("找不到界面资源，请使用 scripts/build-macos.sh 构建应用。")
            }
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            config.setURLSchemeHandler(AssetSchemeHandler(resources: resources, storage: storage), forURLScheme: "inspiration")
            config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "inspiration")
            webView = WKWebView(frame: .zero, configuration: config)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            if #available(macOS 13.3, *) { webView.isInspectable = true }
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
                styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "灵感匣"
            window.minSize = NSSize(width: 840, height: 620)
            window.contentView = webView
            window.delegate = self
            window.isReleasedWhenClosed = false
            window.center()
            makeMenu()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            webView.load(URLRequest(url: URL(string: "inspiration://app/index.html")!))
        } catch {
            let alert = NSAlert()
            alert.messageText = "灵感匣未能启动"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    private func makeMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "灵感匣")
        appMenu.addItem(withTitle: "关于灵感匣", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏灵感匣", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出灵感匣", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"),
                                     ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.mainMenu = menu
        NSApp.windowsMenu = windowMenu
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard webView != nil else { return .terminateNow }
        if isTerminating { return .terminateCancel }
        isTerminating = true
        webView.callAsyncJavaScript("if (window.__inspirationFlush) { await window.__inspirationFlush(); }",
            arguments: [:], in: nil, in: .page) { [weak self] result in
                guard let self else { sender.reply(toApplicationShouldTerminate: true); return }
                switch result {
                case .success: sender.reply(toApplicationShouldTerminate: true)
                case .failure:
                    self.isTerminating = false
                    let alert = NSAlert()
                    alert.messageText = "修改尚未保存"
                    alert.informativeText = "请重试保存后再退出，避免丢失刚才的修改。"
                    alert.runModal()
                    sender.reply(toApplicationShouldTerminate: false)
                }
            }
        return .terminateLater
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "inspiration" && url.host == "app" { decisionHandler(.allow); return }
        if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
}

@main enum InspirationApplication {
    @MainActor static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }
}
