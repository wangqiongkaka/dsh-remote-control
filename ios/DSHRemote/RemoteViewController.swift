import AVFoundation
import UIKit
import VisionKit
import WebKit

/// UserDefaults key of the paired DSH Web origin; launching with `-origin <url>` overrides it.
private let originKey = "origin"

private final class RemoteWebView: WKWebView {
  // The page owns its composer; WebKit's form-navigation toolbar only consumes keyboard space.
  override var inputAccessoryView: UIView? { nil }
}

/// The page's drawer swipes ask for a light tap as they cross their release point (sidebar-swipe.ts).
private final class Haptics: NSObject, WKScriptMessageHandler {
  private let generator = UIImpactFeedbackGenerator(style: .light)

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.frameInfo.isMainFrame { generator.impactOccurred() }
  }
}

/// DSH Web full screen, signed in with the cookie the pairing link leaves in the default data store.
final class RemoteViewController: UIViewController {
  private let webView = RemoteWebView(frame: .zero, configuration: {
    let configuration = WKWebViewConfiguration()
    // Same engine as Safari, so identify as Safari: DSH enables its WebKit textarea repair by user agent.
    configuration.applicationNameForUserAgent = "Version/\(UIDevice.current.systemVersion) Mobile/15E148 Safari/604.1"
    configuration.userContentController.add(Haptics(), name: "haptic")
    return configuration
  }())
  private let panel = UIStackView()
  private let notice = UILabel()
  private let actions = UIStackView()
  private var downloads: [WKDownload: URL] = [:]
  /// The page that failed, so 重试 repeats it (an unused pairing link included) rather than going home.
  private var failed: URL?
  /// Sessions tapped in notifications, waiting for DSH Web to finish loading.
  private var tappedSessions: [String] = []
  private var origin: URL? {
    get { UserDefaults.standard.string(forKey: originKey).flatMap(URL.init(string:)) }
    set { UserDefaults.standard.set(newValue?.absoluteString, forKey: originKey) }
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    webView.navigationDelegate = self
    webView.uiDelegate = self
    // The page pads itself with env(safe-area-inset-*) and owns edge swipes for its sidebars.
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.allowsBackForwardNavigationGestures = false
    #if DEBUG
    webView.isInspectable = true
    #endif
    webView.frame = view.bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(webView)

    notice.numberOfLines = 0
    notice.textAlignment = .center
    notice.font = .preferredFont(forTextStyle: .body)
    notice.adjustsFontForContentSizeCategory = true
    actions.spacing = 12
    actions.distribution = .fillEqually
    panel.axis = .vertical
    panel.spacing = 16
    panel.addArrangedSubview(notice)
    panel.addArrangedSubview(actions)
    panel.isLayoutMarginsRelativeArrangement = true
    panel.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 20, leading: 20, bottom: 20, trailing: 20)
    panel.backgroundColor = .secondarySystemBackground
    panel.layer.cornerRadius = 16
    panel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(panel)
    let guide = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      panel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
      panel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
      panel.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
    ])

    if origin == nil {
      showPanel("在电脑的 DSH 里点击左侧栏底部的手机图标，扫描二维码完成配对。\n配对后，之前配对的手机浏览器会断开。")
    } else {
      open()
    }
  }

  private func open() {
    guard let origin else { return }
    panel.isHidden = true
    webView.load(URLRequest(url: origin))
  }

  /// A notification link: open its Session in DSH Web (the plugin's client reads the queue).
  func openLink(_ url: URL) {
    guard let id = sessionLinkId(url) else { return }
    tappedSessions.append(id)
    openTappedSessions()
  }

  private func openTappedSessions() {
    guard !tappedSessions.isEmpty, webView.url != nil, !webView.isLoading,
          let ids = try? JSONEncoder().encode(tappedSessions), let json = String(data: ids, encoding: .utf8)
    else { return }
    tappedSessions = []
    webView.evaluateJavaScript(
      "(window.__dshRemoteOpen ??= []).push(...\(json)); dispatchEvent(new Event('dsh-remote-open'))")
  }

  private func retry() {
    guard let url = failed ?? origin else { return }
    failed = nil
    panel.isHidden = true
    webView.load(URLRequest(url: url))
  }

  private func pair(_ link: String) {
    let link = link.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let origin = pairingOrigin(link), let url = URL(string: link) else {
      alert("不是配对链接", "请使用电脑远程控制弹窗里的二维码或链接。")
      return
    }
    self.origin = origin
    panel.isHidden = true
    webView.load(URLRequest(url: url))
  }

  /// The way back to pairing; `message` is nil when the page already explains what happened.
  private func showPanel(_ message: String?, retry: Bool = false) {
    notice.text = message
    notice.isHidden = message == nil
    actions.arrangedSubviews.forEach { $0.removeFromSuperview() }
    if retry { actions.addArrangedSubview(button("重试") { [weak self] in self?.retry() }) }
    if DataScannerViewController.isSupported {
      actions.addArrangedSubview(button("扫码配对") { [weak self] in self?.scan() })
    }
    actions.addArrangedSubview(button("粘贴链接") { [weak self] in self?.paste() })
    panel.isHidden = false
  }

  private func button(_ title: String, _ action: @escaping () -> Void) -> UIButton {
    UIButton(configuration: .filled(), primaryAction: UIAction(title: title) { _ in action() })
  }

  private func alert(_ title: String, _ message: String) {
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "好", style: .default))
    present(alert, animated: true)
  }

  private func scan() {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        guard granted, DataScannerViewController.isAvailable else {
          self.alert("无法使用相机", "请在系统设置里允许使用相机，或改用「粘贴链接」。")
          return
        }
        let scanner = DataScannerViewController(
          recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        scanner.delegate = self
        scanner.navigationItem.title = "扫描电脑上的配对二维码"
        scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
          systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        self.present(UINavigationController(rootViewController: scanner), animated: true) {
          try? scanner.startScanning()
        }
      }
    }
  }

  private func paste() {
    let prompt = UIAlertController(
      title: "粘贴配对链接", message: "在电脑的远程控制弹窗里复制链接，粘贴到这里。", preferredStyle: .alert)
    prompt.addTextField {
      $0.placeholder = "https://…/?pair=…"
      $0.keyboardType = .URL
      $0.autocapitalizationType = .none
      $0.autocorrectionType = .no
    }
    prompt.addAction(UIAlertAction(title: "取消", style: .cancel))
    prompt.addAction(UIAlertAction(title: "配对", style: .default) { [weak self, weak prompt] _ in
      self?.pair(prompt?.textFields?.first?.text ?? "")
    })
    present(prompt, animated: true)
  }
}

extension RemoteViewController: DataScannerViewControllerDelegate {
  func dataScanner(_ scanner: DataScannerViewController, didAdd added: [RecognizedItem], allItems: [RecognizedItem]) {
    for case .barcode(let code) in added {
      guard let link = code.payloadStringValue, pairingOrigin(link) != nil else { continue }
      scanner.stopScanning()
      dismiss(animated: true) { self.pair(link) }
      return
    }
  }
}

extension RemoteViewController: WKNavigationDelegate {
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    // Without an address bar, leaving DSH would strand the app: other sites open in their own app.
    if action.targetFrame?.isMainFrame == true, let url = action.request.url, let origin,
       !sameOrigin(url, origin), !["about", "blob", "data"].contains(url.scheme ?? "") {
      UIApplication.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if response.isForMainFrame {
      // The proxy marks refused pages; their text already says why, so only offer the way out.
      let refused = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-dsh-remote-control") != nil
      let status = (response.response as? HTTPURLResponse)?.statusCode ?? 200
      if refused {
        showPanel(nil)
      } else if status >= 500 {
        // The server's reverse proxy answers with an empty page while DSH or its tunnel is down.
        failed = response.response.url
        showPanel("电脑上的 DSH 没有响应（HTTP \(status)）。请确认 DSH 正在运行、远程控制已开启。", retry: true)
      } else {
        panel.isHidden = true
      }
    }
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    openTappedSessions()
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let error = error as NSError
    // Cancelled loads and loads turned into downloads are not connection failures.
    if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled || error.domain == "WebKitErrorDomain" {
      return
    }
    failed = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL
    showPanel("无法连接电脑上的 DSH：\(error.localizedDescription)\n请确认电脑在线并已开启远程控制。", retry: true)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if webView.url == nil { open() } else { webView.reload() }
  }
}

extension RemoteViewController: WKUIDelegate {
  /// DSH opens outside links with `window.open(url, '_blank', 'noopener')`.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    if let origin, sameOrigin(url, origin) { webView.load(action.request) } else { UIApplication.shared.open(url) }
    return nil
  }

  /// Voice input; iOS still asks the user once for the app's microphone.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(frame.isMainFrame && origin.host == self.origin?.host ? .grant : .prompt)
  }
}

extension RemoteViewController: WKDownloadDelegate {
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let file = folder.appendingPathComponent(suggestedFilename)
    downloads[download] = file
    completionHandler(file)
  }

  /// Hand the file to the share sheet: Save to Files, AirDrop or another app.
  func downloadDidFinish(_ download: WKDownload) {
    guard let file = downloads.removeValue(forKey: download) else { return }
    let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    share.popoverPresentationController?.sourceView = view
    present(share, animated: true)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: download)
    alert("下载失败", error.localizedDescription)
  }
}
