// D131, the phishing guard: before a Browser or Pay page opens, a host that imitates a crypto site the person uses
// (ZeroFee, NEAR, Hyperliquid, Binance, Coinbase, Robinhood, Solflare, Backpack, Padre, pump.fun, GMGN, Axiom, Photon,
// Phantom, Jupiter, Raydium, MetaMask, Uniswap) is stopped with one full-screen page. Pure (no UIKit), so
// apps/ios/check runs it on a Mac (partner.sh). WebKit's own fraud warning stays on as well.
//
// What counts as imitating, on the host only (never the page):
// - its name, with look-alike letters read as the letters they imitate (Cyrillic а, е, о, р…, "rn" for "m", 0 for o,
//   1 for l…), and punycode (xn--) decoded first, contains the brand's name: pump-fun-claim.xyz, gmgn-ai.app, jup-ag.net;
// - or a part of its name is one letter away from the brand's name (pumpfan.io, metamsk.io, uniswep.org), for names of
//   6 letters or more (shorter ones would catch ordinary words).
// The real sites and their subdomains always pass.
import Foundation

enum PhishGuard {
  struct Brand {
    let name: String
    /** The brand's name as letters only, no dots or dashes. */
    let token: String
    let real: [String]
    /** Also one letter away (names of 6+ letters). Off where an ordinary word is one letter away ("finance"). */
    var typos = true
  }

  static let brands: [Brand] = [
    // Security audit L5: ZeroFee's own and the money sites ZeroFee works with. A brand that is an ordinary word (NEAR,
    // Backpack, Padre) is matched on its longer name only ("near wallet", "backpack exchange", "padre.gg").
    Brand(name: "ZeroFee", token: "zerofee", real: ["zerofee.si", "zerofee-quotes.vercel.app"]),
    Brand(name: "NEAR", token: "nearwallet", real: ["near.org", "mynearwallet.com"]),
    Brand(name: "NEAR", token: "nearprotocol", real: ["near.org", "mynearwallet.com"]),
    Brand(name: "Hyperliquid", token: "hyperliquid", real: ["hyperliquid.xyz", "hyperliquid-testnet.xyz", "hyperliquid.gitbook.io"]),
    Brand(name: "Binance", token: "binance", real: ["binance.com", "binance.us", "binance.th"], typos: false),
    Brand(name: "Coinbase", token: "coinbase", real: ["coinbase.com"]),
    Brand(name: "Robinhood", token: "robinhood", real: ["robinhood.com", "robinhood.org"]),
    Brand(name: "Solflare", token: "solflare", real: ["solflare.com"]),
    Brand(name: "Backpack", token: "backpackexchange", real: ["backpack.exchange", "backpack.app"]),
    Brand(name: "Backpack", token: "backpackwallet", real: ["backpack.exchange", "backpack.app"]),
    Brand(name: "Padre", token: "padregg", real: ["padre.gg"]),
    Brand(name: "Padre", token: "padretrade", real: ["padre.gg"]),
    Brand(name: "Padre", token: "tradepadre", real: ["padre.gg"]),
    Brand(name: "pump.fun", token: "pumpfun", real: ["pump.fun"]),
    Brand(name: "GMGN", token: "gmgn", real: ["gmgn.ai"]),
    Brand(name: "Axiom", token: "axiomtrade", real: ["axiom.trade"]),
    Brand(name: "Photon", token: "photonsol", real: ["photon-sol.tinyastro.io"]),
    Brand(name: "Phantom", token: "phantom", real: ["phantom.app", "phantom.com"]),
    Brand(name: "Jupiter", token: "jupag", real: ["jup.ag"]),
    Brand(name: "Raydium", token: "raydium", real: ["raydium.io"]),
    Brand(name: "MetaMask", token: "metamask", real: ["metamask.io"]),
    Brand(name: "Uniswap", token: "uniswap", real: ["uniswap.org"]),
  ]

  /** The brand a host imitates, or nil. The real hosts and their subdomains pass. */
  static func imitates(_ host: String) -> String? {
    let h = host.lowercased()
    guard !h.isEmpty else { return nil }
    if brands.contains(where: { b in b.real.contains { h == $0 || h.hasSuffix("." + $0) } }) { return nil }
    let labels = h.split(separator: ".").map { skeleton(decode(String($0))) }
    guard labels.count >= 2 else { return nil }
    let whole = labels.joined()
    let body = labels.dropLast().joined()
    for b in brands {
      if whole.contains(b.token) { return b.name }
      guard b.typos, b.token.count >= 6 else { continue }
      if ([whole, body] + labels).contains(where: { oneAway($0, b.token) }) { return b.name }
    }
    return nil
  }

  /** The page's one line. */
  static func line(_ brand: String) -> String { "This site looks like \(brand) but isn't. ZeroFee stopped it." }
  static let why = "Sites like this copy a real one to take your money."
  static let goBack = "Go back"
  static let openAnyway = "Open anyway"

  // ── The letters a look-alike uses ─────────────────────────────────────────────────────────────────────────────

  private static let lookAlikes: [Character: Character] = [
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ԁ": "d", "ɡ": "g",
    "ո": "n", "ս": "u", "ⅿ": "m", "ʍ": "m", "ӏ": "l", "ı": "i", "ɑ": "a", "ο": "o", "ρ": "p", "ν": "v", "κ": "k",
    "τ": "t", "ѕ": "s", "ԛ": "q", "ԝ": "w", "ɩ": "i", "ḿ": "m", "ṃ": "m", "ṗ": "p", "ú": "u", "ü": "u", "ù": "u",
    "á": "a", "à": "a", "ä": "a", "é": "e", "è": "e", "ó": "o", "ò": "o", "ö": "o", "í": "i", "ñ": "n",
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t",
  ]

  /** A label as the letters it shows: look-alikes mapped, dashes and other marks dropped, "rn" read as "m", "vv" as "w". */
  static func skeleton(_ label: String) -> String {
    let mapped = String(label.compactMap { c -> Character? in
      if let a = lookAlikes[c] { return a }
      return c.isASCII && (c.isLetter || c.isNumber) ? c : nil
    })
    return mapped.replacingOccurrences(of: "rn", with: "m").replacingOccurrences(of: "vv", with: "w")
  }

  /** Exactly one letter added, dropped or changed (not the same string). */
  static func oneAway(_ a: String, _ b: String) -> Bool {
    if a == b { return false }
    let x = Array(a), y = Array(b)
    if abs(x.count - y.count) > 1 { return false }
    var i = 0, j = 0, edits = 0
    while i < x.count, j < y.count {
      if x[i] == y[j] { i += 1; j += 1; continue }
      edits += 1
      if edits > 1 { return false }
      if x.count > y.count { i += 1 } else if x.count < y.count { j += 1 } else { i += 1; j += 1 }
    }
    return edits + (x.count - i) + (y.count - j) == 1
  }

  // ── Punycode (RFC 3492), for an xn-- label ───────────────────────────────────────────────────────────────────

  /** The Unicode a punycode label stands for; any other label (or one that doesn't decode) as it is. */
  static func decode(_ label: String) -> String {
    guard label.hasPrefix("xn--") else { return label }
    let input = Array(label.dropFirst(4).unicodeScalars)
    var output: [UnicodeScalar] = []
    var rest = input[...]
    if let dash = input.lastIndex(of: "-") {
      output = Array(input[..<dash])
      rest = input[(dash + 1)...]
    }
    let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700
    var n = 128, i = 0, bias = 72
    var it = rest.makeIterator()
    func digit(_ s: UnicodeScalar) -> Int? {
      switch s.value {
      case 48 ... 57: return Int(s.value) - 22
      case 65 ... 90: return Int(s.value) - 65
      case 97 ... 122: return Int(s.value) - 97
      default: return nil
      }
    }
    func adapt(_ delta: Int, _ count: Int, _ first: Bool) -> Int {
      var d = first ? delta / damp : delta / 2
      d += d / count
      var k = 0
      while d > ((base - tMin) * tMax) / 2 { d /= base - tMin; k += base }
      return k + (base - tMin + 1) * d / (d + skew)
    }
    while let first = it.next() {
      let oldI = i
      var w = 1, k = base
      var s: UnicodeScalar? = first
      while true {
        guard let c = s, let d = digit(c) else { return label }
        i += d * w
        let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
        if d < t { break }
        w *= base - t
        k += base
        s = it.next()
        if i > 0x10FFFF * 8 { return label }
      }
      bias = adapt(i - oldI, output.count + 1, oldI == 0)
      n += i / (output.count + 1)
      i %= output.count + 1
      guard let scalar = UnicodeScalar(n) else { return label }
      output.insert(scalar, at: i)
      i += 1
    }
    return String(String.UnicodeScalarView(output))
  }
}
