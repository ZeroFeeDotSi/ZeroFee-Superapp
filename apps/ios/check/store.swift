// The sealed store (SealedStore.swift, audit M4) on a Mac, no simulator: the same file the app ships. Values sealed at
// rest (never plain in the file), read back by the same key only, plain values from before moved in and taken away there,
// nothing lost while the phone is locked, History's prefix cleared, Reset's wipe, and the cost of a get and a set.
// Run by store.sh; exit 0 = all passed.
import CryptoKit
import Foundation

var failed = 0
func check(_ ok: Bool, _ what: String) {
  print(ok ? "ok   " : "FAIL ", what)
  if !ok { failed += 1 }
}

let dir = FileManager.default.temporaryDirectory.appendingPathComponent("zf-store-check-\(UUID().uuidString)")
let url = dir.appendingPathComponent("store.sealed")
let key = SymmetricKey(size: .bits256)
var unlocked = true
var forgotKey = false
let source = SealedStore.KeySource(read: { unlocked ? key : nil }, forget: { forgotKey = true })
var plain: [String: String] = ["zf.agent.chats": "payee kim.near $40", "zf.partner.seen.pump.fun": "1"]
var plainForgotten = false
let before = SealedStore.Legacy(read: { plain }, forget: { plain = [:]; plainForgotten = true })

let s = SealedStore(url: url, keys: source, legacy: [before])
check(s.get("zf.agent.chats") == "payee kim.near $40", "a value kept plain before is read, moved in")
check(plainForgotten && plain.isEmpty, "and taken away from where it was plain, once sealed")
s.set("zf.wallet.home-cache.v1", "{\"total\":\"1234.56\"}")
s.set("zf.browser.places", "[[\"pump.fun\",\"https://pump.fun/coin/x\",\"site\"]]")
s.flush()
let bytes = (try? Data(contentsOf: url)) ?? Data()
let text = String(decoding: bytes, as: UTF8.self)
check(!bytes.isEmpty && !text.contains("kim.near") && !text.contains("1234.56") && !text.contains("pump.fun"), "the file holds no value in the clear")
check(String(decoding: try! JSONEncoder().encode(["a": "kim.near"]), as: UTF8.self).contains("kim.near"), "control: a plain copy would show it")
let backup = (try? url.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup == true
check(backup, "the file is never in a backup")

let again = SealedStore(url: url, keys: source, legacy: [])
check(again.get("zf.wallet.home-cache.v1") == "{\"total\":\"1234.56\"}", "a new start reads every value back with the key")
let stranger = SealedStore(url: url, keys: SealedStore.KeySource(read: { SymmetricKey(size: .bits256) }, forget: {}), legacy: [])
check(stranger.get("zf.wallet.home-cache.v1") == nil, "another key opens nothing (control: the right key did)")

// locked: nothing read, nothing lost; the change made then is there once it can be read
unlocked = false
let locked = SealedStore(url: url, keys: source, legacy: [])
check(locked.get("zf.agent.chats") == nil, "while locked, nothing is read")
locked.set("zf.chat.places", "a city")
unlocked = true
check(locked.get("zf.chat.places") == "a city" && locked.get("zf.agent.chats") == "payee kim.near $40", "unlocked: the change made while locked is kept, nothing before it lost")

// History cleared: the seen sites go, the rest stays
locked.removeAll(prefix: "zf.partner.seen.")
check(locked.get("zf.partner.seen.pump.fun") == nil && locked.get("zf.chat.places") == "a city", "History's prefix goes, the rest stays")

// the cost: a get and a set, in memory (the file is written off the caller's thread)
let n = 20_000
var t = Date()
for i in 0..<n { _ = locked.get("zf.agent.k\(i % 50)") }
let getMs = Date().timeIntervalSince(t) * 1000 / Double(n)
t = Date()
for i in 0..<n { locked.set("zf.agent.k\(i % 50)", "v\(i)") }
let setMs = Date().timeIntervalSince(t) * 1000 / Double(n)
locked.flush()
check(getMs < 0.1 && setMs < 0.1, String(format: "a get %.4f ms, a set %.4f ms (under 0.1 ms)", getMs, setMs))
check(SealedStore(url: url, keys: source, legacy: []).get("zf.agent.k49") == "v\(n - 1)", "the last of many sets is the one on disk")

// Reset: the file and its key go
locked.wipe()
check(!FileManager.default.fileExists(atPath: url.path) && forgotKey, "Reset takes the file and its key")
check(locked.get("zf.chat.places") == nil, "and nothing is read after it")

try? FileManager.default.removeItem(at: dir)
print(failed == 0 ? "all passed" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
