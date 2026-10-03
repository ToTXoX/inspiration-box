#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/inspiration-box"
APP_DIR="$PROJECT_ROOT/build/灵感匣.app"
APP_VERSION="${APP_VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PROJECT_ROOT/macos/Info.plist")}"
APP_BUILD_NUMBER="${APP_BUILD_NUMBER:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PROJECT_ROOT/macos/Info.plist")}"
MACOS_ARCH="${MACOS_ARCH:-native}"
if [[ ! "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ ! "$APP_BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "APP_VERSION 必须为 x.y.z，APP_BUILD_NUMBER 必须为整数。" >&2
  exit 1
fi
case "$MACOS_ARCH" in
  native|universal|arm64|x86_64) ;;
  *) echo "MACOS_ARCH 必须为 native、universal、arm64 或 x86_64。" >&2; exit 1 ;;
esac
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
build_executable() {
  local arch="$1"
  local args=(--package-path "$PROJECT_ROOT/macos" -c release --cache-path "$PROJECT_ROOT/macos/.cache")
  if [[ "$arch" != native ]]; then
    args+=(--triple "$arch-apple-macosx13.0" --scratch-path "$PROJECT_ROOT/macos/.build/$arch")
  fi
  xcrun swift build "${args[@]}" --product InspirationBox
  SWIFT_BIN_DIR="$(xcrun swift build "${args[@]}" --show-bin-path)"
}
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/web" "$APP_DIR/Contents/Resources/uploads"
if [[ "$MACOS_ARCH" == universal ]]; then
  build_executable arm64
  ARM_BINARY="$SWIFT_BIN_DIR/InspirationBox"
  build_executable x86_64
  xcrun lipo -create "$ARM_BINARY" "$SWIFT_BIN_DIR/InspirationBox" -output "$APP_DIR/Contents/MacOS/InspirationBox"
else
  build_executable "$MACOS_ARCH"
  cp "$SWIFT_BIN_DIR/InspirationBox" "$APP_DIR/Contents/MacOS/InspirationBox"
fi
cp "$PROJECT_ROOT/macos/Info.plist" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_BUILD_NUMBER" "$APP_DIR/Contents/Info.plist"
# Replace only the generated frontend resources, leaving user data outside the app bundle.
rsync -a --delete "$FRONTEND_DIR/dist/" "$APP_DIR/Contents/Resources/web/"
cp "$FRONTEND_DIR"/server/uploads/cover-*.jpg "$APP_DIR/Contents/Resources/uploads/"
xcrun swift -module-cache-path "$CLANG_MODULE_CACHE_PATH" "$PROJECT_ROOT/scripts/create-app-icon.swift" "$PROJECT_ROOT/build/AppIcon.iconset"
iconutil -c icns -o "$APP_DIR/Contents/Resources/AppIcon.icns" "$PROJECT_ROOT/build/AppIcon.iconset"
if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --options runtime --timestamp --sign "$MACOS_SIGNING_IDENTITY" "$APP_DIR"
else
  codesign --force --sign - "$APP_DIR"
fi
codesign --verify --deep --strict "$APP_DIR"
echo "已构建：$APP_DIR"
