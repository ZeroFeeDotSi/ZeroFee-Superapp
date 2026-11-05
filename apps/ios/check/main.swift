// The native sheet's checks, run on a Mac against real bytes from the core (vectors.ts): the chip may sign only a NEAR
// transaction for its own key, hashed here; the words are read whole or refused. Run by run.sh.
import Foundation

let path = CommandLine.arguments[1]
let v = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: String]
func bytes(_ name: String) -> Data {
  let h = Array(v[name]!.utf8)
  return Data(stride(from: 0, to: h.count, by: 2).map { UInt8(String(decoding: h[$0..<$0 + 2], as: UTF8.self), radix: 16)! })
}
var failed = 0
func check(_ ok: Bool, _ what: String) {
  print(ok ? "ok   " : "FAIL ", what)
  if !ok { failed += 1 }
}

let key = bytes("publicKey")
let header = NearTx.header(bytes("valid"), publicKey: key)
check(header == NearTx.Header(signerId: "alice.near", receiverId: "alice.near", nonce: 7, actions: 1), "a real transaction for this key is read: alice.near, nonce 7, 1 action")
check(NearTx.hash(bytes("valid")) == bytes("validHash"), "its hash here equals the core's sha256 of the same bytes")
check(NearTx.header(bytes("otherKey"), publicKey: key) == nil, "a transaction for another key is refused")
check(NearTx.header(bytes("delegate"), publicKey: key) == nil, "a NEP-366 delegate action is refused")
check(NearTx.header(bytes("nep413"), publicKey: key) == nil, "a NEP-413 signed message is refused")
check(NearTx.header(bytes("noActions"), publicKey: key) == nil, "a transaction with no actions is refused")
check(NearTx.header(bytes("hash32"), publicKey: key) == nil, "a bare 32-byte hash is refused")
check(NearTx.header(Data(count: NearTx.maxBytes + 1), publicKey: key) == nil, "over NEAR's size limit is refused")
check(NearTx.header(bytes("valid"), publicKey: key.dropLast()) == nil, "a public key of the wrong size is refused")

let words: [String: Any] = [
  "title": "Send 1 NEAR to bob.near", "lines": ["From your balance", "Network fee: at most 0.0005 NEAR"],
  "warnings": [["kind": "first-time-recipient", "text": "First time you send to bob.near."]],
  "effect": [["token": "NEAR", "before": "10", "after": "8.9995"]],
  "hint": "Wallet says: lunch", "amount": "about $4.38 (1 NEAR)", "protection": ["level": "both", "waitSeconds": 172800, "text": "x"],
]
let read = SheetWords(words)
// D146: the asker rides with the words; the sheet shows only while that app is on screen (controls: no asker, Trade's
// engine, no app on screen yet)
check(read?.asker == nil && SheetWords(words.merging(["asker": "browser"]) { $1 })?.asker == "browser", "D146: the asking app is read with the words")
check(SheetWords(words.merging(["asker": "Browser!"]) { $1 }) == nil && SheetWords(words.merging(["asker": 7]) { $1 }) == nil, "D146: an asker that isn't a plain app id refuses the words")
check(!SheetWords.mayShow(asker: "browser", onScreen: "wallet") && !SheetWords.mayShow(asker: "agent", onScreen: "trade") && SheetWords.mayShow(asker: "browser", onScreen: "browser"), "D146: another app's sheet never shows over the one on screen (control: its own app on screen, it shows)")
check(SheetWords.mayShow(asker: nil, onScreen: "wallet") && SheetWords.mayShow(asker: "trade", onScreen: "wallet") && SheetWords.mayShow(asker: "wallet", onScreen: "browser") && SheetWords.mayShow(asker: "browser", onScreen: ""), "D146: ZeroFee's own screens, the relays (Spending's engine, Home's money sheet), or no app on screen yet: it shows")
check(!SheetWords.mayShow(asker: "wallet", onScreen: "browser", moneyOpen: false) && !SheetWords.mayShow(asker: "trade", onScreen: "browser", moneyOpen: false) && SheetWords.mayShow(asker: "trade", onScreen: "trade", moneyOpen: false), "review M5: a relay's sheet never shows once its money step was put away (control: Trade's own Add on Trade)")
// D143 (review, 3 Nov): a hot key's sheet is one tap, never Face ID, only when the core says `tap: true` (controls:
// absent, or anything but true, is Face ID)
check(SheetWords(words.merging(["tap": true]) { $1 })?.tap == true && read?.tap == false && SheetWords(words.merging(["tap": "true"]) { $1 })?.tap == false && SheetWords(words.merging(["tap": 1]) { $1 })?.tap == false, "D143: the one-tap sheet only when the core says tap: true")
check(read?.title == "Send 1 NEAR to bob.near" && read?.lines.count == 2 && read?.warnings == ["First time you send to bob.near."], "words are read whole: title, every line, every warning")
check(read?.effects == [SheetWords.Effect(token: "NEAR", before: "10", after: "8.9995")] && read?.hint == "Wallet says: lunch", "effects and the hint are read")
check(read?.protection == "Waits 2 days · this phone can cancel · needs your second device", "the protection line matches the web sheet's")
check(SheetWords.protectionWords(level: "faceid", waitSeconds: 0) == nil && SheetWords.waitWords(120) == "2 minutes" && SheetWords.waitWords(3600) == "1 hour", "Face ID alone has no clock line; waits read as on the web")
var bad = words; bad["lines"] = ["fine", 7]
check(SheetWords(bad) == nil, "a line that can't be read refuses the words (never dropped quietly)")
bad = words; bad["warnings"] = [["kind": "large-amount"]]
check(SheetWords(bad) == nil, "a warning without its text refuses the words")
bad = words; bad["title"] = ""
check(SheetWords(bad) == nil, "an empty title refuses the words")
bad = words; bad["title"] = String(repeating: "a", count: 4001)
check(SheetWords(bad) == nil, "words beyond any real request's size are refused")
bad = words; bad["protection"] = ["level": "never", "waitSeconds": 0]
check(SheetWords(bad) == nil, "an unknown protection level refuses the words")
bad = words; bad.removeValue(forKey: "hint"); bad.removeValue(forKey: "protection")
check(SheetWords(bad)?.hint == nil && SheetWords(bad)?.protection == nil, "no hint and no protection are fine")
check(read?.amount == "about $4.38 (1 NEAR)" && SheetWords(bad)?.amount == "about $4.38 (1 NEAR)", "the amount in dollars is read (grade 02g, G11)")
bad = words; bad.removeValue(forKey: "amount")
check(SheetWords(bad) != nil && SheetWords(bad)?.amount == nil, "no amount is fine (nothing leaves, or no price)")
bad = words; bad["amount"] = "about $4\u{202E}38"
check(SheetWords(bad) == nil, "an amount that changes how text reads refuses the words")
bad = words; bad["amount"] = 7
check(SheetWords(bad) == nil, "an amount that isn't text refuses the words")
bad = words; bad["title"] = "Send $5.00 (1.1765 NEAR) to alex.near"
check(SheetWords(bad)?.title == "Send $5.00 (1.1765 NEAR) to alex.near", "a dollars-first title is read whole, the exact NEAR in it (J6)")
bad = words; bad["lines"] = ["It waits 2 days. You, or your backup words, can stop it."]; bad["protection"] = ["level": "wait", "waitSeconds": 172800, "text": "It waits 2 days. You, or your backup words, can stop it."]
check(SheetWords(bad) != nil && SheetWords(bad)?.protection == nil, "the clock line isn't said again when the lines carry the protection's own sentence (grade 02g, E15)")
// UI-SIMPLICITY-RULES 6 (phone test, 2 Nov): a rule's every coin sits in a labelled disclosure, read whole or refused.
bad = words; bad["details"] = [["label": "See which coins count", "lines": ["NEAR: up to 200 NEAR", "SOL: up to 5 SOL"]]]
check(SheetWords(bad)?.details == [SheetWords.Details(label: "See which coins count", lines: ["NEAR: up to 200 NEAR", "SOL: up to 5 SOL"])], "a disclosure is read whole: its label and every line")
check(read?.details == [], "no disclosure is fine")
bad = words; bad["details"] = [["label": "See which coins count", "lines": ["NEAR: up to 200 NEAR", 7]]]
check(SheetWords(bad) == nil, "a disclosure line that can't be read refuses the words (never dropped quietly)")
bad = words; bad["details"] = [["lines": ["NEAR: up to 200 NEAR"]]]
check(SheetWords(bad) == nil, "a disclosure without its label refuses the words")

// iOS audit finding 1: the sheet signs only when the bytes, decoded here, say the summary the words were built from, and
// shows the receiver and amount it read itself.
func summaryObject(_ name: String) -> [String: Any] { try! JSONSerialization.jsonObject(with: Data(v[name]!.utf8)) as! [String: Any] }
func agrees(_ tx: String, _ summary: Any?) -> Bool {
  guard let d = NearTx.decode(bytes(tx), publicKey: key), let s = NearTx.summary(summary) else { return false }
  return NearTx.matches(d, s)
}
let pay = summaryObject("paySummary")
check(agrees("payBytes", pay), "a payment's bytes agree with the core's summary (control)")
check(NearTx.decode(bytes("payBytes"), publicKey: key)?.checked == ["To bob.near", "Sends 1.5 NEAR"], "the sheet shows the receiver and the NEAR it read from the bytes")
var lie = pay; lie["receiver"] = "eve.near"
check(!agrees("payBytes", lie), "a summary naming another receiver is refused")
lie = pay; lie["actions"] = [["kind": "transfer", "deposit": "1"]]
check(!agrees("payBytes", lie), "a summary naming another amount is refused")
lie = pay; lie["actions"] = [["kind": "call", "method": "ft_transfer", "deposit": "1500000000000000000000000", "gas": "1"]]
check(!agrees("payBytes", lie), "a summary naming another kind of step is refused")
check(!agrees("payBytes", nil) && !agrees("payBytes", ["receiver": "bob.near"]), "no summary, or half a summary, is refused")
let wrapped = summaryObject("wrappedSummary")
check(agrees("wrappedBytes", wrapped), "execute() on the account: the bytes agree with the summary's inner receiver and steps (control)")
check(NearTx.decode(bytes("wrappedBytes"), publicKey: key)?.checked == ["To usdc.near", "Coin goes to bob.near", "Sends 0.000000000000000000000001 NEAR"], "for execute(), the sheet shows the inner receiver and the coin's recipient from the bytes")
lie = wrapped; lie["inner"] = [["receiver": "evil.near", "steps": [["kind": "call", "method": "ft_transfer", "deposit": "1", "gas": "30000000000000"]]]]
check(!agrees("wrappedBytes", lie), "execute(): a summary naming another inner receiver is refused")
lie = wrapped; lie.removeValue(forKey: "inner")
check(!agrees("wrappedBytes", lie), "execute(): a summary that leaves out the inner steps is refused")
lie = pay; lie["inner"] = [["receiver": "bob.near", "steps": [["kind": "transfer", "deposit": "1500000000000000000000000"]]]]
check(!agrees("payBytes", lie), "inner steps claimed for a transaction that has none are refused")
let many = summaryObject("manySummary")
check(agrees("manyBytes", many), "execute_many(): every group agrees (control)")
check(NearTx.decode(bytes("manyBytes"), publicKey: key)?.checked == ["To bob.near", "Sends 2 NEAR", "To usdc.near", "Coin goes to bob.near", "Sends 0.000000000000000000000001 NEAR"], "execute_many(): each group's receiver and NEAR, from the bytes")
lie = many; lie["inner"] = Array((many["inner"] as! [Any]).prefix(1))
check(!agrees("manyBytes", lie), "execute_many(): a summary that drops a group is refused")
let keys = summaryObject("keysSummary")
check(agrees("keysBytes", keys), "key changes: the keys and their access agree (control)")
check(NearTx.decode(bytes("keysBytes"), publicKey: key)?.checked == ["On your own account", "Adds a key that can do anything", "Adds a key for app.near only", "Removes a key"], "key changes are shown from the bytes")
lie = keys; var acts = keys["actions"] as! [[String: Any]]; acts[0]["publicKey"] = "ed25519:11111111111111111111111111111111"; lie["actions"] = acts
check(!agrees("keysBytes", lie), "a summary naming another added key is refused")
lie = keys; acts = keys["actions"] as! [[String: Any]]; acts[1]["permission"] = "full"; lie["actions"] = acts
check(!agrees("keysBytes", lie), "a summary calling a limited key full (or the other way) is refused")
check(NearTx.decode(bytes("otherKey"), publicKey: key) == nil && NearTx.decode(bytes("delegate"), publicKey: key) == nil && NearTx.decode(bytes("noActions"), publicKey: key) == nil, "the decoder refuses what the header check refuses")
check(NearTx.decode(bytes("payBytes") + Data([0]), publicKey: key) == nil, "bytes left over after the transaction are refused")
check(NearTx.nearText(1) == "0.000000000000000000000001" && NearTx.nearText(0) == "0", "NEAR amounts are exact")

print(failed == 0 ? "all checks passed" : "\(failed) FAILED")
exit(failed == 0 ? 0 : 1)
