import UIKit

/// The native recovery screen; the WebView and pairing panel keep their own lifetimes.
final class ConnectionFailureView: UIView {
  private enum Palette {
    static let background = color(0xf9fafb, 0x0b0c0e)
    static let surface = color(0xffffff, 0x17181b)
    static let hint = color(0xf3f4f6, 0x121316)
    static let foreground = color(0x0f1115, 0xf2f3f5)
    static let secondary = color(0x61666b, 0x9a9fa6)
    static let muted = color(0x737982, 0x7d828a)
    static let border = color(0xdde0e3, 0x2a2c30)
    static let blue = color(0x007aff, 0x0a84ff)

    private static func color(_ light: UInt32, _ dark: UInt32) -> UIColor {
      UIColor { trait in
        let hex = trait.userInterfaceStyle == .dark ? dark : light
        return UIColor(red: CGFloat((hex >> 16) & 255) / 255,
                       green: CGFloat((hex >> 8) & 255) / 255,
                       blue: CGFloat(hex & 255) / 255, alpha: 1)
      }
    }
  }

  private let detail = UILabel()
  private let iconBox = UIView()
  private let hint = UIView()

  init(retry: UIAction, scan: UIAction?, paste: UIAction) {
    super.init(frame: .zero)
    accessibilityIdentifier = "connection-failure"
    accessibilityViewIsModal = true
    backgroundColor = Palette.background
    isHidden = true

    let header = Self.label("DeepSeek · 远程控制", size: 14, weight: .medium, color: Palette.secondary)
    header.textAlignment = .center
    header.numberOfLines = 1
    header.adjustsFontSizeToFitWidth = true
    header.minimumScaleFactor = 0.5
    let scroll = UIScrollView()
    scroll.showsVerticalScrollIndicator = false
    let content = UIView()
    let body = UIStackView()
    body.axis = .vertical

    let iconSeat = UIView()
    iconBox.backgroundColor = Palette.surface
    iconBox.layer.cornerRadius = 18
    iconBox.layer.borderWidth = 1
    iconBox.layer.borderColor = Palette.border.cgColor
    let computer = UIImageView(image: UIImage(named: "ErrorComputer"))
    computer.contentMode = .scaleAspectFit
    iconSeat.addSubview(iconBox)
    iconBox.addSubview(computer)
    for view in [iconBox, computer] { view.translatesAutoresizingMaskIntoConstraints = false }
    NSLayoutConstraint.activate([
      iconSeat.heightAnchor.constraint(equalToConstant: 64),
      iconBox.leadingAnchor.constraint(equalTo: iconSeat.leadingAnchor),
      iconBox.topAnchor.constraint(equalTo: iconSeat.topAnchor),
      iconBox.widthAnchor.constraint(equalToConstant: 64),
      iconBox.heightAnchor.constraint(equalToConstant: 64),
      computer.centerXAnchor.constraint(equalTo: iconBox.centerXAnchor),
      computer.centerYAnchor.constraint(equalTo: iconBox.centerYAnchor),
      computer.widthAnchor.constraint(equalToConstant: 30),
      computer.heightAnchor.constraint(equalToConstant: 30),
    ])

    let title = Self.label("暂时无法连接电脑", size: 24, weight: .semibold, color: Palette.foreground, style: .title2)
    title.accessibilityTraits = .header
    let description = Self.label("请确认电脑上的 DSH 正在运行，并已开启远程控制。", size: 15, color: Palette.secondary)
    detail.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .systemFont(ofSize: 13))
    detail.adjustsFontForContentSizeCategory = true
    detail.numberOfLines = 0
    detail.textColor = Palette.muted
    detail.accessibilityIdentifier = "connection-detail"
    let status = UIStackView(arrangedSubviews: [Self.icon("ErrorWarning", size: 16, color: Palette.muted), detail])
    status.alignment = .center
    status.spacing = 6

    hint.backgroundColor = Palette.hint
    hint.layer.cornerRadius = 14
    hint.layer.borderWidth = 1
    hint.layer.borderColor = Palette.border.cgColor
    let note = Self.label("需要重新配对时，请扫码或粘贴电脑端提供的新链接。新配对会替换电脑端之前授权的手机浏览器或 App，旧配对随即失效。",
                          size: 13, color: Palette.secondary, style: .footnote)
    let hintRow = UIStackView(arrangedSubviews: [Self.icon("ErrorInfo", size: 18, color: Palette.muted), note])
    hintRow.alignment = .top
    hintRow.spacing = 12
    hintRow.translatesAutoresizingMaskIntoConstraints = false
    hint.addSubview(hintRow)
    NSLayoutConstraint.activate([
      hintRow.topAnchor.constraint(equalTo: hint.topAnchor, constant: 16),
      hintRow.bottomAnchor.constraint(equalTo: hint.bottomAnchor, constant: -16),
      hintRow.leadingAnchor.constraint(equalTo: hint.leadingAnchor, constant: 16),
      hintRow.trailingAnchor.constraint(equalTo: hint.trailingAnchor, constant: -16),
    ])
    for view in [iconSeat, title, description, status, hint] { body.addArrangedSubview(view) }
    body.setCustomSpacing(24, after: iconSeat)
    body.setCustomSpacing(12, after: title)
    body.setCustomSpacing(16, after: description)
    body.setCustomSpacing(32, after: status)

    let primary = Self.button("重试", primary: true, action: retry)
    let secondary = UIStackView()
    secondary.spacing = 12
    secondary.distribution = .fillEqually
    if let scan { secondary.addArrangedSubview(Self.button("扫码配对", image: "ErrorQR", action: scan)) }
    secondary.addArrangedSubview(Self.button("粘贴链接", image: "ErrorLink", action: paste))
    let footer = UIStackView(arrangedSubviews: [primary, secondary])
    footer.axis = .vertical
    footer.spacing = 12

    for view in [header, scroll, footer] { addSubview(view); view.translatesAutoresizingMaskIntoConstraints = false }
    scroll.addSubview(content)
    content.addSubview(body)
    content.translatesAutoresizingMaskIntoConstraints = false
    body.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
      header.heightAnchor.constraint(equalToConstant: 44),
      header.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
      header.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
      footer.leadingAnchor.constraint(equalTo: header.leadingAnchor),
      footer.trailingAnchor.constraint(equalTo: header.trailingAnchor),
      footer.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
      scroll.topAnchor.constraint(equalTo: header.bottomAnchor),
      scroll.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -16),
      scroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor),
      content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
      content.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),
      body.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
      body.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
      body.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -4),
      body.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: 24),
      body.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -32),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let border = Palette.border.resolvedColor(with: traitCollection).cgColor
    iconBox.layer.borderColor = border
    hint.layer.borderColor = border
  }

  func show(_ message: String) {
    detail.text = message
    isHidden = false
  }

  private static func label(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular,
                            color: UIColor, style: UIFont.TextStyle = .body) -> UILabel {
    let label = UILabel()
    label.text = text
    label.font = UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    label.adjustsFontForContentSizeCategory = true
    label.textColor = color
    label.numberOfLines = 0
    return label
  }

  private static func icon(_ name: String, size: CGFloat, color: UIColor) -> UIImageView {
    let view = UIImageView(image: UIImage(named: name)?.withRenderingMode(.alwaysTemplate))
    view.tintColor = color
    view.contentMode = .scaleAspectFit
    view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([view.widthAnchor.constraint(equalToConstant: size), view.heightAnchor.constraint(equalToConstant: size)])
    return view
  }

  private static func button(_ title: String, image: String? = nil, primary: Bool = false, action: UIAction) -> UIButton {
    var config = UIButton.Configuration.filled()
    config.title = title
    config.baseBackgroundColor = primary ? Palette.blue : Palette.surface
    config.baseForegroundColor = primary ? .white : Palette.foreground
    config.cornerStyle = .fixed
    config.background.cornerRadius = 14
    config.background.strokeWidth = primary ? 0 : 1
    config.background.strokeColor = Palette.border
    config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 12, bottom: 14, trailing: 12)
    config.titleLineBreakMode = .byWordWrapping
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: primary ? 17 : 15, weight: primary ? .semibold : .medium))
      return attributes
    }
    if let image, let asset = UIImage(named: image) {
      config.image = UIGraphicsImageRenderer(size: CGSize(width: 18, height: 18)).image { _ in
        asset.draw(in: CGRect(x: 0, y: 0, width: 18, height: 18))
      }.withRenderingMode(.alwaysTemplate)
      config.imagePadding = 6
    }
    let button = UIButton(configuration: config)
    button.addAction(action, for: .primaryActionTriggered)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: primary ? 52 : 48).isActive = true
    return button
  }
}
