// The service with a NEAR coin's Rhea trade: done and timed on the first node's executed answer ("Landed in …"), booked
// only when another node's FINAL answer agrees; one that says it didn't happen turns it to failed with nothing booked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, landedMs } from "../service.ts";
import type { ChainEngine, Fill, Prepared } from "../types.ts";

function setup(answer: boolean | undefined) {
  let release!: (v: boolean | undefined) => void;
  const verify = new Promise<boolean | undefined>((r) => (release = r));
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string) {
      return { key: "rhea|k", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: "250000000000000000000000", payUsd: 1, getRaw: "1000000000000000000000000", getUsd: 1, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: "Rhea", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const fill: Fill = { txHash: "h1", got: "990000000000000000000000", spent: "250000000000000000000000", fee: "0" };
      return { fill, timing: { signedAt: clock.t + 5, sentAt: clock.t + 5, landedAt: clock.t + 1_100 }, verify };
    },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, release: () => release(answer) };
}

for (const [answer, words] of [[true, "booked on the second node's word"], [false, "turned: that node says it didn't happen, nothing booked"]] as const) {
  test(`a Rhea trade is done and timed on the first node's executed answer; ${words}`, async () => {
    const x = setup(answer);
    const rec = await x.svc.trade(await x.svc.quote("buy", "near", "blackdragon.tkn.near", { usd: 1 }));
    assert.equal(rec.status, "done");
    assert.equal(rec.verifying, true);
    assert.equal(landedMs(rec), 1_100, "tap to landed, the chain's own wait");
    assert.equal((await x.svc.positions()).length, 0, "nothing booked before the second node");
    x.release();
    await x.svc.checked();
    const after = (await x.svc.activity()).find((r) => r.id === rec.id)!;
    if (answer) {
      assert.equal(after.status, "done");
      assert.equal(after.verifying, undefined);
      assert.equal((await x.svc.positions())[0]?.raw, "990000000000000000000000");
    } else {
      assert.equal(after.status, "failed");
      assert.equal((await x.svc.positions()).length, 0);
    }
  });
}

test("re-review M: a Rhea trade NEAR hasn't decided stays 'unconfirmed', never failed or refunded (control: a refund is failed)", async () => {
  const { ProblemError } = await import("@zerofee/core/problem");
  const { nearProblems } = await import("./problems.ts");
  for (const [problem, want] of [[nearProblems.rheaPending("RHEA"), "unconfirmed"], [nearProblems.rheaRefunded("RHEA"), "failed"]] as const) {
    const engine = {
      chain: "near", owner: "",
      async prepare(side: "buy" | "sell", coin: string) {
        return { key: "rhea|k", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "RHEA", decimals: 18, payRaw: "1", payUsd: 1, getRaw: "1", getUsd: 1, getMinRaw: "1", feeRaw: "0", feeUsd: 0, route: "Rhea", slippageBps: 300, expiresAt: Date.now() + 20_000 } } as Prepared;
      },
      async settle() { throw new ProblemError(problem); },
      async holdings() { return { native: "0", coins: [] }; },
      txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
    } as unknown as ChainEngine;
    const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "RHEA" }), chains: ["near"] });
    await svc.trade(await svc.quote("buy", "near", "token.rhealab.near", { usd: 1 })).catch(() => undefined);
    assert.equal((await svc.activity())[0]!.status, want, problem.code);
  }
});
