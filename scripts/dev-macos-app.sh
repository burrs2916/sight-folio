#!/usr/bin/env bash
# sight-folio: macOS "non-installed" test launcher
#
# Why: `npm run tauri dev` runs a bare binary (no .app bundle). macOS
# microphone/camera permissions (TCC) only register apps with bundle identity:
# without .app there is no Info.plist / bundle id, so the app never shows up in
# System Settings > Privacy & Security > Microphone and no permission dialog
# appears (WKWebView reports not-allowed).
#
# This script wraps the dev binary (still dev mode: loads vite dev server at
# devUrl, hot reload works) into a temporary .app bundle and launches it:
#   - Info.plist declares CFBundleIdentifier and NSMicrophoneUsageDescription
#   - Resources contains icon.icns (fixes the Dock icon too)
#   - ad-hoc codesign so TCC can register the bundle id stably
# After authorizing once in System Settings, voice input works like the
# installed version.
#
# Usage: npm run tauri:dev:app   (same as bash scripts/dev-macos-app.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Sight Folio"
BIN_NAME="sight-folio"
BUNDLE_ID="com.sight.folio"
VITE_PORT=23010
DEV_URL="http://localhost:${VITE_PORT}"
TARGET_DIR="$ROOT/src-tauri/target/debug"
APP_DIR="$TARGET_DIR/${APP_NAME}.app"
VITE_LOG="$TARGET_DIR/vite-dev.log"

# -- 1) make sure vite dev server is running (dev binary loads devUrl) --------
if ! curl -sf "$DEV_URL" >/dev/null 2>&1; then
  echo "Vite dev server not running, starting in background (log: $VITE_LOG)..."
  # nohup + subshell: detach from the caller's job so the launcher returns
  # immediately instead of waiting on the dev server.
  (cd "$ROOT" && nohup npm run dev >"$VITE_LOG" 2>&1 < /dev/null &) || true
  for _ in $(seq 1 60); do
    curl -sf "$DEV_URL" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! curl -sf "$DEV_URL" >/dev/null 2>&1; then
    echo "dev server failed to start, see log: $VITE_LOG" >&2
    exit 1
  fi
  echo "dev server ready."
fi

# -- 2) build dev binary (no custom-protocol feature => dev mode, devUrl) -----
(cd "$ROOT/src-tauri" && cargo build --bin sight-folio)

# -- 3) quit any running instance, then assemble .app bundle ------------------
# `open` would reactivate an existing instance instead of launching the fresh
# bundle (new Info.plist/signature would not take effect), so quit it first.
pkill -f "${APP_NAME}.app/Contents/MacOS/${BIN_NAME}" 2>/dev/null || true
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$TARGET_DIR/$BIN_NAME" "$APP_DIR/Contents/MacOS/$BIN_NAME"
cp "$ROOT/src-tauri/icons/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>zh_CN</string>
	<key>CFBundleExecutable</key>
	<string>sight-folio</string>
	<key>CFBundleIdentifier</key>
	<string>com.sight.folio</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Sight Folio</string>
	<key>CFBundleDisplayName</key>
	<string>Sight Folio</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>0.1.0</string>
	<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSMicrophoneUsageDescription</key>
	<string>需要使用麦克风进行 AI 语音对话与语音输入。</string>
	<key>NSSpeechRecognitionUsageDescription</key>
	<string>需要发送语音到系统语音识别服务以转换为文字。</string>
</dict>
</plist>
PLIST

# -- 4) ad-hoc codesign (optional but stable: TCC registers bundle id) ---------
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_DIR" 2>/dev/null \
    || echo "ad-hoc codesign failed (not fatal, app still runs)"
fi

# -- 5) launch ----------------------------------------------------------------
open "$APP_DIR"
echo "Launched: $APP_DIR"
echo "(dev server keeps running: $DEV_URL; stop it with: pkill -f vite)"
echo "Tip: if System Settings > Privacy & Security > Microphone asks, allow it once."