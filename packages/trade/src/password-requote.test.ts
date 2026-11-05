// QA crawl (web, 4 Nov): the first Buy's password sheet (the core asks it at the first signature when nobody
// answered it as Trade opened) held the signature until the quote ran out. Now those bytes are never sent: the same amount
// is quoted again silently and signed, then sent; a price that fell under the accepted minimum stops it, said, nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createTradeService } from "./service.ts";
import type { ChainEngine, Prepared } from "./types.ts";

function setup(o: { passwordMs: number; minAfter?: string }) {
  let clock = 1_000_000;
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const store = new Map<string, string>();
  let signs = 0;
  const reply: Record<string, (p: any) => BridgeResult<unknown>> = {
    "subwallet.list": () => ({ ok: [{ id: "w1", kind: "trade", chain: "sol", address: "Own1111111111111111111111111111111111111111", label: "Trading · Solana" }] }),
    "device.store.get": (p) => ({ ok: { value: store.get(p.key) ?? null } }),
    "device.store.set": (p) => (store.set(p.key, p.value), { ok: { ok: true } }),
    // the first signature waits on the password sheet for `passwordMs`; after it the session is open (instant)
    "subwallet.signTx": (p) => { if (signs++ === 0) clock += o.passwordMs; return { ok: { signedTx: `signed:${p.tx}` } }; },
  };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}) { calls.push({ method, p }); return reply[method]!(p) as BridgeResult<T>; },
    on: () => () => {},
  };
  let n = 0;
  const sent: string[] = [];
  const engine: ChainEngine = {
    chain: "sol", owner: "Own1111111111111111111111111111111111111111",
    async prepare(side, coin) {
      n++;
      const min = n > 1 && o.minAfter ? o.minAfter : "290000000";
      return { key: `k${n}`, at: clock, ready: async () => {}, steps: [{ id: "s0", tx: `tx${n}`, lastValidBlockHeight: 1 }],
        quote: { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "10000000", payUsd: 1, getRaw: "300000000", getUsd: 1, getMinRaw: min, feeRaw: "5000", feeUsd: 0.001, route: "PumpSwap", slippageBps: 300, expiresAt: clock + 20_000 } } satisfies Prepared;
    },
    txHash: (tx) => `hash:${tx}`,
    async send(tx) { sent.push(tx); return `hash:${tx}`; },
    async status() { return "confirmed"; },
    async fill(p, hash) { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "5000" }; },
    async holdings() { return { native: "10000000000", coins: [] }; },
    poolChanged() {},
  };
  const svc = createTradeService({ bridge, chains: ["sol"], nativeUsd: async () => 100, engineFor: () => engine, sleep: async () => {}, now: () => clock });
  const buy = async () => svc.trade(await svc.quote("buy", "sol", "DOPEmint", { usd: 1 }));
  return { buy, sent, signs: () => calls.filter((c) => c.method === "subwallet.signTx").map((c) => c.p.tx), quotes: () => n };
}

test("a password that took longer than the quote's life: quoted again silently, signed, and the fresh bytes sent (never the stale ones)", async () => {
  const s = setup({ passwordMs: 45_000 });
  const rec = await s.buy();
  assert.equal(rec.status, "done");
  assert.equal(s.quotes(), 2, "one fresh quote after the password");
  assert.deepEqual(s.signs(), ["tx1", "tx2"], "the fresh quote's bytes signed (the session open: no sheet)");
  assert.deepEqual(s.sent, ["signed:tx2"], "the stale signature is never sent");
  assert.equal(rec.quote?.getMinRaw, "290000000");
});

test("control: a signature inside the quote's life sends at once, no second quote", async () => {
  const s = setup({ passwordMs: 300 });
  assert.equal((await s.buy()).status, "done");
  assert.equal(s.quotes(), 1);
  assert.deepEqual(s.sent, ["signed:tx1"]);
});

test("the fresh quote's floor under the minimum the person accepted: the price moved, said; nothing sent", async () => {
  const s = setup({ passwordMs: 45_000, minAfter: "200000000" });
  await assert.rejects(s.buy(), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.price.moved");
  assert.deepEqual(s.sent, []);
});
