// D134: Home's reads, one part at a time. One event reads what it names, never all twelve; events that land together
// are read once; Spending's parts go out beside its status; Spending's change reads trade.positions once more.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { ALL_PARTS, startHomeReads, type HomeSink } from "./home-reads.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeBridge(o: { kid?: boolean; slowStatusMs?: number } = {}) {
  const calls: { method: string; at: number }[] = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const t0 = Date.now();
  const bridge: Bridge = {
    async call<T>(method: string): Promise<BridgeResult<T>> {
      calls.push({ method, at: Date.now() - t0 });
      if (method === "account.state") return { ok: { stage: "ready", kid: o.kid === true } as T };
      if (method === "spending.status" && o.slowStatusMs) await sleep(o.slowStatusMs);
      if (method === "ledger.private") return { ok: { available: false, ready: false, rows: [], defaultOn: false } as T };
      if (method === "subwallet.float.balance") return { ok: { tokens: [] } as T };
      return { ok: [] as T };
    },
    on<T>(event: string, h: (p: T) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(h as (p: unknown) => void);
      handlers.set(event, set);
      return () => set.delete(h as (p: unknown) => void);
    },
  };
  const emit = (event: string, payload: unknown = {}) => handlers.get(event)?.forEach((h) => h(payload));
  const reads = () => calls.filter((c) => c.method !== "account.state").map((c) => c.method);
  return { bridge, calls, emit, reads, reset: () => (calls.length = 0) };
}
const sink: HomeSink = { balances() {}, activity() {}, positions() {}, spending() {}, held() {}, wallets() {}, nearCoins() {}, pocket() {} };

test("D134: one event triggers one read, not twelve (control: refresh() reads every part)", async () => {
  const b = fakeBridge();
  const r = startHomeReads(b.bridge, sink, { coalesceMs: 5, heldAfterMs: 50 });
  await sleep(20);
  b.reset();
  // the poll saw the Safe move (or the live coin list came in): the Safe alone
  b.emit("ledger.balancesChanged", { parts: ["safe"] });
  await sleep(30);
  assert.deepEqual(b.reads(), ["ledger.balances"], "one read for one event");
  // control: a full refresh still reads every part
  b.reset();
  r.refresh();
  await sleep(30);
  for (const m of ["ledger.balances", "ledger.activity", "earn.positions", "spending.status", "trade.positions", "spending.wallets", "subwallet.float.balance", "ledger.private"]) assert.ok(b.reads().includes(m), m);
  r.stop();
});

test("D134: events that land together are read once", async () => {
  const b = fakeBridge();
  const r = startHomeReads(b.bridge, sink, { coalesceMs: 10, heldAfterMs: 1_000 });
  await sleep(20);
  b.reset();
  for (let i = 0; i < 5; i++) b.emit("ledger.balancesChanged", { parts: ["safe", "activity"] });
  b.emit("ledger.movementUpdated", {});
  await sleep(40);
  assert.deepEqual(b.reads().sort(), ["ledger.activity", "ledger.balances", "ledger.private"], "each part once for six events");
  r.stop();
});

test("D134: Spending's parts go out beside its status, never after it; Spending's change reads trade.positions once more, once", async () => {
  const b = fakeBridge({ slowStatusMs: 200 });
  const r = startHomeReads(b.bridge, sink, { coalesceMs: 5, heldAfterMs: 60 });
  await sleep(30);
  const at = (m: string) => b.calls.find((c) => c.method === m)!.at;
  assert.ok(at("trade.positions") < 100 && at("spending.wallets") < 100, "asked while the status is still under way (200 ms)");
  assert.equal(b.reads().filter((m) => m === "subwallet.float.balance").length, 1, "the NEAR wallet's coins once (twice before)");
  await sleep(250);
  b.reset();
  b.emit("spending.changed");
  b.emit("spending.changed");
  r.spendingChanged(); // a live push in the same moment
  await sleep(40);
  assert.equal(b.reads().filter((m) => m === "spending.status").length, 1);
  assert.equal(b.reads().filter((m) => m === "trade.positions").length, 1);
  await sleep(300);
  assert.equal(b.reads().filter((m) => m === "trade.positions").length, 2, "one more read of the coins after the trade's booking, not a burst");
  r.stop();
});

test("D30: on a child's phone Spending and Private are never read", async () => {
  const b = fakeBridge({ kid: true });
  const r = startHomeReads(b.bridge, sink, { coalesceMs: 5 });
  await sleep(20);
  for (const m of ["spending.status", "spending.wallets", "trade.positions", "subwallet.float.balance"]) assert.ok(!b.reads().includes(m), m);
  assert.ok(ALL_PARTS.length === 6);
  r.stop();
});

test("stop() ends every read and listener", async () => {
  const b = fakeBridge();
  const r = startHomeReads(b.bridge, sink, { coalesceMs: 5 });
  await sleep(10);
  r.stop();
  b.reset();
  b.emit("ledger.balancesChanged", {});
  b.emit("spending.changed");
  await sleep(30);
  assert.deepEqual(b.reads(), []);
});
