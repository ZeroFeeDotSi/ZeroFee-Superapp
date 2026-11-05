// Decision H (4 Nov): on Jupiter routes, a quote its own price checks flag (no independent price, over 15 %
// impact, a floor over 5 %) never signs silently: Trade passes the reason as `ask` and the core shows its one-tap sheet.
// Direct curve routes (pump.fun, PumpSwap, Raydium) stay silent at their pool's floor, and a clean Jupiter quote too.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createTradeService } from "./service.ts";
import type { ChainEngine, Prepared } from "./types.ts";

function setup(route: string, slippageBps: number, extra: Record<string, unknown> = {}) {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const store = new Map<string, string>();
  const reply: Record<string, (p: any) => BridgeResult<unknown>> = {
    "subwallet.list": () => ({ ok: [{ id: "w1", kind: "trade", chain: "sol", address: "Own1111111111111111111111111111111111111111", label: "Trading · Solana" }] }),
    "device.store.get": (p) => ({ ok: { value: store.get(p.key) ?? null } }),
    "device.store.set": (p) => (store.set(p.key, p.value), { ok: { ok: true } }),
    "subwallet.signTx": (p) => ({ ok: { signedTx: `signed:${p.tx}` } }),
    "subwallet.session.start": (p) => ({ ok: { endsAtIso: new Date(Date.now() + 15 * 60_000).toISOString(), ...(p.firstTx ? { signedTx: `signed:${p.firstTx}` } : {}) } }),
  };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}) { calls.push({ method, p }); return reply[method]!(p) as BridgeResult<T>; },
    on: () => () => {},
  };
  let n = 0;
  const engine: ChainEngine = {
    chain: "sol", owner: "Own1111111111111111111111111111111111111111",
    async prepare(side, coin) {
      n++;
      const p: Prepared = {
        key: `k${n}`, at: 0, ready: async () => {},
        steps: [{ id: "s0", tx: `tx${n}.0`, lastValidBlockHeight: 1 }],
        quote: { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "10000000", payUsd: 1, getRaw: "300000000", getUsd: 1, getMinRaw: "290000000", feeRaw: "5000", feeUsd: 0.001, route, slippageBps, expiresAt: Date.now() + 60_000, ...extra } as Prepared["quote"],
      };
      return p;
    },
    txHash: (tx) => `hash:${tx}`,
    async send(tx) { return `hash:${tx}`; },
    async status() { return "confirmed"; },
    async fill(p, hash) { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "5000" }; },
    async holdings() { return { native: "10000000000", coins: [] }; },
    poolChanged() {},
  };
  const svc = createTradeService({ bridge, chains: ["sol"], nativeUsd: async () => 100, engineFor: () => engine, sleep: async () => {} });
  const buy = async () => { const p = await svc.quote("buy", "sol", "DOPEmint", { usd: 1 }); return svc.trade(p); };
  const asked = (m: string) => calls.filter((c) => c.method === m);
  return { buy, asked };
}

test("decision H: a Jupiter quote its price checks flag asks on the core's sheet (ask passed, never riding a silent session start)", async () => {
  for (const [why, bps, extra] of [["unpriced", 300, { needsApproval: "unpriced" }], ["wide-slippage", 900, {}], ["high-impact", 300, { priceImpactPct: 20 }]] as const) {
    const { buy, asked } = setup("Jupiter", bps, extra);
    assert.equal((await buy()).status, "done");
    const firsts = asked("subwallet.session.start").filter((c) => c.p.firstTx);
    assert.equal(firsts.length, 0, `${why}: never signed on the session's start`);
    const signs = asked("subwallet.signTx");
    assert.equal(signs.length, 1, why);
    assert.equal(signs[0]!.p.ask, why, `${why}: the core is told to ask`);
  }
});

test("decision H: a direct pump.fun / PumpSwap buy at its pool's 15 % floor stays silent, and so does a clean Jupiter quote", async () => {
  for (const [route, bps] of [["pump.fun", 1500], ["PumpSwap", 1500], ["Raydium", 900], ["Jupiter", 300]] as const) {
    const { buy, asked } = setup(route, bps);
    assert.equal((await buy()).status, "done");
    for (const c of [...asked("subwallet.signTx"), ...asked("subwallet.session.start")]) assert.equal(c.p.ask, undefined, `${route}: no ask`);
  }
});
