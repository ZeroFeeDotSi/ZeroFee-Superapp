// The copy sheet's "The wallet to copy" (copy review, 6 Nov): one field, Send's To shape. The address reads six
// and six at rest and whole only while it is edited; the field's value is always the whole address.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { shortId } from "@zerofee/wallet/app/money/send-words.ts";

let server: ViteDevServer;
let LeaderField: ComponentType<{ value: string; onChange: (v: string) => void }>;
let leaderShort: (value: string, editing: boolean) => string | null;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ LeaderField, leaderShort } = await server.ssrLoadModule("./LeaderField.tsx") as never);
});
after(async () => server?.close());

const WALLET = "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ";
const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./agent.css", import.meta.url), "utf8");

test("at rest a real address reads six and six, Send's own form; while editing it reads whole; what isn't an address is never cut (controls)", () => {
  assert.equal(leaderShort(WALLET, false), shortId(WALLET));
  assert.equal(leaderShort(WALLET, false), `${WALLET.slice(0, 6)}…${WALLET.slice(-6)}`);
  assert.equal(leaderShort(WALLET, true), null, "editing: the whole address");
  assert.equal(leaderShort("", false), null, "control: empty shows the placeholder");
  assert.equal(leaderShort(`${WALLET.slice(0, 40)}0000`, false), null, "control: a bad address shows whole, so you can see what's wrong");
});

test("one field: the input keeps the whole address under the short one, one label, no textarea; empty shows its placeholder", () => {
  const html = renderToStaticMarkup(createElement(LeaderField, { value: WALLET, onChange: () => {} }));
  assert.match(html, new RegExp(`<input[^>]*value="${WALLET}"`));
  assert.ok(html.includes(`>${WALLET.slice(0, 6)}…${WALLET.slice(-6)}<`));
  assert.equal((html.match(/<input/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<textarea/);
  // ui.css draws a ring on any class with "-field" in it while something inside has focus: that was the outer box
  assert.doesNotMatch(html, /class="[^"]*-field/);
  assert.equal((html.match(new RegExp(WALLET, "g")) ?? []).length, 1, "the whole address isn't drawn as words as well");
  const empty = renderToStaticMarkup(createElement(LeaderField, { value: "", onChange: () => {} }));
  assert.match(empty, /placeholder="Paste a Solana address"/);
  assert.doesNotMatch(empty, /ag-to__short/);
});

test("the copy sheet uses it, in Send's shape: a filled box with no border, its ring only while typing (control: the old stacked boxes are gone)", () => {
  assert.match(app, /<LeaderField value=\{terms\.leader\} onChange=\{\(leader\) => setTerms\(\{ \.\.\.terms, leader \}\)\} \/>/);
  assert.doesNotMatch(app, /ag-address/);
  assert.doesNotMatch(css, /ag-address/);
  assert.match(css, /\.ag-to \{[^}]*height: 56px;[^}]*border-radius: var\(--r-md, 16px\);[^}]*background: var\(--act-fill\);/);
  assert.match(css, /\.ag-to:focus-within \{ box-shadow: inset 0 0 0 1px var\(--ink\); \}/);
  assert.match(css, /\.ag-to input, \.ag-to input:focus, \.ag-to input:focus-visible \{[^}]*box-shadow: none;/);
});
