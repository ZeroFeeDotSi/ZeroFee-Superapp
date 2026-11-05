// The isolated core's smoke test (S1.6 phase 2, step 1), on a Mac: the real bundle (core/dist/zerofee-core.js) in
// CoreContext.swift's own JavaScriptCore context, answering read-only calls on NEAR testnet. Run by ../core-smoke.sh.
import Foundation

final class MemoryCoreVault: CoreVault {
  private var items: [String: Data] = [:]
  func get(_ name: String) throws -> Data? { items[name] }
  func put(_ name: String, _ data: Data) throws { items[name] = data }
  func delete(_ name: String) throws { items[name] = nil }
}

var failed = 0
func check(_ ok: Bool, _ what: String, _ detail: Any = "") {
  print(ok ? "ok   " : "FAIL ", what, detail)
  if !ok { failed += 1 }
}

let script = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
let started = Date()
let core = try CoreContext(script: script, network: "testnet", vault: MemoryCoreVault())
check(true, "the bundle loads and the core starts in its own context", String(format: "(%.0f ms)", Date().timeIntervalSince(started) * 1000))

let done = DispatchSemaphore(value: 0)
Task {
  let state = await core.call("account.state")
  let stage = (state["ok"] as? [String: Any])?["stage"] as? String
  check(stage != nil, "account.state answers from the isolated core", state)

  let block = await core.check()
  let height = (block["height"] as? NSNumber)?.intValue ?? 0
  check(height > 0 && (block["hash"] as? String)?.isEmpty == false, "two testnet nodes agree on a recent block, read through Swift's fetch", block)

  let shims = await core.checkShims()
  let shimNames = ["utf8RoundTrip", "utf8Bytes", "fatalRefusesBadUtf8", "base64RoundTrip", "randomBytes", "timerFires", "abortTimeout"]
  check(shimNames.allSatisfy { (shims[$0] as? Bool) == true }, "the shims work inside the context: utf-8 (fatal too), base64, random bytes, timers, AbortSignal.timeout", shims)

  let unknown = await core.call("no.such.method")
  check((unknown["problem"] as? [String: Any])?["code"] != nil, "an unknown method is a Problem, not a crash", (unknown["problem"] as? [String: Any])?["code"] ?? "")

  let refused = try? CoreContext(script: script, network: "testnet", vault: MemoryCoreVault(), allowedHosts: ["example.com"])
  let blocked = await refused?.check() ?? [:]
  check((blocked["error"] as? String) != nil, "with its hosts narrowed, the core can't reach the nodes at all", blocked)
  done.signal()
}
done.wait()
print(failed == 0 ? "all checks passed" : "\(failed) FAILED")
exit(failed == 0 ? 0 : 1)
