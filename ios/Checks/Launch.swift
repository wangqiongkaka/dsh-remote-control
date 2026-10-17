import UIKit
import WebKit

// Simulator-only checks, compiled with the production controller and its views.
@main
final class LaunchCheck: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var timer: Timer?
  private var started = Date()
  private var finished: Date?
  private var retried = false

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = RemoteViewController()
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    let mode = UserDefaults.standard.string(forKey: "case") ?? "slow"
    let splash = controller.view.subviews.first { $0.accessibilityIdentifier == "startup" }
    if mode == "unpaired" {
      precondition(splash == nil || splash!.isHidden, "未配对时不应遮挡配对入口")
      complete(mode)
      return true
    }
    precondition(splash != nil && !splash!.isHidden, "开始加载时未显示启动动画")
    let whale = image(in: splash!)
    precondition(whale?.image != nil, "启动鲸鱼图片未加载")
    precondition((whale!.layer.animationKeys()?.isEmpty ?? true) == UIAccessibility.isReduceMotionEnabled,
                 "启动动画未遵从减少动态效果设置")
    let web = controller.view.subviews.compactMap { $0 as? WKWebView }.first!
    started = Date()
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [self] _ in
      let elapsed = Date().timeIntervalSince(started)
      precondition(elapsed < 12, "启动动画未能结束")
      let retry = controller.view.subviews.compactMap { $0 as? UIStackView }.first?
        .arrangedSubviews.compactMap { $0 as? UIStackView }.flatMap { $0.arrangedSubviews }
        .compactMap { $0 as? UIButton }.first { $0.currentTitle == "重试" }
      if mode == "offline", let retry, !retry.superview!.superview!.isHidden {
        precondition(splash!.isHidden, "连接失败提示被启动动画遮挡")
        complete(mode)
        return
      }
      if mode == "retry", !retried, let retry, retry.window != nil, !retry.superview!.superview!.isHidden {
        precondition(splash!.isHidden, "错误提示被启动动画遮挡")
        retried = true
        retry.sendActions(for: .primaryActionTriggered)
        precondition(!splash!.isHidden, "重试未重新显示加载动画")
        return
      }
      if mode == "refused", !splash!.isHidden { return }
      if mode == "refused" { complete(mode); return }
      if web.isLoading {
        precondition(!splash!.isHidden, "页面加载结束前启动动画已消失")
        return
      }
      if finished == nil { finished = Date() }
      precondition(Date().timeIntervalSince(finished!) < 0.9, "加载完成后仍强制等待启动动画")
      guard splash!.isHidden else { return }
      if mode == "slow" || mode == "script" {
        precondition(elapsed >= 2.8, "慢加载未持续显示启动画面")
      }
      if mode == "retry" { precondition(retried, "未验证错误后的重试") }
      if mode == "fast" { precondition(elapsed < 2.5, "快加载被人为延长") }
      complete(mode)
    }
    return true
  }

  private func complete(_ mode: String) {
    timer?.invalidate()
    print("启动动画检查通过：\(mode)，耗时 \(Date().timeIntervalSince(started)) 秒")
    fflush(stdout)
    exit(0)
  }

  private func image(in view: UIView) -> UIImageView? {
    if let image = view as? UIImageView { return image }
    return view.subviews.lazy.compactMap { self.image(in: $0) }.first
  }
}
