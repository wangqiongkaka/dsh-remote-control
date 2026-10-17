import UIKit

/// Covers only native-to-web loading; its lifetime belongs to navigation, never an animation timer.
final class StartupView: UIView {
  private let mark = UIView()
  private let whale = UIImageView(image: UIImage(named: "StartupWhale"))
  private let status = UILabel()
  private let ripples = [CAShapeLayer(), CAShapeLayer()]

  init() {
    super.init(frame: .zero)
    accessibilityIdentifier = "startup"
    accessibilityViewIsModal = true
    backgroundColor = .systemBackground
    isHidden = true

    whale.tintColor = .label
    whale.contentMode = .scaleAspectFit
    whale.translatesAutoresizingMaskIntoConstraints = false
    mark.addSubview(whale)
    for ripple in ripples {
      ripple.fillColor = UIColor.clear.cgColor
      ripple.strokeColor = UIColor.systemBlue.cgColor
      ripple.lineWidth = 1
      ripple.opacity = 0
      mark.layer.insertSublayer(ripple, at: 0)
    }
    let title = UILabel()
    title.text = "DeepSeek"
    title.font = .preferredFont(forTextStyle: .title1)
    title.adjustsFontForContentSizeCategory = true
    status.font = .preferredFont(forTextStyle: .subheadline)
    status.adjustsFontForContentSizeCategory = true
    status.textColor = .secondaryLabel
    status.numberOfLines = 0
    status.textAlignment = .center
    let content = UIStackView(arrangedSubviews: [mark, title, status])
    content.axis = .vertical
    content.alignment = .center
    content.spacing = 14
    content.setCustomSpacing(8, after: title)
    content.translatesAutoresizingMaskIntoConstraints = false
    addSubview(content)
    NSLayoutConstraint.activate([
      mark.widthAnchor.constraint(equalToConstant: 180),
      mark.heightAnchor.constraint(equalToConstant: 146),
      whale.widthAnchor.constraint(equalToConstant: 100),
      whale.heightAnchor.constraint(equalToConstant: 74),
      whale.centerXAnchor.constraint(equalTo: mark.centerXAnchor),
      whale.centerYAnchor.constraint(equalTo: mark.centerYAnchor, constant: -14),
      content.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
      content.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor, constant: -24),
      content.widthAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.widthAnchor, constant: -48),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    for ripple in ripples {
      ripple.frame = mark.bounds
      ripple.path = UIBezierPath(ovalIn: CGRect(x: 36, y: 112, width: 108, height: 18)).cgPath
    }
  }

  func start() {
    layer.removeAllAnimations()
    alpha = 1
    isHidden = false
    status.text = "正在连接你的电脑"
    whale.layer.removeAllAnimations()
    ripples.forEach { $0.removeAllAnimations() }
    guard !UIAccessibility.isReduceMotionEnabled else { return }

    let float = CABasicAnimation(keyPath: "transform.translation.y")
    float.fromValue = -3
    float.toValue = 3
    float.duration = 1.6
    float.autoreverses = true
    float.repeatCount = .infinity
    float.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    whale.layer.add(float, forKey: "float")
    for (index, ripple) in ripples.enumerated() {
      let scale = CABasicAnimation(keyPath: "transform.scale")
      scale.fromValue = 0.8
      scale.toValue = 1.35
      scale.duration = 2.8
      let opacity = CAKeyframeAnimation(keyPath: "opacity")
      opacity.values = [0, 0.24, 0]
      opacity.keyTimes = [0, 0.2, 1]
      opacity.duration = 2.8
      let wave = CAAnimationGroup()
      wave.animations = [scale, opacity]
      wave.duration = 2.8
      wave.repeatCount = .infinity
      wave.beginTime = CACurrentMediaTime() + Double(index) * 1.4
      ripple.add(wave, forKey: "wave")
    }
  }

  func opening() { status.text = "正在打开工作区" }

  func finish(animated: Bool = true) {
    guard !isHidden else { return }
    whale.layer.removeAllAnimations()
    ripples.forEach { $0.removeAllAnimations() }
    guard animated && !UIAccessibility.isReduceMotionEnabled else {
      isHidden = true
      return
    }
    UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
      self.alpha = 0
    } completion: { completed in
      if completed { self.isHidden = true }
    }
  }
}
