#!/bin/sh
# Run against mock.mjs on port 18731; product supplies the real compiled image assets.
set -eu
device=${1:?需要模拟器 ID}
product=${2:?需要构建的 App 路径}
temporary=$(mktemp -d)
app="$temporary/LaunchCheck.app"
bundle=io.github.wangqiong.dsh-launch-check
trap 'xcrun simctl uninstall "$device" "$bundle" >/dev/null 2>&1 || true; rm -rf "$temporary"' EXIT
mkdir "$app"
xcrun --sdk iphonesimulator swiftc -parse-as-library \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target "$(uname -m)-apple-ios17.0-simulator" \
  ios/DSHRemote/RemoteViewController.swift ios/DSHRemote/PairingLink.swift \
  ios/DSHRemote/StartupView.swift ios/Checks/Launch.swift -o "$app/LaunchCheck"
cp "$product/Assets.car" "$app/Assets.car"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.wangqiong.dsh-launch-check</string><key>CFBundleExecutable</key><string>LaunchCheck</string><key>CFBundlePackageType</key><string>APPL</string><key>UILaunchScreen</key><dict/></dict></plist>
PLIST
for mode in slow fast script retry refused offline unpaired; do
  xcrun simctl uninstall "$device" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl install "$device" "$app"
  case "$mode" in
    slow) path='/startup?pair=ok';;
    script) path='/startup-script?pair=ok';;
    retry) path='/startup-retry?pair=ok';;
    refused) path='/';;
    *) path='/?pair=ok';;
  esac
  if [ "$mode" = unpaired ]; then
    xcrun simctl launch --console "$device" "$bundle" -case "$mode" > "$temporary/result" 2>&1
  else
    port=18731
    if [ "$mode" = offline ]; then port=18732; fi
    xcrun simctl launch --console "$device" "$bundle" -case "$mode" \
      -origin "http://127.0.0.1:$port$path" > "$temporary/result" 2>&1
  fi
  cat "$temporary/result"
  rg -q '启动动画检查通过' "$temporary/result"
done
