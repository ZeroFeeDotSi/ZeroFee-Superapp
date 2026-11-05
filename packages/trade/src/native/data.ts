// Native coins' market data (display only, never an input to a swap): 1Click's token list (which coins); GeckoTerminal
// (product decision, 5 Nov) for the list's prices, 24 h moves, market cap, FDV, volume and logos (tokens/multi: one call per network
// per 30 coins, all at once), a coin's pools and its chart; CoinGecko only where GeckoTerminal has no token or no day's
// move for a coin (coins/markets, one call) and no pool for its chart (market_chart). Every market call goes through the
// build's relay only (VITE_ZEROFEE_RELAY: GET /v0/market/gt|cg/<path>, the operator's paid plan, its answers kept there and
// at Vercel's edge). Never the keyless public API (product decision, 5 Nov: its 429s were the false "busy" line): when the relay
// can't answer, the last answer stays (memory, the device's storage), logos too, and with nothing kept the list is
// 1Click's own coins and prices, never a provider banner (rules 9, 9a). A page opens at once from the last answer and
// the new one streams in behind it.
import type { Candle, Range } from "../market/types.ts";
import { relayBase, relayUrl } from "../market/relay.ts";
import { safeCanSell } from "@zerofee/core/band-coins";
import { faultOf, type Fault } from "@zerofee/core/services";
import { cgFallbackIds, gtMultiPaths, nativeCoins, rankNative, readGtTokens, readMarkets, readTokens, type GtSpot, type MarketRow, type NativeCoin, type NativeRow } from "./assets.ts";

export const ONECLICK_TOKENS = "https://1click.chaindefuser.com/v0/tokens";
export const CG = "https://api.coingecko.com/api/v3";
export const GT = "https://api.geckoterminal.com/api/v2";
const GT_ACCEPT = "application/json;version=20230302";
/** How long an answer is fresh: the list and its prices 60 s, a coin's pools 60 s, a chart its range's own. */
export const LIST_TTL_MS = 60_000, POOLS_TTL_MS = 60_000;
export const CHART_TTL_MS: Record<Range, number> = { "1H": 30_000, "1D": 60_000, "1W": 300_000, "1M": 600_000, "1Y": 3_600_000, ALL: 3_600_000 };
const KEY = "zerofee-native:v1:";

/** A pool of a coin (GeckoTerminal): its pair, its exchange, its money, its day. */
export interface NativePool { address: string; name: string; dex?: string; liquidityUsd?: number; volume24hUsd?: number; change24hPct?: number; side: "base" | "quote" }
/** A coin's GeckoTerminal facts. */
export interface NativeFacts { liquidityUsd?: number; volume24hUsd?: number; fdvUsd?: number; marketCapUsd?: number; priceUsd?: number; pools: NativePool[]; buys24h?: number; sells24h?: number }

export interface NativeDataOptions { fetch?: typeof fetch; now?: () => number; storage?: Pick<Storage, "getItem" | "setItem"> | null; timeoutMs?: number; /** The build's relay (VITE_ZEROFEE_RELAY); none: no market call at all. */ relay?: string;
  /** Which coins the list shows (rule 1, 5 Nov: a coin without a working Buy and Sell is hidden, never a dead "Not yet"):
   *  the app's own list passes band-coins safeCanSell. A coin's page (coin()) still opens for any coin, e.g. one held. */
  listed?: (assetId: string) => boolean }

const n = (v: unknown): number | undefined => { const x = typeof v === "string" ? Number(v) : v; return typeof x === "number" && Number.isFinite(x) ? x : undefined; };

/** GeckoTerminal's token answer (networks/{n}/tokens/{a}?include=top_pools), read strictly. */
export function readFacts(raw: any, spot: GtSpot): NativeFacts {
  const a = raw?.data?.attributes ?? {};
  const inc: any[] = Array.isArray(raw?.included) ? raw.included : [];
  const me = `${spot.network}_${spot.address}`.toLowerCase();
  const pools = inc.filter((p) => p?.type === "pool" && typeof p?.attributes?.address === "string").slice(0, 5).map((p): NativePool => {
    const at = p.attributes;
    const base = String(p.relationships?.base_token?.data?.id ?? "").toLowerCase();
    const dex = p.relationships?.dex?.data?.id;
    return {
      address: at.address, name: typeof at.name === "string" ? at.name.slice(0, 40) : "",
      ...(typeof dex === "string" ? { dex: dex.slice(0, 40) } : {}),
      ...o("liquidityUsd", n(at.reserve_in_usd)), ...o("volume24hUsd", n(at.volume_usd?.h24)), ...o("change24hPct", n(at.price_change_percentage?.h24)),
      side: base === me || base.endsWith(`_${spot.address.toLowerCase()}`) || base.endsWith(`-${spot.address.toLowerCase()}`) ? "base" : "quote",
    };
  });
  const tx = inc[0]?.attributes?.transactions?.h24;
  return {
    pools, ...o("liquidityUsd", n(a.total_reserve_in_usd)), ...o("volume24hUsd", n(a.volume_usd?.h24)), ...o("fdvUsd", n(a.fdv_usd)),
    ...o("marketCapUsd", n(a.market_cap_usd)), ...o("priceUsd", n(a.price_usd)), ...o("buys24h", n(tx?.buys)), ...o("sells24h", n(tx?.sells)),
  };
}
function o<K extends string>(k: K, v: number | undefined): Partial<Record<K, number>> { return v === undefined || v < 0 ? {} : ({ [k]: v } as Record<K, number>); }

/** GeckoTerminal's candles per range: timeframe, aggregate, how many (newest last once read). */
export const GT_PLAN: Record<Range, { tf: "minute" | "hour" | "day"; agg: number; limit: number }> = {
  "1H": { tf: "minute", agg: 1, limit: 60 }, "1D": { tf: "minute", agg: 15, limit: 96 }, "1W": { tf: "hour", agg: 1, limit: 168 },
  "1M": { tf: "hour", agg: 4, limit: 180 }, "1Y": { tf: "day", agg: 1, limit: 365 }, ALL: { tf: "day", agg: 1, limit: 1000 },
};
/** CoinGecko's market_chart days per range (its own granularity: 5 min under a day, hourly to 90 days, daily after). */
export const CG_DAYS: Record<Range, string> = { "1H": "1", "1D": "1", "1W": "7", "1M": "30", "1Y": "365", ALL: "max" };

/** GeckoTerminal's ohlcv_list ([[s, o, h, l, c, v], …], newest first) as candles, oldest first. */
export function readOhlcv(raw: any): Candle[] {
  const list = raw?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r: unknown): Candle[] => {
    if (!Array.isArray(r) || r.length < 6 || !r.every((x) => typeof x === "number" && Number.isFinite(x))) return [];
    const [t, op, h, l, c, v] = r as number[];
    return op! > 0 && c! > 0 ? [{ t: t! * 1000, o: op!, h: h!, l: l!, c: c!, v: v! }] : [];
  }).sort((a, b) => a.t - b.t);
}
/** CoinGecko's market_chart ({prices: [[ms, p]], total_volumes}) as one-price candles, oldest first; 1H keeps the last hour. */
export function readCgChart(raw: any, range: Range, nowMs: number): Candle[] {
  const prices = raw?.prices;
  if (!Array.isArray(prices)) return [];
  const out = prices.flatMap((r: unknown): Candle[] => (Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number" && r[1] > 0 ? [{ t: r[0], o: r[1], h: r[1], l: r[1], c: r[1], v: 0 }] : []));
  return range === "1H" ? out.filter((c: Candle) => c.t >= nowMs - 3_600_000) : out;
}

export interface NativeData {
  /** The ranked list: the last answer at once (or null), then fresh ones through `on`. */
  list(): NativeRow[] | null;
  refreshList(): Promise<NativeRow[]>;
  /** One coin by its asset id (from the list, or 1Click's tokens alone). */
  coin(assetId: string): NativeRow | undefined;
  facts(spot: GtSpot): Promise<NativeFacts>;
  peekFacts(spot: GtSpot): NativeFacts | undefined;
  candles(coin: NativeCoin, range: Range, pool?: NativePool): Promise<Candle[]>;
  peekCandles(coin: NativeCoin, range: Range): Candle[] | undefined;
  /** Which source failed on the last list read, by name (rule 9a: the screen's one calm line, core serviceSays for
   *  "oneclick", "gecko", "relay"; "coingecko" has no core name yet): 1Click's list first, else the market's. Null: none. */
  fault(): NativeFault | null;
}

/** A failed source: "oneclick" (1Click's coin list), "gecko" (GeckoTerminal, through the relay), "coingecko" (CoinGecko,
 *  through the relay), "relay" (ZeroFee's price server itself: unreachable, or its own limit). */
export interface NativeFault { service: "oneclick" | "gecko" | "coingecko" | "relay"; fault: Fault; at: number }

const serviceOfUrl = (url: string): "oneclick" | "market" => (url === ONECLICK_TOKENS ? "oneclick" : "market");
const statusOf = (err: unknown): number | null => (typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : null);
/** Whose failure a market error is: the upstream's when the relay passed its refusal on (quotes.market.refused,
 *  quotes.upstream.unreachable), the relay's own otherwise (unreachable, its limits, not set up). */
function whoFailed(url: string, err: unknown): NativeFault["service"] {
  const code = (err as { code?: unknown })?.code;
  if (code === "quotes.market.refused" || code === "quotes.upstream.unreachable" || code === "quotes.market.none") return url.startsWith(`${CG}/`) ? "coingecko" : "gecko";
  return "relay";
}

/** Market URLs (GeckoTerminal's, CoinGecko's) go to the relay and nowhere else; with no relay they aren't asked. Others (1Click's list) as they are. */
export function relayOnlyFetch(base: string | undefined, f: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(`${GT}/`) && !url.startsWith(`${CG}/`)) return f(input, init);
    const to = base ? relayUrl(base, url) : undefined;
    return to ? f(to, init) : Promise.reject(new Error("market: no relay"));
  }) as typeof fetch;
}

/** A coin's logo kept by its asset id (the market's image url): a list drawn without the market still has its logos. */
export const LOGOS_KEY = "logos";

export function createNativeData(opt: NativeDataOptions = {}): NativeData {
  const plain = opt.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const f = relayOnlyFetch(relayBase(opt.relay), plain);
  const now = opt.now ?? Date.now;
  const ls = (() => { try { return opt.storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage ?? null : opt.storage; } catch { return null; } })();
  const mem = new Map<string, { at: number; v: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  const keep = (k: string, v: unknown, persist = false) => { mem.set(k, { at: now(), v }); if (persist) try { ls?.setItem(KEY + k, JSON.stringify({ at: now(), v })); } catch { /* storage full: memory only */ } };
  const kept = <T>(k: string): { at: number; v: T } | undefined => {
    const m = mem.get(k);
    if (m) return m as { at: number; v: T };
    try { const raw = ls?.getItem(KEY + k); if (raw) { const e = JSON.parse(raw); if (typeof e?.at === "number" && e.at <= now()) { mem.set(k, e); return e; } } } catch { /* unreadable: none */ }
    return undefined;
  };
  /** The list's sources' last failures (rule 9a): 1Click's list, and the market (through the relay). Cleared by a good answer. */
  const faults = new Map<"oneclick" | "market", NativeFault>();
  const get = async <T>(url: string, ttl: number, persist = false, headers?: Record<string, string>): Promise<T> => {
    const k = url;
    const e = kept<T>(k);
    if (e && now() - e.at < ttl) return e.v;
    const running = inflight.get(k);
    if (running) return running as Promise<T>;
    const p = (async () => {
      try {
        const r = await f(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(opt.timeoutMs ?? 10_000) });
        if (!r.ok) {
          const code = await r.json().then((b: { code?: unknown }) => (typeof b?.code === "string" ? b.code : undefined), () => undefined);
          throw Object.assign(new Error(`market ${r.status}`), { status: r.status, ...(code ? { code } : {}) });
        }
        const v = (await r.json()) as T;
        keep(k, v, persist);
        if (serviceOfUrl(url) === "oneclick") faults.delete("oneclick"); // the market's is reset per list read (refreshList)
        return v;
      } catch (err) {
        const s = serviceOfUrl(url);
        faults.set(s, { service: s === "market" ? whoFailed(url, err) : "oneclick", fault: faultOf(statusOf(err), err), at: now() });
        if (e) return e.v;                                  // the last answer, whatever its age, over nothing
        throw err;
      } finally { inflight.delete(k); }
    })();
    inflight.set(k, p);
    return p;
  };
  let tokens: NativeCoin[] = [];
  let rows: NativeRow[] | null = null;
  const marketsUrl = (ids: string[]) => `${CG}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
  // the list as shown (not the markets' whole answers) is what the device keeps: a page opens from it at once
  const fromKept = () => {
    const t = kept<unknown>(ONECLICK_TOKENS);
    if (t) tokens = nativeCoins(readTokens(t.v));
    const r = kept<NativeRow[]>("rows");
    if (Array.isArray(r?.v)) rows = r.v;
  };
  fromKept();
  // the list as shown: only coins with a working Buy and Sell (opt.listed); every coin stays in `rows` for coin()
  const shownOf = (r: NativeRow[] | null): NativeRow[] | null => (r && opt.listed ? r.filter((x) => opt.listed!(x.assetId)) : r);
  return {
    list: () => shownOf(rows),
    fault: () => faults.get("oneclick") ?? faults.get("market") ?? null,
    async refreshList() {
      faults.delete("market");
      tokens =nativeCoins(readTokens(await get(ONECLICK_TOKENS, LIST_TTL_MS * 5, true)));
      // GeckoTerminal first, every network's batch at once; a batch that fails leaves its coins to CoinGecko
      const gt = new Map<string, MarketRow>();
      const answers = await Promise.all(gtMultiPaths(tokens).map(({ network, path }) =>
        get<unknown>(`${GT}/${path}`, LIST_TTL_MS, false, { accept: GT_ACCEPT }).then((r) => (readGtTokens(r, network, gt), true), () => false)));
      const ids = cgFallbackIds(tokens, gt);
      const markets = ids.length ? await get<unknown>(marketsUrl(ids), LIST_TTL_MS).catch(() => null) : null;
      if (!gt.size && !markets && rows?.length) return shownOf(rows)!; // the market unreachable: the last prices stay, never blanked
      // logos are kept apart and a long time: a coin's image doesn't change, and a list drawn from 1Click alone keeps them
      const logos: Record<string, string> = { ...(kept<Record<string, string>>(LOGOS_KEY)?.v ?? {}) };
      const fresh = rankNative(tokens, readMarkets(markets), gt);
      rows = fresh.map((r) => (r.logo || !logos[r.assetId] ? r : { ...r, logo: logos[r.assetId]! }));
      if (answers.some(Boolean) || markets) {
        for (const r of fresh) if (r.logo) logos[r.assetId] = r.logo;
        keep(LOGOS_KEY, logos, true);
        keep("rows", rows, true);
      }
      return shownOf(rows)!;
    },
    coin: (assetId) => rows?.find((r) => r.assetId === assetId) ?? (() => { const t = tokens.find((c) => c.assetId === assetId); return t ? { ...t, name: t.symbol } : undefined; })(),
    facts: async (spot) => readFacts(await get(gtTokenUrl(spot), POOLS_TTL_MS, false, { accept: GT_ACCEPT }), spot),
    peekFacts: (spot) => { const e = kept<unknown>(gtTokenUrl(spot)); return e ? readFacts(e.v, spot) : undefined; },
    async candles(coin, range, pool) {
      const p = GT_PLAN[range];
      if (coin.gt && pool) {
        const tok = pool.side === "base" ? "base" : "quote";
        const url = `${GT}/networks/${coin.gt.network}/pools/${encodeURIComponent(pool.address)}/ohlcv/${p.tf}?aggregate=${p.agg}&limit=${p.limit}&currency=usd&token=${tok}`;
        const c = readOhlcv(await get(url, CHART_TTL_MS[range], false, { accept: GT_ACCEPT }).catch(() => null));
        if (c.length >= 2) { keep(chartKey(coin, range), c); return c; }
      }
      if (!coin.cgId) return [];
      const c = readCgChart(await get(`${CG}/coins/${coin.cgId}/market_chart?vs_currency=usd&days=${CG_DAYS[range]}`, CHART_TTL_MS[range]), range, now());
      keep(chartKey(coin, range), c);
      return c;
    },
    peekCandles: (coin, range) => kept<Candle[]>(chartKey(coin, range))?.v,
  };
}
const gtTokenUrl = (s: GtSpot) => `${GT}/networks/${s.network}/tokens/${encodeURIComponent(s.address)}?include=top_pools`;
const chartKey = (c: NativeCoin, r: Range) => `chart:${c.assetId}:${r}`;

/** The one data source the screens share (the page's own fetch). */
let shared: NativeData | undefined;
export const nativeData = (): NativeData => (shared ??= createNativeData({ relay: (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_RELAY, listed: safeCanSell }));
