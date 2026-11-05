// D131 Browser tabs: the pure rules (no UIKit), so apps/ios/check runs them on a Mac (partner.sh).
import Foundation

enum TabRules {
  /** At most this many Browser pages open at once. */
  static let cap = 8

  /** One open page, as the rules see it. */
  struct Tab: Equatable {
    let id: String
    /** AgentZero is running a task in it (never closed for room). */
    let busy: Bool
    /** On screen now (never closed for room). */
    let shown: Bool
  }

  /** Opening one more page: which page closes to make room (the oldest that is neither shown nor busy), if any must.
   *  `tabs` is oldest first. nil: there is room, or nothing may close (then the new page still opens). */
  static func toClose(_ tabs: [Tab], cap: Int = cap) -> String? {
    guard tabs.count >= cap else { return nil }
    return tabs.first { !$0.shown && !$0.busy }?.id
  }

  /** The tab list's name for a page: its own title when it has one, else its host. Never more than 60 letters. */
  static func name(title: String?, host: String) -> String {
    let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let n = t.isEmpty ? host : t
    return n.count > 60 ? String(n.prefix(59)) + "…" : n
  }

  /** The Tabs button's words. */
  static func buttonLabel(_ count: Int) -> String { count == 1 ? "Tabs, 1 open" : "Tabs, \(count) open" }

  static let listTitle = "Open pages"
  static let newTab = "New tab"
  static let closeTab = "Close"
  static let inBackLine = "AgentZero waits while this tab is in the back."
  static let walletInBack = "This tab is in the back. Open it to answer."
  static let full = "Close a page first."

  /** Review H1: a Browser-wallet signature reaches the core only with the page on screen that asked for it (its site);
   *  with none, it's refused, never signed site-less. Other apps' signatures carry no site and pass. */
  static func refusesSiteless(app: String?, hasSite: Bool) -> Bool { app == "browser" && !hasSite }

  /** Review L1: the site the engine names must be the on-screen tab's waiting host, exactly; never replaced by another.
   *  `engine`: the engine's `site.origin`, if it sent one. `waiting`: "https://<the on-screen tab's asking host>". */
  static func siteMatches(engine: String?, waiting: String?) -> Bool {
    guard let waiting else { return false }
    return engine == nil || engine == waiting
  }

  /** Review L1/L2: a page may not be switched away from while its wallet waits on the person or an approval sheet is open. */
  static func mayLeave(walletWaiting: Bool, approvalOpen: Bool) -> Bool { !walletWaiting && !approvalOpen }
  static let answerFirst = "Answer the wallet question first."

  /** Review H1: a wallet request's id is unique across every tab ("w-" and a UUID), never "w1" in two tabs. */
  static func isRequestId(_ id: String) -> Bool { id.hasPrefix("w-") && UUID(uuidString: String(id.dropFirst(2))) != nil }

  /** Security audit M2: a zerofee:// return link from a site counts from its top frame only. A frame inside the page
   *  (an ad, another site) never closes the window. */
  static func returnLinkCounts(isMainFrame: Bool) -> Bool { isMainFrame }

  /** Security audit M2: a return link (a site's, or another app's through the URL scheme) is taken only for the app that
   *  opened the window, and never while a native approval sheet is open: closing the window would take the sheet with
   *  it, unanswered, and leave the site free to draw its own. */
  static func takesReturn(app: String, knownApps: Set<String>, awaiting: String?, approvalOpen: Bool) -> Bool {
    !approvalOpen && knownApps.contains(app) && awaiting == app
  }
  /** subwallet.site.forHost (phone test, 3 Nov: connect refused): the Browser only, a plain https origin, and a host with
   *  a page asking the engine right now (`openHosts`: the hosts of pending requests). It signs nothing, so no waiting
   *  signature is needed. */
  static func forHostAllowed(app: String?, origin: String?, openHosts: Set<String>) -> Bool {
    guard app == "browser", let origin, let host = URL(string: origin)?.host?.lowercased(), origin == "https://\(host)" else { return false }
    return openHosts.contains(host)
  }
  /** Ruling c: the only core signature AgentZero's own window may ask is a sign-in message; a transaction, a send, typed
   *  data or a check ahead of one is refused before the core sees it. Any other window: unchanged. */
  static func agentWindowMay(_ method: String, agentWindow: Bool) -> Bool { !agentWindow || method == "subwallet.signMessage" }
}

/** Security audit M1: when a native sheet (a Face ID approval, the words, a password) may show. */
enum SheetRules {
  enum AppState { case active, inactive, background }
  /** Only while ZeroFee is the app in front; otherwise the sheet answers Not now and nothing shows. */
  static func mayShow(_ state: AppState) -> Bool { state == .active }
  /** Inactive for a moment (a Face ID prompt just closed, a banner): wait at most this long for active, then Not now.
   *  In the background there's no wait. Active (the usual case) waits 0 ms. */
  static func waitsForActive(_ state: AppState) -> Bool { state == .inactive }
  static let activeWithinMs = 1000
  /** An approval sheet open when ZeroFee goes to the background is put away, answered no (it never waits over whatever
   *  shows when the person comes back). The words being typed or shown are kept: the person may be reading them. */
  static func putAway(approval: Bool, wentToBackground: Bool) -> Bool { approval && wentToBackground }
}
