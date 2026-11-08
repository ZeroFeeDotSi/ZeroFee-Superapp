// Audit 11's B9 + B10 (8 Nov). B9: a trap coin's list row said only "Didn't buy", in red, in place of the coin's name: no
// who, no money. Now it keeps the name, and its line says "ZeroFee won't buy it · Nothing was spent". B10: the coin page's
// Sell said "Sending…" with a spinner; now "Selling · under a second" (Solana), no ellipsis, no spinner.
// Fails on main: "Didn't buy"; no goingWords; the spinner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRAP_ROW_LINE, rowBuyLine } from "./row-buy.ts";

const page = readFileSync(new URL("./CoinPage.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");

test("B9: the trap row says who and the money, and keeps the coin's name [before: \"Didn't buy\" alone]", () => {
  assert.equal(rowBuyLine({ phase: "refused", at: 0, why: "x" }, "NOSELL", true), "ZeroFee won't buy it · Nothing was spent");
  assert.equal(TRAP_ROW_LINE, "ZeroFee won't buy it · Nothing was spent");
  assert.match(list, /buy && noSale && buy\.phase === "refused" \? <span className="dc-sub dc-sub--trap" role="status"><span className="dc-name">\{words\.name\}<\/span>/);
  assert.equal(rowBuyLine({ phase: "refused", at: 0, why: "Only $3.00 on Solana." }, "DOPE"), "Didn't buy · Only $3.00 on Solana.", "control: another refusal keeps its why");
});

test("B10: the coin page's trade on its way says what and how long, no ellipsis, no spinner [before: Sending… with a spinner]", async () => {
  const src = page.slice(page.indexOf("export const goingWords"), page.indexOf("\n", page.indexOf("export const goingWords")));
  const goingWords = new Function(`return ${src.replace(/^export const goingWords = /, "").replace(/\(kind: string, chain: string\): string/, "(kind, chain)").replace(/;$/, "")}`)() as (k: string, c: string) => string;
  assert.equal(goingWords("sell", "sol"), "Selling · under a second");
  assert.equal(goingWords("buy", "near"), "Buying · under 2 seconds");
  assert.match(page, /\? <button className="zf-btn" disabled>\{goingWords\(sending, seed\.chain\)\}<\/button>/);
  assert.doesNotMatch(page, /Sending…/);
});

test("B13: Max beside a sheet's figure has a 44 pt hit area, its pill drawn on ::before [before: 54 x 32]", () => {
  const css = readFileSync(new URL("../../../../wallet/src/app/wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-swap-slide \.wl-swap-all \{ position: relative; z-index: 0; height: 44px; min-height: 44px; background: none; \}/);
  assert.match(css, /\.wl-swap-slide \.wl-swap-all::before \{[^}]*top: 6px; bottom: 6px;[^}]*background: var\(--act-fill\); \}/);
});
