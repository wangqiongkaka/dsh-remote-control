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
    controller.view.layoutIfNeeded()
    let wordmark = descendant(in: splash!, identifier: "startup-wordmark") as? UIImageView
    precondition(wordmark?.image != nil, "启动页未使用本地 deepseek 矢量字标")
    let dots = descendant(in: splash!, identifier: "startup-dots") as? UIStackView
    precondition(dots?.arrangedSubviews.count == 3, "启动页缺少三颗连接光点")
    let status = descendant(in: splash!, identifier: "startup-status") as? UILabel
    precondition(status?.text == "正在连接你的电脑", "启动连接状态不正确")
    let whale = image(in: splash!)
    precondition(whale?.image != nil, "启动鲸鱼图片未加载")
    precondition((whale!.layer.animationKeys()?.isEmpty ?? true) == UIAccessibility.isReduceMotionEnabled,
                 "启动动画未遵从减少动态效果设置")
    let web = controller.view.subviews.compactMap { $0 as? WKWebView }.first!
    started = Date()
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [self] _ in
      let elapsed = Date().timeIntervalSince(started)
      precondition(elapsed < 12, "启动动画未能结束")
      let retry = button(in: controller.view, title: "重试")
      if mode == "server", let retry {
        precondition(splash!.isHidden, "错误页被启动动画遮挡")
        let failure = controller.view.subviews.first { $0.accessibilityIdentifier == "connection-failure" }
        precondition(failure != nil && !failure!.isHidden, "HTTP 502 未显示完整连接失败页")
        let detail = descendant(in: failure!, identifier: "connection-detail") as? UILabel
        precondition(detail?.text == "HTTP 502", "错误页未显示真实 HTTP 状态")
        let paste = button(in: failure!, title: "粘贴链接")!
        let main = retry.convert(retry.bounds, to: controller.view)
        let secondary = paste.convert(paste.bounds, to: controller.view)
        precondition(main.maxY < secondary.minY, "重试主按钮必须位于配对操作上方")
        precondition(main.height >= 52 && secondary.height >= 44, "错误页按钮触摸区过小")
        precondition(main.width >= secondary.width, "重试主按钮宽度不正确")
        if !retried {
          retried = true
          retry.sendActions(for: .primaryActionTriggered)
          precondition(!splash!.isHidden, "HTTP 错误重试未显示加载动画")
          return
        }
        guard !web.isLoading else { return }
        precondition(web.url?.path == "/server-error", "重试未重复原失败地址")
        paste.sendActions(for: .primaryActionTriggered)
        precondition((controller.presentedViewController as? UIAlertController)?.textFields?.count == 1,
                     "粘贴链接未打开原配对输入框")
        complete(mode)
        return
      }
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
        if mode == "script", elapsed > 1 {
          precondition(status?.text == "正在打开工作区", "慢脚本加载时未切换打开工作区状态")
        }
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

  private func button(in view: UIView, title: String) -> UIButton? {
    if view.isHidden { return nil }
    if let button = view as? UIButton, (button.configuration?.title ?? button.currentTitle) == title { return button }
    return view.subviews.lazy.compactMap { self.button(in: $0, title: title) }.first
  }

  private func descendant(in view: UIView, identifier: String) -> UIView? {
    if view.accessibilityIdentifier == identifier { return view }
    return view.subviews.lazy.compactMap { self.descendant(in: $0, identifier: identifier) }.first
  }
}
