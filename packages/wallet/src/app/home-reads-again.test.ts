// Finding 9 (real money, 4 Nov): Home's wallet tabs vanished once the balance loaded, and Details showed only the Safe.
// A read that didn't answer (whose phone it is, Spending's status) was taken as a child's phone, and never asked again;
// the Safe's two-node read had no second try either. Each is now asked again on READ_AGAIN_MS (timers by hand here).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { READ_AGAIN_MS, startHomeReads, type HomeSink } from "./home-reads.ts";

const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

function handTimers() {
  const due: { f: () => void; ms: number; id: number }[] = [];
  let n = 0;
  return {
    timers: { setTimeout: (f: () => void, ms: number) => { const id = ++n; due.push({ f, ms, id }); return id; }, clearTimeout: (id: unknown) => { const i = due.findIndex((d) => d.id === id); if (i >= 0) due.splice(i, 1); } },
    /** Runs every timer now waiting (and only those), returning their waits. */
    run() { const now = due.splice(0); now.forEach((d) => d.f()); return now.map((d) => d.ms); },
  };
}

function bridgeWith(fail: Record<string, number>) {
  const left = { ...fail };
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, p?: Record<string, unknown>): Promise<BridgeResult<T>> {
      const key = method === "ledger.balances" && !p?.shown ? "ledger.balances.agreed" : method;
      calls.push(key);
      if ((left[key] ?? 0) > 0) { left[key]!--; return { problem: { code: "security.read.slow", whatHappened: "", whatToDo: "", next: { kind: "none" } } } as unknown as BridgeResult<T>; }
      if (method === "account.state") return { ok: { stage: "ready", kid: false } as T };
      if (method === "spending.status") return { ok: { loaded: true, networks: [] } as T };
      if (method === "ledger.private") return { ok: { available: false, ready: false, rows: [], defaultOn: false } as T };
      if (method === "subwallet.float.balance") return { ok: { tokens: [] } as T };
      if (method === "device.store.get") return { ok: { value: null } as T };
      return { ok: [] as T };
    },
    on() { return () => undefined; },
  };
  return { bridge, calls };
}

const sinkOf = () => {
  const spending: { st: unknown; kid: boolean | undefined }[] = [];
  const agreed: number[] = [];
  const sink: HomeSink = { balances(_r, a) { if (a) agreed.push(1); }, activity() {}, positions() {}, spending(st, kid) { spending.push({ st, kid }); }, held() {}, wallets() {}, nearCoins() {}, pocket() {} };
  return { sink, spending, agreed };
};

test("finding 9: whose phone not answering is never a child's phone; Spending is asked again and lands", async () => {
  const h = handTimers();
  const b = bridgeWith({ "account.state": 1 });
  const s = sinkOf();
  const r = startHomeReads(b.bridge, s.sink, { timers: h.timers, floorFrom: null });
  await settle();
  assert.ok(!s.spending.some((x) => x.kid === true), "no child's phone from a read that didn't answer");
  assert.ok(!b.calls.includes("spending.status"), "Spending waits for whose phone it is");
  assert.deepEqual(h.run(), [READ_AGAIN_MS[0]], "asked again after the first wait");
  await settle();
  assert.ok(s.spending.some((x) => x.st !== null && !x.kid), "Spending answered on the second try");
  r.stop();
});

test("finding 9: Spending's status not answering is asked again, a bounded number of times", async () => {
  const h = handTimers();
  const b = bridgeWith({ "spending.status": 99 });
  const s = sinkOf();
  const r = startHomeReads(b.bridge, s.sink, { timers: h.timers, floorFrom: null });
  await settle();
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) { waits.push(...h.run().filter((ms) => READ_AGAIN_MS.includes(ms))); await settle(); }
  assert.deepEqual(waits, [...READ_AGAIN_MS], "each wait once, then left to the next event");
  assert.equal(b.calls.filter((c) => c === "spending.status").length, READ_AGAIN_MS.length + 1);
  r.stop();
});

test("the Safe's two-node read that didn't answer is asked again (it had no second try)", async () => {
  const h = handTimers();
  const b = bridgeWith({ "ledger.balances.agreed": 1 });
  const s = sinkOf();
  const r = startHomeReads(b.bridge, s.sink, { timers: h.timers, floorFrom: null });
  await settle();
  assert.equal(s.agreed.length, 0, "the first two-node read didn't answer");
  assert.ok(h.run().includes(READ_AGAIN_MS[0]!), "asked again after the first wait");
  await settle();
  assert.equal(s.agreed.length, 1, "agreed on the second try");
  r.stop();
});
