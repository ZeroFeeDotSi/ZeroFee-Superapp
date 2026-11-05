// Trade paints from the device first, then from the network (a product review graded the market F on speed): the last list of
// each tab, the last coin pages opened and their charts are kept on the device (cache.ts: memory and localStorage, a
// day at most) and drawn in the first frame; the network's answer replaces them when it comes. A coin pressed on its way
// to its page is asked for before the finger lifts (prefetch), so its page and chart are there when it opens.
// Public display data only, never an input to a trade: the engines read prices through the market's own checks.
import { createStore, type Store } from "./cache.ts";
import type { Candle, CoinDetail, CoinRow, ListRead, Market, Range } from "./types.ts";
import type { ChainId } from "../types.ts";

/** A list, a page or a chart from the device: its value, and when it was read from the network (ms). */
export interface Painted<T> { v: T; at: number }
/** Which list: trending (a chain or all), New on a chain, or a search. */
export type ListKind = { kind: "trending"; chain: ChainId | "all" } | { kind: "new"; chain: ChainId } | { kind: "search"; q: string };
/** Shown "N min ago" only past this age; younger is just now. */
export const STALE_SHOW_MS = 60_000;
/** Kept on the device this long at most (the list's own "as of" covers older answers). */
export const PAINT_KEEP_MS = 24 * 3600_000;
/** A coin pressed again this soon isn't asked for again. */
export const PREFETCH_EVERY_MS = 15_000;
/** A chart on the device younger than this isn't warmed again for a row on screen or a range not picked yet. */
export const SEEN_FRESH_MS = 60_000;
/** The coin page's chart opens on this range (CoinPage's first range). */
export const FIRST_RANGE: Range = "1D";

export const listKey = (k: ListKind): string => (k.kind === "search" ? `search:${k.q.trim().toLowerCase()}` : `${k.kind}:${k.chain}`);
const coinKey = (chain: ChainId, a: string) => `coin:${chain}:${a}`;
const chartKey = (chain: ChainId, a: string, r: Range) => `chart:${chain}:${a}:${r}`;

export interface Paint {
  /** What the device has for a list, page or chart now (synchronous: the first frame). */
  list(k: ListKind): Painted<CoinRow[]> | undefined;
  coin(chain: ChainId, address: string): Painted<CoinDetail> | undefined;
  chart(chain: ChainId, address: string, range: Range): Painted<Candle[]> | undefined;
  /** Asks the network, keeps the answer, and returns it. `o.refresh`: the list on screen read again by itself (the
   *  background lane: never ahead of a coin page's own reads). */
  loadList(k: ListKind, o?: ListRead): Promise<CoinRow[] & { asOf?: number }>;
  loadCoin(chain: ChainId, address: string): Promise<CoinDetail>;
  loadChart(chain: ChainId, address: string, range: Range): Promise<Candle[] & { fromChain?: true }>;
  /** Today's prices for these rows (one call per chain), the rows returned with them; rows with none keep theirs. */
  livePrices(rows: readonly CoinRow[]): Promise<CoinRow[]>;
  /** Warms a coin's page and first chart (the finger is down on its row). Never throws. `o.seen`: the row is only on
   *  screen: its first chart is warmed in the background lane (never ahead of what the person asked for). */
  prefetch(row: Pick<CoinRow, "chain" | "address">, o?: { seen?: boolean }): void;
  /** Warms a coin's other ranges in the background (its page is open): a range tap then draws at once. Never throws. */
  warmRanges(chain: ChainId, address: string, ranges: readonly Range[]): void;
  /** A search's first frame (D145: instant): the coins on the lists already on the device that match, best first. The
   *  network's answer replaces them when it comes. */
  local(q: string): CoinRow[];
}

/** The lists a search looks through on the device: every chain's trending and newest lists. */
const LOCAL_LISTS: ListKind[] = [{ kind: "trending", chain: "all" }, ...(["sol", "hood", "bsc", "near"] as const).flatMap((chain): ListKind[] => [{ kind: "trending", chain }, { kind: "new", chain }])];
/** At most this many matches in a search's first frame. */
export const LOCAL_MAX = 20;

/**
 * The rows that match a search, best first, each coin once (pure). An address (a 0x one, or a Solana mint) matches only
 * itself, case aside for 0x; words match a symbol exactly, then a symbol that starts with them, then a name with a word
 * that starts with them; ties go to the deeper coin (liquidity, then market cap).
 */
export function matchRows(q: string, lists: readonly (readonly CoinRow[])[], max = LOCAL_MAX): CoinRow[] {
  const t = q.trim();
  if (!t) return [];
  const evm = /^0x[0-9a-fA-F]{40}$/.test(t), sol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t);
  const lo = t.toLowerCase();
  const rank = (r: CoinRow): number => {
    if (evm) return r.address.toLowerCase() === lo ? 0 : -1;
    if (sol) return r.address === t ? 0 : -1;
    const sym = r.symbol.toLowerCase(), name = r.name.toLowerCase();
    if (sym === lo) return 0;
    if (sym.startsWith(lo)) return 1;
    if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(lo))) return 2;
    return -1;
  };
  const seen = new Set<string>();
  const hits: [number, CoinRow][] = [];
  for (const rows of lists) for (const r of rows) {
    const k = `${r.chain}:${r.address.toLowerCase()}`;
    if (seen.has(k)) continue;
    const n = rank(r);
    if (n < 0) continue;
    seen.add(k);
    hits.push([n, r]);
  }
  const depth = (r: CoinRow) => (r.liquidityUsd ?? 0) * 1e3 + (r.marketCapUsd ?? 0) / 1e3;
  return hits.sort((a, b) => a[0] - b[0] || depth(b[1]) - depth(a[1])).slice(0, max).map(([, r]) => r);
}

export function createPaint(market: Market, o: { now?: () => number; store?: Store; storage?: Parameters<typeof createStore>[1] } = {}): Paint {
  const now = o.now ?? Date.now;
  const kept = o.store ?? createStore(now, o.storage);
  // ?demo's recorded market keeps its answers in memory only: a sample list is never painted in the real app later
  const sampleOnly = createStore(now, null);
  const store = { get: <T>(k: string) => (market.recorded ? sampleOnly.get<T>(k) : kept.get<T>(k)), set: <T>(k: string, v: T) => (market.recorded ? sampleOnly : kept).set(k, v) };
  const peek = <T>(key: string): Painted<T> | undefined => { const e = store.get<T>(key); return e && now() - e.at < PAINT_KEEP_MS ? e : undefined; };
  const keep = <T>(key: string, p: Promise<T>): Promise<T> => p.then((v) => { store.set(key, v); return v; });
  const pressed = new Map<string, number>(), seen = new Map<string, number>();
  // only a refresh passes its lane on; a first read keeps the market's own call exactly as before
  const ask = (k: ListKind, o?: ListRead) =>
    k.kind === "search" ? market.search(k.q)
      : k.kind === "new" ? (market.fresh?.(k.chain, ...(o?.refresh ? [o] : [])) ?? Promise.resolve([]))
      : o?.refresh ? market.trending(k.chain === "all" ? undefined : k.chain, o)
      : k.chain === "all" ? market.trending() : market.trending(k.chain);
  return {
    list: (k) => peek<CoinRow[]>(listKey(k)),
    coin: (c, a) => peek<CoinDetail>(coinKey(c, a)),
    chart: (c, a, r) => peek<Candle[]>(chartKey(c, a, r)),
    loadList: (k, o) => ask(k, o).then((rows) => {
      // an answer GeckoTerminal served from its own old copy ("as of") isn't kept as new: the device keeps the newest
      if (rows.asOf === undefined) store.set(listKey(k), [...rows]);
      return rows;
    }),
    loadCoin: (c, a) => keep(coinKey(c, a), market.coin(c, a)),
    loadChart: (c, a, r) => keep(chartKey(c, a, r), market.candles(c, a, r)),
    async livePrices(rows) {
      if (!market.prices) return [...rows];
      const by = new Map<ChainId, string[]>();
      for (const r of rows) (by.get(r.chain) ?? by.set(r.chain, []).get(r.chain)!).push(r.address);
      const got = new Map<string, number>();
      await Promise.all([...by].map(async ([chain, addrs]) => {
        try { for (const [a, p] of Object.entries(await market.prices!(chain, addrs.slice(0, 30)))) got.set(`${chain}:${a}`, p); } catch { /* the rows keep their prices */ }
      }));
      return rows.map((r) => { const p = got.get(`${r.chain}:${r.address}`); return p === undefined || p === r.priceUsd ? r : { ...r, priceUsd: p }; });
    },
    prefetch(row, o) {
      const k = `${row.chain}:${row.address}`;
      if (o?.seen) {
        // a row on screen: its first chart, unless the device has a fresh one; a press later still asks for everything
        const had = peek<Candle[]>(chartKey(row.chain, row.address, FIRST_RANGE));
        if ((had && now() - had.at < SEEN_FRESH_MS) || now() - (seen.get(k) ?? -Infinity) < SEEN_FRESH_MS) return;
        seen.set(k, now());
        if (seen.size > 200) seen.delete(seen.keys().next().value!);
        void keep(chartKey(row.chain, row.address, FIRST_RANGE), market.candles(row.chain, row.address, FIRST_RANGE, { warm: true })).catch(() => undefined);
        return;
      }
      if (now() - (pressed.get(k) ?? -Infinity) < PREFETCH_EVERY_MS) return;
      pressed.set(k, now());
      if (pressed.size > 200) pressed.delete(pressed.keys().next().value!);
      void keep(coinKey(row.chain, row.address), market.coin(row.chain, row.address)).catch(() => undefined);
      void keep(chartKey(row.chain, row.address, FIRST_RANGE), market.candles(row.chain, row.address, FIRST_RANGE)).catch(() => undefined);
    },
    warmRanges(chain, address, ranges) {
      if (market.recorded) return;
      for (const r of ranges) {
        const had = peek<Candle[]>(chartKey(chain, address, r));
        if (had && now() - had.at < SEEN_FRESH_MS) continue;
        void keep(chartKey(chain, address, r), market.candles(chain, address, r, { warm: true })).catch(() => undefined);
      }
    },
    local: (q) => matchRows(q, LOCAL_LISTS.map((k) => peek<CoinRow[]>(listKey(k))?.v ?? [])),
  };
}

/** How old a painted value is to say, or null when it is younger than STALE_SHOW_MS. */
export const staleFor = (at: number | undefined, nowMs: number): number | null => (at === undefined || nowMs - at < STALE_SHOW_MS ? null : nowMs - at);
