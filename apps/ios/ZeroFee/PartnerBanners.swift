// A site's "get our app" banner, never shown in the partner window (product decision, 2 Nov, B15). WebKit's own content rules hide
// it: a declarative list (css-display-none on the site's exact host), compiled once and added to the window's content
// controller before its first page. Nothing is run in the page: no user script, no evaluateJavaScript, no handler. A list
// that doesn't compile is simply not added (the banner shows; nothing else changes).
//
// The rules are a copy of packages/browser/src/app-banners.ts contentRules(); tools/ios/app-banners.test.ts fails when
// the two differ (Security reviews any change).
import WebKit

@MainActor
enum PartnerBanners {
  // PIN-BEGIN
  static let json = #"[{"trigger":{"url-filter":".*","if-domain":["gmgn.ai"]},"action":{"type":"css-display-none","selector":"[data-sentry-component=\"DownLoadApp\"], .pi-modal-root:has(img[src*=\"/download-app/\"]), .pi-modal-root:has([data-sentry-source-file=\"DownloadAppModal.tsx\"]), [data-sentry-source-file=\"DownloadAppModal.tsx\"], [data-sentry-component*=\"DownLoadApp\"], [data-sentry-component*=\"DownloadApp\"], .pi-drawer:has([data-sentry-component=\"SlideLayout\"][data-tour-scroll])"}},{"trigger":{"url-filter":".*","if-domain":["pump.fun"]},"action":{"type":"css-display-none","selector":"a[href*=\"apps.apple.com\"], a[href*=\"itms-apps:\"], a[href*=\"play.google.com\"], a[href*=\"onelink.me\"], a[href*=\".app.link\"], [role=\"dialog\"]:has(a[href*=\"apps.apple.com\"]), [role=\"dialog\"]:has(a[href*=\"onelink.me\"]), [role=\"dialog\"]:has(img[alt*=\"Download on the\"]), div:has(> a[href*=\"apps.apple.com\"]), div:has(> * > a[href*=\"apps.apple.com\"]):not(:has(main)):not(:has(nav)), div:has(> * > * > a[href*=\"apps.apple.com\"]):not(:has(main)):not(:has(nav)), div:has(> * > a[href*=\"onelink.me\"]):not(:has(main)):not(:has(nav)), div:has(img[alt*=\"Download on the\"]):not(:has(div img[alt*=\"Download on the\"])):not(:has(main)):not(:has(nav)), div:has(img[src*=\"app-store\"]):not(:has(div img[src*=\"app-store\"])):not(:has(main)):not(:has(nav)), [class*=\"AppBanner\"], [class*=\"app-banner\"], [class*=\"appBanner\"], [id*=\"app-banner\"], [data-testid*=\"app-banner\"], #appsflyer-smart-banner-host, [aria-label=\"App promotion banner\"]"}}]"#
  // PIN-END

  private static var compiling: Task<WKContentRuleList?, Never>?

  /** The compiled list, compiled once per launch (every caller waits on the same compile); nil if WebKit refused it. */
  static func rules() async -> WKContentRuleList? {
    let task = compiling ?? Task { @MainActor in
      let list = try? await WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: "zerofee-partner-app-banners", encodedContentRuleList: json)
      if list == nil { NSLog("[zf-host] the app-banner rules didn't compile: banners stay") }
      return list
    }
    compiling = task
    return await task.value
  }
}
