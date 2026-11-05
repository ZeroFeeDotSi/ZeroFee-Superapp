// Small host rules that need no UIKit, so apps/ios/check runs them on a Mac (partner.sh).
import Foundation

/** The ZeroFee Keychain's copied password (Security's review, MUST 1). */
enum ConcealedClipboard {
  /** A marker type put beside the password's text when ZeroFee copies one: "this is a password, never hand it out". */
  static let marker = "si.zerofee.logins.concealed"

  /** May device.clipboard.read hand the clipboard's text to an app? Never while it holds a password ZeroFee copied. */
  static func mayRead(types: [String]) -> Bool { !types.contains(marker) }
}

/**
 * {{login.new}} in one robot run (Security's review, MUST 2): the first fill on a host makes and saves the password;
 * every later fill in that run ("Confirm password") types the SAME one, and nothing more is saved. Cleared when the run
 * ends, with the run's other memory.
 */
struct RunPasswords {
  private var made: [String: String] = [:]

  /** The run's new password for `host`: `make` (generate and save) runs only the first time. */
  mutating func password(for host: String, make: () throws -> String) rethrows -> String {
    if let p = made[host] { return p }
    let p = try make()
    made[host] = p
    return p
  }

  /** Has this run already made the password for `host`? */
  func has(_ host: String) -> Bool { made[host] != nil }

  mutating func clear() { made.removeAll() }
}

/** The robot's second lock, native (mirrors Agent's DECLARATION check in packages/agent/src/robot/guards.ts). */
enum RobotWords {
  /** Questions only the person answers: PEP, source of funds or wealth, income, occupation, tax, FATCA, nationality… */
  static let declaration = /(?i)\b(politically exposed|pep|(source|origin) of (funds|wealth)|income|salary|occupation|employment|employer|profession|purpose of (the |your )?account|tax (residence|residency|id|identification|number)|tin|u\.?s\.? person|fatca|sanctions?|sanctioned|beneficial owner|nationality|citizenship|country of residence)\b/

  static func isDeclaration(_ text: String) -> Bool { text.firstMatch(of: declaration) != nil }

  /** The robot reads English pages only: any other declared language (or none) is the person's turn. */
  static func englishPage(_ lang: String) -> Bool {
    let l = lang.lowercased()
    return l == "en" || l.hasPrefix("en-") || l.hasPrefix("en_")
  }

  /**
   * A half-filled password pair: two or more password boxes, one filled and one empty. In a run that hasn't made the
   * password, it means an earlier run typed it and stopped before "Confirm": the person's turn, never a second
   * {{login.new}}.
   */
  static func halfFilledPair(_ passwordBoxesFilled: [Bool]) -> Bool {
    passwordBoxesFilled.count >= 2 && passwordBoxesFilled.contains(true) && passwordBoxesFilled.contains(false)
  }
}

/** Wallet mode's own gate before a request reaches Browser's engine (the card's wallet, and any site ZeroFee doesn't know). */
enum WalletGate {
  enum Answer: Equatable { case relay, noAccounts, notConnected }

  /** The methods that sign, by the names provider.js posts (Solana's are the Wallet Standard's, "solana:…"). */
  static let signs: Set<String> = ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction"]
  /** How long the engine has to answer a sign before the window says so (a sheet over the window waits). */
  static let answerWithin: TimeInterval = 10
  /** A connect is answered at once (no sheet on a site's own wallet): past this, the window says so (B32, owner:
   *  pump.fun's "Continue with ZeroFee" spun with nothing of ours on screen). A connect sheet over the window waits. */
  static let connectWithin: TimeInterval = 1

  /**
   * `gated`: the host keeps the connection itself (the card's "pay" wallet) or the site is typed (never pre-approved:
   * its first request always goes through the connect sheet). Until connected, accounts are empty and nothing signs.
   */
  static func precheck(method: String, connected: Bool, gated: Bool) -> Answer {
    guard gated, !connected else { return .relay }
    if method == "eth_accounts" { return .noAccounts }
    return signs.contains(method) ? .notConnected : .relay
  }

  /**
   * The `origin` the host hands Browser's engine with each device.wallet.request: WebKit's committed host (the strip's,
   * already checked against the frame's security origin by PartnerWallet.mayAsk) as an https origin, a port kept. The
   * engine reads it with `new URL(origin)` and answers https origins only, so a bare host ("gmgn.ai") was refused as
   * "ZeroFee's wallet answers https sites only." on every request: no site's Connect ever finished on the phone (B29).
   * tools/ios/wallet-relay-origin.test.ts holds the two sides together.
   */
  static func relayOrigin(_ host: String) -> String { "https://\(host)" }

  /** Connect requests, as provider.js posts them (PartnerWallet.connects is the same list). */
  static let connectMethods: Set<String> = ["eth_requestAccounts", "wallet_requestPermissions", "solana:connect"]
  /** Sign-in messages: a site's "prove this wallet is yours". */
  static let messageMethods: Set<String> = ["personal_sign", "eth_signTypedData_v4", "solana:signMessage"]

  /**
   * The one line the site's window shows when ZeroFee's wallet didn't answer the site (B29: a test phone saw GMGN's own
   * "You are not logged in" and nothing of ours, because the engine's answer went to the page, and its Problem to the
   * shell, behind the window). `code` nil = no answer in time. Nil = nothing to say: the person said no (4001), or a read.
   */
  static func troubleLine(method: String, code: Int?, site: String, agent: Bool = false) -> String? {
    // the person's own no; or a network ZeroFee's wallet doesn't use on this site (ST6: GMGN's EVM side): nothing failed
    if code == 4001 || code == 4901 { return nil }
    let asks = connectMethods.contains(method) || signs.contains(method)
    guard asks else { return nil }
    // A site's own window (Social trading): its sign-in is AgentZero's (D75, display only), in AgentZero's words.
    if agent, connectMethods.contains(method) { return "AgentZero couldn't sign you in to \(site). Try again." }
    // a message a site asks isn't always a sign-in (review ST1 M1): said as what it is
    if agent, messageMethods.contains(method) { return "AgentZero couldn't sign \(site)'s message. Try again." }
    if code == nil { return "ZeroFee's wallet didn't answer \(site). Try again." }
    if connectMethods.contains(method) { return "ZeroFee couldn't connect your wallet to \(site). Try again." }
    if messageMethods.contains(method) { return "ZeroFee couldn't sign you in to \(site). Try again." }
    return "ZeroFee couldn't finish \(site)'s request."
  }

  /**
   * D75 (product decision, 2 Nov): in a site's own window every automatic step is narrated as AgentZero acting, one line under
   * the bar. Display only: what is signed, and who holds the key, don't change. The words are these fixed lines with the
   * site's name from ZeroFee's compiled list; the page's own text never reaches them, and what moves them is the host's
   * own relay (a connect it relayed, a sign-in the engine answered), never a word the page wrote.
   */
  static func agentSigningIn(_ site: String) -> String { "AgentZero is signing you in to \(site)…" }
  static let agentSignedIn = "AgentZero signed you in."
  /** Never blank: the window's first line while the site opens, and if it is still blank after 12 s. */
  static func agentOpening(_ site: String) -> String { "AgentZero is opening \(site)…" }
  static func siteSlow(_ site: String) -> String { "\(site) is slow to open. Trying again." }
  /** Never blocks (phone test, 3 Nov, a hang with no way out): no page within this, the window says so and the
   *  line itself is Try again; ✕ is always on the bar. */
  static let openWithin: TimeInterval = 5
  static func slowToOpen(_ site: String) -> String { "\(site) is slow to open. Tap here to try again, or ✕ to close." }
  static func siteDidntOpen(_ site: String) -> String { "\(site) didn't open. Close it and try again." }
  /**
   * A sign-in step whose tap changed nothing twice (zf-site-signin.js stops and leaves the step's number in its own
   * world, never words): the window says which tap the person makes. Keyed by the exact host and the step's place in
   * that host's recipe; the words are compiled here, so the page can't put any on our window. Nil: a step that has no
   * line (the run ended quietly; the site's own buttons still work).
   */
  static func stepStuckLine(host: String, step: Int) -> String? {
    switch (host, step) {
    case ("gmgn.ai", 1): return "GMGN didn't open its log in. Tap Log in yourself."
    case ("gmgn.ai", 2): return "GMGN didn't open its wallet list. Tap Connect with extension wallet yourself."
    case ("pump.fun", 0): return "pump.fun didn't open its sign in. Tap Sign in yourself."
    default: return nil
    }
  }
  /**
   * ST13: GMGN has a wallet per network. Which network the site's page is on, read from its address only
   * (WebKit's committed URL: never the page's script or text): GMGN puts it as the first part of the path
   * ("/bsc/token/…") or as ?chain=bsc. Nil: not GMGN, or a network it doesn't say.
   */
  static func siteChain(_ url: URL?) -> String? {
    guard let url, url.host?.lowercased() == "gmgn.ai", let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let known: Set<String> = ["sol", "bsc", "base", "eth", "tron"]
    if let q = c.queryItems?.first(where: { $0.name == "chain" })?.value?.lowercased(), known.contains(q) { return q }
    let first = c.path.split(separator: "/").first.map { $0.lowercased() } ?? ""
    return known.contains(first) ? first : nil
  }
  /** ST13: the network named on the ST11 ask for a site with a wallet per network (the one Spending fills); nil for a
   *  site with one wallet (pump.fun: "your pump.fun wallet"). */
  static func siteNetworkName(_ host: String) -> String? { host == "gmgn.ai" ? "Solana" : nil }
  /**
   * The window's line when the site is switched to a network Spending can't fill (the auditor's rule: never a choice
   * that can't be chosen, so no sheet there). Nil: a network Spending fills (Solana), or one it doesn't know.
   * packages/browser/src/social/hub-state.ts notCarried says the same words (a test holds them together).
   */
  static func notCarriedLine(_ chain: String) -> String? {
    switch chain {
    case "bsc": return "ZeroFee can't move BNB under $1,000 yet."
    case "base": return "Base isn't in ZeroFee yet."
    case "eth": return "Ethereum isn't in ZeroFee yet."
    case "tron": return "Tron isn't in ZeroFee yet."
    default: return nil
    }
  }

  /** How long the window keeps reading the sign-in steps' mark after a page loads (pump.fun's Sign in waits a minute
   *  for the person's terms tap, then two tries of 2.5 s). */
  static let stepWatchFor: TimeInterval = 70

  /** A Move from the window still unanswered after this long: said, never left "Moving…" (review ST11 M1). */
  static let moveSaysAfter: TimeInterval = 90
  /** How long a site's page may stay blank before it is loaded again, once (the product rule). */
  static let paintWithin: TimeInterval = 8

  /** ST11: a line Social trading asks the open site window to say (the move's own words): one line of plain printable
   *  text, at most 160 characters, from ZeroFee's own page only (device.site.money is Social trading's). */
  static func windowLine(_ raw: Any?) -> String? {
    // letters, marks, numbers, punctuation, symbols and plain spaces only (no controls, no format or bidi characters, no
    // line or paragraph separators): review ST11 L2
    let ok: Set<Unicode.GeneralCategory> = [.uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .nonspacingMark, .spacingMark, .decimalNumber, .letterNumber, .otherNumber, .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation, .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol, .spaceSeparator]
    guard let s = raw as? String, !s.isEmpty, s.count <= 160, s.unicodeScalars.count <= 200, s.unicodeScalars.allSatisfy({ ok.contains($0.properties.generalCategory) }) else { return nil }
    return s
  }
  /** ST11: what the window's own sheet moves into an empty site wallet (the small first Add). */
  static let firstAddUsd = 5

  /** ST2: a site window's wallet pill, as Social trading sends it: dollars and cents only ("$2.91", "$1,204.50"). */
  static func pill(_ raw: Any?) -> String? {
    guard let s = raw as? String, s.count <= 15, s.wholeMatch(of: /\$[0-9]{1,3}(,[0-9]{3}){0,2}\.[0-9]{2}/) != nil else { return nil }
    return s
  }
}

/**
 * The host's own record of which sites the person let see a wallet (the connect sheet's yes), per host and wallet. It
 * gates a typed site and the card's wallet (WalletGate). Settings → Sites' Disconnect clears it through
 * device.wallet.forget, as well as the engine's own connection.
 */
enum WalletConnections {
  static func key(_ host: String, _ kind: String) -> String { "zf.partner.connected.\(kind).\(host)" }
  /** The person disconnected this site (a Browser tab then doesn't connect it at once: EverySite). "#" is never in a
   *  host, so this never names another site's yes; the prefix is the yes's, so forgetting the account clears it too. */
  static func offKey(_ host: String, _ kind: String) -> String { "zf.partner.connected.\(kind)#off.\(host)" }
  static func isConnected(_ host: String, kind: String, in d: UserDefaults = .standard) -> Bool { d.bool(forKey: key(host, kind)) }
  static func isDisconnected(_ host: String, kind: String, in d: UserDefaults = .standard) -> Bool { d.bool(forKey: offKey(host, kind)) }
  /** On: the connect sheet's yes (it also ends a disconnect). Off: the yes goes. */
  static func set(_ host: String, kind: String, _ on: Bool, in d: UserDefaults = .standard) {
    if on { d.set(true, forKey: key(host, kind)); d.removeObject(forKey: offKey(host, kind)) } else { d.removeObject(forKey: key(host, kind)) }
  }

  /** The host as device.wallet.forget names it: lowercased, user@ stripped; nil when it isn't a host at all. */
  static func forgetHost(_ raw: String) -> String? {
    var h = raw.trimmingCharacters(in: .whitespaces).lowercased()
    if let at = h.lastIndex(of: "@") { h = String(h[h.index(after: at)...]) }
    guard !h.isEmpty, h.count <= 253, h.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" || $0 == ":" }) else { return nil }
    return h
  }

  /** Disconnect: the Browser wallet's yes for this host is gone, and a Browser tab no longer connects it at once; the
   *  next request goes through the connect sheet again. */
  static func forget(_ host: String, in d: UserDefaults = .standard) {
    set(host, kind: "browser", false, in: d)
    d.set(true, forKey: offKey(host, "browser"))
  }
}

/**
 * The quote relay for Private (D27), as build-web.sh wrote it beside the core's bundle (CoreBundle/relay.json, from
 * VITE_ZEROFEE_RELAY, the same setting the page reads). Swift allows its host, and only its, for the isolated core.
 */
enum RelaySetting {
  /** { relay: "https://host" } → the base and its host; nil when unset, or anything but a bare https origin. */
  static func parse(_ data: Data?) -> (base: String, host: String)? {
    guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let raw = (o["relay"] as? String)?.trimmingCharacters(in: .whitespaces), !raw.isEmpty,
          let u = URLComponents(string: raw), u.scheme == "https", let host = u.host?.lowercased(), !host.isEmpty,
          u.user == nil, u.password == nil, u.port == nil, u.query == nil, u.fragment == nil, u.path.isEmpty || u.path == "/"
    else { return nil }
    return ("https://\(host)", host)
  }
}

/**
 * D131 (3 Nov, all five parts): the address typed at the top of a Browser window, read as the Browser tab's own bar
 * reads it (packages/browser/src/social/address.ts readAddress and sites.ts siteUrl): words that aren't an address search
 * DuckDuckGo; http:// opens as https://; anything else that isn't an https address with a dot and no user name is one line.
 */
enum AddressRules {
  enum Read: Equatable { case go(URL), line(String) }

  static let notAnAddress = "Type a site address, like pump.fun."
  static let placeholder = "Search or type a site"

  /** encodeURIComponent's own set: letters, digits and - _ . ! ~ * ' ( ). */
  private static let component = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")

  static func searchURL(_ words: String) -> URL? {
    let q = words.trimmingCharacters(in: .whitespacesAndNewlines).addingPercentEncoding(withAllowedCharacters: component) ?? ""
    return URL(string: "https://duckduckgo.com/?q=\(q)")
  }

  private static func hasScheme(_ s: String) -> Bool { s.range(of: "^[a-z][a-z0-9+.-]*:", options: [.regularExpression, .caseInsensitive]) != nil }

  static func read(_ typed: String) -> Read {
    let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return .line(notAnAddress) }
    let hasSpace = text.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
    if (hasSpace || !text.contains(".")) && !hasScheme(text) { return searchURL(text).map(Read.go) ?? .line(notAnAddress) }
    let upgraded = text.replacingOccurrences(of: "^http://", with: "https://", options: [.regularExpression, .caseInsensitive])
    guard !hasSpace, let url = URL(string: hasScheme(upgraded) ? upgraded : "https://\(upgraded)"),
          url.scheme?.lowercased() == "https", let host = url.host, host.contains("."), url.user == nil, url.password == nil else { return .line(notAnAddress) }
    return .go(url)
  }
}

/**
 * The words a notification may carry, checked here as a backstop (iOS audit, finding 3). A notification shows on the lock
 * screen to anyone holding the phone, so it never carries an amount (a number beside a coin or money word or sign), a
 * NEAR account (name.near or 64 hex), a Solana-style base58 address, or a 0x address. The core's own words already say
 * none of these; any that slips through is dropped whole for one fixed line.
 */
enum NotifyFilter {
  static let fallbackBody = "Open ZeroFee to see what changed."
  static let fallbackTitle = "ZeroFee"

  /** Does `text` name money or an address? */
  static func leaks(_ text: String) -> Bool {
    let amount = /(?i)\d\s*(near|wnear|usdc|usdt|dai|sol|eth|weth|btc|wbtc|bnb|pol|matic|avax|trx|ton|xrp|doge|usd|eur|gbp|chf|jpy|dollars?|euros?|pounds?|cents?|coins?|tokens?)\b/
    let amountBefore = /(?i)\b(near|wnear|usdc|usdt|dai|sol|eth|weth|btc|wbtc|bnb|pol|matic|avax|usd|eur|gbp|chf|jpy)\s*\d/
    let sign = /[$€£¥₿]\s*\d|\d\s*[$€£¥₿]/
    let account = /(?i)\b[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(near|testnet|tg)\b/
    let hex64 = /(?i)\b[0-9a-f]{64}\b/
    let evm = /(?i)0x[0-9a-f]{40}/
    let base58 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/
    return text.contains(amount) || text.contains(amountBefore) || text.contains(sign) || text.contains(account)
      || text.contains(hex64) || text.contains(evm) || text.contains(base58)
  }

  static func body(_ text: String) -> String { leaks(text) ? fallbackBody : text }
  static func title(_ text: String) -> String { leaks(text) ? fallbackTitle : text }
}

/**
 * The app switcher's cover over every window (iOS audit, finding 5): when it goes up and comes down. Leaving ZeroFee
 * (willResignActive) puts it up, except while a Face ID prompt is what made ZeroFee inactive (the approval stays seen);
 * reaching the background always does; coming back active takes it down.
 */
enum CoverRules {
  enum Event { case willResignActive, didEnterBackground, didBecomeActive }

  static func up(after event: Event, faceIdShowing: Bool, wasUp: Bool) -> Bool {
    switch event {
    case .willResignActive: return wasUp || !faceIdShowing
    case .didEnterBackground: return true
    case .didBecomeActive: return false
    }
  }
}

/**
 * The app lock (product decision, 4 Nov, decision C; AppLock.swift): when it goes up and how it asks. Coming back after 5 minutes
 * or more away locks it; a cold launch is locked; a phone with no account has nothing to lock. Once locked it stays so
 * until opened. The first try is Face ID only; after a failed try, or with Face ID unusable, the phone's passcode is
 * offered too, so nobody is stranded (a mask, a changed face).
 */
enum LockRules {
  static let after: Duration = .seconds(5 * 60)

  static func lockedOnReturn(away: Duration?, hasAccount: Bool, wasLocked: Bool) -> Bool {
    guard hasAccount else { return false }
    if wasLocked { return true }
    guard let away else { return false }
    return away >= after
  }

  static func faceIdOnly(failedTries: Int, faceIdUsable: Bool) -> Bool { faceIdUsable && failedTries == 0 }
}
