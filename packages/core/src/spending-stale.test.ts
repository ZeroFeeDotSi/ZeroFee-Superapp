// Real money, 4 Nov (findings 1-3, QA's note (a)): spending.status waited on a full engine refresh (every
// wallet's read, then a follow and a second read). One slow wallet took it past the 10 s read deadline, so Home, Move
// and Send got no wallets at all ("Your wallets didn't answer", "Nothing to move yet" over a $45 Safe). Once the engine
// has figures, a slow read now answers with them at once, marked stale, and spending.changed follows when it lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_FRESH_WAIT_MS, createSpendingService, type EngineSnapshot, type SpendingEngine, type SpendingStatus } from "./spending.ts";

function engineWith(snap: Partial<EngineSnapshot>) {
  let s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [], ...snap };
  const subs = new Set<() => void>();
  let land: (() => void) | undefined;
  const e: SpendingEngine & { set(n: Partial<EngineSnapshot>): void; landRead(): void } = {
    set(n) { s = { ...s, ...n }; for (const f of subs) f(); },
    landRead: () => land?.(),
    snapshot: () => s,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    refresh: () => new Promise<void>((resolve) => { land = resolve; }),
    async add() { throw new Error("not here"); },
    async takeOut() { throw new Error("not here"); },
    setCap() {},
    async moveNow() { throw new Error("not here"); },
  };
  return e;
}

function serviceOf(e: SpendingEngine) {
  return createSpendingService({
    engine: () => e,
    async call<T>(method: string): Promise<T> {
      if (method === "device.store.get") return { value: null } as T;
      return { ok: true } as T;
    },
  });
}

const sol = (usd: number) => ({ chain: "solana", name: "SOL", nativeUsd: usd, coinsUsd: 0, readyUsd: usd } as unknown as EngineSnapshot["chains"][number]);

test("a slow read answers with the engine's last figures, marked stale, and spending.changed follows when it lands", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const e = engineWith({ totalUsd: 12, chains: [sol(12)] });
  const svc = serviceOf(e);
  let changed = 0;
  svc.on("spending.changed", () => changed++);
  const asked = svc.call<SpendingStatus>("spending.status", { caller: "wallet" });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(STATUS_FRESH_WAIT_MS);
  const r = await asked;
  assert.ok("ok" in r, "an answer, not a Problem");
  assert.equal(r.ok.stale, true);
  assert.equal(r.ok.totalUsd, "12.00");
  assert.equal(r.ok.networks[0]?.cashUsd, "12.00", "the SOL wallet is there, never blanked");
  e.set({ totalUsd: 15, chains: [sol(15)] });
  e.landRead();
  assert.ok(changed >= 1, "the fresh figures are told");
});

test("a read that lands in time is fresh (no stale mark); before the first figures the read is waited for", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const quick = engineWith({ totalUsd: 3 });
  quick.refresh = async () => undefined;
  const r = await serviceOf(quick).call<SpendingStatus>("spending.status", { caller: "wallet" });
  assert.ok("ok" in r && r.ok.stale === undefined, "control: fresh in time");

  const cold = engineWith({ loaded: false });
  const asked = serviceOf(cold).call<SpendingStatus>("spending.status", { caller: "wallet" });
  let done = false;
  void asked.then(() => (done = true));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(STATUS_FRESH_WAIT_MS * 4);
  await Promise.resolve();
  assert.equal(done, false, "nothing to give before the first figures: no stale $0");
  cold.set({ loaded: true, totalUsd: 7 });
  cold.landRead();
  const c = await asked;
  assert.ok("ok" in c && c.ok.stale === undefined && c.ok.totalUsd === "7.00");
});
