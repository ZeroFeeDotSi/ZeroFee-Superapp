// D131, Block trackers on the phone: TrackerRules' list compiled once into a WebKit content rule list, kept by WebKit
// under its version's name (so later launches look it up instead of compiling), and added to each Browser window
// before its first page. Pay's partner windows never get it. Compiling ~47,000 rules takes a moment the first time, so
// it starts when ZeroFee opens (warmUp) and a window waits for it at most a short while; a window that opened before
// it was ready gets it added the moment it is.
import Foundation
import WebKit

@MainActor
enum TrackerBlocker {
  private static var compiling: Task<WKContentRuleList?, Never>?
  private static var ready: WKContentRuleList?
  /** How long a window's first page waits for the list on the very first launch. */
  static let waitMs: UInt64 = 1_500

  /** Start looking up (or compiling) the list now, so the first Browser window doesn't wait. */
  static func warmUp() { _ = task() }

  private static func task() -> Task<WKContentRuleList?, Never> {
    if let compiling { return compiling }
    let t = Task { @MainActor () -> WKContentRuleList? in
      guard let store = WKContentRuleListStore.default() else { return nil }
      if let found = try? await store.contentRuleList(forIdentifier: TrackerRules.identifier) {
        ready = found
        return found
      }
      // an older version's compiled list goes (one at a time on the phone)
      for id in (await store.availableIdentifiers()) ?? [] where id.hasPrefix("zerofee-trackers-") && id != TrackerRules.identifier {
        try? await store.removeContentRuleList(forIdentifier: id)
      }
      guard let url = Bundle.main.url(forResource: "trackers", withExtension: "txt"),
            let text = try? String(contentsOf: url, encoding: .utf8) else {
        NSLog("[zf-host] the tracker list isn't in the app: trackers aren't blocked")
        return nil
      }
      let domains = await Task.detached(priority: .utility) { TrackerRules.domains(fromList: text) }.value
      guard let json = await Task.detached(priority: .utility, operation: { TrackerRules.ruleJSON(domains: domains) }).value else { return nil }
      let list = try? await store.compileContentRuleList(forIdentifier: TrackerRules.identifier, encodedContentRuleList: json)
      if list == nil { NSLog("[zf-host] the tracker rules didn't compile: trackers aren't blocked") }
      ready = list
      return list
    }
    compiling = t
    return t
  }

  /** The list for a window: at once if it's ready, else after at most `waitMs` (then nil, and `whenReady` adds it). */
  static func list(whenReady: @escaping @MainActor (WKContentRuleList) -> Void) async -> WKContentRuleList? {
    guard TrackerRules.isOn else { return nil }
    if let ready { return ready }
    let t = task()
    let timedOut = Task { try? await Task.sleep(nanoseconds: waitMs * 1_000_000) }
    let got = await withTaskGroup(of: WKContentRuleList?.self) { group in
      group.addTask { await t.value }
      group.addTask { await timedOut.value; return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
    if got == nil { Task { @MainActor in if let l = await t.value { whenReady(l) } } }
    return got
  }
}
