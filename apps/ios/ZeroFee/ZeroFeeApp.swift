// The iPhone app: one full-screen WKWebView showing the built web app (D24), plus the device methods in Swift.
// There is no second UI here: every screen is the same React shell as the web demo.
import SwiftUI
import WebKit

@main
struct ZeroFeeApp: App {
  @State private var host: Host
  @Environment(\.scenePhase) private var phase

  init() {
    let host = Host()
    _host = State(initialValue: host)
    // A-4: Siri's and Shortcuts' asks reach the page through this host (Intents.swift)
    IntentInbox.shared.host = host
    // Background alerts (BackgroundAlerts.swift): registered before launch finishes, as iOS requires.
    BackgroundAlerts.register { [weak host] in await host?.coreWhenStarted() }
    // iOS audit finding 5: the switcher's cover over every window, partner and Browser windows and native sheets too
    SwitcherShield.shared.start()
    // Product decision, 4 Nov, decision C: Face ID on open and after 5 minutes away, its cover a window above every other
    AppLock.shared.start()
  }

  var body: some Scene {
    WindowGroup {
      HostView(host: host)
        .ignoresSafeArea()
        // The app switcher's picture is taken while ZeroFee isn't active: it shows a plain cover, never balances or
        // addresses (H33). A Face ID prompt makes the app inactive too; the cover stays off then.
        .overlay { if phase == .background || (phase == .inactive && !FaceIdPrompt.showing) { SwitcherCover() } }
        // The app lock's cover on the root too, so a cold launch's first frame never shows the app before its window is up
        .overlay { if AppLock.shared.locked { AppLockCover(lock: AppLock.shared) } }
        // A link (a zerofee:// link, a partner's return link) that arrives while locked waits until the lock is open
        .onOpenURL { url in AppLock.shared.whenOpen { host.handleOpen(url) } }
    }
    .onChange(of: phase) { _, now in
      if now == .active { Task { await BackgroundAlerts.askToTellOnce(await host.coreWhenStarted()) } }
      if now == .background {
        host.finishStepInBackground()
        // every change to the sealed store on disk before iOS suspends the app
        SealedStore.shared.flush()
      }
    }
  }
}

extension Host {
  /**
   * ZeroFee went to the background (H23): iOS gives it a few seconds, kept only until Spending's step under way (a call
   * to the core, the journal's write) has finished. Then iOS suspends it: what's on its way on chain finishes by itself,
   * and a step the phone signs waits for the next open, resumed from the journal. Nothing new starts meanwhile.
   */
  func finishStepInBackground() {
    var task = UIBackgroundTaskIdentifier.invalid
    let end = { if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid } }
    task = UIApplication.shared.beginBackgroundTask(withName: "zf.spending.step") { MainActor.assumeIsolated { end() } }
    webView.callAsyncJavaScript("return await window.__zerofeeHost.settle()", arguments: [:], in: nil, in: .page) { result in
      NSLog("[zf-host] background: the step under way %@", (try? result.get()) as? Bool == true ? "finished" : "didn't answer")
      end()
    }
  }
}

/** Puts the host's view controller (the web view) on screen. */
struct HostView: UIViewControllerRepresentable {
  let host: Host
  func makeUIViewController(context: Context) -> UIViewController { host.controller }
  func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

/** What the app switcher shows of ZeroFee: the ground and its name, nothing else. */
struct SwitcherCover: View {
  var body: some View {
    ZStack {
      Color(uiColor: .systemBackground)
      Text("ZEROFEE").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary)
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

/**
 * The switcher's cover above everything ZeroFee shows (iOS audit, finding 5). The SwiftUI cover above sits on the root
 * view only, under every window presented over it (a partner or Browser window is a full-screen UIKit modal, and so is
 * each native sheet). So on leaving the app a window of its own goes up at a level above alerts, over all of them, and
 * comes down when ZeroFee is active again (CoverRules, HostRules.swift). It never becomes the key window, so the
 * keyboard and focus stay where they were.
 */
@MainActor
final class SwitcherShield {
  static let shared = SwitcherShield()
  static let level = UIWindow.Level.alert + 1
  private var window: UIWindow?
  private var up = false
  private var observers: [NSObjectProtocol] = []

  func start() {
    guard observers.isEmpty else { return }
    let events: [(Notification.Name, CoverRules.Event)] = [
      (UIApplication.willResignActiveNotification, .willResignActive),
      (UIApplication.didEnterBackgroundNotification, .didEnterBackground),
      (UIApplication.didBecomeActiveNotification, .didBecomeActive),
    ]
    for (name, event) in events {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { SwitcherShield.shared.apply(event) }
      })
    }
  }

  private func apply(_ event: CoverRules.Event) {
    up = CoverRules.up(after: event, faceIdShowing: FaceIdPrompt.showing, wasUp: up)
    if up { show() } else { hide() }
  }

  private func show() {
    guard window == nil, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
    let cover = UIWindow(windowScene: scene)
    cover.windowLevel = Self.level
    let root = UIHostingController(rootView: SwitcherCover())
    root.view.backgroundColor = .systemBackground
    cover.rootViewController = root
    cover.isHidden = false
    window = cover
  }

  private func hide() {
    window?.isHidden = true
    window = nil
  }
}

/** A Face ID prompt is up (the scene is inactive while it is): the switcher cover isn't drawn over the approval then. */
enum FaceIdPrompt {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var open = 0
  static var showing: Bool { lock.withLock { open > 0 } }
  static func around<T>(_ work: () async throws -> T) async rethrows -> T {
    lock.withLock { open += 1 }
    defer { lock.withLock { open -= 1 } }
    return try await work()
  }
}
