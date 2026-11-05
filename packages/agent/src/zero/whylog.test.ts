// The Why log (FLOW-V5 §5 item 7): every receipt carries the hash of the one before it and its own; an edit, a deletion
// or a reorder is caught with the time it broke; receipts from before the log are its start, never a fault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorReceipts, headAfter, keepReceipts, logLine, makeReceipt, receiptHash, receiptHead, verifyLog, type Receipt } from "./receipts.ts";

const T0 = Date.UTC(2026, 10, 3, 2, 0);
const pay = (i: number) => makeReceipt({ kind: "pay", jobId: "j", usd: i, to: "kim.near" } as never, T0 + i * 60_000, [`Why ${i}`], { txHash: `tx${i}` });
/** Receipts written one at a time, the way the engine does (newest first). */
function written(count: number, start: Receipt[] = []): Receipt[] {
  let list = start;
  for (let i = 1; i <= count; i++) list = keepReceipts([pay(i)], list);
  return list;
}

test("each new receipt is chained onto the one before it; the log reads unbroken", () => {
  const log = written(4);
  assert.ok(log.every((r) => r.hash && r.hash === receiptHash(r)));
  for (let i = 0; i < log.length - 1; i++) assert.equal(log[i]!.prev, log[i + 1]!.hash);
  assert.equal(log.at(-1)!.prev, "");
  assert.deepEqual(verifyLog(log), { ok: true, started: true });
  assert.equal(logLine(log[0]!, log), "Each receipt is as AgentZero wrote it.");
  assert.equal(logLine(log.at(-1)!, log), "The first receipt. Each one is as AgentZero wrote it.");
});

test("an edit to any field of an old receipt is caught at that receipt's time", () => {
  for (const field of ["title", "why", "txHash", "state", "atIso", "jobId", "id"] as const) {
    const log = written(4);
    const old = log[2]!;
    const edited = { ...old, [field]: field === "why" ? ["Something else."] : field === "atIso" ? new Date(T0 + 99_000).toISOString() : "changed" } as Receipt;
    const bad = [...log.slice(0, 2), edited, ...log.slice(3)];
    const v = verifyLog(bad);
    assert.equal(v.ok, false, field);
    assert.equal((v as { changedAtIso: string }).changedAtIso, edited.atIso, field);
  }
});

test("a deleted receipt, or two swapped, is caught at the first receipt after the gap", () => {
  const log = written(4);
  const deleted = [log[0]!, log[1]!, log[3]!];
  assert.deepEqual(verifyLog(deleted), { ok: false, changedAtIso: log[1]!.atIso });
  const swapped = [log[0]!, log[2]!, log[1]!, log[3]!];
  assert.equal(verifyLog(swapped).ok, false);
  assert.match(logLine(log[0]!, deleted)!, /^Someone changed these receipts at /);
});

test("receipts from before the log load as they are and the log starts after them; one stripped of its hash later is a change", () => {
  const legacy: Receipt[] = [1, 2].map((i) => {
    const { hash: _h, ...r } = pay(i);
    return r as Receipt;
  }).reverse();
  const log = written(2, legacy);
  assert.equal(log.length, 4);
  assert.equal(log[3]!.hash, undefined);
  assert.equal(log[1]!.prev, "", "the log starts after the old ones");
  assert.deepEqual(verifyLog(log), { ok: true, started: true });
  assert.equal(logLine(log[3]!, log), null, "an old receipt has no log line");
  const { hash: _h, prev: _p, ...stripped } = log[0]!;
  assert.deepEqual(verifyLog([stripped as Receipt, ...log.slice(1)]), { ok: false, changedAtIso: log[0]!.atIso });
});

test("trimmed to 200: the oldest kept receipt's link to a dropped one isn't a fault", () => {
  const log = written(205);
  assert.equal(log.length, 200);
  assert.deepEqual(verifyLog(log), { ok: true, started: true });
});

// Audit: the chain wasn't anchored. A stored receipt set to hash "" was silently chained again by keepReceipts, and
// cutting the newest receipts off still read as unbroken. Now only the new receipts are chained, a missing or wrong hash
// is a break, and the chain's head (its newest hash and count) is kept apart, in the core's vault, and checked.
test("audit: a stored receipt set to hash \"\" is never chained again; it reads as a change", () => {
  const log = written(3);
  const tampered = [{ ...log[0]!, title: "AgentZero paid $0.01 to kim.near", hash: "" }, ...log.slice(1)];
  const next = keepReceipts([pay(9)], tampered);
  assert.equal(next[1]!.hash, "", "left as it was found");
  assert.equal(next.length, 4);
  const v = verifyLog(next);
  assert.equal(v.ok, false);
  assert.equal((v as { changedAtIso: string }).changedAtIso, log[0]!.atIso);
});

test("audit: the newest receipts cut off (or every hash stripped) are caught against the head kept apart", () => {
  const log = written(5);
  const head = receiptHead(log, 5);
  assert.deepEqual(head, { hash: log[0]!.hash, count: 5, atIso: log[0]!.atIso });
  assert.deepEqual(verifyLog(log, head), { ok: true, started: true }, "control: the whole log matches its head");
  const cut = log.slice(2);
  assert.deepEqual(verifyLog(cut), { ok: true, started: true }, "without the head, a cut log looks whole (why the head is needed)");
  assert.deepEqual(verifyLog(cut, head), { ok: false, changedAtIso: log[0]!.atIso });
  assert.equal(verifyLog([], head).ok, false, "all of them gone");
  const stripped = log.map(({ hash: _h, prev: _p, ...r }) => r as Receipt);
  assert.equal(verifyLog(stripped, head).ok, false, "every hash stripped");
  anchorReceipts(cut, head);
  assert.match(logLine(cut[0]!, cut)!, /^Someone changed these receipts at /, "the Why page says so");
});

test("audit: the head moves on with each write and its count only grows", () => {
  let log = written(2);
  let head = receiptHead(log, 2);
  const fresh = [pay(7), pay(8)];
  log = keepReceipts(fresh, log);
  head = receiptHead(log, head.count + fresh.length);
  assert.equal(head.count, 4);
  assert.deepEqual(verifyLog(log, head), { ok: true, started: true });
});

test("audit: a cut log isn't made whole by the next write: the head keeps the break", () => {
  const log = written(5);
  const head = receiptHead(log, 5);
  const cut = log.slice(2);
  const next = keepReceipts([pay(9)], cut);
  const moved = headAfter(cut, head, 1, next);
  assert.equal(moved.hash, next[0]!.hash);
  assert.deepEqual(verifyLog(next, moved), { ok: false, changedAtIso: log[0]!.atIso });
  // control: a head one write behind (its own write didn't land) catches up without a break
  const behind = receiptHead(log.slice(1), 4);
  const n2 = keepReceipts([pay(9)], log);
  assert.deepEqual(verifyLog(n2, headAfter(log, behind, 1, n2)), { ok: true, started: true });
});

test("audit, the engine: each write moves the head in the core's vault; receipts cut from the device's store show as changed", async () => {
  const { zeroEngine, KEYS } = await import("./engine.ts");
  const store = new Map<string, string>();
  let vaultHead: unknown = null;
  const bridge = () => ({
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({}));
      if (method === "account.agent.receiptHead") return ok({ head: params.set ? (vaultHead = params.set) : vaultHead });
      return { problem: { code: "test.unknown", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as never;
    },
    on: () => () => {},
  });
  const e = zeroEngine(bridge() as never, { now: () => T0 });
  for (let i = 1; i <= 4; i++) await e.addReceipts([pay(i)]);
  const kept = JSON.parse(store.get(KEYS.receipts)!) as Receipt[];
  assert.equal((vaultHead as { hash: string }).hash, kept[0]!.hash, "the head is the newest receipt's");
  assert.equal((vaultHead as { count: number }).count, 4);
  const whole = await zeroEngine(bridge() as never, { now: () => T0 }).refresh();
  assert.equal(logLine(whole.receipts[0]!, whole.receipts), "Each receipt is as AgentZero wrote it.", "control: whole");
  store.set(KEYS.receipts, JSON.stringify(kept.slice(2))); // the two newest cut off the device's store
  const cut = await zeroEngine(bridge() as never, { now: () => T0 }).refresh();
  assert.match(logLine(cut.receipts[0]!, cut.receipts)!, /^Someone changed these receipts at /);
});

test("re-review: a head read that fails, then a receipt: no break is saved and Why isn't 'changed'; once the read works, the head catches up", async () => {
  const { zeroEngine, KEYS } = await import("./engine.ts");
  const { receiptHeadCall } = await import("@zerofee/core/agent-receipt-head");
  const { MemoryVault } = await import("@zerofee/core/vault");
  const vault = new MemoryVault();
  const store = new Map<string, string>();
  let readsDown = false;
  const no = { problem: { code: "core.busy", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as never;
  const bridge = () => ({
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({}));
      if (method === "account.agent.receiptHead") {
        if (params.set === undefined && readsDown) return no;
        try {
          return ok(await receiptHeadCall(params, vault));
        } catch (e) {
          return { problem: (e as { problem: unknown }).problem } as never;
        }
      }
      return no;
    },
    on: () => () => {},
  });
  const first = zeroEngine(bridge() as never, { now: () => T0 });
  await first.addReceipts([pay(1)]);
  await first.addReceipts([pay(2)]);
  readsDown = true; // a new session whose head read fails
  const e = zeroEngine(bridge() as never, { now: () => T0 });
  await e.addReceipts([pay(3)]);
  assert.equal((await receiptHeadCall({}, vault)).head!.brokenAtIso, undefined, "no break saved");
  const s = e.snapshot();
  assert.equal(logLine(s.receipts[0]!, s.receipts), "Each receipt is as AgentZero wrote it.", "Why isn't 'changed'");
  readsDown = false;
  await e.addReceipts([pay(4)]);
  const head = (await receiptHeadCall({}, vault)).head!;
  const kept = JSON.parse(store.get(KEYS.receipts)!) as Receipt[];
  assert.deepEqual([head.hash, head.count, head.brokenAtIso], [kept[0]!.hash, 4, undefined], "caught up");
});

test("review, the engine with the core's own door: a head that didn't save keeps the last one and catches up on the next write, never 'changed'", async () => {
  const { zeroEngine, KEYS } = await import("./engine.ts");
  const { receiptHeadCall } = await import("@zerofee/core/agent-receipt-head");
  const { MemoryVault } = await import("@zerofee/core/vault");
  const vault = new MemoryVault();
  const store = new Map<string, string>();
  let failNext = false;
  const bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "device.store.get") return ok({ value: store.get(String(params.key)) ?? null });
      if (method === "device.store.set") return (store.set(String(params.key), String(params.value)), ok({}));
      if (method === "account.agent.receiptHead") {
        if (params.set && failNext) return (failNext = false, { problem: { code: "core.busy", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as never);
        return ok(await receiptHeadCall(params, vault));
      }
      return { problem: { code: "test.unknown", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as never;
    },
    on: () => () => {},
  };
  const e = zeroEngine(bridge as never, { now: () => T0 });
  await e.addReceipts([pay(1)]);
  await e.addReceipts([pay(2)]);
  failNext = true;
  await e.addReceipts([pay(3)]); // its head didn't save
  const s = e.snapshot();
  assert.equal(logLine(s.receipts[0]!, s.receipts), "Each receipt is as AgentZero wrote it.", "not 'changed'");
  await e.addReceipts([pay(4)]);
  const head = (await receiptHeadCall({}, vault)).head!;
  const kept = JSON.parse(store.get(KEYS.receipts)!) as Receipt[];
  assert.deepEqual([head.hash, head.count, head.brokenAtIso], [kept[0]!.hash, 4, undefined], "caught up, unbroken, counted right");
  const fresh = await zeroEngine({ ...bridge } as never, { now: () => T0 }).refresh();
  assert.equal(logLine(fresh.receipts[0]!, fresh.receipts), "Each receipt is as AgentZero wrote it.");
});
