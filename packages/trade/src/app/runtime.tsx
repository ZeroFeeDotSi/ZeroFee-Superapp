// The Trade app's screens share one runtime (runtime.ts: one market, one trade service per bridge), plus the app's tick and
// whether it is on screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { runtimeFor, setAppRuntime, type TradeRuntime } from "../runtime.ts";
import { createPaint, staleFor, type ListKind, type Paint } from "../market/paint.ts";
import { browserLoad, createLogoCache, type LogoCache, type LogoState } from "../market/logo-cache.ts";
import { rowLogo } from "../market/logo.ts";
import { keptList, listReadsNow, listRetryMs, liveReadsNow } from "./reads.ts";
import { createTicks, tickKey, type Tick, type Ticks } from "../market/ticks.ts";
import type { Candle, CoinDetail, CoinRow, Market, Range } from "../market/types.ts";
import type { ChainId } from "../types.ts";
export { CHAIN_NAME, LISTED, MARKET, NEAR_NOT_TRADED, OFFERED } from "../runtime.ts";
export { tickKey } from "../market/ticks.ts";
export type { ListKind } from "../market/paint.ts";
export type { Tick } from "../market/ticks.ts";
export type { LogoState } from "../market/logo-cache.ts";

/** `active`: Trade is the app on screen. The shell also renders its neighbours (instant swipes), so every network effect waits for it. */
interface Runtime extends TradeRuntime { tick: number; active: boolean }
const Ctx = createContext<Runtime | null>(null);
/** Trade's runtime handed to a part drawn outside Trade's tree (its history in the Activity centre, TradeApp.tsx). */
export const TradeRuntimeContext = Ctx;

export function TradeProvider({ bridge, active, children }: { bridge: Bridge; active: boolean; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const rt = useMemo(() => runtimeFor(bridge), [bridge]);
  // the reader (Wallet's "In trading") asks the runtime this app shows. In an effect, not in the memo: StrictMode runs a memo
  // twice and keeps one, and a registered twin would answer with sample balances the app never moved
  useEffect(() => { setAppRuntime(rt); }, [rt]);
  useEffect(() => rt.svc.on(() => setTick((n) => n + 1)), [rt]);
  const [resumed, setResumed] = useState(false);
  useEffect(() => { if (active && !resumed) { setResumed(true); void rt.svc.resume().catch(() => undefined); } }, [rt, active, resumed]);
  // the Trade session starts as Trade comes on screen, never at the tap (product decision, 4 Nov), and
  // again when the page is back after the shell ended it (the phone locked, the page hid: D18); never while it is hidden
  useEffect(() => {
    if (!active) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const open = () => { if (visible()) void rt.svc.open().catch(() => undefined); };
    open();
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", open);
    return () => document.removeEventListener("visibilitychange", open);
  }, [rt, active]);
  // D145: the chart's library (its own chunk) is fetched and parsed while the person looks at the list, so the first coin
  // page draws its chart at once; once, when the browser is idle after Trade is first on screen
  useEffect(() => {
    if (!active) return;
    const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    const warm = () => void import("lightweight-charts").catch(() => undefined);
    if (w.requestIdleCallback) { const n = w.requestIdleCallback(warm, { timeout: 2_000 }); return () => w.cancelIdleCallback?.(n); }
    const t = setTimeout(warm, 600);
    return () => clearTimeout(t);
  }, [active]);
  // the float's planner is Spending's engine (D52): the shell runs it while the apps are shown, whichever is on screen (H23)
  return <Ctx.Provider value={{ ...rt, tick, active }}>{children}</Ctx.Provider>;
}

/** The one-balance screens' model (float-view.ts), re-rendering on every change of it. */
export function useFloat(): { view: TradeRuntime["float"]; snap: ReturnType<TradeRuntime["float"]["snapshot"]> } {
  const { float } = useTrade();
  const [snap, setSnap] = useState(() => float.snapshot());
  useEffect(() => { setSnap(float.snapshot()); return float.subscribe(() => setSnap(float.snapshot())); }, [float]);
  return { view: float, snap };
}

export function useTrade(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("useTrade() is only available inside <TradeProvider>");
  return rt;
}

/** Re-runs `load` whenever the service changes (a trade landed, money arrived) or `deps` change, only while Trade is on screen (it keeps the last value meanwhile). */
export function useLive<T>(load: () => Promise<T>, deps: unknown[]): { value?: T; error?: unknown; reload: () => void } {
  const { tick, active } = useTrade();
  const [state, setState] = useState<{ value?: T; error?: unknown }>({});
  const [n, setN] = useState(0);
  // the first read goes when Trade is drawn, even beside another app (UX audit 4 Nov: the wallet chips still shimmered at
  // 412 ms after the tap, because nothing was read until Trade was on screen); after that, only while it is on screen
  const first = state.value === undefined && state.error === undefined;
  useEffect(() => {
    if (!liveReadsNow(active, first)) return;
    let live = true;
    load().then((value) => { if (live) setState({ value }); }, (error) => { if (live) setState((s) => ({ ...s, error })); });
    return () => { live = false; };
  }, [tick, n, active, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

// ---- Fast market data for the screens (market/paint.ts, logo-cache.ts, ticks.ts): one of each per market, so every
// screen paints from the same device copy and flashes from the same ticks.

/** The list's prices are read again this often while it is on screen (one call per chain), the list itself less often. */
export const LIST_PRICES_MS = 15_000, LIST_AGAIN_MS = 60_000;
/** Logos decoded ahead: about two screenfuls. */
export const LOGOS_AHEAD = 14;
const fast = new WeakMap<Market, { paint: Paint; logos: LogoCache; ticks: Ticks }>();
/** The market's paint, logo cache and ticks (made once per market). */
export function fastOf(market: Market): { paint: Paint; logos: LogoCache; ticks: Ticks } {
  let f = fast.get(market);
  if (!f) fast.set(market, (f = { paint: createPaint(market), logos: createLogoCache({ load: browserLoad }), ticks: createTicks() }));
  return f;
}
const visibleNow = () => typeof document === "undefined" || document.visibilityState === "visible";
const onVisibility = (f: () => void) => {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", f);
  return () => document.removeEventListener("visibilitychange", f);
};
const noteRows = (t: Ticks, rows: readonly CoinRow[]) => { for (const r of rows) t.note(tickKey(r.chain, r.address), r.priceUsd); };
/** The first two screenfuls' logos, at the size rows draw them (rowLogo). */
const aheadOf = (rows: readonly CoinRow[]) => rows.slice(0, LOGOS_AHEAD).map((r) => rowLogo(r.logoUrl));

/**
 * A list (trending on a chain or all, New on a chain, a search), painted from the device in the first frame and then
 * from the network; its prices read again every 15 s and the list every 60 s while it is on screen and the page is
 * visible. `k` null: no list (rows null). `staleMs`: how old the rows shown are, only once over a minute (else null).
 * Rows are never held back for anything else: a screen that filters them (Buy's refusals) filters what it is given.
 */
export function useMarketList(k: ListKind | null): { rows: CoinRow[] | null; staleMs: number | null; asOf?: number; failed: boolean; loading: boolean; retry: () => void } {
  const { market, active } = useTrade();
  const { paint, logos, ticks } = fastOf(market);
  const key = k ? JSON.stringify(k) : "";
  /** `fails`: reads failed in a row (its retry waits longer each time: listRetryMs). */
  type S = { key: string; rows: CoinRow[] | null; at?: number; asOf?: number; failed: boolean; loading: boolean; fails?: number };
  // a search the device hasn't answered before paints the matches on the lists it already holds (D145: the first frame,
  // never a 300 ms wait); the network's answer replaces them
  const painted = (): S => {
    const p = k ? keptList(paint, k) : undefined;
    const local = !p && k?.kind === "search" ? paint.local(k.q) : null;
    return { key, rows: p?.v ?? (local?.length ? local : null), ...(p ? { at: p.at } : {}), failed: false, loading: !!k };
  };
  const [state, setState] = useState<S>(painted);
  const [n, setN] = useState(0);
  /** The next read is the list's own timed refresh (not a first read, not a Retry). */
  const again = useRef(false);
  const [clock, setClock] = useState(() => Date.now());
  const visible = useSyncExternalStore(onVisibility, visibleNow, () => true);
  // a new question: the device's copy of its answer at once, never the last question's rows
  let shown = state;
  if (state.key !== key) { shown = painted(); setState(shown); }
  useEffect(() => { if (shown.rows) void logos.preload(aheadOf(shown.rows)); }, [key]);
  // the first read of a list goes when Trade is drawn, even beside another app, at the browser's next idle moment (UX audit
  // 4 Nov: rows were a skeleton for 0.56 s after the tap, because nothing was read until Trade was on screen, though it is
  // drawn next door); a search, a refresh and a Retry wait for Trade to be on screen as before
  const firstAside = !!k && listReadsNow({ active: false, kind: k.kind, hasRows: !!shown.rows }) && !active;
  useEffect(() => {
    if (!k || (!active && !firstAside)) return;
    let live = true;
    const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    const run = (f: () => void, ms: number) => {
      if (!active && w.requestIdleCallback) { const id = w.requestIdleCallback(f, { timeout: 1_500 }); return () => w.cancelIdleCallback?.(id); }
      const t = setTimeout(f, ms);
      return () => clearTimeout(t);
    };
    const stop = run(() => {
      // the list's own timed read goes in the background lane (D145: never ahead of a coin page); a first read or a Retry
      // is the person waiting
      const refresh = again.current;
      again.current = false;
      paint.loadList(k, refresh ? { refresh: true } : undefined).then((rows) => {
        if (!live) return;
        noteRows(ticks, rows);
        void logos.preload(aheadOf(rows));
        setState({ key, rows: [...rows], at: rows.asOf ?? Date.now(), ...(rows.asOf !== undefined ? { asOf: rows.asOf } : {}), failed: false, loading: false, fails: 0 });
      }, () => { if (live) setState((s) => (s.key === key ? { ...s, failed: s.rows === null, loading: false, fails: (s.fails ?? 0) + 1 } : s)); });
    }, k.kind === "search" ? 300 : 0);
    return () => { live = false; stop(); };
  }, [key, active, n, market, firstAside]);
  // a failed read is asked again by itself, sooner first (listRetryMs: 2 s, 4 s, 8 s … 30 s), while the rows the device
  // kept stay on screen; a new question, Trade off screen or the screen gone stops it
  const fails = shown.key === key ? shown.fails ?? 0 : 0;
  useEffect(() => {
    if (!k || !fails || !active) return;
    const t = setTimeout(() => setN((x) => x + 1), listRetryMs(fails));
    return () => clearTimeout(t);
  }, [key, fails, active]);
  const rowsRef = useRef(shown.rows);
  rowsRef.current = shown.rows;
  useEffect(() => {
    if (!k || k.kind === "search" || !active || !visible) return;
    let live = true, since = Date.now();
    const iv = setInterval(() => {
      setClock(Date.now());
      if (Date.now() - since >= LIST_AGAIN_MS) { since = Date.now(); again.current = true; setN((x) => x + 1); return; }
      const rows = rowsRef.current;
      if (!rows?.length) return;
      void paint.livePrices(rows.slice(0, 30)).then((fresh) => {
        if (!live) return;
        noteRows(ticks, fresh);
        setState((s) => (s.key === key && s.rows ? { ...s, rows: [...fresh, ...s.rows.slice(fresh.length)], at: Date.now() } : s));
      });
    }, LIST_PRICES_MS);
    return () => { live = false; clearInterval(iv); };
  }, [key, active, visible, market]);
  return { rows: shown.rows, staleMs: staleFor(shown.at, clock), ...(shown.asOf !== undefined ? { asOf: shown.asOf } : {}), failed: shown.failed, loading: shown.loading, retry: () => setN((x) => x + 1) };
}

/** For a row's onPointerDown: asks for the coin's page and first chart, and decodes its logo, before the tap lands. */
export function usePrefetchCoin(): (row: Pick<CoinRow, "chain" | "address" | "logoUrl">) => void {
  const { market } = useTrade();
  return useCallback((row: Pick<CoinRow, "chain" | "address" | "logoUrl">) => {
    const { paint, logos } = fastOf(market);
    paint.prefetch(row);
    void logos.preload([row.logoUrl]);
  }, [market]);
}

/** A row on screen this long warms its coin's first chart (the background lane), so the page opens on a drawn chart. */
export const SEEN_DWELL_MS = 400;
const seenWatch = new Map<Element, { timer?: ReturnType<typeof setTimeout>; go: () => void }>();
let seenObs: IntersectionObserver | undefined;
const seenObserver = (): IntersectionObserver | undefined => {
  if (seenObs || typeof IntersectionObserver !== "function") return seenObs;
  seenObs = new IntersectionObserver((es) => {
    for (const e of es) {
      const w = seenWatch.get(e.target);
      if (!w) continue;
      if (e.isIntersecting) w.timer ??= setTimeout(() => { w.timer = undefined; w.go(); }, SEEN_DWELL_MS);
      else if (w.timer) { clearTimeout(w.timer); w.timer = undefined; }
    }
  });
  return seenObs;
};
/** For a coin row's ref: once it has stayed on screen SEEN_DWELL_MS, its coin's first chart is warmed (paint.prefetch seen). */
export function useSeenPrefetch(row: Pick<CoinRow, "chain" | "address">): (el: Element | null) => void {
  const { market } = useTrade();
  const at = useRef<Element | null>(null);
  const go = useRef(() => {});
  go.current = () => fastOf(market).paint.prefetch(row, { seen: true });
  useEffect(() => () => { const el = at.current; if (el) { const w = seenWatch.get(el); if (w?.timer) clearTimeout(w.timer); seenWatch.delete(el); seenObs?.unobserve(el); } }, []);
  return useCallback((el: Element | null) => {
    const was = at.current;
    if (was === el) return;
    if (was) { const w = seenWatch.get(was); if (w?.timer) clearTimeout(w.timer); seenWatch.delete(was); seenObs?.unobserve(was); }
    at.current = el;
    const obs = el ? seenObserver() : undefined;
    if (el && obs) { seenWatch.set(el, { go: () => go.current() }); obs.observe(el); }
  }, []);
}

/** Every range of the coin page: once `on` (its first chart is drawn), the others are read behind it, once per coin. */
const ALL_RANGES: Range[] = ["1H", "1D", "1W", "1M", "1Y", "ALL"];
export function useWarmRanges(chain: ChainId, address: string, on: boolean): void {
  const { market } = useTrade();
  useEffect(() => {
    if (!on) return;
    // a beat after the first chart, so the page's own reads (its trades, its price) go first
    const t = setTimeout(() => fastOf(market).paint.warmRanges(chain, address, ALL_RANGES), 300);
    return () => clearTimeout(t);
  }, [market, chain, address, on]);
}

/** A coin page's details: the device's copy in the first frame (the last visit or a prefetch), then the network's; read
 *  again after every trade, as useLive is. `at`: when the details shown were read. */
export function useCoinDetail(chain: ChainId, address: string): { value?: CoinDetail; at?: number; error?: unknown; reload: () => void } {
  const { market } = useTrade();
  const { paint, ticks } = fastOf(market);
  return usePainted(() => paint.coin(chain, address), () => paint.loadCoin(chain, address).then((d) => { ticks.note(tickKey(chain, address), d.priceUsd); return d; }), [chain, address]);
}

/** A coin's chart for a range, painted from the device first (the same rules as useCoinDetail). */
export function useCoinChart(chain: ChainId, address: string, range: Range): { value?: Candle[] & { fromChain?: true }; at?: number; error?: unknown; reload: () => void } {
  const { market } = useTrade();
  const { paint } = fastOf(market);
  return usePainted<Candle[] & { fromChain?: true }>(() => paint.chart(chain, address, range), () => paint.loadChart(chain, address, range), [chain, address, range]);
}

function usePainted<T>(peek: () => { v: T; at: number } | undefined, load: () => Promise<T>, deps: unknown[]): { value?: T; at?: number; error?: unknown; reload: () => void } {
  const { tick, active } = useTrade();
  const key = JSON.stringify(deps);
  type S = { key: string; value?: T; at?: number; error?: unknown };
  const painted = (): S => { const p = peek(); return p ? { key, value: p.v, at: p.at } : { key }; };
  const [state, setState] = useState<S>(painted);
  let shown = state;
  if (state.key !== key) { shown = painted(); setState(shown); }
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    load().then((value) => { if (live) setState({ key, value, at: Date.now() }); }, (error) => { if (live) setState((s) => (s.key === key ? { ...s, error } : s)); });
    return () => { live = false; };
  }, [tick, n, active, key]);
  return { ...(shown.value !== undefined ? { value: shown.value } : {}), ...(shown.at !== undefined ? { at: shown.at } : {}), ...(shown.error !== undefined ? { error: shown.error } : {}), reload: () => setN((x) => x + 1) };
}

/** "up" or "down" for 2.4 s after the coin's shown price moved (key: tickKey(chain, address)), else null: the soft light
 *  under the number. Every price the lists and the coin page are given passes through the same ticks. */
export function useTick(coinKey: string): Tick | null {
  const { market } = useTrade();
  const { ticks } = fastOf(market);
  return useSyncExternalStore((f) => ticks.subscribe(coinKey, f), () => ticks.get(coinKey), () => null);
}

/** For a price a screen hears itself (the coin page's live price): passes it through the ticks. */
export function useNoteTick(): (coinKey: string, priceUsd: number | undefined) => void {
  const { market } = useTrade();
  return useCallback((k: string, p: number | undefined) => fastOf(market).ticks.note(k, p), [market]);
}

/** A logo to draw now. `src` only once it is decoded ("ok", or a bundled data: picture). "none": the monogram at once and
 *  for good, never a broken image first. "loading": the monogram's quiet place until it is ready (fade the picture in). */
export function useLogo(url: string | undefined): { src?: string; state: LogoState } {
  const { market } = useTrade();
  const { logos } = fastOf(market);
  const inline = !!url && url.startsWith("data:image/");
  const st = useSyncExternalStore((f) => logos.subscribe((u) => { if (u === url) f(); }), () => (url && !inline ? logos.state(url) : undefined), () => undefined);
  useEffect(() => { if (url && !inline && st === undefined) void logos.preload([url]); }, [url, st, inline, logos]);
  if (!url) return { state: "none" };
  if (inline || st === "ok") return { src: url, state: "ok" };
  return { state: st === "none" ? "none" : "loading" };
}
