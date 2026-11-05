// Market data for the Trade app, read from public keyless APIs on the device, or through ZeroFee's market relay when the
// build names one (relay.ts: the GeckoTerminal key lives only on the relay; the public API stays the fallback):
//  - GeckoTerminal (api.geckoterminal.com): search, trending, a coin's pools, logos, candles, the 24 h numbers. About 30 calls a minute per IP, so everything goes through gt.ts's budget.
//  - CoinGecko (api.coingecko.com/api/v3/simple/price): SOL, BNB and ETH in dollars.
// The rules kept from the earlier module:
//  - TRENDING IS GECKOTERMINAL'S OWN LIST IN ITS OWN ORDER. We never pick coins. The only drops: a coin already shown, a native coin or a stable, and what the spam filter hides.
//  - The spam filter (spam.ts) hides copies of famous coins, links and claim-bait names with no crowd, empty markets and wash-traded pools. A coin the person bought or chose is never hidden.
//  - Search takes a pasted contract address (shown whatever its liquidity) as well as names and tickers. A pasted address is also read
//    from the chain (onchain.ts) at the same time, so a coin minutes old that GeckoTerminal doesn't list yet is found, named and, on a
//    launch curve, priced; and so is any coin while GeckoTerminal can't be asked. A pasted Solana pool is read as its coin.
//  - Every coin has a logo: GeckoTerminal's image, or none (the shell draws the monogram); SOL, BNB and ETH are bundled.
import { CG_BASE, createRelayFetch, relayBase } from "./relay.ts";
import type { ChainId, CoinMeta } from "../types.ts";
import { classify, factsOfPool } from "./spam.ts";
// the candles' code is read the first time a chart or a minute's move is wanted, never in Home's first load (speed budget)
const candlesCode = () => import("./candles.ts");
import { CHAINS, GT_BASE, GT_NETWORK, MarketError, createGt, type GtClient, type GtList, type GtPool, type GtTokenAnswer, type Priority } from "./gt.ts";
import { logoFor } from "./logo.ts";
import { interleave, isMoneyPool, normAddr, rankSearch, num, poolViews, quoteKindOf, rowOf, validTokenAddress, cleanLabel, logoOf, type PoolView } from "./map.ts";
// NEAR's own code (near.ts) loads the first time a NEAR coin is pasted or read on chain: never in Home's first load
import type { NearPasted } from "./near.ts";
const nearCode = () => import("./near.ts");
import { createCheckedPrice, createCorePrice, createNativePrices, createSizingPrice, NATIVE_SPOT_POOLS, WRAPPED_NATIVE } from "./price.ts";
import { securityOfInfo } from "./security.ts";
import { evmFacts, saneVsMarket, solFacts, type ChainFacts } from "./onchain.ts";
import { spotPrice, type SpotPool } from "./spot.ts";
import { evmSecurity, sellTarget, type EvmSecurity } from "./evm-security.ts";
import { candlesOfTicks, followSwaps, POLL_MS, recentSwaps, type Tick } from "./live.ts";
import { shortAddr } from "../sol/keys.ts";
import type { Candle, CoinDetail, CoinRow, ListRead, LiveState, Market, MarketOptions, Range } from "./types.ts";

export * from "./types.ts";
export { MarketError } from "./gt.ts";
export { NATIVE_LOGO_SVG, nativeLogoUri } from "./logo.ts";
export { classify, reasonText } from "./spam.ts";

export const SEARCH_TTL_MS = 60_000;
export const TRENDING_TTL_MS = 60_000;
export const TOKEN_TTL_MS = 30_000;
export const INFO_TTL_MS = 3_600_000;
/** Name search hides dust pools (a search for "pepe" is full of $50 copies); a pasted address is shown whatever its liquidity. */
export const SEARCH_MIN_LIQUIDITY_USD = 1_000;
export const SEARCH_MIN_PER_CHAIN = 2;
/** The per-chain top-up of a search only runs when this many calls are left in the window. */
/** Top-ups go out only when the short window still has room for them and one more call. */
export const SEARCH_TOPUP_ROOM = 4;
export const ALL_MIN_ROWS = 10;
export const ALL_MIN_PER_CHAIN = 3;
export const LIVE_POLL_MS = 15_000;
/** New pools change by the minute; the list's prices by the second (the relay keeps both answers this long too). */
export const FRESH_TTL_MS = 30_000, PRICES_TTL_MS = 10_000;
export const MOVE_WINDOW_MS = 60_000;
/** NEAR's trending list also reads this many pages of Rhea's own pools (S13). */
export const NEAR_RHEA_PAGES = 3;
const INCLUDE = "include=base_token%2Cquote_token%2Cdex&page=1";
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
/** `p`, or undefined if it takes longer than `ms`. */
const within = async <T>(p: Promise<T>, ms: number): Promise<T | undefined> => { const w = sleep(ms); try { return await Promise.race([p, w.p]); } finally { w.stop(); } };
const sleep = (ms: number): { p: Promise<undefined>; stop(): void } => { let t: ReturnType<typeof setTimeout>; const p = new Promise<undefined>((r) => { t = setTimeout(() => r(undefined), ms); }); return { p, stop: () => clearTimeout(t) }; };

/** `chainOnly`: named by the chain alone, because GeckoTerminal doesn't list the coin (or couldn't be asked). */
/** A coin nothing names yet: its address, short. */
const shortName = (chain: ChainId, a: string): string => (chain === "sol" ? shortAddr(a) : `${a.slice(0, 6)}…${a.slice(-4)}`);

interface MetaEntry { at: number; meta: CoinMeta; full: boolean; detail?: CoinDetail; chainOnly?: boolean }

/** Lists (trending, search) may be shown this old, marked "as of", when GeckoTerminal can't be asked; prices the engines read stay at gt.ts's 15 minutes. */
export const LIST_STALE_MS = 24 * 3600_000;
/** A list older than this is marked with the time it is from. */
export const STALE_LABEL_MS = 3 * 60_000;

/** Through the relay (phone test, 5 Nov: the paid door is never held back by our own budget): the relay's app limit is
 *  200 misses a minute per address (apps/quotes MARKET_MISS_APP_MAX) and it keeps every answer for everyone, so a device
 *  may ask up to 120 a minute, 30 in any 10 s (a coin page's token, info and chart after a busy list, with room). */
export const RELAY_BUDGET = { calls: 120, perMs: 60_000 }, RELAY_BURST = { calls: 30, perMs: 10_000 };
/** The live-price poll's batch: the coins watched, padded to this many with coins the lists showed (audit D148 L13). */
export const PRICE_BATCH = 20;
/**
 * One fixed-size, sorted batch of addresses: every one wanted (all of them, even past `size`, at most 30), then padding
 * from `pool` in its own order, never one twice; sorted so the batch's address says nothing about which were wanted.
 */
export function paddedBatch(want: readonly string[], pool: readonly string[], size: number): string[] {
  const out = new Set(want.slice(0, 30));
  for (const p of pool) { if (out.size >= size) break; out.add(p); }
  return [...out].sort();
}

/** A coin GeckoTerminal said it doesn't list isn't asked about again for this long (a new coin is indexed within minutes). */
export const NOT_LISTED_TTL_MS = 60_000;
/** What the chain said about a coin is reused this long (a launch curve's price moves with every trade). */
export const CHAIN_TTL_MS = 10_000;
/** A coin page whose market data failed waits this long for the chain's own answer. */
export const CHAIN_WAIT_MS = 4_000;
/** A live price from the coin's own swaps on chain this recent is not replaced by the market data's slower poll. */
export const CHAIN_TICK_FRESH_MS = 30_000;
/** The recent swaps a chart is drawn from (a coin the market data has no candles for), and how long they are reused. */
export const RECENT_SWAPS = 40, RECENT_TTL_MS = 20_000;

export function createMarket(opts: MarketOptions = {}): Market {
  const now = opts.now ?? Date.now;
  const plain = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  // through the relay the key's own limit applies (it answers 429 readably), so a device may ask more often
  const relay = relayBase(opts.relay);
  const f = relay ? createRelayFetch(relay, plain) : plain;
  /** A coin the market data has no image for: the relay finds its logo by address (its Metaplex / Token-2022 image, the
   *  token lists), so no image host sees the person's address. None without a relay: the shell draws the monogram. */
  const logos = relay ?? relayBase(opts.logoRelay);
  const relayLogo = (chain: ChainId, address: string): string | undefined => (logos ? `${logos}/v0/market/logo?c=${chain}&a=${encodeURIComponent(address)}` : undefined);
  /** A coin's logo: the bundled one for a native coin; with a relay, always the relay's (the phone loads images only from
   *  it: audit NF-12), else the market data's own image url. */
  /** A logo bundled with the data itself (a data: image, as the web demo's own sample coins carry): used as it is. */
  const bundled = (image?: string | null) => (typeof image === "string" && image.startsWith("data:image/") ? image : undefined);
  const coinLogo = (chain: ChainId, address: string, image?: string | null): string | undefined => logoFor(chain, address) ?? bundled(image) ?? (logos ? relayLogo(chain, address) : logoFor(chain, address, image));
  const gt: GtClient = createGt({ fetch: f, now, budget: opts.budget ?? (relay ? RELAY_BUDGET : undefined), burst: opts.burst ?? (relay ? RELAY_BURST : undefined), storage: opts.storage, sleep: opts.sleep });
  const nativeUsd = createNativePrices({ fetch: f, now, gt });
  const checkedUsd = createCheckedPrice({ fetch: f, gt });
  const metaWait = opts.metaWaitMs ?? 120;
  // the page someone opened waits its turn behind a busy list (the 10 s cap), instead of drawing "busy" in place of its chart
  const screenWait = opts.screenWaitMs ?? 15_000;
  const pollMs = opts.livePollMs ?? LIVE_POLL_MS;
  const metas = new Map<string, MetaEntry>();
  const refreshing = new Map<string, Promise<MetaEntry>>();
  const samples = new Map<string, { t: number; p: number }[]>();
  const keyOf = (c: ChainId, a: string) => `${c}:${normAddr(c, a)}`;
  /** When GeckoTerminal last said it doesn't list a coin. */
  const notListed = new Map<string, number>();
  const listedNo = (k: string): boolean => now() - (notListed.get(k) ?? -Infinity) < NOT_LISTED_TTL_MS;
  /** The market data's last price of each coin: the reference a price the app works out itself is checked against (PRICE SANITY). */
  const marketPx = new Map<string, number>();
  const notePx = (k: string, p: number | undefined) => { if (p && p > 0 && Number.isFinite(p)) { marketPx.set(k, p); if (marketPx.size > 800) marketPx.delete(marketPx.keys().next().value!); } };

  // ---- what the chain says (onchain.ts): one answer per coin for CHAIN_TTL_MS, one read in flight
  const chainMemo = new Map<string, { at: number; p: Promise<ChainFacts | undefined> }>();
  const canReadChain = (chain: ChainId): boolean => (chain === "sol" ? !!opts.solRpc : chain === "near" ? !!opts.nearRpc : !!opts.evmRpc);
  /** Pools read on chain (a spot price, the swaps as they land): Solana, BNB Chain and Robinhood Chain; NEAR polls the market data. */
  const canReadPools = (chain: ChainId): boolean => chain !== "near" && canReadChain(chain);
  /** Undefined: not a token on that chain (or no node reader). Throws when no node answered. */
  function chainFacts(chain: ChainId, address: string, o: { price?: boolean } = {}): Promise<ChainFacts | undefined> {
    if (!canReadChain(chain)) return Promise.resolve(undefined);
    const k = `${keyOf(chain, address)}:${o.price === false ? "-" : "p"}`;
    const hit = chainMemo.get(k);
    if (hit && now() - hit.at < CHAIN_TTL_MS) return hit.p;
    const p = chain === "sol" ? solFacts(opts.solRpc!, address, () => nativeUsd("sol")) : chain === "near" ? nearCode().then((m) => m.nearFacts(opts.nearRpc!, address)) : evmFacts(opts.evmRpc!, chain, address, nativeUsd, o);
    chainMemo.set(k, { at: now(), p });
    p.catch(() => { if (chainMemo.get(k)?.p === p) chainMemo.delete(k); });   // a node that failed is asked again next time
    if (chainMemo.size > 200) chainMemo.delete(chainMemo.keys().next().value!);
    return p;
  }
  /** The chain's facts as a coin page: its price only when it agrees with the market data's last one within 100x. */
  function detailOfFacts(f: ChainFacts): CoinDetail {
    const d: CoinDetail = { chain: f.chain, address: normAddr(f.chain, f.address), decimals: f.decimals, fromChain: true };
    const lg = coinLogo(f.chain, f.address); if (lg) d.logoUrl = lg;
    d.symbol = f.symbol ?? shortName(f.chain, f.address);
    if (f.name) d.name = f.name;
    const ref = marketPx.get(keyOf(f.chain, f.address));
    const px = f.priceUsd !== undefined && saneVsMarket(f.priceUsd, ref) ? f.priceUsd : ref;
    if (px !== undefined) { d.priceUsd = px; if (f.supply > 0n) d.marketCapUsd = (Number(f.supply) / 10 ** f.decimals) * px; }
    if (f.pool) d.pools = [{ address: f.pool.address, dex: f.pool.dex }];
    if (f.security) d.security = { ...f.security };
    return d;
  }
  /** What the engines read of a chain-only coin: its name, decimals and pools, never a price the app worked out itself (their guards
   *  compare a route with the market's price). */
  const chainMeta = (d: CoinDetail): CoinMeta => {
    const m: CoinMeta = {};
    if (d.symbol !== undefined) m.symbol = d.symbol; if (d.name !== undefined) m.name = d.name; if (d.decimals !== undefined) m.decimals = d.decimals;
    if (d.pools) m.pools = d.pools;
    return m;
  };
  const storeChain = (d: CoinDetail): void => { store(d.chain, d.address, { at: now(), meta: chainMeta(d), full: false, detail: d, chainOnly: true }); };

  // ---- a coin's spot price on chain (spot.ts), from the pool the market data last ranked it in or a pasted pool: what the
  // page and the live price show when the market data can't be asked (wallet v1, QA-UX 21 Oct: a page at no price because
  // GeckoTerminal answered 429)
  const spotPools = new Map<string, SpotPool>();
  // ONE pool per coin, its deepest (test, 4 Nov, "Pump": the list's pool and the page's took turns, so the live price, the
  // chart's last point and the 24 h change flipped between two pools): the token answer's deepest (`sure`) always; a list's
  // pool only when none is known yet, it is the same pool, or it holds more money than the one kept
  const poolLiq = new Map<string, number>();
  const notePool = (k: string, p: SpotPool, o: { liq?: number; sure?: boolean } = {}): void => {
    const cur = spotPools.get(k);
    const moved = cur !== undefined && cur.pool !== p.pool;
    if (moved && !o.sure && (o.liq === undefined || (poolLiq.get(k) ?? 0) >= o.liq)) return;
    spotPools.delete(k); spotPools.set(k, p);
    if (o.liq !== undefined) poolLiq.set(k, o.liq); else if (moved) poolLiq.delete(k);
    if (spotPools.size > 400) { const old = spotPools.keys().next().value!; spotPools.delete(old); poolLiq.delete(old); }
    if (moved) { spotMemo.delete(k); recentMemo.delete(k); if (follows.has(k)) unfollow(k); }
    if (!cur || moved) follow(p.chain, p.coin.address);              // a coin page that is open follows its (new) pool from now on
  };
  /** A Solana pool the chain named (the pump.fun curve, a pasted pool): it is quoted in SOL. */
  const noteFactsPool = (f: ChainFacts): void => { if (f.pool && f.chain === "sol") { const k = keyOf(f.chain, f.address); if (!spotPools.has(k)) notePool(k, { chain: f.chain, pool: f.pool.address, dex: f.pool.dex, coin: { address: f.address, decimals: f.decimals }, quote: { address: "So11111111111111111111111111111111111111112", decimals: 9, kind: "native" } }); } };
  const spotMemo = new Map<string, { at: number; p: Promise<number | undefined> }>();
  // NEAR's pools aren't read on chain (no spot price of its own): its price is the market data's, polled
  const spotEnv = { rpc: (chain: ChainId, method: string, params: unknown[]) => (chain === "sol" ? opts.solRpc!(method, params) : chain === "near" ? Promise.reject(new Error("no NEAR pool reads")) : opts.evmRpc!(chain, method, params)), nativeUsd: (c: ChainId) => nativeUsd(c) };
  // what a dollar buy is sized in (audit MKT-1): checked; or, with one market source down, the other within 5 % of the
  // chain's own price (a deep native / dollar pool); never a stale or unchecked one. No nodes (sample data): no chain price
  const nativeSpot = async (c: ChainId) => { const pool = NATIVE_SPOT_POOLS[c]; return opts.solRpc && opts.evmRpc && pool ? (await spotPrice(spotEnv, c, WRAPPED_NATIVE[c], pool))?.priceUsd : undefined; };
  // audit R-2: the core's own price (1Click, asked with the PLAIN fetch, never the relay) sizes a live trade; the relay's
  // two sources are only a witness to it. Sample data (no nodes) keeps the market's own check
  const corePrice = opts.solRpc && opts.evmRpc ? (opts.corePrice ?? createCorePrice({ fetch: plain, now })) : undefined;
  const sizingUsd = createSizingPrice({ checked: checkedUsd, native: nativeUsd, spot: nativeSpot, now, ...(corePrice ? { core: corePrice } : {}) });
  /** The coin's dollar price in its known pool, read on chain; undefined when there is no pool, no node, or it disagrees 100x with the market's last price. */
  function spotUsd(chain: ChainId, address: string, decimals?: number): Promise<number | undefined> {
    const k = keyOf(chain, address), pool = spotPools.get(k);
    if (!pool || !canReadPools(chain)) return Promise.resolve(undefined);
    const hit = spotMemo.get(k);
    if (hit && now() - hit.at < CHAIN_TTL_MS) return hit.p;
    const p = spotPrice(spotEnv, chain, normAddr(chain, address), pool, decimals ?? pool.coin.decimals).then((s) => (s && saneVsMarket(s.priceUsd, marketPx.get(k)) ? s.priceUsd : undefined), () => undefined);
    spotMemo.set(k, { at: now(), p });
    if (spotMemo.size > 200) spotMemo.delete(spotMemo.keys().next().value!);
    return p;
  }

  // ---- a token's answer -> CoinMeta / CoinDetail
  const tokenPath = (c: ChainId, a: string) => `networks/${GT_NETWORK[c]}/tokens/${a}?include=top_pools`;
  const infoPath = (c: ChainId, a: string) => `networks/${GT_NETWORK[c]}/tokens/${a}/info`;

  function parseToken(chain: ChainId, address: string, j: GtTokenAnswer): CoinDetail {
    const t = j?.data?.attributes;
    if (!t) throw new MarketError("bad_response", "no token in the answer");
    const topIds = new Set((j.data.relationships?.top_pools?.data ?? []).map((x) => x.id));
    const pools = (j.included ?? []).filter((x): x is GtPool => x.type === "pool" && (topIds.size === 0 || topIds.has(x.id)));
    const rows = pools.map((p) => ({ address: p.attributes.address, dex: p.relationships?.dex?.data?.id ?? "unknown", liquidityUsd: num(p.attributes.reserve_in_usd), h24: num(p.attributes.price_change_percentage?.h24) }))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    const sum = rows.reduce((x, p) => x + (p.liquidityUsd ?? 0), 0);
    const liq = num(t.total_reserve_in_usd) ?? (rows.length ? sum : undefined);
    // the deepest pool, with its quote side, prices the coin on chain when the market data can't be asked
    const deep = [...pools].sort((a, b) => (num(b.attributes.reserve_in_usd) ?? 0) - (num(a.attributes.reserve_in_usd) ?? 0))[0];
    if (deep) {
      const tail = (id: string) => normAddr(chain, id.slice(id.indexOf("_") + 1));
      const coinIsBase = tail(deep.relationships.base_token.data.id) === normAddr(chain, address);
      const qa = tail(coinIsBase ? deep.relationships.quote_token.data.id : deep.relationships.base_token.data.id);
      const qp = num(coinIsBase ? deep.attributes.quote_token_price_usd : deep.attributes.base_token_price_usd);
      const sp: SpotPool = { chain, pool: deep.attributes.address, dex: deep.relationships?.dex?.data?.id ?? "unknown",
        coin: { address: normAddr(chain, address), ...(Number.isInteger(t.decimals) ? { decimals: t.decimals } : {}) }, quote: { address: qa, ...(qp && qp > 0 ? { priceUsd: qp } : {}) } };
      if (validTokenAddress(chain, qa)) notePool(keyOf(chain, address), sp, { sure: true, liq: num(deep.attributes.reserve_in_usd) ?? 0 });
    }
    const d: CoinDetail = { chain, address: normAddr(chain, address), pools: rows.map(({ address: a, dex, liquidityUsd }) => ({ address: a, dex, ...(liquidityUsd !== undefined ? { liquidityUsd } : {}) })) };
    const sym = cleanLabel(t.symbol), nm = cleanLabel(t.name);
    if (sym) d.symbol = sym;
    if (nm) d.name = nm;
    if (Number.isInteger(t.decimals)) d.decimals = t.decimals;
    const px = num(t.price_usd); if (px && px > 0) d.priceUsd = px;
    if (liq !== undefined) d.liquidityUsd = liq;
    if (rows[0]?.h24 !== undefined) d.change24hPct = rows[0].h24;
    const mc = num(t.market_cap_usd) ?? num(t.fdv_usd); if (mc && mc > 0) d.marketCapUsd = mc;
    const v = num(t.volume_usd?.h24); if (v !== undefined) d.volume24hUsd = v;
    const logo = coinLogo(chain, address, t.image_url); if (logo) d.logoUrl = logo;
    const born = pools.map((p) => Date.parse(p.attributes.pool_created_at ?? "")).filter((x) => Number.isFinite(x));
    if (born.length) d.createdAt = Math.min(...born);                    // its first pool: how long it has traded
    // the main pool's moves and trades (the coin page's chips and trades line, as pump.fun shows them)
    if (deep) {
      const pc = deep.attributes.price_change_percentage ?? {}, tx = deep.attributes.transactions?.h24;
      d.moves = { m5: num(pc.m5), h1: num(pc.h1), h6: num(pc.h6), h24: num(pc.h24) };
      d.buys24h = num(tx?.buys); d.sells24h = num(tx?.sells);
    }
    return d;
  }
  /** The fields the engines read; the screen's extras stay in the detail. */
  const metaOf = (d: CoinDetail): CoinMeta => {
    const m: CoinMeta = {};
    if (d.symbol !== undefined) m.symbol = d.symbol; if (d.name !== undefined) m.name = d.name; if (d.decimals !== undefined) m.decimals = d.decimals;
    if (d.priceUsd !== undefined) m.priceUsd = d.priceUsd; if (d.liquidityUsd !== undefined) m.liquidityUsd = d.liquidityUsd;
    if (d.pools) m.pools = d.pools; if (d.moveBps60s !== undefined) m.moveBps60s = d.moveBps60s; if (d.change24hPct !== undefined) m.change24hPct = d.change24hPct;
    return m;
  };
  const MAX_METAS = 400;
  function store(chain: ChainId, address: string, e: MetaEntry): MetaEntry {
    const k = keyOf(chain, address);
    const old = metas.get(k);
    if (old?.full && !e.full) return old; // a list row never replaces the full answer
    metas.set(k, e);
    if (metas.size > MAX_METAS) for (const [kk] of [...metas.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, metas.size - MAX_METAS)) metas.delete(kk);
    return e;
  }
  /** A coin seen in a list: its name, price and the pool it was ranked in. The coin's total liquidity is not known from one pool, so it is left out. */
  function seedFromRows(views: PoolView[]): void {
    for (const v of views) {
      const k = keyOf(v.chain, v.coin.address);
      const quote = { address: v.quote.address, ...(v.quote.kind ? { kind: v.quote.kind } : {}), ...(v.quote.decimals !== undefined ? { decimals: v.quote.decimals } : {}), ...(v.quote.priceUsd ? { priceUsd: v.quote.priceUsd } : {}) };
      notePool(k, { chain: v.chain, pool: v.pool, dex: v.dex, coin: { address: normAddr(v.chain, v.coin.address), ...(v.coin.decimals !== undefined ? { decimals: v.coin.decimals } : {}) }, quote }, { liq: v.liquidityUsd });
      if (metas.get(k)?.full) continue;
      const m: CoinMeta = { symbol: v.coin.symbol, name: v.coin.name, priceUsd: v.coin.priceUsd, pools: [{ address: v.pool, dex: v.dex, liquidityUsd: v.liquidityUsd }] };
      if (v.coin.decimals !== undefined) m.decimals = v.coin.decimals;
      if (v.change24h !== undefined) m.change24hPct = v.change24h;
      notePx(k, v.coin.priceUsd);
      store(v.chain, v.coin.address, { at: now(), meta: m, full: false });
    }
  }
  const moveOfSamples = (k: string): number | undefined => {
    const s = samples.get(k);
    if (!s || s.length < 2 || s[s.length - 1]!.t - s[0]!.t < 10_000) return undefined;
    const hi = Math.max(...s.map((x) => x.p)), lo = Math.min(...s.map((x) => x.p)), mid = (hi + lo) / 2;
    return mid > 0 ? Math.round(((hi - lo) / mid) * 10_000) : undefined;
  };

  function refreshMeta(chain: ChainId, address: string, prio: Priority, waitMs?: number): Promise<MetaEntry> {
    const k = keyOf(chain, address);
    const running = refreshing.get(k);
    if (running) return running;
    const p = gt.get<GtTokenAnswer>(tokenPath(chain, address), TOKEN_TTL_MS, prio, { waitMs }).then((j) => {
      const d = parseToken(chain, address, j);
      notListed.delete(k); notePx(k, d.priceUsd);
      const old = metas.get(k);
      const mv = moveOfSamples(k) ?? old?.detail?.moveBps60s;
      if (mv !== undefined) d.moveBps60s = mv;
      if (old?.detail) { if (old.detail.holders !== undefined) d.holders = old.detail.holders; if (old.detail.security) d.security = old.detail.security; }
      return store(chain, address, { at: now(), meta: metaOf(d), full: true, detail: d });
    }, (e: unknown) => { if (e instanceof MarketError && e.code === "not_found") notListed.set(k, now()); throw e; }).finally(() => { refreshing.delete(k); });
    refreshing.set(k, p);
    return p;
  }

  async function meta(chain: ChainId, address: string): Promise<CoinMeta | undefined> {
    if (!CHAINS.includes(chain) || !validTokenAddress(chain, address)) return undefined;
    const k = keyOf(chain, address), e = metas.get(k);
    const age = e ? now() - e.at : Infinity;
    if (e?.full && age < TOKEN_TTL_MS) return e.meta;
    if (e?.chainOnly && listedNo(k)) return e.meta;                   // GeckoTerminal said a moment ago it doesn't list this coin
    const p = refreshMeta(chain, address, e ? "low" : "high");
    p.catch(() => {});
    if (e?.full) return e.meta; // an old answer now, a new one in the background
    const w = sleep(metaWait);
    try { const r = await Promise.race([p.then((x) => x, () => undefined), w.p]); return (r ? r.meta : e?.meta); } finally { w.stop(); }
  }

  // ---- lists
  /** A row ranked in a pool that isn't the coin's deepest (its page's answer named a deeper one): the deeper pool's price and
   *  changes, so the list and the page say the same (test, 4 Nov: the list −72.3 %, the page −50 %). */
  const mainOf = (row: CoinRow, v: PoolView): CoinRow => {
    const d = metas.get(keyOf(v.chain, v.coin.address))?.detail, main = d?.pools?.[0];
    if (!d || !main || main.address === v.pool || (main.liquidityUsd ?? 0) <= v.liquidityUsd) return row;
    if (d.priceUsd !== undefined) row.priceUsd = d.priceUsd;
    if (d.change24hPct !== undefined) row.change24hPct = d.change24hPct; else delete row.change24hPct;
    const ch = Object.fromEntries(Object.entries(d.moves ?? {}).filter(([, x]) => x !== undefined)) as CoinRow["changePct"];
    if (ch && Object.keys(ch).length) row.changePct = ch; else delete row.changePct;
    return row;
  };
  const nameKey = (v: PoolView) => `${v.chain}:${normAddr(v.chain, v.coin.address)}`;
  /** Pools -> rows in the list's own order: a coin once, the spam filter's verdict applied, money pools dropped when asked. */
  /** `dropDead` (trending lists): a coin down 99.5% or more in 24 hours (shown as −100.0%) is not trending, it is gone. */
  function rowsOf(views: PoolView[], o: { dropMoney: boolean; minLiquidity?: number; dropDead?: boolean }): CoinRow[] {
    const seen = new Set<string>(), out: CoinRow[] = [], kept: PoolView[] = [];
    const passes = (v: PoolView) => !(o.dropMoney && isMoneyPool(v)) && !(o.minLiquidity !== undefined && v.liquidityUsd < o.minLiquidity) && !(o.dropDead && v.change24h !== undefined && v.change24h <= -99.5);
    // a coin in two of the answer's pools: its row is its deepest pool's, at the place it first came (test, 4 Nov, "Pump")
    const deepest = new Map<string, PoolView>();
    for (const v of views) { if (!passes(v)) continue; const b = deepest.get(nameKey(v)); if (!b || v.liquidityUsd > b.liquidityUsd) deepest.set(nameKey(v), v); }
    for (const first of views) {
      if (!passes(first)) continue;
      const k = nameKey(first);
      if (seen.has(k)) continue;
      const v = deepest.get(k)!;
      if (!opts.keep?.(v.chain, v.coin.address)) {
        const verdict = classify({ chain: v.chain, address: v.coin.address, symbol: v.coin.symbol, name: v.coin.name }, factsOfPool(v), { now: now() });
        if (!verdict.show) continue;
      }
      seen.add(k); kept.push(v);
      const row = mainOf(rowOf(v), v);
      const lg = coinLogo(v.chain, v.coin.address, v.coin.logo); if (lg) row.logoUrl = lg; else delete row.logoUrl;
      out.push(row);
    }
    seedFromRows(kept);
    return out;
  }

  /** A list served from an answer older than its refresh time carries `asOf` (ms): the screen says "as of 15:24". */
  type Rows = CoinRow[] & { asOf?: number };
  const asOf = (rows: CoinRow[], from: (string | number)[]): Rows => {
    const ats = from.map((x) => (typeof x === "number" ? x : gt.servedAt(x))).filter((x): x is number => x !== undefined);
    const oldest = ats.length ? Math.min(...ats) : undefined;
    return oldest !== undefined && now() - oldest > STALE_LABEL_MS ? Object.assign(rows, { asOf: oldest }) : rows;
  };
  /** D145: a list on screen that reads itself again goes in the background lane ("low": only its share of the call
   *  budget, its last answer when there's no room), so a coin page's own reads never queue behind it (the speed worker
   *  measured a coin page's details 11 s cold behind list refreshes, 3 Nov). A first read or a Retry stays "high". */
  const laneOf = (o?: ListRead): Priority => (o?.refresh ? "low" : "high");
  /** Several NEAR pages read at once, in their order: the first `fg` in the screen's lane, the rest in the background lane. A
   *  page that fails is left out; all failing is the first page's failure. */
  async function nearPages(paths: string[], ttl: number, lane: Priority, fg: number): Promise<{ views: PoolView[][]; from: string[] }> {
    const settled = await Promise.allSettled(paths.map((p, i) => gt.get<GtList>(p, ttl, i < fg ? lane : "low", { staleMs: LIST_STALE_MS })));
    const views: PoolView[][] = [], from: string[] = [];
    settled.forEach((s, i) => { if (s.status === "fulfilled") { views.push(poolViews("near", s.value)); from.push(paths[i]!); } });
    if (!from.length) throw (settled[0] as PromiseRejectedResult).reason;
    return { views, from };
  }
  /** `lean` (the All list's top-up of a short chain): the chain's trending list alone, one call. */
  async function trendingOne(chain: ChainId, lane: Priority = "high", lean = false): Promise<CoinRow[]> {
    const path = `networks/${GT_NETWORK[chain]}/trending_pools?${INCLUDE}`;
    if (chain === "near" && !lean) return trendingNear(path, lane);
    const list = await gt.get<GtList>(path, TRENDING_TTL_MS, lane, { staleMs: LIST_STALE_MS });
    return asOf(rowsOf(poolViews(chain, list), { dropMoney: true, dropDead: true }), [path]);
  }
  /** NEAR (S13, 5 Nov): GeckoTerminal's near trending is mostly NEAR Intents' money pairs (XRP/USDT, USDC/USDT),
   *  so few coins survive. Rhea's own pools (NEAR_RHEA_PAGES pages, Rhea's most traded first) join it, Rhea coins first:
   *  trending's Rhea pools, then Rhea's pages, then trending's other pools; a coin once (its deepest pool's row). */
  async function trendingNear(path: string, lane: Priority): Promise<CoinRow[]> {
    const rhea = Array.from({ length: NEAR_RHEA_PAGES }, (_, i) => `networks/near/dexes/rhea-finance/pools?include=base_token%2Cquote_token%2Cdex&page=${i + 1}`);
    const { views, from } = await nearPages([path, ...rhea], TRENDING_TTL_MS, lane, 2);
    const trend = from[0] === path ? views[0]! : [], pages = (from[0] === path ? views.slice(1) : views).flat();
    const isRhea = (v: PoolView) => /rhea|ref-finance/i.test(v.dex);
    const ordered = [...trend.filter(isRhea), ...pages, ...trend.filter((v) => !isRhea(v))];
    return asOf(rowsOf(ordered, { dropMoney: true, dropDead: true }), from);
  }
  async function trending(chain?: ChainId, o?: ListRead): Promise<CoinRow[]> {
    const lane = laneOf(o);
    if (chain) return trendingOne(chain, lane);
    const path = `networks/trending_pools?${INCLUDE}`;
    let global: CoinRow[] | undefined;
    try {
      const list = await gt.get<GtList>(path, TRENDING_TTL_MS, lane, { staleMs: LIST_STALE_MS });
      global = rowsOf(poolViews("by-id", list).filter((v) => CHAINS.includes(v.chain)), { dropMoney: true, dropDead: true });
      const per = (c: ChainId) => global!.filter((r) => r.chain === c).length;
      if (global.length >= ALL_MIN_ROWS && CHAINS.every((c) => per(c) >= ALL_MIN_PER_CHAIN)) return asOf(global, [path]);
    } catch { /* the cross-network list failed: the per-chain lists are the same data */ }
    // that list is dominated by other networks: alternate the chains' lists, each in its own order. A chain the cross-network
    // list covers well keeps its rows from it; only a short chain asks for its own list (fewer calls on a busy connection)
    const own = (c: ChainId): CoinRow[] | undefined => { const r = global?.filter((x) => x.chain === c); return r && r.length >= ALL_MIN_PER_CHAIN ? asOf(r, [path]) : undefined; };
    const settled = await Promise.allSettled(CHAINS.map((c) => { const r = own(c); return r ? Promise.resolve(r) : trendingOne(c, lane, true); }));
    const ok = settled.filter((s): s is PromiseFulfilledResult<CoinRow[]> => s.status === "fulfilled");
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    return asOf(interleave(ok.map((s) => s.value)), ok.map((s) => (s.value as Rows).asOf).filter((x): x is number => x !== undefined));
  }

  /** A name or ticker: ONE call across every network (GeckoTerminal's own relevance order), kept to our three chains; a chain that comes back with fewer than
   *  SEARCH_MIN_PER_CHAIN rows is asked for itself, if the call budget has room, so a popular name on Solana does not hide the same name on BNB Chain. */
  async function search(qRaw: string): Promise<CoinRow[]> {
    const q = qRaw.trim();
    if (q.length < 2) return [];
    if (EVM_ADDR.test(q) || SOL_ADDR.test(q)) return pasted(q);
    // a NEAR coin ("qtc.omft.near", "nep141:…", a 64-hex account), a Rhea or NEAR Intents pool, or a NEAR explorer's,
    // Rhea's or GeckoTerminal's link to one (TN1)
    // only what could be one (a dot, a colon, a link, 64 hex) loads NEAR's reader; a name never does
    const n = /[.:/]|^[0-9a-fA-F]{64}$|^refv[12]-/i.test(q) ? (await nearCode()).nearPasted(q) : undefined;
    if (n) return pastedNear(n);
    const enc = encodeURIComponent(q);
    const searchPath = `search/pools?query=${enc}&include=base_token%2Cquote_token%2Cdex&page=1`;
    const global = await gt.get<GtList>(searchPath, SEARCH_TTL_MS, "high", { staleMs: LIST_STALE_MS });
    const lists: CoinRow[][] = CHAINS.map(() => []);
    const all = rowsOf(poolViews("by-id", global).filter((v) => CHAINS.includes(v.chain)), { dropMoney: false, minLiquidity: SEARCH_MIN_LIQUIDITY_USD });
    for (const r of all) lists[CHAINS.indexOf(r.chain)]!.push(r);
    const thin = CHAINS.filter((c) => lists[CHAINS.indexOf(c)]!.length < SEARCH_MIN_PER_CHAIN);
    if (thin.length && gt.room("high") >= SEARCH_TOPUP_ROOM) {
      const more = await Promise.allSettled(thin.map(async (chain) => {
        const list = await gt.get<GtList>(`search/pools?query=${enc}&network=${GT_NETWORK[chain]}&include=base_token%2Cquote_token%2Cdex&page=1`, SEARCH_TTL_MS);
        return { chain, rows: rowsOf(poolViews(chain, list), { dropMoney: false, minLiquidity: SEARCH_MIN_LIQUIDITY_USD }) };
      }));
      for (const m of more) if (m.status === "fulfilled") {
        const mine = lists[CHAINS.indexOf(m.value.chain)]!;
        const have = new Set(mine.map((r) => normAddr(r.chain, r.address)));
        for (const r of m.value.rows) if (!have.has(normAddr(r.chain, r.address))) mine.push(r);
      }
    }
    // best first, by how real a coin is (its ticker, then the money in its market), never one chain then another
    return asOf(rankSearch(interleave(lists), q).slice(0, 30), [searchPath]);
  }
  /**
   * A pasted contract address, on each chain it could be on: GeckoTerminal's answer and the chain's own read at the same time,
   * shown whatever its liquidity and whatever the spam filter would say (the person asked for it). GeckoTerminal's row when it
   * lists the coin; the chain's when it doesn't (yet) or can't be asked. A Solana pool of a venue the engine trades is its coin.
   */
  async function pasted(q: string): Promise<CoinRow[]> {
    const chains: ChainId[] = EVM_ADDR.test(q) ? ["bsc", "hood"] : ["sol"];
    const settled = await Promise.allSettled(chains.map((chain) => pastedOn(chain, normAddr(chain, q))));
    const rows = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
    if (rows.length) return rows;
    const bad = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (bad) throw bad.reason; // a network failure is an error (ask again), not "no such coin"
    return [];
  }
  /** A pasted NEAR coin is read like any pasted address (the market data and the coin's own contract at once); a pasted
   *  Rhea pool is its coin: the side of the pool that isn't NEAR or a dollar. */
  async function pastedNear(n: NearPasted): Promise<CoinRow[]> {
    let coin = "coin" in n ? n.coin : undefined;
    if ("pool" in n) {
      const j = await gt.get<{ data?: GtPool }>(`networks/near/pools/${n.pool}`, TOKEN_TTL_MS, "high").catch((e: unknown) => { if (e instanceof MarketError && e.code === "not_found") return undefined; throw e; });
      const p = j?.data;
      if (!p) return [];
      const tail = (id?: string) => (id ? id.slice(id.indexOf("_") + 1) : "");
      const [b, qt] = [tail(p.relationships?.base_token?.data?.id), tail(p.relationships?.quote_token?.data?.id)];
      coin = quoteKindOf("near", b) === undefined ? b : qt;
    }
    if (!coin || !validTokenAddress("near", coin)) return [];
    const row = await pastedOn("near", coin);
    return row ? [row] : [];
  }
  const rowOfDetail = (d: CoinDetail): CoinRow => {
    const row: CoinRow = { chain: d.chain, address: d.address, symbol: d.symbol ?? "", name: d.name ?? d.symbol ?? "" };
    if (d.logoUrl) row.logoUrl = d.logoUrl; if (d.priceUsd !== undefined) row.priceUsd = d.priceUsd; if (d.change24hPct !== undefined) row.change24hPct = d.change24hPct;
    if (d.liquidityUsd !== undefined) row.liquidityUsd = d.liquidityUsd; if (d.volume24hUsd !== undefined) row.volume24hUsd = d.volume24hUsd; if (d.marketCapUsd !== undefined) row.marketCapUsd = d.marketCapUsd;
    return row;
  };
  /** GeckoTerminal's detail of a token, stored; undefined when it doesn't list it. Throws when it can't be asked. */
  const listed = async (chain: ChainId, address: string): Promise<CoinDetail | undefined> => {
    const k = keyOf(chain, address);
    try {
      const d = parseToken(chain, address, await gt.get<GtTokenAnswer>(tokenPath(chain, address), TOKEN_TTL_MS));
      notListed.delete(k); notePx(k, d.priceUsd);
      store(chain, address, { at: now(), meta: metaOf(d), full: true, detail: d });
      return d;
    } catch (e) {
      if (e instanceof MarketError && e.code === "not_found") { notListed.set(k, now()); return undefined; }
      throw e;
    }
  };
  /** One chain: a row, undefined when it isn't a coin there, or throws when neither GeckoTerminal nor a node could say. */
  async function pastedOn(chain: ChainId, address: string): Promise<CoinRow | undefined> {
    const factsP = chainFacts(chain, address);
    factsP.catch(() => undefined);
    const g = await listed(chain, address).then((d) => ({ d }), (e: unknown) => ({ e }));
    if ("d" in g && g.d) {
      // the market data names it; a name it leaves out, the chain may say (briefly waited for)
      if (!g.d.symbol || !g.d.name) {
        const f = await within(factsP.catch(() => undefined), 1_000);
        if (f && !g.d.symbol && f.symbol) g.d.symbol = f.symbol;
        if (f && !g.d.name && f.name) g.d.name = f.name;
      }
      return rowOfDetail(g.d);
    }
    let f: ChainFacts | undefined;
    try { f = await factsP; } catch (e) { throw "e" in g ? g.e : e; }
    // the chain's "no token here" is a verdict; with no node to ask, GeckoTerminal's failure stands ("ask again")
    if (!f) { if ("e" in g && !canReadChain(chain)) throw g.e; return undefined; }
    if (normAddr(chain, f.address) !== address) {
      // a pool was pasted: its coin, which the market data may list
      const d = await listed(chain, normAddr(chain, f.address)).catch(() => undefined);
      if (d) return rowOfDetail(d);
    }
    const d = detailOfFacts(f);
    storeChain(d);
    noteFactsPool(f);
    return rowOfDetail(d);
  }

  // ---- a coin page
  async function coin(chain: ChainId, address: string): Promise<CoinDetail> {
    if (!CHAINS.includes(chain) || !validTokenAddress(chain, address)) throw new MarketError("not_found", "not a token address on this chain");
    const addr = normAddr(chain, address), k = keyOf(chain, addr);
    // GeckoTerminal said a moment ago it doesn't list this coin: the chain alone, without asking it again
    if (listedNo(k) && canReadChain(chain)) return chainOnlyCoin(chain, addr, new MarketError("not_found", "the market data doesn't list this coin yet"));
    // Solana's one read (the mint, its metadata, its curve) starts at once: the page's security lines come from it
    const factsP = chain === "sol" ? chainFacts(chain, addr) : undefined;
    factsP?.catch(() => undefined);
    // a coin the chain named a moment ago (its search row) doesn't wait for room in the call budget: its page opens from the chain at once
    const waitMs = metas.get(k)?.chainOnly && canReadChain(chain) ? 0 : screenWait;
    let tok: GtTokenAnswer, info: { data?: { attributes?: Record<string, any> } } | undefined;
    try {
      [tok, info] = await Promise.all([
        gt.get<GtTokenAnswer>(tokenPath(chain, addr), TOKEN_TTL_MS, "high", { waitMs }),
        gt.get<{ data?: { attributes?: Record<string, any> } }>(infoPath(chain, addr), INFO_TTL_MS, "high", { waitMs }).catch(() => undefined),
      ]);
    } catch (e) {
      // not listed yet, or the market data can't be asked: the page opens from what the chain says (and Buy with it)
      if (e instanceof MarketError && e.code === "not_found") notListed.set(k, now());
      return chainOnlyCoin(chain, addr, e);
    }
    const d = parseToken(chain, addr, tok);
    notListed.delete(k); notePx(k, d.priceUsd);
    const ia = info?.data?.attributes;
    const better = coinLogo(chain, addr, ia?.image_url); if (better && !d.logoUrl) d.logoUrl = better;
    const holders = num(ia?.holders?.count); if (holders !== undefined) d.holders = holders;
    // the market's own read, display only (never a gate: Buy reads the chain itself)
    const top10 = num(ia?.holders?.distribution_percentage?.top_10); if (top10 !== undefined) d.top10Pct = top10;
    const score = num(ia?.gt_score); if (score !== undefined) d.score = Math.round(score);
    const dev = num(ia?.developer_holding_percentage); if (dev !== undefined) d.devPct = dev;
    if (ia?.gt_verified === true) d.verified = true;
    if (ia?.is_honeypot === true || ia?.is_honeypot === "yes") d.honeypot = true;
    let security = chain === "sol" ? securityOfInfo(ia) : undefined;
    // what the market data leaves out, the chain may say: the mint's authorities, a name, and (a coin it lists without a price,
    // still on its launch curve) the curve's price
    // only when the market data left something out, and never longer than CHAIN_WAIT_MS (a slow node never holds a listed coin's page)
    // Product decision, 4 Nov ("coin checks take too long"): a listed coin's page never waits on the chain for its freeze flag. What
    // Buy refuses is read by the page in parallel (screen.ts) and by every buy itself (curve-trade.ts); the flag joins the
    // page's next read when the chain has answered
    const need = !(d.priceUsd && d.symbol && d.name);
    const facts = canReadChain(chain) && (need || (chain === "sol" && security?.freezeAuthority === undefined)) ? await within((factsP ?? chainFacts(chain, addr)).catch(() => undefined), need ? CHAIN_WAIT_MS : 0) : undefined;
    if (facts && normAddr(chain, facts.address) === addr) {
      if (chain === "sol" && security?.freezeAuthority === undefined && facts.security) security = { ...security, ...facts.security };
      if (!d.symbol && facts.symbol) d.symbol = facts.symbol;
      if (!d.name && facts.name) d.name = facts.name;
      if (d.decimals === undefined) d.decimals = facts.decimals;
      if (d.priceUsd === undefined && facts.priceUsd !== undefined && saneVsMarket(facts.priceUsd, marketPx.get(k))) d.priceUsd = facts.priceUsd;
      if (d.marketCapUsd === undefined && d.priceUsd !== undefined && facts.supply > 0n) d.marketCapUsd = (Number(facts.supply) / 10 ** facts.decimals) * d.priceUsd;
    }
    if (security) d.security = security;
    // the last minute's move: the sampled live price if someone is watching, else the latest one-minute candles of the main pool (best effort, never holds the page)
    // the last minute's move: the sampled live price if someone is watching, else the latest one-minute candles of the main
    // pool, already on the device or asked in the background: the page never waits for it (it was up to 1.5 s)
    const mv = moveOfSamples(k), main = d.pools?.[0]?.address;
    if (mv !== undefined) d.moveBps60s = mv;
    const e = store(chain, addr, { at: now(), meta: metaOf(d), full: true, detail: d });
    if (mv === undefined && main) {
      void candlesCode().then(async ({ ohlcvPath, parseOhlcv, moveBpsOfMinutes }) => {
        const { path, ttlMs } = ohlcvPath(chain, main, addr, "1H");
        const dd = { ...d, moveBps60s: moveBpsOfMinutes(parseOhlcv(await gt.get(path, ttlMs, "low"))) };
        if (dd.moveBps60s !== undefined && metas.get(k) === e) store(chain, addr, { ...e, meta: metaOf(dd), detail: dd });
      }).catch(() => undefined);
    }
    return d;
  }

  /**
   * A coin page without the market data's answer: what the chain says (its name, and on a launch curve its price), else what a
   * list showed of it; priced by its pool on chain when it isn't on a curve. `why` (the market data's failure) when neither
   * the chain nor a list knows the coin.
   */
  async function chainOnlyCoin(chain: ChainId, addr: string, why: unknown): Promise<CoinDetail> {
    const k = keyOf(chain, addr);
    const f = canReadChain(chain) ? await within(chainFacts(chain, addr).catch(() => undefined), CHAIN_WAIT_MS) : undefined;
    if (f && normAddr(chain, f.address) !== addr) throw why;            // a pool is a coin page of its coin, not its own
    const seen = metas.get(k);
    if (!f && !(seen && !seen.chainOnly)) throw why;
    let d: CoinDetail;
    if (f) d = detailOfFacts(f);
    else {
      // only a list row: its name, the pool it was ranked in and the market data's price of then
      const m = seen!.meta;
      d = { chain, address: addr, fromChain: true, ...(m.symbol !== undefined ? { symbol: m.symbol } : {}), ...(m.name !== undefined ? { name: m.name } : {}), ...(m.decimals !== undefined ? { decimals: m.decimals } : {}), ...(m.pools ? { pools: m.pools } : {}), ...(m.priceUsd !== undefined ? { priceUsd: m.priceUsd } : {}), ...(m.change24hPct !== undefined ? { change24hPct: m.change24hPct } : {}) };
    }
    if (f) noteFactsPool(f);
    if (!(f?.priceUsd !== undefined && d.priceUsd === f.priceUsd)) {
      // not priced by its curve: its pool's spot price on chain
      const sp = await within(spotUsd(chain, addr, d.decimals), CHAIN_WAIT_MS);
      if (sp !== undefined) { d.priceUsd = sp; if (f && f.supply > 0n) d.marketCapUsd = (Number(f.supply) / 10 ** f.decimals) * sp; }
    }
    if (f) storeChain(d);
    return d;
  }

  async function candles(chain: ChainId, address: string, range: Range, o?: { warm?: boolean }): Promise<Candle[] & { fromChain?: true }> {
    if (!CHAINS.includes(chain) || !validTokenAddress(chain, address)) throw new MarketError("not_found", "not a token address on this chain");
    const addr = normAddr(chain, address);
    // a warm-up (a row on screen, the page's other ranges): the background lane, never waiting, no chain fallback
    if (o?.warm) return gtCandles(chain, addr, range, "low");
    try { return await gtCandles(chain, addr, range); }
    catch (e) {
      // no chart from the market data (it doesn't list the coin yet, or can't be asked): the pool's recent swaps on chain, a candle a minute
      const ticks = await recentOf(chain, addr).catch(() => [] as Tick[]);
      // marked: the page says this is the last few minutes of trades, not the range its tab names
      if (ticks.length) return Object.assign(candlesOfTicks(ticks), { fromChain: true as const });
      throw e;
    }
  }
  const recentMemo = new Map<string, { at: number; p: Promise<Tick[]> }>();
  function recentOf(chain: ChainId, addr: string): Promise<Tick[]> {
    const k = keyOf(chain, addr), pool = spotPools.get(k);
    if (!pool || !canReadPools(chain)) return Promise.resolve([]);
    const hit = recentMemo.get(k);
    if (hit && now() - hit.at < RECENT_TTL_MS) return hit.p;
    const ref = marketPx.get(k);
    const p = recentSwaps(spotEnv, chain, addr, pool, RECENT_SWAPS, now).then((ts) => ts.filter((t) => saneVsMarket(t.priceUsd, ref)));
    recentMemo.set(k, { at: now(), p });
    p.catch(() => recentMemo.delete(k));
    if (recentMemo.size > 50) recentMemo.delete(recentMemo.keys().next().value!);
    return p;
  }
  async function gtCandles(chain: ChainId, addr: string, range: Range, prio: Priority = "high"): Promise<Candle[]> {
    if (listedNo(keyOf(chain, addr))) throw new MarketError("not_found", "the market data doesn't list this coin yet, so it has no chart");
    let e = metas.get(keyOf(chain, addr));
    if (!e?.full) e = await refreshMeta(chain, addr, prio, prio === "high" ? screenWait : 0);
    // the coin's main pool: its deepest (a list row's pool is only the one it was ranked in)
    const pool = [...(e.meta.pools ?? [])].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0]?.address;
    if (!pool) throw new MarketError("not_found", "this coin has no pool to draw");
    // a range longer than the coin's life draws the life, in candles fine enough to see (candles.ts planFor)
    const born = e.detail?.createdAt, { history } = await candlesCode();
    return history(gt, chain, addr, pool, range, screenWait, born !== undefined ? Math.max(0, now() - born) : undefined, prio);
  }

  // ---- live prices: one polling timer per chain, one call per tick for every coin watched there (up to 30), background priority
  interface Watch { subs: Map<string, Set<(p: number, t: number) => void>> }
  const watches = new Map<ChainId, Watch & { timer?: ReturnType<typeof setInterval>; first?: ReturnType<typeof setTimeout>; native: Set<(p: number, t: number) => void> }>();
  const hidden = (): boolean => (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState === "hidden";
  // a watched coin whose pool is known follows that pool's swaps on chain (live.ts): over the chain's socket when there is one
  // (under a second after a trade), else by polling (a few seconds), where the market data's poll is every 15 s. Its prices
  // stand in for the market data's while they keep coming, after the same 100x PRICE SANITY, and reach only the live-price
  // watchers and a chain-only coin's page price: never marketPx (the sanity reference), the moves or meta() (the engines')
  // A Solana swap from the socket comes at "processed", marked unconfirmed (live.ts): it moves the live price and nothing else
  // (not even a chain-only coin's page price) until a confirmed read settles it, and if the confirmed chain doesn't have it the
  // live price goes back to the last swap still standing, or the market data's price, so the chart's newest candle (the
  // confirmed candles with the live price laid over them) is drawn again without it. "Latest trades" (trades(), recentOf())
  // and every candle come from confirmed reads only.
  const follows = new Map<string, () => void>();
  // how each followed coin's price reaches us (its follower's socket state), and who's watching it: a coin with no follower is
  // read every few seconds from the market data, so it is "polling"
  const liveStates = new Map<string, LiveState>(), stateSubs = new Map<string, Set<(s: LiveState) => void>>();
  const POLLING: LiveState = { state: "polling" };
  // who's watching each coin's swaps as they land (the coin page's Latest trades). Security, 28 Oct (B): a socket swap not
  // yet confirmed may show in this one list, marked unconfirmed (the page fades it, "confirming"); its settle sends it again
  // confirmed, and one the confirmed chain never has (failed, or past the 30 s backstop) is dropped. Nothing else of the
  // market (meta, candles, totals) ever sees it; the live price keeps its own rule
  const tradeSubs = new Map<string, Set<{ onTrade: (t: Tick) => void; onDrop?: (tx: string) => void }>>();
  const tellTrade = (k: string, t: Tick): void => { for (const s of [...(tradeSubs.get(k) ?? [])]) { try { s.onTrade(t); } catch { /* a consumer's bug is not ours */ } } };
  const tellDrop = (k: string, tx: string): void => { for (const s of [...(tradeSubs.get(k) ?? [])]) { try { s.onDrop?.(tx); } catch { /* a consumer's bug is not ours */ } } };
  const tellState = (k: string, s: LiveState): void => { liveStates.set(k, s); for (const cb of [...(stateSubs.get(k) ?? [])]) { try { cb(s); } catch { /* a consumer's bug is not ours */ } } };
  const chainTickAt = new Map<string, number>();

  function follow(chain: ChainId, address: string): void {
    const a = normAddr(chain, address), k = keyOf(chain, a), pool = spotPools.get(k);
    if (follows.has(k) || !pool || !canReadPools(chain) || !watches.get(chain)?.subs.has(a)) return;
    const send = (p: number, t: number) => { for (const cb of [...(watches.get(chain)?.subs.get(a) ?? [])]) { try { cb(p, t); } catch { /* a consumer's bug is not ours */ } } };
    const pagePrice = (p: number) => { const e = metas.get(k); if (e?.detail && e.chainOnly) metas.set(k, { ...e, detail: { ...e.detail, priceUsd: p } }); };
    // the swaps the live price came from, newest last: what it goes back to when one is taken back
    const shown: Tick[] = [];
    const stop = followSwaps(spotEnv, chain, a, pool, (tk) => {
      if (!saneVsMarket(tk.priceUsd, marketPx.get(k))) return;
      shown.push(tk);
      if (shown.length > 50) shown.shift();
      chainTickAt.set(k, now());
      if (!tk.unconfirmed) pagePrice(tk.priceUsd);
      tellTrade(k, tk);
      send(tk.priceUsd, tk.t);
    }, {
      pollMs: opts.chainPollMs ?? POLL_MS[chain], now, paused: hidden, ...(opts.ws ? { ws: opts.ws, onStatus: (st: LiveState) => tellState(k, { state: st.state }) } : {}),
      onSettle: (tx) => {
        shown.forEach((x, i) => { if (x.tx === tx && x.unconfirmed) { const { unconfirmed: _, ...ok } = x; shown[i] = ok; tellTrade(k, ok); } });
        const last = shown.at(-1);
        if (last?.tx === tx) pagePrice(last.priceUsd);
      },
      onRetract: (tx) => {
        tellDrop(k, tx);
        const wasLast = shown.at(-1)?.tx === tx;
        for (let i = shown.length - 1; i >= 0; i--) if (shown[i]!.tx === tx) shown.splice(i, 1);
        if (!wasLast) return;                                          // the price on screen is a later swap's
        const prev = shown.at(-1);
        if (prev) { chainTickAt.set(k, prev.t); send(prev.priceUsd, now()); return; }
        // no swap of ours left: the market data's price (a chain-only coin: its confirmed page price), and its poll again
        chainTickAt.delete(k);
        const e = metas.get(k), p = e?.chainOnly ? e.detail?.priceUsd : (marketPx.get(k) ?? e?.meta.priceUsd);
        if (p && p > 0) send(p, now());
      },
    });
    follows.set(k, stop);
  }
  const unfollow = (k: string): void => { follows.get(k)?.(); follows.delete(k); chainTickAt.delete(k); if (liveStates.has(k)) tellState(k, POLLING); liveStates.delete(k); };
  const chainFresh = (k: string): boolean => now() - (chainTickAt.get(k) ?? -Infinity) < CHAIN_TICK_FRESH_MS;
  async function tick(chain: ChainId): Promise<void> {
    const w = watches.get(chain);
    if (!w || hidden()) return;
    if (w.native.size) { try { const v = await nativeUsd(chain); const t = now(); for (const cb of [...w.native]) cb(v, t); } catch { /* the next tick */ } }
    const addrs = [...w.subs.keys()].slice(0, 30);
    if (!addrs.length) return;
    // the coins watched are mostly the person's own: asked among the chain's listed coins in one sorted, fixed-size batch,
    // so the relay's logs can't read holdings from the address (audit D148 L13); the padding is the coins the lists
    // already showed, in the order they were first seen, so the same batch is asked again and its cached answer serves
    const known = [...marketPx.keys()].filter((k) => k.startsWith(`${chain}:`)).map((k) => k.slice(chain.length + 1));
    const batch = paddedBatch(addrs.map((a) => normAddr(chain, a)), known, PRICE_BATCH);
    const fromChain = async (missing: string[]) => {
      // a coin the market data doesn't list (a launch curve's coin minutes old) or can't price right now: its price from the
      // chain (its curve, else its pool), a few per tick
      const asked = missing.filter((x) => !chainFresh(keyOf(chain, x)) && (metas.get(keyOf(chain, x))?.chainOnly || spotPools.has(keyOf(chain, x)))).slice(0, 3);
      for (const a of asked) {
        const f = metas.get(keyOf(chain, a))?.chainOnly ? await chainFacts(chain, a).catch(() => undefined) : undefined;
        const p = f?.priceUsd ?? (await spotUsd(chain, a));
        if (!(p && p > 0) || !saneVsMarket(p, marketPx.get(keyOf(chain, a)))) continue;
        const t = now(), k = keyOf(chain, a), e = metas.get(k);
        if (e?.detail) metas.set(k, { ...e, detail: { ...e.detail, priceUsd: p } });
        for (const cb of [...(w.subs.get(a) ?? [])]) { try { cb(p, t); } catch { /* a consumer's bug is not ours */ } }
      }
    };
    try {
      const path = `simple/networks/${GT_NETWORK[chain]}/token_price/${batch.join(",")}`;
      const j = await gt.get<{ data?: { attributes?: { token_prices?: Record<string, string | null> } } }>(path, Math.max(1000, pollMs - 1000), "low");
      const prices = j.data?.attributes?.token_prices ?? {};
      // the time of the answer itself, never "now": a poll the budget skipped (or a 429) re-serves the last answer, up to
      // gt.ts's 15 minutes old, and the coin page must say how old that price is, not show it as just heard (audit 2 Nov)
      const t = Math.min(now(), gt.servedAt(path) ?? now());
      const fresh = now() - t < pollMs;
      const missing: string[] = [];
      for (const a of addrs) {
        const p = num(prices[a] ?? prices[a.toLowerCase()]);
        if (!(p && p > 0)) { missing.push(a); continue; }
        const k = keyOf(chain, a);
        notePx(k, p);
        // the last minute's move is sampled from new answers only (an old one again is no sample of now)
        if (fresh) { const s = (samples.get(k) ?? []).filter((x) => t - x.t <= MOVE_WINDOW_MS); s.push({ t, p }); samples.set(k, s); }
        const e = metas.get(k);
        if (e) { const mv = moveOfSamples(k); metas.set(k, { ...e, meta: { ...e.meta, priceUsd: p, ...(mv !== undefined ? { moveBps60s: mv } : {}) } }); }
        if (chainFresh(k)) continue;                                   // the coin's own swaps are newer than this poll
        for (const cb of [...(w.subs.get(a) ?? [])]) { try { cb(p, t); } catch { /* a consumer's bug is not ours */ } }
      }
      if (missing.length) await fromChain(missing);
    } catch { await fromChain(addrs).catch(() => undefined); /* over budget or offline: the chain's price where it has one, else the next tick */ }
  }
  function livePrice(chain: ChainId, address: string, onPrice: (priceUsd: number, t: number) => void, onState?: (s: LiveState) => void): () => void {
    if (!CHAINS.includes(chain)) return () => {};
    const isNative = address === "native" || address === "";
    if (!isNative && !validTokenAddress(chain, address)) return () => {};
    let w = watches.get(chain);
    if (!w) { w = { subs: new Map(), native: new Set() }; watches.set(chain, w); }
    const a = isNative ? "" : normAddr(chain, address);
    const set = isNative ? w.native : (w.subs.get(a) ?? w.subs.set(a, new Set()).get(a)!);
    set.add(onPrice);
    const sk = keyOf(chain, a);
    if (onState && !isNative) { (stateSubs.get(sk) ?? stateSubs.set(sk, new Set()).get(sk)!).add(onState); onState(liveStates.get(sk) ?? POLLING); }
    if (!isNative) follow(chain, a);
    if (!w.timer) {
      w.timer = setInterval(() => { void tick(chain); }, pollMs);
      (w.timer as { unref?: () => void }).unref?.();
      // the first reading comes soon, and everything that subscribed meanwhile shares it
      w.first = setTimeout(() => { w!.first = undefined; void tick(chain); }, 50);
      (w.first as { unref?: () => void }).unref?.();
    }
    return () => {
      set.delete(onPrice);
      if (onState) { stateSubs.get(sk)?.delete(onState); if (!stateSubs.get(sk)?.size) stateSubs.delete(sk); }
      if (!isNative && set.size === 0) { w!.subs.delete(a); unfollow(keyOf(chain, a)); }
      if (w!.subs.size === 0 && w!.native.size === 0) { clearInterval(w!.timer); clearTimeout(w!.first); watches.delete(chain); }
    };
  }

  // ---- the coin page's "Latest trades" and, on BNB Chain and Robinhood Chain, the coin's own checks (display only) ----
  async function trades(chain: ChainId, address: string, minUsd = 0): Promise<Tick[]> {
    const addr = normAddr(chain, address);
    const big = (t: Tick) => t.usd >= minUsd;
    const own = (await recentOf(chain, addr).catch(() => [] as Tick[])).filter(big);
    // the chain's own swaps first; without a node reader or its pool (or, for Whales, none that big lately), the market
    // data's trades of the coin's top pool, asked for that size: CoinGecko's through the relay (its paid key), else
    // GeckoTerminal's public list
    const list = own.length ? own : (await poolTrades(chain, addr, minUsd)).filter(big);
    return [...list].sort((a, b) => b.t - a.t).slice(0, LATEST_TRADES);
  }
  const tradesMemo = new Map<string, { at: number; p: Promise<Tick[]> }>();
  function poolTrades(chain: ChainId, addr: string, minUsd = 0): Promise<Tick[]> {
    const k = keyOf(chain, addr), mk = k + (minUsd > 0 ? `>${minUsd}` : "");
    const pool = [...(metas.get(k)?.meta.pools ?? [])].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0]?.address;
    if (!pool) return Promise.resolve([]);
    const hit = tradesMemo.get(mk);
    if (hit && now() - hit.at < RECENT_TTL_MS) return hit.p;
    const path = `networks/${GT_NETWORK[chain]}/pools/${pool}/trades${minUsd > 0 ? `?trade_volume_in_usd_greater_than=${minUsd}` : ""}`;
    const read = (fx: typeof fetch, url: string) => fx(url, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))));
    const ref = marketPx.get(k);
    // CoinGecko's /onchain needs a paid key, which only the relay holds: without one it is never asked (keyless it refuses
    // every call, and each refusal spent CoinGecko's per-IP limit the coin prices (simple/price) live on, every 20 s)
    const viaGt = () => read(plain, `${GT_BASE}/${path}`);
    const p = (relay ? read(f, `${CG_BASE}/onchain/${path}`).catch(viaGt) : viaGt())
      .then((j: { data?: { attributes?: Record<string, unknown> }[] }) => (j.data ?? []).map((x) => tickOfTrade(x.attributes ?? {})).filter((t): t is Tick => !!t && saneVsMarket(t.priceUsd, ref)), () => [] as Tick[]);
    tradesMemo.set(mk, { at: now(), p });
    if (tradesMemo.size > 50) tradesMemo.delete(tradesMemo.keys().next().value!);
    return p;
  }
  const checksMemo = new Map<string, { at: number; p: Promise<EvmSecurity | undefined> }>();
  function checks(chain: ChainId, address: string): Promise<EvmSecurity | undefined> {
    if ((chain !== "bsc" && chain !== "hood") || !opts.evmRpc) return Promise.resolve(undefined);
    const addr = normAddr(chain, address), k = keyOf(chain, addr);
    const hit = checksMemo.get(k);
    if (hit && now() - hit.at < CHECKS_TTL_MS) return hit.p;
    // the pool a sale goes to: the one the page is priced from, else the market data's deepest
    const top = spotPools.get(k) ?? (() => { const ps = [...(metas.get(k)?.meta.pools ?? [])].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)); return ps[0] ? { pool: ps[0].address, dex: ps[0].dex ?? "" } : undefined; })();
    const sellTo = top ? sellTarget(chain, top.pool, top.dex) : undefined;
    const p = evmSecurity(opts.evmRpc, chain, addr, sellTo);
    checksMemo.set(k, { at: now(), p });
    p.catch(() => checksMemo.delete(k));
    if (checksMemo.size > 50) checksMemo.delete(checksMemo.keys().next().value!);
    return p;
  }

  /** Each swap of a coin as it lands, from the follower its live price runs (livePrice must be watching it): a socket swap
   *  not yet confirmed comes marked `unconfirmed`, then again confirmed when the chain settles it, or `onDrop` if it never does. */
  function liveTrades(chain: ChainId, address: string, onTrade: (t: Tick) => void, onDrop?: (tx: string) => void): () => void {
    if (!CHAINS.includes(chain) || !validTokenAddress(chain, address)) return () => {};
    const k = keyOf(chain, normAddr(chain, address)), sub = { onTrade, ...(onDrop ? { onDrop } : {}) };
    (tradeSubs.get(k) ?? tradeSubs.set(k, new Set()).get(k)!).add(sub);
    return () => { tradeSubs.get(k)?.delete(sub); if (!tradeSubs.get(k)?.size) tradeSubs.delete(k); };
  }

  // ---- the list screen's own fast reads (display only, never an input to a trade)
  /** Fresh launches on a chain, newest first: GeckoTerminal's new pools, the spam filter applied as for trending. Through the
   *  relay (S13, 5 Nov: solana, bsc, robinhood and near); an older relay's "route unknown" goes to GeckoTerminal itself (relay.ts). */
  async function fresh(chain: ChainId, o?: ListRead): Promise<CoinRow[] & { asOf?: number }> {
    const path = `networks/${GT_NETWORK[chain]}/new_pools?${INCLUDE}`;
    // NEAR (S13): a page of NEAR's new pools is mostly test pairs the spam filter hides, so its second page joins it
    const near = chain === "near" ? await nearPages([path, path.replace(/page=1$/, "page=2")], FRESH_TTL_MS, laneOf(o), 1) : undefined;
    const views = near ? near.views.flat() : poolViews(chain, await gt.get<GtList>(path, FRESH_TTL_MS, laneOf(o), { staleMs: LIST_STALE_MS }));
    const born = new Map(views.map((v) => [nameKey(v), Date.parse(v.createdAt ?? "")]));
    const rows = rowsOf(views, { dropMoney: true }).map((r) => { const t = born.get(`${r.chain}:${normAddr(r.chain, r.address)}`); return Number.isFinite(t) ? { ...r, createdAt: t! } : r; });
    rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return asOf(rows, near?.from ?? [path]);
  }
  /** Today's prices of up to 30 coins of one chain in one call (the relay keeps it 10 s): the list's numbers stay live
   *  without asking for the list again. Coins it has no price for are left out. A price far from the market's own is
   *  left out too (PRICE SANITY). */
  async function prices(chain: ChainId, addresses: readonly string[]): Promise<Record<string, number>> {
    const addrs = [...new Set(addresses.filter((a) => validTokenAddress(chain, a)))].slice(0, 30);
    if (!addrs.length) return {};
    // sorted: the same coins in any order are one address, one cached answer (audit D148 L13)
    const path = `simple/networks/${GT_NETWORK[chain]}/token_price/${[...addrs].map((a) => normAddr(chain, a)).sort().join(",")}`;
    // only the list's own 15 s refresh asks this: background work, never ahead of a coin page (D145)
    const j = await gt.get<{ data?: { attributes?: { token_prices?: Record<string, string | null> } } }>(path, PRICES_TTL_MS, "low");
    const got = j.data?.attributes?.token_prices ?? {};
    const out: Record<string, number> = {};
    for (const a of addrs) {
      const p = num(got[a] ?? got[a.toLowerCase()]);
      if (!(p && p > 0) || !saneVsMarket(p, marketPx.get(keyOf(chain, a)))) continue;
      notePx(keyOf(chain, a), p);
      out[a] = p;
    }
    return out;
  }

  return { search, trending, fresh, prices, coin, candles, nativeUsd, checkedUsd, sizingUsd, meta, livePrice, liveTrades, trades, checks, stats: () => gt.stats() };
}
/** One trade of GeckoTerminal's / CoinGecko's pool trades, as the page's tick: when, which way, how many dollars, at what price. */
export function tickOfTrade(a: Record<string, unknown>): Tick | undefined {
  const t = Date.parse(String(a.block_timestamp ?? "")), usd = Number(a.volume_in_usd), side = a.kind === "sell" ? "sell" as const : a.kind === "buy" ? "buy" as const : undefined;
  const px = Number(side === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
  if (!side || !Number.isFinite(t) || !(usd > 0) || !(px > 0)) return undefined;
  return { t, side, usd, priceUsd: px, ...(typeof a.tx_hash === "string" ? { tx: a.tx_hash } : {}) };
}
/** "Latest trades" shows at most this many, newest first. */
export const LATEST_TRADES = 20;
/** A coin's checks are asked again after this long. */
export const CHECKS_TTL_MS = 5 * 60_000;
