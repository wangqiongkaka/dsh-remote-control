import UIKit
import WebKit

// Simulator-only check app; compile with RemoteViewController.swift and PairingLink.swift.
@main
final class KeyboardCheck: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var timer: Timer?
  private var attempts = 0
  private var keyboardVisible = false

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = RemoteViewController()
    window.makeKeyAndVisible()
    self.window = window
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { [self] _ in
      keyboardVisible = true
    }
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [self] _ in
      attempts += 1
      precondition(attempts < 40, "网页输入框未能唤起键盘")
      guard let webView = window.rootViewController?.view.subviews.compactMap({ $0 as? WKWebView }).first,
            !webView.isLoading else { return }
      webView.evaluateJavaScript("document.querySelector('textarea')?.focus()")
      guard keyboardVisible else { return }
      guard let responder = firstResponder(in: webView), responder !== webView else { return }
      timer?.invalidate()
      // Check the actual focused WebKit responder, not just the web view's override.
      precondition(responder.inputAccessoryView == nil, "网页键盘仍有表单辅助栏")
      webView.evaluateJavaScript("document.execCommand('insertText', false, '键盘输入检查'); document.activeElement.value") { value, error in
        precondition(error == nil && value as? String == "键盘输入检查", "网页输入框无法编辑")
        print("keyboard accessory checks passed")
        fflush(stdout)
      }
    }
    return true
  }

  private func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    return view.subviews.lazy.compactMap { self.firstResponder(in: $0) }.first
  }
}
