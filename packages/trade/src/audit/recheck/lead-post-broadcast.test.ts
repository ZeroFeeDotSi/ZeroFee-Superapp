// RECHECK (fix review, e72eddd) of the problemOf lead (c965e8d). Harness copied from audit-slots.test.ts.
// Each test asserts the CORRECT behaviour, so it FAILS on the audited commit and passes once the finding is fixed.
// fakeEngine/setup are copied from service.test.ts (test code only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "../../service.ts";
import type { Amount, ChainEngine, Fill, Prepared, Side, TxStatus } from "../../types.ts";

const SOL_USD = 100;
/** requoteGet / requoteMin: the automatic re-quote's expected amount and floor; laterMin: the floor of every quote after the first. */
interface Script { statuses?: TxStatus[]; fill?: Partial<Fill>; prepareError?: unknown; requoteGet?: string; requoteMin?: string; laterMin?: string }
function fakeEngine(s: Script = {}, clock = { t: 1_700_000_000_000 }) {
  const sent: string[] = [], prepared: { side: Side; amount: Amount; attempt?: number }[] = [];
  let n = 0, statusCalls = 0;
  const e: ChainEngine & { sent: string[]; prepared: typeof prepared; storeAtFirstSend?: string | null } = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM", sent, prepared,
    async prepare(side, coin, amount, opts) {
      prepared.push({ side, amount, attempt: opts?.attempt });
      if (s.prepareError) throw s.prepareError;
      const again = (opts?.attempt ?? 0) > 0 && s.requoteGet;
      const p: Prepared = {
        key: `k${++n}`, at: 0, ready: async () => {},
        steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: side === "buy" ? "100000000" : "50000000", payUsd: 10, getRaw: again || (side === "buy" ? "100000000" : "70000000"), getUsd: 10, getMinRaw: ((opts?.attempt ?? 0) > 0 && s.requoteMin) || (n > 1 && s.laterMin) || (side === "buy" ? "97000000" : "67900000"), feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sent.push(tx); return `hash-${atob(tx)}`; },
    async status() { return s.statuses?.[statusCalls++] ?? "confirmed"; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "10000", ...s.fill }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    async transfer(to, raw) { return { key: "t", at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa(`transfer-${to}-${raw}`), lastValidBlockHeight: 1000 }], quote: { side: "sell", chain: "sol", coin: "SOL", symbol: "SOL", decimals: 9, payRaw: "500000000", payUsd: 0, getRaw: "500000000", getUsd: 0, getMinRaw: "500000000", feeRaw: "5000", feeUsd: 0, route: "Transfer", slippageBps: 0, expiresAt: clock.t + 60_000 } }; },
    poolChanged() {},
  };
  return e;
}
function setupFailingDoneSave() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  let failDone = true;
  // the device store refuses the write that would record the trade as done (storage full, the bridge dropped it)
  const spy = { call: (m: string, p?: Record<string, unknown>) => (failDone && m === "device.store.set" && typeof p?.value === "string" && p.key === "activity" && p.value.includes('"status":"done"') ? (failDone = false, Promise.resolve({ problem: { code: "device.store.full", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } })) : mock.call(m, p)), on: mock.on };
  const bridge = forApps(spy as typeof mock, "trade");
  const clock = { t: 1_700_000_000_000 };
  const engine = fakeEngine({}, clock);
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => SOL_USD, meta: async () => ({ symbol: "BONK" }), chains: ["sol", "hood", "bsc"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  return { svc };
}

// Variant: the trade landed and its fill was booked; only the save that records "done" fails. The catch sees status "done"
// (not "sending"/"confirming"), so the new rule doesn't apply and problemOf books it "failed" with a "money safe" words.
test("lead variant: a trade that landed is never recorded failed because the device store refused one write", async () => {
  const { svc } = setupFailingDoneSave();
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  const rec = await svc.trade(p).catch(() => undefined);
  const after = (await svc.activity()).find((r) => r.kind === "buy");
  assert.notEqual(after?.status, "failed", `a confirmed buy reads "${after?.status}": ${after?.problem?.whatHappened ?? ""}`);
  void rec;
});
