// D131, the phishing guard's page: the whole screen (D135), over the shell (never instead of it), with Close. "Go back"
// is the first choice; "Open anyway" opens that host for the rest of this run only.
import UIKit

@MainActor
final class PhishWarning: UIViewController {
  /** Hosts the person chose to open anyway, this run only. */
  static var openedAnyway: Set<String> = []

  private let brand: String
  private let answer: (Bool) -> Void
  private var answered = false

  init(brand: String, answer: @escaping (Bool) -> Void) {
    self.brand = brand
    self.answer = answer
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .overFullScreen
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let close = UIButton(type: .system)
    close.setTitle("Close", for: .normal)
    close.titleLabel?.font = .systemFont(ofSize: 17)
    close.setTitleColor(.label, for: .normal)
    close.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
    close.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(close)

    let mark = UIImageView(image: UIImage(systemName: "exclamationmark.shield.fill"))
    mark.tintColor = .systemRed
    mark.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)
    mark.contentMode = .scaleAspectFit
    let title = UILabel()
    title.text = PhishGuard.line(brand)
    title.font = .systemFont(ofSize: 24, weight: .semibold)
    title.numberOfLines = 0
    title.textAlignment = .center
    let why = UILabel()
    why.text = PhishGuard.why
    why.font = .systemFont(ofSize: 16)
    why.textColor = .secondaryLabel
    why.numberOfLines = 0
    why.textAlignment = .center
    let back = UIButton(type: .system)
    back.setTitle(PhishGuard.goBack, for: .normal)
    back.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
    back.backgroundColor = .label
    back.setTitleColor(.systemBackground, for: .normal)
    back.layer.cornerRadius = 25
    back.heightAnchor.constraint(equalToConstant: 50).isActive = true
    back.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
    let anyway = UIButton(type: .system)
    anyway.setTitle(PhishGuard.openAnyway, for: .normal)
    anyway.titleLabel?.font = .systemFont(ofSize: 15)
    anyway.setTitleColor(.secondaryLabel, for: .normal)
    anyway.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    anyway.addTarget(self, action: #selector(anywayTapped), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [mark, title, why, back, anyway])
    stack.axis = .vertical
    stack.spacing = 16
    stack.setCustomSpacing(28, after: why)
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
      close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      close.heightAnchor.constraint(equalToConstant: 44),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
    ])
  }

  @objc private func backTapped() { finish(false) }
  @objc private func anywayTapped() { finish(true) }

  private func finish(_ open: Bool) {
    guard !answered else { return }
    answered = true
    dismiss(animated: true) { [answer] in answer(open) }
  }
}
