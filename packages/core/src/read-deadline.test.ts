import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { READS, withReadDeadline } from "./read-deadline.ts";

const never: Bridge = { call: () => new Promise(() => {}), on: () => () => {} };

test("N2: a read that never answers ends on 'the network is slow' with Try again, in time; money safe", async () => {
  const b = withReadDeadline(never, 30);
  for (const method of ["account.state", "ledger.balances", "account.protection.get", "spending.status"]) {
    const t = Date.now();
    const r = (await b.call(method)) as { problem: { code: string; money: { state: string }; next: { kind: string; label: string } } };
    assert.ok(Date.now() - t < 500);
    assert.equal(r.problem.code, "security.read.slow");
    assert.equal(r.problem.money.state, "safe");
    assert.deepEqual(r.problem.next, { kind: "retry", label: "Try again" });
  }
});

test("N2: a send, a signature or anything that waits for the person never gets a deadline", async () => {
  const b = withReadDeadline(never, 10);
  for (const method of ["tx.request", "account.protection.set", "account.create", "recovery.start", "recovery.finish", "account.waiting.run", "ledger.transfer", "spending.topUp", "approval.answer"]) {
    assert.equal(READS.has(method), false, method);
    const r = await Promise.race([b.call(method), new Promise((res) => setTimeout(() => res("still waiting"), 40))]);
    assert.equal(r, "still waiting", method);
  }
});

test("N2: an answer in time passes through untouched, and events still arrive", async () => {
  let heard: unknown = null;
  const inner: Bridge = {
    call: async <T,>(method: string) => ({ ok: method } as BridgeResult<T>),
    on: (_e, h) => (h({ x: 1 } as never), () => {}),
  };
  const b = withReadDeadline(inner, 50);
  assert.deepEqual(await b.call("account.state"), { ok: "account.state" });
  b.on("x", (p) => (heard = p));
  assert.deepEqual(heard, { x: 1 });
});

test("D134 item 3: the same read asked while it is under way is asked once; each caller gets its own copy (control: a send is never shared)", async () => {
  let asked = 0;
  let sends = 0;
  const slow: Bridge = {
    call: async <T,>(method: string) => {
      if (method === "tx.request") sends++;
      else asked++;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: { rows: [1, 2] } as T };
    },
    on: () => () => {},
  };
  const b = withReadDeadline(slow, 1_000);
  const [x, y, z] = await Promise.all([b.call<{ rows: number[] }>("spending.status"), b.call<{ rows: number[] }>("spending.status"), b.call<{ rows: number[] }>("spending.status")]);
  assert.equal(asked, 1, "three callers, one read");
  assert.ok("ok" in x && "ok" in y && "ok" in z);
  x.ok.rows.push(3);
  assert.deepEqual(y.ok.rows, [1, 2], "one caller changing its answer never changes another's");
  await Promise.all([b.call("subwallet.float.balance", { app: "trade" }), b.call("subwallet.float.balance", { app: "wallet" })]);
  assert.equal(asked, 3, "other parameters (another app): its own read");
  await b.call("spending.status");
  assert.equal(asked, 4, "once answered, the next caller asks again (nothing kept)");
  await Promise.all([b.call("tx.request", { request: {} }), b.call("tx.request", { request: {} })]);
  assert.equal(sends, 2, "control: what isn't a read is never shared");
});

test("review L5: after a move or an event, a read starts fresh and never joins one that began before (control: with nothing between, it joins)", async () => {
  let asked = 0;
  const handlers = new Set<(p: unknown) => void>();
  const slow: Bridge = {
    call: async <T,>(method: string) => {
      if (method === "ledger.balances") asked++;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: { asked } as T };
    },
    on: <T,>(_e: string, h: (p: T) => void) => (handlers.add(h as (p: unknown) => void), () => handlers.delete(h as (p: unknown) => void)),
  };
  const b = withReadDeadline(slow, 1_000);
  // control: two reads at once share one
  await Promise.all([b.call("ledger.balances"), b.call("ledger.balances")]);
  assert.equal(asked, 1);
  // a move between them: the second is asked anew
  asked = 0;
  const first = b.call("ledger.balances");
  await b.call("ledger.transfer", {});
  await Promise.all([first, b.call("ledger.balances")]);
  assert.equal(asked, 2, "the read after the move didn't join the one from before it");
  // an event between them (a core's, the ledger's): asked anew too
  asked = 0;
  b.on("ledger.balancesChanged", () => {});
  const before = b.call("ledger.balances");
  for (const h of handlers) h({});
  await Promise.all([before, b.call("ledger.balances")]);
  assert.equal(asked, 2, "the read after the event didn't join the one from before it");
});
