// T-1 landing 1: price orders kept and run on the phone. QA's rules, each with a control: nothing pre-signed (the trade
// runs only through `run`, Trade's own quote and trade, at the cross); a stop-loss whose price was crossed while ZeroFee
// was closed NEVER sells on open without the person's tap (control: a live cross inside the session runs); at most 7
// days; a "no" stops it; a cross while Trade was off screen asks too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrderBook, crossed, MISSED_LINE, NOT_RUN, ORDER_MAX_DAYS, ORDER_RUNS_LINE, orderRefusal, type PriceOrder } from "./orders.ts";

const T0 = 1_760_000_000_000;
function harness(opts: { saved?: string | null; answer?: "ok" | "declined" | "throw" } = {}) {
  const store = { v: opts.saved ?? null as string | null };
  const clock = { t: T0 };
  const px = { now: 1.0 as number | undefined };
  const ran: PriceOrder[] = [];
  const aside: string[] = [];
  const deps = {
    keepAside: async (raw: string) => void aside.push(raw),
    load: async () => store.v,
    save: async (j: string) => void (store.v = j),
    now: () => clock.t,
    price: async () => px.now,
    run: async (o: PriceOrder) => {
      ran.push({ ...o });
      if (opts.answer === "declined") return "declined" as const;
      if (opts.answer === "throw") throw { problem: { whatHappened: "There isn't enough BONK for sale for that much." } };
      return { recordId: `r${ran.length}` };
    },
  };
  return { book: createOrderBook(deps), deps, store, clock, px, ran, aside };
}
const stopLoss = { chain: "sol" as const, coin: "BONKmint", symbol: "BONK", kind: "stop-loss" as const, triggerPx: 0.85 };

test("QA: a stop-loss crossed while ZeroFee was closed NEVER sells on open without the person's tap; it asks, and the tap runs it", async () => {
  const a = harness();
  await a.book.add(stopLoss, 3);
  // ZeroFee closes; the price falls through the stop; ZeroFee opens again (a new book over the same store)
  const reopened = harness({ saved: a.store.v });
  reopened.px.now = 0.7;
  for (let i = 0; i < 5; i++) await reopened.book.tick();
  assert.equal(reopened.ran.length, 0, "never sold on open");
  const [o] = await reopened.book.list();
  assert.equal(o!.status, "missed");
  assert.equal(o!.note, MISSED_LINE(o!));
  assert.match(o!.note!, /^It hit your price while ZeroFee was closed\. Sell all now\?$/);
  reopened.px.now = 0.95; // even if the price comes back over and falls again, a missed order waits for the tap
  await reopened.book.tick();
  reopened.px.now = 0.7;
  await reopened.book.tick();
  assert.equal(reopened.ran.length, 0, "still only on a tap");
  await reopened.book.runMissed(o!.id);
  await reopened.book.settled();
  assert.equal(reopened.ran.length, 1, "the person's tap runs it");
  assert.equal((await reopened.book.list())[0]!.status, "done");
});

test("control: a live cross, seen while ZeroFee is open, runs the order once (through Trade's own run: the session's caps, or the sheet)", async () => {
  const h = harness();
  const o = await h.book.add(stopLoss, 3);
  h.px.now = 0.9;
  await h.book.tick();
  assert.equal(h.ran.length, 0, "above the stop: nothing");
  h.px.now = 0.84;
  await h.book.tick();
  await h.book.settled();
  assert.equal(h.ran.length, 0, "one far read is not enough (review M4)");
  await h.book.tick();
  await h.book.settled();
  assert.equal(h.ran.length, 1);
  assert.equal(h.ran[0]!.id, o.id);
  await h.book.tick();
  await h.book.tick();
  await h.book.settled();
  assert.equal(h.ran.length, 1, "at most once");
  const [done] = await h.book.list();
  assert.deepEqual([done!.status, done!.recordId], ["done", "r1"]);
});

test("a cross while Trade was off screen asks too (pause forgets what was seen); control: back on screen, seen on the near side again, it runs", async () => {
  const h = harness();
  await h.book.add(stopLoss, 3);
  h.book.pause();
  h.px.now = 0.8;
  await h.book.tick();
  assert.equal(h.ran.length, 0);
  assert.equal((await h.book.list())[0]!.status, "missed");
  const g = harness();
  await g.book.add(stopLoss, 3);
  g.book.pause();
  g.px.now = 0.9;
  await g.book.tick(); // seen on the near side again
  g.px.now = 0.8;
  await g.book.tick();
  await g.book.tick();
  await g.book.settled();
  assert.equal(g.ran.length, 1, "control");
});

test("nothing is pre-signed: making and keeping an order calls no trade, and the stored rule holds no transaction", async () => {
  const h = harness();
  await h.book.add({ ...stopLoss, kind: "limit-buy", usd: 20 }, 2);
  for (let i = 0; i < 3; i++) await h.book.tick();
  assert.equal(h.ran.length, 0);
  const kept = JSON.parse(h.store.v!)[0];
  assert.deepEqual(Object.keys(kept).sort(), ["chain", "coin", "endsAt", "id", "kind", "madeAt", "status", "symbol", "triggerPx", "usd"]);
});

test("at most 7 days; it expires untraded (control: one day before, it still waits)", async () => {
  const h = harness();
  await assert.rejects(h.book.add(stopLoss, ORDER_MAX_DAYS + 1), /1 to 7 days/);
  await assert.rejects(h.book.add(stopLoss, 0), /1 to 7 days/);
  await h.book.add(stopLoss, 7);
  h.clock.t = T0 + 6 * 86_400_000;
  await h.book.tick();
  assert.equal((await h.book.list())[0]!.status, "waiting", "control");
  h.clock.t = T0 + 7 * 86_400_000;
  h.px.now = 0.5;
  await h.book.tick();
  const [o] = await h.book.list();
  assert.equal(o!.status, "expired");
  assert.equal(h.ran.length, 0, "an expired order never trades");
});

test("a no on the sheet stops it (never a second sheet); a failure says why; a damaged store is no orders; one running when the app closed never runs again", async () => {
  const no = harness({ answer: "declined" });
  await no.book.add(stopLoss, 3);
  no.px.now = 0.8;
  for (let i = 0; i < 4; i++) { await no.book.tick(); await no.book.settled(); }
  assert.equal(no.ran.length, 1);
  assert.deepEqual([(await no.book.list())[0]!.status, (await no.book.list())[0]!.note], ["stopped", "You said no, so it stopped."]);
  const bad = harness({ answer: "throw" });
  await bad.book.add(stopLoss, 3);
  bad.px.now = 0.8;
  await bad.book.tick();
  await bad.book.tick();
  await bad.book.settled();
  assert.equal((await bad.book.list())[0]!.note, "There isn't enough BONK for sale for that much.");
  const broken = harness({ saved: "{not json" });
  assert.deepEqual(await broken.book.list(), []);
  assert.equal(broken.book.damaged(), true);
  const mid = harness({ saved: JSON.stringify([{ ...stopLoss, id: "x", madeAt: T0, endsAt: T0 + 86_400_000, status: "running" }]) });
  mid.px.now = 0.5;
  await mid.book.tick();
  assert.equal(mid.ran.length, 0);
  assert.equal((await mid.book.list())[0]!.status, "failed");
});

test("the rules: which way each crosses, a trigger already reached is a trade now, no price no order; the sheet's honest line", () => {
  assert.ok(crossed({ kind: "stop-loss", triggerPx: 1 }, 1) && !crossed({ kind: "stop-loss", triggerPx: 1 }, 1.01));
  assert.ok(crossed({ kind: "limit-buy", triggerPx: 1 }, 0.9) && !crossed({ kind: "limit-buy", triggerPx: 1 }, 1.1));
  assert.ok(crossed({ kind: "take-profit", triggerPx: 1 }, 1.2) && !crossed({ kind: "take-profit", triggerPx: 1 }, 0.9));
  assert.match(orderRefusal({ ...stopLoss }, 0.8, 3)!, /already at or under that price\. Sell now instead/);
  assert.match(orderRefusal({ ...stopLoss, kind: "take-profit", triggerPx: 1.2 }, 1.3, 3)!, /already at or over/);
  assert.match(orderRefusal({ ...stopLoss, kind: "limit-buy" }, 1, 3)!, /how many dollars/);
  assert.match(orderRefusal({ ...stopLoss }, undefined, 3)!, /can't be read/);
  assert.match(orderRefusal({ ...stopLoss }, Infinity, 3)!, /can't be read/, "review L6");
  assert.match(orderRefusal({ ...stopLoss, triggerPx: NaN }, 1, 3)!, /Type the price/);
  assert.equal(orderRefusal({ ...stopLoss }, 1, 3), null, "control");
  assert.equal(ORDER_RUNS_LINE, "Runs while ZeroFee is open, and the next time you open it.");
});

test("no price, no decision: an unreadable price neither runs nor misses an order", async () => {
  const h = harness();
  await h.book.add(stopLoss, 3);
  h.book.pause();
  h.px.now = undefined;
  await h.book.tick();
  assert.equal((await h.book.list())[0]!.status, "waiting");
  assert.equal(h.ran.length, 0);
});

test("the runner is Trade's own quote and trade: a limit buy buys its dollars, a stop sells all held then; a no is declined; holding none sells nothing", async () => {
  const { tradeRunner } = await import("./orders.ts");
  const calls: unknown[] = [];
  let status = "done", heldRaw = "5000";
  const svc = {
    quote: async (...a: unknown[]) => (calls.push(["quote", ...a]), { q: 1 }),
    trade: async (p: unknown) => (calls.push(["trade", p]), { id: "rec1", status }),
    held: async () => heldRaw,
  };
  const run = tradeRunner(svc as never);
  const base = { id: "o", chain: "sol" as const, coin: "BONKmint", symbol: "BONK", madeAt: T0, endsAt: T0 + 1, status: "waiting" as const, triggerPx: 1 };
  assert.deepEqual(await run({ ...base, kind: "limit-buy", usd: 20 }), { recordId: "rec1" });
  assert.deepEqual(calls[0], ["quote", "buy", "sol", "BONKmint", { usd: 20 }]);
  await run({ ...base, kind: "stop-loss" });
  assert.deepEqual(calls[2], ["quote", "sell", "sol", "BONKmint", { raw: "5000" }]);
  status = "declined";
  assert.equal(await run({ ...base, kind: "take-profit" }), "declined");
  heldRaw = "0";
  const before = calls.length;
  // nothing held: the book is told so (it says "You hold no BONK now…", or ends an exit plan), never quoted or traded
  assert.equal(await run({ ...base, kind: "stop-loss" }), "none-held");
  assert.equal(calls.length, before, "nothing quoted or traded");
});

test("review H1: a cancel while ANOTHER order's sheet is open stops it at once, and a tap or a tick isn't blocked by that sheet", async () => {
  let release!: () => void;
  const sheet = new Promise<void>((r) => (release = r));
  const h = harness();
  const ran: string[] = [];
  h.deps.run = async (o: PriceOrder) => { ran.push(o.id); if (ran.length === 1) await sheet; return { recordId: `r${ran.length}` }; };
  const other = { px: 0.95 };
  const book = createOrderBook({ ...h.deps, price: async (_c, coin) => (coin === "OTHER" ? other.px : h.px.now), newId: (() => { let i = 0; return () => `o${i++}`; })() });
  await book.add({ ...stopLoss }, 3);
  await book.add({ ...stopLoss, coin: "OTHER", symbol: "OTHER" }, 3);
  h.px.now = 0.9; await book.tick();
  h.px.now = 0.8; await book.tick(); await book.tick(); // o0's sheet opens and stays open
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await book.cancel("o1"), true, "cancelled at once, the sheet still open");
  other.px = 0.5; // OTHER now falls through its stop
  await book.tick(); await book.tick();
  assert.deepEqual(ran, ["o0"], "a tick runs while the sheet is open, and the cancelled order is not run");
  release();
  await book.settled();
  assert.deepEqual(ran, ["o0"], "the cancelled order never ran");
  assert.equal((await book.list()).find((o) => o.id === "o1")!.status, "cancelled");
});

test("review M2: a trade that went but isn't finished ends the order with a note, never re-runs (control: done is plain done)", async () => {
  const { tradeRunner } = await import("./orders.ts");
  for (const [status, note] of [["unconfirmed", "Still finishing. See it in Activity."], ["confirming", "Still finishing. See it in Activity."], ["done", undefined]] as const) {
    const run = tradeRunner({ quote: async () => ({}), trade: async () => ({ id: "r", status }), held: async () => "1" } as never);
    assert.deepEqual(await run({ id: "o", chain: "sol", coin: "c", symbol: "C", kind: "limit-buy", usd: 5, triggerPx: 1, madeAt: T0, endsAt: T0 + 1, status: "waiting" }), note ? { recordId: "r", note } : { recordId: "r" }, status);
  }
});

test("review M4: a price read older than a minute decides nothing (control: a fresh one does)", async () => {
  const h = harness();
  let at = T0;
  const book = createOrderBook({ ...h.deps, price: async () => ({ px: h.px.now!, at }) });
  await book.add(stopLoss, 3);
  book.pause();
  h.clock.t = T0 + 120_000;
  h.px.now = 0.5;
  await book.tick();
  assert.equal((await book.list())[0]!.status, "waiting", "a two-minute-old read: nothing");
  at = h.clock.t;
  await book.tick();
  assert.equal((await book.list())[0]!.status, "missed", "control: a fresh read (crossed, unseen) asks");
});

test("review M5/L8/L11 + QA: a crafted or damaged stored order is never run: the whole store is kept aside, nothing runs, nothing is written over it, and the screen says so (control: a sane store is read as it is)", async () => {
  const ok = { ...stopLoss, id: "ok", madeAt: T0, endsAt: T0 + 86_400_000, status: "waiting" };
  const crafted = [
    { ...ok, id: "noEnd", endsAt: undefined }, { ...ok, id: "long", madeAt: T0, endsAt: T0 + 30 * 86_400_000 }, { ...ok, id: "kind", kind: "sell-everything" },
    { ...ok, id: "buyNoUsd", kind: "limit-buy" }, { ...ok, id: "zero", triggerPx: 0 }, { ...ok, id: "nochain", chain: 5 }, { ...ok, id: "st", status: "go" }, ok, { ...ok },
  ];
  for (const bad of [crafted.slice(0, 1).concat([ok]), [ok, { ...ok }], crafted.slice(0, 7).concat([ok])]) {
    const raw = JSON.stringify(bad);
    const h = harness({ saved: raw });
    h.px.now = 0.5;
    await h.book.tick(); await h.book.tick(); await h.book.settled();
    assert.equal(h.ran.length, 0);
    assert.equal(h.book.damaged(), true);
    assert.deepEqual(h.aside, [raw], "the damaged text kept aside, once");
    assert.equal(h.store.v, raw, "never overwritten");
  }
  const sane = harness({ saved: JSON.stringify([ok]) });
  assert.deepEqual((await sane.book.list()).map((o) => o.id), ["ok"], "control");
  assert.equal(sane.book.damaged(), false);
  let saved = 0;
  const unreadable = createOrderBook({ load: async () => { throw new Error("disk"); }, save: async () => void saved++, price: async () => 1, run: async () => ({ recordId: "x" }) });
  await assert.rejects(unreadable.list(), /disk/);
  await assert.rejects(unreadable.tick(), /disk/);
  assert.equal(saved, 0);
  // with nowhere to keep the damaged text (or keeping it fails): still damaged on screen, and no new order writes over it
  const nowhere = createOrderBook({ load: async () => "{bad", save: async () => void saved++, price: async () => 1, run: async () => ({ recordId: "x" }), keepAside: async () => { throw new Error("full"); } });
  assert.deepEqual(await nowhere.list(), []);
  assert.equal(nowhere.damaged(), true, "the person is told (safety review M1)");
  await assert.rejects(nowhere.add({ ...stopLoss, triggerPx: 0.5 }, 3), /couldn't be backed up/);
  assert.equal(saved, 0, "never overwritten");
});

test("QA: after a damaged store, a new order is the person's: the store is written again, the damaged copy stays aside", async () => {
  const raw = "{not json";
  const h = harness({ saved: raw });
  await h.book.list();
  await h.book.add(stopLoss, 3);
  assert.equal(h.book.damaged(), false);
  assert.equal(JSON.parse(h.store.v!).length, 1);
  assert.deepEqual(h.aside, [raw]);
  const { DAMAGED_LINE } = await import("./orders.ts");
  assert.equal(DAMAGED_LINE, "Your price orders couldn't be read. None will run until you set them again.");
});

test("review L9: a missed order past its end expires on the next look (never a stale Buy now? days later)", async () => {
  const h = harness();
  await h.book.add(stopLoss, 1);
  h.book.pause();
  h.px.now = 0.5;
  await h.book.tick();
  assert.equal((await h.book.list())[0]!.status, "missed");
  h.clock.t = T0 + 86_400_000;
  await h.book.tick();
  assert.equal((await h.book.list())[0]!.status, "expired");
});

test("second review M1/M2: a cross seen before pause never runs after it, even when its look waited behind a slow save; a claim that can't be saved runs nothing (controls)", async () => {
  for (const pauseFirst of [true, false]) {
    const g = harness();
    const other = { px: 0.95 };
    let gated = false, release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const book = createOrderBook({ ...g.deps, price: async (_c, coin) => (coin === "OTHER" ? other.px : g.px.now), save: async (j: string) => { if (gated) await gate; g.store.v = j; }, newId: (() => { let i = 0; return () => `o${i++}`; })() });
    await book.add(stopLoss, 3);
    await book.add({ ...stopLoss, coin: "OTHER", symbol: "OTHER" }, 3);
    g.px.now = 0.9; await book.tick(); // seen on the near side
    g.px.now = 0.8; await book.tick(); // one far read
    gated = true;
    void book.cancel("o1"); // its save holds the queue
    const look = book.tick(); // the second far read waits behind that save
    if (pauseFirst) book.pause();
    gated = false; release();
    await look; await book.tick(); await book.settled();
    assert.equal(g.ran.length, pauseFirst ? 0 : 1, pauseFirst ? "seen before pause: never runs after it" : "control: no pause, it runs");
  }
  const bad = harness();
  const book3 = createOrderBook({ ...bad.deps, save: async (j: string) => { if (JSON.parse(j).some((o: PriceOrder) => o.status === "running")) throw new Error("disk"); bad.store.v = j; } });
  await book3.add(stopLoss, 3);
  bad.px.now = 0.9; await book3.tick();
  bad.px.now = 0.8; await book3.tick(); await book3.tick(); await book3.settled();
  assert.equal(bad.ran.length, 0, "an unsaved claim runs nothing");
  assert.equal((await book3.list())[0]!.status, "waiting", "and the order is as it was");
});

test("second review L2 + safety review M2: an order dated in the future (a clock set back) never runs, but is not damage: the other orders stay; list() gives copies", async () => {
  const future = { ...stopLoss, id: "f", madeAt: T0 + 400 * 86_400_000, endsAt: T0 + 401 * 86_400_000, status: "waiting" };
  const ok = { ...stopLoss, id: "ok", madeAt: T0, endsAt: T0 + 86_400_000, status: "waiting" };
  const d = harness({ saved: JSON.stringify([future, ok]) });
  assert.deepEqual((await d.book.list()).map((o) => o.id).sort(), ["f", "ok"]);
  assert.equal(d.book.damaged(), false);
  d.book.pause(); d.px.now = 0.5;
  await d.book.tick(); await d.book.settled();
  assert.equal(d.ran.length, 0);
  const st = Object.fromEntries((await d.book.list()).map((o) => [o.id, o.status]));
  assert.deepEqual(st, { f: "waiting", ok: "missed" }, "the future one is left alone; control: the sane one asks");
  const h = harness({ saved: JSON.stringify([ok]) });
  const [shown] = await h.book.list();
  shown!.status = "cancelled";
  assert.equal((await h.book.list())[0]!.status, "waiting", "a screen's copy changes nothing");
});

test("T-1 L2 review M1: the same price data read twice counts as one far read (a cached answer never runs an order); control: new data does", async () => {
  const h = harness();
  let at = T0;
  const book = createOrderBook({ ...h.deps, price: async () => ({ px: h.px.now!, at }) });
  await book.add(stopLoss, 3);
  h.px.now = 0.9; await book.tick();
  h.px.now = 0.8; at = T0 + 1;
  for (let i = 0; i < 4; i++) { await book.tick(); await book.settled(); }
  assert.equal(h.ran.length, 0, "four looks at one price answer: one far read");
  at = T0 + 2;
  await book.tick(); await book.settled();
  assert.equal(h.ran.length, 1, "control: a second, newer answer runs it");
});

test("T-1 L2 review L5/L6: an order is checked against the price shown on its sheet; a missed buy says its dollars in cents", async () => {
  const h = harness();
  h.px.now = 0.5; // the market's read already under the stop
  await h.book.add(stopLoss, 3, 0.9); // the sheet showed 0.9: kept
  assert.equal((await h.book.list())[0]!.status, "waiting");
  await assert.rejects(h.book.add(stopLoss, 3, 0.8), /already at or under/, "control: the shown price past the trigger is refused");
  assert.equal(MISSED_LINE({ kind: "limit-buy", symbol: "BONK", usd: 10.123456 }), "It hit your price while ZeroFee was closed. Buy $10.12 now?");
});

/** Two tabs on one device: one store, one lock manager (navigator.locks' rules: a held name with ifAvailable is not run). */
function twoTabs(withLock: boolean) {
  const store = { v: null as string | null };
  const held = new Set<string>();
  const queues = new Map<string, Promise<unknown>>();
  const lock = async <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>) => {
    if (ifAvailable && held.has(name)) return NOT_RUN;
    const before = queues.get(name) ?? Promise.resolve();
    const mine = before.then(async () => { held.add(name); try { return await fn(); } finally { held.delete(name); } });
    queues.set(name, mine.catch(() => undefined));
    return mine;
  };
  const px = { now: 0.9 };
  const ran: string[] = [];
  let open!: () => void;
  const sheet = new Promise<void>((r) => (open = r));
  const tab = (name: string) => createOrderBook({
    load: async () => store.v, save: async (j) => void (store.v = j), now: () => T0, price: async () => px.now,
    run: async (o) => { ran.push(`${name}:${o.id}`); await sheet; return { recordId: name }; },
    newId: () => "o1", ...(withLock ? { lock } : {}),
  });
  return { a: tab("A"), b: tab("B"), px, ran, release: () => open(), store };
}

test("QA: two tabs see the same live cross: only ONE runs the stop-loss (control: without the lock, both run)", async () => {
  for (const withLock of [true, false]) {
    const t = twoTabs(withLock);
    await t.a.add(stopLoss, 3);
    await t.b.list();
    t.px.now = 0.9; await Promise.all([t.a.tick(), t.b.tick()]);
    t.px.now = 0.8;
    await Promise.all([t.a.tick(), t.b.tick()]);
    await Promise.all([t.a.tick(), t.b.tick()]);
    await new Promise((r) => setTimeout(r, 5));
    t.release();
    await Promise.all([t.a.settled(), t.b.settled()]);
    // and after the first finished, neither runs it again (the store says done)
    await Promise.all([t.a.tick(), t.b.tick()]); await Promise.all([t.a.tick(), t.b.tick()]);
    await Promise.all([t.a.settled(), t.b.settled()]);
    if (withLock) {
      assert.equal(t.ran.length, 1, `one tab ran it: ${t.ran.join(", ")}`);
      assert.equal(JSON.parse(t.store.v!)[0].status, "done", "and its end isn't undone by the other tab's old view");
    } else assert.ok(t.ran.length >= 2, `control: without the lock both run (${t.ran.join(", ")})`);
  }
});
