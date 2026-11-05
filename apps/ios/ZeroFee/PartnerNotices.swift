// One notice at a time, at the bottom of a partner window (product decision, 3 Nov: "should be at the bottom with an X. Don't do
// these popups on top, it blocks the app"). The web shell's NoticeBar (apps/web/src/shell/notices.ts) does the same for
// the app; this is the site window's own. The rules are plain Swift (no UIKit) so the Mac check (check/partner.sh) runs
// the same ones PartnerView uses: which notice shows, which can be hidden with ×, and what a tap on its line does.
// The words guard is not one of these: it stays at the top until Leave or Stay is chosen.
import Foundation

enum PartnerNotice {
  enum Kind: String, CaseIterable {
    /** AgentZero acts on the page, or waits for the person (Continue, Stop). */
    case robot
    /** The page didn't come in WalletGate.openWithin (a tap: Try again). */
    case slow
    /** Private browsing is connecting, stopped, isn't here, or the page didn't open in it. */
    case privacy
    /** ZeroFee's wallet's line to the site's window (trouble, signing in, a move, money that landed). */
    case wallet
    /** AgentZero stopped, and can go on (Continue). */
    case robotStopped
    /** The site's wallet holds $0.00: Top up (a tap opens the same top-up as before). */
    case topUp
    /** The name uses look-alike letters. */
    case lookAlike
    /** The first time this site opens: it isn't part of ZeroFee. */
    case firstOpen
    /** Pay's partner window doesn't use private browsing. */
    case notPrivate
    /** A Browser tab's site has its own wallet (EverySite, the Browser thesis part 2): Top up opens Home's Put money in. */
    case siteWallet
  }

  /** Higher shows first: AgentZero at work, then a page that won't open, then the wallet, then the offers and warnings. */
  static func rank(_ kind: Kind) -> Int {
    switch kind {
    case .robot: return 100
    case .slow: return 90
    case .privacy: return 80
    case .wallet: return 70
    case .robotStopped: return 60
    case .topUp: return 50
    case .lookAlike: return 40
    case .firstOpen: return 30
    case .notPrivate: return 20
    case .siteWallet: return 25
    }
  }

  struct Item: Equatable {
    let kind: Kind
    let line: String
    /** What it is and what it says: × hides this key on this page; a line that changes is a new key and shows again. */
    var key: String { "\(kind.rawValue)|\(line)" }
  }

  /** The one to show: the highest rank not hidden with ×; ties go to the first given. */
  static func pick(_ items: [Item?], hidden: Set<String>) -> Item? {
    var best: Item?
    for case let n? in items where !n.line.isEmpty && !hidden.contains(n.key) {
      if best == nil || rank(n.kind) > rank(best!.kind) { best = n }
    }
    return best
  }

  /** ×: on every line except AgentZero's while it acts or waits for the person (Stop is the way out). */
  static func closable(_ kind: Kind) -> Bool { kind != .robot }

  /** Product decision, 4 Nov: an info-only line (no warning, no button) goes by itself after fadeAfter seconds, so it never sits
   *  over the site's own bottom menu: the first-open line and Pay's not-private line. Warnings, the wallet's lines and
   *  any line with a button stay until × or until they're answered. Not under VoiceOver (it reads at its own pace). */
  static func fades(_ kind: Kind) -> Bool { kind == .firstOpen || kind == .notPrivate }
  static let fadeAfter: TimeInterval = 5

  enum Tap: Equatable { case tryAgain, topUp, topUpHost, more }
  /** What a tap on the line does: the slow line loads again, the top-up opens the top-up, any other shows all of it. */
  static func tap(_ kind: Kind) -> Tap {
    switch kind {
    case .slow: return .tryAgain
    case .topUp: return .topUp
    case .siteWallet: return .topUpHost
    default: return .more
    }
  }

  /** The one button that stays on the line, if any (AgentZero's Continue and Stop are its own). */
  static func act(_ kind: Kind) -> String? {
    switch kind {
    case .slow: return tryAgain
    case .topUp: return add
    case .siteWallet: return topUpHost
    default: return nil
    }
  }

  static let tryAgain = "Try again"
  static let add = "Add"
  static let topUpHost = "Top up"
  /** The ×'s VoiceOver label (the web NoticeBar's own). */
  static let hide = "Hide"
}
