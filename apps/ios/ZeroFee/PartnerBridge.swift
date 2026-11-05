// The bridge methods for D29's partner modes (Bridge.swift routes them here):
// - `partner.snapshot / .act / .yourTurn / .done`: the Sign-up Robot (PartnerRobot), from the shell or Pay's run;
// - `device.wallet.reply / .emit`: Browser's engine answering wallet mode (PartnerWallet), app "browser" only;
// - `device.openSite { url }`: the Browser app opens a site inside ZeroFee, wallet mode only where the shell's
//   allowlist (compiled recipes) gave a recipe; `{ nativeApp: true }` (Social trading or Browser, fomo.family only):
//   fomo's own app.
// Plus the account wipe that clears every partner's store, the ZeroFee Keychain and the wallet connections.
import Foundation
import UIKit

/**
 * fomo in its own app. fomo.family has no phone web app (probed 30 Oct): its signed-in app hides itself under 800 CSS
 * px behind a full-screen "get the app" blocker (its own CSS: max-width 799px shows .mobile-blocker, hides
 * .desktop-content), and its signed-out home hides Login there, whatever the user agent (iPhone, iPad, Android, Mac).
 * So Social trading's "Open fomo", and the Browser's fomo (its preset, typed or from history), open the fomo app by its
 * universal link (fomo.family's apple-app-site-association
 * lists "/" for 29Y7P83395.family.fomo.app), and, when the app isn't on this phone, fomo's App Store page (the app-id
 * in its own apple-itunes-app tag). Both addresses are fixed here: the page only says which site, and only
 * fomo.family is accepted. Funding stays in ZeroFee (Social trading's Fund sheet).
 */
enum PartnerApp {
  static let fomoHost = "fomo.family"
  static let fomoLink = URL(string: "https://fomo.family/")!
  static let fomoStore = URL(string: "https://apps.apple.com/app/id6741115427")!

  /** "app" (fomo opened), "store" (not installed: its App Store page opened) or "none" (neither opened). */
  @MainActor static func openFomo() async -> String {
    // universalLinksOnly: true opens only an installed app that claims the link, never a browser.
    if await UIApplication.shared.open(fomoLink, options: [.universalLinksOnly: true]) { return "app" }
    if await UIApplication.shared.open(fomoStore) { return "store" }
    return "none"
  }
}

extension Host {
  var partnerView: PartnerView? { sheet as? PartnerView }
  /** AgentZero's own window: exactly the tab openAgent named (`tab`), on screen or in the back; no tab, no window. */
  func agentView(_ p: [String: Any]) -> PartnerView? {
    guard let id = p["tab"] as? String else { return nil }
    return ([partnerView] + tabs.map { Optional($0) }).compactMap { $0 }.first { $0.tabId == id && !$0.isClosed && $0.robot?.agentMode == true }
  }

  /**
   * A child's phone (§A3), from the core, never from the page: the isolated core's `account.state` says `kid: true`
   * (Security's eebb350); with no isolated core, the core's own saved record in the Keychain (where it keeps `kid`).
   * The shell's `kid` can only add to it: any one of them means no robot mode and no wallet mode.
   */
  func isChildPhone(shellSaid: Any?) async -> Bool {
    let state = await coreWhenStarted()?.call("account.state", ["app": "shell"])
    return ChildPhone.isChild(shellSaid: shellSaid as? Bool == true, accountState: state, coreState: try? Keychain.get(Keychain.coreVault, "state"))
  }

  func partner(_ method: String, _ p: [String: Any]) async -> Reply {
    // AgentZero's browser (D114): Agent (or the shell) opens an https page in a site window with the built-in agent
    // recipe; never on a child's phone (robot mode is then off). The page, a URL or the model never picks the recipe.
    if method == "partner.openAgent" {
      guard p["caller"] == nil || ["agent", "browser"].contains(p["caller"] as? String ?? "") else { return problem("security.bridge.not-allowed", "Only AgentZero opens its browser.") }
      guard let raw = p["url"] as? String, let url = URL(string: raw), url.scheme?.lowercased() == "https", url.port == nil || url.port == 443, let h = url.host?.lowercased() else {
        return problem("partner.open.refused", "AgentZero opens https sites only.")
      }
      // M10: one site per task (the one it opens), and never a number, a look-alike name or a home-network name.
      if let why = PartnerRecipe.agentRefuses(h) { return problem("partner.open.refused", why) }
      let kid = await isChildPhone(shellSaid: p["kid"])
      if kid { return problem("partner.robot.off", "AgentZero's browser isn't on a child's phone.") }
      // a sign-in site's "www." opens on the site's own exact host, where its wallet mode is (ruling a)
      guard presentPartner(PartnerRecipe.agentOpening(url), recipe: .agent(site: PartnerRecipe.agentSite(h)), kid: false, browser: true), let tab = partnerView?.tabId else { return problem("partner.tabs.full", TabRules.full) }
      return ok(["opened": true, "host": h, "tab": tab])
    }
    // M12: forget one site (its sign-in and its storage on this phone), after the person's own yes on a native alert.
    if method == "partner.forgetSite" {
      guard p["caller"] == nil || ["agent", "browser"].contains(p["caller"] as? String ?? "") else { return problem("security.bridge.not-allowed", "Only AgentZero's browser forgets a site.") }
      guard let h = (p["host"] as? String)?.lowercased(), PartnerRecipe.isExactHost(h) else { return problem("partner.forget.refused", "That isn't a site's name.") }
      if let view = partnerView, PartnerView.displayHost(view.web.url) == h { return problem("partner.forget.open", "Close \(h) first, then forget it.") }
      guard await confirmForget(h) else { return ok(["forgot": false]) }
      for item in (try? Logins.list()) ?? [] where item.host == h { try? Logins.remove(item.id) }
      guard await PartnerView.removeStore(forHost: h) else { return problem("partner.forget.open", "Close \(h) first, then forget it.") }
      return ok(["forgot": true])
    }
    // D131, the Browser's Privacy screen: private browsing on or off, a site set to normal, every site's data cleared.
    // The Browser (or the shell) only; each takes effect for the next window opened.
    if ["partner.privacy", "partner.setPrivate", "partner.setNormalSite", "partner.clearSites", "partner.clearPlaces", "partner.setBlockTrackers"].contains(method) {
      guard p["caller"] == nil || ["browser"].contains(p["caller"] as? String ?? "") else { return problem("security.bridge.not-allowed", "Only the Browser changes its privacy.") }
      switch method {
      case "partner.setPrivate":
        guard let on = p["on"] as? Bool else { return problem("partner.privacy.refused", "That isn't on or off.") }
        // less private: the phone's own alert asks, whatever page asked (review L)
        if !on, PrivateBrowsing.isOn, !(await confirmLessPrivate(PrivateRules.turnOffTitle, yes: "Turn off")) { break }
        PrivateBrowsing.isOn = on
        if on { PrivateBrowsing.shared.start() }
      case "partner.setNormalSite":
        guard let h = (p["host"] as? String)?.lowercased(), PartnerRecipe.isExactHost(h), let normal = p["normal"] as? Bool else { return problem("partner.privacy.refused", "That isn't a site's name.") }
        var sites = PrivateBrowsing.normalSites
        if normal, !sites.contains(h), !(await confirmLessPrivate(PrivateRules.useNormal(h) + "?", yes: "Use normal browsing")) { break }
        if normal { sites.insert(h) } else { sites.remove(h) }
        PrivateBrowsing.normalSites = sites
      case "partner.setBlockTrackers":
        // D131: Block trackers on or off, for the next page opened
        guard let on = p["on"] as? Bool else { return problem("partner.privacy.refused", "That isn't on or off.") }
        TrackerRules.isOn = on
        if on { TrackerBlocker.warmUp() }
      case "partner.clearPlaces":
        // History cleared: where each page was left goes too (Places.swift)
        PartnerView.forgetPlaces()
      case "partner.clearSites":
        if partnerView != nil { return problem("partner.forget.open", "Close the open site first, then clear.") }
        guard await confirmClearSites() else { return ok(["cleared": false]) }
        PartnerView.forgetPlaces()
        // review M4: every open page closes first (a store in use isn't removed)
        closeAllTabs()
        return ok(["cleared": await PartnerView.removeAllStores()])
      default: break
      }
      return ok(["private": PrivateBrowsing.isOn, "normalSites": PrivateBrowsing.normalSites.sorted(), "built": PrivateBrowsing.built, "blockTrackers": TrackerRules.isOn])
    }
    // D131: the Browser's open pages (its strip): list, show one, close one. The Browser (or the shell) only.
    if ["partner.tabs", "partner.showTab", "partner.closeTab"].contains(method) {
      guard p["caller"] == nil || p["caller"] as? String == "browser" else { return problem("security.bridge.not-allowed", "Only the Browser opens its pages.") }
      if method == "partner.tabs" { return ok(["tabs": tabList()]) }
      guard let id = p["id"] as? String, id.count <= 64 else { return problem("partner.tab.none", "That page isn't open.") }
      if method == "partner.showTab", !mayLeave() { return problem("partner.tab.busy", TabRules.answerFirst) }
      let done = method == "partner.showTab" ? showTab(id) : closeTab(id)
      if done, method == "partner.showTab" { awaitingReturn = "browser" } // its Close comes back to the Browser
      return done ? ok(["tabs": tabList()]) : problem("partner.tab.none", "That page isn't open.")
    }
    if method == "partner.closeAgent" {
      guard let view = agentView(p), view.robot?.agentMode == true else { return ok(["closed": false]) }
      view.robot?.stopTapped()
      return ok(["closed": true])
    }
    // Browser (D114) reaches AgentZero's own window only: never Pay's sign-up run, nor Pay's recipes.
    if p["caller"] as? String == "browser", agentView(p)?.robot?.agentMode != true { return problem("security.bridge.not-allowed", "Browser drives AgentZero's own window only.") }
    // D131 review M3: AgentZero's task stays with its own tab (the id openAgent gave), on screen or in the back.
    guard let robot = (p["caller"] as? String == "browser" ? agentView(p) : partnerView)?.robot else { return problem("partner.robot.off", "No partner window in robot mode is open.") }
    switch method {
    case "partner.snapshot": return await robot.snapshot()
    case "partner.act": return await robot.act(p)
    case "partner.yourTurn": return await robot.yourTurn(p["why"] as? String ?? "")
    case "partner.done": return robot.done(p["summary"] as? String)
    default: return problem("partner.act.unknown", "ZeroFee doesn't know that request.")
    }
  }

  /** device.wallet.* and device.openSite (the Browser app only: forApps stamps `app`, and nothing else gets through;
   *  Social trading may open its sites, and nothing more). */
  func walletDevice(_ method: String, _ app: String, _ p: [String: Any]) async -> Reply {
    guard app == "browser" || (app == "social" && (method == "device.openSite" || method == "device.site.money" || method == "device.warmSite")) else {
      return problem("shell.device.refused", method == "device.openSite" ? "Only Apps and Browser can open sites." : "Only Browser can do that.")
    }
    switch method {
    case "device.wallet.reply":
      // review H1: the wallet whose request this is (ids are unique across tabs), on screen only
      guard let id = p["id"] as? String, let wallet = ([partnerView] + tabs.map { Optional($0) }).compactMap({ $0 }).first(where: { $0.isOnScreen && $0.wallet?.has(id) == true })?.wallet else {
        PartnerWallet.trace.error("an engine answer with no wallet-mode window open")
        return problem("shell.device.refused", "No page is waiting for that answer.")
      }
      guard wallet.reply(p) else { return problem("shell.device.refused", "No page is waiting for that answer.") }
      return ok(["ok": true])
    case "device.wallet.emit":
      guard let target = p["host"] as? String, let event = p["event"] as? String, let wallet = partnerView?.wallet else { return problem("shell.device.refused", "No wallet-mode page is open.") }
      return ok(["delivered": wallet.emitToPage(host: target, event: event, data: p["data"] ?? NSNull())])
    case "device.site.money":
      // The Browser thesis, part 2 (EverySite.swift): the Browser tells its own tab on that host that its Top up went,
      // `{ host, went: true }` only; the tab says our own line. Never a site's own window, never a pill or words.
      if app == "browser" {
        guard let host = p["host"] as? String, let view = tabs.first(where: { !$0.isClosed && EverySite.browserMayTell(everySite: $0.recipe?.everySite == true, siteName: $0.siteName, went: p["went"], pill: p["pill"], line: p["line"], host: host, tabHost: PartnerView.displayHost($0.web.url)) }) else {
          return problem("shell.device.refused", "No Browser page is open for that.")
        }
        view.toppedUp(host)
        return ok(["ok": true])
      }
      // ST10: Social trading says what the open site's wallet holds now (its pill, its top-up banner). Only Social
      // trading, only for the site window open now (its exact host, a site's own window), only dollars and cents.
      // D131 review L: the site's own window by its host, on screen or in the back
      guard app == "social", let host = p["host"] as? String, let view = ([partnerView] + tabs.map { Optional($0) }).compactMap({ $0 }).first(where: { !$0.isClosed && $0.siteName != nil && (host == PartnerView.displayHost($0.web.url) || host == PartnerView.displayHost($0.startURL)) }) else {
        return problem("shell.device.refused", "No site window is open for that.")
      }
      if let pill = WalletGate.pill(p["pill"]) { view.setPill(pill) }
      // ST11: the move's own words for the window (on its way, or why it didn't), ZeroFee's own page's, short plain text
      if p["line"] != nil {
        // the move's words: shown if they're one plain line; either way the move from the window is over (review M3)
        view.moveEnded(WalletGate.windowLine(p["line"]))
      }
      return ok(["ok": true])
    case "device.openSite":
      guard let text = p["url"] as? String, let url = URL(string: text), url.scheme == "https", url.host?.isEmpty == false else { return problem("shell.device.refused", "ZeroFee opens only secure (https) pages.") }
      // fomo opens in fomo's own app (PartnerApp), from Social trading or the Browser: no window, nothing of ours in it.
      // Only these two apps (forApps stamps `app` last, so an app can't name another) and only fomo.family.
      if p["nativeApp"] as? Bool == true {
        guard app == "social" || app == "browser", PartnerView.displayHost(url) == PartnerApp.fomoHost else { return problem("shell.device.refused", "ZeroFee can't open that app.") }
        return ok(["opened": await PartnerApp.openFomo()])
      }
      // The recipe (wallet mode only) is the shell's, from its compiled allowlist; anything else opens plain.
      // Wallet mode only, the Browser wallet only (a "pay" recipe only ever through Pay's openUrl), in a shape the pinned
      // table accepts: a pinned site's exact hosts and chains, or a typed site's one host and the Browser wallet's chains.
      // A Browser tab (the product Browser thesis, EverySite.swift): the wallet on every site it goes to, never one host.
      let recipe = EverySite.recipe(app: app, accepted: PartnerRecipe(p["recipe"]).flatMap { r -> PartnerRecipe? in PinnedRecipes.acceptForSite(r, openedHost: PartnerView.displayHost(url)) ? r : nil })
      let siteName = Self.siteName(p["siteName"], app: app, host: PartnerView.displayHost(url))
      // Instant open: this site's window was built off screen (WarmSites): shown at once, its held requests asked now.
      if app == "social", mayLeave(), let warm = takeWarm(url, siteName: siteName, kid: await isChildPhone(shellSaid: p["kid"])) {
        if let pill = siteName == nil ? nil : WalletGate.pill(p["pill"]) { warm.setPill(pill) }
        showWarm(warm)
        awaitingReturn = app
        return ok(["ok": true])
      }
      // D131: the Browser's own pages are tabs; Social trading's site windows aren't (they come back to Social)
      guard presentPartner(url, recipe: recipe, kid: await isChildPhone(shellSaid: p["kid"]), desktop: p["desktop"] as? Bool == true, siteName: siteName, pill: siteName == nil ? nil : WalletGate.pill(p["pill"]), browser: app == "browser" || app == "social", keep: app == "browser") else {
        return problem("partner.tabs.full", TabRules.full)
      }
      awaitingReturn = app
      return ok(["ok": true])
    case "device.warmSite":
      // Instant open: Social trading's own sites only (a compiled recipe and site name), built off screen (WarmSites)
      guard let text = p["url"] as? String, let url = URL(string: text), url.scheme == "https", url.host?.isEmpty == false else { return problem("shell.device.refused", "ZeroFee opens only secure (https) pages.") }
      let recipe = PartnerRecipe(p["recipe"]).flatMap { r -> PartnerRecipe? in PinnedRecipes.acceptForSite(r, openedHost: PartnerView.displayHost(url)) ? r : nil }
      let siteName = Self.siteName(p["siteName"], app: app, host: PartnerView.displayHost(url))
      guard recipe != nil, siteName != nil else { return ok(["warm": false]) }
      return ok(["warm": warmSite(url, recipe: recipe, kid: await isChildPhone(shellSaid: p["kid"]), siteName: siteName, pill: WalletGate.pill(p["pill"]))])
    default:
      return problem("shell.device.refused", "ZeroFee doesn't know that request.")
    }
  }

  /**
   * A site's own app's window (Job 3): the name on its bar. Only from the site apps ("social", which the shell stamps),
   * only for a site in the pinned table (a known site, never a typed one), and only short plain text. The page's real
   * host is still shown under it, with the lock. Anything else: nil, the plain window's bar.
   */
  static func siteName(_ raw: Any?, app: String, host: String) -> String? {
    guard app == "social", PinnedRecipes.known(host), let name = raw as? String, (1 ... 24).contains(name.count) else { return nil }
    let plain = name.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || " .-".unicodeScalars.contains($0)) }
    return plain ? name : nil
  }

  /**
   * device.wallet.askConnect { host, name, known, lookAlike } → { allow }: the connect sheet is the host's, native, no
   * Face ID. The host is shown in full, user@ stripped; an unknown site and a look-alike name each get their warning.
   */
  func askConnect(_ app: String, _ p: [String: Any]) async -> Reply {
    guard app == "browser" else { return problem("shell.device.refused", "Only Browser can do that.") }
    var shown = (p["host"] as? String ?? "").lowercased()
    if let at = shown.lastIndex(of: "@") { shown = String(shown[shown.index(after: at)...]) }
    guard !shown.isEmpty, shown.count <= 253 else { return problem("shell.device.refused", "That isn't a website's name.") }
    // A known site with its own wallet (core site-wallets.ts; Browser's engine says `own`): the sheet names that wallet.
    // The name is shown only for a site in the pinned table and only as short plain text (siteName's rule).
    let ownName = p["own"] as? Bool == true ? Self.siteName(p["name"], app: "social", host: shown) : nil
    let walletName = ownName.map { "\($0) wallet" } ?? "wallet"
    // Known is decided here, from the pinned table, never by the page: a typed site always gets the warning. The
    // look-alike line is decided here too; the page can only add it.
    let known = PinnedRecipes.known(shown)
    // D143 (review H3), audit C1: say only what really happens. Every site gets a wallet of its own (core
    // subwallet.site.forHost), never a shared one. A listed site's own wallet trades with no sheet inside the one cap and
    // never pays anyone else; any other site's wallet asks, one tap, before it trades or pays (Face ID is the Safe's).
    var lines = [ownName.map { "It sees only your \($0) wallet, never your Safe. It can trade from that wallet without asking. It can't send money out." } ?? "It gets a wallet of its own, never your Safe or your other wallets. Before it trades or pays, ZeroFee asks you."]
    if !known { lines.append("ZeroFee doesn't know this site. Only connect if you trust it.") }
    if PartnerView.isLookAlike(shown) || p["lookAlike"] as? Bool == true { lines.append(PartnerView.lookAlikeLine) }
    // D146: the question shows only over the window of the site that asked, while it is on screen; otherwise no.
    guard let asking = partnerView, asking.isOnScreen, PartnerView.displayHost(asking.web.url) == shown else { return ok(["allow": false]) }
    var top: UIViewController = controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    let allow = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
      let alert = UIAlertController(title: "Let \(shown) see your \(walletName)'s address?", message: lines.joined(separator: "\n\n"), preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Not now", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: "Let it see", style: .default) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
    if allow { PartnerWallet.setConnected(shown, kind: partnerView?.wallet?.kind ?? "browser", true) }
    return ok(["allow": allow])
  }

  /** "Forget <host>?" on a native alert, naming the site. True = Forget. */
  /** Turning private browsing down (off, or one site to normal): the phone's own alert, never the page's. */
  func confirmLessPrivate(_ title: String, yes: String) async -> Bool {
    var top: UIViewController = controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    return await withCheckedContinuation { done in
      let alert = UIAlertController(title: title, message: PrivateRules.normalWhy, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Keep it private", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: yes, style: .destructive) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
  }

  /** Clear every site's data (D131): the phone's own alert, never the page's. */
  func confirmClearSites() async -> Bool {
    var top: UIViewController = controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    return await withCheckedContinuation { done in
      let alert = UIAlertController(title: SiteStore.clearTitle, message: SiteStore.clearMessage, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: "Clear", style: .destructive) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
  }

  func confirmForget(_ host: String) async -> Bool {
    var top: UIViewController = controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    return await withCheckedContinuation { done in
      let alert = UIAlertController(title: SiteStore.forgetTitle(host), message: SiteStore.forgetMessage, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: "Forget", style: .destructive) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
  }

  /** Forgetting the account (or wiping the phone): every partner's storage, the ZeroFee Keychain and its key, and the wallet connections. */
  static func accountForgotten() {
    Logins.wipe()
    for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix("zf.partner.connected.") { UserDefaults.standard.removeObject(forKey: key) }
    Task { @MainActor in
      // review M4/M-b: every page closes and its screen is gone before the stores go; a store still in use is tried again
      await Host.current?.closeEverything()
      for attempt in 0 ..< 3 {
        if await PartnerView.removeAllStores() { return }
        PartnerWallet.trace.error("account wipe: a site store was still in use (try \(attempt + 1, privacy: .public))")
        try? await Task.sleep(for: .seconds(1))
      }
      PartnerWallet.trace.fault("account wipe: a site store stayed in use; the next wipe clears it")
    }
  }
}
