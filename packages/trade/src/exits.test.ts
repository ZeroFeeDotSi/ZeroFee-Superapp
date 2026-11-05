// ST-B (master plan Part 1 §5, QA's GO 3 Nov): an exit plan per held coin, inside T-1's order book. QA's rules, each with
// a control: a time that came while ZeroFee was closed NEVER sells on open without the tap (control: a time seen coming
// while open sells); the first exit to go ends the others, so a coin is sold once (control: the mutation-free path runs
// one); a no gives the others back (asking, never selling by themselves); a coin sold first (by the person, or AgentZero's
// copy job) ends the plan in plain words, never an error and never a retry (control: a held coin sells); one plan per coin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrderBook, MISSED_LINE, NONE_HELD_LINE, NOT_RUN, planRefusal, SIBLING_WENT_LINE, tradeRunner, type Exit, type PriceOrder } from "./orders.ts";

const T0 = 1_760_000_000_000;
const H = 3_600_000;
const WIF = { chain: "sol" as const, coin: "WIFmint", symbol: "WIF" };
const plan3: Exit[] = [{ kind: "take-profit", triggerPx: 1.5 }, { kind: "stop-loss", triggerPx: 0.7 }, { kind: "sell-after", hours: 6 }];

function harness(opts: { saved?: string | null; answer?: "ok" | "declined" | "throw" } = {}) {
  const store = { v: opts.saved ?? null as string | null };
  const clock = { t: T0 };
  const px = { now: 1.0 as number | undefined };
  const ran: PriceOrder[] = [];
  const answer = { v: opts.answer ?? "ok" };
  const deps = {
    keepAside: async () => undefined,
    load: async () => store.v,
    save: async (j: string) => void (store.v = j),
    now: () => clock.t,
    price: async () => px.now,
    run: async (o: PriceOrder): Promise<{ recordId: string } | "declined" | "none-held"> => {
      ran.push({ ...o });
      if (answer.v === "declined") return "declined";
      if (answer.v === "throw") throw { problem: { whatHappened: "Solana didn't answer. Nothing was sold." } };
      return { recordId: `r${ran.length}` };
    },
  };
  return { book: createOrderBook(deps), deps, store, clock, px, ran, answer };
}
const tickN = async (h: { book: { tick(): Promise<void>; settled(): Promise<void> } }, n = 1) => { for (let i = 0; i < n; i++) { await h.book.tick(); await h.book.settled(); } };
const byKind = async (h: ReturnType<typeof harness>) => Object.fromEntries((await h.book.list()).map((o) => [o.kind, o]));

test("QA: a sell-after whose time came while ZeroFee was closed NEVER sells on open; it asks, and only the tap sells", async () => {
  const a = harness();
  await a.book.addPlan(WIF, [{ kind: "sell-after", hours: 6 }]);
  const reopened = harness({ saved: a.store.v });
  reopened.clock.t = T0 + 7 * H;
  await tickN(reopened, 4);
  assert.equal(reopened.ran.length, 0, "never sold on open");
  const [o] = await reopened.book.list();
  assert.equal(o!.status, "missed");
  assert.equal(o!.note, "The time came while ZeroFee was closed. Sell all now?");
  assert.equal(o!.note, MISSED_LINE(o!));
  await reopened.book.runMissed(o!.id);
  await reopened.book.settled();
  assert.equal(reopened.ran.length, 1, "the tap sells");
});

test("control: a sell-after whose time came while Trade was on screen (seen before it came) sells once; one hidden in between asks", async () => {
  const h = harness();
  await h.book.addPlan(WIF, [{ kind: "sell-after", hours: 1 }]);
  h.clock.t = T0 + H - 1_000;
  await tickN(h);
  assert.equal(h.ran.length, 0, "not yet");
  h.clock.t = T0 + H;
  await tickN(h, 3);
  assert.equal(h.ran.length, 1, "seen coming, it sells by itself");
  assert.equal((await h.book.list())[0]!.status, "done");
  // the same, but Trade left the screen before the time came: it asks
  const g = harness();
  await g.book.addPlan(WIF, [{ kind: "sell-after", hours: 1 }]);
  await tickN(g);
  g.book.pause();
  g.clock.t = T0 + H + 5_000;
  await tickN(g, 3);
  assert.equal(g.ran.length, 0);
  assert.equal((await g.book.list())[0]!.status, "missed");
});

test("the first exit to go ends the others in the same change: one sale, never two (two crossings at once, then the time)", async () => {
  const h = harness();
  await h.book.addPlan(WIF, plan3);
  await tickN(h);
  h.px.now = 1.6; // over the take-profit
  await tickN(h, 3);
  assert.equal(h.ran.length, 1);
  assert.equal(h.ran[0]!.kind, "take-profit");
  const k = await byKind(h);
  assert.equal(k["take-profit"]!.status, "done");
  for (const kind of ["stop-loss", "sell-after"]) { assert.equal(k[kind]!.status, "cancelled"); assert.equal(k[kind]!.note, SIBLING_WENT_LINE); }
  h.px.now = 0.5; h.clock.t = T0 + 7 * H; // the price falls through the stop and the time comes: nothing more
  await tickN(h, 4);
  assert.equal(h.ran.length, 1, "sold once");
});

test("a sibling never starts while the first one's sheet is open (both cross at once in one tick)", async () => {
  const h = harness();
  let open!: () => void;
  const sheet = new Promise<void>((r) => (open = r));
  h.deps.run = async (o) => { h.ran.push({ ...o }); await sheet; return { recordId: "r" }; };
  await h.book.addPlan(WIF, [{ kind: "stop-loss", triggerPx: 0.9 }, { kind: "sell-after", hours: 1 }]);
  await tickN(h);
  h.px.now = 0.8; h.clock.t = T0 + H; // the stop and the time both due
  await h.book.tick(); await h.book.tick(); await h.book.tick();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.ran.length, 1, "only one sheet");
  open();
  await h.book.settled();
  await tickN(h, 2);
  assert.equal(h.ran.length, 1);
});

test("a no on the sheet gives the other exits back, asking (never selling by themselves); a trade that didn't go does too", async () => {
  for (const answer of ["declined", "throw"] as const) {
    const h = harness({ answer });
    await h.book.addPlan(WIF, plan3);
    await tickN(h);
    h.px.now = 1.6;
    await tickN(h, 2); // two far reads: the take-profit's sheet; nothing looked at after it
    assert.equal(h.ran.length, 1);
    let k = await byKind(h);
    assert.equal(k["take-profit"]!.status, answer === "declined" ? "stopped" : "failed");
    assert.equal(k["stop-loss"]!.status, "waiting", `${answer}: given back`);
    assert.equal(k["sell-after"]!.status, "waiting");
    assert.equal(k["stop-loss"]!.by, undefined);
    // given back, never armed by that: the time comes and the price falls through the stop with no near-side look in
    // between → both ask
    h.answer.v = "ok";
    h.clock.t = T0 + 6 * H;
    h.px.now = 0.6;
    await tickN(h, 3);
    k = await byKind(h);
    assert.equal(k["sell-after"]!.status, "missed", "the time asks");
    assert.equal(k["stop-loss"]!.status, "missed", "the stop asks");
    assert.equal(h.ran.length, 1, "never sold by itself");
  }
});

test("QA: the coin was sold first (AgentZero's copy job or the person): the exit ends the plan in plain words, never an error, never a retry; control: a held coin sells", async () => {
  for (const heldRaw of ["0", "5000"]) {
    const h = harness();
    const calls: string[] = [];
    h.deps.run = tradeRunner({
      quote: async () => (calls.push("quote"), {}),
      trade: async () => (calls.push("trade"), { id: "rec", status: "done" }),
      held: async () => heldRaw,
    } as never);
    await h.book.addPlan(WIF, plan3);
    await tickN(h);
    h.px.now = 0.6; // through the stop
    await tickN(h, 3);
    let k = await byKind(h);
    if (heldRaw === "0") {
      assert.equal(calls.length, 0, "nothing quoted or traded");
      assert.equal(k["stop-loss"]!.status, "stopped");
      assert.equal(k["stop-loss"]!.note, "You don't hold WIF any more. The sell plan ended.");
      assert.equal(k["stop-loss"]!.note, NONE_HELD_LINE("WIF"));
      for (const kind of ["take-profit", "sell-after"]) { assert.equal(k[kind]!.status, "cancelled"); assert.equal(k[kind]!.note, NONE_HELD_LINE("WIF")); }
      // never retried: the price comes back and falls again, the time comes
      h.px.now = 1.6; await tickN(h, 3); h.px.now = 0.6; h.clock.t = T0 + 7 * H; await tickN(h, 3);
      k = await byKind(h);
      assert.equal(calls.length, 0, "no retry");
      assert.equal(k["stop-loss"]!.status, "stopped");
    } else {
      assert.deepEqual(calls, ["quote", "trade"], "control: a held coin sells");
      assert.equal(k["stop-loss"]!.status, "done");
    }
  }
});

test("T-1 kept: a plain stop-loss (no plan) that finds nothing held still says so as before", async () => {
  const h = harness();
  h.deps.run = tradeRunner({ quote: async () => ({}), trade: async () => ({ id: "x", status: "done" }), held: async () => "0" } as never);
  await h.book.add({ ...WIF, kind: "stop-loss", triggerPx: 0.9 }, 3);
  await tickN(h);
  h.px.now = 0.8;
  await tickN(h, 3);
  const [o] = await h.book.list();
  assert.deepEqual([o!.status, o!.note], ["failed", "You hold no WIF now, so nothing was sold."]);
});

test("one plan per coin: a new plan replaces the open one in the same change; never while an exit runs; another coin's plan and plain orders stay", async () => {
  const h = harness();
  const first = await h.book.addPlan(WIF, plan3);
  const other = await h.book.addPlan({ ...WIF, coin: "BONKmint", symbol: "BONK" }, [{ kind: "stop-loss", triggerPx: 0.8 }]);
  const plain = await h.book.add({ ...WIF, kind: "stop-loss", triggerPx: 0.85 }, 3);
  const second = await h.book.addPlan(WIF, [{ kind: "take-profit", triggerPx: 2 }]);
  const all = await h.book.list();
  for (const o of first) { const now = all.find((x) => x.id === o.id)!; assert.equal(now.status, "cancelled"); assert.equal(now.note, "A new sell plan took its place."); }
  assert.equal(all.find((x) => x.id === second[0]!.id)!.status, "waiting");
  assert.equal(all.find((x) => x.id === other[0]!.id)!.status, "waiting", "another coin's plan stays");
  assert.equal(all.find((x) => x.id === plain.id)!.status, "waiting", "a plain order stays");
  // while an exit runs, no new plan
  let open!: () => void;
  const sheet = new Promise<void>((r) => (open = r));
  h.deps.run = async (o) => { h.ran.push({ ...o }); await sheet; return { recordId: "r" }; };
  await tickN(h);
  h.px.now = 2.1;
  await h.book.tick(); await h.book.tick();
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(h.book.addPlan(WIF, [{ kind: "stop-loss", triggerPx: 1 }]), /A sale of WIF is running now/);
  open();
  await h.book.settled();
  // cancelPlan ends what is open
  const third = await h.book.addPlan(WIF, plan3.slice(1), 2.1);
  assert.equal(await h.book.cancelPlan(third[0]!.plan!), true);
  assert.ok((await h.book.list()).filter((o) => o.plan === third[0]!.plan).every((o) => o.status === "cancelled"));
  assert.equal(await h.book.cancelPlan(third[0]!.plan!), false, "nothing left open");
});

test("the plan's rules in plain words; nothing pre-signed; at most 7 days", async () => {
  assert.equal(planRefusal("WIF", [], 1), "Pick at least one way out.");
  assert.equal(planRefusal("WIF", [{ kind: "stop-loss", triggerPx: 0.5 }, { kind: "stop-loss", triggerPx: 0.6 }], 1), "A plan has one of each: a rise, a fall, a time.");
  assert.equal(planRefusal("WIF", [{ kind: "sell-after", hours: 0 }], 1), "Sell after 1 hour to 6 days.");
  assert.equal(planRefusal("WIF", [{ kind: "sell-after", hours: 168 }], 1), "Sell after 1 hour to 6 days.");
  assert.equal(planRefusal("WIF", [{ kind: "take-profit", triggerPx: 0.9 }], 1), "WIF is already at or over that price. Sell now instead.");
  assert.equal(planRefusal("WIF", [{ kind: "stop-loss", triggerPx: 1.1 }], 1), "WIF is already at or under that price. Sell now instead.");
  assert.equal(planRefusal("WIF", [{ kind: "sell-after", hours: 6 }], undefined), "WIF's price can't be read right now, so the plan wasn't made.");
  assert.equal(planRefusal("WIF", plan3, 1), null, "control: a sane plan");
  const h = harness();
  const kept = await h.book.addPlan(WIF, plan3);
  assert.equal(h.ran.length, 0, "making a plan trades nothing");
  // field names only, and no long blob: the ids are random base 36, so the raw text can hold "tx" by chance (a flake
  // in land.sh, 3 Nov: about 1 run in 70)
  const stored = JSON.parse(h.store.v!) as Record<string, unknown>[];
  const names = stored.flatMap((o) => Object.keys(o));
  assert.ok(names.length > 0 && !names.some((k) => /sign|tx|transaction/i.test(k)), "the stored rule holds no transaction field");
  assert.ok(stored.every((o) => Object.values(o).every((v) => typeof v !== "string" || v.length < 80)), "the stored rule holds no transaction bytes");
  assert.ok(kept.every((o) => o.endsAt - o.madeAt === 7 * 24 * H && o.plan === kept[0]!.plan));
  assert.equal(kept.find((o) => o.kind === "sell-after")!.at, T0 + 6 * H);
  h.clock.t = T0 + 7 * 24 * H;
  await tickN(h);
  assert.ok((await h.book.list()).every((o) => o.status === "expired"), "past 7 days: ran out, untraded");
});

test("a crafted exit in the store is damage, never run (a sell-after outside a plan, its time outside its days, a plan on a buy); control: a sane plan reads", async () => {
  const sane = harness();
  await sane.book.addPlan(WIF, plan3);
  const good = JSON.parse(sane.store.v!);
  assert.equal((await harness({ saved: JSON.stringify(good) }).book.list()).length, 3, "control");
  const bad = [
    (o: any) => { if (o.kind === "sell-after") delete o.plan; },
    (o: any) => { if (o.kind === "sell-after") o.at = o.endsAt + 1; },
    (o: any) => { if (o.kind === "sell-after") o.at = o.madeAt; },
    (o: any) => { if (o.kind === "stop-loss") o.at = o.madeAt + 1; },
    (o: any) => { if (o.kind === "take-profit") Object.assign(o, { kind: "limit-buy", usd: 5 }); },
    (o: any) => { if (o.kind === "take-profit") o.by = 7; },
  ];
  for (const f of bad) {
    const list = JSON.parse(sane.store.v!);
    list.forEach(f);
    const h = harness({ saved: JSON.stringify(list) });
    h.px.now = 0.1; h.clock.t = T0 + 7 * H;
    await tickN(h, 3);
    assert.equal(h.book.damaged(), true, String(f));
    assert.equal(h.ran.length, 0);
  }
});

/** Two tabs, one store, one lock manager (navigator.locks' rules), as orders.test.ts's; each tab reads its own price. */
function twoTabs() {
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
  const ran: string[] = [];
  let open!: () => void;
  const sheet = new Promise<void>((r) => (open = r));
  let n = 0;
  const tab = (name: string, px: { now: number }) => createOrderBook({
    load: async () => store.v, save: async (j) => void (store.v = j), now: () => T0, price: async () => px.now,
    run: async (o) => { ran.push(`${name}:${o.kind}`); await sheet; return { recordId: name }; },
    newId: () => `o${++n}`, lock,
  });
  const pa = { now: 1 }, pb = { now: 1 };
  return { a: tab("A", pa), b: tab("B", pb), pa, pb, ran, release: () => open(), store };
}

test("two tabs: tab A sees the take-profit, tab B the stop-loss, at once: the coin is sold ONCE (control: two separate plans both sell)", async () => {
  for (const together of [true, false]) {
    const t = twoTabs();
    if (together) await t.a.addPlan(WIF, [{ kind: "take-profit", triggerPx: 1.2 }, { kind: "stop-loss", triggerPx: 0.8 }]);
    else { await t.a.addPlan(WIF, [{ kind: "take-profit", triggerPx: 1.2 }]); await t.a.addPlan({ ...WIF, coin: "BONKmint", symbol: "BONK" }, [{ kind: "stop-loss", triggerPx: 0.8 }]); }
    await t.b.list();
    await Promise.all([t.a.tick(), t.b.tick()]); // both tabs see every exit on its near side
    t.pa.now = 1.3; t.pb.now = 0.7;
    for (let i = 0; i < 3; i++) await Promise.all([t.a.tick(), t.b.tick()]);
    await new Promise((r) => setTimeout(r, 5));
    t.release();
    await Promise.all([t.a.settled(), t.b.settled()]);
    if (together) {
      assert.equal(t.ran.length, 1, `sold once: ${t.ran.join(", ")}`);
      const st = JSON.parse(t.store.v!).map((o: PriceOrder) => o.status).sort();
      assert.deepEqual(st, ["cancelled", "done"]);
    } else assert.equal(t.ran.length, 2, `control: two plans, two sales (${t.ran.join(", ")})`);
  }
});

test("cancelling the plan while one exit's sheet is open: a no on that sheet never gives the others back (control: without the cancel, it does)", async () => {
  for (const cancel of [true, false]) {
    const h = harness({ answer: "declined" });
    let open!: () => void;
    const sheet = new Promise<void>((r) => (open = r));
    h.deps.run = async (o) => { h.ran.push({ ...o }); await sheet; return "declined" as const; };
    const kept = await h.book.addPlan(WIF, plan3);
    await tickN(h);
    h.px.now = 1.6;
    await h.book.tick(); await h.book.tick();
    await new Promise((r) => setTimeout(r, 5));
    if (cancel) assert.equal(await h.book.cancelPlan(kept[0]!.plan!), true);
    open();
    await h.book.settled();
    const k = await byKind(h);
    assert.equal(k["stop-loss"]!.status, cancel ? "cancelled" : "waiting");
    assert.equal(k["sell-after"]!.status, cancel ? "cancelled" : "waiting");
    if (cancel) assert.equal(k["stop-loss"]!.note, "You cancelled the plan.");
  }
});

test("review M1: an exit given back after a no never sells by itself in ANOTHER tab that had armed it; it asks (control: never set aside, tab B's live cross sells)", async () => {
  for (const setAside of [true, false]) {
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
    const ran: string[] = [];
    let open!: () => void;
    const sheet = new Promise<void>((r) => (open = r));
    let n = 0, t = T0;
    const px = { now: 1 };
    const tab = (name: string) => createOrderBook({
      load: async () => store.v, save: async (j) => void (store.v = j), now: () => t, price: async () => ({ px: px.now, at: t }),
      run: async (o: PriceOrder) => { ran.push(`${name}:${o.kind}`); if (name === "A") { await sheet; return "declined" as const; } return { recordId: name }; },
      newId: () => `o${++n}`, lock,
    });
    const a = tab("A"), b = tab("B");
    await a.addPlan(WIF, setAside ? [{ kind: "take-profit", triggerPx: 1.2 }, { kind: "stop-loss", triggerPx: 0.8 }] : [{ kind: "stop-loss", triggerPx: 0.8 }], 1);
    await b.tick(); t += 5000; // tab B sees every exit on its near side: armed there
    if (setAside) {
      px.now = 1.3; await a.tick(); t += 5000; await a.tick(); t += 5000; // tab A's take-profit: its sheet opens
      await new Promise((r) => setTimeout(r, 5));
      px.now = 0.5; // the price falls through the stop while A's sheet is open; the person says no
      open(); await a.settled();
    } else px.now = 0.5;
    for (let i = 0; i < 3; i++) { await b.tick(); t += 5000; }
    await b.settled();
    const sl = JSON.parse(store.v!).find((o: PriceOrder) => o.kind === "stop-loss");
    if (setAside) {
      assert.deepEqual(ran, ["A:take-profit"], "tab B never sells the given-back stop by itself");
      assert.equal(sl.status, "missed", "it asks");
    } else {
      assert.deepEqual(ran, ["B:stop-loss"], "control: armed in tab B, never set aside, its live cross sells");
    }
  }
});

test("review L1: with no device lock, this copy's own running exit is never swept as 'closed while it ran' while its sheet is open, and no new plan is taken then (control: a reopened app sweeps it)", async () => {
  const h = harness();
  let open!: () => void;
  const sheet = new Promise<void>((r) => (open = r));
  h.deps.run = async (o) => { h.ran.push({ ...o }); await sheet; return { recordId: "r" }; };
  await h.book.addPlan(WIF, [{ kind: "stop-loss", triggerPx: 0.9 }]);
  await tickN(h);
  h.px.now = 0.8;
  await h.book.tick(); await h.book.tick();
  await new Promise((r) => setTimeout(r, 5));
  await h.book.tick(); await h.book.tick();
  assert.equal((await h.book.list())[0]!.status, "running", "still running, its sheet open");
  await assert.rejects(h.book.addPlan(WIF, [{ kind: "stop-loss", triggerPx: 0.5 }], 0.8), /A sale of WIF is running now/);
  // control: ZeroFee closed with it running; a new copy over the same store sweeps it
  const reopened = harness({ saved: h.store.v });
  await tickN(reopened);
  assert.equal((await reopened.book.list())[0]!.status, "failed");
  open();
  await h.book.settled();
});
