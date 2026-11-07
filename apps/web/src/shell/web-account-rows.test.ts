// Bug report (5 Nov late: "webdemo is incomplete or wrong code"): the web wallet's "Your account" sheet showed only Activity
// and Settings; the iPhone shows Quantum-safe, Protection, Devices, Recovery, then Activity, Details, Settings. The web now
// has the same rows in the same order, each saying truthfully what this browser has: "On iPhone" (never "On") and one
// short page for the Safe's three, Settings' own backup-words sheet for Recovery, its own Details (addresses, Copy, no
// Safe, no key export), and Settings' Passwords row the same kind of page. Renders, with controls; source pins for the
// wiring that only runs in the browser (WalletApp, App.tsx).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { ON_IPHONE, ON_IPHONE_LINKS, ON_IPHONE_PAGES, WEB_ACCOUNT_ROWS, WEB_DETAILS, WEB_PASSWORDS_LINE } from "@zerofee/shell-api/web-account-words.ts";
import { TOP_NOTE_LAPTOP_LABEL, TOP_NOTE_LAPTOP_URL, TOP_NOTE_SELFHOST_FALLBACK, TOP_NOTE_SELFHOST_LABEL } from "../top-note-words.ts";
import { webAddRows } from "@zerofee/wallet/app/money/web-add.ts";
import { CODE_FALLBACK } from "./open-source.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = ComponentType<any>;
let server: ViteDevServer;
let R: { WebAccountRows: C; WebAccountSheet: C };
let S: { OnIphoneSheet: C; LAPTOP_URL: string; CODE_FALLBACK: string; codeLink: (u: string | undefined) => string };
let D: { WebDetailsList: C };
before(async () => {
  server = await createServer({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  R = (await server.ssrLoadModule("./shell/WebAccountRows.tsx")) as unknown as typeof R;
  S = (await server.ssrLoadModule("./shell/OnIphoneSheet.tsx")) as unknown as typeof S;
  D = (await server.ssrLoadModule("@zerofee/wallet/app/screens/WebDetails.tsx")) as unknown as typeof D;
});
after(async () => server?.close());

const html = (c: C, p: Record<string, unknown>) => renderToStaticMarkup(createElement(c, p));
const BRIDGE = { call: async () => ({ ok: null }), on: () => () => undefined };

test("the rows: the phone's order and icons (Quantum-safe, Protection, Devices, Recovery), \"On iPhone\" on the Safe's three, never \"On\"", () => {
  const out = html(R.WebAccountRows, { open: () => undefined });
  const titles = [...out.matchAll(/<div class="t">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Quantum-safe", "Protection", "Devices", "Recovery"]);
  const icons = [...out.matchAll(/data-ic="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(icons, ["shield-check", "shield", "phone", "words"], "the phone's SecurityRows icons");
  const values = [...out.matchAll(/<div class="vd">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(values, [ON_IPHONE, ON_IPHONE, ON_IPHONE, "Backup words"]);
  assert.equal(ON_IPHONE, "On iPhone");
  assert.ok(!values.includes("On"), "never a state claimed for this browser");
  assert.doesNotMatch(out, /<input|role="switch"|type="checkbox"/, "no toggles");
  for (const r of WEB_ACCOUNT_ROWS) assert.ok(out.includes(`<div class="d">${r.line}</div>`), r.title);
  // control: the phone's rows say the account's real state, never "On iPhone"
  assert.doesNotMatch(src("../apps/security/SecurityApp.tsx"), /On iPhone|ON_IPHONE/);
});

test("Recovery's line counts the web wallet's real words: 24 (the core makes and imports 24)", () => {
  assert.equal(WEB_ACCOUNT_ROWS[3]!.line, "Your 24 backup words, behind your password.");
  const core = readFileSync(new URL("../../../../packages/core/src/web-wallet.ts", import.meta.url), "utf8");
  assert.match(core, /words\.length !== 24/);
});

test("each On iPhone page: its title, its one line, Laptop approval and Get the code in a new tab; no toggle, no state", () => {
  for (const place of ["quantum", "protection", "devices"] as const) {
    const out = html(R.WebAccountSheet, { place, bridge: BRIDGE, codeUrl: undefined, onClose: () => undefined });
    const page = ON_IPHONE_PAGES[place];
    assert.ok(out.includes(`>${page.title}<`), `${place}: its title`);
    assert.ok(out.includes(page.line), `${place}: its line`);
    assert.match(page.line, /^On iPhone, /, "said of the iPhone, never of this browser");
    const links = [...out.matchAll(/<a class="oni__link" href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(links, [[TOP_NOTE_LAPTOP_URL, TOP_NOTE_LAPTOP_LABEL], [TOP_NOTE_SELFHOST_FALLBACK, TOP_NOTE_SELFHOST_LABEL]]);
    assert.doesNotMatch(out, /<input|role="switch"|type="checkbox"|password/i, "no toggle and no password");
  }
  // the top note's own links, kept in the page's chunk (the top note is in no chunk of the phone build), pinned equal
  assert.equal(S.LAPTOP_URL, TOP_NOTE_LAPTOP_URL);
  assert.equal(S.LAPTOP_URL, "https://laptop.zerofee.si");
  assert.equal(S.CODE_FALLBACK, TOP_NOTE_SELFHOST_FALLBACK);
  assert.equal(S.CODE_FALLBACK, CODE_FALLBACK, "the same as Settings → Open source");
  assert.deepEqual([ON_IPHONE_LINKS.laptop, ON_IPHONE_LINKS.code], [TOP_NOTE_LAPTOP_LABEL, TOP_NOTE_SELFHOST_LABEL]);
  assert.deepEqual([ON_IPHONE_LINKS.laptop, ON_IPHONE_LINKS.code], ["Laptop approval", "Get the code"]);
  assert.doesNotMatch(src("./OnIphoneSheet.tsx"), /from "\.\.\/top-note/, "never imports the top note's module");
  // the build's code address when it is https; control: anything else falls back
  const code = html(S.OnIphoneSheet, { page: ON_IPHONE_PAGES.quantum, codeUrl: "https://github.com/example/zerofee", onClose: () => undefined });
  assert.ok(code.includes('href="https://github.com/example/zerofee"'));
  const bad = html(S.OnIphoneSheet, { page: ON_IPHONE_PAGES.quantum, codeUrl: "http://example.com", onClose: () => undefined });
  assert.ok(bad.includes(`href="${TOP_NOTE_SELFHOST_FALLBACK}"`));
  // 44 px rows
  const css = src("./on-iphone.css");
  assert.match(css, /\.oni__link \{[^}]*min-height: 44px;/);
});

test("Recovery opens Settings' own backup-words sheet, the password first (WebWalletRows' SecretSheet: no second secret path)", () => {
  const out = html(R.WebAccountSheet, { place: "recovery", bridge: BRIDGE, codeUrl: undefined, onClose: () => undefined });
  assert.match(out, /Show your backup words/);
  assert.match(out, /type="password"/, "the password is asked first");
  assert.doesNotMatch(out, /data-testid="web-words"/, "control: no words before the password");
  const rows = src("./WebAccountRows.tsx");
  assert.match(rows, /import \{ SecretSheet \} from "\.\/WebWalletRows\.tsx";/);
  assert.match(rows, /if \(place === "recovery"\) return <SecretSheet bridge=\{bridge\} ask=\{\{ k: "words" \}\} onClose=\{onClose\} \/>;/);
  assert.doesNotMatch(rows.replace(/\/\/.*$|\/\*\*[\s\S]*?\*\//gm, ""), /account\.web\.|readSecret|clipboard|copyText/, "the secret is read only inside SecretSheet");
  assert.match(src("./WebWalletRows.tsx"), /\nexport function SecretSheet\(/);
});

test("web Details: each network's own address, short with Copy, the whole one unfolded; no Safe, no export (control: the phone's Details names the Safe)", () => {
  const rows = webAddRows([
    { kind: "chain", chain: "sol", address: "So1anaAddre55xxxxxxxxxxxxxxxxxxxxxxxxxxxxEND", current: true },
    { kind: "chain", chain: "hood", address: "0xa517ef0000000000000000000000000000049f8C", current: true },  // generated sample (its middle zeroed)
    { kind: "trade", chain: "near", address: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567" },
    { kind: "site", chain: "sol", address: "SiteWalletNeverShown", site: "pump.fun" },
  ]);
  assert.equal(rows.length, 3);
  const out = html(D.WebDetailsList, { rows, open: rows[1]!.address, copied: null, onOpen: () => undefined, onCopy: () => undefined });
  assert.deepEqual([...out.matchAll(/class="wl-wdt__name">([^<]+)</g)].map((m) => m[1]), ["Solana", "Robinhood Chain", "NEAR"]);
  assert.ok(out.includes("So1ana…xxxEND"), "six and six");
  assert.equal((out.match(/>Copy</g) ?? []).length, 3, "a Copy on each");
  for (const r of rows) assert.ok(out.includes(`data-address="${r.address}"`), "Copy holds the whole address");
  assert.equal((out.match(/data-testid="web-details-full"/g) ?? []).length, 1, "the tapped one unfolded");
  assert.ok(out.includes("0xa5 17ef"), "the whole address in groups");
  assert.doesNotMatch(out, /Safe|export|private key|SiteWalletNeverShown/i);
  const page = src("../../../../packages/wallet/src/app/screens/WebDetails.tsx").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(page, /exportKey|exportChecked|spending\.|Safe/, "no export, no Safe read");
  assert.match(page, /bridge\.call<ListedWallet\[\]>\("subwallet\.list"\)/, "the core's own list, as the web's Add reads it");
  assert.equal(WEB_DETAILS.title, "Your addresses");
  assert.equal(WEB_DETAILS.lead, "One address per network. Tap Copy to share it. Nothing here moves money.");
  assert.match(src("../../../../packages/wallet/src/app/screens/Details.tsx"), /Safe/, "control: the phone's Details is the Safe's");
});

test("WalletApp: on the web, webRows in the first card and Details in the second; on the phone, slots.rows unchanged", () => {
  const app = src("../../../../packages/wallet/src/app/WalletApp.tsx");
  assert.match(app, /const slots: typeof homeSlots = web \? \{\} : homeSlots;/, "the Safe's slots stay off the web");
  assert.match(app, /const webRows = web \? homeSlots\.webRows : undefined;/, "control: never read off the web");
  assert.match(app, /\{webRows \? webRows\.rows\(\(place\) => \{ setSheet\(null\); setWebSheet\(place\); \}\) : slots\.rows\?\.\(\(place, step\) => \{ setSheet\(null\); openPlace\(place, step, true\); \}\)\}/);
  const sheet = app.slice(app.indexOf('<Sheet title="Your account"'), app.indexOf("</Sheet>", app.indexOf('<Sheet title="Your account"')));
  const order = ["webRows.rows", 'title="Activity"', 'title="Details"', 'title="Settings"'].map((x) => sheet.indexOf(x));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1]!)), "first card, then Activity, Details, Settings");
  assert.ok(sheet.indexOf("webRows.rows") < sheet.indexOf("</div>"), "the rows in the first card");
  assert.match(sheet, /<NavRow title="Details" line="Your address on each network" icon="code" onClick=\{go\(\(\) => setView\(\{ kind: "details", fromAccount: true \}\)\)\} \/>/, "Details on both; the phone's row unchanged");
  assert.doesNotMatch(app, /web-account-words/, "no web words in Home's first load");
  assert.doesNotMatch(sheet, /!web && <NavRow/, "control: no row dropped on the web");
  // the row's sheet over the app, never inside Your account (a sheet under another is hidden); Close back to Your account
  assert.match(app, /\{webRows && webSheet && webRows\.sheet\(webSheet, \(\) => \{ setWebSheet\(null\); setSheet\("account"\); \}\)\}/);
  // the phone's Details first and only off the web; the web's own after it
  const phone = app.indexOf('} else if (view.kind === "details" && !web) {');
  const webd = app.indexOf('} else if (view.kind === "details") {');
  assert.ok(phone > 0 && webd > phone);
  assert.match(app.slice(webd, webd + 800), /<WebDetailsPage onBack=\{back \? \(\) => \{ tabs\(\); shell\.openApp\(back\.app, back\.tab\); \} : backFrom\(view\)\} \/>/);
  assert.match(app, /const WebDetailsPage = lazy\(\(\) => import\("\.\/screens\/WebDetails\.tsx"\)/, "never in Home's first load");
  assert.match(src("../../../../packages/wallet/src/app/screens/WebDetails.tsx"), /<PushedFrame name=\{W\.title\} onBack=\{onBack\}><WebDetails \/><\/PushedFrame>/, "its title: Your addresses");
});

test("App.tsx: webRows only on the web wallet, its chunk lazy; the phone's rows slot unchanged", () => {
  const app = src("../App.tsx");
  assert.match(app, /rows: \(open\) => <SecurityRows account=\{account\} bridge=\{shellBridge\} open=\{open\} \/>,/);
  assert.match(app, /\.\.\.\(WEB_WALLET \? \{\n          webRows: \{\n            rows: \(open\) => <Suspense fallback=\{null\}><WebAccountRows open=\{open\} \/><\/Suspense>,\n            sheet: \(place, close\) => <Suspense fallback=\{null\}><WebAccountSheet place=\{place\} bridge=\{shellBridge\} codeUrl=\{import\.meta\.env\.VITE_CODE_URL\} onClose=\{close\} \/><\/Suspense>,/);
  assert.match(app, /const webAccount = \(\) => import\("\.\/shell\/WebAccountRows\.tsx"\);/);
  assert.doesNotMatch(app, /^import .*WebAccountRows/m, "control: no static import");
  assert.match(app, /useEffect\(\(\) => \{ if \(homeAccount && WEB_WALLET\) void webAccount\(\)/, "asked for as the web's Home opens");
});

test("Settings' Passwords on the web wallet: a row that opens its On iPhone page (control: the phone's row and \"On the phone only.\" unchanged)", () => {
  assert.equal(WEB_PASSWORDS_LINE, "Site sign-ins, kept in the iPhone Keychain.");
  assert.equal(ON_IPHONE_PAGES.passwords.title, "Passwords");
  assert.equal(ON_IPHONE_PAGES.passwords.line, "On iPhone, ZeroFee keeps your site sign-ins in the iPhone Keychain. This browser keeps none.");
  const out = html(S.OnIphoneSheet, { page: ON_IPHONE_PAGES.passwords, codeUrl: undefined, onClose: () => undefined });
  assert.ok(out.includes(ON_IPHONE_PAGES.passwords.line));
  assert.ok(out.includes(`href="${TOP_NOTE_LAPTOP_URL}"`) && out.includes(`href="${TOP_NOTE_SELFHOST_FALLBACK}"`));
  const panel = src("./SettingsPanel.tsx");
  assert.match(panel, /<span><span>Passwords<\/span><small>\{WEB_PASSWORDS_LINE\}<\/small><\/span><span>\{ON_IPHONE\}<\/span>/);
  assert.match(panel, /\{logins \? \(\n\s+<button className="set__row set__row--btn" onClick=\{\(\) => setPasswords\(true\)\}><span>Passwords<\/span><span \/><\/button>/, "control: the phone's row");
  assert.doesNotMatch(panel, /LOGINS_ON_PHONE_ONLY/, "the copy review's #7 (7 Nov): no dead row in any browser; the Sim opens the same page");
  assert.match(panel, /const OnIphoneSheet = lazy\(/, "loaded when opened");
});

test("the words sheet's quiet button says Close, never Home's \"Hide web version note\" (control: Home's × keeps it)", () => {
  const rows = readFileSync(new URL("./WebWalletRows.tsx", import.meta.url), "utf8");
  assert.match(rows, /onClick=\{onClose\}>\{W\.sheetClose\}<\/button>/);
  assert.doesNotMatch(rows, /\{W\.close\}/);
  assert.match(readFileSync(new URL("../../../../packages/wallet/src/app/screens/Home.tsx", import.meta.url), "utf8"), /aria-label=\{WEB_WORDS\.close\}/, "control");
});
