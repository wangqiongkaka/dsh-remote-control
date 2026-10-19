import UIKit

/// Render the production view with all actions, including the scanner unavailable in Simulator.
@main
final class ConnectionCheck: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var picked: [String] = []

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    let failure = ConnectionFailureView(
      retry: UIAction { [self] _ in picked.append("重试") },
      scan: UIAction { [self] _ in picked.append("扫码配对") },
      paste: UIAction { [self] _ in picked.append("粘贴链接") })
    let mode = UserDefaults.standard.string(forKey: "case") ?? "dark"
    failure.frame = mode == "compact" ? CGRect(x: 0, y: 0, width: 320, height: 568)
      : mode == "landscape" ? CGRect(x: 0, y: 0, width: 740, height: 320) : controller.view.bounds
    controller.view.addSubview(failure)
    failure.show("HTTP 502")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [self] in
      controller.view.layoutIfNeeded()
      let views = descendants(failure)
      let buttons = views.compactMap { $0 as? UIButton }
      precondition(buttons.count == 3, "错误页缺少恢复操作")
      precondition(buttons.map { $0.configuration?.title ?? $0.currentTitle ?? "" } == ["重试", "扫码配对", "粘贴链接"],
                   "按钮配置标题不匹配")
      for button in buttons {
        let rect = button.convert(button.bounds, to: failure)
        precondition(failure.bounds.contains(rect), "恢复按钮超出可见区域")
        precondition(rect.height >= 44, "按钮触区过小")
        button.sendActions(for: .primaryActionTriggered)
      }
      precondition(picked == ["重试", "扫码配对", "粘贴链接"], "恢复按钮未触发对应动作")
      let labels = views.compactMap { $0 as? UILabel }
      if mode == "large" {
        precondition(labels.contains { $0.font.pointSize > 30 }, "未验证大字体")
      }
      let scroll = views.compactMap { $0 as? UIScrollView }.first!
      if mode == "large" || mode == "compact" || mode == "landscape" {
        precondition(scroll.contentSize.height > scroll.bounds.height, "紧凑布局的错误说明不可滚动")
        scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
      }
      for name in ["ErrorComputer", "ErrorWarning", "ErrorInfo", "ErrorQR", "ErrorLink"] {
        precondition(UIImage(named: name) != nil, "设计图标未加载：\(name)")
      }
      print("错误页布局检查通过：\(mode)，\(failure.bounds.size)")
      fflush(stdout)
    }
    return true
  }

  private func descendants(_ view: UIView) -> [UIView] {
    [view] + view.subviews.flatMap(descendants)
  }
}
