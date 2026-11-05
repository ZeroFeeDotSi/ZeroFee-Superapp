// A site's top-up Private already covers (QA, 5 Nov: one exit): spending.topUp hands the engine the dollars
// alone (USDC from Private, no Safe coin, no fill), so a Safe with no coin of its own never refuses it. Controls: Private
// short still needs the Safe's coin (the fill pays from it), and an engine that doesn't pay from Private is as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpendingService, type SpendingEngine } from "./spending.ts";

function setup(o: { privateUsdc: string; fromPrivate?: boolean }) {
  const added: unknown[][] = [];
  const asked: string[] = [];
  const engine = {
    fromPrivate: o.fromPrivate ?? true,
    snapshot: () => ({ loaded: true, totalUsd: 0, takeableUsd: 0, reserveUsd: 0, chains: [], split: {}, moves: [], movesLeftToday: 5 }),
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    setCap: () => undefined,
    add: async (...a: unknown[]) => (added.push(a), { id: "mv-site", kind: "add", usd: a[0], status: "moving", where: "in-flight", at: 1 }),
  } as unknown as SpendingEngine;
  const answers: Record<string, unknown> = {
    "account.state": { account: { network: "mainnet" } },
    "account.protection.get": {},
    "ledger.balances": [],
    "ledger.private": { available: true, ready: true, rows: [{ symbol: "USDC", amount: o.privateUsdc }] },
    "subwallet.list": [{ id: "sw-site-pump", kind: "site", chain: "sol", site: "pump", address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" }],
    "device.store.get": { value: null },
  };
  const svc = createSpendingService({ engine: () => engine, call: async <T,>(m: string) => (asked.push(m), (answers[m] ?? {}) as T) });
  return { svc, added, asked };
}
const topUp = (s: ReturnType<typeof setup>, usd: number) => s.svc.call<{ id: string }>("spending.topUp", { usd, ready: "sw-site-pump", key: "site-topup-0123456789abcdef" });

test("Private covers a site's top-up: the engine gets the dollars alone (no Safe coin: one exit from Private, no fill), with an empty Safe", async () => {
  const s = setup({ privateUsdc: "25" });
  const r = await topUp(s, 10);
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(s.added.length, 1);
  assert.deepEqual(s.added[0]!.slice(0, 4), [10, undefined, { wallet: "sw-site-pump", name: "pump.fun", site: "pump" }, undefined]);
  assert.ok(s.asked.includes("ledger.private"));
});

test("controls: Private short needs the Safe's own coin (the fill pays from it), so an empty Safe refuses before anything; an engine not paying from Private never reads Private", async () => {
  const short = setup({ privateUsdc: "3" });
  const r = await topUp(short, 10);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "spending.topup.no-coin", r.problem.code);
  assert.equal(short.added.length, 0, "nothing asked of the engine");
  const old = setup({ privateUsdc: "25", fromPrivate: false });
  const o = await topUp(old, 10);
  assert.ok("problem" in o, "the old engine pays from the Safe's coin");
  assert.equal(o.problem.code, "spending.topup.no-coin");
  assert.equal(old.added.length, 0);
  assert.ok(!old.asked.includes("ledger.private"));
});
