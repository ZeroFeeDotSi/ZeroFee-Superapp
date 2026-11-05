// The separate wallets' secrets, sealed to this phone's Secure Enclave (the study's re-grade: "seal hot seeds to the
// chip"). The isolated core's vault (KeychainCoreVault) keeps the hot root, each separate wallet's seed and any backup
// words it holds for a while encrypted with a key the chip made and never lets out: a copy of the Keychain taken from the
// phone (a forensic image, a jailbreak's dump) opens nothing without this very chip. No Face ID on that key, so a fast
// trade stays fast; the chip still has to be this one, and the phone unlocked.
// The seal: an ephemeral P-256 key agreement with the chip's key, HKDF-SHA256 (salt: the ephemeral key; info: the item's
// own name, so one item's sealed bytes can't stand in for another's), then AES-GCM. Stored as a separate item
// ("<name>#sealed"); a plain copy from before is sealed and removed the first time it's read.
import CryptoKit
import Foundation

enum Seal {
  static let suffix = "#sealed"
  private static let keyAccount = "seal-key"
  private static let version: UInt8 = 1

  /** The vault items that are secrets: what the words make, the words themselves while the core holds them, a
   *  self-funded account's set-up key, Agent's key, and this phone's keys as someone's second device (audits IOS-3, IOS-4). */
  static func wanted(_ name: String) -> Bool {
    ["hot-root", "recovery-seed", "pending-words", "renew-words", "setup-key"].contains(name)
      || name.hasPrefix("subwallet-seed:") || name.hasPrefix("agent-seed:") || name.hasPrefix("second-device:")
  }

  /** No chip (a simulator without one): items stay as they were, plain in this device's Keychain. */
  static var available: Bool { SecureEnclave.isAvailable }

  struct Failure: Error, CustomStringConvertible { let description: String }

  /** The chip's own key for sealing: made once, kept as the chip's handle (useless anywhere else). */
  private static func key() throws -> SecureEnclave.P256.KeyAgreement.PrivateKey {
    if let handle = try Keychain.get(Keychain.coreVault, keyAccount) {
      return try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: handle)
    }
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &error) else {
      throw Failure(description: "the secure chip didn't describe its locking key")
    }
    let made = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
    try Keychain.set(Keychain.coreVault, keyAccount, made.dataRepresentation)
    return made
  }

  private static func symmetric(_ shared: SharedSecret, _ ephemeral: Data, _ name: String) -> SymmetricKey {
    shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: ephemeral, sharedInfo: Data("zerofee-seal-v1:\(name)".utf8), outputByteCount: 32)
  }

  static func seal(_ data: Data, name: String) throws -> Data {
    let chip = try key()
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let shared = try ephemeral.sharedSecretFromKeyAgreement(with: chip.publicKey)
    let pub = ephemeral.publicKey.x963Representation
    guard let box = try AES.GCM.seal(data, using: symmetric(shared, pub, name)).combined else { throw Failure(description: "the secure chip didn't lock it") }
    return Data([version]) + pub + box
  }

  static func open(_ sealed: Data, name: String) throws -> Data {
    let bytes = [UInt8](sealed)
    guard bytes.count > 1 + 65 + 28, bytes[0] == version else { throw Failure(description: "a sealed item isn't one this app made") }
    let pub = Data(bytes[1..<66])
    let shared = try key().sharedSecretFromKeyAgreement(with: try P256.KeyAgreement.PublicKey(x963Representation: pub))
    return try AES.GCM.open(try AES.GCM.SealedBox(combined: Data(bytes[66...])), using: symmetric(shared, pub, name))
  }
}
