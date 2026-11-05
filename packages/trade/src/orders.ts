// T-1 (master plan Part 1 §4; QA's GO, 3 Nov), landing 1: price orders on spot coins, kept on the phone and run by the
// phone. A limit buy ("buy $20 of BONK if it drops to $0.000021"), a take-profit and a stop-loss ("sell all if it
// reaches / falls to …"). The rules QA set, each kept here:
// - NOTHING IS PRE-SIGNED: an order is a rule (coin, side, dollars, trigger price, an end at most 7 days on). When the
//   price crosses, the ordinary trade runs then (`run`: Trade's own quote and trade: inside Trade's session caps, or the
//   core's sheet). No ZeroFee server holds a key, a signed transaction or the rule (D37); no relay watcher.
// - A CROSS RUNS ONLY WHEN THIS RUN OF THE APP SAW IT HAPPEN: the order was seen on the near side of its trigger while
//   ZeroFee was open and on screen, then on the far side. A price already past the trigger the first time it is looked
//   at (it crossed while ZeroFee was closed or hidden) is "missed": it ASKS ("Price passed while ZeroFee was closed. Sell
//   now?") and runs only on the person's tap (runMissed). Leaving the screen forgets what was seen (pause), so a cross
//   while hidden asks too.
// - Each order runs at most once; a "no" on the sheet stops it (never a second sheet on the next price).
// ST-B (master plan Part 1 §5, QA's GO 3 Nov): an EXIT PLAN for a held coin is up to three of these orders sharing one
// `plan` id: a take-profit, a stop-loss and a "sell-after" (sell all at a time). One plan per coin (a new one replaces
// it). The first exit to start ends the others in the same store change (so two tabs or two crossings never sell twice);
// a "no" on its sheet or a trade that didn't go gives the others back. A time that came while ZeroFee was closed or
// hidden asks, like a price. An exit that finds the coin no longer held ends the plan in plain words, never retries.
import type { ChainId } from "./types.ts";

export type OrderKind = "limit-buy" | "take-profit" | "stop-loss" | "sell-after";
export type OrderStatus = "waiting" | "missed" | "running" | "done" | "stopped" | "failed" | "expired" | "cancelled";
export interface PriceOrder {
  id: string; chain: ChainId; coin: string; symbol: string; kind: OrderKind;
  /** The coin's price that starts it, in dollars. */
  triggerPx: number;
  /** A limit buy: how many dollars to buy. A take-profit or stop-loss sells all of the coin held when it runs. */
  usd?: number;
  madeAt: number; endsAt: number; status: OrderStatus;
  /** One plain line for the person: why it stopped, failed or waits for a tap. */
  note?: string;
  /** The trade it became (Activity's record). */
  recordId?: string;
  /** ST-B: the exit plan it belongs to (one per coin). */
  plan?: string;
  /** A sell-after: when it sells (ms). Its `triggerPx` is the price when the plan was made (for its words only). */
  at?: number;
  /** An exit set aside because this sibling went first: given back if that one's sheet got a no or it didn't go. */
  by?: string;
}

/** An order lives at most this long (QA: ≤ 7 days). */
export const ORDER_MAX_DAYS = 7;
const DAY = 86_400_000;
/** The line on the order sheet (QA: the honest line). */
export const ORDER_RUNS_LINE = "Runs while ZeroFee is open, and the next time you open it.";
export const MISSED_LINE = (o: Pick<PriceOrder, "kind" | "symbol" | "usd">) => `${o.kind === "sell-after" ? "The time came" : "It hit your price"} while ZeroFee was closed. ${o.kind === "limit-buy" ? `Buy $${(o.usd ?? 0).toFixed(2)}` : "Sell all"} now?`;
/** What a take-profit or stop-loss sells, said on its sheet (review M3): everything held when it runs. */
export const SELLS_ALL_LINE = (symbol: string) => `It sells all the ${symbol} you hold when it runs.`;

/** ST-B: an exit that found the coin no longer held (sold by the person, or by AgentZero's copy job): the plan ends. */
export const NONE_HELD_LINE = (symbol: string) => `You don't hold ${symbol} any more. The sell plan ended.`;
/** ST-B: the other exits, while one of them runs. */
export const SIBLING_WENT_LINE = "Another exit in this plan went first.";
/** ST-B: a sell-after is 1 hour to just under the plan's 7 days on. */
export const EXIT_MAX_HOURS = ORDER_MAX_DAYS * 24 - 1;
const HOUR = 3_600_000;

/** Has the price reached the order's trigger? A limit buy and a stop-loss at or under it; a take-profit at or over it. */
export const crossed = (o: Pick<PriceOrder, "kind" | "triggerPx">, px: number): boolean => (o.kind === "take-profit" ? px >= o.triggerPx : px <= o.triggerPx);

/** Why a new order can't be kept, in plain words, or null. `px`: the price now (a trigger already reached is refused:
 *  that is a trade now, not an order). */
export function orderRefusal(o: Pick<PriceOrder, "kind" | "triggerPx" | "usd" | "symbol">, px: number | undefined, days: number): string | null {
  if (!(typeof o.triggerPx === "number" && Number.isFinite(o.triggerPx) && o.triggerPx > 0)) return "Type the price, in dollars.";
  if (o.kind === "limit-buy" && !(typeof o.usd === "number" && Number.isFinite(o.usd) && o.usd > 0)) return "Type how many dollars to buy.";
  if (!(Number.isInteger(days) && days >= 1 && days <= ORDER_MAX_DAYS)) return `An order lasts 1 to ${ORDER_MAX_DAYS} days.`;
  if (!(typeof px === "number" && Number.isFinite(px) && px > 0)) return `${o.symbol}'s price can't be read right now, so the order wasn't made.`;
  if (crossed(o, px)) return o.kind === "limit-buy" ? `${o.symbol} is already at or under that price. Buy now instead.` : o.kind === "take-profit" ? `${o.symbol} is already at or over that price. Sell now instead.` : `${o.symbol} is already at or under that price. Sell now instead.`;
  return null;
}

/** ST-B: one exit in a plan, as the sheet asks for it. */
export type Exit = { kind: "take-profit" | "stop-loss"; triggerPx: number } | { kind: "sell-after"; hours: number };
/** ST-B: why an exit plan can't be kept, in plain words, or null. `px`: the price now. */
export function planRefusal(symbol: string, exits: Exit[], px: number | undefined): string | null {
  if (!exits.length) return "Pick at least one way out.";
  if (exits.length > 3 || new Set(exits.map((e) => e.kind)).size !== exits.length) return "A plan has one of each: a rise, a fall, a time.";
  for (const e of exits) {
    if (e.kind === "sell-after") { if (!(Number.isInteger(e.hours) && e.hours >= 1 && e.hours <= EXIT_MAX_HOURS)) return "Sell after 1 hour to 6 days."; continue; }
    if (!["take-profit", "stop-loss"].includes(e.kind)) return "Pick at least one way out.";
    const why = orderRefusal({ kind: e.kind, triggerPx: e.triggerPx, symbol }, px, ORDER_MAX_DAYS);
    if (why) return why;
  }
  if (!(typeof px === "number" && Number.isFinite(px) && px > 0)) return `${symbol}'s price can't be read right now, so the plan wasn't made.`;
  return null;
}

/** What the book needs: where it keeps its orders (the phone's own store), the time, a coin's price now, and the trade. */
export interface OrderBookDeps {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  now?: () => number;
  /** The coin's price now in dollars (the market's), or undefined when it can't be read. With `at`, a read older than a
   *  minute decides nothing (review M4: a cached price never runs an order). */
  price(chain: ChainId, coin: string): Promise<number | { px: number; at: number } | undefined>;
  /** Run the order's trade now (Trade's quote + trade; D143: no sheet, the core signs it or refuses it, named).
   *  "declined": a record that says no (none asks now). `note`: it went but isn't finished (Activity follows it). A
   *  throw: it failed, with its words. */
  run(o: PriceOrder): Promise<{ recordId: string; note?: string } | "declined" | "none-held">;
  newId?: () => string;
  /** Keep a damaged store's text aside, untouched (QA: a stop-loss silently lost is money). Throws if it can't: then the
   *  book acts as a store that can't be read (nothing saved over it). */
  keepAside?(raw: string): Promise<void>;
  /** A lock shared by every copy of ZeroFee on this device (web: other tabs; navigator.locks, a BroadcastChannel claim as
   *  the fallback). `ifAvailable`: if another copy holds it, `fn` doesn't run and the answer is NOT_RUN. None: one copy. */
  lock?<T>(name: string, ifAvailable: boolean, fn: () => Promise<T>): Promise<T | typeof NOT_RUN>;
}
/** A lock held by another copy of ZeroFee (another tab): the step was left to it. */
export const NOT_RUN: unique symbol = Symbol("not run");
const STORE_LOCK = "zf-orders-store";
const orderLock = (id: string) => `zf-order-${id}`;

/** What the screen says when the store was damaged (QA, 3 Nov). */
export const DAMAGED_LINE = "Your price orders couldn't be read. None will run until you set them again.";

const KINDS: readonly OrderKind[] = ["limit-buy", "take-profit", "stop-loss", "sell-after"];
const STATUSES: readonly OrderStatus[] = ["waiting", "missed", "running", "done", "stopped", "failed", "expired", "cancelled"];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A stored order the book will act on, or null (review M5: a crafted or damaged record is dropped, never run). */
function readOrder(x: any, t: number): PriceOrder | null {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id || typeof x.chain !== "string" || typeof x.coin !== "string" || typeof x.symbol !== "string") return null;
  if (!KINDS.includes(x.kind) || !STATUSES.includes(x.status)) return null;
  if (!(num(x.triggerPx) && x.triggerPx > 0) || !num(x.madeAt) || !num(x.endsAt) || x.endsAt <= x.madeAt || x.endsAt - x.madeAt > ORDER_MAX_DAYS * DAY) return null;
  if (x.kind === "limit-buy" && !(num(x.usd) && x.usd > 0)) return null;
  if (x.plan !== undefined && (typeof x.plan !== "string" || !x.plan || x.kind === "limit-buy")) return null;
  if (x.by !== undefined && typeof x.by !== "string") return null;
  // a sell-after: only in a plan, its time after it was made and inside its end
  if ((x.kind === "sell-after") !== (x.at !== undefined)) return null;
  if (x.kind === "sell-after" && (!x.plan || !num(x.at) || x.at <= x.madeAt || x.at >= x.endsAt)) return null;
  void t; // dates past what an order made now could have are not damage (a clock set back): such an order just never runs (tick)
  return x as PriceOrder;
}
/** Far-side reads in a row before a seen cross runs (review M4: one bad tick never runs an order). */
const FAR_READS = 2;
const STALE_MS = 60_000;
const READ_MS = 10_000;

export function createOrderBook(d: OrderBookDeps) {
  const now = d.now ?? Date.now;
  const lock = <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>): Promise<T | typeof NOT_RUN> => (d.lock ? d.lock(name, ifAvailable, fn) : fn());
  let orders: PriceOrder[] = [];
  let loaded = false;
  /** Orders seen on the near side of their trigger while on screen, by the screen visit (epoch) that saw them: only these
   *  may run by themselves. pause() starts a new visit, so nothing seen before it counts (review L7). */
  const armed = new Map<string, number>();
  const far = new Map<string, number>();
  /** When the last far read counted was priced: a repeat of the same price data never counts twice (T-1 L2 review M1). */
  const farAt = new Map<string, number>();
  let epoch = 0;
  let ticking = false;
  const inflight = new Set<Promise<void>>();
  /** Orders this copy is running now (its sheet may be open): never swept as "closed while it ran" (review L1: with no
   *  device lock the sweep can't tell its own run from one left by a closed app). */
  const mine = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  /** This copy's changes, one at a time. Never held across a trade (review H1: a sheet open for minutes never blocks a
   *  cancel, a tap or another order). */
  const one = <T>(f: () => Promise<T> | T): Promise<T> => { const r = queue.then(f); queue = r.then(() => undefined, () => undefined); return r; };
  /** The store was damaged: its text kept aside, nothing runs, nothing is written over it until the person makes a new
   *  order (QA: a stop-loss silently lost is money). */
  let damaged = false;
  let aside: string | null = null;
  let asideKept = true;

  /** Read the store into `orders` (the store is the truth: another tab may have changed it). */
  async function reload(): Promise<void> {
    const raw = await d.load(); // a store that can't be read throws (review L8): never treated as empty and overwritten
    let parsed: unknown = [];
    let bad = false;
    try { parsed = raw ? JSON.parse(raw) : []; } catch { bad = true; }
    if (!Array.isArray(parsed)) bad = true;
    const seen = new Set<string>();
    const list = (Array.isArray(parsed) ? parsed : []).map((x) => readOrder(x, now())).filter((o): o is PriceOrder => !!o && !seen.has(o.id) && !!seen.add(o.id));
    // any record dropped is damage too: never a stop-loss lost without a word
    if (Array.isArray(parsed) && list.length !== parsed.length) bad = true;
    if (bad && raw) {
      // damaged first, so the screen says so whatever happens next (T-1 safety review M1)
      damaged = true;
      orders = [];
      if (raw !== aside) {
        try { if (!d.keepAside) throw new Error("nowhere"); await d.keepAside(raw); aside = raw; asideKept = true; }
        catch { asideKept = false; } // not kept: nothing is ever written over it (add refuses)
      }
    } else {
      damaged = false;
      orders = list;
    }
    loaded = true;
  }
  const ready = async (): Promise<PriceOrder[]> => { if (!loaded) await one(() => lock(STORE_LOCK, false, reload)); return orders; };
  // while damaged, nothing is written over the store (its copy is aside) until the person makes an order
  const save = () => (damaged ? Promise.resolve() : d.save(JSON.stringify(orders)));
  /** One change, on the store as it is now (read again under the store's lock, then written back): another tab's change
   *  is never undone by this copy's old view of it. `f` gets the order by id, fresh. */
  const change = <T>(f: () => Promise<T> | T): Promise<T | typeof NOT_RUN> => one(() => lock(STORE_LOCK, false, async () => {
    await reload();
    try { const r = await f(); await save(); return r; }
    catch (e) { loaded = false; throw e; } // not saved: this copy reads the store again before anything else
  }));
  const fresh = (id: string) => orders.find((x) => x.id === id);
  /** ST-B: the open exits that share `o`'s plan. */
  const siblings = (o: PriceOrder) => (o.plan ? orders.filter((s) => s.id !== o.id && s.plan === o.plan && (s.status === "waiting" || s.status === "missed")) : []);
  const expire = (o: PriceOrder) => { Object.assign(o, { status: "expired", note: "Its time ran out. Nothing was traded." }); armed.delete(o.id); far.delete(o.id); };

  /** Run order `id`'s trade, once across every tab: under the order's own lock (if another tab holds it, this one leaves
   *  it to that tab), claimed on the store as it is now (it must still be `from`), the trade outside the store's lock,
   *  the end written back. */
  function start(id: string, from: OrderStatus, visit?: number): Promise<void> {
    const p = (async () => {
      await lock(orderLock(id), true, async () => {
        let ran: PriceOrder | undefined;
        const claimed = await change(async () => {
          // a cross seen in a visit that has ended (pause while the claim waited) runs nothing (second review M1)
          if (visit !== undefined && visit !== epoch) return false;
          const o = fresh(id);
          if (!o || o.status !== from) return false; // cancelled, or run by this or another tab: never runs again
          if (now() >= o.endsAt) { expire(o); return false; }
          o.status = "running";
          delete o.note;
          armed.delete(id); far.delete(id);
          // ST-B: the plan's other exits are set aside in this same change, so none of them can start (here or in
          // another tab) while this one runs
          for (const s of siblings(o)) { Object.assign(s, { status: "cancelled", note: SIBLING_WENT_LINE, by: id }); armed.delete(s.id); far.delete(s.id); }
          ran = { ...o };
          mine.add(id);
          return true;
        }).catch(() => false); // a claim that can't be saved is no claim: nothing runs (second review M2)
        if (claimed !== true || !ran) return;
        let end: Partial<PriceOrder>;
        /** ST-B: what happens to the exits set aside for this one: given back (a no, or it didn't go), or ended. */
        let others: "back" | "ended" | "stay" = "stay";
        try {
          const r = await d.run(ran);
          if (r === "declined") { end = { status: "stopped", note: "You said no, so it stopped." }; others = "back"; }
          else if (r === "none-held") {
            // sold already (by the person, or AgentZero's copy job): the plan ends in plain words, never a retry (QA)
            end = ran.plan ? { status: "stopped", note: NONE_HELD_LINE(ran.symbol) } : { status: "failed", note: `You hold no ${ran.symbol} now, so nothing was sold.` };
            others = "ended";
          } else end = { status: "done", recordId: r.recordId, ...(r.note ? { note: r.note } : {}) };
        } catch (e) {
          end = { status: "failed", note: String((e as { problem?: { whatHappened?: string } })?.problem?.whatHappened ?? "It didn't go. Nothing was traded.").slice(0, 200) };
          others = "back";
        }
        await change(() => {
          const o = fresh(id);
          if (o) Object.assign(o, end);
          for (const s of orders) {
            if (!ran!.plan || s.plan !== ran!.plan || s.by !== id || s.status !== "cancelled") continue;
            if (others === "ended") s.note = NONE_HELD_LINE(s.symbol);
            // given back: waiting again, never armed (its next look arms it, or asks if its price or time has passed)
            // given back under a NEW id (review M1): every tab's and every pending look's arming is keyed by id, so none of
            // it counts; the exit runs by itself only after a new look on its near side, else it asks
            else if (others === "back" && now() < s.endsAt) {
              armed.delete(s.id); far.delete(s.id); farAt.delete(s.id);
              Object.assign(s, { status: "waiting", id: d.newId?.() ?? `o${now().toString(36)}g${Math.random().toString(36).slice(2, 8)}` });
              delete s.note; delete s.by;
            }
          }
        });
      });
    })().catch(() => undefined).finally(() => mine.delete(id)); // never an unhandled rejection
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
    return p;
  }

  return {
    /** The store was damaged (DAMAGED_LINE on screen until a new order is made). */
    damaged: (): boolean => damaged,
    /** Copies (second review L5): a screen can't change an order by changing what it was shown. */
    async list(): Promise<PriceOrder[]> { await ready(); return orders.map((o) => ({ ...o })).sort((a, b) => b.madeAt - a.madeAt); },
    /** Keep a new order (checked: orderRefusal). Returns it, or throws Error(plain words). `shownPx`: the price the person
     *  saw on the sheet (T-1 L2 review L5): the order is checked against it. */
    async add(o: Omit<PriceOrder, "id" | "madeAt" | "endsAt" | "status">, days: number, shownPx?: number): Promise<PriceOrder> {
      await ready();
      const read = num(shownPx) && shownPx > 0 ? shownPx : await d.price(o.chain, o.coin).catch(() => undefined);
      const px = typeof read === "number" ? read : read && now() - read.at <= STALE_MS ? read.px : undefined;
      const why = orderRefusal(o, px, days);
      if (why) throw new Error(why);
      const made = await change(async () => {
        if (damaged && !asideKept) throw new Error("Your old price orders (repeat buys) couldn't be backed up, so a new one can't be saved yet.");
        damaged = false; // the person sets orders again: the store is theirs to write (the damaged copy stays aside)
        const t = now();
        const m: PriceOrder = { ...o, id: d.newId?.() ?? `o${t.toString(36)}${Math.random().toString(36).slice(2, 8)}`, madeAt: t, endsAt: t + days * DAY, status: "waiting" };
        orders.push(m);
        armed.set(m.id, epoch); // made on screen with the price on the near side: seen in this visit
        return m;
      });
      if (made === NOT_RUN) throw new Error("The order wasn't made. Try again.");
      return made;
    },
    /** ST-B: keep an exit plan for a held coin (checked: planRefusal): up to three exits sharing one plan id, for 7 days.
     *  It replaces the coin's open plan in the same change. Returns the exits kept, or throws Error(plain words). */
    async addPlan(c: Pick<PriceOrder, "chain" | "coin" | "symbol">, exits: Exit[], shownPx?: number): Promise<PriceOrder[]> {
      await ready();
      const read = num(shownPx) && shownPx > 0 ? shownPx : await d.price(c.chain, c.coin).catch(() => undefined);
      const px = typeof read === "number" ? read : read && now() - read.at <= STALE_MS ? read.px : undefined;
      const why = planRefusal(c.symbol, exits, px);
      if (why) throw new Error(why);
      const made = await change(async () => {
        if (damaged && !asideKept) throw new Error("Your old price orders (repeat buys) couldn't be backed up, so a new one can't be saved yet.");
        const mine = orders.filter((o) => o.plan && o.chain === c.chain && o.coin === c.coin);
        if (mine.some((o) => o.status === "running")) throw new Error(`A sale of ${c.symbol} is running now. Try again when it ends.`);
        damaged = false;
        for (const o of mine) if (o.status === "waiting" || o.status === "missed") { Object.assign(o, { status: "cancelled", note: "A new sell plan took its place." }); armed.delete(o.id); far.delete(o.id); }
        const t = now();
        const plan = `p${t.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const kept = exits.map((e, i): PriceOrder => ({
          id: d.newId?.() ?? `o${t.toString(36)}${i}${Math.random().toString(36).slice(2, 8)}`,
          chain: c.chain, coin: c.coin, symbol: c.symbol, kind: e.kind, plan, madeAt: t, endsAt: t + ORDER_MAX_DAYS * DAY, status: "waiting",
          ...(e.kind === "sell-after" ? { triggerPx: px!, at: t + e.hours * HOUR } : { triggerPx: e.triggerPx }),
        }));
        for (const k of kept) { orders.push(k); armed.set(k.id, epoch); } // made on screen, each on its near side
        return kept;
      });
      if (made === NOT_RUN) throw new Error("The plan wasn't made. Try again.");
      return made;
    },
    /** ST-B: end a plan: every exit still waiting or asking is cancelled. False when none was. */
    async cancelPlan(plan: string): Promise<boolean> {
      const r = await change(() => {
        let n = 0;
        for (const o of orders) {
          if (o.plan !== plan) continue;
          if (o.status === "waiting" || o.status === "missed") { o.status = "cancelled"; delete o.note; armed.delete(o.id); far.delete(o.id); n++; }
          // set aside while a sibling runs: never given back after this (a no on that sheet keeps the plan ended)
          else if (o.status === "cancelled" && o.by) { delete o.by; o.note = "You cancelled the plan."; n++; }
        }
        return n > 0;
      });
      return r === true;
    },
    /** Cancel (review H1: never behind a trade's sheet). A running or ended order can't be cancelled: false. */
    async cancel(id: string): Promise<boolean> {
      armed.delete(id); far.delete(id);
      const r = await change(() => { const o = fresh(id); if (!o || (o.status !== "waiting" && o.status !== "missed")) return false; o.status = "cancelled"; return true; });
      return r === true;
    },
    /** One look at every open order's price, while Trade is on screen. Runs an order only on a cross this visit saw, read
     *  far twice in a row. A tick already under way makes this one a no-op (a timer never piles ticks up). */
    async tick(): Promise<void> {
      if (ticking) return;
      ticking = true;
      const visit = epoch;
      try {
        await one(() => lock(STORE_LOCK, false, reload)); // the store as it is now (another tab may have run or cancelled)
        for (const snap of orders.map((o) => ({ ...o }))) {
          const id = snap.id;
          // "running" with nobody holding its lock: it was running when ZeroFee closed; it may or may not have traded, and
          // never runs again by itself (another tab still running it holds the lock: left alone)
          if (snap.status !== "waiting") { armed.delete(id); far.delete(id); farAt.delete(id); } // only a waiting order is ever armed (review M1)
          if (snap.status === "running" && mine.has(id)) continue; // this copy's own run, its sheet maybe open (review L1)
          if (snap.status === "running") { await lock(orderLock(id), true, () => change(() => { const o = fresh(id); if (o?.status === "running") Object.assign(o, { status: "failed", note: "ZeroFee closed while it ran. Check Activity before trying again." }); })); continue; }
          if (snap.status === "missed" && now() >= snap.endsAt) { await change(() => { const o = fresh(id); if (o?.status === "missed") expire(o); }); continue; }
          if (snap.status !== "waiting") continue;
          // dated past what an order made now could be (a clock set back, or a crafted record): it never runs (second review L2)
          if (snap.madeAt > now() + DAY || snap.endsAt > now() + ORDER_MAX_DAYS * DAY) continue;
          if (now() >= snap.endsAt) { await change(() => { const o = fresh(id); if (o?.status === "waiting") expire(o); }); continue; }
          // ST-B, a sell-after: it runs by itself only when this visit saw the time before it came; a time that came while
          // ZeroFee was closed or hidden asks (never sells on open)
          if (snap.kind === "sell-after") {
            if (now() < snap.at!) armed.set(id, visit);
            else if (armed.get(id) === visit) void start(id, "waiting", visit);
            else await change(() => { const o = fresh(id); if (o?.status === "waiting") { Object.assign(o, { status: "missed", note: MISSED_LINE(o) }); armed.delete(id); } });
            continue;
          }
          // a read that never answers ends after 10 s, so it can't hold every later look (second review L1)
          let timer: ReturnType<typeof setTimeout> | undefined;
          const read = await Promise.race([d.price(snap.chain, snap.coin).catch(() => undefined), new Promise<undefined>((r) => (timer = setTimeout(r, READ_MS, undefined)))]).finally(() => clearTimeout(timer));
          if (epoch !== visit) return; // Trade left the screen during the read: this visit decides nothing more
          const px = typeof read === "number" ? read : read && now() - read.at <= STALE_MS ? read.px : undefined;
          if (!(num(px) && px > 0)) { far.delete(id); continue; } // no price, or an old one: no decision, and the far reads start again (L6)
          if (!crossed(snap, px)) { armed.set(id, visit); far.delete(id); farAt.delete(id); continue; }
          if (armed.get(id) === visit) {
            const at = typeof read === "object" && read ? read.at : undefined;
            if (at !== undefined) { const was = farAt.get(id); if (was !== undefined && at <= was) continue; farAt.set(id, at); }
            const n = (far.get(id) ?? 0) + 1;
            far.set(id, n);
            if (n >= FAR_READS) void start(id, "waiting", visit);
          } else await change(() => { const o = fresh(id); if (o?.status === "waiting") { Object.assign(o, { status: "missed", note: MISSED_LINE(o) }); armed.delete(id); far.delete(id); } });
        }
      } finally {
        ticking = false;
      }
    },
    /** Trade left the screen (or the phone locked): what was seen is forgotten, so a cross while away asks. */
    pause(): void { epoch++; armed.clear(); far.clear(); farAt.clear(); },
    /** The person's tap on a missed order: it runs now (the same trade: the session's caps, or the sheet). */
    async runMissed(id: string): Promise<void> { await ready(); await start(id, "missed"); },
    /** Every trade the book started has ended (tests, and a screen that waits for its line). */
    async settled(): Promise<void> { while (inflight.size) await Promise.all([...inflight]); },
  };
}
export type OrderBook = ReturnType<typeof createOrderBook>;

/** The order's trade, through Trade's own service (the same quote and trade as a tap on Buy or Sell: inside Trade's
 *  session caps, or the core's sheet). A limit buy buys its dollars; a take-profit or stop-loss sells all held then. */
export function tradeRunner(svc: {
  quote(side: "buy" | "sell", chain: ChainId, coin: string, amount: { usd: number } | { raw: string }): Promise<unknown>;
  trade(p: never, origin?: string): Promise<{ id: string; status: string; problem?: { whatHappened: string } }>;
  held(chain: ChainId, coin: string): Promise<string>;
}): OrderBookDeps["run"] {
  return async (o) => {
    let amount: { usd: number } | { raw: string };
    if (o.kind === "limit-buy") amount = { usd: o.usd! };
    else {
      const raw = await svc.held(o.chain, o.coin);
      // nothing held (sold already, by the person or AgentZero's copy job): the book says so, never a retry (ST-B)
      if (!(/^\d+$/.test(raw) && BigInt(raw) > 0n)) return "none-held";
      amount = { raw };
    }
    const p = await svc.quote(o.kind === "limit-buy" ? "buy" : "sell", o.chain, o.coin, amount);
    const rec = await svc.trade(p as never, `order:${o.id}`);           // its own trade, never folded into a tap's (service.trade)
    if (rec.status === "declined") return "declined";
    if (rec.status === "failed" || rec.status === "expired") throw { problem: rec.problem ?? { whatHappened: "It didn't go. Nothing was traded." } };
    // anything but done (on hold, confirming, sent but unconfirmed) ends the order, never re-runs it, and says so (review M2)
    return rec.status === "done" ? { recordId: rec.id } : { recordId: rec.id, note: "Still finishing. See it in Activity." };
  };
}
