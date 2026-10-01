#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/inspiration-box"
APP_DIR="$PROJECT_ROOT/build/灵感匣.app"
NODE_BIN="${INSPIRATION_NODE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "需要 Node.js。可用 INSPIRATION_NODE 指定 node 可执行文件。" >&2
  exit 1
fi
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "请先在 inspiration-box 内运行 npm ci。" >&2
  exit 1
fi
cd "$FRONTEND_DIR"
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit
"$NODE_BIN" node_modules/vite/bin/vite.js build
cd "$PROJECT_ROOT"
export CLANG_MODULE_CACHE_PATH="$PROJECT_ROOT/macos/.cache/modules"
export SWIFTPM_MODULECACHE_OVERRIDE="$PROJECT_ROOT/macos/.cache/modules"
xcrun swift build --package-path macos -c release --cache-path "$PROJECT_ROOT/macos/.cache"
SWIFT_BIN_DIR="$(xcrun swift build --package-path macos -c release --show-bin-path)"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/web" "$APP_DIR/Contents/Resources/uploads"
cp "$SWIFT_BIN_DIR/InspirationBox" "$APP_DIR/Contents/MacOS/InspirationBox"
cp "$PROJECT_ROOT/macos/Info.plist" "$APP_DIR/Contents/Info.plist"
# Replace only the generated frontend resources, leaving user data outside the app bundle.
rsync -a --delete "$FRONTEND_DIR/dist/" "$APP_DIR/Contents/Resources/web/"
cp "$FRONTEND_DIR"/server/uploads/cover-*.jpg "$APP_DIR/Contents/Resources/uploads/"
xcrun swift -module-cache-path "$CLANG_MODULE_CACHE_PATH" "$PROJECT_ROOT/scripts/create-app-icon.swift" "$PROJECT_ROOT/build/AppIcon.iconset"
iconutil -c icns -o "$APP_DIR/Contents/Resources/AppIcon.icns" "$PROJECT_ROOT/build/AppIcon.iconset"
codesign --force --sign - "$APP_DIR"
echo "已构建：$APP_DIR"
