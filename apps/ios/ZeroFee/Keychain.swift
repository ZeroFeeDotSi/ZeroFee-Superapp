// The Keychain, this device only (kSecAttrAccessibleWhenUnlockedThisDeviceOnly): never in a backup, never on another
// phone, readable only while the phone is unlocked. Used for each app's device.secret and for the core's vault.
import Foundation
import Security

enum Keychain {
  /** Each app's own secrets (device.secret.*): account = "<app>:<key>". */
  static let appSecrets = "si.zerofee.device-secret"
  /** The core's own small state and keys (HostVault in apps/web/src/host/vault.ts): account = the vault item's name. */
  static let coreVault = "si.zerofee.core-vault"
  /** The account key's Secure Enclave handle (ChipKey.swift). */
  static let chipKey = "si.zerofee.chip-key"

  struct Failure: Error { let status: OSStatus }

  private static func base(_ service: String, _ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  static func get(_ service: String, _ account: String) throws -> Data? {
    var q = base(service, account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw Failure(status: status) }
    return out as? Data
  }

  /** When the item was first added (the Keychain's own creation date; an update in place keeps it), or nil. */
  static func createdAt(_ service: String, _ account: String) -> Date? {
    var q = base(service, account)
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let row = out as? [String: Any] else { return nil }
    return row[kSecAttrCreationDate as String] as? Date
  }

  /** Never a moment without the item (audit, Low: deleting first and adding after lost it if the app stopped between):
   *  an item already there is updated in place; only a new one is added. */
  static func set(_ service: String, _ account: String, _ data: Data) throws {
    let change: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    let updated = SecItemUpdate(base(service, account) as CFDictionary, change as CFDictionary)
    if updated == errSecSuccess { return }
    guard updated == errSecItemNotFound else { throw Failure(status: updated) }
    var q = base(service, account)
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    let status = SecItemAdd(q as CFDictionary, nil)
    guard status == errSecSuccess else { throw Failure(status: status) }
  }

  static func delete(_ service: String, _ account: String) throws {
    let status = SecItemDelete(base(service, account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
  }

  /** Every item's data under one service (the ZeroFee Keychain's logins), keyed by account. */
  static func all(_ service: String) throws -> [String: Data] {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true, kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound { return [:] }
    guard status == errSecSuccess, let rows = out as? [[String: Any]] else { throw Failure(status: status) }
    var items: [String: Data] = [:]
    for row in rows {
      if let account = row[kSecAttrAccount as String] as? String, let data = row[kSecValueData as String] as? Data { items[account] = data }
    }
    return items
  }

  /** Replace an existing item's data in place (SecItemUpdate): its attributes stay as they were. */
  static func update(_ service: String, _ account: String, _ data: Data) throws {
    let status = SecItemUpdate(base(service, account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    guard status == errSecSuccess else { throw Failure(status: status) }
  }

  /** Delete every item under one service. */
  static func deleteAll(_ service: String) throws {
    let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
  }
}
