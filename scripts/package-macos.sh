#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$PROJECT_ROOT/build/灵感匣.app"
VERSION="${RELEASE_VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_DIR/Contents/Info.plist")}"
ARCH="${MACOS_ARCH:-native}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "无效的 RELEASE_VERSION：$VERSION" >&2; exit 1
fi
case "$ARCH" in native|universal|arm64|x86_64) ;; *) echo '无效的 MACOS_ARCH' >&2; exit 1 ;; esac
codesign --verify --deep --strict "$APP_DIR"
if [[ "$ARCH" == universal ]]; then
  xcrun lipo "$APP_DIR/Contents/MacOS/InspirationBox" -verify_arch arm64 x86_64
elif [[ "$ARCH" != native ]]; then
  xcrun lipo "$APP_DIR/Contents/MacOS/InspirationBox" -verify_arch "$ARCH"
fi

OUTPUT_DIR="$PROJECT_ROOT/build/release"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inspiration-dmg.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
mkdir -p "$OUTPUT_DIR"
ARTIFACT_NAME="InspirationBox-$VERSION-macos-$ARCH"
ZIP_PATH="$OUTPUT_DIR/$ARTIFACT_NAME.zip"
DMG_PATH="$OUTPUT_DIR/$ARTIFACT_NAME.dmg"

# Staple before creating the distributable archives so both formats contain the ticket.
if [[ -n "${MACOS_NOTARY_PROFILE:-}" ]]; then
  SUBMISSION="$STAGING_DIR/notarization.zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$SUBMISSION"
  xcrun notarytool submit "$SUBMISSION" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP_DIR"
  xcrun stapler validate "$APP_DIR"
  spctl --assess --type execute --verbose=2 "$APP_DIR"
  rm -f "$SUBMISSION"
fi

rm -f "$ZIP_PATH" "$DMG_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ZIP_PATH"
ditto "$APP_DIR" "$STAGING_DIR/灵感匣.app"
ln -s /Applications "$STAGING_DIR/Applications"
hdiutil create -volname "灵感匣 $VERSION" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"
if [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
  codesign --timestamp --sign "$MACOS_SIGNING_IDENTITY" "$DMG_PATH"
fi
if [[ -n "${MACOS_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
fi
hdiutil verify "$DMG_PATH"
cd "$OUTPUT_DIR"
shasum -a 256 "$ARTIFACT_NAME.zip" "$ARTIFACT_NAME.dmg" > "$ARTIFACT_NAME.sha256"
echo "安装包：$OUTPUT_DIR/$ARTIFACT_NAME.{zip,dmg,sha256}"
