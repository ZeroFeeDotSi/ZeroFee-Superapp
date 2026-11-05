// The ZeroFee Keychain: partner logins (D29; Security's rules, backlog/security.md §E). Native only: a password never
// sits in a JavaScript heap, except robot.js's for the moment of a fill.
//
// The construction (§E2):
// - One Secure Enclave P-256 key, application tag `si.zerofee.logins.v1`, access control
//   `[.privateKeyUsage, .biometryCurrentSet]` with kSecAttrAccessibleWhenUnlockedThisDeviceOnly. It never leaves the
//   chip; a newly enrolled face invalidates it (the saved logins then can't be opened, like the account key).
// - Each password is sealed to that key's PUBLIC key with ECIES, `.eciesEncryptionCofactorVariableIVX963SHA256AESGCM`
//   (SecKeyCreateEncryptedData): a fresh ephemeral P-256 key per seal, cofactor ECDH with the enclave key, ANSI X9.63
//   KDF with SHA-256 over the shared secret and the ephemeral public key, AES-GCM with a variable IV from the KDF. The
//   sealed bytes are ephemeral public key ‖ ciphertext ‖ tag. Sealing needs no Face ID; opening is the enclave's ECDH,
//   which the enclave refuses without Face ID.
// - The sealed bytes and the login's plain facts (host, username, dates, who made it) are one generic-password item
//   under service `si.zerofee.logins`, This-Device-Only, not synchronizable: never iCloud Keychain, a backup or
//   Apple's Passwords (ZeroFee has no AutoFill credential provider and no shared web credentials).
//
// Methods, the shell only (main page, no app id): logins.list / reveal / copy / add / remove. There is no get, no
// export, no bulk read and no import. A device without a Secure Enclave (the Simulator) answers `logins.unavailable`.
import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum Logins {
  static let service = "si.zerofee.logins"
  static let keyTag = Data("si.zerofee.logins.v1".utf8)
  static let algorithm = SecKeyAlgorithm.eciesEncryptionCofactorVariableIVX963SHA256AESGCM
  private static let installedMarker = "zf.installed.v1"

  struct Refused: Error { let what: String }

  struct Item: Codable, Equatable {
    let id: String
    let host: String
    var username: String
    let createdIso: String
    var lastUsedIso: String?
    /** "robot" (made by {{login.new}}) or "you" (added in Settings). */
    let by: String
    let sealed: Data

    /** What the page may see: everything but the sealed password. */
    var listed: [String: Any] {
      ["id": id, "host": host, "username": username, "createdIso": createdIso, "lastUsedIso": lastUsedIso as Any? ?? NSNull(), "by": by]
    }
  }

  static var available: Bool {
    #if DEBUG
    // The Simulator in Xcode 27 reports a Secure Enclave; ZF_PROBE_NO_CHIP=1 shows what a phone without one answers.
    if ProcessInfo.processInfo.environment["ZF_PROBE_NO_CHIP"] == "1" { return false }
    #endif
    return SecureEnclave.isAvailable
  }

  static func now() -> String { ISO8601DateFormatter().string(from: Date()) }

  // ── The enclave key ──────────────────────────────────────────────────────────────────────────────────────

  private static func access() throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else {
      throw Refused(what: "This phone couldn't set up Face ID protection for passwords.")
    }
    return ac
  }

  /** The enclave key's reference (with `context` for an operation that needs Face ID), or nil when there is none. */
  private static func privateKey(context: LAContext? = nil) throws -> SecKey? {
    var q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave, kSecReturnRef as String: true]
    if let context { q[kSecUseAuthenticationContext as String] = context }
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let out else { throw Keychain.Failure(status: status) }
    return (out as! SecKey)
  }

  /** The key's public half, making the key in the enclave the first time. Needs no Face ID. */
  private static func publicKey() throws -> SecKey {
    guard available else { throw Refused(what: "This device has no secure chip.") }
    if let existing = try privateKey(), let pub = SecKeyCopyPublicKey(existing) { return pub }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: keyTag, kSecAttrAccessControl as String: try access()],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let pub = SecKeyCopyPublicKey(key) else {
      throw Refused(what: "The secure chip couldn't make the passwords key.")
    }
    return pub
  }

  static func seal(_ password: String) throws -> Data {
    let pub = try publicKey()
    guard SecKeyIsAlgorithmSupported(pub, .encrypt, algorithm) else { throw Refused(what: "This phone can't lock passwords in its secure chip.") }
    var error: Unmanaged<CFError>?
    guard let sealed = SecKeyCreateEncryptedData(pub, algorithm, Data(password.utf8) as CFData, &error) as Data? else {
      throw Refused(what: "This phone couldn't lock the password in its secure chip. Try again.")
    }
    return sealed
  }

  /** Open one sealed password with a context Face ID has already approved (the enclave checks it). */
  static func open(_ sealed: Data, context: LAContext) throws -> String {
    guard let key = try privateKey(context: context) else { throw Refused(what: "Saved passwords close when Face ID changes. Reset this one on the website.") }
    var error: Unmanaged<CFError>?
    guard let plain = SecKeyCreateDecryptedData(key, algorithm, sealed as CFData, &error) as Data?, let text = String(data: plain, encoding: .utf8) else {
      throw Refused(what: "Face ID didn't open it.")
    }
    return text
  }

  /** A fresh context with Face ID approved (biometrics only, no passcode button). The caller invalidates it. */
  static func approvedContext(reason: String) async throws -> LAContext {
    let context = LAContext()
    context.localizedFallbackTitle = ""
    var unavailable: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &unavailable) else {
      context.invalidate()
      throw Refused(what: "Face ID isn't set up on this phone.")
    }
    do {
      guard try await FaceIdPrompt.around({ try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) }) else { throw Refused(what: "Face ID didn't approve it.") }
    } catch {
      context.invalidate()
      throw Refused(what: "Face ID didn't approve it.")
    }
    return context
  }

  // ── The items ────────────────────────────────────────────────────────────────────────────────────────────

  static func list() throws -> [Item] {
    try Keychain.all(service).values.compactMap { try? JSONDecoder().decode(Item.self, from: $0) }.sorted { $0.host == $1.host ? $0.createdIso < $1.createdIso : $0.host < $1.host }
  }

  static func item(_ id: String) throws -> Item? {
    guard id.wholeMatch(of: /^[0-9A-F-]{36}$/) != nil, let data = try Keychain.get(service, id) else { return nil }
    return try? JSONDecoder().decode(Item.self, from: data)
  }

  private static func save(_ item: Item) throws { try Keychain.set(service, item.id, try JSONEncoder().encode(item)) }

  /** Seal and save (no Face ID). Returns the new id. */
  @discardableResult
  static func add(host: String, username: String, password: String, by: String) throws -> String {
    let item = Item(id: UUID().uuidString, host: host, username: username, createdIso: now(), lastUsedIso: nil, by: by, sealed: try seal(password))
    try save(item)
    return item.id
  }

  static func touch(_ id: String) {
    guard var it = try? item(id) else { return }
    it.lastUsedIso = now()
    // In place (SecItemUpdate), never delete-then-add: a failure can't lose the login.
    if let data = try? JSONEncoder().encode(it) { try? Keychain.update(service, id, data) }
  }

  static func remove(_ id: String) throws { try Keychain.delete(service, id) }

  /** The login saved for exactly this host (an exact match, as password managers do), the most recent first. */
  static func forHost(_ host: String) throws -> Item? { try list().filter { $0.host == host }.max { ($0.lastUsedIso ?? $0.createdIso) < ($1.lastUsedIso ?? $1.createdIso) } }

  /** Every login and the enclave key. Account forget, a phone wipe, and the first launch after an install. True when both are gone. */
  @discardableResult
  static func wipe() -> Bool {
    let items = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    let key = SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag] as CFDictionary)
    let gone = { (s: OSStatus) in s == errSecSuccess || s == errSecItemNotFound }
    // sites' two-factor codes and their chip key go with the logins (SiteCodes.swift)
    let codes = SiteCodes.wipe()
    if !gone(items) || !gone(key) || !codes { NSLog("[zf-host] the ZeroFee Keychain wipe didn't finish (items %d, key %d, codes %d): it runs again next launch", items, key, codes ? 1 : 0) }
    return gone(items) && gone(key) && codes
  }

  /** iOS keeps Keychain items after the app is deleted: the first launch after an install deletes them. The marker is set only when both deletes worked, so a failed wipe runs again. */
  static func wipeOnFirstLaunch() {
    guard !UserDefaults.standard.bool(forKey: installedMarker) else { return }
    if wipe() { UserDefaults.standard.set(true, forKey: installedMarker) }
  }

  /** A new password from SecRandomCopyBytes: `length` (at least 20) characters, letters, digits and a few symbols, every class present. */
  static func generate(length: Int = 24) -> String {
    let lower = Array("abcdefghijkmnopqrstuvwxyz"), upper = Array("ABCDEFGHJKLMNPQRSTUVWXYZ"), digits = Array("23456789"), symbols = Array("-_.!@#%+=")
    let all = lower + upper + digits + symbols
    let n = max(20, length)
    func pick(_ from: [Character]) -> Character {
      // Rejection sampling: no modulo bias.
      let limit = 256 - (256 % from.count)
      while true {
        var b: UInt8 = 0
        guard SecRandomCopyBytes(kSecRandomDefault, 1, &b) == errSecSuccess else { continue }
        if Int(b) < limit { return from[Int(b) % from.count] }
      }
    }
    while true {
      let out = (0 ..< n).map { _ in pick(all) }
      if out.contains(where: lower.contains), out.contains(where: upper.contains), out.contains(where: digits.contains), out.contains(where: symbols.contains) { return String(out) }
    }
  }
}

// ── The bridge methods (Bridge.swift routes logins.* here, from the shell only) ────────────────────────────────

extension Host {
  static let loginsUnavailable = problem("logins.unavailable", "Passwords need a secure chip, and this device has none.")

  func logins(_ method: String, _ p: [String: Any]) async -> Reply {
    guard Logins.available else { return Self.loginsUnavailable }
    let id = p["id"] as? String ?? ""
    do {
      switch method {
      case "logins.list":
        return ok(try Logins.list().map(\.listed))
      case "logins.reveal":
        guard let item = try Logins.item(id) else { return problem("logins.unknown", "That login isn't on this phone any more.") }
        let context = try await Logins.approvedContext(reason: "Show your \(item.host) password")
        defer { context.invalidate() }
        let password = try Logins.open(item.sealed, context: context)
        Logins.touch(id)
        let shown: Bool? = await presentModal { finish in AnyView(LoginRevealView(host: item.host, username: item.username, password: password) { finish(true) }) }
        return ok(["shown": shown == true])
      case "logins.copy":
        guard let item = try Logins.item(id) else { return problem("logins.unknown", "That login isn't on this phone any more.") }
        let context = try await Logins.approvedContext(reason: "Copy your \(item.host) password for 30 seconds")
        defer { context.invalidate() }
        let password = try Logins.open(item.sealed, context: context)
        let expires = Date().addingTimeInterval(30)
        // This phone only (no Universal Clipboard), and gone after 30 seconds.
        // Marked concealed, so device.clipboard.read never hands it to an app (Security's review, MUST 1).
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: password, ConcealedClipboard.marker: Data()]], options: [.localOnly: true, .expirationDate: expires])
        Logins.touch(id)
        return ok(["copied": true, "expiresAtIso": ISO8601DateFormatter().string(from: expires)])
      case "logins.add":
        let host = (p["host"] as? String ?? "").lowercased()
        guard PartnerRecipe.isExactHost(host) else { return problem("logins.refused", "That isn't a website's name. Type it like app.example.com.") }
        let saved: String? = await presentModal { finish in
          AnyView(LoginAddView(host: host, save: { username, password in
            do {
              finish(try Logins.add(host: host, username: username, password: password, by: "you"))
              return nil
            } catch let r as Logins.Refused {
              return r.what
            } catch {
              return "This phone's keychain didn't keep it."
            }
          }, cancel: { finish(nil) }))
        }
        return ok(["id": saved as Any? ?? NSNull()])
      case "logins.remove":
        guard let item = try Logins.item(id) else { return problem("logins.unknown", "That login isn't on this phone any more.") }
        // Confirmed natively too, naming the site: the page's own confirm is not the only one.
        guard await confirmRemove(item.host) else { return ok(["removed": false]) }
        try Logins.remove(id)
        return ok(["removed": true])
      default:
        return problem("shell.device.refused", "ZeroFee doesn't know that request.")
      }
    } catch let r as Logins.Refused {
      return problem("logins.refused", r.what)
    } catch {
      let status = (error as? Keychain.Failure)?.status ?? 0
      NSLog("[zf-host] %@ failed: OSStatus %d", method, status)
      return problem("logins.refused", "This phone's keychain didn't answer (\(status)).")
    }
  }
}

extension Host {
  /** "Remove the login for <host>?" on a native alert. True = Remove. */
  func confirmRemove(_ host: String) async -> Bool {
    var top: UIViewController = controller
    while let next = top.presentedViewController { top = next }
    let presenter = top
    return await withCheckedContinuation { done in
      let alert = UIAlertController(title: "Remove the login for \(host)?", message: "ZeroFee forgets this password. The account at \(host) stays as it is.", preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in done.resume(returning: false) })
      alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { _ in done.resume(returning: true) })
      presenter.present(alert, animated: true)
    }
  }
}

// ── The two native sheets: Monument (solid ground, hairlines, spaced capitals, air) ─────────────────────────────

private let gutter: CGFloat = 28

struct LoginRevealView: View {
  let host: String
  let username: String
  let password: String
  let done: () -> Void
  /** Not active (the app switcher takes its snapshot then) or the screen is being captured: the password is covered. */
  @State private var active = AppActive.now
  @State private var captured = UIScreen.main.isCaptured

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("ZEROFEE · PASSWORD").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary).padding(.bottom, 16)
      Text(host).font(.system(size: 24)).tracking(-0.4).padding(.bottom, 8)
      if !username.isEmpty { Text(username).font(.system(size: 15)).foregroundStyle(Color.primary.opacity(0.72)) }
      Text(active && !captured ? password : "ZeroFee hides this while you record the screen or leave the app")
        .font(active && !captured ? .system(size: 20, design: .monospaced) : .system(size: 14))
        .textSelection(.disabled)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Color.primary.opacity(0.12).frame(height: 1) }
        .overlay(alignment: .bottom) { Color.primary.opacity(0.12).frame(height: 1) }
        .padding(.top, 24)
      Text("Only you see this. ZeroFee never sends it anywhere.").font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 14)
      Spacer()
      Button(action: done) { Text("Done").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52) }
        .foregroundStyle(Color(uiColor: .systemBackground))
        .background(Color.primary, in: Capsule())
    }
    .padding(.horizontal, gutter)
    .padding(.top, 28)
    .padding(.bottom, 16)
    .background(Color(uiColor: .systemBackground))
    .tracksAppActive($active)
    .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
  }
}

struct LoginAddView: View {
  let host: String
  /** Saves; nil when saved (the sheet closes), else what to say. */
  let save: (_ username: String, _ password: String) -> String?
  let cancel: () -> Void
  @State private var username = ""
  @State private var password = ""
  /** The password "Make one for me" made: the line says so while the field still holds it. */
  @State private var generated: String?
  @State private var note: String?
  private var made: Bool { generated != nil && generated == password }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("ZEROFEE · ADD A LOGIN").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary).padding(.bottom, 16)
      Text(host).font(.system(size: 24)).tracking(-0.4).padding(.bottom, 24)
      // No textContentType: iOS's AutoFill (Apple's Passwords) must not offer or save these (rule E2).
      TextField("Username or email", text: $username)
        .textInputAutocapitalization(.never).autocorrectionDisabled()
        .font(.system(size: 17)).padding(.vertical, 14)
        .overlay(alignment: .bottom) { Color.primary.opacity(0.12).frame(height: 1) }
      SecureField("Password", text: $password)
        .font(.system(size: 17)).padding(.vertical, 14)
        .overlay(alignment: .bottom) { Color.primary.opacity(0.12).frame(height: 1) }
      Button(made ? "Made one for you · 24 characters" : "Make one for me") {
        let p = Logins.generate()
        generated = p
        password = p
      }
      .font(.system(size: 15)).foregroundStyle(Color.primary).frame(minHeight: 44).padding(.top, 8)
      Text("Kept in this phone's secure chip. Never in iCloud.").font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 6)
      if let note { Text(note).font(.system(size: 13)).foregroundStyle(Color.red).padding(.top, 12) }
      Spacer()
      Button { note = save(username.trimmingCharacters(in: .whitespaces), password) } label: {
        Text("Save").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
      }
      .foregroundStyle(Color(uiColor: .systemBackground))
      .background(Color.primary.opacity(password.isEmpty ? 0.3 : 1), in: Capsule())
      .disabled(password.isEmpty || password.count > 256 || username.count > 200)
      Button("Cancel", action: cancel).font(.system(size: 15)).foregroundStyle(Color.primary).frame(maxWidth: .infinity, minHeight: 44)
    }
    .padding(.horizontal, gutter)
    .padding(.top, 28)
    .padding(.bottom, 16)
    .background(Color(uiColor: .systemBackground))
  }
}
