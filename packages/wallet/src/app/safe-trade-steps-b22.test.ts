// Builder 22's item 2 (8 Nov; b21's open edge on audit 17's H5): a done Safe Buy or Sell's Activity page had no steps and
// no time ("Sold 78.0993 NEAR." alone), while Send's page and the trade's own receipt show the job's steps and "Took N s.".
// Now the page lists the three steps (the receipt's own words, job-steps safeTradeSteps) at the record's own reads and
// says "Took 6 s." once under Finished; the figure stays once (the hero), the coin side once. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chain, Movement, Token } from "../types.ts";
import { movementDollars } from "./format.ts";
import { stepsShown } from "./proof.ts";
import { swapDetail } from "./swap-detail.ts";
import { confidentialSteps } from "../../../trade/src/native/swap.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tok = (tokenId: string, symbol: string, decimals: number, priceUsd: string): Token => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", decimals, priceUsd } as Token);
const tokens = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6, "1")], ["nep141:wrap.near", tok("nep141:wrap.near", "NEAR", 24, "4.43")]]);
const chains: Chain[] = [{ id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR", coins: [] }];
const sell = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:sim-3", kind: "swap", status: "done", from: "nep141:wrap.near", to: USDC, amount: "78.0993", amountOut: "345.63402", startedAtIso: "2026-11-08T03:00:00.000Z", inPrivateAtIso: "2026-11-08T03:00:02.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", settledMs: 6000, explorerUrls: [], private: true, source: "safe", ...o } as Movement);

test("safe-trade-steps-b22: a done Safe Sell's page lists the three steps, each done, at the record's reads", () => {
  const d = swapDetail(sell(), tokens, chains)!;
  assert.ok(d.steps, "fails on main: no steps on a Safe trade's page");
  assert.deepEqual(d.steps!.map((s) => s.label), ["NEAR Confidential moved it to Private.", "NEAR Intents swapped it for USDC.", "It's in your Safe."]);
  assert.deepEqual(d.steps!.map((s) => s.atIso), ["2026-11-08T03:00:02.000Z", "2026-11-08T03:00:06.000Z", "2026-11-08T03:00:06.000Z"]);
  assert.ok(stepsShown({ steps: d.steps! }), "the page draws them (more than one)");
  assert.deepEqual(d.steps!.map((s) => s.label), confidentialSteps("USDC").map((w) => w.done), "the receipt's own words, one source");
  const buy = swapDetail(sell({ from: USDC, to: "nep141:wrap.near", amount: "25", amountOut: "5.637698" }), tokens, chains)!;
  assert.equal(buy.steps![1]!.label, "NEAR Intents swapped it for NEAR.");
});

test("safe-trade-steps-b22: \"Took 6 s.\" once under Finished; the figure once, the coin side once", () => {
  const d = swapDetail(sell(), tokens, chains)!;
  assert.equal(d.ended!.line, "Sold 78.0993 NEAR.");
  assert.equal(d.ended!.check, "Took 6 s.");
  assert.equal(swapDetail(sell({ settledMs: undefined }), tokens, chains)!.ended!.check, "Took 6 s.", "no settledMs: its start to its end");
  const all = [d.ended!.line, d.ended!.check, ...d.steps!.map((s) => s.label)].join(" ");
  assert.ok(!all.includes("345.63"), "no second dollar figure (the hero has it)");
  assert.equal(movementDollars(sell(), tokens), "$345.63");
  assert.equal((all.match(/78\.0993 NEAR/g) ?? []).length, 1, "the coin side once");
});

test("safe-trade-steps-b22: Activity puts the steps on the page", () => {
  const src = readFileSync(new URL("./screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(src, /\.\.\.\(swap\.steps \? \{ steps: swap\.steps \} : \{\}\)/);
});
