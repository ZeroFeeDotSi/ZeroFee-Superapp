// A partner's page inside a ZeroFee screen (device.openUrl mode "sheet", and https links from the app): our own bar on
// top (Close, the page's real address, Open in Safari) and the partner's page in its OWN web view below it.
//
// What that web view is NOT: it has no script message handler, no user script, no zerofee-app scheme handler, and it
// never reuses the configuration WebKit hands to Host's createWebViewWith. The page can read nothing of ZeroFee and
// call nothing of the phone; it is a window. We run no JavaScript in it (no evaluateJavaScript / callAsyncJavaScript;
// the one exception is the DEBUG-only probe in DebugProbe.swift). Each partner host keeps its own cookies and storage in
// its own data store, never ZeroFee's, never another partner's, never `.default()`.
//
// D29's declared modes (Security's rules, backlog/security.md A–G): a window opened with a compiled recipe may also be
// in wallet mode (PartnerWallet: provider.js in the page world and the `zerofeeWallet` handler) and/or robot mode
// (PartnerRobot: robot.js in its own "zf-robot" world, only while a run is live). Both scripts are hash-pinned
// (PartnerScripts). All 12 conditions above hold in them, except "no JS from us", relaxed for exactly those two
// scripts (and the one CustomEvent dispatch PartnerWallet makes for the provider's events). A mode is active only while
// the top frame's host (read here from `web.url`) is a recipe host; off it the page has the plain window. Never on a
// child's phone. A window opened without a recipe is exactly the plain window.
import CryptoKit
import SafariServices
import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

@MainActor
final class PartnerView: UIViewController, WKNavigationDelegate, WKUIDelegate {
  private unowned let host: Host
  let startURL: URL
  /** The web view; the DEBUG probe reads it, nothing else does. */
  let web: WKWebView
  private let hostLabel = UILabel()
  /** D131: swipe back and forward, pull to reload, and the editable address (normal Browser windows only). */
  private var chrome: PartnerChrome?
  /** A site's own window: the thin line along the bar's bottom edge that moves while it loads or signs in (SiteBar). */
  private let progressLine = UIProgressView(progressViewStyle: .bar)
  private var signingUntil: Date?
  private var signedInAt: Date?
  private var barState = SiteBar.State(status: nil, busy: false)
  /** A site app's name on the bar: shown only while the page is on that site's own hosts (refresh). */
  private let nameLabel = UILabel()
  /** The window closed (endModes): a load still waiting on the banner rules never starts. */
  private var ended = false
  private let lock = UIImageView(image: UIImage(systemName: "lock.fill"))
  private let note = UILabel()
  private var watches: [NSKeyValueObservation] = []
  private var fellBack = false
  /** The last https page that committed: where Safari opens, and what a killed web process reloads. */
  private(set) var lastSecureURL: URL
  /** D145: this window's open, timed from when it was asked for (SpeedMarks.swift): load asked, Tor ready, first byte, loaded. */
  private let opening = SpeedMark.start("site.open")

  // ── The rules, as plain functions (the probe checks the same ones the delegate uses) ─────────────────────

  /** One data store per partner host (the lowercased host of the URL openUrl received): same host, same store; another host, never the same. */
  static func dataStore(forHost partner: String, privately: Bool = false, agent: Bool = false) -> WKWebsiteDataStore {
    WKWebsiteDataStore(forIdentifier: SiteStore.id(forHost: partner, privately: privately, agent: agent))
  }

  static func storeID(forHost partner: String) -> UUID { SiteStore.id(forHost: partner) }

  /** Forget one site (M12): that host's cookies and storage only. False when it couldn't be removed (still open). */
  static func removeStore(forHost partner: String) async -> Bool {
    var ok = true
    for id in SiteStore.toForget(host: partner, among: await WKWebsiteDataStore.allDataStoreIdentifiers) {
      do { try await WKWebsiteDataStore.remove(forIdentifier: id) } catch { ok = false }
    }
    return ok
  }

  /** Account wipe: every partner's cookies and storage go (the stores are found by id, so none is missed). */
  /** True only if every store went (review M4: one still in use stays, and then it isn't "cleared"). */
  @discardableResult
  static func removeAllStores() async -> Bool {
    var all = true
    for id in await WKWebsiteDataStore.allDataStoreIdentifiers {
      do { try await WKWebsiteDataStore.remove(forIdentifier: id) } catch { all = false }
    }
    return all
  }

  enum Verdict: Equatable { case allow, cancel, returnLink }

  /** The top frame loads https and nothing else; a frame inside the page may also be about, blob or data. zerofee:// is
   *  only ever a return link, and only from the top frame (security audit M2: a frame inside the page is cancelled). */
  static func verdict(url: URL?, isMainFrame: Bool) -> Verdict {
    guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }
    if scheme == "zerofee" { return TabRules.returnLinkCounts(isMainFrame: isMainFrame) ? .returnLink : .cancel }
    if isMainFrame { return scheme == "https" ? .allow : .cancel }
    return ["https", "about", "blob", "data"].contains(scheme) ? .allow : .cancel
  }

  /** What the address strip says: the full lowercased host, no user@, path or query; a port only when it is not 443. */
  static func displayHost(_ url: URL?) -> String {
    guard let url, let h = url.host?.lowercased(), !h.isEmpty else { return "" }
    if let port = url.port, port != 443 { return "\(h):\(port)" }
    return h
  }

  /** A name written with look-alike letters (punycode): the strip warns, and shows the raw name. */
  static func isLookAlike(_ host: String) -> Bool { host.split(separator: ".").contains { $0.hasPrefix("xn--") } }

  /**
   * Where a site's own window or a Browser page was when it closed (product decision, 3 Nov: open right where you left off, across
   * launches): Places.swift's rules, kept on this phone. Never a Pay window, an AgentZero task or a private window.
   */
  static func keepPlace(of view: PartnerView) {
    guard !view.saysNotPrivate, !view.privately, view.recipe?.agent != true else { return }
    let kept = Places.keeping(keptPlaces(), opened: view.startURL, at: view.lastSecureURL, site: view.siteName != nil)
    guard let json = try? JSONSerialization.data(withJSONObject: Places.encode(kept)) else { return }
    SealedStore.shared.set(Places.key, String(data: json, encoding: .utf8))
  }
  static func placeFor(_ url: URL, browser: Bool) -> URL {
    guard browser else { return url }
    return Places.place(keptPlaces(), for: url)
  }
  /** The places kept (sealed at rest, audit M4: they hold full last URLs). */
  private static func keptPlaces() -> [Places.Entry] {
    Places.decode(SealedStore.shared.get(Places.key).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) })
  }
  /** History and every site's data cleared: the kept places go too, and the sites already opened once. */
  static func forgetPlaces() {
    SealedStore.shared.set(Places.key, nil)
    SealedStore.shared.removeAll(prefix: "zf.partner.seen.")
  }

  static let firstOpenLine = "It isn't part of ZeroFee, so never type your backup words into it."
  static let lookAlikeLine = "This name uses look-alike letters. Make sure it is the address you expect."
  private static func seenKey(_ host: String) -> String { "zf.partner.seen.\(host.lowercased())" }

  // ── Set-up ───────────────────────────────────────────────────────────────────────────────────────────────

  /** What Safari on a Mac says: a site that only works on a desktop (openSite { desktop: true }) gets this. */
  static let desktopAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

  /** openSite { desktop: true }: the computer's page, laid out at least `desktopWidth` CSS pixels wide (pageZoom). */
  let desktop: Bool
  /** A page whose phone layout is a "get the app" wall can still choose its layout by width alone (fomo.family shows its
   *  sign-in from about 800 CSS pixels): a desktop window lays the web view out this wide and draws it scaled to the
   *  screen. Plain UIKit layout: nothing is run in the page, and touches map through the scale. */
  static let desktopWidth: CGFloat = 820
  private let stage = UIView()
  /** D131: a Browser window's page controls under the page (back, forward, share, reload), as Safari's. */
  private let pageBar = UIToolbar()
  private var backItem: UIBarButtonItem?
  private var forwardItem: UIBarButtonItem?
  private var tabsItem: UIBarButtonItem?
  /** A site's own two-factor code (SiteCodes.swift): on the page bar only on pump.fun's and GMGN's exact https hosts. */
  private var codeItem: UIBarButtonItem?

  // ── D131: tabs ──────────────────────────────────────────────────────────────────────────────────────────

  /** This page's id among the Browser's open pages. */
  let tabId = UUID().uuidString
  /** On screen now (only it may use the wallet or move). */
  var isOnScreen: Bool { !ended && host.sheet === self }
  /** iOS asked for memory while this tab was in the back: its page went (its place kept) and loads again when shown. */
  private(set) var pageDropped = false
  var isClosed: Bool { ended }

  /** The tab goes to the back: its wallet requests are answered no, AgentZero's task waits for Continue. */
  func wentToBack() {
    wallet?.wentBack()
    robot?.pauseInBack()
    putAwayPopups()
  }

  /** D146: a popup this window raised (the top-up ask, the per-site switch, the share sheet, the tab list, a connect
   *  question) shows only while the window is on screen; leaving puts it away, answered no. Never the core's approval
   *  sheet (it answers itself; switching is refused while it's open). */
  func putAwayPopups() {
    guard let shown = presentedViewController, !Host.approvalOpen else { return }
    wallet?.wentBack()
    shown.dismiss(animated: false)
  }

  /** The tab is on screen again: a page dropped for memory loads again where it was; the Tabs count is fresh. */
  func cameToFront(count: Int) {
    tabsItem?.accessibilityLabel = TabRules.buttonLabel(count)
    // instant open: a warm window's held wallet requests go through now, on screen, the normal way
    if warm { warm = false; flushHeld() }
    if isViewLoaded { refresh() } // what changed while it was in the back (a Disconnect in Sites: no Top up)
    guard pageDropped else { return }
    pageDropped = false
    web.load(URLRequest(url: lastSecureURL))
  }

  /** Built off screen for an instant open (WarmSites): never on screen yet, so it holds wallet requests, never asks. */
  var warm = false
  private var held: [(retry: () -> Void, refuse: () -> Void)] = []
  /** Hold one wallet request until the window is shown (false: too many, it answers no). */
  func hold(retry: @escaping () -> Void, refuse: @escaping () -> Void) -> Bool {
    guard warm, WarmRules.mayHold(held: held.count) else { return false }
    held.append((retry, refuse))
    return true
  }
  private func flushHeld() { let h = held; held = []; h.forEach { $0.retry() } }
  private func refuseHeld() { let h = held; held = []; h.forEach { $0.refuse() } }

  /** Low memory: a tab in the back with no AgentZero task lets its page go (nothing is sent: a blank page, no network). */
  func dropPageForMemory() {
    guard !isOnScreen, !ended, !pageDropped, robot?.isLive != true, web.url != nil else { return }
    pageDropped = true
    web.loadHTMLString("", baseURL: nil)
  }

  /** The page's own title, for the tab list. */
  var tabTitle: String { pageDropped ? Self.displayHost(placeURL) : TabRules.name(title: web.title, host: Self.displayHost(placeURL)) }
  /** Where the page is: its last https page when it was let go for memory (review L3), else its address now. */
  var placeURL: URL { pageDropped ? lastSecureURL : (web.url ?? startURL) }

  @objc private func pageTabs() {
    // review L1: never while the wallet waits on the person or a Face ID sheet is open
    guard host.mayLeave(self) else { return walletTrouble(TabRules.answerFirst, receipt: false) }
    host.showTabList(from: self)
  }

  /**
   * A site's own app (Job 3, product decision, 2 Nov B15): the window IS the app. Its bar: Back (the site's own history first, then
   * the window closes), the site's name from ZeroFee's compiled list with the page's real host and lock under it,
   * Settings (the site app's own settings, its wallet) and Close. It comes in as a window, not a sheet, and has no Safari
   * button. Nil: the plain partner window as before (Close, the host, Safari).
   */
  let siteName: String?

  /** ST2: the site's wallet's dollars ("$2.91", WalletGate.pill), shown as the bar's pill in place of the gear; a tap
   *  closes onto that wallet's sheet in Social trading. Nil: the gear. */
  private(set) var pill: String?
  /** ST10: "Top up your pump.fun wallet privately here." on the window's notice line while the site's
   *  wallet holds $0.00; a tap (or Add) closes onto Social trading's own Top up for that wallet (the one money sheet).
   *  Ours, never the page's. Nil: no offer. */
  private var topUpLine: String?

  /** Social trading's newer read of the wallet (device.site.money): the pill, the top-up banner, and when money lands. */
  func setPill(_ next: String) {
    guard siteName != nil, next != pill else { return }
    let was = pill
    pill = next
    settingsButton?.setTitle(next, for: .normal)
    settingsButton?.accessibilityLabel = "\(siteName ?? "") wallet, \(next)"
    if was == "$0.00", next != "$0.00", let name = siteName {
      walletTrouble("\(next) landed in your \(name) wallet.")
      DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
        MainActor.assumeIsolated { if self?.walletLine?.hasSuffix("landed in your \(name) wallet.") == true { self?.walletTrouble(nil) } }
      }
    }
    refresh()
  }
  private weak var settingsButton: UIButton?
  /** Never blank: a spinner over the page until it has loaded (a site's own window). */
  private let skeleton = UIActivityIndicatorView(style: .medium)
  @objc private func topUpTapped() { host.closePartner(why: "topup") }

  // ── The Browser thesis, part 2 (EverySite.swift): a Browser tab's Top up, for the site's own wallet ───────────────
  /** The hosts whose own Solana wallet the engine answered in this window (PartnerWallet's reply, never the page). */
  private var solanaHosts = Set<String>()
  /** Hosts whose Top up line the person hid with × in this window (every page on that host, not only this one). */
  private var topUpHidden = Set<String>()
  /** "<host> has its own wallet." with Top up, while EverySite.offersTopUp; nil: no line. */
  private var siteWalletLine: String?
  /** The engine answered this host's Solana connect with its own wallet: Top up can show. */
  func solanaAnswered(_ host: String) {
    guard solanaHosts.insert(host).inserted else { return }
    refresh()
  }
  /** The page said Disconnect: no Top up for it until it connects again. */
  func solanaLeft(_ host: String) {
    guard solanaHosts.remove(host) != nil else { return }
    refresh()
  }
  /** The Browser says this tab's Top up went (device.site.money { host, went }): our one line, gone after a few seconds. */
  func toppedUp(_ host: String) {
    let line = EverySite.onItsWay(host)
    moveEnded(line)
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      MainActor.assumeIsolated { if self?.walletLine == line { self?.walletTrouble(nil) } }
    }
  }
  /** Top up: the tab goes to the back and the Browser opens Home's Put money in for this host's own wallet. The host is
   *  WebKit's (the bar's), read now; never while the wallet waits on the person or a Face ID sheet is open. */
  private func hostTopUpTapped() {
    let h = Self.displayHost(web.url)
    guard EverySite.offersTopUp(recipe: recipe, kid: kid, siteName: siteName, host: h, answered: solanaHosts, disconnected: WalletConnections.isDisconnected(h, kind: "browser"), hidden: topUpHidden) else { return refresh() }
    guard host.mayLeave(self) else { return walletTrouble(TabRules.answerFirst, receipt: false) }
    host.topUpHost(from: self, host: h)
  }

  // ── ST11: the moment the site is signed in and its wallet holds $0.00, our half-height sheet ──────────
  private var askedTopUp = false
  /** The site's connect was answered (its wallet is ours there): if it holds $0.00, ask once, over the page, a moment
   *  after (its own sign-in finishes first). Never over a sheet of ours already up. */
  func siteSignedIn() {
    // D144: the Activity centre hears it (the site's host and the state only; never an address)
    if !signedInOnce || signingAgain { signInEvent("signed") }
    signingAgain = false
    if !signedInOnce { signedInAt = Date() }
    signedInOnce = true
    updateBar()
    DispatchQueue.main.asyncAfter(deadline: .now() + SiteBar.signedInFor + 0.05) { [weak self] in MainActor.assumeIsolated { self?.updateBar() } }
    watchSignedOut()
    if let siteName, walletLine == WalletGate.agentOpening(siteName) || walletLine == WalletGate.siteSlow(siteName) { walletTrouble(nil) }
    guard siteName != nil, !askedTopUp, pill == "$0.00" else { return }
    // ST13: never over a network Spending can't fill (its line is said instead: nothing there could be approved)
    if let c = WalletGate.siteChain(web.url), WalletGate.notCarriedLine(c) != nil { return }
    askedTopUp = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
      MainActor.assumeIsolated {
        // D146: only while this window is on screen (a tab in the back, or a warm window, never shows it); asked again
        // the next time it is
        guard let self, !self.ended, self.presentedViewController == nil, self.pill == "$0.00", let name = self.siteName, self.recipe?.covers(Self.displayHost(self.web.url)) == true else { return }
        guard self.isOnScreen else { self.askedTopUp = false; return }
        // the page may have moved to a network ZeroFee can't fill during that second (review ST13 L3)
        if let c = WalletGate.siteChain(self.web.url), WalletGate.notCarriedLine(c) != nil { self.askedTopUp = false; return }
        // ST13: a site with a wallet per network names the one that is empty (today the one Spending fills: Solana)
        let sheet = TopUpAsk(site: name, network: WalletGate.siteNetworkName(Self.displayHost(self.startURL)), usd: WalletGate.firstAddUsd) { [weak self] move in
          guard let self else { return }
          guard move else { return self.refresh() } // Not now: the banner stays ("Top up … privately here")
          self.moveInFlight = true
          let moving = "Moving $\(WalletGate.firstAddUsd).00 to your \(name) wallet…"
          self.walletTrouble(moving)
          DispatchQueue.main.asyncAfter(deadline: .now() + WalletGate.moveSaysAfter) { [weak self] in
            MainActor.assumeIsolated {
              guard let self, self.moveInFlight, self.walletLine == moving else { return }
              self.moveEnded("Check your \(name) wallet in ZeroFee.")
            }
          }
          // the shell resolves the wallet from its own list by the compiled site, never from the page (Social trading)
          self.host.emit("device.site.topup", ["host": Self.displayHost(self.startURL), "usd": String(WalletGate.firstAddUsd)])
        }
        self.present(sheet, animated: true)
      }
    }
  }

  init(host: Host, url: URL, recipe: PartnerRecipe? = nil, kid: Bool = false, desktop: Bool = false, siteName: String? = nil, pill: String? = nil, privately: Bool = false, saysNotPrivate: Bool = false) {
    self.host = host
    self.privately = privately
    self.saysNotPrivate = saysNotPrivate
    self.siteName = siteName
    self.pill = siteName == nil ? nil : pill
    self.desktop = desktop
    startURL = url
    lastSecureURL = url
    self.kid = kid
    // A recipe only counts on an adult's phone and when it covers the page it opens; otherwise: the plain window.
    self.recipe = PartnerRecipe.forWindow(recipe, opening: Self.displayHost(url), kid: kid)
    let config = WKWebViewConfiguration() // fresh: no handler, no user script, no scheme handler
    // ruling b: AgentZero's window with its own wallet keeps its own store (never the person's sign-in on that site)
    let store = Self.dataStore(forHost: url.host ?? "", privately: privately, agent: self.recipe?.agent == true && self.recipe?.modes.contains(.wallet) == true)
    // D130: a private window's store goes through Tor (a closed port until Tor is up), set before its first use.
    if privately { PrivateBrowsing.shared.configure(store, site: url.host ?? "") }
    config.websiteDataStore = store
    // D130/D131, both modes: no WebRTC, WebTransport or DNS prefetch (each finds the phone's address around a proxy).
    var always = [WKUserScript(source: PrivateRules.guardScript(privately: privately), injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)]
    // The words guard (product decision, 3 Nov), every partner window (Browser, a site's own, Pay's): its own world, every frame.
    let seedGuard = PartnerScripts.seedGuardScript()
    if let seedGuard { always.append(seedGuard) }
    always.forEach(config.userContentController.addUserScript)
    alwaysScripts = always
    config.upgradeKnownHostsToHTTPS = true
    // D130 (review H1): a private window runs in WebKit's Lockdown Mode, which turns WebRTC and the other APIs that can
    // go around a proxy off in the engine itself, every frame and worker included (the script above is the second line).
    if privately { config.defaultWebpagePreferences.isLockdownModeEnabled = true }
    config.allowsInlineMediaPlayback = true
    config.preferences.isFraudulentWebsiteWarningEnabled = true // M10: WebKit's own warning before a known bad site
    config.preferences.isElementFullscreenEnabled = false // the bar stays visible: a page cannot cover it
    if desktop { config.defaultWebpagePreferences.preferredContentMode = .desktop }
    // Wallet mode: provider.js (page world, main frame, document start), only if its bytes match the pin.
    if let r = self.recipe, r.modes.contains(.wallet) { providerScript = PartnerScripts.providerScript() }
    // A site's own window (Social trading): its sign-in taps (zf-site-signin.js, pinned, their own world), with the
    // provider only: the steps answer nothing, and ZeroFee's wallet still decides every signature.
    if siteName != nil, providerScript != nil { signInScript = PartnerScripts.signInScript() }
    web = WKWebView(frame: .zero, configuration: config)
    if desktop { web.customUserAgent = Self.desktopAgent }
    super.init(nibName: nil, bundle: nil)
    // QA: the person's own touch on the page (UIKit's, never the page's): a sign-in asked just after one is
    // theirs (the core's six an hour); one with none is a re-run (its own capped room)
    web.addGestureRecognizer(TouchNoter { [weak self] in self?.touchedAt = Date() })
    // its one handler, in its own world only (the page's world has no such handler; it reads one word: SeedGuard.kind)
    if seedGuard != nil { config.userContentController.add(SeedGuardHandler(view: self), contentWorld: PartnerScripts.seedGuardWorld, name: SeedGuard.handler) }
    // Over the shell, never instead of it: .fullScreen takes ZeroFee's own web view out of the window, and on an iPhone
    // WebKit then suspends that page's process. Browser's wallet engine runs in that page and answers every wallet-mode
    // request (device.wallet.request), so a site's Connect and Sign in waited for ever on the phone (2 Nov, pump.fun in
    // Apps); the simulator doesn't suspend, so it never showed there. .overFullScreen covers the screen the same way and
    // keeps the shell's page in the window, running.
    modalPresentationStyle = .overFullScreen
    // A site's own app comes in as a window inside ZeroFee, never sliding up as a sheet.
    if siteName != nil { modalTransitionStyle = .crossDissolve }
    if let r = self.recipe {
      if providerScript != nil {
        let w = PartnerWallet(host: host, recipe: r)
        w.view = self
        wallet = w
        config.userContentController.addScriptMessageHandler(w, contentWorld: .page, name: "zerofeeWallet")
        setProvider(forLoading: Self.displayHost(url))
      }
      // Robot mode: armed; robot.js goes in only when a run starts (PartnerRobot), and only if it passes its pin.
      if r.modes.contains(.robot), PartnerScripts.robotSource() != nil { robot = PartnerRobot(view: self, host: host, recipe: r) }
    }
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let bar = UIView()
    bar.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(bar)

    let close = UIButton(type: .system)
    close.setTitle("Close", for: .normal)
    close.titleLabel?.font = .systemFont(ofSize: 17)
    close.setTitleColor(.label, for: .normal)
    close.accessibilityLabel = "Close, back to ZeroFee"
    close.addTarget(self, action: #selector(finish), for: .touchUpInside)
    close.translatesAutoresizingMaskIntoConstraints = false

    let safari = UIButton(type: .system)
    safari.setImage(UIImage(systemName: "safari"), for: .normal)
    safari.tintColor = .label
    safari.accessibilityLabel = "Open in Safari"
    safari.addTarget(self, action: #selector(openInSafari), for: .touchUpInside)
    safari.translatesAutoresizingMaskIntoConstraints = false

    lock.tintColor = .secondaryLabel
    // D131: the mode mark; a tap offers this site's other mode (a Browser window only)
    lock.isUserInteractionEnabled = !saysNotPrivate
    lock.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(modeTapped)))
    lock.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11)
    lock.setContentHuggingPriority(.required, for: .horizontal)
    lock.setContentCompressionResistancePriority(.required, for: .horizontal)
    hostLabel.font = .systemFont(ofSize: 15)
    hostLabel.textColor = .label
    hostLabel.lineBreakMode = .byTruncatingHead // a long name loses its left end, never the part that says who it is
    let title = UIStackView(arrangedSubviews: [lock, hostLabel])
    title.spacing = 5
    title.alignment = .center
    title.translatesAutoresizingMaskIntoConstraints = false

    // D130: a private window never offers Safari (it would open the page in the clear).
    safari.isHidden = privately
    // A site's own app: Back on the left, Settings and Close on the right, the site's name over its real host.
    let settings = UIButton(type: .system)
    settings.translatesAutoresizingMaskIntoConstraints = false
    settingsButton = settings
    // (nameLabel: a property, so the bar can drop the name when the page leaves the site's own hosts)
    if let siteName {
      close.setTitle(nil, for: .normal)
      close.setImage(UIImage(systemName: "chevron.left"), for: .normal)
      close.tintColor = .label
      close.accessibilityLabel = "Back"
      close.removeTarget(self, action: #selector(finish), for: .touchUpInside)
      close.addTarget(self, action: #selector(back), for: .touchUpInside)
      safari.isHidden = false
      safari.setImage(UIImage(systemName: "xmark"), for: .normal)
      safari.accessibilityLabel = "Close \(siteName)"
      safari.removeTarget(self, action: #selector(openInSafari), for: .touchUpInside)
      safari.addTarget(self, action: #selector(finish), for: .touchUpInside)
      if let pill {
        // ST2: the wallet pill: its dollars, a hairline capsule; a tap opens AgentZero's wallet for this site
        settings.setTitle(pill, for: .normal)
        settings.setTitleColor(.label, for: .normal)
        settings.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 14, weight: .medium)
        settings.contentEdgeInsets = UIEdgeInsets(top: 4, left: 12, bottom: 4, right: 12)
        settings.layer.cornerRadius = 15
        settings.layer.borderWidth = 1
        settings.layer.borderColor = UIColor.separator.cgColor
        settings.accessibilityLabel = "\(siteName) wallet, \(pill)"
      } else {
        settings.setImage(UIImage(systemName: "gearshape"), for: .normal)
        settings.tintColor = .label
        settings.accessibilityLabel = "\(siteName) settings"
      }
      settings.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
      nameLabel.text = siteName
      nameLabel.font = .systemFont(ofSize: 16, weight: .semibold)
      nameLabel.textColor = .label
      nameLabel.textAlignment = .center
      hostLabel.font = .systemFont(ofSize: 11)
      hostLabel.textColor = .secondaryLabel
    }
    let titleBox = siteName == nil ? title : {
      let stack = UIStackView(arrangedSubviews: [nameLabel, title])
      stack.axis = .vertical
      stack.alignment = .center
      stack.spacing = 0
      stack.translatesAutoresizingMaskIntoConstraints = false
      return stack
    }()

    let line = UIView()
    line.backgroundColor = .separator
    line.translatesAutoresizingMaskIntoConstraints = false
    [close, titleBox, safari, line].forEach(bar.addSubview)
    // SiteBar: a quiet line, the label colour at low strength, on the hairline's own place (Light and Dark alike)
    progressLine.translatesAutoresizingMaskIntoConstraints = false
    progressLine.trackTintColor = .clear
    progressLine.progressTintColor = UIColor.label.withAlphaComponent(0.55)
    progressLine.alpha = 0
    progressLine.isAccessibilityElement = false
    bar.addSubview(progressLine)
    if siteName != nil { bar.addSubview(settings) }

    buildSeedBar()
    view.addSubview(seedBar)

    // The web view sits on a stage: a phone page fills it; a desktop page (openSite { desktop: true }) is laid out at
    // desktopWidth and drawn scaled down to fit (viewDidLayoutSubviews), as Safari's "Request Desktop Website" looks.
    stage.translatesAutoresizingMaskIntoConstraints = false
    stage.clipsToBounds = true
    web.translatesAutoresizingMaskIntoConstraints = desktop
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.allowsLinkPreview = false
    web.isOpaque = false
    web.backgroundColor = .systemBackground
    #if DEBUG
    web.isInspectable = true
    #endif
    view.addSubview(stage)
    stage.addSubview(web)
    pageBar.translatesAutoresizingMaskIntoConstraints = false
    // A site's own window (pump.fun, GMGN) feels like being inside the site: no Browser bar under it (product decision, 3 Nov).
    pageBar.isHidden = saysNotPrivate || siteName != nil
    view.addSubview(pageBar)
    if !desktop {
      NSLayoutConstraint.activate([
        web.topAnchor.constraint(equalTo: stage.topAnchor), web.bottomAnchor.constraint(equalTo: stage.bottomAnchor),
        web.leadingAnchor.constraint(equalTo: stage.leadingAnchor), web.trailingAnchor.constraint(equalTo: stage.trailingAnchor),
      ])
    }

    note.text = "Opening in Safari instead."
    note.font = .systemFont(ofSize: 15)
    note.textColor = .secondaryLabel
    note.alpha = 0
    note.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(note)
    skeleton.hidesWhenStopped = true
    skeleton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(skeleton)
    // One notice at a time, at the bottom, over the page (never resizing it), above the page controls when they show
    buildNoticeBar()
    view.addSubview(noticeBar)

    let guide = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: guide.topAnchor),
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bar.heightAnchor.constraint(equalToConstant: 44),
      close.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
      close.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
      close.heightAnchor.constraint(equalToConstant: 44),
      close.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      safari.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -12),
      safari.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
      safari.heightAnchor.constraint(equalToConstant: 44),
      safari.widthAnchor.constraint(equalToConstant: 44),
      titleBox.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
      titleBox.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
      titleBox.leadingAnchor.constraint(greaterThanOrEqualTo: close.trailingAnchor, constant: 8),
      titleBox.trailingAnchor.constraint(lessThanOrEqualTo: (siteName == nil ? safari : settings).leadingAnchor, constant: -8),
      line.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
      line.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
      line.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      progressLine.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
      progressLine.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
      progressLine.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      progressLine.heightAnchor.constraint(equalToConstant: 2),
      line.heightAnchor.constraint(equalToConstant: 1.0 / max(1, traitCollection.displayScale)),
      // the words guard is the one thing under the bar (until Leave or Stay); every other notice is at the bottom
      seedBar.topAnchor.constraint(equalTo: bar.bottomAnchor),
      seedBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      seedBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      seedCollapse,
      stage.topAnchor.constraint(equalTo: seedBar.bottomAnchor, constant: 0),
      stage.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      stage.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stage.bottomAnchor.constraint(equalTo: saysNotPrivate || siteName != nil ? view.bottomAnchor : pageBar.topAnchor),
      pageBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      pageBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      pageBar.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
      note.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      note.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      skeleton.centerXAnchor.constraint(equalTo: stage.centerXAnchor),
      skeleton.centerYAnchor.constraint(equalTo: stage.centerYAnchor),
      noticeBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      noticeBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      noticeBar.bottomAnchor.constraint(equalTo: saysNotPrivate || siteName != nil ? guide.bottomAnchor : pageBar.topAnchor, constant: -8),
    ])
    if siteName != nil {
      NSLayoutConstraint.activate([
        settings.trailingAnchor.constraint(equalTo: safari.leadingAnchor, constant: pill == nil ? 0 : -4),
        settings.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
        // the pill is a 30 pt capsule inside a 44 pt tap target's height; the gear a 44 pt square
        settings.heightAnchor.constraint(equalToConstant: pill == nil ? 44 : 30),
        pill == nil ? settings.widthAnchor.constraint(equalToConstant: 44) : settings.widthAnchor.constraint(greaterThanOrEqualToConstant: 56),
      ])
    }

    // D75 + never blank: AgentZero's line is the first thing on screen when a site's window opens,
    // over a skeleton until the page has loaded; it gives way to what happens next (signing you in, signed in, a trouble
    // line). A site that is still blank after 12 s is named as slow, never left silent (pump.fun's own start sometimes
    // takes 13 s or more: the matrix, 2 Nov).
    if let siteName {
      // the bar says it now ("Signing you in…" under the name, the line moving); the page's own strip stays clear
      signingUntil = Date().addingTimeInterval(WalletGate.stepWatchFor)
      signInEvent("signing")
      skeleton.startAnimating()
      // never silent (B32 matrix): a site still blank after 8 s is loaded again, once, and the line says so
      DispatchQueue.main.asyncAfter(deadline: .now() + WalletGate.paintWithin) { [weak self] in
        MainActor.assumeIsolated { self?.checkPainted(siteName) }
      }
    }

    // The first time this partner is opened, say once what it is and is not.
    let seen = Self.seenKey(Self.displayHost(startURL))
    // sealed at rest (audit M4): AgentZero's and private windows' sites never lie plain on the phone
    firstOpen = SealedStore.shared.get(seen) == nil
    SealedStore.shared.set(seen, "1")

    if !saysNotPrivate, siteName == nil {
      setUpPageBar()
      // D131: Safari's touches on the person's own pages (PartnerChrome): swipe, pull to reload, tap the address
      chrome = PartnerChrome(view: self, bar: bar, address: title)
    }
    // The strip follows the web view's own url (pushState included) and whether everything on the page is secure.
    watches.append(web.observe(\.url, options: [.initial, .new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.refresh(); self?.chainChanged() } })
    // SiteBar: the progress line follows WebKit's own loading; the sign-in status ends by itself when its time is up
    if siteName != nil {
      watches.append(web.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.updateBar() } })
      watches.append(web.observe(\.isLoading, options: [.new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.updateBar() } })
      DispatchQueue.main.asyncAfter(deadline: .now() + WalletGate.stepWatchFor + 0.1) { [weak self] in MainActor.assumeIsolated { self?.updateBar() } }
    }
    // The person touching the page while the robot acts pauses it (they take over); the touch itself goes through.
    web.addGestureRecognizer(TouchWatcher { [weak self] in self?.robot?.touched() })
    watches.append(web.observe(\.hasOnlySecureContent, options: [.new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.refresh() } })
    // A site's "get our app" banner is hidden by WebKit's content rules (PartnerBanners), added before the first page.
    Task { @MainActor [weak self] in
      let rules = await PartnerBanners.rules()
      guard let self, !self.ended else { return }
      if let rules { self.web.configuration.userContentController.add(rules) }
      // D131: Block trackers in a Browser window (never Pay's), before its first page when the list is ready
      if !self.saysNotPrivate, let trackers = await TrackerBlocker.list(whenReady: { [weak self] l in self?.web.configuration.userContentController.add(l) }) {
        self.web.configuration.userContentController.add(trackers)
      }
      self.loadFirst()
    }
  }

  // ── D130: private browsing ──────────────────────────────────────────────────────────────────────────────

  /** This window goes through Tor (a Browser window while private browsing is on and the site isn't set to normal). */
  let privately: Bool
  /** How it was opened, so the per-site switch can open it again the same way. */
  var reopen: (recipe: PartnerRecipe?, kid: Bool, desktop: Bool, siteName: String?, pill: String?)?
  /** A partner window outside private browsing (Pay's): its one line says so. */
  let saysNotPrivate: Bool
  private var torWatch: UUID?
  private var privateLine: String?

  /** The first page: at once in a normal window; in a private one only once Tor is up (nothing loads in the clear). */
  private func loadFirst() {
    if saysNotPrivate { privateLine = PrivateRules.notPrivateLine; refresh() }
    guard privately else { opening.mark("load asked"); web.load(URLRequest(url: startURL)); watchOpen(); return }
    let tor = PrivateBrowsing.shared
    tor.start()
    torWatch = tor.watch { [weak self] state in
      guard let self, !self.ended else { return }
      switch state {
      case .ready:
        if let id = self.torWatch { tor.unwatch(id) }
        self.torWatch = nil
        tor.configure(self.web.configuration.websiteDataStore, site: self.startURL.host ?? "")
        self.privateLine = nil
        self.refresh()
        self.opening.mark("tor ready, load asked")
        self.web.load(URLRequest(url: self.startURL))
        self.watchOpen()
      case .connecting, .off:
        self.privateLine = PrivateRules.connectingLine
        self.skeleton.startAnimating()
        self.refresh()
      case .failed:
        self.privateLine = PrivateRules.failedLine
        self.skeleton.stopAnimating()
        self.refresh()
      case .unavailable:
        self.privateLine = PrivateRules.unavailableLine
        self.skeleton.stopAnimating()
        self.refresh()
      }
    }
  }

  /** D131: the phishing guard's page; "Open anyway" opens this host for the rest of the run, "Go back" stays (or closes
   *  a window whose first page it was). */
  private func stopLookAlike(brand: String, url: URL, host target: String) {
    robot?.touched()
    let page = PhishWarning(brand: brand) { [weak self] open in
      guard let self, !self.ended else { return }
      if open {
        PhishWarning.openedAnyway.insert(target)
        self.web.load(URLRequest(url: url))
      } else if self.web.url == nil {
        self.host.closePartner(why: "close")
      }
    }
    present(page, animated: true)
  }

  /** D131: back, forward, share, reload. A tap while AgentZero acts is the person taking over (it pauses first). */
  private func setUpPageBar() {
    func item(_ symbol: String, _ label: String, _ action: Selector) -> UIBarButtonItem {
      let b = UIBarButtonItem(image: UIImage(systemName: symbol), style: .plain, target: self, action: action)
      b.accessibilityLabel = label
      b.tintColor = .label
      return b
    }
    let back = item("chevron.backward", "Back", #selector(pageBack)), forward = item("chevron.forward", "Forward", #selector(pageForward))
    let share = item("square.and.arrow.up", "Share this page", #selector(pageShare)), reload = item("arrow.clockwise", "Reload", #selector(pageReload))
    let gap = { UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil) }
    let tabsButton = item("square.on.square", TabRules.buttonLabel(1), #selector(pageTabs))
    tabsItem = tabsButton
    let code = item("key.horizontal", "Two-factor code", #selector(siteCodeTapped))
    code.isHidden = SiteCodes.site(of: web.url ?? startURL) == nil
    codeItem = code
    pageBar.items = [back, gap(), forward, gap(), share, gap(), reload, gap(), code, gap(), tabsButton]
    backItem = back
    forwardItem = forward
    back.isEnabled = false
    forward.isEnabled = false
    watches.append(web.observe(\.canGoBack, options: [.new]) { [weak self] w, _ in MainActor.assumeIsolated { self?.backItem?.isEnabled = w.canGoBack } })
    watches.append(web.observe(\.canGoForward, options: [.new]) { [weak self] w, _ in MainActor.assumeIsolated { self?.forwardItem?.isEnabled = w.canGoForward } })
  }

  @objc private func siteCodeTapped() {
    robot?.touched()
    Task { await SiteCodes.open(in: self, host: host) }
  }

  /**
   * Fills a site's two-factor code into the box the person tapped on that site's own page: the main frame only, and only
   * while it is still the site's exact https host (WebKit's URL here, the page's own location again in the fill). Six
   * one-digit boxes get a digit each. False: nothing to fill (no box tapped), or the page is elsewhere now.
   */
  func fillSiteCode(_ code: String, site: String) async -> Bool {
    guard SiteCodes.site(of: web.url) == site, let expect = web.url?.host?.lowercased(), code.allSatisfy(\.isNumber) else { return false }
    let script = """
    if (location.protocol !== "https:" || location.hostname !== host) return false;
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const put = (i, v) => { setter.call(i, v); i.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" })); i.dispatchEvent(new Event("change", { bubbles: true })); };
    if (el.maxLength === 1) {
      const boxes = Array.from((el.form || el.parentElement?.parentElement || document).querySelectorAll("input")).filter((i) => i.maxLength === 1);
      if (boxes.length >= code.length) { Array.from(code).forEach((c, k) => put(boxes[k], c)); return true; }
    }
    put(el, code);
    return true;
    """
    let r = try? await web.callAsyncJavaScript(script, arguments: ["code": code, "host": expect], in: nil, contentWorld: .defaultClient)
    return (r as? Bool) == true
  }

  @objc private func pageBack() { robot?.touched(); web.goBack() }
  @objc private func pageForward() { robot?.touched(); web.goForward() }
  @objc private func pageReload() {
    guard web.url != nil else { return } // a private window still waiting for Tor has nothing to reload
    robot?.touched()
    web.reload()
  }
  @objc private func pageShare() {
    guard let url = web.url ?? Optional(lastSecureURL), url.scheme?.lowercased() == "https" else { return }
    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    sheet.popoverPresentationController?.barButtonItem = pageBar.items?[4]
    present(sheet, animated: true)
  }

  /** The person's per-site choice, from the mark by the address (QA, 3 Nov: a trader can pick speed for one site). */
  @objc private func modeTapped() {
    let site = Self.displayHost(web.url ?? startURL)
    guard PrivateBrowsing.ready, !site.isEmpty, siteName != nil || recipe?.agent == true || !saysNotPrivate else { return }
    let sheet = UIAlertController(title: site, message: privately ? PrivateRules.normalWhy : nil, preferredStyle: .actionSheet)
    sheet.addAction(UIAlertAction(title: privately ? PrivateRules.useNormal(site) : PrivateRules.usePrivate(site), style: .default) { [weak self] _ in
      guard let self else { return }
      var normal = PrivateBrowsing.normalSites
      if self.privately { normal.insert(site) } else { normal.remove(site) }
      PrivateBrowsing.normalSites = normal
      self.host.reopenPartner(self)
    })
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    sheet.popoverPresentationController?.sourceView = lock
    present(sheet, animated: true)
  }

  private var firstOpen = false

  // ── D29 modes ────────────────────────────────────────────────────────────────────────────────────────────

  let recipe: PartnerRecipe?
  /** A child's phone: no robot mode, no wallet mode (§A3). */
  let kid: Bool
  private(set) var wallet: PartnerWallet?
  private(set) var robot: PartnerRobot?
  /** The verified provider script; it is in the page only while the page being loaded is on a recipe host. */
  private(set) var providerScript: WKUserScript?
  /** A site's own window only: its pinned sign-in taps, put in and taken out with the provider. */
  private(set) var signInScript: WKUserScript?
  /** Every page of every window: D130's guard and the words guard (put back after setProvider's remove-all). */
  private var alwaysScripts: [WKUserScript] = []
  private var lastHost = ""
  /** AgentZero's line and its why, said on the notice line (modesChanged); nil: it has nothing to say. */
  private var robotLine: String?
  private var robotWhy: String?
  private let continueButton = UIButton(type: .system)
  private let stopButton = UIButton(type: .system)

  /** provider.js goes into the NEXT document only when that document's host has wallet mode (user scripts are read at document creation). */
  func setProvider(forLoading target: String) {
    guard let providerScript, let recipe else { return }
    let ucc = web.configuration.userContentController
    let want = recipe.active(.wallet, host: target, kid: kid)
    let has = ucc.userScripts.contains { $0 === providerScript }
    if want == has { return }
    // WebKit removes user scripts only all at once: keep the robot's while a run is live.
    removeUserScripts()
    if want { ucc.addUserScript(providerScript) }
    if want, let signInScript { ucc.addUserScript(signInScript) }
    if robot?.isLive == true, let r = PartnerScripts.robotScript() { ucc.addUserScript(r) }
  }

  /** WebKit removes user scripts only all at once: the ones every page gets (the WebRTC guard, the words guard) go
   *  straight back in. */
  func removeUserScripts() {
    let ucc = web.configuration.userContentController
    ucc.removeAllUserScripts()
    alwaysScripts.forEach(ucc.addUserScript)
  }

  /** The robot's line (§D9), on the notice line at the bottom: "ZeroFee is acting here · <host>" with Stop, Continue
   *  when it waits for the person (no × then: Stop is the way out). */
  func modesChanged() {
    guard let robot else { robotLine = nil; robotWhy = nil; return showNotice() }
    let h = Self.displayHost(web.url)
    let back = robot.offerContinue && (recipe?.covers(h) ?? false)
    switch robot.state {
    case .running:
      robotLine = "ZeroFee is acting here · \(h)"
      robotWhy = robot.showFirstRunLine ? PartnerRobot.firstRunLine : nil
    case .paused:
      robotLine = "Your turn · \(h)"
      robotWhy = robot.waitingWhy
    case .idle, .ended:
      robotLine = back ? "ZeroFee stopped · \(h)" : nil
      robotWhy = nil
    }
    let paused: Bool = { if case .paused = robot.state { return true } else { return false } }()
    continueButton.isHidden = !(paused || back)
    stopButton.isHidden = !robot.isLive
    if !(robot.isLive || back) { robotLine = nil; robotWhy = nil }
    showNotice()
  }

  @objc private func robotContinue() { robot?.continueTapped() }
  @objc private func robotStop() { robot?.stopTapped() }

  /** The window closes: the robot ends, the engine hears the page went, the handlers and scripts go. */
  func endModes() {
    warm = false
    refuseHeld()
    ended = true
    robot?.closing()
    if !lastHost.isEmpty, let recipe, recipe.covers(lastHost) { wallet?.left(lastHost) }
    let ucc = web.configuration.userContentController
    ucc.removeAllScriptMessageHandlers()
    ucc.removeAllUserScripts()
  }

  // ── The words guard (product decision, 3 Nov): ZeroFee's own bar above the page, never over it, never blocking it ──────────────
  private let seedBar = UIView()
  private lazy var seedCollapse: NSLayoutConstraint = seedBar.heightAnchor.constraint(equalToConstant: 0)
  /** This page load: the bar has shown; the person chose Stay. */
  private var seedShown = false
  private var seedStayed = false

  /** zf-seed-guard.js found a page asking for the person's words (or its own Face ID): the bar, once per page. */
  func seedGuardHeard(_ kind: SeedGuard.Kind?) {
    guard !ended, SeedGuard.shows(kind, shown: seedShown, stayed: seedStayed) else { return }
    seedShown = true
    seedBar.isHidden = false
    seedCollapse.isActive = false
    UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
    if isOnScreen { UIAccessibility.post(notification: .announcement, argument: SeedGuard.line) }
  }

  private func seedGuardReset() {
    seedShown = false
    seedStayed = false
    seedHide()
  }

  private func seedHide() {
    guard !seedBar.isHidden else { return }
    seedBar.isHidden = true
    seedCollapse.isActive = true
  }

  /** Leave: the page before this one; with none, the window closes. */
  @objc private func seedLeave() {
    robot?.touched()
    seedHide()
    seedShown = false
    if web.canGoBack { web.goBack() } else { host.closePartner(why: "close") }
  }

  /** Stay: gone for this page. */
  @objc private func seedStay() {
    seedStayed = true
    seedHide()
  }

  private func buildSeedBar() {
    seedBar.backgroundColor = .systemBackground
    seedBar.clipsToBounds = true
    seedBar.isHidden = true
    seedBar.translatesAutoresizingMaskIntoConstraints = false
    seedCollapse.isActive = true
    let mark = UIImageView(image: UIImage(systemName: "exclamationmark.shield.fill"))
    mark.tintColor = .systemRed
    mark.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
    mark.setContentHuggingPriority(.required, for: .horizontal)
    mark.isAccessibilityElement = false
    let label = UILabel()
    label.text = SeedGuard.line
    label.font = .systemFont(ofSize: 14, weight: .medium)
    label.textColor = .label
    label.numberOfLines = 0
    let said = UIStackView(arrangedSubviews: [mark, label])
    said.spacing = 8
    said.alignment = .top
    var buttons: [UIButton] = []
    for (title, action) in [(SeedGuard.stay, #selector(seedStay)), (SeedGuard.leave, #selector(seedLeave))] {
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 15, weight: title == SeedGuard.leave ? .semibold : .regular)
      b.setTitleColor(.label, for: .normal)
      b.addTarget(self, action: action, for: .touchUpInside)
      b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
      b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      buttons.append(b)
    }
    let row = UIStackView(arrangedSubviews: [UIView()] + buttons)
    row.spacing = 4
    let column = UIStackView(arrangedSubviews: [said, row])
    column.axis = .vertical
    column.spacing = 2
    column.translatesAutoresizingMaskIntoConstraints = false
    let line = UIView()
    line.backgroundColor = .separator
    line.translatesAutoresizingMaskIntoConstraints = false
    seedBar.addSubview(column)
    seedBar.addSubview(line)
    // below required: collapsed (height 0) wins without a broken-constraint log
    let fit = [
      column.topAnchor.constraint(equalTo: seedBar.topAnchor, constant: 10),
      column.bottomAnchor.constraint(equalTo: seedBar.bottomAnchor, constant: -2),
    ]
    fit.forEach { $0.priority = .defaultHigh }
    NSLayoutConstraint.activate(fit + [
      column.leadingAnchor.constraint(equalTo: seedBar.leadingAnchor, constant: 16),
      column.trailingAnchor.constraint(equalTo: seedBar.trailingAnchor, constant: -8),
      line.leadingAnchor.constraint(equalTo: seedBar.leadingAnchor),
      line.trailingAnchor.constraint(equalTo: seedBar.trailingAnchor),
      line.bottomAnchor.constraint(equalTo: seedBar.bottomAnchor),
      line.heightAnchor.constraint(equalToConstant: 1.0 / max(1, traitCollection.displayScale)),
    ])
  }

  // ── One notice at a time, at the bottom (product decision, 3 Nov) ─────────────
  // The web shell's NoticeBar, in the site window: one line over the page's bottom (the page is never resized), above
  // the page controls when they show; the most important current notice only (PartnerNotice.pick); × hides it for this
  // page; a tap on the line does its one thing (Try again, the top-up) or shows all of it.
  private let noticeBar = UIView()
  private let noticeLine = UILabel()
  private let noticeWhy = UILabel()
  private let noticeAct = UIButton(type: .system)
  private let noticeClose = UIButton(type: .system)
  private var noticeShown: PartnerNotice.Item?
  /** Hidden with × on this page (a new page starts with none). */
  private var noticeHidden = Set<String>()
  /** The line was tapped: all of it shows, on as many lines as it takes. */
  private var noticeOpen = false
  /** An info-only line's own timer (PartnerNotice.fades): it goes after fadeAfter unless opened to read all of it. */
  private var noticeFade: Task<Void, Never>?

  private func buildNoticeBar() {
    noticeBar.isHidden = true
    noticeBar.alpha = 0
    noticeBar.translatesAutoresizingMaskIntoConstraints = false
    // the raised ground of the web NoticeBar: a material (solid under Reduce Transparency), a hairline, a soft shadow
    noticeBar.layer.shadowColor = UIColor.black.cgColor
    noticeBar.layer.shadowOpacity = 0.18
    noticeBar.layer.shadowRadius = 14
    noticeBar.layer.shadowOffset = CGSize(width: 0, height: 6)
    let ground = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
    ground.layer.cornerRadius = 14
    ground.layer.cornerCurve = .continuous
    ground.layer.borderWidth = 1.0 / max(1, traitCollection.displayScale)
    ground.layer.borderColor = UIColor.separator.cgColor
    ground.clipsToBounds = true
    ground.translatesAutoresizingMaskIntoConstraints = false
    noticeBar.addSubview(ground)

    noticeLine.font = .systemFont(ofSize: 14)
    noticeLine.textColor = .label
    noticeLine.numberOfLines = 1
    noticeLine.lineBreakMode = .byTruncatingTail
    noticeLine.isUserInteractionEnabled = true
    noticeLine.isAccessibilityElement = true
    noticeLine.setContentHuggingPriority(.defaultLow, for: .horizontal)
    noticeLine.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    noticeLine.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(noticeTapped)))
    noticeWhy.font = .systemFont(ofSize: 13)
    noticeWhy.textColor = .secondaryLabel
    noticeWhy.numberOfLines = 3
    noticeWhy.isHidden = true

    noticeAct.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
    noticeAct.setTitleColor(.label, for: .normal)
    noticeAct.contentEdgeInsets = UIEdgeInsets(top: 0, left: 10, bottom: 0, right: 10)
    noticeAct.addTarget(self, action: #selector(noticeActTapped), for: .touchUpInside)
    for (b, title, action) in [(continueButton, "Continue", #selector(robotContinue)), (stopButton, "Stop", #selector(robotStop))] {
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 14, weight: title == "Stop" ? .regular : .semibold)
      b.setTitleColor(.label, for: .normal)
      b.addTarget(self, action: action, for: .touchUpInside)
      b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 10, bottom: 0, right: 10)
    }
    noticeClose.setTitle("×", for: .normal)
    noticeClose.titleLabel?.font = .systemFont(ofSize: 20)
    noticeClose.setTitleColor(.secondaryLabel, for: .normal)
    noticeClose.accessibilityLabel = PartnerNotice.hide
    noticeClose.addTarget(self, action: #selector(noticeClosed), for: .touchUpInside)
    noticeClose.widthAnchor.constraint(equalToConstant: 44).isActive = true
    for b in [noticeAct, continueButton, stopButton, noticeClose] {
      b.setContentHuggingPriority(.required, for: .horizontal)
      b.setContentCompressionResistancePriority(.required, for: .horizontal)
      b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    let row = UIStackView(arrangedSubviews: [noticeLine, noticeAct, continueButton, stopButton, noticeClose])
    row.spacing = 2
    row.alignment = .center
    let column = UIStackView(arrangedSubviews: [row, noticeWhy])
    column.axis = .vertical
    column.spacing = 0
    column.isLayoutMarginsRelativeArrangement = true
    column.translatesAutoresizingMaskIntoConstraints = false
    ground.contentView.addSubview(column)
    let lineFloor = noticeLine.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
    lineFloor.priority = .defaultHigh
    NSLayoutConstraint.activate([
      ground.topAnchor.constraint(equalTo: noticeBar.topAnchor),
      ground.bottomAnchor.constraint(equalTo: noticeBar.bottomAnchor),
      ground.leadingAnchor.constraint(equalTo: noticeBar.leadingAnchor),
      ground.trailingAnchor.constraint(equalTo: noticeBar.trailingAnchor),
      column.topAnchor.constraint(equalTo: ground.contentView.topAnchor, constant: 1),
      column.bottomAnchor.constraint(equalTo: ground.contentView.bottomAnchor, constant: -1),
      column.leadingAnchor.constraint(equalTo: ground.contentView.leadingAnchor, constant: 16),
      column.trailingAnchor.constraint(equalTo: ground.contentView.trailingAnchor, constant: -2),
      lineFloor,
    ])
    column.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
  }

  /** Every notice this window has to say now; PartnerNotice.pick chooses the one that shows. */
  private func notices() -> [PartnerNotice.Item?] {
    let name = Self.displayHost(web.url ?? startURL)
    let robotKind: PartnerNotice.Kind = robot?.isLive == true ? .robot : .robotStopped
    return [
      robotLine.map { PartnerNotice.Item(kind: robotKind, line: $0) },
      slowLine.map { PartnerNotice.Item(kind: .slow, line: $0) },
      privateLine.map { PartnerNotice.Item(kind: $0 == PrivateRules.notPrivateLine ? .notPrivate : .privacy, line: $0) },
      walletLine.map { PartnerNotice.Item(kind: .wallet, line: $0) },
      topUpLine.map { PartnerNotice.Item(kind: .topUp, line: $0) },
      siteWalletLine.map { PartnerNotice.Item(kind: .siteWallet, line: $0) },
      Self.isLookAlike(name) ? PartnerNotice.Item(kind: .lookAlike, line: Self.lookAlikeLine) : nil,
      firstOpen ? PartnerNotice.Item(kind: .firstOpen, line: Self.firstOpenLine) : nil,
    ]
  }

  /** The notice line shows the one that wins now (or goes, when there is none). Calm: a fade and a short rise, or
   *  just shown under Reduce Motion; a new line is said to VoiceOver. */
  private func showNotice() {
    guard isViewLoaded else { return }
    let next = PartnerNotice.pick(notices(), hidden: noticeHidden)
    let was = noticeShown
    noticeShown = next
    if next?.key != was?.key {
      noticeOpen = false
      noticeFade?.cancel()
      noticeFade = nil
      if let next, PartnerNotice.fades(next.kind), !UIAccessibility.isVoiceOverRunning {
        let key = next.key
        noticeFade = Task { @MainActor [weak self] in
          try? await Task.sleep(for: .seconds(PartnerNotice.fadeAfter))
          guard !Task.isCancelled else { return }
          self?.noticeFaded(key)
        }
      }
    }
    let still = UIAccessibility.isReduceMotionEnabled
    guard let next else {
      guard !noticeBar.isHidden else { return }
      if still { noticeBar.isHidden = true; noticeBar.alpha = 0; return }
      UIView.animate(withDuration: 0.2, animations: { self.noticeBar.alpha = 0 }) { _ in
        if self.noticeShown == nil { self.noticeBar.isHidden = true }
      }
      return
    }
    let robotLine = next.kind == .robot || next.kind == .robotStopped
    noticeLine.text = next.line
    noticeLine.numberOfLines = noticeOpen ? 0 : 1
    noticeLine.accessibilityLabel = next.line
    let tap = PartnerNotice.tap(next.kind)
    noticeLine.accessibilityTraits = tap == .more ? .staticText : .button
    noticeLine.accessibilityHint = tap == .tryAgain ? PartnerNotice.tryAgain : nil
    let why = next.kind == .robot ? robotWhy : nil
    noticeWhy.text = why
    noticeWhy.isHidden = why?.isEmpty ?? true
    (noticeWhy.superview as? UIStackView)?.directionalLayoutMargins.bottom = noticeWhy.isHidden ? 0 : 12
    let act = PartnerNotice.act(next.kind)
    noticeAct.setTitle(act, for: .normal)
    noticeAct.isHidden = act == nil
    if !robotLine { continueButton.isHidden = true; stopButton.isHidden = true }
    noticeClose.isHidden = !PartnerNotice.closable(next.kind)
    if noticeBar.isHidden || noticeBar.alpha < 1 {
      noticeBar.isHidden = false
      if still {
        noticeBar.alpha = 1
      } else {
        noticeBar.transform = CGAffineTransform(translationX: 0, y: 8)
        UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.9, initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
          self.noticeBar.alpha = 1
          self.noticeBar.transform = .identity
        }
      }
    }
    if next.key != was?.key, isOnScreen { UIAccessibility.post(notification: .announcement, argument: next.line) }
  }

  /** A tap on the line: the slow line loads again, the top-up opens the top-up, any other line shows all of itself. */
  @objc private func noticeTapped() {
    guard let shown = noticeShown else { return }
    switch PartnerNotice.tap(shown.kind) {
    case .tryAgain: tryAgainTapped()
    case .topUp: topUpTapped()
    case .topUpHost: hostTopUpTapped()
    case .more:
      noticeOpen.toggle()
      let still = UIAccessibility.isReduceMotionEnabled
      noticeLine.numberOfLines = noticeOpen ? 0 : 1
      if !still { UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() } }
    }
  }

  @objc private func noticeActTapped() { noticeTapped() }

  /** An info-only line's time is up: it goes as × would (the first-open line for good), unless opened to read it all. */
  private func noticeFaded(_ key: String) {
    guard let shown = noticeShown, shown.key == key, PartnerNotice.fades(shown.kind), !noticeOpen else { return }
    noticeHidden.insert(key)
    if shown.kind == .firstOpen { firstOpen = false }
    refresh()
  }

  /** ×: this notice goes for this page (the first-open line for good, a wallet line until the wallet says another). */
  @objc private func noticeClosed() {
    guard let shown = noticeShown, PartnerNotice.closable(shown.kind) else { return }
    noticeHidden.insert(shown.key)
    if shown.kind == .firstOpen { firstOpen = false }
    if shown.kind == .wallet { walletLine = nil }
    if shown.kind == .siteWallet { topUpHidden.insert(Self.displayHost(web.url)) }
    refresh()
  }

  /** The bar says the page's real host, never a title the page chose; the lock only when it is https and all of it is secure. */
  private func refresh() {
    let url = web.url ?? startURL
    let name = Self.displayHost(url)
    // SiteBar (product decision, 3 Nov): a site's own window says its state under its name; otherwise the page's real address
    if siteName != nil, let status = barState.status, own(name) { hostLabel.text = status } else { hostLabel.text = name }
    // A site app's name only while the page is on that site's own hosts (the recipe's, compiled): a page that moves
    // elsewhere never borrows it, and the bar is then the host alone, as the plain window's (security review, Job 3).
    if siteName != nil {
      let own = recipe?.covers(name) ?? false
      nameLabel.isHidden = !own
      hostLabel.font = .systemFont(ofSize: own ? 11 : 15)
      hostLabel.textColor = own ? .secondaryLabel : .label
    }
    lock.isHidden = !(url.scheme?.lowercased() == "https" && web.hasOnlySecureContent) && !privately
    codeItem?.isHidden = SiteCodes.site(of: web.url) == nil
    // D131: the mode on the address bar: a masked eye in private browsing, the lock otherwise
    lock.image = UIImage(systemName: privately ? "eye.slash.fill" : "lock.fill")
    lock.accessibilityLabel = privately ? "Private browsing" : "Secure page"
    if name != lastHost, !lastHost.isEmpty { walletLine = nil } // it named the site the page has left
    // ST10: the top-up offer, on the site's own hosts only, while its wallet holds $0.00 (a tap: Social trading's Top up)
    // ST13 (review M3): never on a network ZeroFee can't fill (it fills Solana; the network's line says so instead)
    let broke = siteName != nil && pill == "$0.00" && !moveInFlight && (recipe?.covers(name) ?? false) && WalletGate.siteChain(url).flatMap(WalletGate.notCarriedLine) == nil
    if broke, let siteName {
      topUpLine = "Top up your \(siteName)\(WalletGate.siteNetworkName(name).map { " \($0)" } ?? "") wallet privately here."
    } else {
      topUpLine = nil
    }
    // The Browser thesis, part 2: a Browser tab's Top up, on the host WebKit shows, once its own wallet answered there
    let offers = EverySite.offersTopUp(recipe: recipe, kid: kid, siteName: siteName, host: name, answered: solanaHosts, disconnected: WalletConnections.isDisconnected(name, kind: "browser"), hidden: topUpHidden)
    siteWalletLine = offers ? EverySite.topUpLine(name) : nil
    // the slow line, the private-browsing line, the look-alike and first-open lines, the wallet's line and the top-up:
    // one of them at a time on the notice line (modesChanged, below, shows it)
    // The modes follow the host WebKit reports, never anything the page says.
    if name != lastHost {
      let was = lastHost
      lastHost = name
      if let wallet, let recipe, !was.isEmpty, recipe.covers(was) { wallet.left(was) }
      robot?.hostChanged(name)
    }
    modesChanged()
  }

  /** B29: ZeroFee's wallet couldn't answer the site (WalletGate.troubleLine), said on the window, over the site, never
   *  only to the page or behind the window; a tap, or the wallet's next answer, clears it. Nil clears it. */
  private(set) var walletLine: String?
  func walletTrouble(_ line: String?, receipt: Bool = true) {
    guard line != walletLine else { return }
    walletLine = line
    refresh()
    // AgentZero's receipts (the shell's agentzero-steps): every line a site's window shows, exactly as shown (a network's
    // line once per window: ST13 review L1)
    if let line, receipt, siteName != nil { host.emit("device.site.step", ["host": Self.displayHost(startURL), "line": line]) }
  }

  /** ST11: a Move from the window's own ask is on its way (the banner hides) until Social trading says how it went. */
  private var moveInFlight = false
  func moveEnded(_ line: String?) {
    moveInFlight = false
    walletTrouble(line)
  }
  @objc private func finish() { host.closePartner(why: "close") }
  /** Back: the site's own history first; at its first page, the window closes. */
  @objc private func back() {
    if web.canGoBack { web.goBack() } else { host.closePartner(why: "back") }
  }
  /** The site app's own settings (its wallet): the window closes onto them. */
  @objc private func openSettings() { host.closePartner(why: "settings") }

  // HEAT-2026-11-03: the shell's web view stays in the window under this one (.overFullScreen); while a site's window is
  // on screen the shell rests (no animation, no idle read): Host.coverChanged tells it (device.covered)
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    host.coverChanged()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    host.coverChanged()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    guard desktop, stage.bounds.width > 0, stage.bounds.height > 0 else { return }
    let s = min(1, stage.bounds.width / Self.desktopWidth)
    web.transform = .identity
    web.bounds = CGRect(x: 0, y: 0, width: stage.bounds.width / s, height: stage.bounds.height / s)
    web.center = CGPoint(x: stage.bounds.midX, y: stage.bounds.midY)
    web.transform = CGAffineTransform(scaleX: s, y: s)
  }

  /** Google sign-in, passkeys and pop-ups that need their opener don't work in a web view: the person can go to Safari. */
  @objc private func openInSafari() {
    guard let url = web.url ?? Optional(lastSecureURL), url.scheme?.lowercased() == "https" else { return }
    UIApplication.shared.open(url) // awaitingReturn stays: a zerofee:// return from Safari still finds this screen
  }

  // ── What the partner web view may load ───────────────────────────────────────────────────────────────────

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.cancel) }
    // D131 review L: the blank page a tab in the back loads to give its memory back (no network: about:blank)
    if pageDropped, action.targetFrame?.isMainFrame == true, action.request.url?.absoluteString == "about:blank" { return decisionHandler(.allow) }
    let isMain = action.targetFrame?.isMainFrame ?? true
    switch Self.verdict(url: action.request.url, isMainFrame: isMain) {
    case .allow:
      if isMain {
        let target = Self.displayHost(action.request.url)
        // Robot mode: a top-frame move off the recipe ends the mode; one the robot's own click caused is cancelled too.
        // D131: a back or forward swipe while AgentZero acts is the person taking over
        if action.navigationType == .backForward { robot?.touched() }
        if let robot, robot.shouldCancelNavigation(to: target) { return decisionHandler(.cancel) }
        // D131: a page that imitates a crypto site stops on one full-screen page first (Browser and Pay windows alike,
        // security audit L5)
        if let url = action.request.url, let brand = PhishGuard.imitates(target), !PhishWarning.openedAnyway.contains(target) {
          decisionHandler(.cancel)
          stopLookAlike(brand: brand, url: url, host: target)
          return
        }
        // D130 (review M1): only the site set to normal is normal: a link from it to any other site opens privately.
        if !privately, !saysNotPrivate, let url = action.request.url, PrivateBrowsing.usesTor(host: target) {
          decisionHandler(.cancel)
          host.openPrivately(url, from: self)
          return
        }
        setProvider(forLoading: target)
      }
      decisionHandler(.allow)
    case .cancel: decisionHandler(.cancel)
    case .returnLink:
      decisionHandler(.cancel)
      // only zerofee://<known app>/return…, for the app that opened this; while the app lock is up it waits until it is
      // open (a page under the cover still runs: its return link must not prepare anything behind the lock)
      if let url = action.request.url { let host = host; AppLock.shared.whenOpen { _ = host.handleReturn(url) } }
    }
  }

  /** No downloads: a response the web view cannot show, or one sent as an attachment, is cancelled. */
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
    // The document about to commit: provider.js only if ITS host has wallet mode (a redirect may have moved it).
    if response.isForMainFrame { setProvider(forLoading: Self.displayHost(response.response.url)) }
    decisionHandler(response.canShowMIMEType && !disposition.hasPrefix("attachment") ? .allow : .cancel)
  }

  /** ST13: the network the site's page was last on (WalletGate.siteChain, from WebKit's URL only). */
  private var lastChain: String?
  /** ST13: the site switched to a network Spending can't fill: its line under our bar, at once (no sheet: nothing there
   *  could be approved). Back on one it fills: the line goes. On the site's own hosts only. */
  private func chainChanged() {
    // off the site's own hosts: forgotten, so a return to the same network says it again (review ST13 L2)
    guard siteName != nil, recipe?.covers(Self.displayHost(web.url)) == true else { lastChain = nil; return }
    let chain = WalletGate.siteChain(web.url)
    guard chain != lastChain else { return }
    lastChain = chain
    refresh() // the Solana banner hides on a network ZeroFee can't fill (review M3)
    let isChainLine = { (w: String?) in w.map { w in ["bsc", "base", "eth", "tron"].contains(where: { WalletGate.notCarriedLine($0) == w }) } ?? false }
    // never over a move's own line or another of ours (review ST13 L1): only an empty line, the opening/sign-in lines,
    // or another network's line give way
    let mayReplace = !moveInFlight && (walletLine == nil || isChainLine(walletLine) || walletLine == siteName.map(WalletGate.agentOpening) || walletLine == WalletGate.agentSignedIn || walletLine.map { $0.hasPrefix("AgentZero is signing you in") } == true)
    if let chain, let line = WalletGate.notCarriedLine(chain) {
      guard mayReplace else { return }
      // one receipt per network per window, however often the page changes its address (L1)
      let first = !chainsSaid.contains(chain)
      chainsSaid.insert(chain)
      return walletTrouble(line, receipt: first)
    }
    if isChainLine(walletLine) { walletTrouble(nil) }
  }
  /** The networks whose line this window has already written to AgentZero's receipts. */
  private var chainsSaid = Set<String>()

  /** Is this host one of the site's own (its name only shows there)? */
  private func own(_ host: String) -> Bool { recipe?.covers(host) ?? false }

  /** SiteBar: the status under the name and the progress line, changed smoothly (still with Reduce Motion). */
  private func updateBar() {
    guard siteName != nil, !ended else { return }
    let next = SiteBar.state(loading: web.isLoading, signedIn: signedInOnce, signingUntil: signingUntil, signedInAt: signedInAt, now: Date())
    let still = UIAccessibility.isReduceMotionEnabled
    if next.status != barState.status {
      barState = next
      if still { refresh() } else { UIView.transition(with: hostLabel, duration: 0.25, options: .transitionCrossDissolve, animations: { self.refresh() }) }
    } else {
      barState = next
    }
    let show: CGFloat = next.busy ? 1 : 0
    // loading: WebKit's own progress; signing in once loaded: a full quiet line that breathes (still: just shown)
    let p = web.isLoading ? Float(max(0.1, web.estimatedProgress)) : 1
    progressLine.setProgress(p, animated: !still)
    if still { progressLine.alpha = show } else { UIView.animate(withDuration: 0.25) { self.progressLine.alpha = show } }
    progressLine.layer.removeAnimation(forKey: "breathe")
    if next.busy, !web.isLoading, !still {
      let breathe = CABasicAnimation(keyPath: "opacity")
      breathe.fromValue = 1
      breathe.toValue = 0.35
      breathe.duration = 0.9
      breathe.autoreverses = true
      breathe.repeatCount = .infinity
      progressLine.layer.add(breathe, forKey: "breathe")
    }
  }

  /** Product decision, 3 Nov: a sign-out is never a dead end. The steps sign in again by themselves; if they gave up
   *  (__zfSignedOut in their own world), the page loads again once, and then the window says it plainly. */
  private var watchingSignOut = false
  /** D144: signing in again after the site signed the person out (its "signed" ends that task). */
  private var signingAgain = false
  /** D144: a site window's sign-in state for the Activity centre: its own host and the state, nothing else. */
  private func signInEvent(_ state: String) {
    guard siteName != nil else { return }
    host.emit("device.site.signin", ["host": Self.displayHost(startURL), "state": state])
  }
  private var reloadedForSignIn = false
  private func watchSignedOut() {
    guard siteName != nil, signInScript != nil, !watchingSignOut else { return }
    watchingSignOut = true
    lookForSignedOut()
  }
  private func lookForSignedOut() {
    guard !ended, let siteName else { return }
    web.evaluateJavaScript("window.__zfSignedOut === true", in: nil, in: PartnerScripts.signInWorld) { [weak self] result in
      MainActor.assumeIsolated {
        guard let self, !self.ended else { return }
        if case .success(let v) = result, (v as? Bool) == true, Self.displayHost(self.web.url) == Self.displayHost(self.startURL) {
          switch SiteSignOut.next(reloadedAlready: self.reloadedForSignIn) {
          case .reload:
            self.reloadedForSignIn = true
            self.signingAgain = true
            self.signInEvent("signing-again")
            self.web.reload()
          case .say:
            self.signInEvent("failed")
            self.walletTrouble(SiteSignOut.line(siteName))
            return
          }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + SiteSignOut.every) { [weak self] in MainActor.assumeIsolated { self?.lookForSignedOut() } }
      }
    }
  }

  /** Each load's own watch of the sign-in steps (a newer load ends the older watch). */
  private var stepWatch = 0
  /**
   * A sign-in step whose tap changed nothing twice (zf-site-signin.js, "retry"): read once a second from the steps' own
   * world ("zf-signin": the page can't see or set it) as a number, for up to WalletGate.stepWatchFor, until the site is
   * signed in. The window's line is WalletGate's compiled words for that host and step; never the page's.
   */
  private func watchSignInSteps() {
    guard siteName != nil, signInScript != nil else { return }
    stepWatch += 1
    lookForStuckStep(mine: stepWatch, until: Date().addingTimeInterval(WalletGate.stepWatchFor))
  }
  private func lookForStuckStep(mine: Int, until: Date) {
    guard !ended, !signedInOnce, stepWatch == mine, Date() < until else { return }
    // a number or -1 (an element with that id is a window property in every world: review retry, L2)
    web.evaluateJavaScript("typeof window.__zfSignInStuck === \"number\" ? window.__zfSignInStuck : -1", in: nil, in: PartnerScripts.signInWorld) { [weak self] result in
      MainActor.assumeIsolated {
        guard let self, !self.ended, !self.signedInOnce, self.stepWatch == mine else { return }
        // the mark is a place in the recipe of the host the window opened; a page now on another host says nothing (L1)
        let host = Self.displayHost(self.web.url)
        if case .success(let v) = result, let n = v as? NSNumber, host == Self.displayHost(self.startURL), let line = WalletGate.stepStuckLine(host: host, step: n.intValue) {
          return self.walletTrouble(line)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
          MainActor.assumeIsolated { self?.lookForStuckStep(mine: mine, until: until) }
        }
      }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    opening.end("loaded")
    skeleton.stopAnimating()
    // a warm window has its page: it leaves the window a moment later, so WebKit freezes it (WarmSites.freezeAfter)
    if warm { WarmSites.freezeSoon(self) }
    // SiteBar: a page already signed in (its own cookies, no connect asked) never says "Signing you in…" for long: once
    // it has loaded, the status ends 10 s later unless the sign-in comes first
    if let until = signingUntil { signingUntil = min(until, Date().addingTimeInterval(10)) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 10.1) { [weak self] in MainActor.assumeIsolated { self?.updateBar() } }
    watchSignInSteps()
    // the page has loaded: "opening" becomes the sign-in's own line when the site asks; a site already signed in says
    // nothing more after a moment
    if let siteName, walletLine == WalletGate.agentOpening(siteName) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
        MainActor.assumeIsolated { if let self, self.walletLine == WalletGate.agentOpening(siteName), self.signedInOnce { self.walletTrouble(nil) } }
      }
    }
  }
  private var reloadedOnce = false
  /** Is there anything on the page yet? Read from WebKit's own picture of it (a snapshot, no script in the page): a
   *  page that is one or two flat colours (a logo bar on black) hasn't painted. Blank: load it again once, and say so. */
  private func checkPainted(_ siteName: String) {
    guard !ended, !reloadedOnce, !signedInOnce else { return }
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = 32
    web.takeSnapshot(with: config) { [weak self] image, _ in
      MainActor.assumeIsolated {
        guard let self, !self.ended, let image, Self.looksBlank(image) else { return }
        self.reloadedOnce = true
        self.walletTrouble(WalletGate.siteSlow(siteName))
        self.skeleton.startAnimating()
        if self.web.url == nil { self.web.load(URLRequest(url: self.startURL)) } else { self.web.reload() }
        // still blank 8 s after the second load: said plainly, never "trying" for ever (review L5)
        DispatchQueue.main.asyncAfter(deadline: .now() + WalletGate.paintWithin) { [weak self] in
          MainActor.assumeIsolated {
            guard let self, !self.ended, !self.signedInOnce, self.walletLine == WalletGate.siteSlow(siteName) else { return }
            self.web.takeSnapshot(with: config) { image, _ in
              MainActor.assumeIsolated {
                guard !self.ended, let image, Self.looksBlank(image) else { return self.walletTrouble(nil) }
                self.skeleton.stopAnimating()
                self.walletTrouble(WalletGate.siteDidntOpen(siteName))
              }
            }
          }
        }
      }
    }
  }
  /** At most a few colours in a 32-pixel-wide picture of the page: nothing painted but a bar (a blank start). */
  static func looksBlank(_ image: UIImage) -> Bool {
    guard let cg = image.cgImage else { return false }
    let w = cg.width, h = cg.height
    guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue), let data = ctx.data else { return false }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    let px = data.bindMemory(to: UInt32.self, capacity: w * h)
    var counts: [UInt32: Int] = [:]
    for i in 0 ..< (w * h) { counts[px[i] & 0xF0F0F0F0, default: 0] += 1 }
    // painted: some colour other than the two commonest covers more than 1% of the picture (a blank pump.fun start:
    // 0.2%; a dimmed wallet list: 3.7%; a feed: 18-36%, measured on the matrix's own shots)
    let sorted = counts.values.sorted(by: >)
    let rest = sorted.dropFirst(2).reduce(0, +)
    return Double(rest) / Double(w * h) < 0.01
  }
  /** The site's connect has been answered once in this window (siteSignedIn). */
  private(set) var signedInOnce = false

  /** When the person last touched the page (TouchNoter), and this page load's id (a new one each commit). Both are the
   *  host's words to the engine and the core (PartnerWallet's request, IsolatedCore's stamp), never the page's. */
  private var touchedAt: Date?
  private(set) var pageLoad = UUID().uuidString
  var touchedRecently: Bool { touchedAt.map { Date().timeIntervalSince($0) < SignInTap.within } ?? false }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    pageLoad = UUID().uuidString
    opening.mark("first byte")
    seedGuardReset() // a new page: its own words guard, its own Stay
    if let url = webView.url, url.scheme?.lowercased() == "https" { lastSecureURL = url }
    committedOnce = true
    // a new page: what was hidden with × on the last one may say itself again; the slow line is answered
    noticeHidden.removeAll()
    slowLine = nil
    refresh()
  }

  // ── Never blocks: a page that doesn't come in OPEN_WITHIN says so, and the line is Try again ───────────────
  private var committedOnce = false
  private var slowLine: String?

  /** After the first load starts: no page in WalletGate.openWithin → one plain line; tapping it loads again. */
  private func watchOpen() {
    committedOnce = false
    DispatchQueue.main.asyncAfter(deadline: .now() + WalletGate.openWithin) { [weak self] in
      MainActor.assumeIsolated {
        guard let self, !self.ended, !self.committedOnce else { return }
        // the notice line: a tap on it (or Try again) loads again; × hides it for this page
        self.slowLine = WalletGate.slowToOpen(self.siteName ?? Self.displayHost(self.startURL))
        self.refresh()
      }
    }
  }

  @objc private func tryAgainTapped() {
    guard slowLine != nil, !ended else { return }
    slowLine = nil
    refresh()
    web.stopLoading()
    web.load(URLRequest(url: web.url ?? lastSecureURL))
    watchOpen()
  }

  /** window.open / target=_blank load in this same view; a new web view is never made. */
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, Self.verdict(url: url, isMainFrame: true) == .allow { webView.load(URLRequest(url: url)) }
    return nil
  }

  /** Camera and microphone are never granted for the page; iOS asks the person each time. */
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
    decisionHandler(.prompt)
  }

  func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
    decisionHandler(.deny)
  }

  // No JavaScript alert/confirm/prompt panels are implemented (WebKit then declines them), and no TLS challenge handler
  // either: certificates are checked by the system's default handling, with no exceptions.

  /** The page could not load at all: the system sheet opens on the last https page, and the return still works. */
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    skeleton.stopAnimating()
    let e = error as NSError
    guard e.domain == NSURLErrorDomain, (-1999 ... -1000).contains(e.code), e.code != NSURLErrorCancelled, !fellBack else { return }
    // D130: a private page never falls back to Safari (that would be in the clear): it says so and stays.
    if privately {
      privateLine = PrivateRules.didntOpenLine
      return refresh()
    }
    // D131 review M1: a tab in the back never takes the screen (it says so when it's shown)
    // Security audit M2: never while a native approval sheet is open (it would go with the window, unanswered)
    guard isOnScreen, !Host.approvalOpen else { return }
    fellBack = true
    UIView.animate(withDuration: 0.2) { self.note.alpha = 1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      guard let self, self.isOnScreen else { return }
      guard !Host.approvalOpen else {
        self.fellBack = false
        self.note.alpha = 0
        return
      }
      self.host.fallBackToSafari(self.lastSecureURL)
    }
  }

  /** The web process was killed (memory): load the last https page again, never ZeroFee's own start page. */
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    robot?.crashed()
    // review L: a tab in the back loads nothing until it's shown
    if !isOnScreen { pageDropped = true; return }
    webView.load(URLRequest(url: lastSecureURL))
  }
}

extension Host {
  /** A partner's page inside a ZeroFee screen; with a compiled recipe (and an adult's phone), in its declared modes. */
  /** `siteName`: a site's own app (PartnerView.siteName), its name from ZeroFee's compiled list. */
  /** D131: a Browser window is a tab: the one on screen goes to the back (kept, never ended) and the new one opens. */
  /** `keep`: a tab the Browser keeps (default: any Browser window; Social trading's site windows aren't). False: the page
   *  didn't open (not https, or 8 pages open and none may close: "Close a page first."). */
  @discardableResult
  func presentPartner(_ url: URL, recipe: PartnerRecipe? = nil, kid: Bool = false, desktop: Bool = false, siteName: String? = nil, pill: String? = nil, browser: Bool = false, keep: Bool? = nil) -> Bool {
    guard url.scheme?.lowercased() == "https", url.host?.isEmpty == false else { return false }
    let asTab = keep ?? browser
    // review L1/L2: a switch never dismisses a wallet question or Face ID sheet unanswered
    guard mayLeave() else { (sheet as? PartnerView)?.walletTrouble(TabRules.answerFirst, receipt: false); return false }
    // review L: 8 pages open and none may close: the ninth doesn't open (never more than 8)
    let open = tabs.filter { !$0.isClosed }.map { TabRules.Tab(id: $0.tabId, busy: $0.robot?.isLive == true, shown: $0.isOnScreen) }
    if asTab, open.count >= TabRules.cap, TabRules.toClose(open) == nil {
      (sheet as? PartnerView)?.walletTrouble(TabRules.full, receipt: false)
      return false
    }
    // a site's own window opens where it was left this run (the same exact host only)
    // D130: a Browser window (the person's or AgentZero's) is private unless they turned it off for it; any other partner
    // window (Pay's) isn't, and says so.
    let privately = browser && PrivateBrowsing.usesTor(host: PartnerView.displayHost(url))
    let screen = PartnerView(host: self, url: PartnerView.placeFor(url, browser: browser && recipe?.agent != true), recipe: recipe, kid: kid, desktop: desktop, siteName: siteName, pill: pill, privately: privately, saysNotPrivate: !browser)
    screen.reopen = (recipe, kid, desktop, siteName, pill)
    if asTab {
      // room for one more: the oldest page in the back with no AgentZero task closes (TabRules)
      if let id = TabRules.toClose(open) { closeTab(id) }
      tabs.append(screen)
    }
    show(screen)
    return true
  }

  /** May the page on screen be left now (review L1/L2: no wallet question or Face ID sheet waiting on it)? */
  func mayLeave(_ view: PartnerView? = nil) -> Bool {
    let v = view ?? (sheet as? PartnerView)
    return TabRules.mayLeave(walletWaiting: v?.wallet?.isWaiting == true, approvalOpen: Host.approvalOpen)
  }

  /** Put this partner screen on screen: the one there now goes to the back if it's a tab, or ends if it isn't. */
  func show(_ screen: PartnerView) {
    let current = sheet
    if let old = current as? PartnerView, old !== screen {
      if tabs.contains(where: { $0 === old }) { old.wentToBack() } else { PartnerView.keepPlace(of: old); old.endModes() }
    }
    sheet = screen
    let shown = SpeedMark.start("site.window.on.screen")
    let present = { [weak self] in
      guard let self else { return }
      (self.controller.presentedViewController ?? self.controller).present(screen, animated: true) { shown.end("presented") }
      screen.cameToFront(count: self.tabs.count)
    }
    // review M2: dismissed from what presented it, so the window and anything over it (an alert, the tab list) go
    if let current, current !== screen, let presenter = current.presentingViewController {
      presenter.dismiss(animated: false) { present() }
    } else {
      present()
    }
  }

  /** D131: a tab from the list or the Browser's open-pages strip comes on screen. */
  @discardableResult
  func showTab(_ id: String) -> Bool {
    guard let tab = tabs.first(where: { $0.tabId == id && !$0.isClosed }) else { return false }
    if tab.isOnScreen { return true }
    guard mayLeave() else { return false }
    show(tab)
    return true
  }

  /** D131: a tab closes for good (its AgentZero task stops, its wallet requests answer no). */
  @discardableResult
  func closeTab(_ id: String) -> Bool {
    guard let i = tabs.firstIndex(where: { $0.tabId == id }) else { return false }
    let tab = tabs.remove(at: i)
    if tab.isOnScreen { closePartner(why: "close"); return true }
    tab.wentToBack()
    tab.endModes()
    return true
  }

  /** The account wipe (review M-b): every page closes, the one on screen too, and returns once its screen is gone. */
  func closeEverything() async {
    closeAllTabs()
    guard let open = sheet as? PartnerView else { return }
    tabs.removeAll { $0 === open }
    PartnerView.keepPlace(of: open)
    open.endModes()
    sheet = nil
    let presenter = open.presentingViewController
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      guard let presenter else { return done.resume() }
      presenter.dismiss(animated: false) { done.resume() }
    }
  }

  /** Every page in the back closes (clearing site data, the account wipe: review M4). */
  func closeAllTabs() {
    WarmSites.dropAll() // instant-open windows too (clearing site data, the account wipe)
    for t in tabs where !t.isOnScreen { t.wentToBack(); t.endModes() }
    tabs.removeAll { !$0.isOnScreen }
  }

  /** D131 "New tab": this page goes to the back (kept) and the Browser's start page shows. */
  func newTab(from view: PartnerView) {
    guard view.isOnScreen else { return }
    view.wentToBack()
    sheet = nil
    view.dismiss(animated: true)
    guard let app = awaitingReturn else { return }
    awaitingReturn = nil
    emit("device.returned", ["url": webView.url?.absoluteString ?? Host.startURL.absoluteString, "app": app, "why": "new-tab"])
  }

  /**
   * The Browser thesis, part 2: a Browser tab's Top up. The tab goes to the back (kept, as New tab does); once it is off
   * the screen, the Browser under it hears it came back and `device.site.topupHost { host, tab }` (the host WebKit
   * shows), and opens Home's Put money in over itself (D146: only while the Browser is on screen). The tab is shown
   * again by its id (partner.showTab).
   */
  func topUpHost(from view: PartnerView, host h: String) {
    guard view.isOnScreen, tabs.contains(where: { $0 === view }) else { return }
    view.wentToBack()
    sheet = nil
    let app = awaitingReturn
    awaitingReturn = nil
    let tab = view.tabId
    view.dismiss(animated: true) { [weak self] in
      guard let self else { return }
      if let app { self.emit("device.returned", ["url": self.webView.url?.absoluteString ?? Host.startURL.absoluteString, "app": app, "why": "topup"]) }
      self.emit("device.site.topupHost", ["host": h, "tab": tab])
    }
  }

  /** D131: the open pages, for the Browser's strip (no address beyond the host, no page content). */
  func tabList() -> [[String: Any]] {
    tabs.filter { !$0.isClosed }.map { ["id": $0.tabId, "host": PartnerView.displayHost($0.placeURL), "title": $0.tabTitle, "private": $0.privately, "shown": $0.isOnScreen] }
  }

  /** Low memory: tabs in the back let their pages go (each loads again when shown). */
  func tabsMemoryWarning() {
    for t in tabs where !t.isOnScreen { t.dropPageForMemory() }
  }

  /** D131: the tab list over the page: each open page, switch or close; New tab. */
  func showTabList(from view: PartnerView) {
    let list = TabListController(host: self, current: view.tabId)
    let nav = UINavigationController(rootViewController: list)
    // D135: every sheet takes the whole screen, locked at that size, with Close.
    nav.modalPresentationStyle = .overFullScreen
    view.present(nav, animated: true)
  }

  /** A normal Browser window's link to a site that isn't normal: a new private window for it (review M1). */
  func openPrivately(_ url: URL, from view: PartnerView) {
    guard url.scheme?.lowercased() == "https" else { return }
    let app = awaitingReturn
    tabs.removeAll { $0 === view }
    view.endModes()
    view.dismiss(animated: true) { [weak self] in
      guard let self else { return }
      self.sheet = nil
      // a Browser tab's link: its new private window is a Browser tab too, every site with its wallet (EverySite)
      self.presentPartner(url, recipe: view.recipe?.everySite == true ? view.recipe : nil, kid: view.kid, browser: true)
      self.awaitingReturn = app
    }
  }

  /** The same window again in the other mode (the per-site switch): closed, then opened on the page it was on. */
  func reopenPartner(_ view: PartnerView) {
    guard let r = view.reopen, let url = view.web.url ?? Optional(view.startURL), url.scheme?.lowercased() == "https" else { return }
    let app = awaitingReturn
    tabs.removeAll { $0 === view }
    view.endModes()
    view.dismiss(animated: true) { [weak self] in
      guard let self else { return }
      self.sheet = nil
      self.presentPartner(url, recipe: r.recipe, kid: r.kid, desktop: r.desktop, siteName: r.siteName, pill: r.pill, browser: true)
      self.awaitingReturn = app
    }
  }

  /**
   * Close: the screen goes; the app that opened it hears it came back, and `why` ("close", "back": its first page,
   * "settings": the site app's own settings). The screen is dismissed from the one that presented it, so whatever sits
   * on top of it (a connect alert left open) goes too: Close always closes (phone test, 2 Nov, B16).
   */
  func closePartner(why: String = "close") {
    putPartnerAway()
    guard let app = awaitingReturn else { return }
    awaitingReturn = nil
    emit("device.returned", ["url": webView.url?.absoluteString ?? Host.startURL.absoluteString, "app": app, "why": why])
  }

  /** The window on screen goes, dismissed from what presented it (never a bare dismiss on the window, which would take
   *  only what sits over it, an approval sheet included: security audit M2). Nothing is told; awaitingReturn is kept. */
  func putPartnerAway() {
    let closing = sheet
    if let view = closing as? PartnerView { tabs.removeAll { $0 === view } }
    if let view = closing as? PartnerView { PartnerView.keepPlace(of: view) }
    (closing as? PartnerView)?.endModes()
    sheet = nil
    if let presenter = closing?.presentingViewController { presenter.dismiss(animated: true) } else { closing?.dismiss(animated: true) }
  }

  /** The partner page would not load: the system browser sheet opens in its place; awaitingReturn is kept. Never while
   *  a native approval sheet is open (security audit M2): the window stays, its line says the page didn't open. */
  func fallBackToSafari(_ url: URL) {
    guard !Host.approvalOpen else { return }
    let safari = SFSafariViewController(url: url)
    safari.delegate = self
    safari.dismissButtonStyle = .done
    guard let screen = sheet, let presenter = screen.presentingViewController else { return controller.present(safari, animated: true) }
    presenter.dismiss(animated: true) { presenter.present(safari, animated: true) }
    sheet = safari
  }
}

/** ST11: AgentZero's half-height ask over the site: "AgentZero: your pump.fun wallet is empty. Put money in?" · $5 ·
 *  "From your Safe, through Spending." · "Move $5" · "Not now". Fixed words and the compiled site name; ours, native. */
final class TopUpAsk: UIViewController {
  private let site: String
  /** ST13: "Solana" for a site with a wallet per network ("your GMGN Solana wallet"); nil for a one-wallet site. */
  private let network: String?
  private let usd: Int
  private let answer: (Bool) -> Void
  private var answered = false
  init(site: String, network: String? = nil, usd: Int, answer: @escaping (Bool) -> Void) {
    self.site = site
    self.network = network
    self.usd = usd
    self.answer = answer
    super.init(nibName: nil, bundle: nil)
    // D135: the whole screen, locked at that size, with Close at the top (Close = Not now).
    modalPresentationStyle = .overFullScreen
  }
  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let title = UILabel()
    title.text = "AgentZero: your \(site)\(network.map { " \($0)" } ?? "") wallet is empty. Put money in?"
    title.font = .systemFont(ofSize: 17, weight: .semibold)
    title.numberOfLines = 0
    title.textAlignment = .center
    let amount = UILabel()
    amount.text = "$\(usd)"
    amount.font = .systemFont(ofSize: 48, weight: .light)
    amount.textAlignment = .center
    let from = UILabel()
    from.text = "From your Safe, through Spending."
    from.font = .systemFont(ofSize: 14)
    from.textColor = .secondaryLabel
    from.textAlignment = .center
    let move = UIButton(type: .system)
    move.setTitle("Move $\(usd)", for: .normal)
    move.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
    move.backgroundColor = .label
    move.setTitleColor(.systemBackground, for: .normal)
    move.layer.cornerRadius = 26
    move.heightAnchor.constraint(equalToConstant: 52).isActive = true
    move.addTarget(self, action: #selector(moveTapped), for: .touchUpInside)
    let later = UIButton(type: .system)
    later.setTitle("Not now", for: .normal)
    later.titleLabel?.font = .systemFont(ofSize: 16)
    later.setTitleColor(.label, for: .normal)
    later.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    later.addTarget(self, action: #selector(laterTapped), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [title, amount, from, move, later])
    stack.axis = .vertical
    stack.spacing = 14
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    let close = UIButton(type: .system)
    close.setTitle("Close", for: .normal)
    close.titleLabel?.font = .systemFont(ofSize: 17)
    close.setTitleColor(.label, for: .normal)
    close.accessibilityLabel = "Close"
    close.addTarget(self, action: #selector(laterTapped), for: .touchUpInside)
    close.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(close)
    NSLayoutConstraint.activate([
      close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
      close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      close.heightAnchor.constraint(equalToConstant: 44),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 72),
    ])
  }
  private func finish(_ move: Bool) {
    guard !answered else { return }
    answered = true
    dismiss(animated: true) { [answer] in answer(move) }
  }
  @objc private func moveTapped() { finish(true) }
  @objc private func laterTapped() { finish(false) }
  /** A swipe down is "Not now". */
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if !answered { answered = true; answer(false) }
  }
}

/** Sees every touch on the partner page without taking it: the page still gets the touch. */
final class TouchWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private let onTouch: @MainActor () -> Void
  init(_ onTouch: @escaping @MainActor () -> Void) {
    self.onTouch = onTouch
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    MainActor.assumeIsolated { onTouch() }
    state = .failed
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}


/** D131: the open pages as a list over the page: tap one to see it, swipe or × to close it, New tab for the start page. */
final class TabListController: UITableViewController {
  private unowned let host: Host
  private let current: String
  private var rows: [PartnerView] { host.tabs.filter { !$0.isClosed } }

  init(host: Host, current: String) {
    self.host = host
    self.current = current
    super.init(style: .insetGrouped)
  }

  required init?(coder: NSCoder) { fatalError("not from a storyboard") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = TabRules.listTitle
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: TabRules.newTab, style: .plain, target: self, action: #selector(newTab))
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Close", primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "tab")
  }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "tab", for: indexPath)
    let tab = rows[indexPath.row]
    var c = cell.defaultContentConfiguration()
    c.text = tab.tabTitle
    c.secondaryText = PartnerView.displayHost(tab.web.url ?? tab.startURL)
    c.secondaryTextProperties.color = .secondaryLabel
    c.image = UIImage(systemName: tab.privately ? "eye.slash.fill" : "lock.fill")
    c.imageProperties.tintColor = .secondaryLabel
    cell.contentConfiguration = c
    cell.accessoryType = tab.tabId == current ? .checkmark : .none
    let close = UIButton(type: .close, primaryAction: UIAction { [weak self] _ in self?.close(tab.tabId) })
    close.accessibilityLabel = "\(TabRules.closeTab) \(tab.tabTitle)"
    cell.accessoryView = tab.tabId == current ? nil : close
    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    let id = rows[indexPath.row].tabId
    dismiss(animated: true) { [host] in if id != self.current { host.showTab(id) } }
  }

  override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    let id = rows[indexPath.row].tabId
    return UISwipeActionsConfiguration(actions: [UIContextualAction(style: .destructive, title: TabRules.closeTab) { [weak self] _, _, done in self?.close(id); done(true) }])
  }

  private func close(_ id: String) {
    if id == current {
      dismiss(animated: true) { [host] in host.closeTab(id) }
    } else {
      host.closeTab(id)
      tableView.reloadData()
    }
  }

  @objc private func newTab() {
    let id = current
    dismiss(animated: true) { [host] in
      if let view = host.tabs.first(where: { $0.tabId == id }) { host.newTab(from: view) }
    }
  }
}

/** The words guard's one message, heard in its own world only (PartnerScripts.seedGuardWorld): one word, "words" or
 *  "faceid" (SeedGuard.kind); anything else is nothing. Holds the window weakly (the content controller keeps this). */
@MainActor
/** The person's touch on a window's page, as UIKit sees it (a page can't make one): noted, never recognized, so the page
 *  gets every touch as before (SignInTap). */
final class TouchNoter: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private let noted: () -> Void
  init(_ noted: @escaping () -> Void) {
    self.noted = noted
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    noted()
    state = .failed
  }
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

final class SeedGuardHandler: NSObject, WKScriptMessageHandler {
  private weak var view: PartnerView?
  init(view: PartnerView) { self.view = view }
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let view, message.webView === view.web, let kind = SeedGuard.kind(message.body) else { return }
    view.seedGuardHeard(kind)
  }
}
