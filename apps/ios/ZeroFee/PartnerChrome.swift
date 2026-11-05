// D131 (3 Nov, all five parts): a Browser window's Safari touches, for the person's own pages only (never pump.fun or
// GMGN's app-like windows, never Pay's partner windows): swipe from the edge to go back or forward, pull down to reload,
// and tap the address at the top to type a new one or search (AddressRules). While AgentZero acts, any of these is the
// person taking over: AgentZero pauses first.
import UIKit
import WebKit

@MainActor
final class PartnerChrome: NSObject, UITextFieldDelegate {
  private weak var view: PartnerView?
  private let refresh = UIRefreshControl()
  private var loading: NSKeyValueObservation?
  private var editor: UIView?
  private let field = UITextField()

  init(view: PartnerView, bar: UIView, address: UIView) {
    self.view = view
    super.init()
    let web = view.web
    web.allowsBackForwardNavigationGestures = true
    refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
    web.scrollView.refreshControl = refresh
    loading = web.observe(\.isLoading, options: [.new]) { [weak self] w, _ in
      MainActor.assumeIsolated { if !w.isLoading { self?.refresh.endRefreshing() } }
    }
    address.isUserInteractionEnabled = true
    address.accessibilityHint = "Tap to type an address or search"
    address.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(edit)))
    makeEditor(over: bar)
  }

  @objc private func pulled() {
    guard let view, view.web.url != nil else { return refresh.endRefreshing() }
    view.robot?.touched()
    view.web.reload()
  }

  private func makeEditor(over bar: UIView) {
    let box = UIView()
    box.backgroundColor = .systemBackground
    box.isHidden = true
    box.translatesAutoresizingMaskIntoConstraints = false
    field.placeholder = AddressRules.placeholder
    field.borderStyle = .roundedRect
    field.keyboardType = .webSearch
    field.returnKeyType = .go
    field.autocapitalizationType = .none
    field.autocorrectionType = .no
    field.clearButtonMode = .whileEditing
    field.delegate = self
    field.translatesAutoresizingMaskIntoConstraints = false
    let cancel = UIButton(type: .system)
    cancel.setTitle("Keep this page", for: .normal)
    cancel.addTarget(self, action: #selector(stopEditing), for: .touchUpInside)
    cancel.translatesAutoresizingMaskIntoConstraints = false
    cancel.setContentHuggingPriority(.required, for: .horizontal)
    box.addSubview(field)
    box.addSubview(cancel)
    bar.addSubview(box)
    NSLayoutConstraint.activate([
      box.topAnchor.constraint(equalTo: bar.topAnchor), box.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      box.leadingAnchor.constraint(equalTo: bar.leadingAnchor), box.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
      field.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
      field.centerYAnchor.constraint(equalTo: box.centerYAnchor),
      field.heightAnchor.constraint(equalToConstant: 36),
      cancel.leadingAnchor.constraint(equalTo: field.trailingAnchor, constant: 8),
      cancel.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
      cancel.centerYAnchor.constraint(equalTo: box.centerYAnchor),
      cancel.heightAnchor.constraint(equalToConstant: 44),
    ])
    editor = box
  }

  @objc private func edit() {
    guard let view, let editor else { return }
    field.text = view.web.url?.absoluteString ?? view.lastSecureURL.absoluteString
    field.placeholder = AddressRules.placeholder
    editor.isHidden = false
    field.becomeFirstResponder()
    field.selectAll(nil)
  }

  @objc private func stopEditing() {
    field.resignFirstResponder()
    editor?.isHidden = true
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    switch AddressRules.read(textField.text ?? "") {
    case .line(let line):
      textField.text = ""
      textField.placeholder = line
    case .go(let url):
      stopEditing()
      view?.robot?.touched()
      view?.web.load(URLRequest(url: url))
    }
    return false
  }
}
