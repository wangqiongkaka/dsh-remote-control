import SwiftUI

@main
struct DSHRemoteApp: App {
  var body: some Scene {
    WindowGroup { Remote().ignoresSafeArea() }
  }
}

private struct Remote: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> RemoteViewController { RemoteViewController() }
  func updateUIViewController(_ controller: RemoteViewController, context: Context) {}
}
