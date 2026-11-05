// TN2 + TN3 on the shell's sample money (?demo's MockBridge and recorded market): a NEAR coin is bought with Spending's
// cash and sold back to it inside Spending, through the core's swap (no wallet of its own, nothing for Trade to sign), the
// quote is 1Click's (named on the sheet only when it fails), the position shows its result in dollars, and every stop says who failed and where the money is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { forApps } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { SAMPLE_OPENING, resetSampleWallets } from "../demo-engine.ts";
import { createTradeRuntime } from "../runtime.ts";
import { createNearEngine, NEAR_USDC } from "./engine.ts";

const QTC = "qtc.omft.near";
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function demo(o: { swapMs?: number; outcome?: "done" | "failed" | "refunded" } = {}) {
  resetSampleWallets();
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10, swapMs: o.swapMs ?? 30, ...(o.outcome ? { outcome: o.outcome } : {}) } });
  const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade");
  const rt = createTradeRuntime(bridge);
  await rt.float.add(20); await settle(); await rt.float.refresh();
  return { rt, mock, bridge };
}

// product decision, 5 Nov (protocol-only): a NEAR coin is bought only on Rhea, never through 1Click's layer. The runtime refuses a coin
// Rhea doesn't trade; the 1Click engine stays only for the sale of a coin an older build bought inside Spending (D96).
const oneClickOf = (rt: Awaited<ReturnType<typeof demo>>["rt"], bridge: Awaited<ReturnType<typeof demo>>["bridge"]) => createNearEngine({
  owner: "", meta: (c) => rt.market.meta("near", c),
  call: async <T,>(m: string, p: Record<string, unknown>): Promise<T> => { const r = await bridge.call<T>(m, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; },
});

test("a NEAR coin Rhea doesn't trade is never bought through 1Click: refused by name, Spending's cash untouched (control: 1Click's engine alone still prices it)", async () => {
  const { rt, bridge } = await demo();
  await assert.rejects(rt.svc.quote("buy", "near", QTC, { usd: 5 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.rhea-no-pool" && /Rhea/.test(e.problem.whatHappened) && !/1Click/.test(e.problem.whatHappened));
  assert.equal(await rt.svc.held("near", QTC), "0");
  assert.equal(rt.float.snapshot().reserveUsd, 20, "nothing left Spending");
  const p = await oneClickOf(rt, bridge).prepare("buy", QTC, { usd: 5 });
  assert.deepEqual([p.quote.route, p.quote.symbol, p.quote.payRaw], ["1Click", "QTC", "5000000"], "control: the refusal is the route's, not a dead 1Click");
});

test("an older build's coin in Spending still sells back the way it came; a sale of a coin nobody holds says so", async () => {
  const { rt, bridge } = await demo();
  const e = oneClickOf(rt, bridge);
  const r = await e.settle!(await e.prepare("buy", QTC, { usd: 5 }), "swap-key-000000001");
  assert.ok(!("declined" in r));
  const sale = await rt.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(sale.quote.route, "1Click", "Spending holds it; the NEAR coin wallet doesn't");
  await assert.rejects(rt.svc.quote("buy", "near", QTC, { usd: 50 }), (x: unknown) => x instanceof ProblemError && x.problem.code === "trade.near.rhea-no-pool");
  const { rt: empty } = await demo();
  await assert.rejects(empty.svc.quote("sell", "near", QTC, { fraction: 1 }), (x: unknown) => x instanceof ProblemError && x.problem.code === "trade.near.not-held");
});

test("a coin 1Click doesn't trade says Rhea by name; 1Click not answering says 1Click; each keeps the money in Spending", async () => {
  const calls: string[] = [];
  const down = { code: "security.partner.unreachable", whatHappened: "We can't reach 1Click to check this payment, so we stopped.", money: { state: "safe", where: "in Trading" }, next: { kind: "retry", label: "Try again" } } as const;
  const call = async <T,>(m: string): Promise<T> => {
    calls.push(m);
    if (m === "subwallet.float.balance") return { tokens: [{ tokenId: NEAR_USDC, amount: "20000000" }] } as T;
    throw new ProblemError(down);
  };
  const rhea = createNearEngine({ owner: "f".repeat(64), call, meta: async () => ({ symbol: "NEARLY", pools: [{ address: "refv1-1", dex: "rhea-finance" }] }) });
  await assert.rejects(rhea.prepare("buy", "nearly-993927.nearlytrade.near", { usd: 2 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.rhea-only" && /Rhea/.test(e.problem.whatHappened) && e.problem.money.state === "safe");
  const both = createNearEngine({ owner: "f".repeat(64), call, meta: async () => ({ symbol: "QTC", pools: [{ address: "refv2-x", dex: "rhea-finance" }, { address: "nep141:a___nep141:b", dex: "near-intents" }] }) });
  await assert.rejects(both.prepare("buy", QTC, { usd: 2 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.oneclick-down" && /NEAR Intents/.test(e.problem.whatHappened) && e.problem.money.state === "safe");
});

test("1Click refunds: nothing bought, said with the money back in Spending (1Click's engine, kept for older coins' sales)", async () => {
  const r = await demo({ outcome: "refunded" });
  const e = oneClickOf(r.rt, r.bridge);
  await assert.rejects(e.settle!(await e.prepare("buy", QTC, { usd: 5 }), "swap-key-000000001"), (x: unknown) => x instanceof ProblemError && x.problem.code === "trade.near.refunded" && /back in your NEAR wallet/.test(x.problem.money.state === "safe" ? x.problem.money.where : ""));
  assert.equal(await r.rt.svc.held("near", QTC), "0");
});

test("1Click still finishing past the wait: 'unconfirmed', followed again by the core's move id on the next open, never traded twice", async () => {
  let status: "pending" | "done" = "pending";
  const move = () => ({ id: "fm-1", kind: "swap", status, sent: { tokenId: NEAR_USDC, amount: "5000000" }, expected: { tokenId: `nep141:${QTC}`, amount: "70000000000" }, ...(status === "done" ? { settled: { amountOut: "71000000000" } } : {}) });
  let t = 0, swaps = 0;
  const e = createNearEngine({
    owner: "f".repeat(64), now: () => t, sleep: async (ms) => { t += ms; },
    call: async <T,>(m: string): Promise<T> => (m === "subwallet.float.swap" ? (swaps++, move()) : move()) as T,
  });
  const p = { key: "k", at: 0, steps: [], ready: async () => {}, quote: { side: "buy", chain: "near", coin: QTC, symbol: "QTC", decimals: 12, payRaw: "5000000", payUsd: 5, getRaw: "71000000000", getUsd: 4.98, getMinRaw: "70000000000", feeRaw: "0", feeUsd: 0.02, route: "1Click", slippageBps: 100, expiresAt: 1e15 } } as const;
  let seen = "";
  await assert.rejects(e.settle!(p as never, "swap-key-000000001", (id) => (seen = id)), (x: unknown) => x instanceof ProblemError && x.problem.code === "trade.near.slow" && x.problem.money.state === "on-the-way");
  assert.equal(seen, "fm-1");
  assert.equal(await e.followMove!("fm-1", "QTC"), "pending");
  status = "done";
  const f = await e.followMove!("fm-1", "QTC");
  assert.ok(typeof f === "object" && "fill" in f && f.fill.got === "71000000000");
  assert.equal(swaps, 1);
});
