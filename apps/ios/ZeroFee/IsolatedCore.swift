// The isolated core on the phone (S1.6 phase 2, steps 2–4). With `isolatedCoreWanted` (below, the one-line switch),
// the Host runs the trusted core in its own JavaScriptCore context (CoreContext.swift) instead of the page:
// - the page reaches it only through `core.call` (Bridge.swift), for the core's method families, and hears its events as
//   "core:<event>";
// - its vault is the Keychain, the same items the page's core used, so an existing account carries over;
// - its chip key and EVERY approval are Swift's native sheet (NativeSheet.swift): no page script can answer one;
// - the page loses `key.*` and the core's vault items (it keeps only the Kids parent's own vaults, `zerofee-kid-*`, the
//   guardian's, `zerofee-guardian:*`, and `device.confirm`, which signs nothing).
// It fails CLOSED: if the core's script is missing or doesn't start, the page is still told "isolated" (so it starts no
// core of its own), never reaches the chip key or the core's vault, and every core call answers one Problem. Nothing can
// be signed until the app opens with its core running. Only the developer switch below runs the page's core.
import Foundation
import WebKit

/**
 * The core's vault on the phone: the Keychain, this device only. Never the Kids parent's vaults (those stay the page's).
 * Its secrets (Seal.wanted: the hot wallets' root and seeds, words it holds a while) are sealed to this phone's chip.
 */
final class KeychainCoreVault: CoreVault {
  func get(_ name: String) throws -> Data? {
    guard Seal.wanted(name), Seal.available else { return try Keychain.get(Keychain.coreVault, name) }
    if let sealed = try Keychain.get(Keychain.coreVault, name + Seal.suffix) { return try Seal.open(sealed, name: name) }
    // Kept before sealing: sealed now, and the plain copy goes.
    guard let plain = try Keychain.get(Keychain.coreVault, name) else { return nil }
    try put(name, plain)
    return plain
  }
  func put(_ name: String, _ data: Data) throws {
    guard Seal.wanted(name), Seal.available else { return try Keychain.set(Keychain.coreVault, name, data) }
    try Keychain.set(Keychain.coreVault, name + Seal.suffix, try Seal.seal(data, name: name))
    try Keychain.delete(Keychain.coreVault, name)
  }
  func delete(_ name: String) throws {
    try Keychain.delete(Keychain.coreVault, name)
    if Seal.wanted(name) { try Keychain.delete(Keychain.coreVault, name + Seal.suffix) }
    // The account's own record going is the account wipe (Bridge's vault.delete does the same for the page's core).
    // Only the core's own record (audit IOS-9).
    if name == "state" { Task { @MainActor in Host.accountForgotten() } }
  }
}

extension Host {
  /** THE SWITCH: true runs the core in its own context; false runs the page's core, as before phase 2. */
  static let isolatedCoreWanted = true

  /** The network this build runs (the same start query the page reads): mainnet only when it says so. */
  static var network: String {
    let query = Bundle.main.object(forInfoDictionaryKey: "ZFStartQuery") as? String ?? ""
    return query.split(separator: "&").contains { $0 == "mainnet" || $0.hasPrefix("mainnet=") } ? "mainnet" : "testnet"
  }

  /** What every core call answers when the core didn't start: nothing is signed, and the page never gets the key instead. */
  static let coreNotRunning = "ZeroFee didn't start properly. Your money hasn't moved. Close ZeroFee and open it again."

  /** Start the isolated core, or nil. With the switch on, nil fails closed (pageMayUse, callIsolatedCore): the page's core
   *  never runs. Off the main thread (Host.startCore, D134): it touches only the app bundle, the Keychain and its own queue. */
  nonisolated static func makeIsolatedCore(network: String, delegate: CoreHostDelegate?) -> CoreContext? {
    guard let url = Bundle.main.url(forResource: "zerofee-core", withExtension: "js"),
          let script = try? String(contentsOf: url, encoding: .utf8) else {
      NSLog("[zf-host] the isolated core isn't in this build (run build-web.sh): nothing can be signed")
      return nil
    }
    // The quote relay (Private), if this build was given one: its host joins the allowlist, and nothing else does.
    let relay = RelaySetting.parse(Bundle.main.url(forResource: "relay", withExtension: "json").flatMap { try? Data(contentsOf: $0) })
    do {
      let started = Date()
      let hosts = relay.map { CoreContext.coreHosts.union([$0.host]) } ?? CoreContext.coreHosts
      let core = try CoreContext(script: script, network: network, vault: KeychainCoreVault(), delegate: delegate, allowedHosts: hosts, relay: relay?.base)
      NSLog("[zf-host] isolated core started on %@ in %.0f ms, off the main thread (Private %@)", network, Date().timeIntervalSince(started) * 1000, relay == nil ? "not set up" : "through \(relay!.host)")
      return core
    } catch {
      NSLog("[zf-host] the isolated core didn't start (%@): nothing can be signed", String(describing: error))
      return nil
    }
  }

  /** Told to the page before any of its scripts run: which core it talks to. */
  static func coreModeScript(isolated: Bool) -> WKUserScript {
    WKUserScript(source: "window.__zerofeeCoreMode = \(isolated ? "\"isolated\"" : "\"page\"");", injectionTime: .atDocumentStart, forMainFrameOnly: true)
  }

  /** The core's method families the page may call (the same as CORE_NAMES, without approval.*: approvals are native). */
  /** secondDevice: the guardian's and the Kids parent's second devices, which run in the core (audit IOS-4); never
   *  alerts (the background alerts' own read: native only). */
  /** perps: D119, Hyperliquid's test network only (Trade's Perps tab, behind its PERPS_ON flag). */
  private static let coreFamilies: Set<String> = ["account", "recovery", "tx", "subwallet", "card", "secondDevice", "nostr", "perps"]
  /** Never from the page (audit CORE-01): on the phone the words are checked on ZeroFee's own screen only, so a page
   *  that never saw them can't test guesses against them. The core refuses them too. */
  static let pageNeverCalls: Set<String> = ["recovery.confirm", "recovery.renewConfirm"]

  /** core.call { method, params } from the page → the isolated core. */
  func callIsolatedCore(_ p: [String: Any]) async -> Reply {
    guard let core = await coreWhenStarted() else { return problem("security.core.not-ready", Self.coreNotRunning) }
    guard let method = p["method"] as? String, let family = method.split(separator: ".").first, Self.coreFamilies.contains(String(family)), !Self.pageNeverCalls.contains(method) else {
      return problem("security.bridge.not-allowed", "Only ZeroFee's core answers that.")
    }
    var params = p["params"] as? [String: Any] ?? [:]
    // D29 wallet mode: which site asked is the host's to say, from WebKit (never the engine's claim). A signature the
    // page asks while a wallet-mode page is waiting on one carries that host; any other `site` is removed.
    // Phone test, 3 Nov (pump.fun/GMGN "Continue with ZeroFee" did nothing): subwallet.site.forHost only finds or makes a
    // site's OWN wallet (it signs nothing). It's asked on connect, when no signature is waiting, so the on-screen-signature
    // checks below refused every connect. Its rule: the Browser only, and only for a site whose own page is asking the
    // engine something right now (WebKit's host of a pending request, in any of its windows).
    if method == "subwallet.site.forHost" {
      let origin = (params["site"] as? [String: Any])?["origin"] as? String
      // ruling b: never for a host only AgentZero's own window asks (that window signs in with AgentZero's pocket)
      guard TabRules.forHostAllowed(app: params["app"] as? String, origin: origin, openHosts: askingSiteHosts(agent: false)) else {
        return problem("security.request.not-allowed", "No ZeroFee window is open on that site.")
      }
      return await core.call(method, params)
    }
    // ruling b: AgentZero's pocket, only for a host AgentZero's own window is asking about right now
    if method == "subwallet.site.forAgent" {
      let origin = (params["site"] as? [String: Any])?["origin"] as? String
      guard TabRules.forHostAllowed(app: params["app"] as? String, origin: origin, openHosts: askingSiteHosts(agent: true)) else {
        return problem("security.request.not-allowed", "AgentZero's window isn't open on that site.")
      }
      return await core.call(method, params)
    }
    if Self.siteMethods.contains(method) {
      let waiting = partnerView?.wallet
      let resolved = Self.site(app: params["app"] as? String, walletKind: waiting?.kind, askingHost: waiting?.askingHost)
      // D131 review L1: the engine's own site must be the on-screen tab's waiting host; it's never swapped for another
      if params["app"] as? String == "browser" {
        let engineSite = (params["site"] as? [String: Any])?["origin"] as? String
        guard TabRules.siteMatches(engine: engineSite, waiting: resolved?["origin"]) else {
          return problem("security.request.not-allowed", "That page isn't the one on screen, so nothing was signed.")
        }
        // ruling b/c: which window asked is the host's word, never the engine's: AgentZero's own window signs in only
        // (any other signature from it is refused here), and the core hears whether it was, the touch and the load
        let agentWindow = waiting?.recipe.agent == true
        guard TabRules.agentWindowMay(method, agentWindow: agentWindow) else { return problem("security.request.not-allowed", PartnerRecipe.agentOnlySignsIn) }
        for (k, v) in SignInTap.words(agent: agentWindow, touchedRecently: waiting?.view?.touchedRecently == true, load: waiting?.view?.pageLoad ?? "") { params[k] = v }
      }
      params["site"] = resolved
      // D131 review H1: a site wallet's signature with no page on screen waiting for it is refused, never signed site-less
      if TabRules.refusesSiteless(app: params["app"] as? String, hasSite: !(params["site"] == nil || params["site"] is NSNull)) {
        return problem("security.request.not-allowed", "No page on screen asked for that.")
      }
    }
    // B29's trace: the wallet engine's core calls (Browser's), by name, time and outcome only.
    guard params["app"] as? String == "browser", method.hasPrefix("subwallet."), method.count <= 40 else { return await core.call(method, params) }
    let started = Date()
    let r = await core.call(method, params)
    let took = Int(Date().timeIntervalSince(started) * 1000)
    if let code = (r["problem"] as? [String: Any])?["code"] as? String {
      PartnerWallet.trace.error("core \(method, privacy: .public) for Browser: Problem \(code, privacy: .public) in \(took, privacy: .public) ms")
    } else {
      PartnerWallet.trace.info("core \(method, privacy: .public) for Browser in \(took, privacy: .public) ms")
    }
    return r
  }

  /** The exact hosts (WebKit's) whose page is asking the wallet engine something right now, in any Browser window: the
   *  one on screen, the tabs in the back, the warm windows. forHost answers only for one of these (QA: never host A's
   *  wallet while only host B's page asks). */
  /** `agent`: only AgentZero's own windows (true) or only the person's (false), never one for the other (ruling b). */
  func askingSiteHosts(agent: Bool) -> Set<String> {
    var hosts = Set<String>()
    for v in [partnerView].compactMap({ $0 }) + tabs + WarmSites.views.values.map(\.view) where (v.recipe?.agent == true) == agent { hosts.formUnion(v.wallet?.pendingHosts ?? []) }
    return hosts
  }

  /** Every core method that signs for a site, checks ahead for one (preflight), or makes its own wallet (audit C1:
   *  subwallet.site.forHost): the site is always WebKit's, never the page's (subwallet.sign included). */
  static let siteMethods: Set<String> = ["subwallet.signTx", "subwallet.preflight", "subwallet.sign", "subwallet.signMessage", "subwallet.signTypedData", "subwallet.site.forHost", "subwallet.site.forAgent"]

  /**
   * The `site` a signature carries: the waiting partner window's host (WebKit's), and only for the app whose wallet that
   * window is ("browser", or "pay" in the card's window, §F, where the core then accepts only Gnosis Pay). Nil otherwise.
   */
  static func site(app: String?, walletKind: String?, askingHost: String?) -> [String: String]? {
    guard let app, let walletKind, let askingHost, app == walletKind, ["browser", "pay"].contains(app) else { return nil }
    return ["origin": "https://\(askingHost)"]
  }

  /**
   * The page may not reach the chip key or the core's vault items (the Kids parent's vaults stay its own) whenever the
   * switch is on, whether or not the core started: a core that didn't start fails closed, never back to the page.
   */
  func pageMayUse(_ method: String, _ p: [String: Any]) -> Bool {
    // A site's two-factor codes are the native host's alone, isolated core or not: a page never asks for one (security
    // review of 9004735f (b)); the host passes WebKit's main-frame origin itself.
    if method.hasPrefix("site2fa.") { return false }
    guard Self.isolatedCoreWanted else { return true }
    if method.hasPrefix("key.") { return false }
    // No vault for the page: the guardian's and the Kids parent's second devices run in the isolated core too, their
    // keys sealed there (audit IOS-4).
    if method.hasPrefix("vault.") { return false }
    return true
  }
}

extension Host: CoreHostDelegate {
  func coreApprove(_ words: Any?) async -> Bool {
    guard let words = SheetWords(words) else {
      NSLog("[zf-host] an approval's words couldn't be read: answered no")
      return false
    }
    // D143: a hot key's sheet (the core's `tap`: a trading, site or row wallet) is one tap; Face ID is only for
    // money leaving the Safe, and every chip sheet keeps it
    if words.tap {
      return await presentSheet(words, footer: "Approved with one tap on this phone", faceId: false) { true } ?? false
    }
    return await presentSheet(words, footer: "Approved with Face ID on this phone") {
      guard await ApprovalPass.shared.confirm() else { throw ApprovalPass.refusal() }
      return true
    } ?? false
  }

  func coreKey(_ op: String, _ params: [String: Any]) async -> [String: Any] {
    // The approval key (audit IOS-1b): only the core asks, after the 24 words checked out; the page can't reach these.
    if op == "approval-state" { return ok(["changed": ApprovalPass.facesChanged()]) }
    // Before the words' copy of sites' codes is opened (2FA review MUST 1): Face ID with the account's approval key
    // (biometryCurrentSet), fresh, now. A face added since that key was made fails here (the core then asks the words).
    if op == "approval-confirm" { return ok(["approved": await ApprovalPass.shared.confirm()]) }
    if op == "approval-reset" {
      do {
        try ApprovalPass.resetKey()
        return ok(["reset": true])
      } catch {
        return problem("security.key.refused", "This phone couldn't make its approval key again.")
      }
    }
    guard ["info", "create", "sign", "signAlertsProof", "signChatName", "proof"].contains(op) else { return problem("security.key.refused", "ZeroFee doesn't know that request.") }
    return await key("key." + op, params)
  }

  nonisolated func coreResource(_ name: String) -> Data? {
    guard name == "account_policy.wasm", let url = Bundle.main.url(forResource: "account_policy", withExtension: "wasm") else { return nil }
    return try? Data(contentsOf: url)
  }

  func coreEmit(_ event: String, _ payload: Any) {
    emit("core:" + event, payload as? [String: Any] ?? [:])
  }
}
