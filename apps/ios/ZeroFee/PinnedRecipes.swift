// The partner recipes the iPhone host accepts (Security's review, SHOULD 1, and the wallet-only site rules): Pay's
// compiled recipes exactly, the Browser presets' hosts and chains, and the Browser wallet's own chains for a site the
// person typed. This is a copy of apps/web/src/host/partner.ts `pinnedTable()`; apps/web/src/host/recipe-pin.test.ts
// fails when the two differ, so a change to Pay's recipes or Browser's presets changes this file too (Security reviews).
// Foundation only, so apps/ios/check runs it on a Mac.
import Foundation

enum PinnedRecipes {
  // PIN-BEGIN
  static let json = #"{"recipes":[{"partner":"gnosis-pay","hosts":["app.gnosispay.com"],"modes":["wallet","robot"],"chains":["gnosis"],"walletKind":"pay","slots":["{{profile.email}}","{{profile.address}}"],"commitButtons":["Order","Order card","Pay","Confirm order","Confirm","Delete account"],"login":null},{"partner":"mt-pelerin","hosts":["app.mtpelerin.com"],"modes":["wallet","robot"],"chains":["base"],"walletKind":"browser","slots":["{{profile.email}}","{{profile.phone}}","{{profile.name}}","{{profile.address}}","{{profile.dateOfBirth}}","{{login.username}}","{{login.password}}","{{login.new}}"],"login":{"host":"app.mtpelerin.com","create":true},"commitButtons":["Get your own IBAN","Send funds","Send","Confirm","Buy","Sell","Delete account"]}],"presets":[{"hosts":["fomo.family"],"chains":["sol","base"]},{"hosts":["pump.fun"],"chains":["sol"]},{"hosts":["gmgn.ai"],"chains":["sol","base"]},{"hosts":["jup.ag"],"chains":["sol"]},{"hosts":["raydium.io"],"chains":["sol"]},{"hosts":["www.orca.so"],"chains":["sol"]},{"hosts":["kamino.com"],"chains":["sol"]},{"hosts":["app.sanctum.so"],"chains":["sol"]},{"hosts":["app.mtpelerin.com"],"chains":["base"]}],"typedChains":["eth","base","arb","gnosis","sol"]}"#
  // PIN-END

  private static let table = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
  /** Pay's compiled recipes, as the host reads them. */
  static let pay: [PartnerRecipe] = (table["recipes"] as? [Any] ?? []).compactMap { PartnerRecipe($0) }
  /** The Browser presets: their exact hosts and chains. */
  static let presets: [(hosts: [String], chains: [String])] = (table["presets"] as? [[String: Any]] ?? []).map { ($0["hosts"] as? [String] ?? [], $0["chains"] as? [String] ?? []) }
  /** The Browser wallet's own chains: what a typed site may get, and no more. */
  static let typedChains: Set<String> = Set(table["typedChains"] as? [String] ?? [])

  /** A host ZeroFee knows (a Pay partner's or a preset's): the connect sheet says so natively, never the page. */
  static func known(_ host: String) -> Bool {
    pay.contains { $0.hosts.contains(host) } || presets.contains { $0.hosts.contains(host) }
  }

  /** Pay's device.openUrl: the recipe must be one of Pay's pinned recipes, exactly. */
  static func acceptForPay(_ r: PartnerRecipe) -> Bool { pay.contains(r) }

  /**
   * Browser's device.openSite: wallet mode only, the Browser wallet, no login, no slots, no commit words, and either a
   * pinned site's exact hosts and chains (a preset or a Pay partner's) or a typed site: exactly one host, the opened
   * page's, with chains among the Browser wallet's own.
   */
  static func acceptForSite(_ r: PartnerRecipe, openedHost: String) -> Bool {
    guard r.modes == [.wallet], r.walletKindRaw == "browser", r.login == nil, r.slots.isEmpty, r.commitButtons.isEmpty, !r.chains.isEmpty, r.covers(openedHost) else { return false }
    if presets.contains(where: { $0.hosts == r.hosts && $0.chains == r.chains }) { return true }
    if pay.contains(where: { $0.hosts == r.hosts && $0.chains == r.chains && $0.modes.contains(.wallet) }) { return true }
    return r.hosts == [openedHost] && Set(r.chains).isSubset(of: typedChains)
  }
}
