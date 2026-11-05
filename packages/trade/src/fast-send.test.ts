// Speed (the test real-money run, 3 Nov): the tap's wait follows the chain from the moment the bytes leave, never the
// nodes' answers to the send; and a Solana quote, once proven, asks the core to check its exact bytes ahead of the tap.
// The service's clock moves only when it waits, so every timing here is exact (no wall clock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Bridge } from "@zerofee/shell-api";
import { createTradeService } from "./service.ts";
import type { ChainEngine, Fill, Prepared, TxStatus } from "./types.ts";

function setup(o: { send?: (tx: string) => Promise<string>; landed?: boolean; freshSlot?: number } = {}) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const sends: string[] = [], calls: { method: string; p: Record<string, unknown> }[] = [];
  const ctl = { verdict: (_hash: string): TxStatus => "pending" };
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const p: Prepared = {
        key: `k${++n}`, at: 0, ready: async () => {},
        steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: "100000000", payUsd: 10, getRaw: "100000000", getUsd: 10, getMinRaw: "97000000", feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sends.push(tx); return o.send ? o.send(tx) : `hash-${atob(tx)}`; },
    async status(hash) { return ctl.verdict(hash); },
    ...(o.landed === false ? {} : { async landed() { return "landed" as const; } }),
    ...(o.freshSlot === undefined ? {} : { freshSlot: () => o.freshSlot }),
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: "99000000", spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const bridge: Bridge = { ...inner, call: (method: string, p?: unknown) => (calls.push({ method, p: (p ?? {}) as Record<string, unknown> }), inner.call(method, p as never)) } as Bridge;
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const buy = async () => svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  return { svc, ctl, buy, sends, calls };
}

test("the last send isn't waited for: sent the moment the bytes leave, and the trade lands while the nodes haven't answered (control: their answer came later)", async () => {
  let answer!: (h: string) => void;
  let hold = false;
  const x = setup({ send: (tx) => (hold ? new Promise<string>((r) => (answer = r)) : Promise.resolve(`hash-${atob(tx)}`)) });
  x.ctl.verdict = () => "confirmed";
  await x.buy();                                // the first trade opens the session
  await x.svc.checked();
  x.ctl.verdict = () => "pending";
  hold = true;
  const rec = await x.buy();
  assert.equal(rec.status, "done", "landed on the chain's word with the send still unanswered");
  assert.equal(rec.timing!.sentAt, rec.timing!.signedAt, "no wait between signed and sent");
  assert.ok(answer, "control: the send was made and its answer is still pending");
  answer("hash-late");
});

test("a send every node refuses still ends as the chain says, never as 'nothing moved' while it could land", async () => {
  const x = setup({ send: async () => { throw new Error("every node said no"); }, landed: false });
  x.ctl.verdict = () => "failed";
  const rec = await x.buy().catch((e: unknown) => e);
  assert.ok(x.sends.length >= 1, "the bytes went out");
  const status = (rec as { status?: string }).status;
  assert.notEqual(status, "done", "a trade the chain says failed is never done");
});

test("a Solana quote, once proven, asks the core to check its exact bytes once (control: asking twice asks once)", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  await p.ready();
  await p.ready();
  await new Promise((r) => setImmediate(r));
  const asked = x.calls.filter((c) => c.method === "subwallet.preflight");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.p.tx, p.steps[0]!.tx, "the very bytes Trade will sign");
});

test("ready() waits for the core's check of the bytes, so the tap only signs (control: one that never answers holds it only PREFLIGHT_WAIT_MS)", async () => {
  // the core's preflight answers only when told to; the service's own sleep is held too, so nothing moves by the clock
  let answer!: () => void, wake!: () => void;
  const slept: number[] = [];
  const engine = { chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM", async prepare(side: "buy" | "sell", coin: string) {
    return { key: "k", at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa("unsigned-1"), lastValidBlockHeight: 1000 }],
      quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: "1", payUsd: 10, getRaw: "1", getUsd: 10, getMinRaw: "1", feeRaw: "1", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: Date.now() + 20_000 } } as Prepared;
  }, txHash: (tx: string) => tx, async send(tx: string) { return tx; }, async status() { return "pending" as TxStatus; }, async fill(): Promise<Fill> { throw new Error("no"); }, async holdings() { return { native: "1000000000", coins: [] }; }, poolChanged() {} } as unknown as ChainEngine;
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const bridge = { ...inner, call: (method: string, p?: unknown) => (method === "subwallet.preflight" ? new Promise((r) => (answer = () => r({ ok: true }))) : inner.call(method, p as never)) } as Bridge;
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], sleep: (ms) => { slept.push(ms); return ms === 1_500 ? new Promise<void>((r) => (wake = r)) : Promise.resolve(); } });
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  let done = false;
  const r = p.ready().then(() => { done = true; });
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
  assert.equal(done, false, "the button waits while the core checks the bytes");
  assert.ok(slept.includes(1_500), "bounded by PREFLIGHT_WAIT_MS");
  answer();
  await r;
  assert.equal(done, true, "the check answered: ready");
  // control: a check that never answers holds it only until the bound
  const p2 = await svc.quote("sell", "sol", "BONKmint", { max: true });
  let done2 = false;
  const r2 = p2.ready().then(() => { done2 = true; });
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
  assert.equal(done2, false);
  wake();
  await r2;
  assert.equal(done2, true, "never answered: ready after the bound all the same");
});

test("4 Nov: the slot this wallet's last trade landed in goes to the core with the next trade's check and signature (control: none known, none sent)", async () => {
  for (const slot of [465_000_100, undefined]) {
    const x = setup(slot === undefined ? {} : { freshSlot: slot });
    x.ctl.verdict = () => "confirmed";
    await x.buy();                                // the first trade opens the session
    await x.svc.checked();
    await x.buy();
    await new Promise((r) => setImmediate(r));
    const signs = x.calls.filter((c) => c.method === "subwallet.signTx"), checks = x.calls.filter((c) => c.method === "subwallet.preflight");
    assert.ok(signs.length >= 1 && checks.length >= 1);
    for (const c of [...signs, ...checks]) assert.equal(c.p.minSlot, slot, `${c.method}: ${slot ?? "no slot"}`);
  }
});

/** Robinhood Chain (4 Nov): a sale is two steps, an approve then its swap (consecutive nonces). */
function hoodSetup(o: { approveSend?: () => Promise<string> } = {}) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const sends: string[] = [], calls: { method: string; p: Record<string, unknown> }[] = [];
  const COIN = "0x00000000000000000000000000000000000c0141";
  const engine: ChainEngine = {
    chain: "hood", owner: "0x1111111111111111111111111111111111111111",
    async prepare(side, coin) {
      n++;
      const swap = { id: "swap" as const, tx: btoa(`swap-${n}`), nonce: 1 };
      return {
        key: `k${n}`, at: 0, ready: async () => {},
        steps: side === "sell" ? [{ id: "approve" as const, tx: btoa(`approve-${n}`), nonce: 0 }, swap] : [{ ...swap, nonce: 0 }],
        quote: { side, chain: "hood", coin, symbol: "DOPE", decimals: 18, payRaw: "1000", payUsd: 1, getRaw: "1000", getUsd: 1, getMinRaw: "990", feeRaw: "10", feeUsd: 0.001, route: "Uniswap", slippageBps: 100, expiresAt: clock.t + 20_000 },
      } as Prepared;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sends.push(atob(tx)); return atob(tx).startsWith("approve") && o.approveSend ? o.approveSend() : `hash-${atob(tx)}`; },
    async status() { return "confirmed" as TxStatus; },
    async landed() { return "landed" as const; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: "1000", spent: p.quote.payRaw, fee: "10" }; },
    async holdings() { return { native: "1000000000000000000", coins: [{ coin: COIN, raw: "1000" }] }; },
    poolChanged() {},
  } as ChainEngine;
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5, tradeChains: ["sol", "hood"] } as never), "trade");
  const bridge: Bridge = { ...inner, call: (method: string, p?: unknown) => (calls.push({ method, p: (p ?? {}) as Record<string, unknown> }), inner.call(method, p as never)) } as Bridge;
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 3000, meta: async () => ({ symbol: "DOPE", priceUsd: 0.001 }), chains: ["hood"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, sends, calls, COIN };
}

test("a Robinhood Chain sale, once proven, asks the core to check both its steps, the swap after its approve, with the coin (control: a one-step buy has nothing before it)", async () => {
  const x = hoodSetup();
  const p = await x.svc.quote("sell", "hood", x.COIN, { fraction: 1 });
  await p.ready();
  await p.ready();
  const asked = x.calls.filter((c) => c.method === "subwallet.preflight");
  assert.equal(asked.length, 2, "each step once");
  const [ap, sw] = p.steps;
  assert.deepEqual(asked.map((c) => [c.p.tx, c.p.coin, c.p.before]), [[ap!.tx, x.COIN, undefined], [sw!.tx, x.COIN, [ap!.tx]]], "the swap is checked after its approve");
  const b = await x.svc.quote("buy", "hood", x.COIN, { usd: 1 });
  await b.ready();
  const one = x.calls.filter((c) => c.method === "subwallet.preflight").at(-1)!;
  assert.deepEqual([one.p.tx, one.p.coin, one.p.before], [b.steps[0]!.tx, x.COIN, undefined]);
});

test("a Robinhood Chain sale's swap is sent right behind its approve, never waiting for the approve's answer (control: both go, the approve first)", async () => {
  let answer!: (h: string) => void;
  const x = hoodSetup({ approveSend: () => new Promise<string>((r) => (answer = r)) });
  const p = await x.svc.quote("sell", "hood", x.COIN, { fraction: 1 });
  let ended: unknown;
  const done = x.svc.trade(p);
  done.then((r) => (ended = r), (e) => (ended = e));
  for (let i = 0; i < 500 && x.sends.length < 2 && ended === undefined; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(ended, undefined, "still on its way");
  assert.deepEqual(x.sends.slice(0, 2), ["approve-1", "swap-1"], "the swap went with the approve's answer still pending");
  answer("hash-approve-1");
  const rec = await done;
  assert.equal(rec.status, "done");
});
