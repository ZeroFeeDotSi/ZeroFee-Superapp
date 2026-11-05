// Instant open for pump.fun and GMGN (3 Nov, all five parts): the pure rules, so apps/ios/check runs them on a Mac.
// The warm windows themselves are WarmSites.swift.
import Foundation

enum WarmRules {
  /** At most this many site windows kept loaded off screen (pump.fun and GMGN). */
  static let cap = 2
  /** A warm window older than this loads its page again when shown, so prices are fresh. */
  static let maxAge: TimeInterval = 10 * 60
  /** Wallet requests a warm window may hold until it's shown; any more answer no. */
  static let holdCap = 8

  /**
   * May a site window be built off screen now? Only a site's own window (a compiled site name), never on a child's
   * phone, never a private window (Tor), never in Low Power Mode, never a second one for the same site, and at most `cap`.
   */
  static func shouldWarm(siteName: String?, kid: Bool, privately: Bool, lowPower: Bool, warmHosts: [String], host: String) -> Bool {
    guard siteName != nil, !kid, !privately, !lowPower, !host.isEmpty else { return false }
    guard !warmHosts.contains(host) else { return false }
    return warmHosts.count < cap
  }

  /** Has this warm window waited too long to be shown as it is? */
  static func isStale(builtAt: Date, now: Date) -> Bool { now.timeIntervalSince(builtAt) >= maxAge }

  /** May one more wallet request be held while the window is warm (never shown)? */
  static func mayHold(held: Int) -> Bool { held < holdCap }
}
