// What ZeroFee keeps on this iPhone outside the Keychain, sealed (audit M4, 3 Nov). Every app's device.store values
// (AgentZero's chats and payees, Browser visits and bookmarks, Chat places, Home's figures), where Browser pages were
// left (Places) and the sites already opened once (seen-hosts) were plain UserDefaults: readable after the first unlock,
// in every unencrypted iTunes or Finder backup, and partly left behind by Reset. Now one AES-GCM file: its 256-bit key in
// the Keychain (this device only), the file under complete protection (unreadable while the phone is locked) and never in
// a backup. Read once into memory: a get is a dictionary read and a set changes it (well under 0.1 ms); the file is
// sealed again off the main thread, the changes made meanwhile in one write. Reset takes the file and its key.
import CryptoKit
import Foundation

final class SealedStore: @unchecked Sendable {
  static let shared = SealedStore()

  /** Where the key lives: the Keychain, this device only (Keychain.swift); `nil` while the phone is locked. */
  struct KeySource {
    let read: () -> SymmetricKey?
    let forget: () -> Void
  }
  /** Values kept plain before, moved in on the first read (then taken away there). */
  struct Legacy {
    let read: () -> [String: String]
    let forget: () -> Void
  }

  private let url: URL
  private let keys: KeySource
  private let legacy: [Legacy]
  private let lock = NSLock()
  /** nil: not read yet, or the phone was locked when it was asked. */
  private var values: [String: String]?
  /** Changes made while it couldn't be read (the phone locked): applied the moment it can be. */
  private var waiting: [(String, String?)] = []
  private let queue = DispatchQueue(label: "si.zerofee.sealed-store")
  private var writeQueued = false

  init(url: URL = SealedStore.defaultURL, keys: KeySource = SealedStore.keychainKey, legacy: [Legacy] = SealedStore.plainBefore) {
    self.url = url
    self.keys = keys
    self.legacy = legacy
  }

  func get(_ key: String) -> String? {
    lock.withLock { loaded()?[key] }
  }

  func set(_ key: String, _ value: String?) {
    lock.withLock {
      guard loaded() != nil else { return waiting.append((key, value)) }
      if let value { values![key] = value } else { values!.removeValue(forKey: key) }
      queueWrite()
    }
  }

  /** Every value whose key starts so, taken away (History cleared: Browser places and seen sites). */
  func removeAll(prefix: String) {
    lock.withLock {
      guard loaded() != nil else { return waiting.append((prefix + "*", nil)) }
      values = values!.filter { !$0.key.hasPrefix(prefix) }
      queueWrite()
    }
  }

  /** Reset: the values, the file and its key, all gone. */
  func wipe() {
    lock.withLock {
      values = [:]
      waiting = []
    }
    // after any write already queued (never inside the lock: that write takes it)
    queue.sync { try? FileManager.default.removeItem(at: url) }
    keys.forget()
    for l in legacy { l.forget() }
  }

  /** Every change written (the app is going to the background). */
  func flush() { queue.sync {} }

  // ── inside the lock ──────────────────────────────────────────────────────────────────────────────────────────────

  private func loaded() -> [String: String]? {
    if let values { return values }
    guard let key = keys.read() else { return nil }
    var read: [String: String] = [:]
    if FileManager.default.fileExists(atPath: url.path) {
      // locked (complete protection) or not readable now: asked again next time, nothing lost
      guard let sealed = try? Data(contentsOf: url) else { return nil }
      if let box = try? AES.GCM.SealedBox(combined: sealed), let open = try? AES.GCM.open(box, using: key),
         let kept = try? JSONDecoder().decode([String: String].self, from: open) {
        read = kept
      }
    }
    // what was kept plain before moves in, sealed before it is taken away there
    var moved = false
    for l in legacy {
      for (k, v) in l.read() where read[k] == nil { read[k] = v; moved = true }
    }
    for (k, v) in waiting {
      if k.hasSuffix("*") { let p = String(k.dropLast()); read = read.filter { !$0.key.hasPrefix(p) } } else if let v { read[k] = v } else { read.removeValue(forKey: k) }
    }
    let changed = moved || !waiting.isEmpty
    waiting = []
    values = read
    if changed {
      if write(read, key) { for l in legacy { l.forget() } }
    }
    return read
  }

  private func queueWrite() {
    guard !writeQueued else { return }
    writeQueued = true
    queue.async { [self] in
      let (snapshot, key): ([String: String]?, SymmetricKey?) = lock.withLock {
        writeQueued = false
        return (values, keys.read())
      }
      guard let snapshot, let key else { return }
      _ = write(snapshot, key)
    }
  }

  @discardableResult
  private func write(_ v: [String: String], _ key: SymmetricKey) -> Bool {
    guard let plain = try? JSONEncoder().encode(v), let box = try? AES.GCM.seal(plain, using: key), let sealed = box.combined else { return false }
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      #if os(iOS)
      try sealed.write(to: url, options: [.atomic, .completeFileProtection])
      #else
      try sealed.write(to: url, options: [.atomic])
      #endif
      var out = url
      var noBackup = URLResourceValues()
      noBackup.isExcludedFromBackup = true
      try out.setResourceValues(noBackup)
      return true
    } catch {
      NSLog("[zf-store] the sealed file wasn't written")
      return false
    }
  }

  // ── the app's own sources ────────────────────────────────────────────────────────────────────────────────────────

  static let defaultURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("zerofee/store.sealed")

  /** The key: made once, kept in the Keychain this device only; while the phone is locked it can't be read (nil). */
  static let keychainKey = KeySource(
    read: {
      do {
        if let d = try Keychain.get("si.zerofee.store-key", "key"), d.count == 32 { return SymmetricKey(data: d) }
        let fresh = SymmetricKey(size: .bits256)
        try Keychain.set("si.zerofee.store-key", "key", fresh.withUnsafeBytes { Data($0) })
        return fresh
      } catch {
        return nil
      }
    },
    forget: { try? Keychain.delete("si.zerofee.store-key", "key") }
  )

  /** Plain before: device.store's UserDefaults suite, Browser places and the seen sites in the standard defaults. */
  static let plainBefore: [Legacy] = [
    Legacy(
      read: {
        guard let suite = UserDefaults(suiteName: "si.zerofee.device-store") else { return [:] }
        return suite.dictionaryRepresentation().compactMapValues { $0 as? String }.filter { $0.key.hasPrefix("zf.") }
      },
      forget: { UserDefaults(suiteName: "si.zerofee.device-store")?.removePersistentDomain(forName: "si.zerofee.device-store") }
    ),
    Legacy(
      read: {
        let d = UserDefaults.standard
        var out: [String: String] = [:]
        if let places = d.array(forKey: Places.key), let json = try? JSONSerialization.data(withJSONObject: places), let text = String(data: json, encoding: .utf8) { out[Places.key] = text }
        for k in d.dictionaryRepresentation().keys where k.hasPrefix("zf.partner.seen.") { out[k] = "1" }
        return out
      },
      forget: {
        let d = UserDefaults.standard
        d.removeObject(forKey: Places.key)
        for k in d.dictionaryRepresentation().keys where k.hasPrefix("zf.partner.seen.") { d.removeObject(forKey: k) }
      }
    ),
  ]
}
