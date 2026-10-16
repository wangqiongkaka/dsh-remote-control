import UIKit

/// UIKit lifecycle, deliberately not SwiftUI: hosting the web view in a SwiftUI `WindowGroup` crashed
/// the app on iOS 26 (`-[UIGestureRecognizer _delayTouchesForEvent:inPhase:]` inserting nil) when
/// a tap reached a focused text field, as when typing a message and tapping send.
@main
final class DSHRemoteApp: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private let remote = RemoteViewController()

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    window.rootViewController = remote
    window.makeKeyAndVisible()
    self.window = window
    // A notification tap that launches the app arrives here rather than in openURLContexts.
    options.urlContexts.forEach { remote.openLink($0.url) }
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    contexts.forEach { remote.openLink($0.url) }
  }
}
