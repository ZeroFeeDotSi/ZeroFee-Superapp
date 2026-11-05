// The words the native sheet shows (S1.6): the core's PlainWords (packages/core/src/signer.ts), exactly as the web sheet
// shows them (apps/web/src/shell/ApprovalSheet.tsx): the title, every line, every disclosure, every warning, every effect, the
// protection's clock line, and the asking app's hint last. Words that can't be read, are beyond any real request's
// size, or carry a character that changes how the text around it reads (audit IOS-6: the core's `readable` takes them
// out first), are refused, and nothing is signed.
import Foundation

struct SheetWords: Equatable {
  struct Effect: Equatable, Hashable {
    let token: String
    let before: String
    let after: String
  }

  /** A labelled disclosure of long parts (the core's `details`): "See which coins count" and every coin's limit. */
  struct Details: Equatable, Hashable {
    let label: String
    let lines: [String]
    /** The core's `open: { after }` (a Send's payee address in full, the audit and the copy review, 5 Nov): shown open directly under the line
     *  `openAfter`, never inside a fold; nil: a fold, one tap open, as before. */
    var openAfter: String? = nil
  }

  /** The payee's full address as the sheet sets it (the copy review's rules, 5 Nov): groups of 4 with thin spaces (U+2009; an EVM
   *  address keeps its 0x on the first group), as the web sheet does (sheet-address.ts groupAddress); a name as it is. */
  static func grouped(_ address: String) -> String {
    let body = address.hasPrefix("0x") ? String(address.dropFirst(2)) : address
    guard body.count >= 12, body.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return address }
    var groups: [String] = []
    var i = body.startIndex
    while i < body.endIndex {
      let j = body.index(i, offsetBy: 4, limitedBy: body.endIndex) ?? body.endIndex
      groups.append(String(body[i..<j]))
      i = j
    }
    return (address.hasPrefix("0x") ? "0x" : "") + groups.joined(separator: "\u{2009}")
  }

  /** The address an outside sheet's "To <address>" line names in full (the core's OUTSIDE_WORDS.to, the fill sheet's
   *  first line); nil for any other line and for a short form ("To 0x7D06…7e3D on Ethereum"). */
  static func toAddress(_ line: String) -> String? {
    guard line.hasPrefix("To ") else { return nil }
    let a = String(line.dropFirst(3))
    return a.isEmpty || a.contains(" ") || a.contains("…") ? nil : a
  }

  /** Where the payee's side lands (OUTSIDE_WORDS.seen, the copy review's words): drawn quiet. */
  static func isLands(_ line: String) -> Bool {
    line == "Private." || (line.hasPrefix("Public on ") && line.hasSuffix(".") && !line.dropFirst(10).dropLast().contains("."))
  }

  let title: String
  let lines: [String]
  let details: [Details]
  let warnings: [String]
  let effects: [Effect]
  /** The protection's clock line ("Waits 2 days · this phone can cancel"), or nil for Face ID alone. */
  let protection: String?
  let hint: String?
  /** The payment in dollars with its coin amount ("about $0.04 (0.01 NEAR)"), the core's `amount` (grade 02g, G11), or nil. */
  let amount: String?
  /** Off mainnet: the sheet's one "Test network" mark (grade 02h, H10), the core's `testNetwork`. */
  let testNetwork: Bool
  /** D146: the app that asked (the core's `asker`, forApps' stamp: "wallet", "browser"…), or nil for ZeroFee's own
   *  screens. Never shown; the sheet shows only while that app is on screen (mayShow). */
  let asker: String?
  /** D143 (review, 3 Nov): the core's `tap`, set only on a hot key's sheet (never the Safe's money): Approve is
   *  one tap, no Face ID. Only the core's own sheet reads it (IsolatedCore coreApprove); a chip sheet always asks Face ID. */
  let tap: Bool

  private static let maxText = 4000
  private static let maxItems = 200

  /** The core's UNREADABLE (signer.ts): control characters and line breaks, direction marks, overrides and isolates,
   *  and invisible joiners. */
  static func unreadable(_ c: Unicode.Scalar) -> Bool {
    switch c.value {
    case 0x00...0x1F, 0x7F...0x9F, 0x61C, 0x200B...0x200F, 0x2028...0x202E, 0x2060...0x2069, 0xFEFF: return true
    default: return false
    }
  }

  init?(_ any: Any?) {
    guard let w = any as? [String: Any] else { return nil }
    let text = { (v: Any?) -> String? in (v as? String).flatMap { $0.count <= Self.maxText && !$0.unicodeScalars.contains(where: Self.unreadable) ? $0 : nil } }
    guard let title = text(w["title"]), !title.isEmpty,
          let lines = w["lines"] as? [Any], lines.count <= Self.maxItems,
          let warnings = w["warnings"] as? [Any], warnings.count <= Self.maxItems,
          let effects = w["effect"] as? [Any], effects.count <= Self.maxItems
    else { return nil }
    let readLines = lines.compactMap(text)
    let readWarnings = warnings.compactMap { text(($0 as? [String: Any])?["text"]) }
    let readEffects = effects.compactMap { e -> Effect? in
      guard let e = e as? [String: Any], let token = text(e["token"]), let before = text(e["before"]), let after = text(e["after"]) else { return nil }
      return Effect(token: token, before: before, after: after)
    }
    // Every part must be read; one that can't be is never quietly dropped from what the person approves.
    guard readLines.count == lines.count, readWarnings.count == warnings.count, readEffects.count == effects.count else { return nil }
    // Details are part of what is approved: each must be read whole, or nothing is shown and nothing is signed.
    var readDetails: [Details] = []
    if let d = w["details"], !(d is NSNull) {
      guard let list = d as? [Any], list.count <= Self.maxItems else { return nil }
      for item in list {
        guard let item = item as? [String: Any], let label = text(item["label"]), !label.isEmpty,
              let dl = item["lines"] as? [Any], dl.count <= Self.maxItems
        else { return nil }
        let read = dl.compactMap(text)
        guard read.count == dl.count else { return nil }
        // `open`: shown open under its line; a line that isn't on the sheet, or one that can't be read, shows nothing
        var openAfter: String?
        if let o = item["open"], !(o is NSNull) {
          guard let o = o as? [String: Any], let after = text(o["after"]), readLines.contains(after) else { return nil }
          openAfter = after
        }
        readDetails.append(Details(label: label, lines: read, openAfter: openAfter))
      }
    }
    var hint: String?
    if let h = w["hint"], !(h is NSNull) {
      guard let read = text(h) else { return nil }
      hint = read.isEmpty ? nil : read
    }
    var amount: String?
    if let a = w["amount"], !(a is NSNull) {
      guard let read = text(a) else { return nil }
      amount = read.isEmpty ? nil : read
    }
    var protection: String?
    if let p = w["protection"], !(p is NSNull) {
      guard let p = p as? [String: Any], let level = p["level"] as? String, let seconds = (p["waitSeconds"] as? NSNumber)?.doubleValue,
            ["faceid", "wait", "device", "both"].contains(level), seconds.isFinite, seconds >= 0
      else { return nil }
      // The lines already say the protection's own sentence: the clock line would only say the wait again (grade 02g, E15).
      protection = (p["text"] as? String).map { readLines.contains($0) } == true ? nil : Self.protectionWords(level: level, waitSeconds: seconds)
    }
    self.title = title
    self.lines = readLines
    self.details = readDetails
    self.warnings = readWarnings
    self.effects = readEffects
    self.protection = protection
    self.hint = hint
    // the core's `amountSaid` (a Move's split block: one amount, said once), as the web's sheet-amount.ts amountLine: the
    // "Amount:" line goes only while a line itself says the signed amount's dollars (the audit's condition); a flag alone never hides it
    let dollars = amount.map { $0.components(separatedBy: " (")[0].trimmingCharacters(in: .whitespaces) } ?? ""
    let said = dollars.range(of: "^\\$[0-9,]+\\.[0-9]{2}$", options: .regularExpression) != nil && readLines.contains { $0.contains("· \(dollars)") || $0.contains(" \(dollars) ") }
    self.amount = (w["amountSaid"] as? Bool) == true && said ? nil : amount
    self.testNetwork = (w["testNetwork"] as? Bool) == true
    self.tap = (w["tap"] as? Bool) == true
    // an asker that isn't a plain app id refuses the words: who asked is never guessed
    if let a = w["asker"], !(a is NSNull) {
      guard let a = a as? String, a.range(of: "^[a-z]{1,20}$", options: .regularExpression) != nil else { return nil }
      self.asker = a
    } else {
      self.asker = nil
    }
  }

  /**
   * D146, the core's approval-policy.ts mayShowSheet, the same rule: an app's sheet shows only while that app is on
   * screen. No asker (ZeroFee's own screens) or no app on screen yet: it may show. Home's money sheet ("wallet", on
   * Wallet's bridge over whichever app opened it) and Spending's engine ("trade"): only while that money step is open.
   * Otherwise only its own app.
   */
  static func mayShow(asker: String?, onScreen: String?, moneyOpen: Bool = true) -> Bool {
    guard let asker, !asker.isEmpty else { return true }
    guard let onScreen, !onScreen.isEmpty else { return true }
    // review M5: a relay's sheet only while its money step is still open (or Trade on screen for Trade's own Add)
    if asker == "wallet" { return moneyOpen }
    if asker == "trade" { return onScreen == "trade" || moneyOpen }
    return asker == onScreen
  }

  /** The web sheet's `waitWords`: "120" → "2 minutes", "3600" → "1 hour", "172800" → "2 days". */
  static func waitWords(_ seconds: Double) -> String {
    let unit = { (n: Int, word: String) in "\(n) \(word)\(n == 1 ? "" : "s")" }
    if seconds >= 86400 { return unit(Int((seconds / 86400).rounded()), "day") }
    if seconds >= 3600 { return unit(Int((seconds / 3600).rounded()), "hour") }
    if seconds >= 60 { return unit(Int((seconds / 60).rounded()), "minute") }
    return unit(max(1, Int(seconds.rounded())), "second")
  }

  /** The web sheet's `protectionWords`: nothing for Face ID alone. */
  static func protectionWords(level: String, waitSeconds: Double) -> String? {
    let wait = "Waits \(waitWords(waitSeconds)) · this phone can cancel"
    switch level {
    case "wait": return wait
    case "device": return "Needs your second device"
    case "both": return "\(wait) · needs your second device"
    default: return nil
    }
  }
}
