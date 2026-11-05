// Set-up at PAR 8 (grade 1 Nov c): Make your key carries the terms (one tap agrees) and the recovery wait as one line
// (D49: 48 hours unless changed, never "Recommended", P9); the laptop offer (the outside study's item 3; design review,
// 28 Oct) is one link on the open screen, never a screen of its own. The screens are TSX, so vite's own loader loads them
// (as in shell/open-source.test.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

type Wait = { choices: { seconds: number; default: boolean }[]; seconds: number; onChange: (s: number) => void };

let server: ViteDevServer;
let BankOpen: (p: { accountId: string; onEnter: () => void; onLaptop?: () => void }) => ReactElement;
let MakeKey: (p: { onBack: () => void; onContinue: () => void; wait?: Wait; terms?: boolean }) => ReactElement;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ BankOpen, MakeKey } = await server.ssrLoadModule("./Onboarding.tsx"));
});
after(async () => server?.close());

const CHOICES = [{ seconds: 60, default: false }, { seconds: 172800, default: true }, { seconds: 259200, default: false }];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("Make your key: the recovery wait is one line with Change (48 hours), the terms agree on the same tap, nothing says Recommended", () => {
  const html = text(renderToString(MakeKey({ onBack: () => {}, onContinue: () => {}, terms: true, wait: { choices: CHOICES, seconds: 172800, onChange: () => {} } })));
  assert.match(html, /Recovery wait\s*:\s*48 hours\s*·\s*Change/);
  assert.match(html, /Agree and make my key/);
  assert.match(html, /you agree to the terms\. You're 18 or older and not in a sanctioned place/);
  assert.match(html, /Read the terms/);
  assert.doesNotMatch(html, /recommend/i);
  // terms already agreed: the plain button and no terms block
  const agreed = text(renderToString(MakeKey({ onBack: () => {}, onContinue: () => {}, wait: { choices: CHOICES, seconds: 172800, onChange: () => {} } })));
  assert.match(agreed, /Make my key/);
  assert.doesNotMatch(agreed, /Agree|sanctions/);
});

test("the open screen offers the laptop as one optional link; Open ZeroFee stays the one button", () => {
  const html = text(renderToString(createElement(BankOpen, { accountId: "a.testnet", onEnter: () => {}, onLaptop: () => {} })));
  assert.match(html, /Add my laptop as a second device/);
  assert.doesNotMatch(html, /\(optional\)/, "a link is optional already: said once (copy review rule 8)");
  assert.doesNotMatch(html, /safe|guarantee|unhackable|recommend/i);
  assert.ok(html.indexOf("Open ZeroFee") < html.indexOf("Add my laptop"), "Open ZeroFee first, the laptop under it");
});

test("the app's set-up has no wait screen and no laptop screen: the laptop link opens Security's pairing", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const first = readFileSync(new URL("./FirstRun.tsx", import.meta.url), "utf8");
  for (const src of [app, first]) {
    assert.doesNotMatch(src, /RecoveryChoice|AddLaptop|k: "choose"|k: "laptop"/);
  }
  // UX walk 2 Nov: offered only where a laptop page opens (LAPTOP_PAGE), never a link to a 404
  assert.match(app, /\{\.\.\.\(LAPTOP_PAGE \? \{ onLaptop: \(\) => setView\(\{ k: "home", account: view\.account, start: \{ id: "security", tab: "laptop" \} \}\) \} : \{\}\)\}/);
  // P3: new words from Details have a way back (the arrow, and through Top's useBack, the browser's Back and Escape);
  // 01d Q11: to where they were asked for (Details, or Security's Recovery), not the hub.
  assert.match(app, /<Words renew words=\{view\.words\} onBack=\{\(\) => setView\(\{ k: "home", account: view\.account, start: view\.back \}\)\}/);
  const onboarding = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");
  assert.match(onboarding, /function Top\(.*\n  useBack\(onBack\);/);
  assert.match(onboarding, /<Top label="New backup words" onBack=\{onBack\} \/> : <WordsTop/);
  const security = readFileSync(new URL("../apps/security/SecurityApp.tsx", import.meta.url), "utf8");
  // Job 1: "security/laptop" opens Devices inside Home, straight into pairing (never with no laptop page); new words
  // from there come back to Recovery, where they live.
  assert.match(security, /if \(step === "laptop" && !noLaptopPage\) setFlow\("laptop"\);/);
  assert.match(security, /if \(step === "new-words"\) actions\.onNewWords\?\.\(\{ id: "security", tab: "recovery" \}\)/);
});
