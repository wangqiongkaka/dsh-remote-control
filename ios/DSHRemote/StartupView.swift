import UIKit

/// Covers only native-to-web loading; its lifetime belongs to navigation, never an animation timer.
final class StartupView: UIView {
  private let mark = UIView()
  private let whale = UIImageView(image: UIImage(named: "StartupWhale"))
  private let wordmark = UIImageView(image: UIImage(named: "StartupWordmark"))
  private let status = UILabel()
  private let tagline = UILabel()
  private let dots = (0..<3).map { _ in UIView() }
  private let dotsRow = UIStackView()

  init() {
    super.init(frame: .zero)
    accessibilityIdentifier = "startup"
    accessibilityViewIsModal = true
    backgroundColor = Self.color(0xfafaf9, 0x0b0c0e)
    isHidden = true

    whale.accessibilityIdentifier = "startup-whale"
    whale.tintColor = Self.color(0x15171a, 0xf2f3f5)
    whale.contentMode = .scaleAspectFit
    whale.translatesAutoresizingMaskIntoConstraints = false
    mark.addSubview(whale)
    wordmark.accessibilityIdentifier = "startup-wordmark"
    wordmark.isAccessibilityElement = true
    wordmark.accessibilityLabel = "DeepSeek"
    wordmark.tintColor = whale.tintColor
    wordmark.contentMode = .scaleAspectFit
    status.accessibilityIdentifier = "startup-status"
    status.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .systemFont(ofSize: 13))
    status.adjustsFontForContentSizeCategory = true
    status.textColor = Self.color(0x737984, 0x8a9099)
    status.numberOfLines = 0
    status.textAlignment = .center
    dotsRow.accessibilityIdentifier = "startup-dots"
    dotsRow.spacing = 6
    for dot in dots {
      dot.backgroundColor = UIColor(red: 77 / 255, green: 107 / 255, blue: 254 / 255, alpha: 1)
      dot.layer.cornerRadius = 2
      dot.layer.opacity = 0.35
      dotsRow.addArrangedSubview(dot)
      NSLayoutConstraint.activate([
        dot.widthAnchor.constraint(equalToConstant: 4),
        dot.heightAnchor.constraint(equalToConstant: 4),
      ])
    }
    tagline.accessibilityIdentifier = "startup-tagline"
    tagline.text = "你的工作区，随时在手边"
    tagline.font = UIFontMetrics(forTextStyle: .caption2).scaledFont(for: .systemFont(ofSize: 11))
    tagline.adjustsFontForContentSizeCategory = true
    tagline.textColor = Self.color(0x8b9099, 0x515760)
    tagline.numberOfLines = 0
    tagline.textAlignment = .center
    let content = UIStackView(arrangedSubviews: [mark, wordmark, status, dotsRow])
    content.axis = .vertical
    content.alignment = .center
    content.setCustomSpacing(24, after: mark)
    content.setCustomSpacing(16, after: wordmark)
    content.setCustomSpacing(18, after: status)
    for view in [content, tagline] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
    }
    let center = content.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -28)
    center.priority = .defaultHigh
    let footer = tagline.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -30)
    footer.priority = .defaultHigh
    NSLayoutConstraint.activate([
      mark.widthAnchor.constraint(equalToConstant: 96),
      mark.heightAnchor.constraint(equalToConstant: 72),
      whale.leadingAnchor.constraint(equalTo: mark.leadingAnchor),
      whale.trailingAnchor.constraint(equalTo: mark.trailingAnchor),
      whale.topAnchor.constraint(equalTo: mark.topAnchor),
      whale.bottomAnchor.constraint(equalTo: mark.bottomAnchor),
      wordmark.widthAnchor.constraint(equalToConstant: 160),
      wordmark.heightAnchor.constraint(equalToConstant: 29),
      status.heightAnchor.constraint(greaterThanOrEqualToConstant: 18),
      status.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor),
      content.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
      content.widthAnchor.constraint(equalTo: safeAreaLayoutGuide.widthAnchor, constant: -48),
      content.topAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.topAnchor, constant: 16),
      tagline.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      tagline.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      tagline.topAnchor.constraint(greaterThanOrEqualTo: content.bottomAnchor, constant: 24),
      tagline.bottomAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor, constant: -16),
      center, footer,
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private static func color(_ light: UInt32, _ dark: UInt32) -> UIColor {
    UIColor { trait in
      let hex = trait.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((hex >> 16) & 255) / 255,
                     green: CGFloat((hex >> 8) & 255) / 255,
                     blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
  }

  private func stopAnimations() {
    for view in [self, mark, whale, wordmark, status, dotsRow, tagline] + dots {
      view.layer.removeAllAnimations()
    }
  }

  func start() {
    stopAnimations()
    alpha = 1
    transform = .identity
    isHidden = false
    status.text = "正在连接你的电脑"
    guard !UIAccessibility.isReduceMotionEnabled else { return }

    let now = CACurrentMediaTime()
    let entrances: [(UIView, Double, Double, CGFloat)] = [
      (mark, 0, 0.55, 6), (wordmark, 0.12, 0.55, 6),
      (status, 0.24, 0.4, 0), (dotsRow, 0.24, 0.4, 0), (tagline, 0.3, 0.55, 0),
    ]
    for (view, delay, duration, offset) in entrances {
      let opacity = CABasicAnimation(keyPath: "opacity")
      opacity.fromValue = 0
      opacity.toValue = 1
      let move = CABasicAnimation(keyPath: "transform.translation.y")
      move.fromValue = offset
      move.toValue = 0
      let entrance = CAAnimationGroup()
      entrance.animations = [opacity, move]
      entrance.duration = duration
      entrance.beginTime = now + delay
      entrance.fillMode = .backwards
      entrance.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.7, 0.3, 1)
      view.layer.add(entrance, forKey: "entrance")
    }
    let float = CAKeyframeAnimation(keyPath: "transform.translation.y")
    float.values = [0, -2, 0]
    float.keyTimes = [0, 0.5, 1]
    float.duration = 2.4
    float.beginTime = now + 0.55
    float.repeatCount = .infinity
    float.timingFunctions = [CAMediaTimingFunction(name: .easeInEaseOut), CAMediaTimingFunction(name: .easeInEaseOut)]
    whale.layer.add(float, forKey: "float")
    for (index, dot) in dots.enumerated() {
      let pulse = CAKeyframeAnimation(keyPath: "opacity")
      pulse.values = [0.35, 1, 0.35, 0.35]
      pulse.keyTimes = [0, 0.35, 0.7, 1]
      pulse.duration = 1.5
      pulse.beginTime = now + Double(index) * 0.18
      pulse.repeatCount = .infinity
      pulse.fillMode = .backwards
      pulse.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: 3)
      dot.layer.add(pulse, forKey: "pulse")
    }
  }

  func opening() { status.text = "正在打开工作区" }

  func finish(animated: Bool = true) {
    guard !isHidden else { return }
    stopAnimations()
    guard animated && !UIAccessibility.isReduceMotionEnabled else {
      isHidden = true
      return
    }
    UIView.animate(withDuration: 0.24, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
      self.alpha = 0
      self.transform = CGAffineTransform(translationX: 0, y: -2)
    } completion: { completed in
      if completed { self.isHidden = true }
    }
  }
}
