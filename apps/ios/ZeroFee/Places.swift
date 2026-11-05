// Where a Browser page or a site's own window was left (product decision, 3 Nov: "if you close a page and come back you should open
// right where you left off", across app launches). Pure, so apps/ios/check runs it on a Mac (partner.sh). Kept on this
// phone only (UserDefaults), cleared with History and with every site's data. https only, by exact host: a site's own
// window keeps one place per site; other Browser pages keep the newest 20. A place is used only when the page is opened
// at its host's front door (no path, no query): a link to a deeper page always opens that page.
import Foundation

/**
 * A site's own window's top bar (3 Nov: the best it can be): the site's name, and under it one short status that comes
 * and goes: "Signing you in…" while the page loads and its wallet sign-in runs, "Signed in" for a moment once it has,
 * then the page's real address. A thin line along the bar's bottom edge moves while it loads or signs in.
 */
enum SiteBar {
  static let signingIn = "Signing you in…"
  static let signedIn = "Signed in"
  /** How long "Signed in" stays before the address comes back. */
  static let signedInFor: TimeInterval = 2
  struct State: Equatable {
    /** The line under the name; nil: the page's address. */
    let status: String?
    /** The progress line moves. */
    let busy: Bool
  }
  /** `signingUntil`: until when a sign-in may still come (nil: none expected); `signedInAt`: when it came. */
  static func state(loading: Bool, signedIn: Bool, signingUntil: Date?, signedInAt: Date?, now: Date) -> State {
    if signedIn, let at = signedInAt, now.timeIntervalSince(at) < signedInFor { return State(status: Self.signedIn, busy: loading) }
    if !signedIn, let until = signingUntil, now < until { return State(status: Self.signingIn, busy: true) }
    return State(status: nil, busy: loading)
  }
}

/** A site's own window signed out (product decision, 3 Nov: never a dead end). */
enum SiteSignOut {
  /** How often the window asks the sign-in steps' own world whether they gave up. */
  static let every: TimeInterval = 4
  static func line(_ site: String) -> String { "\(site) signed you out. Tap its Sign in to come back in with ZeroFee." }
  /** What to do once the steps gave up: reload once (a fresh page runs the steps from the start), then say it. */
  enum Next: Equatable { case reload, say }
  static func next(reloadedAlready: Bool) -> Next { reloadedAlready ? .say : .reload }
}

enum Places {
  static let key = "zf.browser.places"
  static let maxPages = 20

  struct Entry: Equatable {
    let host: String
    let url: String
    /** A site's own window (pump.fun, GMGN): never pushed out by ordinary pages. */
    let site: Bool
  }

  static func host(_ url: URL) -> String? {
    guard url.scheme?.lowercased() == "https", let h = url.host?.lowercased(), !h.isEmpty, url.port == nil || url.port == 443, url.user == nil, url.password == nil else { return nil }
    return h
  }

  /** The list after leaving `at` (the window opened on `opened`): kept only on the same exact host it opened. */
  static func keeping(_ list: [Entry], opened: URL, at: URL, site: Bool) -> [Entry] {
    guard let h = host(at), host(opened) == h else { return list }
    let rest = list.filter { $0.host != h }
    let pages = rest.filter { !$0.site }.prefix(maxPages - 1)
    return [Entry(host: h, url: at.absoluteString, site: site)] + rest.filter(\.site) + pages
  }

  /** Where to open `url`: its kept place when it's opened at its host's front door, else `url` itself. */
  static func place(_ list: [Entry], for url: URL) -> URL {
    guard let h = host(url), url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil,
          let kept = list.first(where: { $0.host == h }), let k = URL(string: kept.url), host(k) == h else { return url }
    return k
  }

  static func decode(_ raw: Any?) -> [Entry] {
    (raw as? [[String]] ?? []).compactMap { $0.count == 3 ? Entry(host: $0[0], url: $0[1], site: $0[2] == "site") : nil }
  }
  static func encode(_ list: [Entry]) -> [[String]] { list.map { [$0.host, $0.url, $0.site ? "site" : "page"] } }
}
