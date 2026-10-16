import SwiftUI

@main
struct DSHRemoteApp: App {
  private let remote = RemoteViewController()

  var body: some Scene {
    WindowGroup {
      Remote(controller: remote).ignoresSafeArea().onOpenURL { remote.openLink($0) }
    }
  }
}

private struct Remote: UIViewControllerRepresentable {
  let controller: RemoteViewController
  func makeUIViewController(context: Context) -> RemoteViewController { controller }
  func updateUIViewController(_ controller: RemoteViewController, context: Context) {}
}
