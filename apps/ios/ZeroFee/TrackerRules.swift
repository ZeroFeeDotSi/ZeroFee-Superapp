// D131, Block trackers: the pure parts (no WebKit), so apps/ios/check runs them on a Mac (partner.sh). The list is
// Trackers/trackers.txt (EasyPrivacy's plain domain rules, by The EasyList authors, CC BY-SA 4.0; apps/ios/README.md).
// Each domain is blocked as a THIRD-PARTY load only, so a site's own pages and files are never blocked; a final set of
// "ignore" rules keeps every host a site wallet or a sign-in needs, whatever the list says. On by default; the Browser's
// Privacy screen turns it off. Pay's partner windows never get it (a ramp's own checks stay as they are).
import Foundation

enum TrackerRules {
  /** Bump with every new trackers.txt so phones compile the new list (the compiled list is kept by this name). */
  static let listVersion = "202611030918"
  static let identifier = "zerofee-trackers-\(listVersion)"
  private static let onKey = "zf.browser.block-trackers"

  /** The person's choice (the Browser's Privacy screen). On unless they turned it off. */
  static var isOn: Bool {
    get { UserDefaults.standard.object(forKey: onKey) as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: onKey) }
  }

  /** Never blocked, whatever the list says: the site wallets' sites, their sign-ins and the Solana nodes they use, and the
   *  person-checks a site may show (blocking one would leave a page that can't be used). Each covers its subdomains. */
  static let neverBlock = [
    "pump.fun", "gmgn.ai", "axiom.trade", "privy.io", "walletconnect.com", "walletconnect.org", "reown.com", "jup.ag",
    "helius-rpc.com", "helius.xyz", "solana.com", "phantom.app", "phantom.com", "raydium.io",
    "challenges.cloudflare.com", "hcaptcha.com", "recaptcha.net",
  ]

  /** The list's domains: every line that isn't a comment and is a plain lowercase host. */
  static func domains(fromList text: String) -> [String] {
    text.split(separator: "\n").compactMap { raw -> String? in
      let line = raw.trimmingCharacters(in: .whitespaces)
      guard !line.isEmpty, !line.hasPrefix("#"), line == line.lowercased(), line.contains("."),
            line.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }), line.unicodeScalars.allSatisfy(\.isASCII) else { return nil }
      return line
    }
  }

  /** WebKit's url-filter for a host and its subdomains (WebKit's regex has no "|", so one rule per host). */
  static func filter(_ host: String) -> String {
    "^[^:]+://+([^:/]+\\.)?" + host.replacingOccurrences(of: ".", with: "\\.") + "[:/]"
  }

  /** The content rules: block each domain as a third-party load, then ignore everything above for neverBlock. */
  static func rules(domains: [String]) -> [[String: Any]] {
    let blocks: [[String: Any]] = domains.map { ["trigger": ["url-filter": filter($0), "load-type": ["third-party"]], "action": ["type": "block"]] }
    let keeps: [[String: Any]] = neverBlock.map { ["trigger": ["url-filter": filter($0)], "action": ["type": "ignore-previous-rules"]] }
    return blocks + keeps
  }

  static func ruleJSON(domains: [String]) -> String? {
    guard let data = try? JSONSerialization.data(withJSONObject: rules(domains: domains)) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /** Would a third-party load from `host` be blocked? (The same rule as the compiled list, for the checks.) */
  static func blocks(_ host: String, domains: Set<String>) -> Bool {
    let h = host.lowercased()
    let covers = { (d: String) in h == d || h.hasSuffix("." + d) }
    if neverBlock.contains(where: covers) { return false }
    var parts = h.split(separator: ".").map(String.init)
    while parts.count >= 2 {
      if domains.contains(parts.joined(separator: ".")) { return true }
      parts.removeFirst()
    }
    return false
  }
}
