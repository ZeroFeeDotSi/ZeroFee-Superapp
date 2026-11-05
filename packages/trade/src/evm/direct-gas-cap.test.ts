// Coverage audit (4 Nov): a Clanker coin on Robinhood Chain (0xZAPS) wasn't built: its v4 pool estimated 7.49M gas for the
// direct path's 1-wei probe, past MAX_TX_GAS (3M), and the whole buy was refused "The route needs far more gas than a trade
// does", while KyberSwap's route for the same coin needs 475k (read on mainnet). A direct route past the cap now steps
// aside, and the next route gets its turn; the cap itself is unchanged. Replayed on a recorded mainnet case (PRIORS on
// Robinhood Chain, built through its v3 pool: TORCH's recorded v4 pool has a hook the core hasn't pinned, so Trade no longer
// builds through it), with the direct route's estimate answered as 0xZAPS's v4 probe was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEE_CAPS, MAX_TX_GAS } from "./chains.ts";
import { createEvmEngine, guardFees } from "./engine.ts";
import { keyOf, replay, TEST_OWNER, type Answer } from "./testing/replay.ts";
import { parseTx } from "./tx.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8"));
const CASE = golden.cases.find((c: { name: string }) => c.name === "hood Uniswap v3 buy $5 (PRIORS)");
// the router the recorded direct buy went through
const UR = String(CASE.steps.at(-1).to).toLowerCase();

function engineWith(v4Gas: string | undefined) {
  // the recording's own estimates through that router, answered as 0xZAPS's v4 probe was (recorded answers win in replay)
  const answers = Object.fromEntries(Object.entries(CASE.answers as Record<string, Answer>).map(([k, a]) => [k, v4Gas && k.startsWith('["eth_estimategas"') && k.includes(UR) && !a.error ? { result: v4Gas } : a]));
  const r = replay(CASE.chain, answers, (method, params) => {
    const p = params[0] as { to?: string; from?: string };
    // proofs answer "passed", as in golden.test.ts; a depth read the recording lacks is unreadable
    if ((method === "eth_call" && p?.from) || method === "eth_simulateV1") return method === "eth_call" ? { result: "0x" } : { result: (params[0] as any).blockStateCalls.map((b: any) => ({ calls: b.calls.map(() => ({ status: "0x1", returnData: "0x", logs: [] })) })) };
    if (method === "eth_call" && !(keyOf(method, params) in CASE.answers)) return { error: { message: "not in the recording" } };
    return undefined;
  });
  return createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => CASE.price, ...(CASE.meta ? { meta: async () => CASE.meta } : {}), rpc: r.rpc, fetch: r.fetch, now: () => CASE.now });
}

test("control: as recorded, the buy goes through its direct pool, inside the cap", async () => {
  const p = await engineWith(undefined).prepare(CASE.side, CASE.coin, CASE.amount);
  const swap = parseTx(p.steps.at(-1)!.tx);
  assert.equal(swap.to.toLowerCase(), UR);
  assert.equal(MAX_TX_GAS, 3_000_000n, "the cap is unchanged");
});

test("a direct route whose gas estimate is past the cap steps aside: the aggregator gets its turn, never a refusal for gas", async () => {
  // 7,487,465 gas, as 0xZAPS's v4 probe. The recording has no KyberSwap answer (the v4 route won when it was recorded), so
  // reaching the aggregator shows as its "did not answer"; before this change the buy stopped at the gas refusal instead
  const got = await engineWith("0x723fe9").prepare(CASE.side, CASE.coin, CASE.amount).then(
    (p) => { const swap = parseTx(p.steps.at(-1)!.tx); assert.ok(swap.gas <= MAX_TX_GAS); return swap.to.toLowerCase() === UR ? "v4" : "other"; },
    (e: Error) => e.message,
  );
  assert.doesNotMatch(String(got), /far more gas than a trade does/);
  assert.notEqual(got, "v4", "not through the direct pool");
  assert.match(String(got), /swap service did not answer|other/, "the aggregator's turn");
});

test("control: the cap still refuses any route past it, on both chains, and BNB Chain's cap is the same 3M", () => {
  for (const chain of ["bsc", "hood"] as const) {
    const fee = { maxFeePerGas: FEE_CAPS[chain].maxFee, maxPriorityFeePerGas: FEE_CAPS[chain].tip };
    assert.doesNotThrow(() => guardFees(chain, fee, { swap: MAX_TX_GAS }));
    assert.throws(() => guardFees(chain, fee, { swap: MAX_TX_GAS + 1n }), /far more gas than a trade does/, chain);
  }
});
