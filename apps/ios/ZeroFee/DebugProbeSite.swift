// Debug builds only, and only when launched with ZF_PROBE_SITE=<https url> (simulator: SIMCTL_CHILD_ZF_PROBE_SITE=…):
// open one of Social trading's sites the way Social trading does (device.openSite: wallet mode with the Browser
// wallet, the preset's pinned hosts and chains; fomo as a computer would, with the Fund bar), then log what the page
// sees, for screenshots taken from outside (xcrun simctl io booted screenshot).
//
// ZF_PROBE_SITE_APP=1|social|browser (with ZF_PROBE_SITE=https://fomo.family/): Social trading's "Open fomo", or the
// Browser's fomo, fomo's own app or its App Store page, through the bridge's own route; nothing opens in a ZeroFee window.
//
// ZF_PROBE_SITE_TAP=<words> (optional, "|" between choices, e.g. "Log in|Connect"): after the page settles, press the
// first visible button with those words, once, as a person's tap would, to show the site's own Connect list. It runs in
// the probe's own content world, never the page's, and never touches a bot check (a page still behind one has no such
// button). Nothing is signed: the probe stops at what the site shows.
#if DEBUG
import Foundation
import WebKit

extension Host {
  func probeSite() async {
    let env = ProcessInfo.processInfo.environment
    guard let text = env["ZF_PROBE_SITE"], let url = URL(string: text), url.scheme == "https", let host = url.host?.lowercased() else { return }
    func say(_ k: String, _ v: Any) { NSLog("[zf-probe] site %@ = %@", k, String(String(describing: v).unicodeScalars.map { $0.value < 32 ? " " : Character($0) })) }
    // ZF_PROBE_SITE_APP=1 (or "social"), or "browser": Social trading's "Open fomo", or the Browser's fomo, through the
    // bridge's whole route (handle: the app check, then openSite { nativeApp: true }). First the refusals (an app that
    // isn't Social trading or Browser; pump.fun; a look-alike host), then fomo once from the chosen app, which opens the
    // fomo app or its App Store page. One open per launch: the first one sends ZeroFee to the background.
    if let from = env["ZF_PROBE_SITE_APP"] {
      let asker = from == "browser" ? "browser" : "social"
      func why(_ r: Reply) -> String { ((r["problem"] as? [String: Any])?["whatHappened"] as? String).map { "refused: \($0)" } ?? "OPENED" }
      say("nativeAppFromTrade", why(await handle("device.openSite", ["app": "trade", "url": text, "nativeApp": true])))
      say("nativeAppFromPay", why(await handle("device.openSite", ["app": "pay", "url": text, "nativeApp": true])))
      say("nativeAppPump", why(await handle("device.openSite", ["app": asker, "url": "https://pump.fun/", "nativeApp": true])))
      say("nativeAppLookAlike", why(await handle("device.openSite", ["app": asker, "url": "https://fomo.family.evil.example/", "nativeApp": true])))
      let fomo = await handle("device.openSite", ["app": asker, "url": text, "nativeApp": true])
      say("nativeAppFomoFrom", asker)
      say("nativeAppFomo", (fomo["ok"] as? [String: Any])?["opened"] ?? fomo)
      say("windowOpened", sheet != nil)
      return
    }
    // The preset's own pinned hosts and chains (PinnedRecipes), exactly what siteRecipe() sends for a preset.
    guard let preset = PinnedRecipes.presets.first(where: { $0.hosts.contains(host) }) else { return say("preset", "none for \(host)") }
    let recipe = PartnerRecipe(["partner": String(host.split(separator: ".")[0]), "hosts": preset.hosts, "chains": preset.chains, "modes": ["wallet"], "walletKind": "browser", "slots": [String](), "commitButtons": [String](), "login": NSNull()])
    let accepted = recipe.map { PinnedRecipes.acceptForSite($0, openedHost: host) } ?? false
    say("recipeAccepted", accepted)
    let desktop = host == "fomo.family" || env["ZF_PROBE_SITE_DESKTOP"] == "1"
    awaitingReturn = "social"
    presentPartner(url, recipe: accepted ? recipe : nil, desktop: desktop)
    guard let view = sheet as? PartnerView else { return say("presented", false) }
    say("walletMode", view.wallet != nil)
    try? await Task.sleep(nanoseconds: 12_000_000_000)
    say("loaded", view.web.url?.absoluteString ?? "nothing")
    say("title", view.web.title ?? "")
    // The provider lives in the page's world, so the one read of it is there (a typeof-style check, as probePartner's).
    let provider = try? await view.web.callAsyncJavaScript("return !!(window.ethereum && window.ethereum.isZeroFee)", arguments: [:], in: nil, contentWorld: .page)
    say("providerInPage", provider ?? "no answer")
    let seen = try? await view.web.callAsyncJavaScript(
      "return (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)",
      arguments: [:], in: nil, contentWorld: .defaultClient)
    say("page", seen ?? "no answer")
    // ";" between taps, "|" between the words each tap may press.
    for tap in (env["ZF_PROBE_SITE_TAP"] ?? "").split(separator: ";").map(String.init) where !tap.isEmpty {
    let tapped = try? await view.web.callAsyncJavaScript(
      """
      const words = choices.split('|').map((w) => w.trim().toLowerCase());
      const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const all = [...document.querySelectorAll('button, a, [role=button]')].filter(shown);
      const any = [...document.querySelectorAll('body *')].filter(shown);
      const label = (e) => ((e.getAttribute('aria-label') || '') + ' ' + (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '')).toLowerCase();
      for (const w of words) {
        // "close": a dialog's own close control (by its label or class), the way a person taps the ×
        const el = w === 'close'
          ? [...all, ...any].find((e) => /close|dismiss/.test(label(e)))
          : all.find((e) => (e.innerText || '').trim().toLowerCase() === w) || any.filter((e) => (e.innerText || '').trim().toLowerCase() === w).pop() || all.find((e) => (e.innerText || '').trim().toLowerCase().startsWith(w));
        if (el) { el.click(); return w; }
      }
      return 'none of: ' + all.slice(0, 30).map((e) => (e.innerText || '').trim()).filter(Boolean).join(' / ') + ' [buttons=' + all.length + ' shown=' + any.length + ' iframes=' + document.querySelectorAll('iframe').length + ' shadow=' + any.filter((e) => e.shadowRoot).length + ']';
      """, arguments: ["choices": tap], in: nil, contentWorld: .defaultClient)
    say("tapped", tapped ?? "no answer")
    try? await Task.sleep(nanoseconds: 6_000_000_000)
    say("urlAfterTap", view.web.url?.absoluteString ?? "nothing")
    let after = try? await view.web.callAsyncJavaScript(
      "return (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 600)", arguments: [:], in: nil, contentWorld: .defaultClient)
    say("afterTap", after ?? "no answer")
    // Is "ZeroFee" one of the wallets the site lists now? (Its own words around it, from the page's text.)
    let listed = try? await view.web.callAsyncJavaScript(
      "const t = (document.body && document.body.innerText || '').replace(/\\s+/g, ' '); const i = t.indexOf('ZeroFee'); return i < 0 ? 'not listed' : t.slice(Math.max(0, i - 160), i + 200)",
      arguments: [:], in: nil, contentWorld: .defaultClient)
    say("zerofeeListed", listed ?? "no answer")
    }
  }

  /**
   * ZF_PROBE_SHELL_TAP=<words> ("|" between choices, ";" between steps): ZeroFee's own screens, pressed by their words
   * one step every 5 s from the probe's own content world, for screenshots taken from outside. Our page only, never a
   * partner's.
   */
  func probeShellTaps() async {
    guard let steps = ProcessInfo.processInfo.environment["ZF_PROBE_SHELL_TAP"] else { return }
    for tap in steps.split(separator: ";").map(String.init) where !tap.isEmpty {
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      let tapped = try? await webView.callAsyncJavaScript(
        """
        const words = choices.split('|').map((w) => w.trim().toLowerCase());
        const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        const all = [...document.querySelectorAll('button, a, [role=button], [role=checkbox], [role=tab], label, summary')].filter(shown);
        const text = (e) => ((e.innerText || '').trim() || e.getAttribute('aria-label') || '').trim().toLowerCase();
        for (const w of words) {
          const el = all.find((e) => text(e) === w) || all.find((e) => text(e).startsWith(w));
          if (el) { el.click(); return w; }
        }
        return 'none of: ' + all.slice(0, 40).map(text).filter(Boolean).join(' / ');
        """, arguments: ["choices": tap], in: nil, contentWorld: .defaultClient)
      NSLog("[zf-probe] shell tapped = %@", String(describing: tapped ?? "no answer"))
    }
  }
}
#endif
