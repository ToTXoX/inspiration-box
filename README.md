# 灵感匣

个人灵感收藏与主题画板工具，主客户端为 **macOS AppKit + WKWebView + React**。

[官网源码](website/index.html) · [下载与更新记录](https://github.com/ToTXoX/inspiration-box/releases) · [问题反馈](https://github.com/ToTXoX/inspiration-box/issues)

## 官网与自动发布

`website/` 是独立静态介绍官网，包含功能介绍、安装说明、常见问题和最新版下载入口。官网由你在 Vercel 手动导入仓库并配置部署，无需安装前端依赖。官网通过 GitHub API 获取最新稳定版 DMG；API 不可用时保留 Releases 页面入口，尚无稳定版本时显示待发布状态。

在 Vercel 新建项目，导入本仓库，使用以下设置：

| 设置 | 值 |
| --- | --- |
| Root Directory | `website` |
| Framework Preset | `Other` |
| Build Command | 留空（启用 Override） |
| Install Command | 留空（启用 Override） |
| Output Directory | `.` |

上述部署设置直接在 Vercel 控制台填写，官网使用 `website/` 下的 HTML/CSS/JS 源文件。部署完成后，可在 Vercel 项目的 Domains 中配置自己的域名。确定正式地址后，再更新 README 顶部的官网链接，并在 `website/index.html` 添加指向该正式地址的 canonical 标签。

本地预览：

```sh
python3 -m http.server 8080 --directory website
# 打开 http://localhost:8080
python3 scripts/check-website.py
```

`.github/workflows/release-macos.yml` 在推送 `v*` tag 时构建并发布 macOS 应用：

1. 校验版本 tag，运行已有桌面桥接与数据保存检查。
2. 构建 macOS 13+ 的 arm64 与 x86_64 二进制，合并为 universal 应用；应用版本取自 tag，构建号取自 Actions 运行编号。
3. 生成 `InspirationBox-<版本>-macos-universal.dmg`、`.zip`、`.sha256`；DMG 提供 Applications 拖拽入口。
4. 保存 Actions 构建产物 14 天，并上传到 GitHub Release。先建立草稿，上传全部文件后再公开；失败的草稿可通过重新运行工作流继续，已公开版本不会被覆盖。
5. `v0.3.0-beta.1` 等带后缀的版本标记为预发布，不更新稳定版下载。应用内的版本号为基础版本（如 `0.3.0`），安装包与 Release 保留完整版本。

先将这些配置提交并推送到仓库，再在要发布的提交上创建 tag（以下版本仅为示例，请选用尚未发布的版本）：

```sh
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

仅创建本地 tag 不会触发发布。tag 支持 `v主版本.次版本.修订版本` 和预发布后缀；不支持 `+build` 后缀。仓库需允许 GitHub Actions 运行，Release 工作流自行申请 `contents: write` 权限，无需额外 GitHub PAT。macOS runner 使用 `macos-15`，Intel 版本由同一 runner 交叉编译；最终检查两种架构都在安装包内。

### 可选：Developer ID 签名与 Apple 公证

未配置以下 secrets 时，工作流仍会发布 ad-hoc 签名版本，并在 Release 中注明未经公证；首次打开可能被 Gatekeeper 拦截。正式对外分发建议在仓库 **Settings → Secrets and variables → Actions** 一次性配置全部五项：

| Secret | 内容 |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | 含私钥的 **Developer ID Application** `.p12` 证书，以 Base64 编码 |
| `MACOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的非空密码 |
| `APPLE_ID` | Apple 开发者账号邮箱 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_APP_PASSWORD` | Apple ID 的 App 专用密码 |

工作流导入证书到临时 keychain，启用 hardened runtime 与时间戳，公证并 staple 应用，再生成 ZIP/DMG；DMG 也会签名、公证并 staple。部分 secrets 缺失或签名、公证失败会停止发布，不会降级成未公证版本。临时证书与 keychain 在结束时清理。不要将证书、私钥或密码提交到仓库。

本地可复用相同脚本：

```sh
MACOS_ARCH=universal APP_VERSION=0.2.0 APP_BUILD_NUMBER=2 bash scripts/build-macos.sh
MACOS_ARCH=universal RELEASE_VERSION=0.2.0 bash scripts/package-macos.sh
```

若需本地签名，设置 `MACOS_SIGNING_IDENTITY` 为有效的 Developer ID Application 身份；公证另设 `MACOS_NOTARY_PROFILE` 为已由 `notarytool store-credentials` 保存的 keychain profile。打包脚本处理现有 `.app`，不自动重新编译。

官网部署配置依据：[Vercel 构建配置文档](https://vercel.com/docs/builds/configure-a-build)。发布命令依据：[GitHub CLI Release 文档](https://cli.github.com/manual/gh_release_create)。

## 开发与构建

要求 macOS 13+、Apple Command Line Tools（`xcode-select --install`）、Node.js 18+；无需 Go、Wails、Electron 或额外服务器。

```sh
cd inspiration-box
npm ci
cd ..
bash scripts/build-macos.sh
open build/灵感匣.app
```

构建脚本把 React 产物和示例图片打包进 `.app`，默认构建当前 Mac 的架构并进行本机 ad-hoc 签名；设置 `MACOS_ARCH=universal` 可生成双架构应用。自动发布、Developer ID 签名与公证配置见上文。

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
