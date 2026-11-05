// No web page can draw over ZeroFee's own approval sheet (product decision, 3 Nov, with the words guard). The sheet is a UIKit
// controller (SwiftUI in a UIHostingController) presented on the topmost presented controller, so it sits over every
// partner window; no web view is ever in its view hierarchy; and while it is open no partner window may come on screen
// (Host.approvalOpen, TabRules.mayLeave) and no window's popups are put away over it (D146 putAwayPopups). A page also
// has no native panel of its own to raise (no JavaScript alert, confirm or prompt panels; window.open makes no new web
// view). Swift has no test target here, so this reads the Swift source; each rule has a control (a bad snippet fails it).
// On a phone, UIKit itself refuses a present() from a controller that is already presenting, so a partner window under
// the sheet can't put anything over it either (UIKit's documented behaviour, not tested here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
const ios = (f: string) => code(read(`apps/ios/ZeroFee/${f}`));
/** The body of `func name` (from its line to the next line that closes at its own indent). */
const body = (src: string, name: string) => {
  const at = src.search(new RegExp(`\\n(\\s*)(?:@\\w+ )*(?:private |static |@discardableResult\\s*)*func ${name}\\b`));
  if (at < 0) return "";
  const indent = src.slice(at + 1).match(/^\s*/)![0];
  const end = src.indexOf(`\n${indent}}`, at + 1);
  return src.slice(at, end < 0 ? undefined : end + indent.length + 2);
};
const WEB = /\bWKWebView\b|WKWebViewConfiguration|\bWebView\s*\(|SFSafariViewController|import WebKit/;

/** The sheet goes on the topmost presented controller, as a UIKit page sheet only its own buttons close. */
function sheetOnTop(native: string): string[] {
  const p: string[] = [];
  const modal = body(native, "presentModal");
  // Security audit M2: its own UIHostingController, or SheetHost (a UIHostingController that answers no when it goes)
  const ownHost = /let sheet = UIHostingController\(rootView: make\(finish\)\)/.test(modal) ||
    (/let sheet = SheetHost\(make\(finish\)/.test(modal) && /final class SheetHost: UIHostingController<AnyView> \{/.test(native) && !/addSubview|addChild|insertSubview/.test(native.slice(native.indexOf("final class SheetHost"), native.indexOf("\n}", native.indexOf("final class SheetHost")))));
  if (!ownHost) p.push("the sheet is not its own UIHostingController");
  if (!/var top: UIViewController = controller\s*\n\s*while let next = top\.presentedViewController \{ top = next \}\s*\n\s*top\.present\(sheet, animated: true\)/.test(modal)) p.push("not presented on the topmost presented controller");
  if (!/sheet\.modalPresentationStyle = \.pageSheet/.test(modal) || !/sheet\.isModalInPresentation = true/.test(modal)) p.push("not a page sheet only its own buttons close");
  if (/addSubview|addChild|\.view\.insertSubview/.test(modal)) p.push("the sheet is put inside another view");
  if (!/Self\.sheetOpen = true\s*\n\s*defer \{ Self\.sheetOpen = false \}/.test(modal)) p.push("approvalOpen isn't held for the whole sheet");
  if (!/static var approvalOpen: Bool \{ sheetOpen \}/.test(native)) p.push("approvalOpen isn't the sheet's own flag");
  if (!/AnyView\(NativeSheetView\(/.test(body(native, "presentSheet"))) p.push("the approval sheet isn't NativeSheetView");
  return p;
}

/** No web view anywhere in the sheet: its own file, its words, and every screen presentModal hosts. */
function noWebInSheet(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([f, src]) => {
    const p: string[] = [];
    if (WEB.test(src)) p.push(`${f}: a web view in the sheet's hierarchy`);
    if (f === "NativeSheet.swift" && /Representable\b/.test(src)) p.push(`${f}: a UIKit view wrapped into the approval sheet`);
    return p;
  });
}

/** No partner window comes on screen while the sheet is open: every way one is shown asks mayLeave first. */
function windowsWaitForSheet(view: string, bridge: string, warm: string, rules: string): string[] {
  const p: string[] = [];
  if (!/static func mayLeave\(walletWaiting: Bool, approvalOpen: Bool\) -> Bool \{ !walletWaiting && !approvalOpen \}/.test(rules)) p.push("TabRules.mayLeave lets a window go while the sheet is open");
  if (!/approvalOpen: Host\.approvalOpen\)/.test(body(view, "mayLeave"))) p.push("Host.mayLeave doesn't ask about the sheet");
  const pp = body(view, "presentPartner");
  const asked = pp.search(/guard mayLeave\(\) else/);
  if (asked < 0 || asked > pp.indexOf("PartnerView(") || asked > pp.indexOf("show(screen)")) p.push("presentPartner doesn't wait for the sheet");
  if (!/guard mayLeave\(\) else/.test(body(view, "showTab"))) p.push("showTab doesn't wait for the sheet");
  // show() is the one place a window is presented, and it is only reached through those, or showWarm after mayLeave()
  const all = view + "\n" + bridge + "\n" + warm;
  const shows = [...all.matchAll(/(?<![\w.])show\((?!_)[^)]*\)/g)].length;
  const inPresentPartner = (body(view, "presentPartner").match(/(?<![\w.])show\(screen\)/g) ?? []).length;
  const inShowTab = (body(view, "showTab").match(/(?<![\w.])show\(tab\)/g) ?? []).length;
  const inShowWarm = (body(warm, "showWarm").match(/(?<![\w.])show\(screen\)/g) ?? []).length;
  if (shows !== inPresentPartner + inShowTab + inShowWarm) p.push("a window is shown some other way");
  const warmCalls = [...all.matchAll(/showWarm\(/g)].length - 1; // its own definition
  const guardedWarm = (bridge.match(/if app == "social", mayLeave\(\), let warm = takeWarm\([^\n]*\n[^\n]*\n\s*showWarm\(warm\)/g) ?? []).length;
  if (warmCalls !== guardedWarm) p.push("a warm window is shown without mayLeave");
  return p;
}

/** D146: leaving a window puts its popups away, never the approval sheet. */
function popupsKeepSheet(view: string): string[] {
  return /guard let shown = presentedViewController, !Host\.approvalOpen else \{ return \}/.test(body(view, "putAwayPopups")) ? [] : ["putAwayPopups can dismiss the approval sheet"];
}

/** A page has no native panel to raise, no new web view to open, and the words bar is a view in the window. */
function pageHasNoPanels(view: string): string[] {
  const p: string[] = [];
  if (/runJavaScript(?:Alert|Confirm|TextInput)Panel/.test(view)) p.push("a page can raise a native panel");
  if (!/createWebViewWith[\s\S]{0,300}?return nil\n/.test(view) || /return WKWebView\(/.test(view)) p.push("window.open makes a new web view");
  if (!/view\.addSubview\(seedBar\)/.test(view) || /present\(seedBar|present\(\w*[Ss]eed/.test(view)) p.push("the words bar is presented, not a view in the window");
  return p;
}

const native = ios("NativeSheet.swift");
const view = ios("PartnerView.swift");
const bridge = ios("PartnerBridge.swift");
const warm = ios("WarmSites.swift");
const rules = ios("TabRules.swift");
const hosted = ["NativeSheet.swift", "SheetWords.swift", "Logins.swift", "SecretSheet.swift", "WordsEntry.swift", "WordsSheet.swift"];

test("the approval sheet is a UIKit page sheet on the topmost presented controller, holding approvalOpen while open", () => {
  assert.deepEqual(sheetOnTop(native), []);
});

test("no web view is ever in the sheet's view hierarchy (the sheet, its words, every screen presentModal hosts)", () => {
  const callers = [...new Set(["NativeSheet.swift", ...readdirCallers()])];
  for (const f of callers) assert.ok(hosted.includes(f) || f === "IsolatedCore.swift" || f === "DebugProbe.swift", `${f} hosts a sheet: add it here`);
  assert.deepEqual(noWebInSheet(Object.fromEntries(hosted.map((f) => [f, ios(f)]))), []);
});

test("no partner window comes on screen while the sheet is open, and leaving one never puts the sheet away", () => {
  assert.deepEqual(windowsWaitForSheet(view, bridge, warm, rules), []);
  assert.deepEqual(popupsKeepSheet(view), []);
  assert.deepEqual(pageHasNoPanels(view), []);
});

test("controls: each rule fails a deliberately bad source", () => {
  // the sheet put on the shell's own controller (under a partner window), not the topmost one
  assert.ok(sheetOnTop(native.replace("top.present(sheet, animated: true)", "controller.present(sheet, animated: true)")).length > 0);
  assert.ok(sheetOnTop(native.replace("sheet.isModalInPresentation = true", "sheet.isModalInPresentation = false")).length > 0);
  assert.ok(sheetOnTop(native.replace("defer { Self.sheetOpen = false }", "Self.sheetOpen = false")).length > 0);
  // the sheet's controller not a UIHostingController of its own
  assert.ok(sheetOnTop(native.replace("final class SheetHost: UIHostingController<AnyView> {", "final class SheetHost: UIViewController {")).length > 0);
  assert.ok(sheetOnTop(native.replace("    super.viewDidDisappear(animated)\n", "    super.viewDidDisappear(animated)\n    view.addSubview(UIView())\n")).length > 0);
  assert.ok(sheetOnTop(native.replace("top.present(sheet, animated: true)", "top.view.addSubview(sheet.view)\n      top.present(sheet, animated: true)")).length > 0);
  // a web view in the sheet
  assert.ok(noWebInSheet({ "NativeSheet.swift": native + "\nstruct Page: UIViewRepresentable { func makeUIView(context: Context) -> WKWebView { WKWebView() } }" }).length > 0);
  assert.ok(noWebInSheet({ "SheetWords.swift": "import WebKit\n" }).length > 0);
  // a window shown without asking about the sheet
  assert.ok(windowsWaitForSheet(view.replace("guard mayLeave() else { (sheet as? PartnerView)?.walletTrouble", "guard true else { (sheet as? PartnerView)?.walletTrouble"), bridge, warm, rules).length > 0);
  assert.ok(windowsWaitForSheet(view + "\n  func sneak(_ v: PartnerView) { show(v) }\n", bridge, warm, rules).length > 0);
  assert.ok(windowsWaitForSheet(view, bridge.replace('if app == "social", mayLeave(), let warm', 'if app == "social", let warm'), warm, rules).length > 0);
  assert.ok(windowsWaitForSheet(view, bridge, warm, rules.replace("!walletWaiting && !approvalOpen", "!walletWaiting")).length > 0);
  // popups put away over the sheet
  assert.ok(popupsKeepSheet(view.replace(", !Host.approvalOpen else { return }", " else { return }")).length > 0);
  // a page's own alert panel, a new web view for window.open, the words bar presented
  assert.ok(pageHasNoPanels(view + "\n  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String) {}\n").length > 0);
  assert.ok(pageHasNoPanels(view.replace("view.addSubview(seedBar)", "present(seedBarController, animated: true)")).length > 0);
});

/** Files that call presentModal or presentSheet (each hosts a native sheet). */
function readdirCallers(): string[] {
  return readdirSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/", import.meta.url)))
    .filter((f) => f.endsWith(".swift") && /await present(?:Modal|Sheet)\b/.test(ios(f)));
}
