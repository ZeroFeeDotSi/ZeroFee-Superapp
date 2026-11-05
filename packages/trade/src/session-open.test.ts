// Product decision, 4 Nov The Trade session starts when Trade
// opens (svc.open(), runtime.tsx), never at the tap: the tap only signs (signTx) and sends. D143: neither asks on the phone
// (no sheet, no Face ID); in a browser the one password per unlock is asked at Trade's open, never on a trade's tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createTradeService } from "./service.ts";
import type { ChainEngine, Prepared } from "./types.ts";

type Mode = "ok" | "refused" | "no";
function setup(mode: Mode, steps = 1) {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const store = new Map<string, string>();
  const reply: Record<string, (p: any) => BridgeResult<unknown>> = {
    "subwallet.list": () => ({ ok: [{ id: "w1", kind: "trade", chain: "sol", address: "Own1111111111111111111111111111111111111111", label: "Trading · Solana" }] }),
    "device.store.get": (p) => ({ ok: { value: store.get(p.key) ?? null } }),
    "device.store.set": (p) => (store.set(p.key, p.value), { ok: { ok: true } }),
    "subwallet.signTx": (p) => ({ ok: { signedTx: `signed:${p.tx}` } }),
    "subwallet.session.start": (p) => {
      const ends = { endsAtIso: new Date(Date.now() + 15 * 60_000).toISOString() };
      if (mode === "no") return { ok: { declined: true } };
      if (mode === "refused") return { problem: { code: "security.web.trade-declined", whatHappened: "You didn't turn on trading here.", money: { state: "safe", where: "in your trading wallet" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<unknown>;
      return { ok: ends };
    },
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
        steps: Array.from({ length: steps }, (_, i) => ({ id: `s${i}`, tx: `tx${n}.${i}`, lastValidBlockHeight: 1 })),
        quote: { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "10000000", payUsd: 1, getRaw: "300000000", getUsd: 1, getMinRaw: "290000000", feeRaw: "5000", feeUsd: 0.001, route: "PumpSwap", slippageBps: 300, expiresAt: Date.now() + 60_000 },
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
  const sell = async () => { const p = await svc.quote("sell", "sol", "DOPEmint", { fraction: 1 }); return svc.trade(p); };
  const asked = (m: string) => calls.filter((c) => c.method === m);
  return { svc, buy, sell, asked };
}

test("the tap never starts the session: a buy and a sale each go with one signTx and no session.start (control: Trade's open starts it, once)", async () => {
  const { svc, buy, sell, asked } = setup("ok");
  assert.equal((await buy()).status, "done");
  assert.equal((await sell()).status, "done");
  assert.equal(asked("subwallet.session.start").length, 0, "no session at the tap");
  assert.equal(asked("subwallet.signTx").length, 2, "one signature a trade, nothing else");
  // control: Trade on screen starts it; while it is live, opening again and trading ask nothing more
  await svc.open();
  assert.equal(asked("subwallet.session.start").length, 1);
  assert.ok(!("firstTx" in asked("subwallet.session.start")[0]!.p), "no trade rides on the start");
  assert.ok(await svc.sessionEndsAt("sol"));
  await svc.open();
  assert.equal((await buy()).status, "done");
  assert.equal(asked("subwallet.session.start").length, 1);
});

test("two opens at once ask the core once", async () => {
  const { svc, asked } = setup("ok");
  await Promise.all([svc.open(), svc.open(), svc.open()]);
  assert.equal(asked("subwallet.session.start").length, 1);
});

test("a start the core refuses (a browser's password said no) or answers with no end keeps nothing: the trade still signs on its own at the tap, and the next open asks again", async () => {
  for (const mode of ["refused", "no"] as const) {
    const { svc, buy, asked } = setup(mode);
    await svc.open();
    assert.equal(await svc.sessionEndsAt("sol"), undefined, mode);
    assert.equal((await buy()).status, "done", `${mode}: the core's checks are the gate, not the session`);
    assert.equal(asked("subwallet.session.start").length, 1, `${mode}: the tap asks no start`);
    await svc.open();
    assert.equal(asked("subwallet.session.start").length, 2, `${mode}: the next open asks again`);
  }
});
