// T-1 landing 2: one order book per Trade runtime (orders.ts), kept in Trade's own device store ("orders"), priced by
// Trade's market and run by Trade's own quote and trade (tradeRunner: the session's caps, or the core's sheet). Nothing
// leaves the phone.
import type { Bridge } from "@zerofee/core/bridge";
import { NOT_RUN, createOrderBook, tradeRunner, type OrderBook } from "../orders.ts";
import type { TradeRuntime } from "../runtime.ts";
import { createStandingBook, standingRunner, type StandingBook } from "../standing.ts";

const books = new WeakMap<object, OrderBook>();
interface Feed { last?: { px: number; at: number }; stop: () => void }
const feeds = new Map<string, Feed>();
/** Stop every price feed the book opened (Trade left the screen): no reads in the background, and nothing seen before
 *  counts after. */
function stopFeeds() { for (const f of feeds.values()) f.stop(); feeds.clear(); }
export const ORDERS_KEY = "orders";

let sharedLock: Lock | undefined | null = null;
export function bookFor(rt: Pick<TradeRuntime, "svc" | "market">, bridge: Bridge): OrderBook {
  let b = books.get(rt.svc);
  if (!b) {
    if (sharedLock === null) sharedLock = deviceLock();
    b = createOrderBook({
      load: async () => {
        const r = await bridge.call<{ value: string | null }>("device.store.get", { key: ORDERS_KEY });
        if ("problem" in r) throw new Error(r.problem.whatHappened); // never read as empty, never overwritten
        return r.ok.value;
      },
      save: async (json) => {
        const r = await bridge.call("device.store.set", { key: ORDERS_KEY, value: json });
        if ("problem" in r) throw new Error(r.problem.whatHappened);
      },
      // the coin's live price with its own time (Trade's price feed: the chain's socket, or a read every few seconds),
      // never a cached answer as if new (T-1 L2 review M1/M2): orders.ts ignores reads over a minute old and counts a far
      // read only when its time moved on. Nothing known yet: no decision.
      price: async (chain, coin) => {
        const k = `${chain}:${coin}`;
        let f = feeds.get(k);
        if (!f) {
          const feed: Feed = { stop: () => undefined };
          feed.stop = rt.market.livePrice(chain, coin, (px, t) => { if (Number.isFinite(px) && px > 0 && Number.isFinite(t)) feed.last = { px, at: Math.min(t, Date.now()) }; });
          feeds.set(k, (f = feed));
        }
        return f.last;
      },
      run: tradeRunner(rt.svc as never),
      // one run per order across every tab of ZeroFee on this device (QA)
      ...(sharedLock ? { lock: sharedLock } : {}),
      // a damaged store's text, kept under its own name, never overwritten (QA)
      keepAside: async (raw) => {
        const r = await bridge.call("device.store.set", { key: `${ORDERS_KEY}.damaged.${Date.now()}`, value: raw });
        if ("problem" in r) throw new Error(r.problem.whatHappened);
      },
    });
    const pause = b.pause;
    b.pause = () => { pause(); stopFeeds(); };
    books.set(rt.svc, b);
  }
  return b;
}

type Lock = <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>) => Promise<T | typeof NOT_RUN>;
interface Channel { postMessage(m: unknown): void; addEventListener(t: "message", h: (e: { data: unknown }) => void): void }
/**
 * The lock every tab of ZeroFee on this device shares (QA, 3 Nov: the hosted web app is first-class, D87, so two tabs
 * must never run one stop-loss twice). navigator.locks where the browser has it (Safari 15.4+, every current one); else a
 * BroadcastChannel claim: a tab says it takes a name, waits a moment, and leaves it to any tab that claimed first (the
 * earlier claim, then the smaller tab id, wins) or that holds it now. The store's own lock has no fallback beyond that
 * claim's order: the per-order lock and the store's status check keep a run single.
 */
export function deviceLock(nav: { locks?: { request: (name: string, opts: { ifAvailable: boolean }, cb: (l: unknown) => Promise<unknown>) => Promise<unknown> } } | undefined = (globalThis as unknown as { navigator?: never }).navigator, channel: (() => Channel) | null = typeof BroadcastChannel === "function" ? () => new BroadcastChannel("zf-orders") as unknown as Channel : null, waitMs = 150): Lock | undefined {
  if (nav?.locks?.request) {
    const locks = nav.locks;
    const viaChannel = channel ? claimLock(channel(), waitMs) : undefined;
    return async <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>) => {
      let entered = false;
      try {
        return (await locks.request(name, { ifAvailable }, async (l) => { if (l === null) return NOT_RUN; entered = true; return fn(); })) as T | typeof NOT_RUN;
      } catch (e) {
        if (entered) throw e; // fn's own failure
        return viaChannel ? viaChannel(name, ifAvailable, fn) : fn(); // the browser refused locks here (an opaque origin)
      }
    };
  }
  return channel ? claimLock(channel(), waitMs) : undefined;
}

/** The BroadcastChannel claim (no navigator.locks): a tab says it takes a name, waits a moment, and leaves it to any tab
 *  that claimed first (the earlier claim, then the smaller tab id) or that holds it, this tab included (T-1 safety
 *  review M3). A wait (the store's lock) claims again after a short pause until it wins, and gives up after ~6 s: then
 *  the change fails and nothing is written or run. */
function claimLock(ch: Channel, waitMs: number): Lock {
  const me = Math.random().toString(36).slice(2);
  const held = new Map<string, string>(); // name -> the tab that holds it (others', and this tab's own)
  const claims = new Map<string, { t: number; tab: string }[]>();
  ch.addEventListener("message", (e) => {
    const m = e.data as { kind?: string; name?: string; tab?: string; t?: number };
    if (!m || typeof m.name !== "string" || typeof m.tab !== "string" || m.tab === me) return;
    if (m.kind === "claim" && typeof m.t === "number") claims.set(m.name, [...(claims.get(m.name) ?? []), { t: m.t, tab: m.tab }]);
    if (m.kind === "held") held.set(m.name, m.tab);
    if (m.kind === "free" && held.get(m.name) === m.tab) held.delete(m.name);
  });
  const once = async <T>(name: string, fn: () => Promise<T>): Promise<T | typeof NOT_RUN> => {
    if (held.has(name)) return NOT_RUN;
    const t = Date.now();
    claims.set(name, []);
    ch.postMessage({ kind: "claim", name, tab: me, t });
    await new Promise((r) => setTimeout(r, waitMs));
    const first = (claims.get(name) ?? []).some((c) => c.t < t || (c.t === t && c.tab < me));
    if (first || held.has(name)) return NOT_RUN;
    held.set(name, me);
    ch.postMessage({ kind: "held", name, tab: me });
    try { return await fn(); } finally { held.delete(name); ch.postMessage({ kind: "free", name, tab: me }); }
  };
  return async <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>) => {
    if (ifAvailable) return once(name, fn);
    for (let i = 0; i < 40; i++) {
      const r = await once(name, fn);
      if (r !== NOT_RUN) return r;
      await new Promise((res) => setTimeout(res, waitMs * (0.5 + Math.random())));
    }
    throw new Error("Another ZeroFee tab is busy with your orders. Try again.");
  };
}

const standingBooks = new WeakMap<object, StandingBook>();
export const STANDING_KEY = "standing";
/** T-2: one standing-buy book per Trade runtime, beside the price orders: Trade's own store ("standing"), the same device
 *  lock, a damaged store kept aside under its own name, each run Trade's own buy (standingRunner). */
export function standingFor(rt: Pick<TradeRuntime, "svc">, bridge: Bridge): StandingBook {
  let b = standingBooks.get(rt.svc);
  if (!b) {
    if (sharedLock === null) sharedLock = deviceLock();
    b = createStandingBook({
      load: async () => { const r = await bridge.call<{ value: string | null }>("device.store.get", { key: STANDING_KEY }); if ("problem" in r) throw new Error(r.problem.whatHappened); return r.ok.value; },
      save: async (json) => { const r = await bridge.call("device.store.set", { key: STANDING_KEY, value: json }); if ("problem" in r) throw new Error(r.problem.whatHappened); },
      keepAside: async (raw) => { const r = await bridge.call("device.store.set", { key: `${STANDING_KEY}.damaged.${Date.now()}`, value: raw }); if ("problem" in r) throw new Error(r.problem.whatHappened); },
      run: standingRunner(rt.svc as never),
      ...(sharedLock ? { lock: sharedLock } : {}),
    });
    standingBooks.set(rt.svc, b);
  }
  return b;
}
