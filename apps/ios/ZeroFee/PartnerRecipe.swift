// A partner recipe as the host receives it (Security's D29 rules, backlog/security.md §A). Only the shell sends one, and
// only from the recipes compiled into the app (apps/web/src/host/recipes.ts, from Pay's partners/recipes.ts): the page
// inside the partner window never picks a mode, nor does a URL, a query, an outside link, the model or a server.
//
// The recipe fixes the window's modes when it opens. A mode is ACTIVE only while the top frame's host, read natively
// from `webView.url`, is one of the recipe's exact hosts (no wildcards). Anything malformed means no recipe at all:
// the plain window (PartnerView's 12 conditions).
import CryptoKit
import Foundation

enum PartnerMode: String { case plain, wallet, robot }

struct PartnerRecipe: Equatable {
  let partner: String
  /** Exact, lowercased hostnames. No wildcards, no ports, no paths. */
  let hosts: [String]
  let modes: Set<PartnerMode>
  /** Wallet mode's chains ("gnosis", "base", "solana"…), in the recipe's order: the first EVM one is the start chain. */
  let chains: [String]
  /** Wallet mode's wallet (§F): "pay" (the card's own wallet, the Gnosis Pay window) or "browser". */
  let walletKindRaw: String
  /** Robot mode's slots, e.g. "{{profile.email}}", "{{login.new}}". */
  let slots: Set<String>
  /** The login the robot may fill or create: its own exact host. */
  let login: (host: String, create: Bool)?
  /** Words on buttons that commit (pay, order, accept): the robot never clicks them; the person does. */
  let commitButtons: [String]
  /**
   * AgentZero's own browser (D114): built into the app (never from JSON, a page or the model), robot mode only, no slots
   * and no login (signing in is always the person's turn). M10: it covers the task's one site (`hosts[0]`) and its
   * subdomains, never another site and never a host `agentRefuses`.
   */
  let anyHost: Bool
  /**
   * A Browser tab (EverySite.swift, the product Browser thesis): wallet mode only, the Browser wallet, on every site
   * EverySite.covers, each connected at once with its own wallet. Built into the app (never from JSON, a page or the
   * model).
   */
  let everySite: Bool
  /**
   * AgentZero's own window (D114), built into the app only (`agent(site:)`; never from JSON, a page or the model): what
   * PartnerRobot's agent mode, the kept places and the store go by. On its sign-in sites (agentWalletHosts) it also has
   * wallet mode (bug report, 5 Nov, QA's ruling): (a) those exact hosts only, never anyHost with a wallet;
   * (b) AgentZero's own pocket, never the person's wallets (PartnerWallet says `agent` to the engine, IsolatedCore to
   * the core); (c) a sign-in only (agentMethods; any transaction is refused here, in the engine and in the core);
   * (d) each sign-in is AgentZero's row in Activity (packages/browser service.ts agentSignInRow).
   */
  let agent: Bool

  static func == (a: PartnerRecipe, b: PartnerRecipe) -> Bool {
    a.partner == b.partner && a.walletKindRaw == b.walletKindRaw && a.hosts == b.hosts && a.modes == b.modes && a.chains == b.chains && a.slots == b.slots
      && a.login?.host == b.login?.host && a.login?.create == b.login?.create && a.commitButtons == b.commitButtons && a.anyHost == b.anyHost && a.everySite == b.everySite && a.agent == b.agent
  }

  /** Ruling (a): the sites AgentZero's own window signs in to with its pocket, exact hosts (the core's
   *  AGENT_SIGN_IN_HOSTS, packages/core/src/site-wallets.ts; tools/ios/agent-site-wallet.test.ts holds them equal). */
  static let agentWalletHosts = ["pump.fun", "gmgn.ai"]
  /** Ruling (c): all a page in AgentZero's window may ask its wallet. */
  static let agentMethods: Set<String> = ["solana:connect", "solana:disconnect", "solana:signMessage"]
  static let agentOnlySignsIn = "AgentZero's window only signs in. Its trades go through AgentZero's own limits."
  /** Ruling (a), checked wherever a recipe is kept: wallet mode never rides on "any host". */
  var walletScopeOK: Bool { !(anyHost && modes.contains(.wallet)) && (!agent || !modes.contains(.wallet) || hosts.allSatisfy(Self.agentWalletHosts.contains)) }

  /** A Browser tab's recipe (EverySite.swift). Only the app makes it (PartnerBridge's device.openSite for the Browser). */
  static let browserTab = PartnerRecipe(browserTabChains: PinnedRecipes.typedChains.sorted())

  /** The recipe a window keeps: none on a child's phone (§A3), and none unless it covers the page the window opens on. */
  static func forWindow(_ r: PartnerRecipe?, opening host: String, kid: Bool) -> PartnerRecipe? {
    kid ? nil : r.flatMap { $0.walletScopeOK && $0.covers(host) ? $0 : nil }
  }

  /** AgentZero's browser (D114) on one site (M10). Only the app makes it (PartnerBridge's partner.openAgent, from the
   *  page the task opens); no JSON can ask for it. On a sign-in site (agentWalletHosts) it has wallet mode there, on
   *  those exact hosts (ruling a); anywhere else robot mode only, as before. */
  static func agent(site: String) -> PartnerRecipe {
    agentWalletHosts.contains(site) ? PartnerRecipe(agentWalletSites: agentWalletHosts) : PartnerRecipe(agentSite: site)
  }

  /** The page AgentZero's window opens: on a sign-in site's "www." name, the site's own (its wallet's exact host). */
  static func agentOpening(_ url: URL) -> URL {
    guard let h = url.host?.lowercased(), h.hasPrefix("www."), agentWalletHosts.contains(String(h.dropFirst(4))), var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
    c.host = String(h.dropFirst(4))
    return c.url ?? url
  }

  /** Shared hosting: every name under these is someone else's page, so AgentZero's site there is the one host only. */
  private static let sharedSuffixes: Set<String> = ["github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com", "appspot.com", "run.app", "herokuapp.com", "onrender.com", "fly.dev", "glitch.me", "blogspot.com", "wordpress.com", "substack.com", "medium.com", "tumblr.com", "azurewebsites.net", "windows.net", "cloudfront.net", "amazonaws.com", "myshopify.com", "wixsite.com", "squarespace.com", "square.site", "business.site", "zendesk.com", "notion.site", "replit.app", "ngrok.io", "ngrok-free.app", "trycloudflare.com", "duckdns.org", "no-ip.org", "ddns.net"]
  /** Names that point anywhere, a home network included: never opened. */
  private static let anywhereDomains: Set<String> = ["nip.io", "sslip.io", "xip.io", "lvh.me", "localtest.me", "traefik.me", "vcap.me", "lacolhost.com", "localhost.run"]

  /** M10 (review M1: no guessing at a registrable domain): the site a task runs on is the host it opens, less a leading
   *  "www."; it covers that host, its "www." and, off shared hosting, the names under it. */
  static func agentSite(_ host: String) -> String {
    host.hasPrefix("www.") && host.split(separator: ".").count > 2 ? String(host.dropFirst(4)) : host
  }

  private static func under(_ h: String, _ set: Set<String>) -> Bool { set.contains(h) || set.contains { h.hasSuffix("." + $0) } }

  /** M10: a host AgentZero never opens or follows, with why (nil: it may). An address in numbers, a name with look-alike
   *  letters, or a name only a home or office network knows. (WebKit's own fraud warning covers known bad sites.) */
  static func agentRefuses(_ h: String) -> String? {
    guard isExactHost(h), let last = h.split(separator: ".").last else { return "AgentZero opens https sites only." }
    // Review M3: any digit in the last label (no real top-level name has one): 192.168.1.0x1 is an address to WebKit.
    if last.contains(where: \.isNumber) { return "AgentZero won't open a site by its number." }
    if h.split(separator: ".").contains(where: { $0.hasPrefix("xn--") }) { return "That site's name hides its letters. AgentZero won't open it." }
    if ["local", "localhost", "internal", "lan", "home", "arpa", "corp", "intranet", "localdomain"].contains(String(last)) || under(h, anywhereDomains) { return "AgentZero opens public sites only." }
    return nil
  }

  private init(agentSite: String) {
    partner = "agentzero"
    hosts = [agentSite]
    modes = [.robot]
    chains = []
    walletKindRaw = "browser"
    slots = []
    login = nil
    commitButtons = []
    anyHost = true
    everySite = false
    agent = true
  }

  /** AgentZero's window on its sign-in sites (ruling a): the exact hosts, no "any host", wallet mode on Solana only. */
  private init(agentWalletSites: [String]) {
    partner = "agentzero"
    hosts = agentWalletSites
    modes = [.robot, .wallet]
    chains = ["solana"]
    walletKindRaw = "browser"
    slots = []
    login = nil
    commitButtons = []
    anyHost = false
    everySite = false
    agent = true
  }

  private init(browserTabChains: [String]) {
    partner = "browser"
    hosts = []
    modes = [.wallet]
    chains = browserTabChains
    walletKindRaw = "browser"
    slots = []
    login = nil
    commitButtons = []
    anyHost = false
    everySite = true
    agent = false
  }

  private static let namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/
  /** A plain DNS name: labels of a-z 0-9 -, at least one dot. No "*", no port, no user@. */
  static func isExactHost(_ h: String) -> Bool {
    guard h.count <= 253, h == h.lowercased(), h.contains("."), !h.hasPrefix("."), !h.hasSuffix(".") else { return false }
    return h.split(separator: ".", omittingEmptySubsequences: false).allSatisfy { label in
      !label.isEmpty && label.count <= 63 && label.allSatisfy { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") || $0 == "-" } && !label.hasPrefix("-") && !label.hasSuffix("-")
    }
  }

  /** The slots a recipe may name (§D4/§D6). A login slot names its own host: {{login.<host>.username|password}}. */
  static func isKnownSlot(_ s: String) -> Bool {
    if ["{{profile.name}}", "{{profile.email}}", "{{profile.phone}}", "{{profile.address}}", "{{profile.dateOfBirth}}", "{{login.username}}", "{{login.password}}", "{{login.new}}"].contains(s) { return true }
    guard s.hasPrefix("{{login."), s.hasSuffix("}}") else { return false }
    let inner = s.dropFirst(8).dropLast(2)
    for field in [".username", ".password"] where inner.hasSuffix(field) {
      return isExactHost(String(inner.dropLast(field.count)))
    }
    return false
  }

  /** Parse the shell's recipe object; nil (the plain window) for anything not exactly the shape. */
  init?(_ any: Any?) {
    guard let r = any as? [String: Any],
          let partner = r["partner"] as? String, partner.wholeMatch(of: Self.namePattern) != nil, partner != "agentzero",
          let hosts = r["hosts"] as? [String], !hosts.isEmpty, hosts.count <= 16, hosts.allSatisfy(Self.isExactHost),
          let modeNames = r["modes"] as? [String], !modeNames.isEmpty
    else { return nil }
    let modes = modeNames.compactMap(PartnerMode.init(rawValue:))
    guard modes.count == modeNames.count else { return nil }
    let chains = r["chains"] as? [String] ?? []
    guard chains.count <= 8, chains.allSatisfy({ $0.wholeMatch(of: Self.namePattern) != nil }) else { return nil }
    let walletKind = r["walletKind"] as? String ?? "browser"
    guard walletKind == "browser" || walletKind == "pay" else { return nil }
    let slots = r["slots"] as? [String] ?? []
    guard slots.count <= 16, slots.allSatisfy(Self.isKnownSlot) else { return nil }
    var login: (String, Bool)?
    if let l = r["login"], !(l is NSNull) {
      guard let l = l as? [String: Any], let h = l["host"] as? String, Self.isExactHost(h), hosts.contains(h) else { return nil }
      login = (h, l["create"] as? Bool ?? false)
    }
    let commit = r["commitButtons"] as? [String] ?? []
    guard commit.count <= 32, commit.allSatisfy({ !$0.isEmpty && $0.count <= 40 }) else { return nil }
    self.partner = partner
    self.hosts = hosts
    self.modes = Set(modes)
    self.chains = chains
    self.walletKindRaw = walletKind
    self.slots = Set(slots)
    self.login = login.map { (host: $0.0, create: $0.1) }
    self.commitButtons = commit.map { $0.lowercased() }
    self.anyHost = false
    self.everySite = false
    self.agent = false // AgentZero's window is never from JSON
    // Wallet mode needs chains; robot mode needs nothing more (it can fill literals and stop for the person).
    if self.modes.contains(.wallet) && chains.isEmpty { return nil }
  }

  /** Is this host (as the strip shows it: lowercased, no port when 443) one of the recipe's? Exact match only. */
  func covers(_ host: String) -> Bool {
    if everySite { return EverySite.covers(host) }
    guard anyHost else { return hosts.contains(host) }
    guard let site = hosts.first, Self.agentRefuses(host) == nil else { return false }
    if host == site || host == "www." + site { return true }
    // Review M1/M2: on shared hosting (or a platform's own name) the names under it are other people's pages.
    return !Self.under(site, Self.sharedSuffixes) && host.hasSuffix("." + site)
  }

  /** Is this mode active on this host right now? Never on a child's phone (the caller passes that in). */
  func active(_ mode: PartnerMode, host: String, kid: Bool) -> Bool {
    !kid && modes.contains(mode) && covers(host)
  }
}

/**
 * AgentZero's browser's page rules (D114, QA), pure so apps/ios/check runs them on a Mac. A picture of the page
 * goes to Claude only when its text is thin, and never while a password, card, security-code or one-time-code box is on
 * screen; a bot check, a sign-in wall or a money step is always the person's turn.
 */
enum AgentPageRules {
  /** Under this many characters of visible text, a picture helps Claude read the page. */
  static let thinTextChars = 300
  /** The page text sent to Claude, at most (like the elements' 8 KB). */
  static let maxTextChars = 6000
  /** A picture, at most, as JPEG bytes. */
  static let maxPictureBytes = 200_000

  private static let secretWords = /(?i)\b(password|passcode|pin|cvc|cvv|csc|security code|card number|card no|expiry|expiration|one[- ]time|otp|verification code|2fa|two[- ]factor)\b/

  /** A box whose contents must never be in a picture: by type, by autocomplete, or by its label or name. */
  static func isSecretField(_ e: [String: Any]) -> Bool {
    guard e["kind"] as? String == "field" else { return false }
    let type = (e["type"] as? String ?? "").lowercased(), ac = (e["autocomplete"] as? String ?? "").lowercased()
    if type == "password" || ac.contains("one-time-code") || ac.contains("password") || ac.split(separator: " ").contains(where: { $0.hasPrefix("cc-") }) { return true }
    let words = [e["label"] as? String, e["text"] as? String].compactMap { $0 }.joined(separator: " ")
    return words.firstMatch(of: secretWords) != nil
  }

  static func secretOnScreen(_ elements: [[String: Any]]) -> Bool { elements.contains(where: isSecretField) }

  /** A picture only when the text is thin and no secret box is on screen. */
  static func wantsPicture(textChars: Int, elements: [[String: Any]]) -> Bool { textChars < thinTextChars && !secretOnScreen(elements) }

  private static let botWords = /(?i)(captcha|verify (that )?you('| a)re (a )?human|are you a robot|i'?m not a robot|unusual traffic|press and hold|checking your browser|just a moment\.\.\.|security check|access denied|automated (queries|requests))/
  /** A page that wants to know a person is there: always the person's turn. */
  static func isBotCheck(_ text: String) -> Bool { text.firstMatch(of: botWords) != nil }

  private static let moneyWords = /(?i)\b(pay|payment|checkout|check out|buy|place (your )?order|order now|purchase|subscribe|donate|add (a )?card|book now|reserve|confirm (and|&) pay|start (free )?trial|upgrade)\b/
  /** A button that spends, buys, subscribes or adds a card: always the person's tap. */
  static func isMoneyStep(_ text: String) -> Bool { text.firstMatch(of: moneyWords) != nil }

  /** Steps in a row that left the page as it was before AgentZero stops and hands it over (M17). */
  static let stuckTries = 3
  /** The page as it was after a step: its host, its words and its boxes' ids (never shown, never kept past the run). */
  static func pagePrint(host: String, text: String, ids: [String]) -> String {
    "\(host)\u{1}\(text.count)\u{1}\(text.prefix(2000))\u{1}\(ids.joined(separator: ","))"
  }
  /** Stuck: the page after each of the last `stuckTries` steps was the same as before them. */
  static func isStuck(_ prints: [String]) -> Bool { prints.count > stuckTries && Set(prints.suffix(stuckTries + 1)).count == 1 }
  static let stuckLine = "The page didn't change after 3 tries. It's yours."

  private static let refusalWords = /(?i)(403 forbidden|access forbidden|you don'?t have permission to access|not available in your (country|region)|your request (has been|was) blocked)/
  /** A page that refuses AgentZero outright: the person's turn (M17). */
  static func isRefusal(_ text: String) -> Bool { text.firstMatch(of: refusalWords) != nil }
  static let refusalLine = "This site refused AgentZero. It's yours."
}

/** QA (5 Nov): a sign-in is the person's own when they touched the window within this many seconds before the
 *  page asked (PartnerView's TouchNoter, UIKit's touch, never the page's): the core's six an hour. Without one, an
 *  approved session's sign-in is a re-run: one per page load, twenty an hour per site (subwallets.ts signInRoom). */
enum SignInTap {
  static let within: TimeInterval = 5
  /** The words the host adds to a wallet request and to the core's sign-in call: AgentZero's window, the touch, the load. */
  static func words(agent: Bool, touchedRecently: Bool, load: String) -> [String: Any] { ["agent": agent, "tap": touchedRecently, "load": load] }
}

/** M5: one "AgentZero paused" notice per pause, never one per minute it stays paused. */
struct OncePerPause {
  private(set) var sent = false
  static let title = "AgentZero paused"
  static let body = "Open ZeroFee to go on."
  /** True the first time in a pause; false after, until the person is back. */
  mutating func shouldSend() -> Bool {
    if sent { return false }
    sent = true
    return true
  }
  mutating func resumed() { sent = false }
}

/** Each site's own storage on this phone (cookies, sign-in), found by an id made from its host. */
enum SiteStore {
  /** One data store per host (lowercased): same host, same store; another host, never the same. Private browsing (D130)
   *  keeps its own store per host, so a page that ran over Tor never shares a connection or cookie with the clear one. */
  /** `agent`: AgentZero's own window on a sign-in site (ruling b): its own store, so the person's own sign-in on that site
   *  (their site wallet's session) never shows in AgentZero's window, and AgentZero's never in theirs. */
  static func id(forHost partner: String, privately: Bool = false, agent: Bool = false) -> UUID {
    let digest = SHA256.hash(data: Data("\(agent ? "zerofee-agent" : privately ? "zerofee-private" : "zerofee-partner"):\(partner.lowercased())".utf8))
    let b = Array(digest.prefix(16))
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
  }

  /** Forget one site (M12): only that host's store among the stores on the phone, never another's. */
  static func toForget(host: String, among ids: [UUID]) -> [UUID] {
    let mine: Set<UUID> = [id(forHost: host), id(forHost: host, privately: true), id(forHost: host, agent: true)]
    return ids.filter { mine.contains($0) }
  }

  static let forgetTitle = { (host: String) in "Forget \(host)?" }
  static let forgetMessage = "Its sign-in and what it saved on this phone go. You'll sign in again next time."
  static let clearTitle = "Clear every site's data?"
  static let clearMessage = "Sites forget you on this phone. You'll sign in again. Your saved passwords stay."
}
