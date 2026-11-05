// Swap in place (intents-swap.ts): the Safe's swap is ONE mt_transfer inside intents.near (no withdraw, no ORIGIN_CHAIN
// deposit, no bridge), the NEAR wallet's ONE intent; what arrived is the settled figure, never the quote's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import type { TxRequest } from "@zerofee/core/signer";
import { createIntentsSwap, SWAP_USDC } from "./intents-swap.ts";
import type { QuoteRequest } from "./apis.ts";
import type { Movement } from "./types.ts";

const NEAR = "nep141:wrap.near", DEP = "ab".repeat(32);
const COINS: Record<string, { decimals: number; symbol: string }> = { [SWAP_USDC]: { decimals: 6, symbol: "USDC" }, [NEAR]: { decimals: 24, symbol: "wNEAR" }, "nep141:token.near": { decimals: 18, symbol: "TKN" } };

function setup(now: () => number = Date.now) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const signed: TxRequest[][] = [];
  const dry: QuoteRequest[] = [];
  const kept: Movement[] = [];
  let balanceNear = 1_000n;
  const bridge = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "subwallet.safeSwapQuote") return { ok: { depositAddress: DEP, amountIn: params.amount, minAmountOut: "2900", statusTag: "tag-of-this-deposit-0001" } };
      if (method === "subwallet.float.swapQuote") return { ok: { amountIn: params.amount, amountOut: "3000", minAmountOut: "2970", decimals: 24, coinUsd: 3, etaSeconds: 4 } };
      if (method === "subwallet.float.swap") return { ok: { id: "fm-1", status: "pending" } };
      if (method === "subwallet.float.move") return { ok: { id: "fm-1", status: "done", settled: { amountOut: "2988" } } };
      return { problem: { code: "x", whatHappened: "x" } };
    },
  } as unknown as Bridge;
  const asked: { dep: string; tag?: string }[] = [];
  const swaps = createIntentsSwap({
    bridgeFor: () => bridge,
    // 1Click: done on its second read, 2950 arrived (never the quote's 3000)
    status: async (dep, tag) => (asked.push({ dep, ...(tag ? { tag } : {}) }), asked.length >= 2 ? { status: "SUCCESS", amountOut: "2950" } : { status: "PROCESSING" }),
    myAccount: async () => ({ accountId: "kim.near" }),
    coin: async (t) => COINS[t] ?? null,
    ledgerBalance: async (_a, t) => (t === SWAP_USDC ? 50_000_000n : (balanceNear += t === NEAR && kept.length ? 2_950n : 0n) - (kept.length ? 0n : 0n)),
    canChain: async () => true,
    dryQuote: async (r) => (dry.push(r), { quote: { amountIn: r.amount, amountOut: "3000", minAmountOut: "2970", amountInUsd: "10.00", amountOutUsd: "9.95", timeEstimate: 10 } } as never),
    signAll: async (reqs) => (signed.push(reqs), { txHash: "tx1", explorerUrls: ["https://nearblocks.io/txns/tx1"] }),
    approvals: (steps) => steps,
    remember: async (m) => void kept.push(m),
    follow: () => undefined,
    now, iso: () => new Date(now()).toISOString(),
    sleep: async () => undefined,
  });
  return { swaps, calls, signed, dry, kept, asked };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test("the Safe: one dry INTENTS quote, then ONE signed call: a single mt_transfer to the core's quote address; no withdraw, no ORIGIN_CHAIN", async () => {
  const s = setup();
  const q = await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "10", source: "safe" }, "trade");
  assert.match(q.feeNote, /^NEAR Intents prices it\. Fees about \$0\.05 \(0\.50%\)/, "the fee line names NEAR Intents, from the quote's own dollars");
  assert.equal(q.etaSeconds, 10, "1Click's own time");
  assert.deepEqual([s.dry[0]!.depositType, s.dry[0]!.recipientType, s.dry[0]!.refundType, s.dry[0]!.recipient, s.dry[0]!.confidentiality], ["INTENTS", "INTENTS", "INTENTS", "kim.near", "basic"]);
  const job = await s.swaps.swap({ quoteId: q.id }, "trade");
  assert.equal(job.kind, "swap");
  assert.equal(job.status, "moving", "the job at once");
  const core = s.calls.find((c) => c.method === "subwallet.safeSwapQuote")!;
  assert.deepEqual(core.params, { from: SWAP_USDC, to: NEAR, amount: "10000000", atLeast: "2970" }, "the core's own quote, held to the figure shown");
  assert.equal(s.signed.length, 1, "one approval");
  assert.equal(s.signed[0]!.length, 1, "one transaction");
  const tx = s.signed[0]![0]!;
  assert.equal(tx.receiverId, "intents.near");
  assert.deepEqual(tx.actions.map((a) => (a as { method?: string }).method), ["mt_transfer"]);
  assert.deepEqual((tx.actions[0] as { args: Record<string, unknown> }).args, { receiver_id: DEP, token_id: SWAP_USDC, amount: "10000000", approval: null });
  const all = JSON.stringify([s.signed, s.dry, s.calls]);
  assert.ok(!/ft_withdraw|ORIGIN_CHAIN|WITHDRAW_TO/.test(all), "no withdraw, no deposit from a chain, no bridge");
});

test("the Safe: done on 1Click's SUCCESS for ITS deposit address (with the quote's tag), amountOut 1Click's settled figure (not the quote's 3000)", async () => {
  const s = setup();
  const q = await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "10", source: "safe" }, "wallet");
  const job = await s.swaps.swap({ quoteId: q.id }, "wallet");
  assert.equal(job.depositAddress, DEP);
  await settle();
  const done = s.kept.find((m) => m.status === "done")!;
  assert.ok(done, "ended done");
  assert.deepEqual(s.asked[0], { dep: DEP, tag: "tag-of-this-deposit-0001" }, "1Click's status for this swap's own address, with its tag");
  assert.equal(done.amountOut, "0.00000000000000000000295", "1Click's swapDetails.amountOut, 2950 units, never the quoted 3000");
  assert.ok(typeof done.settledMs === "number" && done.settledMs >= 0, "measured from the tap");
});

test("the Safe swaps only coins it can also pay out with Face ID today (safeCanSell): an unlisted coin is refused before anything is asked, either way", async () => {
  const s = setup();
  const odd = "nep141:token.near";
  await assert.rejects(s.swaps.swapQuote({ from: SWAP_USDC, to: odd, amountIn: "1", source: "safe" }, "trade"), (e: any) => e?.problem?.code === "ledger.swap.not-yet", "no Buy of a coin it couldn't Sell");
  await assert.rejects(s.swaps.swapQuote({ from: odd, to: SWAP_USDC, amountIn: "1", source: "safe" }, "trade"), (e: any) => e?.problem?.code === "ledger.swap.not-yet", "no Sell that would wait a day");
  assert.equal(s.dry.length, 0, "1Click never asked");
  await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "1", source: "safe" }, "trade");
  assert.equal(s.dry.length, 1, "control: a listed coin is priced");
});

test("a reload: a NEAR wallet swap still moving is followed again by its move id and ends (B3); a Safe one is left to the ledger's follow", async () => {
  const s = setup();
  const at = new Date().toISOString();
  await s.swaps.resume({ id: "swap:fm-9", kind: "swap", status: "moving", source: "private", from: SWAP_USDC, to: NEAR, amount: "10", startedAtIso: at, updatedAtIso: at, explorerUrls: [], caller: "trade" });
  await s.swaps.resume({ id: "swap:tx9", kind: "swap", status: "moving", source: "safe", from: SWAP_USDC, to: NEAR, amount: "10", startedAtIso: at, updatedAtIso: at, explorerUrls: [], depositAddress: DEP, caller: "trade" });
  await settle();
  assert.deepEqual(s.calls.filter((c) => c.method === "subwallet.float.move").map((c) => c.params), [{ id: "fm-9" }], "its own move, once (then it ended)");
  const done = s.kept.find((m) => m.id === "swap:fm-9")!;
  assert.equal(done.status, "done");
  assert.equal(done.amountOut, "0.000000000000000000002988");
  assert.equal(s.kept.some((m) => m.id === "swap:tx9"), false, "the Safe's is the ledger's (by its deposit address)");
});

test("the NEAR wallet: ONE intent (subwallet.float.swap), amountOut from 1Click's settled answer (not the quote's)", async () => {
  const s = setup();
  const q = await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "10", source: "private" }, "wallet");
  const job = await s.swaps.swap({ quoteId: q.id }, "wallet");
  assert.equal(job.source, "private");
  assert.equal(s.calls.filter((c) => c.method === "subwallet.float.swap").length, 1);
  assert.deepEqual(s.calls.find((c) => c.method === "subwallet.float.swap")!.params, { side: "buy", coin: NEAR, amount: "10000000", atLeast: "2970", key: `swap-${q.id}` });
  assert.equal(s.signed.length, 0, "nothing for the Safe to sign");
  await settle();
  const done = s.kept.find((m) => m.status === "done")!;
  assert.equal(done.amountOut, "0.000000000000000000002988", "1Click's settled 2988, not the quoted 3000");
});

test("control: a pair the NEAR wallet can't swap in one intent is refused before anything is asked; a quote is used once", async () => {
  const s = setup();
  await assert.rejects(s.swaps.swapQuote({ from: NEAR, to: "nep141:token.near", amountIn: "1", source: "private" }, "wallet"));
  assert.equal(s.calls.length, 0);
  const q = await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "10", source: "safe" }, "wallet");
  await s.swaps.swap({ quoteId: q.id }, "wallet");
  await assert.rejects(s.swaps.swap({ quoteId: q.id }, "wallet"), "the same quote never pays twice");
  assert.equal(s.signed.length, 1);
});

// Privacy P7 (QA): the Safe's dry quote asks 1Click for a deadline on a 5-minute mark (quoteDeadline), never
// now + 10 min to our millisecond. Fixed clocks across one window, no wall clock.
const W = Date.parse("2026-11-05T06:00:00.000Z"), MIN = 60_000;
const CLOCKS = [W + 1, W + 1_000, W + MIN, W + 2 * MIN + 30_000, W + 4 * MIN + 59_000, W + 5 * MIN - 1, W + 5 * MIN];
test("the Safe's dry quote: its deadline is on a 5-minute mark, at least 10 min, under 15 min; the core's bound accepts it (control: the old stamp isn't on a mark)", async () => {
  const { safeSwapRefusal } = await import("@zerofee/core/safe-swap");
  for (const at of CLOCKS) {
    const s = setup(() => at);
    await s.swaps.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "10", source: "safe" }, "trade");
    const iso = s.dry[0]!.deadline, d = Date.parse(iso);
    assert.match(iso, /T\d\d:[0-5][05]:00\.000Z$/, `${new Date(at).toISOString()} → ${iso}`);
    assert.ok(d >= at + 10 * MIN && d < at + 15 * MIN, iso);
    // the same deadline signed back by 1Click passes the Safe's own check at that clock
    const q = { status: "PENDING_DEPOSIT", deadline: iso, depositType: "INTENTS", swapType: "EXACT_INPUT", originAsset: SWAP_USDC, destinationAsset: NEAR, amountIn: "10000000", recipient: "kim.near", recipientType: "INTENTS", refundTo: "kim.near", refundType: "INTENTS", minAmountOut: "2970" };
    assert.equal(safeSwapRefusal(q as never, { from: SWAP_USDC, to: NEAR, amount: "10000000", atLeast: "2970", account: "kim.near", nowMs: at }), null, iso);
  }
  // control: the old stamp carried our clock (not on a mark) at every clock off the grid
  for (const at of CLOCKS.filter((t) => t % (5 * MIN) !== 0)) assert.doesNotMatch(new Date(at + 10 * MIN).toISOString(), /:[0-5][05]:00\.000Z$/);
});
