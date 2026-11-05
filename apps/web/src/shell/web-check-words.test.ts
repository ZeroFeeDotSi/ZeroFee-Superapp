// Settings' "Check your backup words" on the web wallet (product decision, 5 Nov): the password first, then the 24 words typed on
// RestoreWords; the core compares them and says only yes or no. The row is the web wallet's only; the typed words never
// reach a clipboard, an address or a log; the phone's own check is unchanged.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import { WEB_WORDS as W } from "@zerofee/shell-api/web-wallet-words.ts";
import { checkBackupWords } from "./web-secret.ts";

const words = Array.from({ length: 24 }, (_, i) => `w${i}`);
const bridge = (answer: (m: string, p: unknown) => unknown, seen: unknown[] = []) => ({ call: async (m: string, p: unknown) => { seen.push([m, p]); return answer(m, p); } }) as unknown as Bridge;
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const rows = src("./WebWalletRows.tsx");
const checkPart = rows.slice(rows.indexOf("export function CheckSheet"));

test("checkBackupWords: the password alone first, then the password with the words; only yes or no comes back", async () => {
  const seen: unknown[] = [];
  const b = bridge((_m, p) => ((p as { words?: unknown }).words ? { ok: { matches: true } } : { ok: { ready: true } }), seen);
  assert.deepEqual(await checkBackupWords(b, "pw"), { ready: true });
  assert.deepEqual(await checkBackupWords(b, "pw", words), { matches: true });
  assert.deepEqual(seen, [["account.web.checkWords", { password: "pw" }], ["account.web.checkWords", { password: "pw", words }]]);
  assert.deepEqual(await checkBackupWords(bridge(() => ({ ok: { matches: false } })), "pw", words), { matches: false });
});

test("checkBackupWords: a wrong password says so, a wait says how long, anything else says it didn't open", async () => {
  assert.deepEqual(await checkBackupWords(bridge(() => ({ problem: { code: "security.web.password" } })), "x"), { why: W.wrongPassword });
  assert.deepEqual(await checkBackupWords(bridge(() => ({ problem: { code: "security.web.password" } })), "x", words), { why: W.wrongPassword });
  assert.deepEqual(await checkBackupWords(bridge(() => ({ problem: { code: "security.web.wait", whatHappened: "Too many tries. Try again in 30 seconds." } })), "x"), { why: "Too many tries. Try again in 30 seconds." });
  assert.deepEqual(await checkBackupWords(bridge(() => ({ problem: { code: "security.web.no-safe" } })), "x"), { why: W.failed });
  assert.deepEqual(await checkBackupWords(bridge(() => ({ ok: { matches: "yes" } })), "x", words), { why: W.failed }, "never a yes it didn't say");
  assert.deepEqual(await checkBackupWords(bridge(() => ({ ok: { matches: true } })), "x"), { why: W.failed }, "the password step is never a match");
  assert.deepEqual(await checkBackupWords(bridge(() => { throw new Error("down"); }), "x", words), { why: W.failed });
});

test("the UI lead's words (5 Nov), 24 words as the web wallet has", () => {
  assert.deepEqual(
    [W.checkWords, W.checkWordsSub, W.checkAsk, W.checkLead, W.checkRight, W.checkRightSub, W.checkDone, W.checkWrong, W.checkWrongSub, W.checkAgain, W.checkShow],
    ["Check your backup words", "Type them in to be sure your copy is right.", "Your password first. Then type your 24 words.", "Type your 24 words in order, from your copy, not from this screen.", "Your words are right.", "Your copy can bring this account back.", "Done", "These words don't match this account.", "Check your copy, word by word, and try again.", "Try again", "Show backup words"],
  );
});

test("the row sits under Show backup words, in the web wallet's section only; the phone's check is unchanged", () => {
  assert.match(rows, /\{W\.showWords\}<\/span><span \/><\/button>\n\s+<button [^\n]*onClick=\{\(\) => setChecking\(true\)\}><span><span>\{W\.checkWords\}<\/span><small>\{W\.checkWordsSub\}<\/small>/);
  assert.match(src("./SettingsPanel.tsx"), /\{webWallet\(\) && bridge && <Suspense fallback=\{null\}><WebWalletRows bridge=\{bridge\} \/><\/Suspense>\}/, "drawn only on the web wallet");
  const app = src("../App.tsx");
  assert.match(app, /<RestoreWords purpose="check" badWord=\{view\.badWord\} wrong=\{view\.wrong\} initial=\{view\.words\} onBack=/, "the phone's check, as it was");
  assert.ok(!app.includes("sheetLead") && !app.includes("account.web.checkWords"), "the phone never takes the web's check");
  assert.match(app, /shellBridge\.call<\{ matches: boolean \}>\("recovery\.check"/);
});

test("the typed words go only to the core: no clipboard, address, storage or log in the check or its typing screen", () => {
  assert.match(checkPart, /<RestoreWords purpose="check" sheetLead=\{W\.checkLead\} onBack=\{onClose\} onSubmit=\{\(w\) => void check\(w\)\} \/>/);
  assert.match(checkPart, /checkBackupWords\(bridge, kept\.current, words\)/);
  assert.doesNotMatch(checkPart, /useState<string\[\]>|setWords|clipboard|console\.|location|history\.|URLSearchParams|localStorage|sessionStorage/);
  const recovery = src("../screens/Recovery.tsx");
  const typing = recovery.slice(recovery.indexOf("export function RestoreWords"), recovery.indexOf("export { useCountdown }"));
  assert.doesNotMatch(typing, /clipboard|console\.|location|history\.|URLSearchParams|localStorage|sessionStorage/);
  const secret = src("./web-secret.ts");
  const fn = secret.slice(secret.indexOf("export async function checkBackupWords"), secret.indexOf("const whyNot"));
  assert.doesNotMatch(fn, /console\.|clipboard|location/);
  // the right password is dropped on a match, on a refusal and when the sheet goes
  assert.match(checkPart, /if \(r\.matches\) kept\.current = "";/);
  assert.match(checkPart, /useEffect\(\(\) => \(\) => \{ kept\.current = ""; \}, \[\]\);/);
});

let server: ViteDevServer;
let Rows: ComponentType<{ bridge: Bridge }>;
let Check: ComponentType<{ bridge: Bridge; onClose: () => void; onShowWords: () => void; start?: unknown }>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const m = await server.ssrLoadModule("./WebWalletRows.tsx");
  Rows = m.WebWalletRows;
  Check = m.CheckSheet;
});
after(async () => server?.close());
const none = bridge(() => ({ ok: {} }));
const draw = (start?: unknown) => renderToStaticMarkup(createElement(Check, { bridge: none, onClose: () => {}, onShowWords: () => {}, start })).replaceAll("&#x27;", "'");

test("drawn: the row with its sub-line; the password first; the two answers with their buttons", () => {
  const html = renderToStaticMarkup(createElement(Rows, { bridge: none }));
  assert.ok(html.indexOf(W.showWords) < html.indexOf(W.checkWords) && html.includes(W.checkWordsSub), "under Show backup words");
  const pw = draw();
  assert.ok(pw.includes(W.checkAsk) && pw.includes('type="password"') && pw.includes(W.checkNext) && !pw.includes("rc-grid"), "the password, never the boxes, first");
  const right = draw({ k: "answer", matches: true });
  assert.ok(right.includes(W.checkRight) && right.includes(W.checkRightSub) && right.includes(`>${W.checkDone}</button>`));
  assert.ok(!right.includes(W.checkAgain) && !/recorded/i.test(right), "no Try again, no recorded line");
  const wrong = draw({ k: "answer", matches: false });
  assert.ok(wrong.includes(W.checkWrong) && wrong.includes(W.checkWrongSub));
  assert.match(wrong, new RegExp(`<button class="zf-btn">${W.checkAgain}</button><button class="zf-btn zf-btn--quiet">${W.checkShow}</button>`), "Try again lit, Show backup words quiet");
});
