// The words guard (product decision, 3 Nov): ZeroFee never asks for a person's secret words on a web page, so a page that does, or
// draws its own Face ID, is named on ZeroFee's own bar above it: "ZeroFee never asks for your words here. This page
// could be fake." · Leave · Stay. It never blocks the page. Read on the phone only, by zf-seed-guard.js in its own
// content world ("zf-seedguard"), in every frame; the script sends one word ("words" or "faceid"), never the page's
// text or anything typed. Pure (no UIKit), so apps/ios/check/partner.sh runs it on a Mac; zf-seed-guard.js carries the
// same lists (apps/web/src/host/partner-scripts.test.ts keeps them equal and runs the script's matcher on the same cases).
import Foundation

enum SeedGuard {
  enum Kind: String { case words, faceid }

  /** What a page asks for when it wants the person's secret, written after `normalized` (so "12-word" is "12 word"). A
   *  trailing "s" also counts ("seed phrases", "private keys"). */
  /** One per line: what the matcher looks for, never shown to anyone (so not copy). */
  static let phrases = """
  backup words
  seed phrase
  secret recovery phrase
  recovery phrase
  private key
  12 words
  24 words
  12 word
  24 word
  mnemonic
  passcode
  enter your words
  """.split(separator: "\n").map(String.init)
  /** A Face ID look-alike: these words inside a dialog or a box drawn over the page (real Face ID is never in a page). */
  static let faceID = ["face id", "faceid"]

  /** The script's handler, in its own world only. */
  static let handler = "zfSeedGuard"

  static let line = "ZeroFee never asks for your words here. This page could be fake."
  static let leave = "Leave"
  static let stay = "Stay"

  /** Lowercase; dashes, underscores and no-break spaces read as spaces; every run of space is one space. */
  static func normalized(_ s: String) -> String {
    var out = ""
    var space = false
    for c in s.lowercased() {
      let blank = c.isWhitespace || c == "-" || c == "_" || ("\u{2010}" ... "\u{2015}").contains(c)
      if blank {
        if !space { out.append(" ") }
        space = true
      } else {
        out.append(c)
        space = false
      }
    }
    return out
  }

  /** One of `list` in `text` (already normalized) as whole words: nothing of a-z or 0-9 right before it, or right after it
   *  (an "s" between is allowed): "112 words" and "private keyboard" don't count. */
  static func has(_ list: [String], in text: String) -> Bool {
    let t = Array(text.unicodeScalars)
    func word(_ i: Int) -> Bool { i >= 0 && i < t.count && (("a" ... "z").contains(t[i]) || ("0" ... "9").contains(t[i])) }
    for p in list {
      let w = Array(p.unicodeScalars)
      guard !w.isEmpty, w.count <= t.count else { continue }
      for i in 0 ... (t.count - w.count) where t[i] == w[0] && Array(t[i ..< i + w.count]) == w {
        var end = i + w.count
        if end < t.count, t[end] == "s" { end += 1 }
        if !word(i - 1), !word(end) || !word(i + w.count) { return true }
      }
    }
    return false
  }

  /** The page's own words ask for the person's secret. */
  static func asksForWords(_ text: String) -> Bool { has(phrases, in: normalized(text)) }

  /** "Face ID" drawn by the page itself: in a dialog or a box over the page (an article about Face ID is not). */
  static func fakeFaceID(_ text: String, overlay: Bool) -> Bool { overlay && has(faceID, in: normalized(text)) }

  /** The script's message: exactly "words" or "faceid"; anything else (an object, the page's text) is nothing. */
  static func kind(_ body: Any?) -> Kind? { (body as? String).flatMap(Kind.init(rawValue:)) }

  /** The bar shows once per page load, and never again on a page the person chose to stay on. */
  static func shows(_ kind: Kind?, shown: Bool, stayed: Bool) -> Bool { kind != nil && !shown && !stayed }
}
