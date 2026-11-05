// The port against the old engine: fixtures/evm-golden.json holds what the old EVM engine (at its audited build, tested
// with real money) did on mainnet state captured on 25 Oct 2026 (UTC), replayed with fixed node answers: every request it
// made and the chain's answer, the transactions it built and its quote. The port makes the same requests and builds the
// same bytes and numbers, except where a guardrail changed the rule (listed in DIFFERENCES, each asserted), and without a
// sell's swap estimates that every node refused (refusedSellEstimates).
import { test } from "node:test";
import { CLASSIC, V4 } from "./chains.ts";
import { MIDS } from "./twohop.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCall } from "./abi.ts";
import { fromBase64, toHex } from "./bytes.ts";
import { PERMIT2_EXPIRY_SEC } from "./context.ts";
import { createEvmEngine } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { keyOf, replay, TEST_OWNER, type Answer } from "./testing/replay.ts";
import { parseTx } from "./tx.ts";
import { fitGas } from "./aggregator.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8"));
const P2_APPROVE = "approve(address,address,uint160,uint48)";

/** Old kinds that the new error taxonomy names differently: a buy refused because its sell-back fails is "unsellable" (the old engine said "unavailable"). */
const KIND: Record<string, string> = {};
/** The old engine bought these through KyberSwap with no market price for the coin and no pool the port can read one from
 *  (their recordings answer only the old engine's own requests; the old engine refused all three later, on the price or the
 *  sell-back): the port refuses that by design, earlier and as "unpriced", since
 *  nothing independent is left to check the aggregator's route against (fix review RT-2a). */
const UNPRICED_BUYS = new Set(["bsc KyberSwap buy $5 (ARIA, its WBNB pools dust beside its USDT pool)", "bsc KyberSwap buy $5 whose sell-back fails (JCT)", "hood KyberSwap buy $5 (TORCH, every direct pool dust beside a deeper one)"]);
/** The old engine read the block number on BNB Chain for a Uniswap v4 log lookup that can't run there (no free node takes the range): the port doesn't ask. */
/** The old engine's sell-back check ran the buy and its sale in ONE simulated block; the port runs the sale in the next block
 *  (gap 5: a coin's anti-MEV cooldown refuses a sale in its buy's block), so that one-block request isn't asked. */
const DIRECT_ROUTERS = new Set([V4.hood.universalRouter, V4.bsc.universalRouter, CLASSIC.hood.v3Router, CLASSIC.bsc.v3Router, CLASSIC.bsc.v2Router].filter(Boolean).map((a) => String(a).toLowerCase()));
const oldOneBlockSellBack = (k: string) => { if (!k.startsWith('["eth_simulatev1"')) return false; try { const b = JSON.parse(k)[1][0].blockStateCalls; return b.length === 1 && b[0].calls.length >= 3 && DIRECT_ROUTERS.has(String(b[0].calls[0].to).toLowerCase()); } catch { return false; } };
/** Gap 5: a coin with no direct pool is looked for through the middle coins (twohop.ts MIDS); the recordings predate it. */
const isHopLookup = (key: string) => MIDS.hood.concat(MIDS.bsc).some((m) => key.toLowerCase().includes(m.coin.slice(2).toLowerCase()));
const expectedAsks = (c: { chain: string; answers: Record<string, unknown> }) => new Set(Object.keys(c.answers).filter((k) => !(c.chain === "bsc" && k === '["eth_blocknumber",[]]') && !oldOneBlockSellBack(k)));
/**
 * A sell's swap estimates the old engine asked for routes whose approvals weren't on chain: every node refused them (they
 * can't pass before the approvals are mined), and the port doesn't ask them, on the first quote or any refresh. Only those
 * may be missing; anything the port does ask must be one of the old engine's requests.
 */
const refusedSellEstimates = (c: { side: string; answers: Record<string, unknown> }) =>
  new Set(c.side !== "sell" ? [] : Object.entries(c.answers).filter(([k, v]) => k.startsWith('["eth_estimategas"') && !!v && typeof v === "object" && "error" in v).map(([k]) => k));
const sameRequests = (asked: Set<string>, c: { chain: string; side: string; answers: Record<string, unknown> }) => {
  const may = refusedSellEstimates(c);
  assert.deepEqual(asked, new Set([...expectedAsks(c)].filter((k) => !may.has(k) || asked.has(k))), "the same requests (less a sell's refused estimates)");
};
const UNPINNED_HOOK = "58a6ef29ddcdb064a72b550a78d84a8e065994c0";
const UNPINNED_HOOK_CASES = new Set(["hood TORCH buy $5 (the better of its v4 and v3 pools)", "hood v4 buy max (TORCH)", "hood v4 sell all, approvals needed (TORCH)", "hood v4 sell half, approvals in place (TORCH)", "hood empty wallet (TORCH)"]);
for (const name of ["bsc KyberSwap buy $5 whose sell-back fails (JCT)", "bsc KyberSwap buy $5 (ARIA, its WBNB pools dust beside its USDT pool)"]) KIND[name] = "unsellable";

test("the reference vectors are the public test wallet's, on both chains", () => {
  assert.equal(golden.owner, TEST_OWNER);
  assert.ok(golden.cases.length >= 30);
  assert.deepEqual(new Set(golden.cases.map((c: { chain: string }) => c.chain)), new Set(["bsc", "hood"]));
  const routes = new Set(golden.cases.filter((c: { quote?: unknown }) => c.quote).map((c: { quote: { route: string } }) => c.quote.route));
  for (const r of ["Uniswap v4", "Uniswap v3", "PancakeSwap v3", "PancakeSwap v2", "Pons curve", "four.meme curve", "Flap curve", "hood.fun curve", "RobinFun curve"]) assert.ok(routes.has(r), r);
});

/** A v3 pool's depth read: balanceOf(pool) on the chain's wrapped native coin (direct.ts, the deepest tier). */
/** ...or a v4 pool's liquidity (StateView.getLiquidity), read to rank more than four v4 pools (deepestV4) */
const isDepthRead = (chain: "bsc" | "hood", params: unknown[]) => { const p = params[0] as { to?: string; data?: string; from?: string }; return (!p?.from && String(p?.data).startsWith("0xfa6793d5")) || !p?.from && String(p?.to).toLowerCase() === CLASSIC[chain].weth && String(p?.data).startsWith("0x70a08231"); };
for (const c of golden.cases) {
  test(`same as the old engine: ${c.chain} ${c.name}`, async () => {
    // the port proves the steps by simulation (the old engine sent a presigned transaction without one): those requests answer "passed"
    const proofs: string[] = [], depth: string[] = [];
    const r = replay(c.chain, c.answers as Record<string, Answer>, (method, params) => {
      // the port reads each v3 pool's depth (the wrapped native it holds, as the core's session rule does); the old engine
      // never did, so the recording has no answer: unreadable, and the port keeps every v3 pool, as the old engine traded them
      if (method === "eth_call" && isDepthRead(c.chain, params)) { depth.push(keyOf(method, params)); return { error: { message: "not in the recording" } }; }
      if (isHopLookup(keyOf(method, params))) { depth.push(keyOf(method, params)); return { error: { message: "not in the recording" } }; }
      if (method === "eth_call" && (params[0] as { from?: string })?.from || method === "eth_simulateV1") { proofs.push(keyOf(method, params)); return method === "eth_call" ? { result: "0x" } : { result: (params[0] as any).blockStateCalls.map((b: any) => ({ calls: b.calls.map(() => ({ status: "0x1", returnData: "0x", logs: [] })) })) }; }
      return undefined;
    });
    const engine = createEvmEngine({ chain: c.chain, owner: TEST_OWNER, nativeUsd: async () => c.price, ...(c.meta ? { meta: async () => c.meta } : {}), rpc: r.rpc, fetch: r.fetch, now: () => c.now });
    // Mainnet copy, 4 Nov: the old engine traded TORCH through a pool whose hook the core hasn't pinned (0x58a6…), which
    // the core refuses at the tap. The port skips that pool (hooksSignable); the recording has no answers for TORCH's
    // other pools, so here it only proves the hooked pool is never asked or built (control: the recording's own swap is it).
    if (UNPINNED_HOOK_CASES.has(c.name)) {
      const steps = (await engine.prepare(c.side, c.coin, c.amount).catch(() => undefined))?.steps ?? [];
      for (const s of steps) assert.ok(!toHex(fromBase64(s.tx)).toLowerCase().includes(UNPINNED_HOOK), "never built through the unpinned hook");
      assert.ok(r.asked.every((k) => !k.toLowerCase().includes(UNPINNED_HOOK)), "never quoted through it");
      if (c.steps?.length) assert.ok(c.steps.some((s: { data: string }) => s.data.toLowerCase().includes(UNPINNED_HOOK)), "control: the old engine's swap went through it");
      return;
    }
    if (UNPRICED_BUYS.has(c.name)) {
      await assert.rejects(engine.prepare(c.side, c.coin, c.amount), (e: unknown) => e instanceof TradeError && e.reason === "unpriced");
      return;
    }
    let p;
    try { p = await engine.prepare(c.side, c.coin, c.amount); }
    catch (e) {
      assert.ok(c.error, `the old engine prepared it, the port refused: ${(e as Error).message}`);
      assert.ok(e instanceof TradeError);
      assert.equal(e.kind, KIND[c.name] ?? c.error.kind, e.message);
      sameRequests(new Set(r.asked.filter((k) => !proofs.includes(k) && !depth.includes(k))), c);
      return;
    }
    assert.ok(!c.error, `the old engine refused (${c.error?.kind}), the port prepared it`);
    // every request the old engine made, and nothing else but the proof of these very steps
    sameRequests(new Set(r.asked.filter((k) => !proofs.includes(k) && !depth.includes(k))), c);
    const q = p.quote, g = c.quote;
    for (const k of ["route", "payRaw", "getRaw", "getMinRaw", "slippageBps", "symbol", "decimals", "expiresAt", "payUsd", "getUsd", "feeUsd"] as const) assert.equal(q[k], g[k], k);
    assert.equal(q.priceImpactPct ?? null, g.priceImpactPct, "priceImpactPct");
    // the transactions: the old engine's, byte for byte (its signer serialised them unsigned)
    assert.deepEqual(p.steps.map((s) => s.id), c.steps.map((s: { id: string }) => (s.id.startsWith("approve") ? "approve" : "swap")));
    p.steps.forEach((s, i) => {
      const old = c.steps[i];
      const mine = toHex(fromBase64(s.tx));
      assert.equal(s.nonce, old.nonce, "nonce");
      if (old.to === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
        // GUARDRAIL: a Permit2 allowance of exactly this sell's amount, for 30 minutes (the old engine gave 30 days)
        const a = parseTx(mine), [tok, sp, amt, exp] = decodeCall(P2_APPROVE, a.data)!, [otok, osp, oamt, oexp] = decodeCall(P2_APPROVE, old.data)!;
        assert.deepEqual([tok, sp, amt], [otok, osp, oamt]);
        assert.equal(amt, BigInt(q.payRaw));
        assert.equal(exp, BigInt(Math.floor(c.now / 1000) + PERMIT2_EXPIRY_SEC));
        assert.equal(oexp, BigInt(Math.floor(c.now / 1000) + 30 * 24 * 3600));
        assert.deepEqual({ ...a, data: "" }, { ...parseTx(old.raw), data: "" });
      } else if (mine !== old.raw && s.id.startsWith("swap") && c.side === "buy") {
        // Rule 3 (5 Nov): a direct buy's limit is the node's estimate + 40 % (direct.ts directSwapGas), never the pool
        // quoter's padded figure the old engine floored it at (nor the old + 30 %): only that one word differs, sized from
        // an estimate the old engine was answered
        const a = parseTx(mine), o = parseTx(old.raw);
        assert.deepEqual({ ...a, gas: 0n }, { ...o, gas: 0n }, `step ${i} (${s.id}): every byte but the gas limit`);
        const estimates = Object.entries(c.answers as Record<string, { result?: string }>).filter(([k, v]) => k.startsWith('["eth_estimategas') && v.result).map(([, v]) => BigInt(v.result!));
        assert.ok(estimates.some((e) => fitGas(e) === a.gas), `step ${i}: ${a.gas} is an estimate + 40 % (or + 60,000)`);
      } else assert.equal(mine, old.raw, `step ${i} (${s.id}) bytes`);
    });
    // the port's proof is the simulation of exactly these steps (or none, when the path simulated them while building)
    for (const k of proofs) assert.ok(p.steps.some((s) => k.includes(parseTx(s.tx).data.slice(2, 74))), "a proof simulates the steps built");
    await p.ready();
  });
}
