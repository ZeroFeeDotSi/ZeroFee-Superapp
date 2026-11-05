// Wallet mode in the partner window (D29; Security's rules, backlog/security.md §C, and §F for the card's window).
// provider.js (Browser's, packages/browser/src/provider/provider.js, hash-pinned in PartnerScripts) posts
// `{ id, method, params }` to the `zerofeeWallet` handler, which exists only in a wallet-mode view and never reaches
// the `zerofee` bridge.
//
// Who may ask: the main frame only, with its origin taken from WebKit's `frameInfo.securityOrigin` (never from the
// message), and that origin must equal the strip's host at that moment and be one of the recipe's hosts. Refused
// methods (eth_sign, eth_signTransaction, wallet_addEthereumChain, permissions beyond accounts, anything unlisted)
// are answered here with 4200; the first connect per host is a native sheet (no Face ID). Everything else is relayed
// to Browser's engine in OUR page as the event `device.wallet.request { id, method, params, origin, mainFrame, wallet }`
// (origin and mainFrame from WebKit; `wallet` = "pay" in the Gnosis Pay window, §F, else "browser"), and the engine
// answers with `device.wallet.reply { id, result } | { id, error }` (app "browser" only, an id the host issued only).
// The engine's signatures are the core's to check (D143): a listed site's own wallet inside the one cap signs with no
// sheet; anything else is the core's native one-tap sheet (Face ID is the Safe's), and the host adds "<host> asks" to it.
// A Browser tab (EverySite.swift, the product Browser thesis) has wallet mode on every site it lets have it, and says so
// to the engine with each request (`auto`): the engine connects the site at once with its own new wallet, no sheet,
// unless the person disconnected it.
//
// Host → partner page: `device.wallet.emit { host, event, data }` is delivered only while the committed host is still
// `host`, as `window.dispatchEvent(new CustomEvent("zerofee-wallet:event", { detail: { event, data } }))` in the page
// world: the ONE page-world call the host makes (apps/ios/README.md notes it against §B5).
//
// B29: each hop is traced to the phone's console (subsystem si.zerofee, category wallet-relay: the method, the host, the
// host's id and the time; never an address, a message or a key), and a connect or sign the engine refused, or didn't
// answer in time, is one line on the window itself (WalletGate.troubleLine), not only an answer to the page.
import os
import UIKit
import WebKit

@MainActor
final class PartnerWallet: NSObject, WKScriptMessageHandlerWithReply {
  weak var view: PartnerView?
  unowned let host: Host
  let recipe: PartnerRecipe
  /** "browser" or "pay" (§F): which wallet answers. Never both. */
  let kind: String
  /** Requests relayed to the engine and not answered yet, by the id the HOST issued. */
  private var pending: [String: (reply: @MainActor (Any?, String?) -> Void, pageId: Any, origin: String, signs: Bool, method: String, at: Date)] = [:]
  static let trace = Logger(subsystem: "si.zerofee", category: "wallet-relay")
  /** A method as the trace names it: one ZeroFee answers, else "other" (a page's own words never reach the log). */
  static func traced(_ method: String) -> String { allowed.contains(method) || refusedByName[method] != nil || method == "zerofee_left" ? method : "other" }

  /** The host whose signing request is waiting, for the native sheet's "<host> asks" (WebKit's host, never the page's). */
  var askingHost: String? { pending.values.first { $0.signs }?.origin }
  /** The connect question on screen, answered once (review M2: a tab sent to the back answers it no). */
  private var connectAsk: CheckedContinuation<Bool, Never>?
  private func finishConnect(_ yes: Bool) {
    let ask = connectAsk
    connectAsk = nil
    ask?.resume(returning: yes)
  }

  static let allowed: Set<String> = [
    "eth_requestAccounts", "eth_accounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_requestPermissions", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
    "eth_call", "eth_getBalance", "eth_blockNumber", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getCode",
    // The Wallet Standard's names, exactly as provider.js posts them (tools/ios/wallet-methods.test.ts checks both lists).
    "solana:connect", "solana:disconnect", "solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction",
  ]
  static let connects: Set<String> = ["eth_requestAccounts", "wallet_requestPermissions", "solana:connect"]
  static let needsConnection: Set<String> = WalletGate.signs
  /** Refused by name, with the reason (§C4). Anything not in `allowed` is refused too. */
  static let refusedByName: [String: String] = [
    "eth_sign": "ZeroFee never approves a request it can't show you in plain words.",
    "eth_signTransaction": "ZeroFee only approves a payment it sends itself.",
    "wallet_addEthereumChain": "ZeroFee only uses the networks it knows.",
  ]
  static let pageEvents: Set<String> = ["accountsChanged", "chainChanged", "connect", "disconnect"]

  init(host: Host, recipe: PartnerRecipe) {
    self.host = host
    self.recipe = recipe
    kind = recipe.walletKind
  }

  // ── Connections: remembered per host and wallet (§C5) ───────────────────────────────────────────────────────

  static func isConnected(_ host: String, kind: String) -> Bool { WalletConnections.isConnected(host, kind: kind) }
  static func setConnected(_ host: String, kind: String, _ on: Bool) { WalletConnections.set(host, kind: kind, on) }

  static func error(_ id: Any, _ code: Int, _ message: String) -> [String: Any] { ["id": id, "error": ["code": code, "message": message]] }

  /** Who may ask (§C2), as a plain function the probe checks too. The origin is WebKit's, never the page's. */
  static func mayAsk(isMainFrame: Bool, scheme: String, originHost: String, port: Int, stripHost: String, recipe: PartnerRecipe, kid: Bool) -> Bool {
    guard isMainFrame, scheme == "https" else { return false }
    let origin = port == 0 || port == 443 ? originHost.lowercased() : "\(originHost.lowercased()):\(port)"
    return origin == stripHost && recipe.active(.wallet, host: origin, kid: kid)
  }

  /** The host's own answer to a method, or nil to relay it to the engine. `agent`: AgentZero's own window, which asks
   *  its wallet to connect and sign in only (ruling c): any transaction is refused here, before the engine hears it. */
  static func screen(_ method: String, params: Any, agent: Bool = false) -> (code: Int, message: String)? {
    if agent, !PartnerRecipe.agentMethods.contains(method) { return (4200, PartnerRecipe.agentOnlySignsIn) }
    if let why = refusedByName[method] { return (4200, why) }
    guard allowed.contains(method) else { return (4200, "ZeroFee doesn't answer \(method).") }
    if method == "wallet_requestPermissions" {
      guard let list = params as? [[String: Any]], list.count == 1, Set(list[0].keys) == ["eth_accounts"] else { return (4200, "ZeroFee only shares a wallet's address.") }
    }
    return nil
  }

  // ── Page → host ───────────────────────────────────────────────────────────────────────────────────────────

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
    guard let view, message.webView === view.web else { return replyHandler(nil, "not allowed") }
    // D131: only the tab on screen may ask the wallet; a tab in the back gets no sheet, ever. A warm window (built off
    // screen for an instant open, never shown yet) holds the request and asks it the normal way once it's shown.
    guard view.isOnScreen else {
      if view.hold(retry: { [weak self] in self?.userContentController(ucc, didReceive: message, replyHandler: replyHandler) }, refuse: { replyHandler(nil, TabRules.walletInBack) }) { return }
      return replyHandler(nil, TabRules.walletInBack)
    }
    let frame = message.frameInfo
    let o = frame.securityOrigin
    let strip = PartnerView.displayHost(view.web.url)
    guard Self.mayAsk(isMainFrame: frame.isMainFrame, scheme: o.protocol, originHost: o.host, port: o.port, stripHost: strip, recipe: recipe, kid: view.kid) else {
      // A frame inside the page, another origin, or a page off the recipe: nothing answers.
      Self.trace.error("refused a request from \(String(o.host.prefix(64)), privacy: .private) (main frame \(frame.isMainFrame, privacy: .public)) on \(String(strip.prefix(64)), privacy: .private)")
      return replyHandler(nil, "not allowed")
    }
    guard let body = message.body as? [String: Any], let method = body["method"] as? String, method.count <= 64 else {
      return replyHandler(Self.error(NSNull(), -32602, "{ id, method, params } expected"), nil)
    }
    Self.trace.info("\(String(strip.prefix(64)), privacy: .private) asks \(Self.traced(method), privacy: .public)")
    let pageId: Any = (body["id"] as? NSNumber) ?? (body["id"] as? String).map { String($0.prefix(64)) } ?? NSNull()
    let params: Any = body["params"] ?? [Any]()
    if let refused = Self.screen(method, params: params, agent: recipe.agent) { return replyHandler(Self.error(pageId, refused.code, refused.message), nil) }
    // The "browser" wallet: Browser's engine keeps the connections and asks through device.wallet.askConnect (the
    // host's native sheet). The card's "pay" wallet has no engine yet: the host gates and asks itself.
    let hostGates = kind == "pay"
    // A Browser tab (EverySite) connects every site at once, except one the person disconnected (until the sheet's yes).
    let connected = EverySite.connected(yes: Self.isConnected(strip, kind: kind), everySite: recipe.everySite, kind: kind, disconnected: WalletConnections.isDisconnected(strip, kind: kind))
    // A typed site (not in the pinned table) is never pre-approved outside a Browser tab: until the connect sheet said
    // yes, it gets no accounts and nothing signs, whatever the engine remembers.
    // AgentZero's own window signs in with its own pocket (ruling b): the person's connection to the site doesn't gate it
    switch WalletGate.precheck(method: method, connected: connected || recipe.agent, gated: hostGates || !PinnedRecipes.known(strip)) {
    case .noAccounts: return replyHandler(["id": pageId, "result": [String]()], nil)
    case .notConnected: return replyHandler(Self.error(pageId, 4100, "Connect first."), nil)
    case .relay: break
    }
    Task { @MainActor in
      guard view.isOnScreen else { return replyHandler(Self.error(pageId, 4900, TabRules.walletInBack), nil) }
      if hostGates, Self.connects.contains(method), !connected {
        view.robot?.pauseForSheet()
        guard await self.askToConnect(strip) else { return replyHandler(Self.error(pageId, 4001, "The person said not now."), nil) }
        Self.setConnected(strip, kind: self.kind, true)
      }
      if Self.needsConnection.contains(method) { view.robot?.pauseForSheet() } // the robot never answers a wallet sheet (§D5)
      if let signed = await self.signHere(method, params, site: strip, pageId: pageId) { return replyHandler(signed, nil) }
      self.relay(method: method, params: params, origin: strip, pageId: pageId, reply: replyHandler)
    }
  }

  private func relay(method: String, params: Any, origin: String, pageId: Any, reply: @escaping @MainActor (Any?, String?) -> Void) {
    // review H1: checked again after the hop: a tab that went to the back since the page asked relays nothing
    guard let view, view.isOnScreen else { return reply(Self.error(pageId, 4900, TabRules.walletInBack), nil) }
    guard PartnerView.displayHost(view.web.url) == origin else { return reply(Self.error(pageId, 4900, "The page moved on."), nil) }
    // D131 review H1: one id across every tab (never "w1" in two tabs), so an answer reaches only the page that asked
    let id = "w-" + UUID().uuidString
    pending[id] = (reply, pageId, origin, Self.needsConnection.contains(method), method, Date())
    Self.trace.info("to the engine: \(id, privacy: .public) \(Self.traced(method), privacy: .public) from \(String(origin.prefix(64)), privacy: .private)")
    // `origin` as an https origin (WalletGate.relayOrigin): the engine answers nothing else (B29).
    // `auto`: a Browser tab (EverySite), the host's word like the origin, never the page's: the engine connects at once
    // `agent`, `tap`, `load` (SignInTap): the host's words too; IsolatedCore stamps the same on the core's call
    host.emit("device.wallet.request", ["id": id, "method": method, "params": params, "origin": WalletGate.relayOrigin(origin), "mainFrame": true, "wallet": kind, "app": "browser", "auto": recipe.everySite && kind == "browser", "privateWindow": PrivateBrowsing.usesTor(host: origin), "agent": recipe.agent, "tap": view.touchedRecently, "load": view.pageLoad])
    if WalletGate.connectMethods.contains(method) || WalletGate.signs.contains(method) { watch(id, method: method, origin: origin) }
    // D75: in a site's own window, AgentZero says it is signing you in (fixed words, the compiled name; display only)
    if let name = view.siteName, WalletGate.connectMethods.contains(method) { view.walletTrouble(WalletGate.agentSigningIn(name)) }
  }

  /** A connect or sign the engine hasn't answered in time: the window says so (a sheet over the window: wait for it). */
  /** `after`: how long from now; a sheet seen over the window gives the answer a fresh full window once it goes (B32
   *  review M2: the person's "Let it see" is followed by the engine's answer, never by a false alarm). */
  private func watch(_ id: String, method: String, origin: String, after: TimeInterval? = nil, sawSheet: Bool = false) {
    let wait = after ?? (WalletGate.connectMethods.contains(method) ? WalletGate.connectWithin : WalletGate.answerWithin)
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.pending[id] != nil, let view = self.view else { return }
        if view.presentedViewController != nil { return self.watch(id, method: method, origin: origin, after: 1, sawSheet: true) }
        if sawSheet { return self.watch(id, method: method, origin: origin, after: WalletGate.answerWithin) }
        guard let waiting = self.pending[id] else { return }
        Self.trace.error("no answer to \(id, privacy: .public) \(Self.traced(method), privacy: .public) from \(String(origin.prefix(64)), privacy: .private) after \(Int(Date().timeIntervalSince(waiting.at)), privacy: .public) s")
        view.walletTrouble(WalletGate.troubleLine(method: method, code: nil, site: view.siteName ?? origin, agent: view.siteName != nil))
      }
    }
  }

  // ── Messages and typed data: straight to the core, with the committed host as `site` (Security's e02cb57) ─────────

  static let chainIds: [String: Int] = ["eth": 1, "base": 8453, "gnosis": 100, "arb": 42161]

  static func hex(_ d: Data) -> String { "0x" + d.map { String(format: "%02x", $0) }.joined() }
  static func bytes(hex: String) -> Data? {
    guard hex.hasPrefix("0x"), hex.count % 2 == 0 else { return nil }
    var out = Data()
    var i = hex.index(hex.startIndex, offsetBy: 2)
    while i < hex.endIndex {
      let j = hex.index(i, offsetBy: 2)
      guard let b = UInt8(hex[i ..< j], radix: 16) else { return nil }
      out.append(b)
      i = j
    }
    return out
  }

  /**
   * The card's "pay" wallet only (Browser's engine answers only "browser"; its core calls get `site` from WebKit in
   * IsolatedCore.callIsolatedCore): personal_sign, eth_signTypedData_v4 and solana:signMessage go to the core's own `subwallet.signMessage` /
   * `subwallet.signTypedData` as the recipe's wallet app, with `site` = the committed host from WebKit (never the page's
   * word). Nil = not one of these, or the core isn't the isolated one (then Browser's engine answers it).
   */
  private func signHere(_ method: String, _ params: Any, site: String, pageId: Any) async -> [String: Any]? {
    guard kind == "pay", ["personal_sign", "eth_signTypedData_v4", "solana:signMessage"].contains(method), await host.coreWhenStarted() != nil else { return nil }
    let solana = method == "solana:signMessage"
    let evmChain = recipe.chains.compactMap { c -> String? in ["ethereum": "eth", "arbitrum": "arb"][c] ?? c }.first { Self.chainIds[$0] != nil }
    guard let chain = solana ? "sol" : evmChain else { return Self.error(pageId, 4200, "This partner's recipe has no network for that.") }
    let made = await host.coreAs(kind, "subwallet.create", ["kind": kind, "chain": chain])
    guard let w = made["ok"] as? [String: Any], let id = w["id"] as? String, let address = w["address"] as? String else { return Self.answer(made, pageId: pageId) }
    let siteParam: [String: Any] = ["origin": "https://\(site)"]
    var call: (String, [String: Any])
    switch method {
    case "personal_sign":
      guard let list = params as? [Any], list.count >= 2, let message = list[0] as? String, let who = list[1] as? String, who.lowercased() == address.lowercased() else { return Self.error(pageId, -32602, "personal_sign([message, address]) with this wallet's address expected") }
      let raw = Self.bytes(hex: message) ?? Data(message.utf8)
      call = ("subwallet.signMessage", ["id": id, "message": raw.base64EncodedString(), "site": siteParam])
    case "eth_signTypedData_v4":
      guard let list = params as? [Any], list.count >= 2, let who = list[0] as? String, who.lowercased() == address.lowercased() else { return Self.error(pageId, -32602, "eth_signTypedData_v4([address, typedData]) with this wallet's address expected") }
      call = ("subwallet.signTypedData", ["id": id, "typedData": list[1], "site": siteParam])
    default:
      let p = (params as? [String: Any])?["message"] ?? (params as? [Any])?.first
      guard let message = p as? String else { return Self.error(pageId, -32602, "signMessage({ message }) expected") }
      call = ("subwallet.signMessage", ["id": id, "message": message, "site": siteParam])
    }
    let r = await host.coreAs(kind, call.0, call.1)
    if let ok = r["ok"] as? [String: Any], let sig = ok["signature"] as? String, let raw = Data(base64Encoded: sig) {
      return ["id": pageId, "result": solana ? ["signature": sig] as Any : Self.hex(raw)]
    }
    return Self.answer(r, pageId: pageId)
  }

  /** A core answer that isn't a signature, in EIP-1193 words: declined = 4001, a Problem = 4200 with its plain words. */
  static func answer(_ r: [String: Any], pageId: Any) -> [String: Any] {
    if let ok = r["ok"] as? [String: Any], ok["declined"] as? Bool == true { return error(pageId, 4001, "The person said not now.") }
    let what = (r["problem"] as? [String: Any])?["whatHappened"] as? String ?? "ZeroFee couldn't do that."
    return error(pageId, 4200, what)
  }

  /** `device.wallet.reply` from Browser's engine. Only an id this host issued; the answer goes to the page that asked. */
  func reply(_ p: [String: Any]) -> Bool {
    guard let id = p["id"] as? String, let waiting = pending.removeValue(forKey: id) else {
      Self.trace.error("an answer for \(String(String(describing: p["id"] ?? "nil").prefix(16)), privacy: .public) that no request is waiting for")
      return false
    }
    let took = Int(Date().timeIntervalSince(waiting.at) * 1000)
    if let e = p["error"] as? [String: Any] {
      let code = (e["code"] as? NSNumber)?.intValue ?? 4200
      let known: Set<Int> = [4001, 4100, 4200, 4900, 4901, 4902, -32602, -32603, -32000]
      Self.trace.error("answer \(id, privacy: .public) \(Self.traced(waiting.method), privacy: .public) refused \(code, privacy: .public) in \(took, privacy: .public) ms")
      waiting.reply(Self.error(waiting.pageId, known.contains(code) ? code : 4200, String((e["message"] as? String ?? "Refused").prefix(300))), nil)
      if let view, WalletGate.connectMethods.contains(waiting.method) || WalletGate.signs.contains(waiting.method) {
        view.walletTrouble(WalletGate.troubleLine(method: waiting.method, code: code, site: view.siteName ?? waiting.origin, agent: view.siteName != nil))
      }
    } else {
      Self.trace.info("answer \(id, privacy: .public) \(Self.traced(waiting.method), privacy: .public) in \(took, privacy: .public) ms")
      waiting.reply(["id": waiting.pageId, "result": p["result"] ?? NSNull()], nil)
      // The Browser thesis, part 2: the engine answered this site's Solana connect with its own wallet (a Browser tab):
      // its Top up can show; the page's Disconnect takes it away
      if recipe.everySite, kind == "browser", let view {
        if EverySite.solanaAnswered(method: waiting.method, result: p["result"]) { view.solanaAnswered(waiting.origin) }
        if waiting.method == "solana:disconnect" { view.solanaLeft(waiting.origin) }
      }
      // only when the core signed a plain sign-in with no sheet (the engine's `signedIn`, never the page's): review M1
      if WalletGate.messageMethods.contains(waiting.method), p["signedIn"] as? Bool == true, let view, view.siteName != nil {
        // D75: the site's sign-in was signed: "AgentZero signed you in.", for a few seconds
        view.walletTrouble(WalletGate.agentSignedIn)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak view] in
          MainActor.assumeIsolated { if view?.walletLine == WalletGate.agentSignedIn { view?.walletTrouble(nil) } }
        }
      } else if WalletGate.connectMethods.contains(waiting.method), view?.siteName != nil {
        // ST11: connected on the site's own wallet: if it's empty, our ask comes up (once)
        view?.siteSignedIn()
        // connected: AgentZero's "signing you in" stays until the site's sign-in is answered (or it doesn't ask one)
        let line = view?.walletLine
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak view] in
          MainActor.assumeIsolated { if let view, view.walletLine == line, line?.hasPrefix("AgentZero is signing") == true { view.walletTrouble(nil) } }
        }
      } else if WalletGate.connectMethods.contains(waiting.method) || WalletGate.signs.contains(waiting.method) {
        if view?.walletLine?.hasPrefix("AgentZero is signing") != true { view?.walletTrouble(nil) }
      }
      // B32 review M1: an answer that came after the window said it hadn't takes that line back (the wallet answered)
      if WalletGate.connectMethods.contains(waiting.method) || WalletGate.signs.contains(waiting.method), let view,
         let late = WalletGate.troubleLine(method: waiting.method, code: nil, site: view.siteName ?? waiting.origin, agent: view.siteName != nil),
         view.walletLine == late {
        view.walletTrouble(nil)
      }
    }
    return true
  }

  /** `device.wallet.emit`: delivered only while the committed host is still `host`, and wallet mode is on there. */
  func emitToPage(host target: String, event: String, data: Any) -> Bool {
    guard let view, Self.pageEvents.contains(event) else { return false }
    let strip = PartnerView.displayHost(view.web.url)
    guard strip == target, recipe.active(.wallet, host: strip, kid: view.kid) else { return false }
    view.web.callAsyncJavaScript("window.dispatchEvent(new CustomEvent(\"zerofee-wallet:event\", { detail: { event: e, data: d } }))", arguments: ["e": event, "d": data], in: nil, in: .page) { _ in }
    return true
  }

  /** The committed host changed away from `old` (or the window closes): the engine hears it; waiting asks end as 4900. */
  /** Something is waiting on the person here (a request the engine hasn't answered, or the connect question). */
  var isWaiting: Bool { !pending.isEmpty || connectAsk != nil }

  /** Is this request id one of this wallet's (device.wallet.reply finds the right tab's wallet by it). */
  func has(_ id: String) -> Bool { pending[id] != nil }
  /** The exact hosts (WebKit's) whose page has a request waiting on the engine now: the only ones forHost may answer. */
  var pendingHosts: Set<String> { Set(pending.values.map(\.origin)) }

  /** D131: the tab went to the back: every request still waiting is answered no, the engine hears each site left (so
   *  it drops what it was doing for it: review H1), and an open connect question answers no. No sheet shows behind. */
  func wentBack() {
    finishConnect(false)
    let origins = Set(pending.values.map(\.origin))
    for (_, w) in pending { w.reply(Self.error(w.pageId, 4900, TabRules.walletInBack), nil) }
    pending = [:]
    for o in origins { tellLeft(o) }
  }

  private func tellLeft(_ origin: String) {
    host.emit("device.wallet.request", ["id": "w-" + UUID().uuidString, "method": "zerofee_left", "params": [Any](), "origin": WalletGate.relayOrigin(origin), "mainFrame": true, "wallet": kind, "app": "browser"])
  }

  func left(_ old: String) {
    for (_, w) in pending where w.origin == old { w.reply(Self.error(w.pageId, 4900, "The page moved on."), nil) }
    pending = pending.filter { $0.value.origin != old }
    tellLeft(old)
  }

  /** The connect sheet (§C5): no Face ID; remembered for this host. D143 (review H3): it never promises a Face ID that
   *  isn't asked (a hot key never asks). Only the card's "pay" wallet asks here (hostGates). */
  private func askToConnect(_ origin: String) async -> Bool {
    guard let view else { return false }
    let what = kind == "pay" ? "your card wallet's address" : "this wallet's address"
    let line = kind == "pay" ? "Card wallet: a small separate wallet for your card." : "It sees this wallet's address, never your Safe."
    finishConnect(false)
    return await withCheckedContinuation { done in
      self.connectAsk = done
      let alert = UIAlertController(title: "Let \(origin) see \(what)?", message: line, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Not now", style: .cancel) { [weak self] _ in self?.finishConnect(false) })
      alert.addAction(UIAlertAction(title: "Let it see", style: .default) { [weak self] _ in self?.finishConnect(true) })
      view.present(alert, animated: true)
    }
  }
}

extension Host {
  /** The isolated core, called as one app ("browser" or "pay"), so it opens only that app's kind of wallet (§F). */
  func coreAs(_ app: String, _ method: String, _ params: [String: Any]) async -> Reply {
    guard let core = await coreWhenStarted() else { return problem("security.core.not-ready", Self.coreNotRunning) }
    var p = params
    p["app"] = app
    return await core.call(method, p)
  }
}

extension PartnerRecipe {
  /** §F: "pay" only when the recipe says so (the Gnosis Pay window); otherwise the Browser wallet. Never both. */
  var walletKind: String { walletKindRaw == "pay" ? "pay" : "browser" }
}
