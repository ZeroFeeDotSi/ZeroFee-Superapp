// AUDIT FIX REVIEW (main e72eddd): variants that attack the AUD-TRD-1 fix (wallets by slot). Assert the CORRECT behaviour.
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
function setup(o: { script?: Script; decline?: boolean; price?: number; holdSeconds?: number; sessionUsd?: () => Promise<number>; noPair?: boolean } = {}) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, decline: o.decline, holdSeconds: o.holdSeconds });
  const calls: { method: string; params: any }[] = [];
  const heard = new Map<string, ((p: any) => void)[]>();                       // so a test can play an event the real ledger sends
  const on = ((e: string, h: (p: any) => void) => { heard.set(e, [...(heard.get(e) ?? []), h]); return mock.on(e, h); }) as typeof mock.on;
  // noPair: a core that doesn't sign the first trade with the session (firstTx never reaches it), so the trade signs on its own
  const strip = (m: string, p?: Record<string, unknown>) => { if (!o.noPair || m !== "subwallet.session.start" || !p) return p; const { firstTx: _f, coin: _c, ...rest } = p; return rest; };
  const spy = { call: (m: string, p?: Record<string, unknown>) => { calls.push({ method: m, params: p }); return mock.call(m, strip(m, p)); }, on };
  const bridge = forApps(spy as typeof mock, "trade");
  const clock = { t: 1_700_000_000_000 };
  const engine = fakeEngine(o.script, clock);
  // time moves only when the service waits, so the confirm loop's timings are exact
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => SOL_USD, ...(o.sessionUsd ? { sessionUsd: o.sessionUsd } : {}), meta: async () => ({ symbol: "BONK", priceUsd: o.price }), chains: ["sol", "hood", "bsc"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  const stored = async (key: string) => { const r = await bridge.call<{ value: string | null }>("device.store.get", { key }); return "ok" in r ? r.ok.value : null; };
  const play = (e: string, p: unknown) => heard.get(e)?.forEach((h) => h(p));
  return { svc, engine, calls, stored, mock, clock, play };
}


// ---- RM-3 (new, from the AUD-TRD-1 fix): positions are still one per chain and coin, but each trade's fill reports the
// SIGNING wallet's own balance after it (fill.coinAfter), and service.applyFill lets that figure replace the position
// ("the chain's own figure wins"). After a rotation the same coin can sit in two wallets: a buy on the new active wallet
// sets the position to that wallet's balance alone, so the coins in the retired wallet drop out of Positions, the Trading
// total, and coinsByWallet (so no gas top-up for them either).
// D55: no rotation any more, but the same two wallets happen after Get new words: the old words' wallet (now an older
// one) still holds the coin, and the new words' wallet is the current one that buys.
test("RM-3: a coin held in two wallets (an older one and the current one, after new words) stays fully in Positions", async () => {
  const { svc, mock, engine } = setup();
  const fill = engine.fill;
  engine.fill = async (p, h) => ({ ...(await fill(p, h)), coinAfter: "100000000" }); // wallet 1 holds 100,000,000 after its buy
  assert.equal((await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }))).status, "done");
  const bridge = forApps(mock, "trade");
  assert.ok("ok" in (await bridge.call("subwallet.create", { kind: "trade", chain: "sol", slot: 1 })));
  // as the core marks them after new words: slot 0 older, slot 1 (the new words' index 0 here) current
  const listed = await mock.call<{ id: string; current?: boolean }[]>("subwallet.list", {});
  assert.ok("ok" in listed);
  for (const w of listed.ok) if (w.id === "sw-trade-sol") w.current = false; else if (w.id === "sw-trade-sol-1") w.current = true;
  engine.fill = async (p, h) => ({ ...(await fill(p, h)), coinAfter: "100000000" }); // the new wallet's own balance after ITS buy
  assert.equal((await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }))).status, "done");
  const [pos] = await svc.positions();
  assert.equal(pos?.raw, "200000000", `the two wallets hold 200,000,000 between them; Positions says ${pos?.raw}`);
});
