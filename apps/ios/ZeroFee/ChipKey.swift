// The account key, made and kept inside the Secure Enclave: CryptoKit's SecureEnclave.MLDSA65 (iOS 26), ML-DSA-65,
// the same post-quantum scheme NEAR's `ml-dsa-65:` keys use. It can't be exported: what the Keychain holds is the
// chip's wrapped handle, useless on any other phone. Every signature needs Face ID (`.biometryCurrentSet`: a newly
// enrolled face invalidates the key, so nobody can add their face and sign).
//
// JavaScript only ever gets the public key (NEAR's "ml-dsa-65:<base58>" form) and signatures over a 32-byte NEAR
// transaction hash. Pure ML-DSA, empty context: checked on a Mac to verify with @fastnear/ml-dsa-65's verifyHash.
// There is no software fallback here: a device without the chip says so and signs nothing.
import CryptoKit
import Foundation
import LocalAuthentication
import Security
import UIKit

/**
 * The phone check (H16, H17; RC-7): what stops this iPhone making or using the key, before anything is made or signed.
 * Each blocker has its own designed screen (the core's security-problems.ts words, by code) and the sheet's own note:
 * no raw error code ever, and no "Try again" that can never work (no chip).
 */
enum PhoneCheck: String {
  case noChip = "security.chip.missing"
  case noPasscode = "security.passcode.not-set"
  case faceIdNotSetUp = "security.faceid.not-set-up"
  case faceIdOff = "security.faceid.off"
  case faceIdLocked = "security.faceid.locked"

  /** Nil when the chip is there and Face ID can be used for ZeroFee now. */
  static func blocker() -> PhoneCheck? {
    guard SecureEnclave.isAvailable else { return .noChip }
    let context = LAContext()
    defer { context.invalidate() }
    var unavailable: NSError?
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &unavailable) { return nil }
    return from(unavailable, biometry: context.biometryType)
  }

  /** An LAError (from a check or a Face ID that didn't go through) as a blocker; nil for one that isn't (a cancel). */
  static func from(_ error: Error?, biometry: LABiometryType = .faceID) -> PhoneCheck? {
    guard let error = error as NSError?, error.domain == LAErrorDomain else { return nil }
    switch LAError.Code(rawValue: error.code) {
    case .passcodeNotSet: return .noPasscode
    case .biometryNotEnrolled: return .faceIdNotSetUp
    case .biometryLockout: return .faceIdLocked
    // Face ID is there but this app may not use it (Settings, ZeroFee, Face ID off); no Face ID at all reads as not set up.
    case .biometryNotAvailable: return biometry == .none ? .faceIdNotSetUp : .faceIdOff
    default: return nil
    }
  }

  /** The note on the approval sheet: what happened, that the money hasn't moved, and the one thing to do. */
  var sheetWords: String {
    switch self {
    case .noChip: return "This iPhone has no secure chip, so ZeroFee can't approve. Your money hasn't moved."
    case .noPasscode: return "This iPhone has no passcode. Your money hasn't moved. Set one in Settings, Face ID & Passcode."
    case .faceIdNotSetUp: return "Face ID isn't set up. Your money hasn't moved. Set it up in Settings, Face ID & Passcode."
    case .faceIdOff: return "Face ID is off for ZeroFee. Your money hasn't moved. Turn it on in Settings, ZeroFee."
    case .faceIdLocked: return "Face ID is locked after too many tries. Your money hasn't moved. Lock, then unlock with your passcode."
    }
  }
}

enum ChipKey {
  private static let handleItem = "account-key"
  private static let publicItem = "account-key.public"
  /** The enrolled faces' state when the account key was made (only to tell a dead key, see create). */
  private static let facesItem = "account-key.faces"
  /** Fixed words for the Face ID prompt. The page can't choose them: what is being signed is on the native sheet. */
  private static let reason = "Approve what ZeroFee's sheet shows"

  /** `next`: the sheet's one lit button after it (copy review, 6 Nov): Try again (a new Face ID), or Close; none: as before. */
  struct Refused: Error { let what: String; var next: Next = .none
    enum Next { case none, tryAgain, close } }
  /** The phone check stopped it: its code goes to the page, which shows that blocker's own screen. */
  struct Blocked: Error { let check: PhoneCheck }

  static var chipAvailable: Bool { SecureEnclave.isAvailable }

  private static func access() throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else {
      throw Refused(what: "This phone couldn't set up Face ID protection for the key.")
    }
    return ac
  }

  /** The account key's public key, NEAR form, or nil when this phone hasn't made one. */
  static func publicKey() throws -> String? {
    guard let raw = try Keychain.get(Keychain.chipKey, publicItem) else { return nil }
    return "ml-dsa-65:" + Base58.encode(raw)
  }

  /**
   * Make the account key in the chip (once; afterwards the same key). Returns its public key. A key made before the
   * enrolled faces changed can never sign again (.biometryCurrentSet): a new account or a move to this phone then gets a
   * fresh one (audit IOS-1b), never the dead key. The faces' state is kept beside it only to tell.
   */
  static func create() throws -> String {
    if let existing = try publicKey() {
      let then = try? Keychain.get(Keychain.chipKey, facesItem)
      guard let then, let now = ApprovalPass.facesNow(), then != now else { return existing }
      try Keychain.delete(Keychain.chipKey, handleItem)
      try Keychain.delete(Keychain.chipKey, publicItem)
    }
    if let blocked = PhoneCheck.blocker() { throw Blocked(check: blocked) }
    let key = try SecureEnclave.MLDSA65.PrivateKey(accessControl: try access())
    let raw = key.publicKey.rawRepresentation
    guard raw.count == 1952 else { throw Refused(what: "The secure chip made a key ZeroFee can't use. Try again.") }
    try Keychain.set(Keychain.chipKey, handleItem, key.dataRepresentation)
    try Keychain.set(Keychain.chipKey, publicItem, raw)
    if let faces = ApprovalPass.facesNow() { try? Keychain.set(Keychain.chipKey, facesItem, faces) }
    // A new account key, a new approval key with it: bound to the faces enrolled now (audit IOS-1).
    try? ApprovalPass.resetKey()
    return "ml-dsa-65:" + Base58.encode(raw)
  }

  /**
   * The "Your key" proof card (L6): the chip loads the key from its handle and gives its public key now (no Face ID: only a
   * signature needs it), compared with the one kept at set-up; and when the key was made (the Keychain's date for it).
   * `held` false: the chip has no such key, or it gave another one. Never private key material.
   */
  static func proof() throws -> [String: Any] {
    guard let raw = try publicRaw() else { throw Refused(what: "This phone has no account key yet.") }
    var held = false
    var given = raw
    if chipAvailable, let handle = try Keychain.get(Keychain.chipKey, handleItem),
       let key = try? SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: handle) {
      given = key.publicKey.rawRepresentation
      held = given == raw
    }
    var out: [String: Any] = ["publicKey": "ml-dsa-65:" + Base58.encode(given), "held": held]
    if let made = Keychain.createdAt(Keychain.chipKey, publicItem) { out["madeAtIso"] = ISO8601DateFormatter().string(from: made) }
    return out
  }

  /** The account key's 1,952 raw public-key bytes, or nil when this phone hasn't made one. */
  static func publicRaw() throws -> Data? {
    try Keychain.get(Keychain.chipKey, publicItem)
  }

  /**
   * Sign one 32-byte hash inside the chip, after its own Face ID (signMany of one hash: a fresh context, used for this
   * one signature and invalidated right after). Only the native sheet calls this (NativeSheet.swift), with the hash it
   * computed itself from transaction bytes it checked; the page can't reach it with a hash of its own.
   */
  static func sign(hash: Data) async throws -> Data {
    guard let one = try await signMany(hashes: [hash]).first else { throw Refused(what: "ZeroFee couldn't read what to approve, so it didn't approve it.") }
    return one
  }

  /** The most hashes one Face ID may sign (the audit's R3, 6 Nov): one sheet's steps, never split across sheets. */
  static let maxHashes = 4
  /** How long one Face ID's yes may sign for (the audit's R5): past it the context is dead and nothing more is signed. */
  static let unlockSeconds: TimeInterval = 60

  /**
   * One Face ID, then every hash of ONE sheet signed back to back inside the chip under that one context (D3/D4, the audit's
   * R3/R5). 1 to 4 hashes, each 32 bytes, all computed by the native sheet from bytes it decoded and checked itself.
   * The unlock is single use: it ends at the last signature, on any refusal, on going to the background, or 60 s after
   * Face ID said yes, whichever is first; then the context is invalidated, the key object dropped and the handle's copy
   * zeroed. Never reused across sheets; no reuse window (touchIDAuthenticationAllowableReuseDuration stays 0).
   */
  static func signMany(hashes: [Data]) async throws -> [Data] {
    let context = LAContext()
    context.touchIDAuthenticationAllowableReuseDuration = 0
    let unlock = Unlock(context: context)
    defer { unlock.end() }
    guard (1...maxHashes).contains(hashes.count) else { throw Refused(what: "This has more steps than one Face ID covers, so ZeroFee stopped it. Your money hasn't moved.", next: .close) }
    guard hashes.allSatisfy({ $0.count == 32 }) else { throw Refused(what: "ZeroFee couldn't read what to approve, so it didn't approve it.") }
    guard chipAvailable else { throw Refused(what: "This device has no secure chip, so it can't approve anything.") }
    guard var handle = try Keychain.get(Keychain.chipKey, handleItem) else { throw Refused(what: "This phone has no account key yet.") }
    defer { handle.resetBytes(in: 0..<handle.count) }
    context.localizedFallbackTitle = ""
    // going to the background ends the unlock (the audit's R5): the context dies, nothing more is signed
    let away = await MainActor.run { NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in unlock.end() } }
    defer { NotificationCenter.default.removeObserver(away) }
    do {
      try await FaceIdPrompt.around { try await context.evaluateAccessControl(try access(), operation: .useKeySign, localizedReason: reason) }
    } catch {
      if let blocked = PhoneCheck.from(error, biometry: context.biometryType) { throw Refused(what: blocked.sheetWords) }
      throw Refused(what: "Face ID didn't approve it. Your money hasn't moved. Try again, or tap Not now.")
    }
    unlock.start(seconds: unlockSeconds)
    // the key built here from `handle` itself (audit, 6 Nov: a copy for the task would be a second buffer the defer never
    // zeroes); the task gets only the key object
    let key = try SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: handle, authenticationContext: context)
    return try await Task.detached(priority: .userInitiated) {
      var out: [Data] = []
      for hash in hashes {
        guard unlock.live() else { throw Refused(what: "The Face ID approval timed out, so nothing was sent. Your money hasn't moved.", next: .tryAgain) }
        let signature = try key.signature(for: hash)
        guard key.publicKey.isValidSignature(signature, for: hash) else { throw Refused(what: "The secure chip's approval didn't check out, so ZeroFee didn't use it. Your money hasn't moved.") }
        out.append(signature)
      }
      return out
    }.value
  }

  /** One Face ID's unlock: live from Face ID's yes until its deadline, unless ended first (the last signature, a
   *  refusal, the background). Ending it invalidates the context, once. */
  final class Unlock: @unchecked Sendable {
    private let lock = NSLock()
    private let context: LAContext
    private var deadline: Date?
    private var ended = false
    init(context: LAContext) { self.context = context }
    func start(seconds: TimeInterval) { lock.withLock { deadline = Date().addingTimeInterval(seconds) } }
    func live() -> Bool { lock.withLock { !ended && (deadline.map { Date() < $0 } ?? false) } }
    func end() {
      let first: Bool = lock.withLock { defer { ended = true }; return !ended }
      if first { context.invalidate() }
    }
  }
}

/**
 * Face ID for an approval that doesn't touch the account key (a separate wallet, Agent's setup): device.confirm from the
 * web sheet's Approve, and the isolated core's own sheets. It proves the person is there and nothing more.
 *
 * Bound to the faces enrolled when this phone's approval key was made (audit IOS-1): it signs a fresh challenge with a
 * Secure Enclave key under `.biometryCurrentSet`, so a face enrolled since (by someone who knows the passcode) approves
 * nothing: the chip refuses that key for good, as it does the account key. The key is made with the account key at
 * set-up (ChipKey.create), or on the first approval on a phone set up before this. No chip (a simulator): plain Face ID.
 */
@MainActor
final class ApprovalPass {
  static let shared = ApprovalPass()
  private static let reason = "Approve this in ZeroFee"
  nonisolated private static let keyAccount = "approval-key"

  /** A fresh approval key, with a new account key (ChipKey.create). */
  nonisolated static func resetKey() throws {
    try Keychain.delete(Keychain.chipKey, keyAccount)
    try Keychain.delete(Keychain.chipKey, facesAccount)
    _ = try ensureKey()
  }

  /** The approval key's chip handle: made once, kept (useless on any other phone). The enrolled faces' state is kept
   *  beside it, only to say why an approval is refused once they change (the chip enforces it either way). */
  nonisolated static func ensureKey() throws -> Data {
    if let handle = try Keychain.get(Keychain.chipKey, keyAccount) { return handle }
    let made = try SecureEnclave.P256.Signing.PrivateKey(accessControl: try access())
    try Keychain.set(Keychain.chipKey, keyAccount, made.dataRepresentation)
    if let faces = facesNow() { try? Keychain.set(Keychain.chipKey, facesAccount, faces) }
    return made.dataRepresentation
  }

  nonisolated private static let facesAccount = "approval-faces"

  nonisolated static func facesNow() -> Data? {
    let context = LAContext()
    defer { context.invalidate() }
    var unavailable: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &unavailable) else { return nil }
    return context.domainState.biometry.stateHash
  }

  /** Have the enrolled faces changed since the approval key was made (a face added, or Face ID reset)? */
  nonisolated static func facesChanged() -> Bool {
    guard let then = try? Keychain.get(Keychain.chipKey, facesAccount), let now = facesNow() else { return false }
    return then != now
  }

  /** What the sheet says when Face ID didn't give an approval. */
  nonisolated static func refusal() -> ChipKey.Refused {
    if let blocked = PhoneCheck.blocker() { return ChipKey.Refused(what: blocked.sheetWords) }
    return facesChanged()
      ? ChipKey.Refused(what: "Face ID changed, so ZeroFee stopped approving. Your money hasn't moved. Use your 24 words in Security, Recovery.")
      : ChipKey.Refused(what: "Face ID didn't approve it. Try again, or tap Not now.")
  }

  nonisolated private static func access() throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else {
      throw ChipKey.Refused(what: "This phone couldn't set up Face ID protection for approvals.")
    }
    return ac
  }

  /** Face ID (biometrics only, the faces enrolled when the key was made). True = approved. */
  func confirm() async -> Bool {
    let context = LAContext()
    context.touchIDAuthenticationAllowableReuseDuration = 0
    defer { context.invalidate() }
    context.localizedFallbackTitle = "" // no passcode button: this is Face ID or "Not now"
    #if targetEnvironment(simulator)
    if !SecureEnclave.isAvailable {
      return (try? await FaceIdPrompt.around { try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: Self.reason) }) ?? false
    }
    #endif
    guard SecureEnclave.isAvailable else { return false }
    do {
      let handle = try Self.ensureKey()
      guard try await FaceIdPrompt.around({ try await context.evaluateAccessControl(try Self.access(), operation: .useKeySign, localizedReason: Self.reason) }) else { return false }
      // The chip checks the enrolled faces against the key's own: changed since it was made, this throws.
      return try await Task.detached(priority: .userInitiated) {
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: handle, authenticationContext: context)
        let challenge = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        return key.publicKey.isValidSignature(try key.signature(for: challenge), for: challenge)
      }.value
    } catch {
      NSLog("[zf-host] an approval wasn't given (Face ID declined, or the enrolled faces changed)")
      return false
    }
  }
}

enum Base58 {
  private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".utf8)

  static func encode(_ data: Data) -> String {
    let bytes = [UInt8](data)
    let zeros = bytes.prefix(while: { $0 == 0 }).count
    var digits: [UInt8] = [] // base-58 digits, least significant first
    for byte in bytes {
      var carry = Int(byte)
      for i in digits.indices {
        carry += Int(digits[i]) << 8
        digits[i] = UInt8(carry % 58)
        carry /= 58
      }
      while carry > 0 {
        digits.append(UInt8(carry % 58))
        carry /= 58
      }
    }
    return String(repeating: "1", count: zeros) + String(decoding: digits.reversed().map { alphabet[Int($0)] }, as: UTF8.self)
  }
}

extension Host {
  /** key.info / key.create / key.sign (the native sheet): the account key in the chip. No method returns private key material. */
  func key(_ method: String, _ p: [String: Any]) async -> Reply {
    do {
      switch method {
      case "key.info":
        return ok(["chip": ChipKey.chipAvailable, "publicKey": try ChipKey.publicKey() as Any? ?? NSNull(), "kind": "secure-chip"])
      case "key.create":
        return ok(["publicKey": try ChipKey.create(), "kind": "secure-chip"])
      case "key.proof":
        return ok(try ChipKey.proof())
      case "key.sign":
        // Only through the native sheet, with transaction bytes it checks and hashes itself (S1.6).
        return await signOnSheet(p)
      case "key.signSet":
        // One sheet, one Face ID, 1 to 4 transactions it checks and hashes itself, signed back to back (D3, the audit's R3)
        return await signSetOnSheet(p)
      case "key.signAlertsProof":
        // The one message besides a transaction: the relay's email-alerts proof, built natively (AlertsProof).
        return await signAlertsProof(p)
      case "key.signChatName":
        // ZeroFee Chat's name note (J3 part 2), built natively (ChatName): no money moves.
        return await signChatName(p)
      default:
        return problem("shell.device.refused", "ZeroFee doesn't know that request.")
      }
    } catch let blocked as ChipKey.Blocked {
      return problem(blocked.check.rawValue, blocked.check.sheetWords)
    } catch let refused as ChipKey.Refused {
      return problem("security.key.refused", refused.what)
    } catch {
      let e = error as NSError
      NSLog("[zf-host] %@ failed: %@ %d", method, e.domain, e.code)
      // A Face ID or passcode reason the check didn't see coming: its own words. Never a raw code on screen (H16).
      if let blocked = PhoneCheck.from(error) { return problem(blocked.rawValue, blocked.sheetWords) }
      return problem("security.key.refused", method == "key.sign" ? "This phone's secure chip didn't answer, so ZeroFee didn't approve it. Your money hasn't moved." : "This phone's secure chip couldn't make your key right now. No money moved. Try again.")
    }
  }
}
