# 灵感匣

个人灵感收藏与主题画板工具，主客户端为 **macOS AppKit + WKWebView + React**。

## 开发与构建

要求 macOS 13+、Apple Command Line Tools（`xcode-select --install`）、Node.js 18+；无需 Go、Wails、Electron 或额外服务器。

```sh
cd inspiration-box
npm ci
cd ..
bash scripts/build-macos.sh
open build/灵感匣.app
```

构建脚本把 React 产物和示例图片打包进 `.app`，并进行本机 ad-hoc 签名。默认构建当前 Mac 的架构；面向其他用户分发时，需另行完成 Developer ID 签名与公证。

如果 Node 未加入 PATH，可用 `INSPIRATION_NODE=/absolute/path/to/node bash scripts/build-macos.sh` 指定可执行文件。

Swift 源码位于 `macos`，可以在 Xcode 中打开 `macos/Package.swift` 编辑。运行打包应用才能加载完整界面；单独 `swift run InspirationBox` 不包含前端资源。

```sh
swift run --package-path macos StateCheck
node scripts/check-desktop.cjs
# 真实链接检查：输出标题与落盘封面尺寸，临时图片在检查后清理。
swift run --package-path macos PreviewCheck 'https://example.com/note'
```

只调试网页布局时可运行 `npm run dev`。网页模式不提供 macOS 原生接口；需要客户端联调时重新构建并打开 `.app`。

## 结构

- `inspiration-box/src`：React / TypeScript / Zustand / Ant Design 前端，保留三屏、分类与画板交互。
- `macos/Sources/InspirationBox`：原生窗口、菜单、文件选择、外部链接、WebKit 通信与自定义资源协议。
- `macos/Sources/InspirationCore`：本地数据保存、图片校验与保存、Apple LinkPresentation 解析。
- `scripts/build-macos.sh`：前端构建、Swift 编译、`.app` 打包与本机签名。
- `inspiration-box/server`：保留的旧 Express 实现及示例封面，客户端不启动此服务；如需复查旧网页行为可运行 `npm run dev:legacy`。

## 数据与链接解析

客户端的收藏、分类、画板、便签保存在：

```text
~/Library/Application Support/com.chenyun.inspiration-box/state.json
~/Library/Application Support/com.chenyun.inspiration-box/uploads/
```

前端启动前读取数据，通过原生桥接保存为 JSON；保存采用原子替换，退出前等待尚未落盘的修改。上传图片与解析出的封面直接保存为本地 PNG，重启后无需重新抓取封面。示例封面保存在应用资源中。

链接解析使用 `LPMetadataProvider` 获取标题、最终网址与代表图片，识别登录 / 验证页并返回错误。支持从分享文案提取网址、取消旧请求、重试；自动结果不会覆盖手动填写的标题和封面。LinkPresentation 不提供完整笔记正文或全部图片，部分平台仍可能无法解析。实测小红书样本标题正确，但代表图片为平台标识，尚未取得笔记原始封面；完整封面能力仍列为待办。

浏览器版的 `localStorage` 与客户端存储彼此独立，当前不自动迁移浏览器收藏。数据导入、导出、备份与云同步暂缓；分类允许加入多个画板。

测试时可用 `INSPIRATION_DATA_DIR=/absolute/test/directory` 指定隔离的数据目录，日常启动不需要设置。
