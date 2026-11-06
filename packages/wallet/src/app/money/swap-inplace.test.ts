// Home's Swap in place (swap-inplace.ts): the NEAR wallet's cash and a NEAR coin are ONE intent (subwallet.float.swap);
// the job names NEAR Intents and 1Click's own time; any other pair keeps its old route, unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { coinRoute, placeCoin } from "./swap-coins.ts";
import { SWAP_COIN, ROW_USDC } from "./swap-corridor.ts";
import { INPLACE_WORDS, inplaceArrives, inplaceFee, inplaceOf, inplaceUnits, nearCoinId, nearHeldRows, runInplaceJob, tapDetail, type InplaceQuote } from "./swap-inplace.ts";
import type { PickCoin } from "./coin-pick.ts";

const place = (p: Parameters<typeof placeCoin>[0]) => placeCoin(p, SWAP_COIN[p])!;
const near = (address: string, symbol = "TKN"): PickCoin => ({ chain: "near", address, symbol, name: symbol });
const open = (c: "bsc" | "pair") => c === "pair";
const Q: InplaceQuote = { amountIn: "10000000", amountOut: "3000000000000000000000000", minAmountOut: "2970000000000000000000000", decimals: 24, symbol: "wNEAR", coinUsd: 3.3, etaSeconds: 10 };

test("the NEAR wallet's cash and a NEAR coin swap in place: a buy, a sale; cash to cash and other pairs don't", () => {
  assert.deepEqual(coinRoute(place("near"), near("wrap.near"), open), { kind: "inplace", source: "private", side: "buy", coin: "nep141:wrap.near" });
  assert.deepEqual(coinRoute(near("wrap.near"), place("near"), open), { kind: "inplace", source: "private", side: "sell", coin: "nep141:wrap.near" });
  assert.equal(inplaceOf(place("near"), near(ROW_USDC.slice(7))), null, "cash for cash is no swap");
  assert.equal(nearCoinId("Not A Coin"), null);
  // control: the old routes, unchanged (between wallets: only NEAR Confidential; a coin in one wallet: a trade)
  assert.deepEqual(coinRoute(place("sol"), place("near"), open), { kind: "place", route: { kind: "move", from: "sol", to: "near" } });
  assert.deepEqual(coinRoute(place("safe-usdc"), place("sol"), open), { kind: "place", route: { kind: "topup", coin: "USDC", to: "sol" } });
  assert.equal("why" in coinRoute(near("a.near"), near("b.near"), open), true, "two NEAR coins: not one intent, not offered");
});

test("what it pays: dollars of cash; a share of the coin held; Max is all of it", () => {
  assert.equal(inplaceUnits("buy", 10, false), "10000000");
  assert.equal(inplaceUnits("sell", 5, false, { raw: "1000", usd: 10 }), "500");
  assert.equal(inplaceUnits("sell", 10, true, { raw: "1000", usd: 10 }), "1000");
  assert.equal(inplaceUnits("sell", 5, false), null, "no coin held: nothing to sell");
});

test("the one fee form, with the quote's own figure; 1Click's own time where the amount shows; no time when it gives none", () => {
  assert.equal(inplaceFee("buy", Q), "Fees · about $0.10");
  assert.ok(inplaceArrives("buy", Q, "ZEC").endsWith(" About 10 s."));
  assert.equal(tapDetail(Q), "NEAR Intents says about 10 s");
  const { etaSeconds: _e, ...noTime } = Q;
  assert.equal(tapDetail(noTime), undefined, "never a number of ours");
  assert.ok(!inplaceArrives("buy", noTime, "ZEC").includes(" s."), "no time of ours");
});

test("the job: ONE call (subwallet.float.swap), no withdraw or chain deposit; done on the move's end, its time measured", async () => {
  const calls: string[] = [];
  let reads = 0;
  const bridge = { call: async (method: string) => { calls.push(method); if (method === "subwallet.float.swap") return { ok: { id: "fm-1", status: "pending" } }; return { ok: { id: "fm-1", status: ++reads < 2 ? "pending" : "done" } }; } } as unknown as Bridge;
  const ends: string[] = [];
  const tasks = { update: () => true, end: (_id: string, s: string) => (ends.push(s), true) } as never;
  let t = 1_000;
  const r = await runInplaceJob({ bridge, tasks, rowId: "swap:k", route: { kind: "inplace", source: "private", side: "buy", coin: "nep141:wrap.near" }, units: "10000000", q: Q, key: "k", tapMs: 1_000, now: () => (t += 100), sleep: async () => undefined });
  assert.equal(r, "done");
  assert.deepEqual(ends, ["done"]);
  assert.equal(calls.filter((m) => m === "subwallet.float.swap").length, 1, "one intent");
  assert.ok(calls.every((m) => m === "subwallet.float.swap" || m === "subwallet.float.move"), calls.join());
});

test("a refunded or refused swap says where the money is", async () => {
  const bridge = { call: async (m: string) => (m === "subwallet.float.swap" ? { ok: { id: "fm-1", status: "refunded" } } : { ok: {} }) } as unknown as Bridge;
  const said: string[] = [];
  await runInplaceJob({ bridge, tasks: undefined, rowId: "r", route: { kind: "inplace", source: "private", side: "sell", coin: "nep141:wrap.near" }, units: "1", q: Q, key: "k", tapMs: 0, onView: (v) => v.end && said.push(v.end.line) });
  assert.deepEqual(said, [INPLACE_WORDS.refunded]);
});

test("You pay's NEAR coins: named and priced from 1Click's list; one with no price kept (it sells whole); cash and dust left out", () => {
  const tokens: Record<string, { symbol: string; decimals: number; priceUsd?: string }> = { "nep141:wrap.near": { symbol: "wNEAR", decimals: 24, priceUsd: "3" }, "nep141:x.near": { symbol: "X", decimals: 0 }, "nep141:d.near": { symbol: "D", decimals: 0, priceUsd: "0.001" } };
  const rows = nearHeldRows([{ tokenId: "nep141:wrap.near", amount: "2000000000000000000000000" }, { tokenId: ROW_USDC, amount: "5000000" }, { tokenId: "nep141:x.near", amount: "5" }, { tokenId: "nep141:d.near", amount: "3" }, { tokenId: "nep141:sol.omft.near", amount: "1000000000" }], (id) => tokens[id] ?? (id === "nep141:sol.omft.near" ? { symbol: "SOL", decimals: 9, priceUsd: "100" } : undefined));
  assert.deepEqual(rows.map((r) => [r.symbol, r.heldUsd, r.held.raw, r.held.usd]), [["wNEAR", 6, "2000000000000000000000000", 6], ["X", undefined, "5", null], ["SOL", 100, "1000000000", 100]]);
});
