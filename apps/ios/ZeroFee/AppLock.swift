// The app lock (product decision, 4 Nov, decision C): Face ID when ZeroFee opens, and again when it comes back after 5 minutes or
// more out of sight. Until then a plain cover hides everything (balances, addresses, Activity) and takes every touch.
// Trading wallets stay instant once the app is open: this lock gates the screen, never a trade.
//
// The cover is a window of its own above every other one (AppLock.level): partner and Browser windows and native
// sheets are full-screen UIKit modals over the root view, so a cover on the root alone would leave a pump.fun or GMGN
// window live on top of it (review, QA). It goes up before ZeroFee is seen again (willEnterForeground), and
// is the key window while up. What arrives while locked (a zerofee:// link, a partner's return link, Siri's or
// Shortcuts' ask) waits and is handed over only once the lock is open (`whenOpen`).
//
// Face ID here is the device's own check, not the chip key's: a face added or removed since set-up must never lock the
// person out of the app and with it of Security, Recovery (approvals stay strict: ChipKey/ApprovalPass use
// biometryCurrentSet). The first try is Face ID only; after a failed one the phone's passcode is offered too, and with
// Face ID unavailable or locked out the passcode opens it, so nobody is ever stranded outside their own money. No
// account on this phone yet (first run): nothing to hide, no lock.
import LocalAuthentication
import SwiftUI
import UIKit

@MainActor @Observable
final class AppLock {
  static let shared = AppLock()
  /** Above every window ZeroFee shows, the switcher's cover too (SwitcherShield, alert + 1). Face ID's prompt is the
   *  system's own, drawn outside the app, so it is never under this. */
  static let level = UIWindow.Level.alert + 2

  private(set) var locked: Bool
  @ObservationIgnored private var leftAt: ContinuousClock.Instant?
  @ObservationIgnored private var asking = false
  @ObservationIgnored private var failedTries = 0
  @ObservationIgnored private var waiting: [() -> Void] = []
  @ObservationIgnored private var window: UIWindow?
  @ObservationIgnored private weak var keyBefore: UIWindow?
  @ObservationIgnored private var observers: [NSObjectProtocol] = []
  @ObservationIgnored private let hasAccount: () -> Bool

  init(hasAccount: @escaping () -> Bool = { ((try? ChipKey.publicKey()) ?? nil) != nil }) {
    self.hasAccount = hasAccount
    locked = hasAccount()
  }

  /** Follows the app's comings and goings. Called once, from the app's init. */
  func start() {
    guard observers.isEmpty else { return }
    let on = { (name: Notification.Name, work: @escaping @MainActor (AppLock) -> Void) in
      self.observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { work(AppLock.shared) }
      })
    }
    on(UIApplication.didEnterBackgroundNotification) { $0.wentAway() }
    on(UIApplication.willEnterForegroundNotification) { $0.comingBack() }
    on(UIApplication.didBecomeActiveNotification) { lock in
      if lock.locked { lock.showCover(); Task { await lock.open() } }
    }
  }

  /** Runs `work` now if ZeroFee is open, else once it is. Every outside ask (links, intents) goes through here. */
  func whenOpen(_ work: @escaping () -> Void) {
    if locked { waiting.append(work) } else { work() }
  }

  /** ZeroFee left the screen. The clock keeps counting while the phone sleeps (ContinuousClock). */
  func wentAway(at now: ContinuousClock.Instant = .now) {
    if leftAt == nil { leftAt = now }
  }

  /** ZeroFee is about to be seen again: the lock goes up first if it was away 5 minutes or more. */
  func comingBack(at now: ContinuousClock.Instant = .now) {
    let away = leftAt.map { now - $0 }
    leftAt = nil
    locked = LockRules.lockedOnReturn(away: away, hasAccount: hasAccount(), wasLocked: locked)
    if locked { showCover() }
  }

  /** Asks Face ID (and, after a failed try or with Face ID unusable, the phone's passcode) once; opens on yes. */
  func open() async {
    guard locked, !asking else { return }
    asking = true
    defer { asking = false }
    let context = LAContext()
    defer { context.invalidate() }
    var error: NSError?
    let faceIdUsable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    let faceIdOnly = LockRules.faceIdOnly(failedTries: failedTries, faceIdUsable: faceIdUsable)
    if faceIdOnly { context.localizedFallbackTitle = "" }
    let policy: LAPolicy = faceIdOnly ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
    let yes = (try? await FaceIdPrompt.around { try await context.evaluatePolicy(policy, localizedReason: "Open ZeroFee") }) ?? false
    guard yes else { failedTries += 1; return }
    failedTries = 0
    locked = false
    hideCover()
    let queued = waiting
    waiting = []
    for work in queued { work() }
  }

  private func showCover() {
    if window != nil { window?.makeKeyAndVisible(); return }
    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
    keyBefore = scene.windows.first { $0.isKeyWindow }
    let cover = UIWindow(windowScene: scene)
    cover.windowLevel = Self.level
    let root = UIHostingController(rootView: AppLockCover(lock: self))
    root.view.backgroundColor = .systemBackground
    cover.rootViewController = root
    cover.makeKeyAndVisible()
    window = cover
  }

  private func hideCover() {
    window?.isHidden = true
    window = nil
    keyBefore?.makeKey()
    keyBefore = nil
  }
}

/** What shows while ZeroFee is locked: the ground, its name, and one button. Full screen; nothing behind it is visible. */
struct AppLockCover: View {
  let lock: AppLock
  var body: some View {
    ZStack {
      Color(uiColor: .systemBackground)
      VStack(spacing: 28) {
        Spacer()
        Text("ZEROFEE").font(.system(size: 13, weight: .medium)).tracking(2).foregroundStyle(.secondary)
        Spacer()
        Button { Task { await lock.open() } } label: {
          Label("Open with Face ID", systemImage: "faceid")
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        // the app's own primary (bug report, 4 Nov: the system's fat blue capsule wasn't ZeroFee): mint with an ink label,
        // 56 pt, 16 pt corners, as packages/design ui.css .zf-btn draws it on every other screen
        .buttonStyle(MintButton())
        .padding(.horizontal, 24)
        .padding(.bottom, 32)
      }
    }
    .ignoresSafeArea()
    .contentShape(Rectangle())
  }
}

/** ZeroFee's primary button, as the web screens draw it (packages/design tokens.css --mint #2ee6a6, --on-mint ink;
 *  ui.css .zf-btn: 56 pt, 16 pt corners, a .97 press with an 8 % dark film). */
struct MintButton: ButtonStyle {
  @Environment(\.colorScheme) private var scheme
  func makeBody(configuration: Configuration) -> some View {
    let mint = Color(red: 0x2e / 255, green: 0xe6 / 255, blue: 0xa6 / 255)
    let ink = scheme == .dark ? Color(red: 0x04 / 255, green: 0x14 / 255, blue: 0x0e / 255) : Color(red: 0x0b / 255, green: 0x0b / 255, blue: 0x0c / 255)
    return configuration.label
      .foregroundStyle(ink)
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(mint))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black.opacity(configuration.isPressed ? 0.08 : 0)))
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
  }
}
