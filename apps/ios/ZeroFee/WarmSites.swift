// Instant open for pump.fun and GMGN (3 Nov, all five parts). When the Browser's start page shows, Social trading asks
// (device.warmSite) for its sites' windows to be built and loaded OFF SCREEN: the same PartnerView a tile's tap would
// make (the same compiled recipe, site name and persisted place), kept in the window behind the shell (an iPhone's
// WebKit suspends a page whose web view is out of the window) with no touches and hidden from VoiceOver. A tap then
// shows that window at once.
// Safety (the tabs rules, 6fb3d118): a warm window is never on screen, so it raises nothing: no wallet sheet, no Face
// ID, no connect question. Its page's wallet requests are HELD (WarmRules.holdCap) and go through the normal on-screen
// path the moment it's shown; if it's let go, they answer no. Never a plain page, a child's phone, a private (Tor)
// window or Low Power Mode; at most two; dropped on a memory warning; older than ten minutes, it loads again when shown.
import UIKit
import WebKit

/** What the shell's page was last told about a site's window over it (Host.coverChanged). */
@MainActor
enum CoverState {
  static var said = false
}

@MainActor
enum WarmSites {
  /** The warm windows by exact host, with when each was built. */
  static var views: [String: (view: PartnerView, at: Date)] = [:]
  private static var watching = false

  /**
   * HEAT-2026-11-03: a warm window stays in the window only until its page has loaded (and a moment for its first
   * scripts: the site's own sign-in asks are held, WarmRules.holdCap), then leaves it. Out of the window WebKit stops
   * drawing it and freezes its timers and scripts, so two live trading sites no longer run behind every tab. Its loaded
   * page is kept: a tap puts it on screen as before (takeWarm), and it carries on from where it was.
   */
  static let freezeAfter: TimeInterval = 3

  static func freezeSoon(_ screen: PartnerView) {
    DispatchQueue.main.asyncAfter(deadline: .now() + freezeAfter) { [weak screen] in
      MainActor.assumeIsolated {
        // still warm (never shown meanwhile) and still one of the kept ones: out of the window
        guard let screen, screen.warm, views.values.contains(where: { $0.view === screen }) else { return }
        screen.view.removeFromSuperview()
      }
    }
  }

  /** Let them all go (memory, the account wipe, clearing site data): their held requests answer no. */
  static func dropAll() {
    for (_, w) in views { w.view.view.removeFromSuperview(); w.view.endModes() }
    views.removeAll()
  }

  static func watchMemory() {
    guard !watching else { return }
    watching = true
    NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated { dropAll() }
    }
  }
}

extension Host {
  /** Tells the shell's page whether a site's window covers it now (device.covered), once per change. */
  func coverChanged() {
    let on = (sheet as? PartnerView)?.isOnScreen == true
    guard on != CoverState.said else { return }
    CoverState.said = on
    emit("device.covered", ["on": on])
  }

  /** device.warmSite: build a site's own window off screen (Social trading or the Browser only; see WarmSites). */
  func warmSite(_ url: URL, recipe: PartnerRecipe?, kid: Bool, siteName: String?, pill: String?) -> Bool {
    let host = PartnerView.displayHost(url)
    let privately = PrivateBrowsing.usesTor(host: host)
    guard WarmRules.shouldWarm(siteName: siteName, kid: kid, privately: privately, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled, warmHosts: Array(WarmSites.views.keys), host: host) else { return false }
    // already open on screen, or a page of it kept: nothing to warm
    if let open = sheet as? PartnerView, PartnerView.displayHost(open.startURL) == host { return false }
    WarmSites.watchMemory()
    let screen = PartnerView(host: self, url: PartnerView.placeFor(url, browser: true), recipe: recipe, kid: kid, siteName: siteName, pill: pill, privately: false, saysNotPrivate: false)
    screen.reopen = (recipe, kid, false, siteName, pill)
    screen.warm = true
    // In the window, behind the shell's own page: WebKit keeps it running; nothing of it can be seen, touched or read.
    let v = screen.view!
    v.frame = controller.view.bounds
    v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    v.isUserInteractionEnabled = false
    v.accessibilityElementsHidden = true
    controller.view.insertSubview(v, at: 0)
    WarmSites.views[host] = (screen, Date())
    return true
  }

  /** The warm window for this site, taken out of the store (a tap shows it), or nil. Stale: it loads its page again. */
  func takeWarm(_ url: URL, siteName: String?, kid: Bool) -> PartnerView? {
    let host = PartnerView.displayHost(url)
    guard let w = WarmSites.views.removeValue(forKey: host) else { return nil }
    // only the same kind of window: its compiled site name, an adult's phone, never ended
    guard w.view.siteName == siteName, siteName != nil, !kid, !w.view.isClosed else { w.view.view.removeFromSuperview(); w.view.endModes(); return nil }
    w.view.view.removeFromSuperview()
    if WarmRules.isStale(builtAt: w.at, now: Date()) { w.view.web.reload() }
    return w.view
  }

  /** Show a warm window now, as a tap on its tile would show a new one. */
  func showWarm(_ screen: PartnerView) {
    screen.view.isUserInteractionEnabled = true
    screen.view.accessibilityElementsHidden = false
    show(screen)
  }
}
