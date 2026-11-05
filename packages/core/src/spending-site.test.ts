// A site's own wallet in Spending (Job 3, core site-wallets.ts): the site's settings fill it with Spending's existing
// Make ready (by its id), and list it in dollars. Never one of replaced words, never another kind of wallet by id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpendingService, type EngineMove, type EngineSnapshot, type SpendingEngine } from "./spending.ts";

function engine(snap: Partial<EngineSnapshot>) {
  const asked: unknown[] = [];
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [], ...snap };
  const e: SpendingEngine & { asked: unknown[] } = {
    asked,
    snapshot: () => s,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    async add(usd) { return { id: "a1", kind: "add", usd, status: "moving", at: 0 } satisfies EngineMove; },
    async takeOut(usd) { return { id: "h1", kind: "home", usd: usd === "all" ? 0 : usd, status: "waiting", at: 0 }; },
    setCap() {},
    async moveNow(chain, usd, o) { asked.push({ moveNow: chain, usd, o }); return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0, ...(o?.why ? { why: o.why } : {}) }; },
  };
  return e;
}

test("Make ready fills a site's own wallet by its id; listed for the site's settings in dollars, outside the cap", async () => {
  const e = engine({ totalUsd: 100, reserveUsd: 40, chains: [{ chain: "sol", name: "Solana", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, wallets: [] }] });
  const list = [
    { id: "site-pump-sol-a", kind: "site", site: "pump", chain: "sol", address: "PumpAddr", label: "pump.fun wallet" },
    { id: "site-pump-sol-old", kind: "site", site: "pump", chain: "sol", address: "OldAddr", label: "pump.fun wallet", oldWords: true },
    { id: "trade-sol-1", kind: "trade", chain: "sol", address: "TradeAddr", label: "Trading wallet", current: true },
  ];
  const store = new Map<string, string>();
  const svc = createSpendingService({
    engine: () => e,
    nativeUsd: async () => 150,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === "device.store.get") return { value: store.get(String(params.key)) ?? null } as T;
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), { ok: true } as T);
      if (method === "subwallet.list") return list as T;
      if (method === "subwallet.balances") return [{ token: "native", symbol: "SOL", decimals: 9, amount: params.id === "site-pump-sol-a" ? "20000000" : "0" }] as T;
      throw new Error(`no answer for ${method}`);
    },
  });
  const r = await svc.call("spending.makeReady", { network: "sol", usd: 10, wallet: "site-pump-sol-a" });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(e.asked.at(-1), { moveNow: "sol", usd: 10, o: { wallet: "site-pump-sol-a", why: "ready" } });
  // control: with no wallet named, the network's one wallet (no id)
  await svc.call("spending.makeReady", { network: "sol", usd: 10 });
  assert.deepEqual(e.asked.at(-1), { moveNow: "sol", usd: 10, o: { why: "ready" } });
  for (const wallet of ["site-pump-sol-old", "trade-sol-1", "nope"]) {
    const no = await svc.call("spending.makeReady", { network: "sol", usd: 10, wallet });
    assert.ok("problem" in no && no.problem.code === "security.subwallet.unknown", wallet);
  }
  const ws = await svc.call<{ id: string; role: string; site?: string; cashUsd?: string; current: boolean; inCap: boolean }[]>("spending.wallets");
  assert.ok("ok" in ws);
  const pump = ws.ok.find((w) => w.id === "site-pump-sol-a")!;
  assert.deepEqual([pump.role, pump.site, pump.cashUsd, pump.current, pump.inCap], ["site", "pump", "3.00", true, false], "0.02 SOL at $150");
  assert.equal(ws.ok.find((w) => w.id === "site-pump-sol-old")!.current, false, "one of replaced words is an older one");
});

test("Make ready never fills AgentZero's pocket (D90; P1's review): AgentZero's budget grows only with the person's Approve; control: pump.fun's wallet fills", async () => {
  const e = engine({ totalUsd: 100, reserveUsd: 40, chains: [{ chain: "sol", name: "Solana", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, wallets: [] }] });
  const list = [
    { id: "site-agentzero-sol-a", kind: "site", site: "agentzero", chain: "sol", address: "PocketAddr", label: "AgentZero's pocket" },
    { id: "site-pump-sol-a", kind: "site", site: "pump", chain: "sol", address: "PumpAddr", label: "pump.fun wallet" },
  ];
  const svc = createSpendingService({
    engine: () => e,
    nativeUsd: async () => 150,
    async call<T>(method: string): Promise<T> {
      if (method === "device.store.get") return { value: null } as T;
      if (method === "subwallet.list") return list as T;
      throw new Error(`no answer for ${method}`);
    },
  });
  const no = await svc.call("spending.makeReady", { network: "sol", usd: 10, wallet: "site-agentzero-sol-a" });
  assert.ok("problem" in no && no.problem.code === "security.subwallet.refused", JSON.stringify(no));
  assert.match(String((no.problem as { more?: string }).more), /AgentZero's pocket is never filled\. Its money moves to your SOL wallet\./);
  assert.equal(e.asked.length, 0, "nothing moved");
  const ok = await svc.call("spending.makeReady", { network: "sol", usd: 10, wallet: "site-pump-sol-a" });
  assert.ok("ok" in ok, JSON.stringify(ok));
  assert.deepEqual(e.asked.at(-1), { moveNow: "sol", usd: 10, o: { wallet: "site-pump-sol-a", why: "ready" } });
});

test("speed (D145): spending.wallets reads every wallet side by side and the list beside the engine's read, in the list's order (control: the same rows)", async () => {
  // a refresh and every read take 20 ms: read one after another, five site wallets were 5 x 20 ms behind the list
  let refreshing = 0, listedWhileRefreshing = false;
  const e = engine({ totalUsd: 100, reserveUsd: 40, chains: [{ chain: "sol", name: "Solana", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, wallets: [] }] });
  e.refresh = async () => { refreshing++; await new Promise((r) => setTimeout(r, 20)); refreshing--; };
  const sites = ["a", "b", "c", "d", "e"].map((x) => ({ id: `site-pump-sol-${x}`, kind: "site", site: "pump", chain: "sol", address: `Addr${x}`, label: `pump.fun wallet ${x}` }));
  const list = [{ id: "hub", kind: "trade", chain: "near", address: "hub.near", label: "hub" }, ...sites, { id: "trade-sol-1", kind: "trade", chain: "sol", address: "TradeAddr", label: "Trading wallet", current: true }];
  let open = 0, most = 0;
  const svc = createSpendingService({
    engine: () => e,
    nativeUsd: async () => 150,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === "device.store.get") return { value: null } as T;
      if (method === "device.store.set") return { ok: true } as T;
      if (method === "subwallet.list") { if (refreshing) listedWhileRefreshing = true; return list as T; }
      if (method === "subwallet.balances") {
        open++; most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 20));
        open--;
        return [{ token: "native", symbol: "SOL", decimals: 9, amount: String(params.id).endsWith("a") ? "20000000" : "0" }] as T;
      }
      throw new Error(`no answer for ${method}`);
    },
  });
  const r = await svc.call<{ id: string; label: string; cashUsd?: string }[]>("spending.wallets", {});
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(most, 5, "the five site wallets are read at once");
  // control: the same rows, in the list's order, each with its own figure
  assert.deepEqual(r.ok.map((w) => w.id), ["hub", ...sites.map((s) => s.id), "trade-sol-1"]);
  assert.equal(r.ok.find((w) => w.id === "site-pump-sol-a")?.cashUsd, "3.00");
  assert.equal(r.ok.find((w) => w.id === "site-pump-sol-b")?.cashUsd, "0.00");
});
