// The receipt (UI concept v3.1) and the reviewer's MUSTs (QA, 5 Nov): optimistic is never done; one object
// on one axis with the sizes on one scale; the lit material is the one gradient; a refusal shows no mint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptWords } from "./receipt.ts";

const css = readFileSync(new URL("./receipt.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("./ui.css", import.meta.url), "utf8");

test("MUST (a): on its way says so; Bought and the landed time come only with the chain's answer; a refusal says nothing left", () => {
  const base = { side: "buy" as const, coin: "DOPE", coinAmount: "7,505", where: "your SOL wallet" };
  const away = receiptWords({ ...base, state: "away" });
  assert.equal(away.head, "On its way");
  assert.doesNotMatch(JSON.stringify(away), /Bought|Landed/);
  assert.equal(away.verb, null);
  const landed = receiptWords({ ...base, state: "landed", landedMs: 1054 });
  assert.equal(landed.head, "Bought");
  assert.equal(landed.chain, "Landed in 1.05 s");
  assert.equal(landed.line, "7,505 DOPE · in your SOL wallet");
  assert.equal(landed.verb, "Done");
  const sold = receiptWords({ ...base, side: "sell", state: "landed", landedMs: 480 });
  assert.equal(sold.head, "Sold");
  assert.equal(sold.line, "7,505 DOPE · from your SOL wallet");
  const checking = receiptWords({ ...base, state: "checking" });
  assert.equal(checking.head, "Still checking");
  assert.doesNotMatch(JSON.stringify(checking), /Bought|Landed|Nothing left/);
  assert.equal(checking.verb, null);
  const refused = receiptWords({ ...base, state: "refused" });
  assert.equal(refused.head, "DOPE didn't buy");
  assert.equal(refused.line, "Nothing left your wallet.");
  assert.equal(refused.verb, "Try again");
});

test("geometry: coin 64 → 104 (×φ), the ring one 12-pt gap outside (128), the tick a 34-pt badge on the coin", () => {
  assert.match(tokens, /--coin: 64px; --coin-big: 104px; --ring: 128px; --ring-gap: 12px; --badge: 34px;/);
  assert.equal(Math.round(64 * 1.618), 104);
  assert.equal(104 + 2 * 12, 128);
  assert.match(css, /\.zf-receipt\[data-state="away"\] \.zf-receipt__coin, \.zf-receipt\[data-state="checking"\] \.zf-receipt__coin, \.zf-receipt\[data-state="landed"\] \.zf-receipt__coin \{ width: calc\(var\(--coin, 64px\) \* 1\.625\); height: calc\(var\(--coin, 64px\) \* 1\.625\); \}/);
  assert.match(css, /\.zf-receipt__badge \{ position: absolute; right: 6px; bottom: 6px;/);
  assert.doesNotMatch(css, /\.zf-receipt__tick \{/, "no second circle");
});

test("the ring and badge wait for the chain: only [data-state=landed] animates them; refused shows no mint", () => {
  assert.match(css, /\.zf-receipt\[data-state="landed"\] \.zf-receipt__ring circle \{ animation:/);
  assert.doesNotMatch(css, /\.zf-receipt\[data-state="away"\] \.zf-receipt__ring/);
  assert.doesNotMatch(css, /\.zf-receipt\[data-state="checking"\] \.zf-receipt__(ring|badge)/);
  assert.match(css, /\.zf-receipt\[data-state="refused"\] \.zf-receipt__badge \{ background: var\(--down\)/);
});

test("the lit material: the primary is lit from above (gradient + its shadow), and the last .zf-btn rule says so", () => {
  const all = [...ui.matchAll(/(?:^|\n|\})\s*\.zf-btn\s*\{([^}]*)\}/g)];
  const lastRule = all.at(-1)?.[1] ?? "";
  assert.match(lastRule, /background: var\(--lit, var\(--mint\)\); color: var\(--on-mint\); box-shadow: var\(--lit-shadow, var\(--glow-go\)\)/);
  assert.match(tokens, /--lit: linear-gradient\(180deg, #7df6cf 0%, var\(--mint\) 46%, #1ccf90 100%\);/);
  assert.match(ui, /@keyframes zf-tapring/);
});

test("the crawl's clock (QA): every step leaves a performance.mark and a window.__zfTap line", async () => {
  const { mark, tapBurst, TAP_RING_MS } = await import("./tap.ts");
  const g = globalThis as { __zfTap?: { mark: string; t: number }[] };
  g.__zfTap = [];
  mark("away"); mark("landed");
  assert.deepEqual(g.__zfTap.map((m) => m.mark), ["away", "landed"]);
  assert.ok(g.__zfTap[1]!.t >= g.__zfTap[0]!.t);
  // a bare element: appended, then removed after the ring's time
  const kids: unknown[] = [];
  const el = { ownerDocument: { createElement: () => ({ className: "", setAttribute() {}, remove() { kids.pop(); } }) }, appendChild: (k: unknown) => kids.push(k) } as unknown as HTMLElement;
  let felt = "";
  tapBurst(el, (k) => { felt = k; });
  assert.equal(felt, "tap");
  assert.equal(kids.length, 1);
  assert.deepEqual(g.__zfTap.slice(2).map((m) => m.mark), ["tap", "ring-on"]);
  await new Promise((r) => setTimeout(r, TAP_RING_MS + 80));
  assert.equal(kids.length, 0);
  assert.equal(g.__zfTap.at(-1)!.mark, "ring-off");
});

test("MUST (QA, 5 Nov): a refusal the chain made after landing took its network fee; one before signing or an expired send took nothing", () => {
  const a = { state: "refused" as const, side: "buy" as const, coin: "DOPE", coinAmount: "7,505", where: "your SOL wallet" };
  assert.equal(receiptWords(a).line, "Nothing left your wallet.", "the core refused before signing, or the send expired");
  assert.equal(receiptWords({ ...a, feeTaken: true }).line, "Only the network fee left your wallet.", "landed and failed, fee not read yet");
  assert.equal(receiptWords({ ...a, feeTaken: true, feeUsd: "$0.01" }).line, "Only the network fee ($0.01) left your wallet.", "landed and failed, fee read");
  assert.equal(receiptWords({ ...a, feeTaken: false, feeUsd: "$0.01" }).line, "Nothing left your wallet.", "control: a fee figure alone never claims a fee was taken");
  const sheet = readFileSync(new URL("../../trade/src/app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const feeTaken = rec\.status === "failed" && rec\.hashes\.length > 0;/, "the sheet: failed with a hash sent = landed and failed");
  assert.match(sheet, /side === "sell" \? `About \$\{heroOf\(\)\}`/, "SHOULD (c): a sale's dollars read About until the chain's figure");
});

test("receipt.css parses as written: no rule opens inside another, and each badge rule keeps its colour and its place (a rule pasted into another's body lost the refused badge and the job's disc, and no other test saw it)", () => {
  const css = readFileSync(new URL("./receipt.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0, outer = "";
  for (const at of css.matchAll(/([^{}]*)([{}])/g)) {
    if (at[2] === "}") { depth--; continue; }
    const inGroup = depth === 1 && /@media/.test(outer);
    assert.ok(depth === 0 || inGroup || /^\s*(to|from|\d+%)/.test(at[1]!), `a rule opens inside another: ${at[1]!.trim().slice(0, 80)}`);
    if (depth === 0) outer = at[1]!;
    depth++;
  }
  assert.equal(depth, 0, "every rule closes");
  const body = (state: string) => new RegExp(`\\.zf-receipt\\[data-state="${state}"\\] \\.zf-receipt__badge \\{([^{}]*)\\}`).exec(css)?.[1] ?? "";
  assert.match(body("refused"), /background: var\(--down\);/);
  assert.match(body("back"), /background: var\(--ink\); color: var\(--bg\);/);
  assert.doesNotMatch(body("back"), /--down/, "no red");
  for (const s of ["refused", "back"]) assert.match(body(s), /right: calc\(50% - var\(--coin, 64px\) \/ 2 - var\(--badge, 34px\) \/ 3\); bottom: calc\(/, `${s}: on the coin's edge`);
  assert.match(css, /\.zf-receipt__disc \{/, "the job's disc is its own rule");
});
