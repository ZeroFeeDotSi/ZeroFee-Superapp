// HUNT (5 Nov): how a Swap-in-place job ends (packages/wallet/src/intents-swap.ts on sim/d7). Each test asserts the
// EXPECTED behaviour, so each FAILS on sim/d7 today. Pure logic, no network: createIntentsSwap with its deps faked
// (1Click and the chain are stand-ins here; the sandbox run e2e-safe-swap.sandbox.ts proves test 1 on a real chain).
// Run: copy to <sim/d7 export>/packages/wallet/src/ and `node --test intents-swap-ends.hunt.test.ts`.
// On feat/native-coins (the fix): the rig also fakes 1Click's status per deposit address (`said`), the one thing that
// may now end a Safe swap; tests 2 and 3 tell it what 1Click said (swap 1 SUCCESS; the refund REFUNDED). The asserts
// are the hunt's own, unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIntentsSwap, SWAP_USDC, SAFE_WATCH_FOR_MS } from "./intents-swap.ts";

const WNEAR = "nep141:wrap.near";
const DEP = (n: number) => String(n).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");

function rig(o: { privateStatus?: () => string } = {}) {
  let t = 1_000_000;
  const bal = new Map<string, bigint>([[SWAP_USDC, 1_000_000_000n], [WNEAR, 0n]]);
  const jobs = new Map<string, any>();
  const followed: string[] = [];
  let deps = 0;
  const sleepers: (() => void)[] = [];
  const said = new Map<string, { status: string; amountOut?: string }>();
  const d = {
    status: async (dep: string) => said.get(dep) ?? { status: "PENDING_DEPOSIT" },
    bridgeFor: () => ({
      call: async (method: string, p: any) => {
        if (method === "subwallet.safeSwapQuote") return { ok: { depositAddress: DEP(++deps), amountIn: p.amount, minAmountOut: p.atLeast } };
        if (method === "subwallet.float.swapQuote") return { ok: { amountIn: p.amount, amountOut: "2000000000000000000000000", minAmountOut: "1980000000000000000000000", decimals: 24, coinUsd: 2.5 } };
        if (method === "subwallet.float.swap") return { ok: { id: "fm-1", status: "pending" } };
        if (method === "subwallet.float.move") return { ok: { status: o.privateStatus?.() ?? "pending" } };
        return { problem: { code: "x", whatHappened: method } };
      },
    }) as any,
    myAccount: async () => ({ accountId: "kim.near" }),
    coin: async (id: string) => (id === WNEAR ? { decimals: 24, symbol: "wNEAR" } : { decimals: 6, symbol: "USDC" }),
    ledgerBalance: async (_a: string, token: string) => bal.get(token) ?? 0n,
    canChain: async () => true,
    dryQuote: async (r: any) => ({ quote: { amountIn: r.amount, amountOut: "2000000000000000000000000", minAmountOut: "1980000000000000000000000", amountInUsd: "5", amountOutUsd: "4.99" } }) as any,
    signAll: async () => ({ txHash: `tx${deps}`, explorerUrls: [] }),
    approvals: (s: any) => s,
    remember: async (m: any) => void jobs.set(m.id, m),
    follow: (m: any) => void followed.push(m.id),
    now: () => t,
    iso: () => new Date(t).toISOString(),
    // time moves only when the test says so: each sleep waits for tick()
    sleep: (ms: number) => new Promise<void>((r) => sleepers.push(() => ((t += ms), r()))),
  };
  const s = createIntentsSwap(d);
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { const w = sleepers.splice(0); w.forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  return { s, bal, jobs, followed, said, tick, advance: (ms: number) => (t += ms) };
}

test("1. a Safe swap is NOT done because some other wNEAR reached the Safe (1Click hasn't swapped)", async () => {
  const r = rig();
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  r.bal.set(SWAP_USDC, r.bal.get(SWAP_USDC)! - 5_000_000n); // the mt_transfer left
  await r.tick(2);
  r.bal.set(WNEAR, 10n ** 22n); // anyone's 0.01 wNEAR deposit for the Safe (ft_transfer_call msg=<Safe>), not the swap
  await r.tick(2);
  const end = r.jobs.get(job.id);
  assert.notEqual(end.status, "done", `job says done with amountOut ${end.amountOut} off an unrelated deposit`);
});

test("2. two Safe swaps to the same coin: the first one's coins don't end the second", async () => {
  const r = rig();
  const q1 = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const j1 = await r.s.swap({ quoteId: q1.id }, "wallet");
  const q2 = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "7", source: "safe" }, "wallet");
  const j2 = await r.s.swap({ quoteId: q2.id }, "wallet");
  r.bal.set(WNEAR, 2n * 10n ** 24n); // swap 1's 2 wNEAR lands; swap 2 is still with 1Click (or gets refunded later)
  r.said.set(r.jobs.get(j1.id).depositAddress, { status: "SUCCESS", amountOut: "2000000000000000000000000" }); // 1Click: swap 1 done
  await r.tick(2);
  assert.equal(r.jobs.get(j1.id).status, "done");
  assert.notEqual(r.jobs.get(j2.id).status, "done", `swap 2 says done with amountOut ${r.jobs.get(j2.id).amountOut}: swap 1's coins`);
});

test("3. a Safe swap 1Click refunds says so soon, not after 10 minutes of 'moving'", async () => {
  const r = rig();
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  // 1Click refunds at once: the USDC is back in the Safe; wNEAR never rises. watchSafe reads only wNEAR.
  r.said.set(r.jobs.get(job.id).depositAddress, { status: "REFUNDED" });
  await r.tick(Math.ceil(60_000 / 400)); // one minute of reads
  assert.ok(r.jobs.get(job.id).status !== "moving" || r.followed.includes(job.id), "a minute after the refund the job is still 'moving' and 1Click's status hasn't been asked (it is asked only after SAFE_WATCH_FOR_MS = " + SAFE_WATCH_FOR_MS / 60000 + " min)");
});

test("4. a NEAR-wallet (private) swap that ends after 10 minutes still ends", async () => {
  let status = "pending";
  const r = rig({ privateStatus: () => status });
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "private" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  await r.tick(Math.ceil(SAFE_WATCH_FOR_MS / 250) + 5); // past watchPrivate's 10 minutes
  status = "done";
  await r.tick(20);
  assert.equal(r.jobs.get(job.id).status, "done", "watchPrivate gave up at 10 min with no fallback: the job is 'moving' forever (and a reload never follows it: the ledger's resume needs m.depositAddress, ledger.ts:1915)");
});
