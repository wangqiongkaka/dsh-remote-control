"""Record a built simulator app against /startup and reject a white empty-page canvas."""
import pathlib
import plistlib
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time

device, product, origin, destination = sys.argv[1:]
output = pathlib.Path(destination).resolve()
output.mkdir(parents=True, exist_ok=True)
video = str(output / "startup.mp4")


def run(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


with tempfile.TemporaryDirectory() as temporary:
    app = pathlib.Path(temporary) / "StartupCheck.app"
    shutil.copytree(product, app)
    info = app / "Info.plist"
    metadata = plistlib.loads(info.read_bytes())
    bundle = metadata["CFBundleIdentifier"] + ".startup-check"
    metadata["CFBundleIdentifier"] = bundle
    info.write_bytes(plistlib.dumps(metadata))
    # The separate bundle keeps pairing data in the installed app untouched.
    subprocess.run(["xcrun", "simctl", "uninstall", device, bundle], capture_output=True)
    try:
        run("xcrun", "simctl", "ui", device, "appearance", "dark")
        run("xcrun", "simctl", "install", device, str(app))
        run("xcrun", "simctl", "launch", device, bundle, "-origin", origin)
        time.sleep(5)
        recording = subprocess.Popen(
            ["xcrun", "simctl", "io", device, "recordVideo", "--codec=h264", "--force", video],
            stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                ready, _, _ = select.select([recording.stderr], [], [], 1)
                if ready and "Recording started" in recording.stderr.readline():
                    break
            else:
                raise RuntimeError("模拟器录屏未开始")
            run("xcrun", "simctl", "launch", "--terminate-running-process", device, bundle, "-origin", origin)
            time.sleep(5)
        finally:
            recording.send_signal(signal.SIGINT)
            recording.communicate(timeout=20)
        assert recording.returncode == 0, "录屏未完成"
        raw = run("ffmpeg", "-v", "error", "-i", video, "-vf", "crop=iw/2:ih/2:iw/4:ih/4,scale=1:1",
                  "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-")
        levels = [sum(raw[i:i + 3]) / 765 for i in range(0, len(raw), 3)]
        assert levels, "录屏没有有效画面"
        peak = max(range(len(levels)), key=levels.__getitem__)
        run("ffmpeg", "-v", "error", "-y", "-i", video, "-vf", f"select=eq(n\\,{peak})",
            "-vsync", "0", "-frames:v", "1", str(output / "brightest.png"))
        run("xcrun", "simctl", "io", device, "screenshot", str(output / "loaded.png"))
        print(f"启动录屏：{len(levels)} 帧，白帧 {sum(value > .85 for value in levels)}，最高亮度 {max(levels):.3f}")
        assert max(levels) < .85, "深色模式启动时仍出现大面积白色画面"
    finally:
        subprocess.run(["xcrun", "simctl", "uninstall", device, bundle], capture_output=True)
