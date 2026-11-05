// The host: the one web view, what it may load, and (in later pieces) the bridge to the device methods.
import SafariServices
import LocalAuthentication
import UIKit
import UserNotifications
import WebKit

@MainActor
final class Host: NSObject, WKNavigationDelegate, WKUIDelegate {
  let controller = UIViewController()
  private(set) var webView: WKWebView!
  /** The app that opened the browser sheet; only it hears `device.returned`. */
  var awaitingReturn: String?
  weak var sheet: UIViewController?
  /** D131: the Browser's open pages (oldest first), kept alive while another is on screen or none is. */
  var tabs: [PartnerView] = []
  /** What has already been logged as dropped, so a page that keeps knocking fills no log. */
  private var droppedLogged = Set<String>()
  /** The trusted core in its own context (IsolatedCore.swift), or nil: then nothing signs (or, switch off, the page's core runs). */
  private(set) var isolatedCore: CoreContext?
  /** D134: the core starting off the main thread while the web view loads (startCore); kept for its answer. */
  private var coreStarting: Task<CoreContext?, Never>?

  /** The isolated core once it has started; a call that comes while it starts waits for it. Nil: it didn't start. */
  func coreWhenStarted() async -> CoreContext? {
    if let isolatedCore { return isolatedCore }
    return await coreStarting?.value
  }

  /**
   * Starts the isolated core (IsolatedCore.swift) off the main thread (D134): its 1.4 MB script is read and evaluated
   * on a queue of its own, so the web view is made and loading first, beside it. The page's first core call (hundreds of
   * milliseconds later) waits for it in coreWhenStarted; a core that didn't start still fails closed there.
   */
  private func startCore() {
    // D131: the Browser's tracker list is looked up (or compiled, the first time) a little after launch, so the first
    // Browser window doesn't wait for it and the core starts first.
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: 3_000_000_000)
      TrackerBlocker.warmUp()
    }
    isolatedCore = nil
    guard Self.isolatedCoreWanted else { coreStarting = nil; return }
    let network = Self.network
    let starting = Task.detached(priority: .userInitiated) { [weak self] in Host.makeIsolatedCore(network: network, delegate: self) }
    coreStarting = starting
    Task { [weak self] in
      let core = await starting.value
      guard let self, self.coreStarting == starting else { return }
      self.isolatedCore = core
    }
  }

  /** The one test for "is this ZeroFee's own page": the main frame, served from zerofee-app://app. Nothing else may use the bridge or the camera. */
  static func isOurPage(isMainFrame: Bool, scheme: String, host: String) -> Bool {
    isMainFrame && scheme == WebFiles.scheme && host == WebFiles.host
  }

  /** A message or request from anything else is dropped (the caller refuses it) and logged once per kind. */
  func dropped(_ what: String, isMainFrame: Bool, scheme: String, host: String) {
    guard droppedLogged.insert(what).inserted else { return }
    // audit L7: never a site's host in the phone's log (only the kind of message and its scheme)
    _ = host
    NSLog("[zf-host] dropped %@ from a %@ page (main frame: %@). Only ZeroFee's own page may. Logged once.", what, scheme, isMainFrame ? "yes" : "no")
  }

  /** zerofee-app://app/ plus the build's start query (Info.plist ZFStartQuery, from the ZF_START_QUERY setting). */
  static var startURL: URL {
    let query = (Bundle.main.object(forInfoDictionaryKey: "ZFStartQuery") as? String ?? "").trimmingCharacters(in: .whitespaces)
    return URL(string: "\(WebFiles.scheme)://\(WebFiles.host)/\(query.isEmpty ? "" : "?" + query)")!
  }

  /** The app's one host (the account wipe closes its Browser pages: review M4). */
  static weak var current: Host?

  override init() {
    super.init()
    Host.current = self
    // iOS keeps Keychain items after the app is deleted: the first launch after an install empties the ZeroFee Keychain.
    Logins.wipeOnFirstLaunch()
    // a statement file a crash left in the temporary folder goes at launch (ShareFile.swift)
    ShareFiles.sweep()
    UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(WebFiles(), forURLScheme: WebFiles.scheme)
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "zerofee")
    // The switch, not whether it started: a core that didn't start fails closed, and the page never runs one of its own.
    config.userContentController.addUserScript(Self.coreModeScript(isolated: Self.isolatedCoreWanted))
    #if DEBUG
    DebugConsole.install(on: config.userContentController)
    #endif
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    web.scrollView.contentInsetAdjustmentBehavior = .never
    // The page is a fixed app screen (its root never scrolls), so the outer scroll view must never move or zoom:
    // otherwise a pinch, a double-tap or a keyboard leaves the whole screen zoomed out or shifted, tray half off screen.
    web.scrollView.minimumZoomScale = 1
    web.scrollView.maximumZoomScale = 1
    web.scrollView.bouncesZoom = false
    web.scrollView.bounces = false
    web.scrollView.isScrollEnabled = false
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak web] _ in
      MainActor.assumeIsolated { Self.settle(web) }
    }
    // D131: low memory: Browser tabs in the back let their pages go (each loads again when shown)
    NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.tabsMemoryWarning() }
    }
    // Fast-trade sessions end natively when ZeroFee leaves the screen or the phone locks (audit IOS-5): the page asks the
    // same, but a page that doesn't (stalled, or changed) must not keep a session open. The isolated core ends them all.
    for (name, reason) in [(UIApplication.didEnterBackgroundNotification, "ended"), (UIApplication.protectedDataWillBecomeUnavailableNotification, "locked")] {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          Task { _ = await self.coreWhenStarted()?.call("subwallet.session.endAll", ["reason": reason, "app": "shell"]) }
        }
      }
    }
    web.isOpaque = false
    web.backgroundColor = .systemBackground
    #if DEBUG
    web.isInspectable = true
    #endif
    webView = web
    controller.view = web
    web.load(URLRequest(url: Self.startURL))
    // D134: the page first, then the core beside it, off the main thread (it used to run here before the web view existed)
    startCore()
  }

  /** Back to the one true position: no zoom, no offset (a focused field makes WebKit scroll the outer view, and it can stay there). */
  static func settle(_ web: WKWebView?) {
    guard let scroll = web?.scrollView else { return }
    if scroll.zoomScale != 1 { scroll.setZoomScale(1, animated: false) }
    if scroll.contentOffset != .zero { scroll.setContentOffset(.zero, animated: false) }
  }

  /**
   * A zerofee:// link from outside (Safari, another app). The debug key check is only here; a return link goes through
   * handleReturn, which is also all a partner page can reach.
   */
  func handleOpen(_ url: URL) {
    #if DEBUG
    if url.scheme == "zerofee", url.host == "host", url.path == "/keycheck" { return runKeyCheck() }
    #endif
    handleReturn(url)
  }

  /**
   * zerofee://<app>/return…: a partner sending the person back. It goes to that app only, and only if that app opened
   * the partner screen or sheet (anyone can write a zerofee:// link; a stray one wakes nobody). The screen closes; the
   * app re-checks. The query is untrusted and is never read here. Returns whether it was accepted.
   * Security audit M2: never while a native approval sheet is open (closing the window would take the sheet with it,
   * unanswered), and the window goes from what presented it (putPartnerAway, as Close does), never a bare dismiss.
   */
  @discardableResult
  func handleReturn(_ url: URL) -> Bool {
    guard url.scheme == "zerofee", let app = url.host, url.path == "/return" || url.path.hasPrefix("/return/") else { return false }
    guard !Host.approvalOpen else {
      NSLog("[zf-host] ignored a return link for %@ (an approval is open)", app)
      return false
    }
    guard TabRules.takesReturn(app: app, knownApps: knownApps, awaiting: awaitingReturn, approvalOpen: Host.approvalOpen) else {
      NSLog("[zf-host] ignored a return link for %@ (nothing open for it)", app)
      return false
    }
    awaitingReturn = nil
    putPartnerAway()
    emit("device.returned", ["url": url.absoluteString, "app": app])
    return true
  }

  // ── What the web view may load: only the app itself. Everything else opens outside it. ──────────────────────

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    let isApp = url.scheme == WebFiles.scheme && url.host == WebFiles.host
    // The top frame is the app's own page only (audit IOS-8): an about:, blob: or data: document there would run with the
    // bridge and none of the app's code. Frames inside the page may still load them.
    let inFrame = action.targetFrame.map { !$0.isMainFrame } ?? false
    if isApp || (inFrame && (url.scheme == "about" || url.scheme == "blob" || url.scheme == "data")) { return decisionHandler(.allow) }
    decisionHandler(.cancel)
    // A plain https link the person tapped opens in a fresh partner view (its own web view), never in this one.
    if url.scheme == "https", action.navigationType == .linkActivated || action.targetFrame == nil { presentPartner(url, browser: true, keep: false) }
  }

  /** `window.open` / target=_blank: never a second web view. */
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, url.scheme == "https" { presentPartner(url, browser: true, keep: false) }
    return nil
  }

  /**
   * Settings → Reset this iPhone (product decision, 2 Nov). Deleting the app keeps the account's key in the chip on purpose, so a
   * reinstall opens the same account; this is the one full reset. The phone's owner says yes (Face ID or the passcode),
   * then everything ZeroFee keeps on this iPhone goes: the core's record and keys, the chip key, app secrets, passwords,
   * partner sites' storage and the page's own storage. The money stays on chain; the 24 words bring the account back.
   */
  func resetPhone() async -> Bool {
    let context = LAContext()
    guard (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Reset ZeroFee on this iPhone")) == true else { return false }
    _ = await coreWhenStarted()?.call("subwallet.session.endAll", ["reason": "ended", "app": "shell"])
    coreStarting = nil
    isolatedCore = nil
    for service in [Keychain.coreVault, Keychain.appSecrets, Keychain.chipKey] {
      do { try Keychain.deleteAll(service) } catch { NSLog("[zf-host] reset: %@ didn't empty", service) }
    }
    Host.accountForgotten()
    // every app's values, Browser places and seen sites: the sealed file and its key (audit M4)
    SealedStore.shared.wipe()
    let store = webView.configuration.websiteDataStore
    await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    webView.load(URLRequest(url: Self.startURL))
    startCore()
    return true
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // The web content process was killed (memory): load the app again rather than show a blank screen.
    webView.load(URLRequest(url: Self.startURL))
  }
}

#if DEBUG
extension Host {
  /**
   * Debug builds only, the test device check (zerofee://host/keycheck, e.g. typed into Safari on the iPhone): the
   * chip makes or opens the account key, Face ID approves one signature over a random hash (it moves nothing), and the
   * page verifies it with the same ML-DSA-65 library the core uses. The result shows in an alert.
   */
  func runKeyCheck() {
    webView.callAsyncJavaScript("return await window.__zerofeeHost.keyCheck()", arguments: [:], in: nil, in: .page) { [weak self] result in
      let text: String
      switch result {
      case .success(let value): text = value as? String ?? "No answer."
      case .failure(let error): text = "Not done: \(error.localizedDescription)"
      }
      NSLog("[zf-host] keycheck: %@", text)
      let alert = UIAlertController(title: "Chip key check", message: text, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Done", style: .default))
      guard let self else { return }
      (self.controller.presentedViewController ?? self.controller).present(alert, animated: true)
    }
  }
}

/** Debug builds only: the page's console and uncaught errors go to the device log as "[zf-console]". */
enum DebugConsole {
  static let source = """
  (() => {
    const post = (level, args) => { try { window.webkit.messageHandlers.zerofeeLog.postMessage(level + " " + args.map((a) => { try { return typeof a === "string" ? a : (a instanceof Error ? a.stack || String(a) : JSON.stringify(a)); } catch { return String(a); } }).join(" ")); } catch {} };
    for (const level of ["log", "info", "warn", "error"]) { const orig = console[level]; console[level] = (...a) => { post(level, a); orig.apply(console, a); }; }
    addEventListener("error", (e) => post("error", ["uncaught", e.message, e.filename + ":" + e.lineno]));
    addEventListener("unhandledrejection", (e) => post("error", ["unhandled rejection", e.reason]));
    addEventListener("securitypolicyviolation", (e) => post("error", ["CSP blocked", e.violatedDirective, e.blockedURI]));
  })();
  """

  final class Sink: NSObject, WKScriptMessageHandler {
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
      NSLog("[zf-console] %@", String(describing: message.body))
    }
  }

  @MainActor static func install(on ucc: WKUserContentController) {
    ucc.add(Sink(), name: "zerofeeLog")
    ucc.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  }
}
#endif
