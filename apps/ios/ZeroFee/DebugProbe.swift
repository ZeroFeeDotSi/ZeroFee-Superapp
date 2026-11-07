// Debug builds only, and only when launched with ZF_PROBE=1 (simulator: SIMCTL_CHILD_ZF_PROBE=1): after the app
// loads, check from inside the page what the simulator can prove, and log one "[zf-probe]" line per check.
// It writes and then deletes its own test items; it never touches the account key.
#if DEBUG
import Foundation
import CoreImage.CIFilterBuiltins
import UIKit
import WebKit

extension Host {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // The backup words screen with sample words (not anyone's), for a screenshot; on its own, without the probe.
    if ProcessInfo.processInfo.environment["ZF_PROBE_WORDS"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in Task { await self?.probeWords() } }
      return
    }
    if ProcessInfo.processInfo.environment["ZF_PROBE_PARTNER"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in Task { await self?.probePartner() } }
      return
    }
    if ProcessInfo.processInfo.environment["ZF_PROBE_SHELL_TAP"] != nil, !Host.shellTapsStarted {
      Host.shellTapsStarted = true
      Task { await self.probeShellTaps() }
      return
    }
    if ProcessInfo.processInfo.environment["ZF_PROBE_SITE"] != nil {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in Task { await self?.probeSite() } }
      return
    }
    if ProcessInfo.processInfo.environment["ZF_PROBE_ROBOT"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in Task { await self?.probeRobot() } }
      return
    }
    if ProcessInfo.processInfo.environment["ZF_PROBE_PASSWORDS"] == "1", webView.url?.query?.contains("demo") != true {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in Task { await self?.probePasswords() } }
      return
    }
    guard ProcessInfo.processInfo.environment["ZF_PROBE"] == "1" else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.runProbe() }
  }

  static var shellTapsStarted = false

  /** A QR code reading "zerofee-probe:pay?amount=1", as a PNG, for the BarcodeDetector → Vision check. */
  static func probeQR() -> String {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data("zerofee-probe:pay?amount=1".utf8)
    guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
          let cg = CIContext().createCGImage(output, from: output.extent) else { return "" }
    // On a white card with a wide quiet zone, like a printed code.
    let size = CGSize(width: cg.width + 160, height: cg.height + 160)
    let png = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true; return f }()).pngData { ctx in
      UIColor.white.setFill()
      ctx.fill(CGRect(origin: .zero, size: size))
      UIImage(cgImage: cg).draw(at: CGPoint(x: 80, y: 80))
    }
    return png.base64EncodedString()
  }

  /** Debug only: the native sheet with sample words. Its Approve can't sign here (no chip); Not now closes it. */
  func probeNativeSheet() async {
    let words = SheetWords([
      "title": "Send 25 USDC to bob.near",
      "lines": ["From your balance on NEAR", "Network fee: at most 0.0005 NEAR"],
      "warnings": [["kind": "first-time-recipient", "text": "First time you send to bob.near."]],
      "effect": [["token": "USDC", "before": "120", "after": "95"]],
      "hint": "Wallet says: lunch with Bob",
      "protection": ["level": "wait", "waitSeconds": 600, "text": "It waits 10 minutes."],
    ])!
    let signed: Data? = await presentSheet(words, footer: "Signed inside this phone's secure chip", approve: { throw ChipKey.Refused(what: "Simulator: there is no secure chip, so nothing was signed.") })
    NSLog("[zf-probe] nativeSheet = %@", signed == nil ? "closed with nothing signed" : "SIGNED (bad)")
  }

  /**
   * probe-partner (ZF_PROBE_PARTNER=1, https://example.com by default, ZF_PROBE_PARTNER_URL to change): what the partner
   * view can and cannot do, one "[zf-probe] partner" line per check. The only JavaScript ever run in a partner web view
   * is the one typeof check in (a), and only here, in a debug build.
   */
  func probePartner() async {
    let env = ProcessInfo.processInfo.environment
    let url = URL(string: env["ZF_PROBE_PARTNER_URL"] ?? "https://example.com/")!
    func say(_ k: String, _ v: Any) { NSLog("[zf-probe] partner %@ = %@", k, String(describing: v)) }
    awaitingReturn = nil
    presentPartner(url)
    guard let view = sheet as? PartnerView else { return say("presented", false) }
    try? await Task.sleep(nanoseconds: 6_000_000_000)
    say("loaded", view.web.url?.absoluteString ?? "nothing")
    // (a) the bridge does not exist inside it
    let seen = try? await view.web.callAsyncJavaScript("return typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zerofee)", arguments: [:], in: nil, contentWorld: .page)
    say("a.bridgeTypeof", seen ?? "no answer")
    // (b) a top-frame http navigation is cancelled (the rule, and a live attempt)
    let before = view.web.url
    view.web.load(URLRequest(url: URL(string: "http://example.com/")!))
    try? await Task.sleep(nanoseconds: 3_000_000_000)
    say("b.httpRule", PartnerView.verdict(url: URL(string: "http://example.com/"), isMainFrame: true))
    say("b.stillOn", view.web.url == before)
    say("b.subframeAbout", PartnerView.verdict(url: URL(string: "about:blank"), isMainFrame: false))
    // (c) a return link with nothing pending is ignored; (d) the key check is unreachable from here
    say("c.returnIgnored", handleReturn(URL(string: "zerofee://wallet/return")!) == false)
    say("d.keycheckIgnored", handleReturn(URL(string: "zerofee://host/keycheck")!) == false && presentedAlertIsNone())
    say("c.screenStillOpen", view.presentingViewController != nil)
    // (e) one data store per host, never the default one
    let a = PartnerView.dataStore(forHost: "example.com"), b = PartnerView.dataStore(forHost: "Example.org")
    say("e.ids", "\(a.identifier?.uuidString ?? "nil") \(b.identifier?.uuidString ?? "nil")")
    say("e.differ", a.identifier != nil && a.identifier != b.identifier && a !== WKWebsiteDataStore.default() && view.web.configuration.websiteDataStore.identifier == a.identifier)
    say("strip", PartnerView.displayHost(URL(string: "https://User@WWW.Example.COM:8443/p?q=1")!))
    say("lookAlike", PartnerView.isLookAlike("xn--pple-43d.com"))
  }

  private func presentedAlertIsNone() -> Bool { !(controller.presentedViewController is UIAlertController) }

  /** Debug only: the native backup words screen with sample words that belong to no account. */
  func probeWords() async {
    let sample = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual"
    let picked = await coreWords(sample.split(separator: " ").map(String.init), kid: false, renew: false)
    NSLog("[zf-probe] wordsSheet = %@", picked == nil ? "closed (Later)" : "checked \(picked!.0)")
  }

  private func runProbe() {
    // Who may use the bridge: the main frame of zerofee-app://app, nothing else.
    let S = WebFiles.scheme, H = WebFiles.host
    let cases: [(Bool, String, String, Bool)] = [(true, S, H, true), (false, S, H, false), (true, "https", H, false), (true, S, "evil", false), (true, "https", "example.com", false), (false, "about", "", false)]
    let right = cases.filter { Self.isOurPage(isMainFrame: $0.0, scheme: $0.1, host: $0.2) == $0.3 }.count
    NSLog("[zf-probe] frameCheck = %@", right == cases.count ? "all \(cases.count) cases right" : "WRONG: \(right) of \(cases.count)")
    let js = """
    const out = {};
    console.info("probe: the console hook is live"); // a captured line proves "no errors" is measured, not unseen
    const host = window.webkit.messageHandlers.zerofee;
    const call = (method, params) => host.postMessage({ method, params });
    out.secureContext = window.isSecureContext;
    out.getUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    out.barcodeDetector = typeof BarcodeDetector;
    out.hostAdapter = typeof window.__zerofeeHost;
    // S1.6 phase 2: which core runs, that it answers through core.call, and what the page may no longer reach.
    out.coreMode = window.__zerofeeCoreMode;
    out.coreState = await call('core.call', { method: 'account.state', params: {} });
    out.coreRefusesApprovals = (await call('core.call', { method: 'approval.answer', params: { id: 'x', approve: true } })).problem?.code;
    out.pageCoreVault = (await call('vault.get', { name: 'device-seed' })).problem?.code ?? 'reachable';
    out.pageKidVault = (await call('vault.get', { name: 'zerofee-kid-probe.testnet:x' })).problem?.code ?? 'reachable';
    out.pageKey = (await call('key.info', {})).problem?.code ?? 'reachable';
    console.info('probe-core ' + JSON.stringify({ coreMode: out.coreMode, coreState: out.coreState, coreRefusesApprovals: out.coreRefusesApprovals, pageCoreVault: out.pageCoreVault, pageKidVault: out.pageKidVault, pageKey: out.pageKey }));
    out.csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? 'NONE';
    out.assets = await Promise.all([...document.querySelectorAll('script[src],link[href]')].map(async (e) => { const u = e.getAttribute('src') || e.getAttribute('href'); const r = await fetch(u); return u + " " + r.status; }));
    out.deepRoot = (await fetch('/favicon.svg')).status + " " + (await fetch('/apple-touch-icon.png')).status;
    out.missing = (await fetch('/assets/nope.js')).status;
    out.escape = (await fetch('/../../Info.plist')).status;
    out.spaFallback = (await fetch('/some/screen')).headers.get('content-type');
    out.images = [...document.images].map((i) => (i.src.slice(0, 30)) + " " + (i.complete && i.naturalWidth > 0 ? "loaded" : "NOT loaded"));
    out.storeSet = await call('device.store.set', { app: 'pay', key: 'probe.k', value: 'v1' });
    out.storeGet = await call('device.store.get', { app: 'pay', key: 'probe.k' });
    out.storeOther = await call('device.store.get', { app: 'wallet', key: 'probe.k' });
    await call('device.store.set', { app: 'pay', key: 'probe.k', value: null });
    out.secretSet = await call('device.secret.set', { app: 'agent', key: 'probe.secret', value: 'not-a-real-secret' });
    out.secretGet = (await call('device.secret.get', { app: 'agent', key: 'probe.secret' })).ok?.value === 'not-a-real-secret';
    out.secretBadName = (await call('device.secret.get', { app: 'agent', key: 'Bad Name' })).problem?.code;
    out.secretTooBig = (await call('device.secret.set', { app: 'agent', key: 'probe.big', value: 'x'.repeat(4097) })).problem?.code;
    await call('device.secret.set', { app: 'agent', key: 'probe.secret', value: null });
    out.secretGone = (await call('device.secret.get', { app: 'agent', key: 'probe.secret' })).ok?.value;
    out.unknownApp = (await call('device.store.get', { app: 'evil', key: 'k' })).problem?.code;
    out.httpRefused = (await call('device.openUrl', { app: 'pay', url: 'http://example.com', mode: 'sheet' })).problem?.code;
    out.vaultPut = await call('vault.put', { name: 'probe:item', bytes: btoa('hello') });
    out.vaultGet = (await call('vault.get', { name: 'probe:item' })).ok?.bytes === btoa('hello');
    await call('vault.delete', { name: 'probe:item' });
    out.vaultGone = (await call('vault.get', { name: 'probe:item' })).ok?.bytes;
    const img = new Image(); img.src = 'data:image/png;base64,' + qr; await img.decode();
    out.qrViaBarcodeDetector = (await new BarcodeDetector({ formats: ['qr_code'] }).detect(img)).map((c) => c.rawValue);
    // A control: the page's policy really blocks an inline script (the hook's own error line is held back for this one).
    out.cspEnforced = await new Promise((resolve) => {
      const h = (e) => { e.stopPropagation(); resolve('inline script blocked by ' + e.violatedDirective); };
      document.addEventListener('securitypolicyviolation', h, true);
      const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s);
      setTimeout(() => resolve(window.__inline ? 'NOT BLOCKED' : 'no violation event'), 500);
    });
    // A message from a frame inside the page (not the main frame) is dropped; the second knock must not log again.
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    const knock = async () => { try { await frame.contentWindow.webkit.messageHandlers.zerofee.postMessage({ method: 'vault.get', params: { name: 'probe:x' } }); return 'ANSWERED (bad)'; } catch (e) { return 'dropped: ' + e; } };
    out.iframeMessage = [await knock(), await knock()];
    frame.remove();
    // device.notify: a bad id, a time in the past, one too far ahead, then a real one 20 s ahead (the banner), then a cancel.
    out.notifyBadId = (await call('device.notify.schedule', { app: 'legacy', id: 'Bad Id', title: 't', body: 'b', atIso: new Date(Date.now() + 60000).toISOString() })).problem?.code;
    out.notifyPast = (await call('device.notify.schedule', { app: 'legacy', id: 'probe', title: 't', body: 'b', atIso: new Date(Date.now() - 1000).toISOString() })).problem?.code;
    out.notifyFar = (await call('device.notify.schedule', { app: 'legacy', id: 'probe', title: 't', body: 'b', atIso: new Date(Date.now() + 401 * 86400000).toISOString() })).problem?.code;
    out.notifyLong = (await call('device.notify.schedule', { app: 'legacy', id: 'probe', title: 'x'.repeat(121), body: 'b', atIso: new Date(Date.now() + 60000).toISOString() })).problem?.code;
    out.notifyUnknownApp = (await call('device.notify.schedule', { app: 'evil', id: 'probe', title: 't', body: 'b', atIso: new Date(Date.now() + 60000).toISOString() })).problem?.code;
    out.notifySchedule = await call('device.notify.schedule', { app: 'legacy', id: 'probe', title: 'ZeroFee reminder', body: 'Your 7-day wait has ended.', atIso: new Date(Date.now() + 20000).toISOString() });
    if (cancel) { out.notifyCancel = await call('device.notify.cancel', { app: 'legacy', id: 'probe' }); }
    out.keyInfo = await call('key.info', {});
    out.keyCreate = await call('key.create', {});
    // S1.6: the chip signs only through the native sheet, and only checked transaction bytes. Each of these is refused
    // before any sheet opens.
    const probeWords = { title: 'Probe', lines: [], warnings: [], effect: [] };
    out.keySignBareHash = (await call('key.sign', { hash: btoa('x'.repeat(32)) })).problem?.whatHappened;
    out.keySignNotTx = (await call('key.sign', { id: 'probe', words: probeWords, bytes: btoa('x'.repeat(40)) })).problem?.whatHappened;
    out.keySignBadWords = (await call('key.sign', { id: 'probe', words: { lines: [] }, bytes: btoa('x'.repeat(40)) })).problem?.whatHappened;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'probe-no-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'x-stainless-lang': 'js', 'x-stainless-retry-count': '0' }, body: JSON.stringify({ model: 'claude-x', max_tokens: 1, messages: [] }) });
      out.anthropic = 'HTTP ' + r.status + ' readable by the page; type=' + (await r.json()).error?.type;
    } catch (e) { out.anthropic = 'BLOCKED: ' + e; }
    if (sheet) out.sheet = await call('device.openUrl', { app: 'pay', url: 'https://example.com/', mode: 'sheet' });
    return JSON.stringify(out);
    """
    let sheet = ProcessInfo.processInfo.environment["ZF_PROBE_SHEET"] == "1"
    let cancel = ProcessInfo.processInfo.environment["ZF_PROBE_NOTIFY_CANCEL"] == "1"
    webView.callAsyncJavaScript(js, arguments: ["qr": Self.probeQR(), "sheet": sheet, "cancel": cancel], in: nil, in: .page) { result in
      switch result {
      case .success(let value):
        guard let text = value as? String, let data = text.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return NSLog("[zf-probe] odd result") }
        for key in dict.keys.sorted() {
          let v = dict[key].flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed, .sortedKeys]) }.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
          NSLog("[zf-probe] %@ = %@", key, v)
        }
        NSLog("[zf-probe] done")
        // With the sheet open: a stray return link for another app (ignored), then Pay's own (closes the sheet,
        // device.returned to Pay). Calls the handler directly: iOS's own "Open in ZeroFee?" step needs a person.
        if ProcessInfo.processInfo.environment["ZF_PROBE_KEYCHECK"] == "1" { self.runKeyCheck() }
        // The native sheet itself, for a screenshot (the simulator has no chip: Approve says so and signs nothing).
        if ProcessInfo.processInfo.environment["ZF_PROBE_NATIVE_SHEET"] == "1" { Task { await self.probeNativeSheet() } }
        if sheet {
          DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            self.handleOpen(URL(string: "zerofee://wallet/return?probe=stray")!)
            self.handleOpen(URL(string: "zerofee://pay/return?probe=1")!)
          }
        }
      case .failure(let error):
        NSLog("[zf-probe] failed: %@", String(describing: error))
      }
    }
  }
}
#endif
