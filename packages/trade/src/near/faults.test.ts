// TN5's fault suite, the part that runs in every test pass: GeckoTerminal answering 429, Rhea down, 1Click 521. Each
// leaves Trade with its last answer or one plain line that names who failed and keeps the money line; nothing moves.
// (The screens themselves, painted under each fault, are the walk's: $ZEROFEE_HOME/screens/tn-near-trading.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { forApps } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createMarket, MarketError } from "../market/index.ts";
import { withFault } from "../market/recorded.ts";
import { fx, replay } from "../market/testing.ts";
import { tradeProblems } from "../trade-problems.ts";
import { SAMPLE_OPENING, resetSampleWallets } from "../demo-engine.ts";
import { createTradeRuntime } from "../runtime.ts";

const routes = (): [string, unknown][] => [["networks/near/trending_pools", fx("trending-near")], ["networks/near/tokens/qtc.omft.near?", fx("token-near")]];

test("GeckoTerminal 429: the list served before stays, marked; with none, the one line names GeckoTerminal and says Try again", async () => {
  const r = replay(routes());
  let down = false;
  const f = (async (u: RequestInfo | URL, i?: RequestInit) => (down ? withFault(r.fetch, "gt429")(u, i) : r.fetch(u, i))) as typeof fetch;
  const m = createMarket({ fetch: f, now: r.now, screenWaitMs: 0, storage: null });
  const before = await m.trending("near");
  down = true; r.clock.t += 10 * 60_000;
  const after = await m.trending("near");
  assert.deepEqual(after.map((x) => x.address), before.map((x) => x.address), "the last list, never a blank");
  assert.ok((after as { asOf?: number }).asOf);
  const cold = createMarket({ fetch: withFault(r.fetch, "gt429"), now: r.now, screenWaitMs: 0, storage: null });
  await assert.rejects(cold.trending("near"), (e: unknown) => e instanceof MarketError);
  const busy = tradeProblems.marketBusy();
  assert.match(busy.whatHappened, /GeckoTerminal/);
  assert.equal(busy.next.kind, "retry");
});

test("Rhea down: its pools gone, a coin only on Rhea leaves the NEAR list, the rest stay on NEAR Intents' pools", async () => {
  const r = replay(routes());
  const m = createMarket({ fetch: withFault(r.fetch, "rhea"), now: r.now, screenWaitMs: 0, storage: null });
  const rows = await m.trending("near");
  const syms = rows.map((x) => x.symbol);
  assert.ok(syms.includes("QTC") && syms.includes("ZEC"), syms.join());
  assert.ok(!syms.includes("NEARLY"), "NEARLY trades only on Rhea");
  const d = await m.coin("near", "qtc.omft.near");
  assert.ok(d.pools!.length > 0 && d.pools!.every((p) => p.dex !== "rhea-finance"));
});

test("1Click 521: a NEAR coin's sale from Spending says 1Click isn't answering, the money is in Spending; nothing moved", async () => {
  resetSampleWallets();
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10, nearCoin: () => undefined } });
  const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade");
  const rt = createTradeRuntime(bridge);
  await rt.float.add(20); await new Promise((r) => setTimeout(r, 40)); await rt.float.refresh();
  // product decision, 5 Nov: a NEAR coin is never BOUGHT through 1Click (Rhea's refusal, named); 1Click's own fault is its engine's
  await assert.rejects(rt.svc.quote("buy", "near", "qtc.omft.near", { usd: 2 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.rhea-no-pool" && e.problem.money.state === "safe");
  const { createNearEngine } = await import("../near/engine.ts");
  const call = async <T,>(m: string, p: Record<string, unknown>): Promise<T> => { const r = await bridge.call<T>(m, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const oneClick = createNearEngine({ owner: "", call, meta: (c) => rt.market.meta("near", c) });
  await assert.rejects(oneClick.prepare("buy", "qtc.omft.near", { usd: 2 }), (e: unknown) => e instanceof ProblemError && /NEAR Intents/.test(e.problem.whatHappened) && e.problem.money.state === "safe" && e.problem.next.kind === "retry");
  assert.equal(await rt.svc.held("near", "qtc.omft.near"), "0");
  assert.equal(rt.float.snapshot().reserveUsd, 20, "Trading's cash as it was");
});
