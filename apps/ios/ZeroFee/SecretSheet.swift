// An exported separate wallet's key, shown natively (D34: Settings → Card wallet → Export keys). The core's sheet and
// Face ID come first; then the key comes from the core straight to this screen and never to the page, which hears only
// { shown }. Kept out of screenshots and recordings (ScreenshotProof). Copy puts it on this phone's clipboard only, marked concealed (no app reads it back through
// device.clipboard.read), for 30 seconds. Covered while the app is in the background or the screen is recorded.
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct SecretSheetView: View {
  let label: String
  let secretKey: String
  let done: @MainActor (Bool?) -> Void

  @State private var active = AppActive.now
  @State private var captured = UIScreen.main.isCaptured
  @State private var copied = false
  @State private var shot = false

  private static let gutter: CGFloat = 28
  private var visible: Bool { active && !captured }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("ZEROFEE · SECRET KEY").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary)
        Spacer()
        Button("Done") { done(true) }.font(.system(size: 15)).foregroundStyle(Color.primary)
      }
      .padding(.top, 20)
      Text("The key of your \(label.lowercased())").font(.system(size: 24)).tracking(-0.4).padding(.top, 20)
      Text("Anyone who sees it controls this wallet. Only put it into another app you trust.")
        .font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 6)
      Group {
        if visible {
          Text(secretKey).font(.system(size: 15, design: .monospaced)).textSelection(.disabled)
        } else {
          Text("ZeroFee hides this while you record the screen or leave the app").font(.system(size: 14)).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.12), lineWidth: 1))
      .padding(.top, 22)
      Spacer()
      Button {
        // This phone only (no Universal Clipboard), gone after 30 seconds, and marked so no app reads it back.
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: secretKey, ConcealedClipboard.marker: Data()]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(30)])
        copied = true
      } label: {
        Text(copied ? "Copied for 30 seconds" : "Copy").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
      }
      .foregroundStyle(Color(uiColor: .systemBackground))
      .background(Color.primary, in: Capsule())
      .disabled(!visible)
      .padding(.bottom, 20)
    }
    .padding(.horizontal, Self.gutter)
    .background(Color(uiColor: .systemBackground))
    .overlay(alignment: .top) {
      if shot {
        Text("You took a screenshot. If the key shows in it, delete it, then empty Recently Deleted.")
          .font(.system(size: 13)).multilineTextAlignment(.leading).padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(uiColor: .systemBackground))
          .onTapGesture { shot = false }
          .padding(.top, 52)
      }
    }
    .tracksAppActive($active)
    .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
    .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in shot = true }
  }
}

/**
 * A screen holding a secret (the backup words, shown or typed; audit IOS-2) is covered while ZeroFee isn't the active
 * app (the app switcher's snapshot is taken then) or the screen is recorded or mirrored. Typing stays where it was.
 */
struct PrivacyCover: ViewModifier {
  @State private var active = AppActive.now
  @State private var captured = UIScreen.main.isCaptured

  func body(content: Content) -> some View {
    content
      .overlay {
        if !active || captured {
          ZStack {
            Color(uiColor: .systemBackground)
            Text("ZeroFee hides this while you record the screen or leave the app")
              .font(.system(size: 14)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(28)
          }
          .ignoresSafeArea()
        }
      }
      .tracksAppActive($active)
      .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
  }
}

/**
 * Whether ZeroFee is the active app, for a screen in its own UIHostingController (every native sheet: presentModal).
 * SwiftUI's scenePhase isn't passed into such a controller and reads .background there, so a cover keyed on it never
 * lifted: the words, an exported key and a saved password showed only "Hidden…" (found 1 Nov). The app's own
 * resign/become-active notifications are the truth: the app switcher, Control Center and a call all resign it.
 */
enum AppActive {
  @MainActor static var now: Bool { UIApplication.shared.applicationState == .active }
}

extension View {
  func tracksAppActive(_ active: Binding<Bool>) -> some View {
    self
      .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in active.wrappedValue = false }
      .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in active.wrappedValue = true }
  }
}

extension View {
  func privacyCover() -> some View { modifier(PrivacyCover()) }
}

extension Host {
  /** The exported key on its own screen: true once it was shown (Done), false if no screen could show it. */
  func coreSecret(_ label: String, _ secretKey: String) async -> Bool {
    guard !secretKey.isEmpty, secretKey.count <= 200 else { return false }
    let shown: Bool? = await presentModal { (finish: @escaping @MainActor (Bool?) -> Void) in
      // D51: an exported key is kept out of screenshots and recordings (ScreenshotProof, as the 24 words are), and covered
      // in the app switcher (PrivacyCover).
      AnyView(ScreenshotProof(content: SecretSheetView(label: label, secretKey: secretKey, done: finish)).ignoresSafeArea().privacyCover())
    }
    return shown ?? false
  }
}

/**
 * A screen holding the 24 words (H33): its content is drawn inside a secure text field's own layer, which iOS leaves out
 * of screenshots, screen recordings and mirroring (the words' place shows empty there). The field never takes focus or
 * shows a keyboard. Should a future iOS draw that field differently, the content shows as before, still behind
 * PrivacyCover, and the words screen's screenshot warning still says what to do.
 */
struct ScreenshotProof<Content: View>: UIViewRepresentable {
  let content: Content

  final class Field: UITextField {
    override var canBecomeFirstResponder: Bool { false }
  }

  final class Holder: UIView {
    let hosting: UIHostingController<Content>
    init(_ content: Content) {
      hosting = UIHostingController(rootView: content)
      super.init(frame: .zero)
      let field = Field()
      field.isSecureTextEntry = true
      field.backgroundColor = .clear
      let shown = hosting.view!
      shown.backgroundColor = .clear
      let place: UIView
      if let canvas = field.subviews.first {
        // The secure field's canvas: whatever is inside it is blanked in any capture.
        pin(field, in: self)
        canvas.subviews.forEach { $0.removeFromSuperview() }
        canvas.isUserInteractionEnabled = true
        pin(canvas, in: field)
        place = canvas
      } else {
        place = self
      }
      pin(shown, in: place)
    }
    required init?(coder: NSCoder) { nil }

    private func pin(_ view: UIView, in parent: UIView) {
      if view.superview !== parent { parent.addSubview(view) }
      view.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        view.topAnchor.constraint(equalTo: parent.topAnchor), view.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
        view.leadingAnchor.constraint(equalTo: parent.leadingAnchor), view.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
      ])
    }
  }

  func makeUIView(context: Context) -> Holder { Holder(content) }
  func updateUIView(_ holder: Holder, context: Context) {}
}
