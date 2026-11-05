// A site's "get our app" banner is never shown in ZeroFee's window (product decision, 2 Nov, B15: "no 'download the mobile app'
// banner: close it at once or never show it"). The phone hides it with WebKit's content rules (PartnerBanners.swift):
// declarative CSS hiding on the site's own exact host, run by WebKit itself. No script goes into the page.
//
// Each rule: the exact host it applies to, and the selectors of that site's own banner, found by probing its phone page
// (390 px, iPhone user agent). PartnerBanners.swift holds the same rules as JSON; tools/ios/app-banners.test.ts fails when
// the two differ.
export interface BannerRule {
  host: string;
  selectors: readonly string[];
}

export const BANNER_RULES: readonly BannerRule[] = [
  // gmgn.ai, probed 2 Nov: a strip at the top ("GMGN App · Discover faster · Get", its own component name DownLoadApp) and a
  // full-screen pop-up ("GMGN App is Live · Download Now", its picture from /static/img/download-app/). B26 (a test
  // phone, 2 Nov: a banner hidden at first came back later): the pop-up re-probed with an iPhone Safari user agent
  // is GMGN's DownloadAppModal (data-sentry-source-file), so it is named by that too, at any depth in its modal root, and
  // any component of GMGN's whose name says it downloads the app.
  {
    host: "gmgn.ai",
    selectors: [
      '[data-sentry-component="DownLoadApp"]',
      '.pi-modal-root:has(img[src*="/download-app/"])',
      '.pi-modal-root:has([data-sentry-source-file="DownloadAppModal.tsx"])',
      '[data-sentry-source-file="DownloadAppModal.tsx"]',
      '[data-sentry-component*="DownLoadApp"]',
      '[data-sentry-component*="DownloadApp"]',
      // ST4 (the phone's WebKit, 2 Nov): GMGN's "what's new" tour ("Callout Dashboard is live · GMGN just Updated! ·
      // Next"), a bottom drawer over Portfolio the moment it opens signed in; its slides are GMGN's SlideLayout with
      // data-tour-scroll. The drawer and its mask go; GMGN's own pages, sheets and Log In stay.
      '.pi-drawer:has([data-sentry-component="SlideLayout"][data-tour-scroll])',
    ],
  },
  // pump.fun: its phone page sits behind a human check that refuses a headless browser (every pump.fun page answers 403 to
  // one, 2 Nov), so its banner couldn't be probed here. B26: the first rules hid a store link and its direct box, and
  // the banner came back, so its box must hold the link deeper, or a button and a store badge instead. These hide any
  // store link (Apple, Google, an app-store deep link or a mobile-app link service), any dialog or box up to three levels
  // above one, a box with a store badge picture, and boxes named as an app banner; never a box holding the page's main
  // content or its navigation.
  {
    host: "pump.fun",
    selectors: [
      'a[href*="apps.apple.com"]',
      'a[href*="itms-apps:"]',
      'a[href*="play.google.com"]',
      'a[href*="onelink.me"]',
      'a[href*=".app.link"]',
      '[role="dialog"]:has(a[href*="apps.apple.com"])',
      '[role="dialog"]:has(a[href*="onelink.me"])',
      '[role="dialog"]:has(img[alt*="Download on the"])',
      'div:has(> a[href*="apps.apple.com"])',
      'div:has(> * > a[href*="apps.apple.com"]):not(:has(main)):not(:has(nav))',
      'div:has(> * > * > a[href*="apps.apple.com"]):not(:has(main)):not(:has(nav))',
      'div:has(> * > a[href*="onelink.me"]):not(:has(main)):not(:has(nav))',
      'div:has(img[alt*="Download on the"]):not(:has(div img[alt*="Download on the"])):not(:has(main)):not(:has(nav))',
      'div:has(img[src*="app-store"]):not(:has(div img[src*="app-store"])):not(:has(main)):not(:has(nav))',
      '[class*="AppBanner"]',
      '[class*="app-banner"]',
      '[class*="appBanner"]',
      '[id*="app-banner"]',
      '[data-testid*="app-banner"]',
      // ST4 (the phone's WebKit, 2 Nov, where pump.fun's page loads): its banner is AppsFlyer's smart banner ("Trade
      // faster on the pump.fun app · Install", 12 s after the page), inside the header: by its host and its own label.
      "#appsflyer-smart-banner-host",
      '[aria-label="App promotion banner"]',
    ],
  },
];

/** WebKit's content rule list, as PartnerBanners.swift compiles it: one css-display-none rule per site. */
export function contentRules(rules: readonly BannerRule[] = BANNER_RULES): string {
  return JSON.stringify(rules.map((r) => ({ trigger: { "url-filter": ".*", "if-domain": [r.host] }, action: { type: "css-display-none", selector: r.selectors.join(", ") } })));
}
