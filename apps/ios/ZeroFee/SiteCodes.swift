// Sites' own two-factor codes (bug report, 4 Nov: pump.fun and GMGN need two-factor; decisions G and K2). Native only.
//
// What it guards: the sites' own accounts (GMGN's withdrawals and whitelist, pump.fun's account), never ZeroFee's
// top-ups (a trading session has no Face ID, decision K2). Where: the Browser's page bar on the sites' exact hosts
// only (pump.fun, www.pump.fun, gmgn.ai, www.gmgn.ai: the same list as packages/core/src/site-2fa.ts, which
// tools/ios/site-codes.test.ts holds equal), on https.
//
// The construction (security review of 9004735f, item (c)):
// - One Secure Enclave P-256 key, application tag `si.zerofee.site2fa.v1`, `[.privateKeyUsage, .biometryCurrentSet]`,
//   kSecAttrAccessibleWhenUnlockedThisDeviceOnly: it never leaves the chip, and a newly enrolled face invalidates it.
// - Each site's secret is sealed to that key's public key with ECIES (Logins.algorithm: cofactor ECDH, X9.63 KDF,
//   AES-GCM). Sealing needs no Face ID; opening is the enclave's ECDH, which it refuses without Face ID.
// - The sealed secret and the entry's plain facts (site, issuer, account, settings) are one generic-password item under
//   service `si.zerofee.site2fa`, This-Device-Only, never synchronizable.
// - The copy for a new phone (decision G: "backed up with the words"): sealed by the core under a key from the 24 words
//   and kept by the relay as ciphertext (packages/core/src/site-2fa-backup.ts, apps/quotes/keep.mjs). Only this host
//   reaches it (the core's site2fa.* is no page's family: IsolatedCore.coreFamilies; Bridge.pageMayUse refuses it too).
// - A code is computed here (RFC 6238 with CryptoKit) after Face ID, shown on a full-screen sheet, and filled only into
//   the main frame of the site's own https page, checked again at the moment of the fill. No page method returns a code.
import Combine
import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import Vision
import WebKit

enum SiteCodes {
  static let service = "si.zerofee.site2fa"
  static let keyTag = Data("si.zerofee.site2fa.v1".utf8)

  /** The sites, by their exact hosts (no wildcard subdomains: security review (a)). */
  static let hosts: [String: [String]] = ["pump.fun": ["pump.fun", "www.pump.fun"], "gmgn": ["gmgn.ai", "www.gmgn.ai"]]
  /** How each site's own setup link names it (issuer, without case, spaces or dots: security review (d)). */
  static let issuers: [String: [String]] = ["pump.fun": ["pumpfun"], "gmgn": ["gmgn", "gmgnai"]]
  static let names: [String: String] = ["pump.fun": "pump.fun", "gmgn": "GMGN"]

  struct Refused: Error { let what: String }

  enum Algorithm: String, Codable { case SHA1, SHA256, SHA512 }

  /** A setup link (or a bare key), read: the secret's bytes and the RFC's settings. */
  struct Setup {
    var secret: Data
    var algorithm: Algorithm = .SHA1
    var digits = 6
    var period = 30
    var issuer = ""
    var account = ""
  }

  struct Item: Codable {
    let site: String
    let issuer: String
    let account: String
    let algorithm: Algorithm
    let digits: Int
    let period: Int
    let addedIso: String
    var backedUp: Bool
    let sealed: Data
  }

  /** The site a page belongs to: https, no port, no user, one of a site's exact hosts. Nil otherwise. */
  static func site(of url: URL?) -> String? {
    guard let url, url.scheme?.lowercased() == "https", url.port == nil, url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return nil }
    return hosts.first { $0.value.contains(host) }?.key
  }

  static func issuerNames(_ site: String, _ issuer: String) -> Bool {
    let flat = issuer.lowercased().replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ".", with: "")
    return issuers[site]?.contains(flat) == true
  }

  // ── Reading a setup link or key ──────────────────────────────────────────────────────────────────────────────

  /** RFC 4648 base32, any case, spaces and padding ignored. Nil when it isn't base32. */
  static func base32(_ text: String) -> Data? {
    let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    var bits = 0, value = 0
    var out = Data()
    for ch in text.uppercased() where ch != " " && ch != "=" && ch != "-" {
      guard let i = alphabet.firstIndex(of: ch) else { return nil }
      value = (value << 5) | i
      bits += 5
      if bits >= 8 {
        out.append(UInt8((value >> (bits - 8)) & 0xff))
        bits -= 8
      }
    }
    return out.isEmpty ? nil : out
  }

  /** A key ZeroFee reads, with a setting it doesn't make (algorithm, length, time step). */
  static let unsupported = "ZeroFee doesn't make this kind of two-factor code."
  /** No secure chip on this device. */
  static let noChip = "This phone has no secure chip to keep codes in."

  /** An otpauth://totp/ link, or a bare base32 key copied from the site's own page (its settings are then the RFC's
   *  defaults, as both sites use). Refuses HOTP, odd settings and a secret under 80 bits. */
  static func read(_ text: String) throws -> Setup {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.count <= 2048 else { throw Refused(what: "That isn't a two-factor key.") }
    if t.lowercased().hasPrefix("otpauth://") {
      guard let c = URLComponents(string: t), c.host?.lowercased() == "totp" else { throw Refused(what: "That isn't a two-factor key.") }
      let q = Dictionary((c.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
      guard let secret = base32(q["secret"] ?? ""), secret.count >= 10 else { throw Refused(what: "That isn't a two-factor key.") }
      var s = Setup(secret: secret)
      if let a = q["algorithm"], !a.isEmpty { guard let alg = Algorithm(rawValue: a.uppercased()) else { throw Refused(what: unsupported) }; s.algorithm = alg }
      if let d = q["digits"], !d.isEmpty { guard let n = Int(d), [6, 7, 8].contains(n) else { throw Refused(what: unsupported) }; s.digits = n }
      if let p = q["period"], !p.isEmpty { guard let n = Int(p), (15 ... 120).contains(n) else { throw Refused(what: unsupported) }; s.period = n }
      let label = (c.path.removingPercentEncoding ?? c.path).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      let parts = label.split(separator: ":", maxSplits: 1).map(String.init)
      s.issuer = q["issuer"].flatMap { $0.isEmpty ? nil : $0 } ?? (parts.count == 2 ? parts[0] : "")
      s.account = String((parts.last ?? "").prefix(120))
      s.issuer = String(s.issuer.prefix(120))
      return s
    }
    guard t.count >= 16, let secret = base32(t), secret.count >= 10 else { throw Refused(what: "That isn't a two-factor key.") }
    return Setup(secret: secret)
  }

  // ── The code (RFC 4226 / RFC 6238) ───────────────────────────────────────────────────────────────────────────

  static func hotp(_ secret: Data, counter: UInt64, digits: Int, algorithm: Algorithm) -> String {
    var big = counter.bigEndian
    let message = Data(bytes: &big, count: 8)
    let key = SymmetricKey(data: secret)
    let mac: [UInt8]
    switch algorithm {
    case .SHA1: mac = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
    case .SHA256: mac = Array(HMAC<SHA256>.authenticationCode(for: message, using: key))
    case .SHA512: mac = Array(HMAC<SHA512>.authenticationCode(for: message, using: key))
    }
    let o = Int(mac[mac.count - 1] & 0x0f)
    let bin = (UInt32(mac[o] & 0x7f) << 24) | (UInt32(mac[o + 1]) << 16) | (UInt32(mac[o + 2]) << 8) | UInt32(mac[o + 3])
    var mod: UInt32 = 1
    for _ in 0 ..< digits { mod *= 10 }
    let code = String(bin % mod)
    return String(repeating: "0", count: digits - code.count) + code
  }

  static func totp(_ secret: Data, at date: Date = Date(), digits: Int, period: Int, algorithm: Algorithm) -> (code: String, secondsLeft: Int) {
    let now = UInt64(max(0, date.timeIntervalSince1970))
    let step = UInt64(period)
    return (hotp(secret, counter: now / step, digits: digits, algorithm: algorithm), Int(step - now % step))
  }

  // ── The enclave key and the items ────────────────────────────────────────────────────────────────────────────

  static var available: Bool { Logins.available }

  private static func access() throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else {
      throw Refused(what: "This phone couldn't set up Face ID for codes. Try again.")
    }
    return ac
  }

  private static func privateKey(context: LAContext? = nil) throws -> SecKey? {
    var q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave, kSecReturnRef as String: true]
    if let context { q[kSecUseAuthenticationContext as String] = context }
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let out else { throw Keychain.Failure(status: status) }
    return (out as! SecKey)
  }

  private static func publicKey() throws -> SecKey {
    guard available else { throw Refused(what: noChip) }
    if let existing = try privateKey(), let pub = SecKeyCopyPublicKey(existing) { return pub }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: keyTag, kSecAttrAccessControl as String: try access()],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let pub = SecKeyCopyPublicKey(key) else {
      throw Refused(what: "The secure chip didn't lock this code. Turn on Face ID in Settings, then try again.")
    }
    return pub
  }

  private static func seal(_ secret: Data) throws -> Data {
    let pub = try publicKey()
    guard SecKeyIsAlgorithmSupported(pub, .encrypt, Logins.algorithm) else { throw Refused(what: noChip) }
    var error: Unmanaged<CFError>?
    guard let sealed = SecKeyCreateEncryptedData(pub, Logins.algorithm, secret as CFData, &error) as Data? else {
      throw Refused(what: "This phone couldn't lock the code in its secure chip. Try again.")
    }
    return sealed
  }

  /** The secret, with a context Face ID approved. Nil: the enclave refused it (the faces changed since it was sealed). */
  private static func open(_ item: Item, context: LAContext) -> Data? {
    guard let key = try? privateKey(context: context) else { return nil }
    var error: Unmanaged<CFError>?
    return SecKeyCreateDecryptedData(key, Logins.algorithm, item.sealed as CFData, &error) as Data?
  }

  static func item(_ site: String) -> Item? {
    guard hosts[site] != nil, let data = try? Keychain.get(service, site) else { return nil }
    return try? JSONDecoder().decode(Item.self, from: data)
  }

  /** Seals and keeps one site's secret on this phone (no Face ID to seal). */
  @discardableResult
  static func keep(_ site: String, _ s: Setup, backedUp: Bool) throws -> Item {
    let item = Item(site: site, issuer: s.issuer, account: s.account, algorithm: s.algorithm, digits: s.digits, period: s.period, addedIso: Logins.now(), backedUp: backedUp, sealed: try seal(s.secret))
    try Keychain.set(service, site, try JSONEncoder().encode(item))
    return item
  }

  static func markBackedUp(_ site: String) {
    guard var it = item(site), !it.backedUp else { return }
    it.backedUp = true
    if let data = try? JSONEncoder().encode(it) { try? Keychain.update(service, site, data) }
  }

  static func remove(_ site: String) { try? Keychain.delete(service, site) }

  /** Every code and the enclave key: account forget, a phone wipe, the first launch after an install, a face change. */
  @discardableResult
  static func wipe() -> Bool {
    let items = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    let key = SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag] as CFDictionary)
    let gone = { (s: OSStatus) in s == errSecSuccess || s == errSecItemNotFound }
    return gone(items) && gone(key)
  }

  // ── The words' copy, through the core (site-2fa-backup.ts) ───────────────────────────────────────────────────

  static func entry(_ s: Setup) -> [String: Any] {
    ["secretHex": s.secret.map { String(format: "%02x", $0) }.joined(), "algorithm": s.algorithm.rawValue, "digits": s.digits, "period": s.period, "issuer": s.issuer, "account": s.account, "addedAt": Int(Date().timeIntervalSince1970 * 1000)]
  }

  static func backUp(_ site: String, _ s: Setup, host: Host) async -> Bool {
    guard let core = await host.coreWhenStarted() else { return false }
    let r = await core.call("site2fa.backup", ["site": site, "entry": entry(s)])
    return r["ok"] != nil
  }

  /** What the words' copy gave (review MUST 1: the core opens it only after Face ID with the account's key, or the 24
   *  words typed when the faces changed). `none`: nothing kept for these sites; `declined`: the person said no (or typed
   *  other words); `unreachable`: ZeroFee's backup didn't answer, so whether there is one isn't known (never set-up). */
  enum Restore { case entries([String: Setup]), declined, unreachable }

  static func restored(_ sites: [String], host: Host) async -> Restore {
    guard let core = await host.coreWhenStarted() else { return .unreachable }
    let r = await core.call("site2fa.restore", ["sites": sites])
    if let code = (r["problem"] as? [String: Any])?["code"] as? String { return code == "site2fa.off" ? .entries([:]) : .unreachable }
    guard let ok = r["ok"] as? [String: Any] else { return .unreachable }
    if ok["declined"] as? Bool == true { return .declined }
    var out: [String: Setup] = [:]
    for (site, e) in ok["entries"] as? [String: Any] ?? [:] { if let e = e as? [String: Any], let s = setup(from: e) { out[site] = s } }
    return .entries(out)
  }

  static func setup(from e: [String: Any]) -> Setup? {
    guard let hexText = e["secretHex"] as? String else { return nil }
    var bytes = Data()
    var i = hexText.startIndex
    while i < hexText.endIndex, let j = hexText.index(i, offsetBy: 2, limitedBy: hexText.endIndex), let b = UInt8(hexText[i ..< j], radix: 16) {
      bytes.append(b)
      i = j
    }
    guard bytes.count >= 10, let alg = Algorithm(rawValue: e["algorithm"] as? String ?? ""), let digits = e["digits"] as? Int, [6, 7, 8].contains(digits), let period = e["period"] as? Int, (15 ... 120).contains(period) else { return nil }
    return Setup(secret: bytes, algorithm: alg, digits: digits, period: period, issuer: e["issuer"] as? String ?? "", account: e["account"] as? String ?? "")
  }

  /** Every site's kept entry on this phone (what a face change takes). */
  static func items() -> [Item] { hosts.keys.sorted().compactMap(item) }

  static func forgetBackup(_ site: String, host: Host) async {
    guard let core = await host.coreWhenStarted() else { return }
    _ = await core.call("site2fa.forget", ["site": site])
  }

  // ── The page's QR code, read from what's on screen ───────────────────────────────────────────────────────────

  /** The otpauth:// link in a QR code on the page's screen (the person can't scan their own phone's screen). */
  static func qrLink(on web: WKWebView) async -> String? {
    guard let image = try? await web.takeSnapshot(configuration: nil), let cg = image.cgImage else { return nil }
    return await Task.detached(priority: .userInitiated) {
      let request = VNDetectBarcodesRequest()
      request.symbologies = [.qr]
      try? VNImageRequestHandler(cgImage: cg).perform([request])
      return (request.results ?? []).compactMap(\.payloadStringValue).first { $0.lowercased().hasPrefix("otpauth://totp/") }
    }.value
  }
}

// ── The flow, from the Browser's page bar (PartnerView.siteCodeTapped) ─────────────────────────────────────────────

extension SiteCodes {
  /** The code button on a site's own page: its code after Face ID, or setting it up (or bringing it back from the words). */
  @MainActor static func open(in view: PartnerView, host: Host) async {
    guard let site = site(of: view.web.url), let name = names[site] else { return }
    guard available else { return await say(host, noChip) }
    if item(site) == nil {
      // Review G2: a backup that didn't answer is never "set it up": the person may be set up already.
      switch await restored([site], host: host) {
      case .declined: return
      case .unreachable: return await say(host, "ZeroFee's backup didn't answer. Tap the key button again in a minute.")
      case let .entries(back): if let s = back[site] { _ = try? keep(site, s, backedUp: true) }
      }
    }
    if let it = item(site) {
      await show(it, site: site, name: name, in: view, host: host)
    } else {
      await setUp(site: site, name: name, in: view, host: host)
    }
  }

  /** Face ID for a code, or what stopped it said on screen (review G1); a cancel stays quiet. Nil: no context. */
  @MainActor private static func faceId(_ reason: String, host: Host) async -> LAContext? {
    var why: NSError?
    if !LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &why) {
      let locked = (why as? LAError)?.code == .biometryLockout
      await say(host, locked ? "Face ID is locked. Lock your phone, open it with your passcode, then try again." : "Face ID isn't set up on this phone. Turn it on in Settings.")
      return nil
    }
    return try? await Logins.approvedContext(reason: reason)
  }

  @MainActor private static func show(_ it: Item, site: String, name: String, in view: PartnerView, host: Host) async {
    guard let context = await faceId("Show your \(name) code", host: host) else { return }
    defer { context.invalidate() }
    guard var secret = open(it, context: context) else { return await facesChanged(site: site, name: name, host: host) }
    defer { secret.resetBytes(in: 0 ..< secret.count) }
    var backedUp = it.backedUp
    if !backedUp {
      let s = Setup(secret: secret, algorithm: it.algorithm, digits: it.digits, period: it.period, issuer: it.issuer, account: it.account)
      backedUp = await backUp(site, s, host: host)
      if backedUp { markBackedUp(site) }
    }
    let code = { totp(secret, digits: it.digits, period: it.period, algorithm: it.algorithm) }
    let removed: Bool? = await host.presentModal { finish in
      AnyView(SiteCodeView(name: name, backedUp: backedUp, code: code, fill: { await view.fillSiteCode($0, site: site) }, remove: { finish(true) }, close: { finish(false) }))
    }
    if removed == true { try? await Task.sleep(for: .milliseconds(600)) }
    if removed == true, await confirmRemove(name, host: host) {
      remove(site)
      await forgetBackup(site, host: host)
    }
  }

  /**
   * Face ID was approved, but the chip refused the codes' key: the faces changed since it was made, so no code on this
   * phone can be opened again. The key and every code go; those backed up come back from the words' copy, which the
   * core opens only with the 24 words typed now (review MUST 1). Review G3: each site lost is named, backed up or not.
   */
  @MainActor private static func facesChanged(site: String, name: String, host: Host) async {
    let had = items()
    wipe()
    try? await Task.sleep(for: .milliseconds(300))
    let backedSites = had.filter(\.backedUp).map(\.site)
    let result: Restore = backedSites.isEmpty ? .entries([:]) : await restored(backedSites, host: host)
    var back = Set<String>()
    if case let .entries(found) = result { for (s, setup) in found where (try? keep(s, setup, backedUp: true)) != nil { back.insert(s) } }
    var lines: [String] = []
    let wasBacked = had.first { $0.site == site }?.backedUp ?? false
    if back.contains(site) {
      lines.append("Face ID changed. Your \(name) code came back from your 24 words. Tap the key button again.")
    } else if !wasBacked {
      lines.append("Face ID changed, so this phone removed your \(name) code. It wasn't backed up yet. Set it up again on \(name)'s page.")
    } else if case .declined = result {
      lines.append("Face ID changed, so this phone removed your \(name) code. To bring it back, tap the key button and type your 24 words.")
    } else {
      lines.append("Face ID changed, so this phone removed your \(name) code. ZeroFee's backup didn't answer. Tap the key button again in a minute.")
    }
    for other in had where other.site != site {
      let n = names[other.site] ?? other.site
      lines.append(back.contains(other.site) ? "Your \(n) code came back too." : other.backedUp ? "Your \(n) code was removed too. To bring it back, tap the key button on \(n)'s page." : "Your \(n) code was removed too. It wasn't backed up yet. Set it up again on \(n)'s page.")
    }
    await say(host, lines.joined(separator: "\n\n"))
  }

  @MainActor private static func setUp(site: String, name: String, in view: PartnerView, host: Host) async {
    let added: Bool? = await host.presentModal { finish in
      AnyView(SiteCodeAddView(name: name, readPage: { await qrLink(on: view.web) }, add: { text in
        do {
          let s = try read(text)
          if !s.issuer.isEmpty, !issuerNames(site, s.issuer) { return "That key is for \(s.issuer.prefix(30)), not \(name)." }
          try keep(site, s, backedUp: false)
          if await backUp(site, s, host: host) { markBackedUp(site) }
          finish(true)
          return nil
        } catch let r as Refused {
          return r.what
        } catch {
          return "This phone didn't save the code. Try again."
        }
      }, close: { finish(nil) }))
    }
    guard added == true, let it = item(site) else { return }
    try? await Task.sleep(for: .milliseconds(600)) // the set-up sheet is still going away
    await show(it, site: site, name: name, in: view, host: host)
  }

  @MainActor private static func say(_ host: Host, _ line: String) async {
    var top: UIViewController = host.controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      let alert = UIAlertController(title: nil, message: line, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Close", style: .default) { _ in done.resume() })
      presenter.present(alert, animated: true)
    }
  }

  @MainActor private static func confirmRemove(_ name: String, host: Host) async -> Bool {
    var top: UIViewController = host.controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    return await withCheckedContinuation { done in
      let alert = UIAlertController(title: "Remove your \(name) code?", message: "It leaves this phone. Your 24 words won't bring it back. Turn off two-factor on \(name) first. Otherwise \(name) asks for a code you won't have.", preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
  }
}

// ── The two sheets (Monument: solid ground, hairlines, spaced capitals, air) ───────────────────────────────────────

private let gutter: CGFloat = 28

struct SiteCodeView: View {
  let name: String
  /** Its copy is with the words (site-2fa-backup.ts); false: the relay didn't take it yet, tried again next time. */
  let backedUp: Bool
  let code: () -> (code: String, secondsLeft: Int)
  let fill: (String) async -> Bool
  let remove: () -> Void
  let close: () -> Void
  @State private var now = SiteCodeView.Tick()
  @State private var note: String?
  @State private var active = AppActive.now
  @State private var captured = UIScreen.main.isCaptured
  private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

  struct Tick { var code = ""; var left = 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("ZEROFEE · TWO-FACTOR").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary).padding(.bottom, 16)
      Text(name).font(.system(size: 24)).tracking(-0.4).padding(.bottom, 24)
      Text(active && !captured ? spaced(now.code) : "Hidden while you record the screen or leave the app")
        .font(active && !captured ? .system(size: 40, weight: .medium, design: .monospaced) : .system(size: 14))
        .textSelection(.disabled)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Color.primary.opacity(0.12).frame(height: 1) }
        .overlay(alignment: .bottom) { Color.primary.opacity(0.12).frame(height: 1) }
      Text("New code in \(now.left) s").font(.system(size: 13)).foregroundStyle(.secondary).monospacedDigit().padding(.top, 12)
      if !backedUp { Text("Not backed up with your 24 words yet. A new phone won't get it. ZeroFee tries again when you open it.").font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 8) }
      if let note { Text(note).font(.system(size: 13)).padding(.top, 12) }
      Spacer()
      Button {
        Task {
          let c = code().code
          if await fill(c) { close() } else { note = "Tap \(name)'s code box first, then Fill code." }
        }
      } label: {
        Text("Fill code").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
      }
      .foregroundStyle(Color(uiColor: .systemBackground))
      .background(Color.primary, in: Capsule())
      Button("Close", action: close).font(.system(size: 15)).foregroundStyle(Color.primary).frame(maxWidth: .infinity, minHeight: 44)
      Button("Remove this code", action: remove).font(.system(size: 13)).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 36)
    }
    .padding(.horizontal, gutter)
    .padding(.top, 28)
    .padding(.bottom, 16)
    .background(Color(uiColor: .systemBackground))
    .tracksAppActive($active)
    .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
    .onAppear { tick() }
    .onReceive(timer) { _ in tick() }
  }

  private func tick() {
    let c = code()
    now = Tick(code: c.code, left: c.secondsLeft)
  }

  private func spaced(_ c: String) -> String {
    guard c.count == 6 else { return c }
    return "\(c.prefix(3)) \(c.suffix(3))"
  }
}

struct SiteCodeAddView: View {
  let name: String
  let readPage: () async -> String?
  /** Keeps it; nil when kept (the sheet closes), else what to say. */
  let add: (String) async -> String?
  let close: () -> Void
  @State private var note: String?
  @State private var working = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("ZEROFEE · TWO-FACTOR").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary).padding(.bottom, 16)
      Text(name).font(.system(size: 24)).tracking(-0.4).padding(.bottom, 12)
      Text("Open two-factor on \(name)'s page first, so its QR code shows. Then tap Read QR code, or copy its key and tap Paste.").font(.system(size: 15)).foregroundStyle(Color.primary.opacity(0.72)).padding(.bottom, 24)
      Button {
        Task {
          working = true
          defer { working = false }
          guard let link = await readPage() else { note = "No QR code on \(name)'s page yet. Close this, open two-factor there, then tap the key button."; return }
          note = await add(link)
        }
      } label: {
        Text("Read QR code").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
      }
      .foregroundStyle(Color(uiColor: .systemBackground))
      .background(Color.primary.opacity(working ? 0.3 : 1), in: Capsule())
      .disabled(working)
      PasteButton(payloadType: String.self) { strings in
        guard let text = strings.first else { return }
        Task { @MainActor in note = await add(text) }
      }
      .frame(maxWidth: .infinity, minHeight: 44)
      .padding(.top, 8)
      Text("Your 24 words bring this back on a new phone. Anyone with your words can make these codes too.").font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 14)
      if let note { Text(note).font(.system(size: 13)).foregroundStyle(Color.red).padding(.top, 12) }
      Spacer()
      Button("Close", action: close).font(.system(size: 15)).foregroundStyle(Color.primary).frame(maxWidth: .infinity, minHeight: 44)
    }
    .padding(.horizontal, gutter)
    .padding(.top, 28)
    .padding(.bottom, 16)
    .background(Color(uiColor: .systemBackground))
  }
}
