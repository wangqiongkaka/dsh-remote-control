#!/bin/sh
# Render and exercise the production startup view without changing the installed App's pairing.
set -eu
device=${1:?需要模拟器 ID}
product=${2:?需要构建的 App 路径}
output=${3:?需要截图输出目录}
mkdir -p "$output"
temporary=$(mktemp -d)
app="$temporary/StartupCheck.app"
bundle=io.github.wangqiong.dsh-startup-view-check
appearance=$(xcrun simctl ui "$device" appearance)
size=$(xcrun simctl ui "$device" content_size)
motion=$(xcrun simctl spawn "$device" defaults read com.apple.Accessibility ReduceMotionEnabled 2>/dev/null || echo 0)
case "$motion" in 1|true|yes) motion=true;; *) motion=false;; esac
launcher=
trap 'if [ -n "$launcher" ]; then kill "$launcher" 2>/dev/null || true; fi; xcrun simctl uninstall "$device" "$bundle" >/dev/null 2>&1 || true; xcrun simctl ui "$device" appearance "$appearance"; xcrun simctl ui "$device" content_size "$size"; xcrun simctl spawn "$device" defaults write com.apple.Accessibility ReduceMotionEnabled -bool "$motion"; rm -rf "$temporary"' EXIT
mkdir "$app"
xcrun --sdk iphonesimulator swiftc -parse-as-library \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target "$(uname -m)-apple-ios17.0-simulator" \
  ios/DSHRemote/StartupView.swift ios/Checks/Startup.swift -o "$app/StartupCheck"
cp "$product/Assets.car" "$app/Assets.car"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.wangqiong.dsh-startup-view-check</string><key>CFBundleExecutable</key><string>StartupCheck</string><key>CFBundlePackageType</key><string>APPL</string><key>UILaunchScreen</key><dict/></dict></plist>
PLIST
xcrun simctl install "$device" "$app"
for mode in ${4:-dark light large compact landscape compact-large reduced}; do
  xcrun simctl ui "$device" appearance dark
  xcrun simctl ui "$device" content_size large
  if [ "$mode" = light ]; then xcrun simctl ui "$device" appearance light; fi
  if [ "$mode" = large ] || [ "$mode" = compact-large ]; then xcrun simctl ui "$device" content_size accessibility-extra-extra-extra-large; fi
  reduced=false
  if [ "$mode" = reduced ]; then reduced=true; fi
  xcrun simctl spawn "$device" defaults write com.apple.Accessibility ReduceMotionEnabled -bool "$reduced"
  xcrun simctl launch --terminate-running-process --console "$device" "$bundle" -case "$mode" \
    > "$output/$mode.log" 2> "$output/$mode.stderr.log" &
  launcher=$!
  attempts=0
  while ! rg -q '启动布局检查通过' "$output/$mode.log"; do
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
