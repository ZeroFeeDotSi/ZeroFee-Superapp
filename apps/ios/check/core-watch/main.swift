// The phone's isolated core on a Mac, watch-only on a real mainnet account (2 Nov): the
// real bundle in CoreContext.swift's own JavaScriptCore context, with the relay as the phone build passes it (relay.json),
// asked what each of the core's method families asks first. The "chip" gives the account's phone key's PUBLIC half
// (read from its history by ../core-watch.sh); every sheet is answered no and nothing is ever signed. A Top up's quote is
// 1Click's real one (a deposit address, nothing paid into it). Run by ../core-watch.sh.
//   args: <bundle> <accountId> <phone public key, ml-dsa-65:…> <relay https URL> <tools/ios/jsc-globals.txt> <seal-link.ts>
//
// It also checks the world the core runs in: a bare JSContext's own globals are exactly tools/ios/jsc-globals.txt (the
// list tools/ios/core-no-url.test.ts runs the bundle in), and shims.ts's own checks pass inside CoreContext's context.
import Foundation
import JavaScriptCore
import Security

final class MemoryCoreVault: CoreVault {
  private var items: [String: Data] = [:]
  func get(_ name: String) throws -> Data? { items[name] }
  func put(_ name: String, _ data: Data) throws { items[name] = data }
  func delete(_ name: String) throws { items[name] = nil }
}

@MainActor
final class WatchHost: CoreHostDelegate {
  let publicKey: String
  var sheets: [String] = []
  nonisolated init(publicKey: String) { self.publicKey = publicKey }
  func coreApprove(_ words: Any?) async -> Bool {
    sheets.append(((words as? [String: Any])?["title"] as? String) ?? "a sheet")
    return false
  }
  func coreKey(_ op: String, _ params: [String: Any]) async -> [String: Any] {
    switch op {
    case "info": return ["ok": ["publicKey": publicKey]]
    case "proof": return ["ok": ["publicKey": publicKey, "held": true]]
    case "sign", "signAlertsProof":
      sheets.append("the chip's sheet (\(op))")
      return ["ok": ["declined": true]]
    case "approval-state": return ["ok": ["changed": false]]
    default: return ["problem": ["code": "security.key.refused", "whatHappened": "watch-only: no key here"]]
    }
  }
  nonisolated func coreResource(_ name: String) -> Data? { nil }
  func coreEmit(_ event: String, _ payload: Any) {}
  func coreWords(_ words: [String], kid: Bool, renew: Bool) async -> ([Int], [String])? { nil }
  func coreSecret(_ label: String, _ secretKey: String) async -> Bool { false }
  func coreTypeWords(_ purpose: String, wordlist: [String]) async -> [String]? { nil }
}

let args = CommandLine.arguments
guard args.count == 7 else { print("usage: core-watch <bundle> <accountId> <publicKey> <relay> <jsc-globals.txt> <seal-link.ts>"); exit(2) }
let script = try String(contentsOfFile: args[1], encoding: .utf8)
let accountId = args[2], relay = args[4]
var problems = 0

// ── The world: a bare JSContext's globals, as the node:vm guard models them ─────────────────────────────────────────
let pinned = try String(contentsOfFile: args[5], encoding: .utf8).split(separator: "\n").filter { !$0.hasPrefix("#") }
  .flatMap { $0.split(separator: " ") }.map(String.init).filter { !$0.isEmpty }.sorted()
let bare = JSContext()!.evaluateScript("Object.getOwnPropertyNames(globalThis).sort().join(' ')")!.toString()!.split(separator: " ").map(String.init).sorted()
if bare == pinned {
  print("✔ a bare JSContext has exactly the \(bare.count) globals of tools/ios/jsc-globals.txt (no URL, crypto, fetch, TextEncoder, WebSocket)")
} else {
  print("✖ a bare JSContext's globals differ from tools/ios/jsc-globals.txt: here only \(Set(bare).subtracting(pinned).sorted()), there only \(Set(pinned).subtracting(bare).sorted())")
  problems += 1
}

let vault = MemoryCoreVault()
try vault.put("state", Data(#"{"accountId":"\#(accountId)","stage":"ready","recoveryIn":true}"#.utf8))
// A throwaway hot root, made here, in memory only, for Chat's key (nostr.*): never the account's own, never kept.
var root = [UInt8](repeating: 0, count: 64)
_ = SecRandomCopyBytes(kSecRandomDefault, root.count, &root)
try vault.put("hot-root", Data(root))
let host = WatchHost(publicKey: args[3])
let relayHost = URL(string: relay)?.host ?? ""
let core = try CoreContext(script: script, network: "mainnet", vault: vault, delegate: host, allowedHosts: CoreContext.coreHosts.union([relayHost]), relay: relay)

func line(_ v: Any) -> String {
  let data = (try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
  return String(String(decoding: data, as: UTF8.self).prefix(700))
}
/** What JavaScriptCore says when something isn't there: in any answer, a phone-only crash. */
let fault = try NSRegularExpression(pattern: "ReferenceError|TypeError|Can't find variable|is not a function|is not a constructor|undefined is not an object")

/** One call. `expect`: the Problem codes that are this step's right answer (a sheet answered no, an account without it). */
@MainActor func ask(_ method: String, _ params: [String: Any] = [:], expect: Set<String> = []) async -> [String: Any] {
  host.sheets = []
  let started = Date()
  let r = await core.call(method, params)
  let ms = Int(Date().timeIntervalSince(started) * 1000)
  let code = (r["problem"] as? [String: Any])?["code"] as? String
  let text = line(r)
  let faulted = fault.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
  let fine = !faulted && (code == nil || expect.contains(code!))
  print(fine ? (code == nil ? "✔" : "✔ (as expected)") : "✖", method, "(\(ms) ms)", params.isEmpty ? "" : line(params), text)
  for s in host.sheets { print("   ↳ reached the sheet: \(s) (answered no; nothing signed)") }
  if !fine { problems += 1 }
  return r
}

/** The laptop extension's QR for the phone's code, by the extension's own sealForLink (a throwaway seed). */
func sealForLink(_ code: String) -> String {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  p.arguments = ["node", args[6], code]
  let out = Pipe()
  p.standardOutput = out
  try? p.run()
  p.waitUntilExit()
  return String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
}

Task { @MainActor in
  print("watch-only \(accountId) in CoreContext.swift's own JavaScriptCore context, relay \(relayHost)")
  let shims = await core.checkShims()
  let bad = shims.filter { ($0.value as? Bool) != true }
  print(bad.isEmpty ? "✔ shims.ts's checks pass in this context: \(shims.keys.sorted().joined(separator: ", "))" : "✖ shims.ts's checks: \(line(shims))")
  if !bad.isEmpty { problems += 1 }

  print("— account: its state, Security's first card (\"Your key\", \"How we know\"), protection, waits, activity (the ledger)")
  _ = await ask("account.state")
  _ = await ask("account.keyProof")
  _ = await ask("account.protection.get")
  _ = await ask("account.nearPrice")
  _ = await ask("account.waiting")
  _ = await ask("account.activity", ["limit": 5])
  print("— rules: the account's release, and its update to ZeroFee's current one (the sheet, answered no)")
  _ = await ask("account.rules")
  _ = await ask("account.rules.update")
  print("— second device and recovery: what Security shows")
  _ = await ask("account.secondDevices")
  _ = await ask("recovery.status")
  _ = await ask("account.agent.view")
  print("— spending and float: what every Top up asks the core: Spending's NEAR balance, then the Add's quote (0.7 NEAR, as wNEAR)")
  _ = await ask("subwallet.create", ["kind": "trade", "chain": "near", "app": "trade"])
  _ = await ask("subwallet.list", ["app": "trade"])
  _ = await ask("subwallet.float.limits", ["app": "trade"])
  _ = await ask("subwallet.float.balance", ["app": "trade"])
  _ = await ask("subwallet.float.quoteAdd", ["amount": "700000000000000000000000", "tokenId": "nep141:wrap.near", "app": "trade"])
  // An account that never made its Private balance: "Make the Private balance first" is the right answer.
  _ = await ask("subwallet.private.balances", ["app": "wallet"], expect: ["security.subwallet.refused"])
  print("— subwallet: Apps' pump.fun, as the Browser wallet asks: the chain's wallet, then its Sign In With Solana (Swift's site, from WebKit)")
  let made = await ask("subwallet.create", ["chain": "sol", "app": "browser"])
  if let w = made["ok"] as? [String: Any], let id = w["id"] as? String, let address = w["address"] as? String {
    let siws = "pump.fun wants you to sign in with your Solana account:\n\(address)\n\nSign in to pump.fun\n\nURI: https://pump.fun\nVersion: 1\nChain ID: mainnet\nNonce: 8f2a91c4\nIssued At: \(ISO8601DateFormatter().string(from: Date()))"
    // { declined } is the sheet, answered no here: the sign-in reached it. A Problem is a refusal before any sheet.
    _ = await ask("subwallet.signMessage", ["id": id, "message": Data(siws.utf8).base64EncodedString(), "site": ["origin": "https://pump.fun"], "app": "browser"])
  }
  print("— import: linking the laptop's extension (its own sealForLink, a throwaway seed): the box opens and reaches the sheet")
  let link = await ask("subwallet.linkStart", ["kind": "extension"])
  if let code = (link["ok"] as? [String: Any])?["code"] as? String {
    _ = await ask("subwallet.import", ["kind": "extension", "sealed": sealForLink(code)], expect: ["security.link.declined"])
  }
  print("— nostr: ZeroFee Chat's key (the relays' WebSockets are the page's): a place's name and a signed presence")
  _ = await ask("nostr.publicKey", ["geohash": "u0", "app": "chat"])
  _ = await ask("nostr.sign", ["geohash": "u0", "kind": 20001, "content": "", "app": "chat"])
  print(problems == 0 ? "every call answered" : "\(problems) Problem(s)")
  exit(problems == 0 ? 0 : 1)
}
dispatchMain()
