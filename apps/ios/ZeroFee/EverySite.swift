// The product Browser thesis, part 1 (4 Nov 2026): "when you go to a site, it auto-creates a new wallet for it". Every
// https page in a Browser tab has ZeroFee's wallet (wallet mode, the Browser wallet: provider.js and the zerofeeWallet
// handler), and Browser's engine connects it at once with that site's own new wallet: no chooser, no sign-up, no connect
// sheet. Pure (Foundation only), so apps/ios/check runs it on a Mac (partner.sh).
//
// Which windows: a Browser tab (the Browser app's device.openSite, the same tab reopened, or the private window a
// Browser tab's link opened), on an adult's phone. Never Pay's windows (their own pinned recipes), Social trading's site
// windows (their own recipe), AgentZero's, or a page an app's link opened.
// Which hosts: a public site's plain name (no number, no look-alike letters, no home-network name: agentRefuses' rule)
// that the phishing guard doesn't stop (PhishGuard.imitates). A look-alike gets no provider and no wallet, even after
// "Open anyway".
// Private windows (Tor, PrivateBrowsing.usesTor; audit pass 2, item 4): PartnerWallet tells the engine
// `privateWindow`, and the engine never auto-connects there, so no host-named wallet or Sites entry is kept for a site
// only visited privately; the connect sheet's yes still connects it.
// What doesn't change: the core signs, from the site's own wallet only, inside the one cap; an unlisted site signs only
// through its one-tap sheet (D143); the wallet is made only when the page asks (IsolatedCore's forHost rule); a site the
// person disconnected stays so until they say yes on the connect sheet again.
import Foundation

enum EverySite {
  /** May a Browser tab's page on this host (as the strip shows it: lowercased, no port when 443) have the wallet? */
  static func covers(_ host: String) -> Bool {
    PartnerRecipe.agentRefuses(host) == nil && PhishGuard.imitates(host) == nil
  }

  /** The recipe a window opened by `app` gets: a Browser tab the every-site one, whatever the shell sent; any other
   *  app the one the shell sent and the pinned table accepted (nil: the plain window). */
  static func recipe(app: String, accepted: PartnerRecipe?) -> PartnerRecipe? {
    app == "browser" ? PartnerRecipe.browserTab : accepted
  }

  /** The host's own gate (WalletGate.precheck's `connected`): the person's yes on the connect sheet, or, in a Browser
   *  tab, every site the person hasn't disconnected (the Browser wallet only). */
  static func connected(yes: Bool, everySite: Bool, kind: String, disconnected: Bool) -> Bool {
    yes || (everySite && kind == "browser" && !disconnected)
  }
}

// The product Browser thesis, part 2 (4 Nov 2026): Top up, right there in the Browser, for the site's own wallet. Once
// the engine has answered a Browser tab's page with that site's own Solana wallet (the one Home's Put money in fills,
// D160), the window's one bottom line says "<host> has its own wallet." with Top up and ×. A tap puts the tab in the
// back (kept), the Browser under it hears `device.site.topupHost { host, tab }` (the host WebKit shows, never the page's
// word) and opens Home's Put money in for that host's own wallet over itself (D146: only while it is on screen), then
// shows the tab again with one line.
extension EverySite {
  /** The engine answered the page's Solana connect (silent too) with the site's own wallet: an answer to a request this
   *  host relayed, never anything the page says. A silent connect that isn't connected answers null. */
  static func solanaAnswered(method: String, result: Any?) -> Bool {
    method == "solana:connect" && result != nil && !(result is NSNull)
  }

  /** Does the Top up line show? A Browser tab only (never Pay's windows, a child's phone, a site's own window or
   *  AgentZero's), on a site it covers, whose Solana wallet the engine answered in this window, while the person hasn't
   *  disconnected it or hidden the line for it. */
  static func offersTopUp(recipe: PartnerRecipe?, kid: Bool, siteName: String?, host: String, answered: Set<String>, disconnected: Bool, hidden: Set<String>) -> Bool {
    guard let recipe, recipe.everySite, !kid, siteName == nil, answered.contains(host), !disconnected, !hidden.contains(host) else { return false }
    return covers(host)
  }

  /** The line (its button is PartnerNotice's Top up). */
  static func topUpLine(_ host: String) -> String { "\(host) has its own wallet." }
  /** What the tab says when it comes back after the money went. */
  static func onItsWay(_ host: String) -> String { "On its way to your \(host) wallet." }

  /** device.site.money from the Browser: `{ host, went: true }` only, to its own tab on that host (a Browser tab, never a
   *  site's own window). No pill and no words of its own: the line is this one, ours (onItsWay). */
  static func browserMayTell(everySite: Bool, siteName: String?, went: Any?, pill: Any?, line: Any?, host: String, tabHost: String) -> Bool {
    everySite && siteName == nil && went as? Bool == true && pill == nil && line == nil && !host.isEmpty && host == tabHost
  }
}
