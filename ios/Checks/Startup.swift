import UIKit

/// Exercise the production startup view without changing the installed App's pairing.
@main
final class StartupCheck: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    let mode = UserDefaults.standard.string(forKey: "case") ?? "dark"
    let startup = StartupView()
    startup.frame = mode.hasPrefix("compact") ? CGRect(x: 0, y: 0, width: 320, height: 568)
      : mode == "landscape" ? CGRect(x: 0, y: 0, width: 740, height: 320) : controller.view.bounds
    controller.view.addSubview(startup)
    startup.start()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [self] in
      controller.view.layoutIfNeeded()
      let views = descendants(startup)
      let wordmark = views.first { $0.accessibilityIdentifier == "startup-wordmark" } as! UIImageView
      let whale = views.first { $0.accessibilityIdentifier == "startup-whale" } as! UIImageView
      let status = views.first { $0.accessibilityIdentifier == "startup-status" } as! UILabel
      let tagline = views.first { $0.accessibilityIdentifier == "startup-tagline" } as! UILabel
      let dots = views.first { $0.accessibilityIdentifier == "startup-dots" } as! UIStackView
      precondition(wordmark.image != nil && whale.image != nil, "启动品牌矢量资源未加载")
      precondition(wordmark.accessibilityLabel == "DeepSeek", "字标缺少可访问名称")
      precondition(wordmark.bounds.size == CGSize(width: 160, height: 29), "字标尺寸不符合设计")
      precondition(whale.bounds.size == CGSize(width: 96, height: 72), "鲸鱼尺寸不符合设计")
      precondition(dots.arrangedSubviews.count == 3, "连接光点数量不正确")
      for view in [wordmark, whale, status, tagline, dots] {
        precondition(startup.bounds.contains(view.convert(view.bounds, to: startup)), "启动内容超出可见区域")
      }
      precondition(tagline.frame.minY >= dots.convert(dots.bounds, to: startup).maxY + 24, "底部说明与主体重叠")
      if mode == "large" || mode == "compact-large" {
        precondition(status.font.pointSize > 25, "未验证动态大字体")
      }
      let reduced = UIAccessibility.isReduceMotionEnabled
      if mode == "reduced" { precondition(reduced, "模拟器未启用减少动态效果") }
      precondition((whale.layer.animationKeys()?.isEmpty ?? true) == reduced, "鲸鱼动画未遵从减少动态效果")
      for dot in dots.arrangedSubviews {
        precondition((dot.layer.animationKeys()?.isEmpty ?? true) == reduced, "光点动画未遵从减少动态效果")
      }
      startup.opening()
      precondition(status.text == "正在打开工作区", "状态未切换到打开工作区")
      startup.finish(animated: false)
      precondition(startup.isHidden, "失败退出必须立即隐藏")
      startup.start()
      precondition(status.text == "正在连接你的电脑", "重试没有恢复连接状态")
      startup.finish()
      startup.start()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
        precondition(!startup.isHidden && startup.alpha == 1 && startup.transform == .identity,
                     "重播被旧的退出动画隐藏")
        startup.finish()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
          precondition(startup.isHidden, "加载完成后启动画面未及时退出")
          precondition(views.allSatisfy { $0.layer.animationKeys()?.isEmpty ?? true }, "隐藏后仍保留动画")
          startup.start()
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            print("启动布局检查通过：\(mode)，减少动态 \(reduced)，\(startup.bounds.size)")
            fflush(stdout)
          }
        }
      }
    }
    return true
  }

  private func descendants(_ view: UIView) -> [UIView] {
    [view] + view.subviews.flatMap(descendants)
  }
}
