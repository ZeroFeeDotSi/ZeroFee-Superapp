// The bridge: the web app's `window.webkit.messageHandlers.zerofee.postMessage({ method, params })` lands here and
// its Promise resolves with `{ ok }` or `{ problem }` (the same shapes as the web demo's bridge, docs/interfaces.md).
//
// Only the app's own page may call it: the main frame, served from zerofee-app://app. Every device.* call carries the
// app id that forApps stamped; everything is keyed by it, so an app only ever reaches its own data.
import Foundation
import SafariServices
import UIKit
import WebKit

/** The apps inside ZeroFee (apps/web/src/apps.ts). A request naming anything else is refused. */
let knownApps: Set<String> = ["wallet", "pay", "trade", "extension", "browser", "social", "agent", "earn", "chat"]
let keyPattern = /^[a-z0-9._-]{1,64}$/
private let vaultNamePattern = /^[A-Za-z0-9:._-]{1,200}$/
private let maxSecret = 4096
private let maxStored = 256 * 1024

typealias Reply = [String: Any]

func ok(_ value: Any) -> Reply { ["ok": value] }
func problem(_ code: String, _ what: String, next: String = "Go back") -> Reply {
  ["problem": ["code": code, "whatHappened": what, "money": ["state": "not-involved"], "next": ["kind": "nothing", "label": next]]]
}
private func refuse(_ what: String) -> Reply { problem("shell.device.refused", what) }
private func secretRefused(_ what: String) -> Reply { problem("security.secret.refused", what) }

extension Host: WKScriptMessageHandlerWithReply {
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
    let frame = message.frameInfo
    let origin = frame.securityOrigin
    guard message.webView === webView, Self.isOurPage(isMainFrame: frame.isMainFrame, scheme: origin.protocol, host: origin.host) else {
      dropped("a bridge message", isMainFrame: frame.isMainFrame, scheme: origin.protocol, host: origin.host)
      return replyHandler(nil, "not allowed")
    }
    guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
      return replyHandler(refuse("ZeroFee doesn't know that request."), nil)
    }
    let params = body["params"] as? [String: Any] ?? [:]
    Task { @MainActor in replyHandler(await self.handle(method, params), nil) }
  }

  func handle(_ method: String, _ p: [String: Any]) async -> Reply {
    // The isolated core (S1.6 phase 2): the page asks it through core.call, and no longer reaches its key or vault.
    if method == "core.call" { return await callIsolatedCore(p) }
    guard pageMayUse(method, p) else { return problem("security.bridge.not-allowed", "Only ZeroFee itself can do that.") }
    if method.hasPrefix("vault.") { return vault(method, p) }
    if method.hasPrefix("key.") { return await key(method, p) }
    // The approval sheet's Approve (the shell, not an app): Face ID once, fixed words. { approved: false } = "Not now".
    if method == "device.confirm" {
      // audit L9 (3 Nov): with the isolated core every approval is its own native sheet (IsolatedCore coreApprove), so the
      // page may not raise a bare Face ID prompt of its own
      if Self.isolatedCoreWanted { return problem("security.bridge.not-allowed", "Only ZeroFee itself can do that.") }
      let approved = await ApprovalPass.shared.confirm()
      #if DEBUG
      NSLog("[zf-host] device.confirm: %@", approved ? "approved" : "declined")
      #endif
      return ok(["approved": approved])
    }
    if method == "vision.detect" { return await detect(p) }
    // D146: the app the page has on screen, said by the shell itself (screen-app.ts), never an app: a native sheet asked
    // by another app never shows, and one up when the person moves on is answered Not now
    if method == "shell.screenApp" {
      guard p["app"] == nil, p["caller"] == nil, let screen = p["screen"] as? String, screen.range(of: "^[a-z]{0,20}$", options: .regularExpression) != nil else {
        return problem("security.bridge.not-allowed", "Only ZeroFee itself can do that.")
      }
      Host.screenChanged(screen, money: p["money"] as? Bool == true)
      return ok(["screen": screen])
    }
    // A-4: what Siri or a shortcut asked for (Intents.swift), taken by the shell itself, never an app; read once
    if method == "shell.intent.take" {
      guard p["app"] == nil, p["caller"] == nil else { return problem("security.bridge.not-allowed", "Only ZeroFee itself can do that.") }
      return ok(IntentInbox.shared.take() ?? [:])
    }
    // Settings → Reset this iPhone: the shell's own Settings only, never an app (Host.resetPhone asks Face ID first).
    if method == "shell.reset" {
      guard p["app"] == nil, p["caller"] == nil else { return problem("security.bridge.not-allowed", "Only ZeroFee's own Settings can do that.") }
      return ok(["reset": await resetPhone()])
    }
    // The phone check before "Create my bank" and Settings' Face ID row (H16, H17, H54): a blocker's code, or none.
    if method == "device.phoneCheck" { return ok(["blocker": PhoneCheck.blocker()?.rawValue as Any? ?? NSNull()]) }
    // ZeroFee's own page in iOS Settings (its Face ID switch lives there). Opens nothing else.
    if method == "device.openSettings" {
      guard let url = URL(string: UIApplication.openSettingsURLString) else { return problem("shell.device.refused", "This app can't open Settings.") }
      await UIApplication.shared.open(url)
      return ok(["opened": true])
    }
    // The ZeroFee Keychain (Logins.swift): the shell's own Settings → Passwords only. An app's request carries the app id
    // forApps stamps (`app` or `caller`), so one that does is refused.
    if method.hasPrefix("logins.") {
      guard p["app"] == nil, p["caller"] == nil else { return problem("security.bridge.not-allowed", "Only ZeroFee's own Settings can do that.") }
      return await logins(method, p)
    }
    // The Sign-up Robot (PartnerRobot.swift): the shell, or Agent (the robot loop runs in Agent, D29 §D1).
    if method.hasPrefix("partner.") {
      // Browser drives AgentZero's own window only (D114; PartnerBridge checks it is the agent window), never a sign-up.
      guard p["app"] == nil, p["caller"] == nil || ["pay", "agent", "browser"].contains(p["caller"] as? String ?? "") else { return problem("security.bridge.not-allowed", "Only Pay's sign-up can drive the Sign-up Robot.") }
      return await partner(method, p)
    }
    guard method.hasPrefix("device.") else { return refuse("ZeroFee doesn't know that request.") }
    let app = p["app"] as? String ?? ""
    if app.isEmpty { return refuse("This request didn't say which app it came from.") }
    guard knownApps.contains(app) else { return refuse("ZeroFee doesn't know that app.") }
    switch method {
    case "device.store.get", "device.store.set": return store(method, app, p)
    case "device.secret.get", "device.secret.set": return secret(method, app, p)
    case "device.openUrl": return await openUrl(app, p)
    case "device.notify.schedule", "device.notify.cancel": return await notify(method, app, p)
    case "device.wallet.reply", "device.wallet.emit", "device.openSite", "device.site.money", "device.warmSite": return await walletDevice(method, app, p)
    case "device.wallet.askConnect": return await askConnect(app, p)
    case "device.wallet.forget":
      // Settings → Sites' Disconnect (Browser only): the host's own yes for that site goes too, so a typed site asks again.
      guard app == "browser" else { return refuse("Only Browser can do that.") }
      guard let host = WalletConnections.forgetHost(p["host"] as? String ?? "") else { return refuse("That isn't a website's name.") }
      WalletConnections.forget(host)
      return ok(["forgotten": true])
    case "device.haptic": return haptic(p)
    // Wallet's statement (H-3): iOS's own share sheet, so the file leaves only by the person's choice (ShareFile.swift)
    case "device.shareFile": return await shareFile(app, p)
    case "device.location.once": return await locationOnce(app)
    // AgentZero's mic (D122): words turned into text on this phone only (Speech.swift), never audio to a server
    case "device.speech.listen": return await speechListen(app)
    case "device.speech.stop": return speechStop(app)
    case "device.clipboard.read":
      // iOS shows its own paste banner, but not for what ZeroFee itself copied: a password from the ZeroFee Keychain
      // (marked concealed) is never handed to an app (Security's review, MUST 1).
      guard ConcealedClipboard.mayRead(types: UIPasteboard.general.types) else { return ok(["text": NSNull()]) }
      return ok(["text": UIPasteboard.general.string as Any? ?? NSNull()])
    default: return refuse("ZeroFee doesn't know that request.")
    }
  }

  // ── device.haptic: a tap the person feels (a fill, a keypad press). Nothing in but its kind, nothing out. ──────────

  private func haptic(_ p: [String: Any]) -> Reply {
    switch p["kind"] as? String {
    case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
    case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
    case "tap": UIImpactFeedbackGenerator(style: .light).impactOccurred()
    default: return refuse("That isn't a haptic ZeroFee knows (success, tap or warning).")
    }
    return ok(["ok": true])
  }

  // ── device.store: small data, never secrets, keyed zf.<app>.<key>: sealed at rest (SealedStore.swift, audit M4). ──

  private func store(_ method: String, _ app: String, _ p: [String: Any]) -> Reply {
    let key = p["key"] as? String ?? ""
    guard key.wholeMatch(of: keyPattern) != nil else { return refuse("ZeroFee can't save under that name. Use 1 to 64 of a–z, 0–9, dots and dashes.") }
    let slot = "zf.\(app).\(key)"
    let sealed = Self.sealedSlots.contains(slot) && Seal.available
    if method == "device.store.get" {
      guard let kept = SealedStore.shared.get(slot) else { return ok(["value": NSNull()]) }
      guard sealed else { return ok(["value": kept]) }
      // sealed to this phone's chip; a plain copy from before is sealed now. One that won't open is no copy (never a throw).
      if let bytes = Data(base64Encoded: kept), let open = try? Seal.open(bytes, name: "store:\(slot)"), let text = String(data: open, encoding: .utf8) {
        return ok(["value": text])
      }
      if Data(base64Encoded: kept) == nil {
        Self.sealStore(kept, slot)
        return ok(["value": kept])
      }
      SealedStore.shared.set(slot, nil)
      return ok(["value": NSNull()])
    }
    if p["value"] is NSNull || p["value"] == nil {
      SealedStore.shared.set(slot, nil)
    } else {
      guard let value = p["value"] as? String, value.utf8.count <= maxStored else { return refuse("That's too much to keep here.") }
      if sealed { Self.sealStore(value, slot) } else { SealedStore.shared.set(slot, value) }
    }
    return ok(["ok": true])
  }

  /** What Home shows, as last read (D134: the copy Home paints from at once): money figures, so it is kept sealed to this
   *  phone's chip (Seal.swift, AES-GCM with a key the chip never lets out), inside the sealed store; these bytes open on
   *  this phone only. The old plain copies are listed too, so one written before is sealed the first time it's read. */
  private static let sealedSlots: Set<String> = ["zf.wallet.home-cache.v1", "zf.wallet.last-balances", "zf.wallet.last-total", "zf.wallet.last-spending"]

  private static func sealStore(_ value: String, _ slot: String) {
    // a chip that won't seal keeps nothing (never a plain copy of the money figures)
    guard let box = try? Seal.seal(Data(value.utf8), name: "store:\(slot)") else { return SealedStore.shared.set(slot, nil) }
    SealedStore.shared.set(slot, box.base64EncodedString())
  }

  // ── device.secret: the Keychain, this device only. Values are never logged. ───────────────────────────────────

  private func secret(_ method: String, _ app: String, _ p: [String: Any]) -> Reply {
    let key = p["key"] as? String ?? ""
    guard key.wholeMatch(of: keyPattern) != nil else { return secretRefused("A secret's name is 1 to 64 lower-case letters, digits, dots, dashes or underscores.") }
    let account = "\(app):\(key)"
    do {
      if method == "device.secret.get" {
        let data = try Keychain.get(Keychain.appSecrets, account)
        return ok(["value": data.flatMap { String(data: $0, encoding: .utf8) } as Any? ?? NSNull()])
      }
      if p["value"] is NSNull || p["value"] == nil {
        try Keychain.delete(Keychain.appSecrets, account)
      } else {
        guard let value = p["value"] as? String, !value.isEmpty, value.count <= maxSecret else { return secretRefused("A secret is 1 to \(maxSecret) characters.") }
        try Keychain.set(Keychain.appSecrets, account, Data(value.utf8))
      }
      return ok(["ok": true])
    } catch {
      return secretRefused("This phone won't keep that secret right now.")
    }
  }

  // ── vault.*: the core's own small state and keys (HostVault). Keychain, this device only. Never an app's. ──────

  private func vault(_ method: String, _ p: [String: Any]) -> Reply {
    let name = p["name"] as? String ?? ""
    guard name.wholeMatch(of: vaultNamePattern) != nil else { return refuse("That isn't a name this phone's secure storage keeps.") }
    do {
      switch method {
      case "vault.get":
        return ok(["bytes": try Keychain.get(Keychain.coreVault, name)?.base64EncodedString() as Any? ?? NSNull()])
      case "vault.put":
        guard let b64 = p["bytes"] as? String, let data = Data(base64Encoded: b64), data.count <= maxStored else { return refuse("This phone's secure storage can't keep that.") }
        try Keychain.set(Keychain.coreVault, name, data)
        return ok(["ok": true])
      case "vault.delete":
        try Keychain.delete(Keychain.coreVault, name)
        // The account's own record going is the account wipe: every partner's cookies and storage go with it. Only the
        // core's own record, "state" (audit IOS-9: a name in a page-kept vault, "zerofee-kid-x:state", wiped it all).
        if name == "state" { Host.accountForgotten() }
        return ok(["ok": true])
      default:
        return refuse("ZeroFee doesn't know that request.")
      }
    } catch {
      let status = (error as? Keychain.Failure)?.status ?? 0
      NSLog("[zf-host] vault %@ failed: OSStatus %d", method, status)
      return refuse("This phone's keychain didn't answer (\(status)).")
    }
  }

  // ── device.openUrl: a partner's page inside a ZeroFee screen (PartnerView.swift), or the system browser. https only. ────

  private func openUrl(_ app: String, _ p: [String: Any]) async -> Reply {
    guard let text = p["url"] as? String, let url = URL(string: text), url.scheme == "https", url.host?.isEmpty == false else {
      return refuse("ZeroFee opens only secure (https) pages.")
    }
    if p["mode"] as? String == "external" {
      UIApplication.shared.open(url, options: [:], completionHandler: nil)
    } else if let raw = p["recipe"] {
      // A recipe (D29 §A) comes only from the shell's compiled recipes; one that isn't exactly the shape, or doesn't
      // cover the page it opens, is refused rather than quietly opened plain.
      // Pay's partners come only from the pinned table (PinnedRecipes.swift), exactly; a typed site's wallet-only
      // recipe is Browser's openSite's, never this.
      guard let recipe = PartnerRecipe(raw), PinnedRecipes.acceptForPay(recipe), recipe.covers(PartnerView.displayHost(url)) else { return refuse("ZeroFee can't open that partner that way.") }
      presentPartner(url, recipe: recipe, kid: await isChildPhone(shellSaid: p["kid"]))
    } else {
      // D130 (review M2): a plain page from any app (a link in AgentZero's chat, the Browser's fallback) is a Browser
      // window, private by the person's setting; only Pay's partner windows above are outside it, and say so.
      presentPartner(url, browser: true, keep: false) // not a Browser tab: it comes back to the app that opened it
    }
    awaitingReturn = app
    return ok(["ok": true])
  }

  /** Swift → page: `window.__zerofeeHost.emit(event, payload)` (installed by apps/web/src/host/ios.ts). */
  func emit(_ event: String, _ payload: [String: Any]) {
    webView.callAsyncJavaScript("window.__zerofeeHost && window.__zerofeeHost.emit(event, payload)", arguments: ["event": event, "payload": payload], in: nil, in: .page) { result in
      #if DEBUG
      if case .failure(let error) = result { NSLog("[zf-host] emit %@ failed: %@", event, String(describing: error)) }
      else { NSLog("[zf-host] emitted %@ to %@", event, payload["app"] as? String ?? "?") }
      #endif
    }
  }
}

extension Host: SFSafariViewControllerDelegate {
  /** The person closed the sheet with Done: the app that opened it hears it came back, like the web demo's tab return. */
  nonisolated func safariViewControllerDidFinish(_ sheet: SFSafariViewController) {
    Task { @MainActor in
      guard let app = self.awaitingReturn else { return }
      self.awaitingReturn = nil
      self.emit("device.returned", ["url": self.webView.url?.absoluteString ?? Host.startURL.absoluteString, "app": app])
    }
  }
}
