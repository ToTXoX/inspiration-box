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
# 真实链接检查：输出标题、候选图片数量与落盘尺寸，临时图片在检查后清理。
swift run --package-path macos PreviewCheck 'https://example.com/note'
# 构建后验证动态元数据、重复图片、默认封面、跳转与无图页面。
python3 scripts/check-web-images.py
# 原生接口对照：保存图片、尺寸、类型及文件摘要；URL 仅作为运行参数传入。
swift scripts/check-linkpresentation.swift /tmp/linkpresentation-check 'https://example.com/note'
```

只调试网页布局时可运行 `npm run dev`。网页模式不提供 macOS 原生接口；需要客户端联调时重新构建并打开 `.app`。

博物架、灵感库和主题画板共用 56px 顶栏，依次展示「i AM、搜索框、收藏、头像」，不显示页面标题或副标题。排序与排版按钮放在首行筛选栏右侧，与分类 / 画板选项共用一行；窄窗口胶囊自动换行，短窗口进一步缩小上下留白。

博物架分类导航点击后平滑定位到本页「最近想法」对应分类，并为固定顶栏留出空间；重复点击仍可重新定位。没有精选灵感的分类会显示空态分组。分组名称和底部「去库里翻翻」保留进入灵感库的入口。

主题画板使用一屏工作区：画布与右侧灵感库随窗口剩余高度伸缩，距窗口底部保留 16px 留白；底部导航悬浮覆盖画布、不预留导航占位，候选图在面板内滚动。进入画板自动适应内容；调整窗口大小保留视野中心与缩放倍率，需要重新展示全部内容时点击「适应」。

## 结构

- `inspiration-box/src`：React / TypeScript / Zustand / Ant Design 前端，保留三屏、分类与画板交互。
- `macos/Sources/InspirationBox`：原生窗口、菜单、文件选择、外部链接、WebKit 通信与自定义资源协议。
- `macos/Sources/InspirationCore`：本地数据保存、图片校验与保存、WKWebView 元数据解析。
- `scripts/build-macos.sh`：前端构建、Swift 编译、`.app` 打包与本机签名。
- `inspiration-box/server`：保留的旧 Express 实现及示例封面，客户端不启动此服务；如需复查旧网页行为可运行 `npm run dev:legacy`。

## 数据与链接解析

客户端的收藏、分类、画板、便签保存在：

```text
~/Library/Application Support/com.chenyun.inspiration-box/state.json
~/Library/Application Support/com.chenyun.inspiration-box/uploads/
```

前端启动前读取数据，通过原生桥接保存为 JSON；保存采用原子替换，退出前等待尚未落盘的修改。上传图片与解析出的封面直接保存为本地 PNG，重启后无需重新抓取封面。示例封面保存在应用资源中。

链接解析统一使用独立的 `WKWebView`，从同一次页面加载中读取标题、描述、跳转后的实际网址及多个 `og:image`（支持相对地址，最多 12 个不同地址）。标题优先读取 `og:title`，缺失或为空时回退 `document.title`；描述优先读取 `og:description`，再回退普通 description 标签，并通过桥接返回（描述表单仍由用户填写）。网页提取超时 15 秒。候选图片下载、校验、去重后保存为本地 PNG；页面正文中匹配的大图优先，显式 logo / icon 地址降低优先级。远程网页不接入应用桥接，也不共享持久化登录会话。

收藏 / 编辑弹窗显示候选图片，可点击选择一张作为封面。`image` 保存当前封面，`images` 保存候选列表，卡片仍展示单图；旧单图收藏兼容。支持分享文案提取、取消旧请求、重试，自动结果不覆盖手动填写的标题或封面。部分图片失败时保留可用图片并提示重试；部分成功结果不缓存。当前不抓取正文，也不扫描所有正文图片；未声明 OG 图片时保留标题并提示上传封面，需要登录 / 验证或加载失败时返回解析错误。客户端不再调用 `LPMetadataProvider`，图片下载仍会产生资源请求。

2026-10-01 WKWebView 实测：笔记 `6a9aa82e0000000026039f5d` 的 5 个 OG 图片成功落盘，包含四张 1080 像素宽的笔记图与一张平台标识，默认封面为第一张笔记图。客户端隔离目录中已验证选择第三张图片并收藏，五张候选图与所选封面一并保存，再次打开编辑弹窗也能恢复选择。分享 token 仅通过运行参数传入，不在源码或文档中记录。

统一 WKWebView 后复测：同一小红书链接仍取得正确标题、描述和 5 张候选图；本地测试通过单次页面加载、跳转后的实际网址、空 OG 标题回退、无图页面及登录页拒绝。客户端产物已不链接 LinkPresentation。

2026-10-01 原生对照（历史调研，独立脚本保留，客户端已不采用 LinkPresentation）：两条小红书分享链接分别使用回调返回后读取、回调内等待图片读取完成、Safari User-Agent 的 URLRequest、`/explore` 路径请求，共 8 组结果。标题均正确，代表图片均为同一张 600 × 315 的平台标识 PNG（8303 字节，SHA-256 相同），仅注册 `public.png`。第一条链接的完整 `LPLinkView` 也只显示标识。Apple MacBook Air 网页的正向对照取得 1024 × 537 的真实产品图，证明该测试可读取网页图片。本轮未证明临时文件生命周期导致缺图，也未在无边际中重新请求同一链接，不能据此确定无边际效果差异的原因。

浏览器版的 `localStorage` 与客户端存储彼此独立，当前不自动迁移浏览器收藏。数据导入、导出、备份与云同步暂缓；分类允许加入多个画板。

测试时可用 `INSPIRATION_DATA_DIR=/absolute/test/directory` 指定隔离的数据目录，日常启动不需要设置。
