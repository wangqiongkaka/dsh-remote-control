#!/bin/sh
# Render and exercise the production recovery view without changing the installed App's pairing.
set -eu
device=${1:?需要模拟器 ID}
product=${2:?需要构建的 App 路径}
output=${3:?需要截图输出目录}
mkdir -p "$output"
temporary=$(mktemp -d)
app="$temporary/ConnectionCheck.app"
bundle=io.github.wangqiong.dsh-connection-check
appearance=$(xcrun simctl ui "$device" appearance)
size=$(xcrun simctl ui "$device" content_size)
launcher=
trap 'if [ -n "$launcher" ]; then kill "$launcher" 2>/dev/null || true; fi; xcrun simctl uninstall "$device" "$bundle" >/dev/null 2>&1 || true; xcrun simctl ui "$device" appearance "$appearance"; xcrun simctl ui "$device" content_size "$size"; rm -rf "$temporary"' EXIT
mkdir "$app"
xcrun --sdk iphonesimulator swiftc -parse-as-library \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target "$(uname -m)-apple-ios17.0-simulator" \
  ios/DSHRemote/ConnectionFailureView.swift ios/Checks/Connection.swift -o "$app/ConnectionCheck"
cp "$product/Assets.car" "$app/Assets.car"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.wangqiong.dsh-connection-check</string><key>CFBundleExecutable</key><string>ConnectionCheck</string><key>CFBundlePackageType</key><string>APPL</string><key>UILaunchScreen</key><dict/></dict></plist>
PLIST
xcrun simctl install "$device" "$app"
for mode in dark light large compact landscape; do
  xcrun simctl ui "$device" appearance dark
  xcrun simctl ui "$device" content_size large
  if [ "$mode" = light ]; then xcrun simctl ui "$device" appearance light; fi
  if [ "$mode" = large ]; then xcrun simctl ui "$device" content_size accessibility-extra-extra-extra-large; fi
  xcrun simctl launch --terminate-running-process --console "$device" "$bundle" -case "$mode" \
    > "$output/$mode.log" 2> "$output/$mode.stderr.log" &
  launcher=$!
  attempts=0
  while ! rg -q '错误页布局检查通过' "$output/$mode.log"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 40 ]; then cat "$output/$mode.stderr.log"; exit 1; fi
    sleep .2
  done
  cat "$output/$mode.log"
  xcrun simctl io "$device" screenshot "$output/$mode.png"
  kill "$launcher" 2>/dev/null || true
  wait "$launcher" 2>/dev/null || true
  launcher=
done
