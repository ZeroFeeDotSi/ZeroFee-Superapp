// The native coins' dollar prices (SOL, BNB, ETH): one keyless CoinGecko call for all three (api.coingecko.com/api/v3/simple/price answers
// access-control-allow-origin: *), cached about 30 s; GeckoTerminal's price of the wrapped coin is the fallback. An old answer is served while a new one is fetched.
import type { ChainId } from "../types.ts";
import { GT_NETWORK, MarketError, type GtClient } from "./gt.ts";
import type { SpotPool } from "./spot.ts";
import { WSOL, num } from "./map.ts";

export const CG_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana,binancecoin,ethereum,near&vs_currencies=usd";
export const NATIVE_TTL_MS = 30_000;
/** An answer older than this is not served any more. */
export const NATIVE_STALE_MS = 10 * 60_000;
/** After CoinGecko failed, it is not asked again for this long. */
export const CG_RETRY_MS = 15_000;
const CG_ID: Record<ChainId, string> = { sol: "solana", bsc: "binancecoin", hood: "ethereum", near: "near" };
export const WRAPPED_NATIVE: Record<ChainId, string> = { sol: WSOL, bsc: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", hood: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", near: "wrap.near" };

/** How far apart CoinGecko's and GeckoTerminal's prices may be for a session's caps to be set in them. */
export const CHECK_SPREAD = 0.03;
/** How old either may be. */
export const CHECK_AGE_MS = 60_000;

/** The two sources answered, and are more than CHECK_SPREAD apart: one of them is wrong, so neither is used. */
export class PricesDisagree extends MarketError {
  constructor(a: number, b: number) { super("bad_response", `the two prices disagree: ${a} and ${b}`); this.name = "PricesDisagree"; }
}

/**
 * The price a trading session's caps are set in: CoinGecko's and GeckoTerminal's (the wrapped coin), each at most a minute
 * old, within 3 % of each other; the higher of the two, so the caps in coin units are the smaller. One source alone, or two
 * that disagree, throws: no session starts, and each trade asks on its own sheet.
 */
export function createCheckedPrice(o: { fetch: typeof fetch; gt: GtClient }): (chain: ChainId) => Promise<number> {
  return async (chain) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const cg = o.fetch(CG_PRICE_URL, { signal: ctl.signal }).then(async (r) => {
      if (!r.ok) throw new MarketError(r.status === 429 ? "rate" : "unreachable", `HTTP ${r.status}`);
      const v = num(((await r.json()) as Record<string, { usd?: number }>)?.[CG_ID[chain]]?.usd);
      if (!(v && v > 0)) throw new MarketError("bad_response", "no price");
      return v;
    }).finally(() => clearTimeout(timer));
    const a = WRAPPED_NATIVE[chain];
    const gt = o.gt.get<{ data?: { attributes?: { token_prices?: Record<string, string | null> } } }>(`simple/networks/${GT_NETWORK[chain]}/token_price/${a}`, CHECK_AGE_MS).then((j) => {
      const v = num(j.data?.attributes?.token_prices?.[a]);
      if (!(v && v > 0)) throw new MarketError("bad_response", "no price");
      return v;
    });
    const [x, y] = await Promise.all([cg, gt]);
    if (Math.abs(x - y) / Math.min(x, y) > CHECK_SPREAD) throw new PricesDisagree(x, y);
    return Math.max(x, y);
  };
}

/** `maxAgeMs`: never an answer older than this (it waits for a new one instead of serving the old one meanwhile). */
export type NativePrice = (chain: ChainId, o?: { maxAgeMs?: number }) => Promise<number>;

export function createNativePrices(o: { fetch: typeof fetch; now: () => number; gt: GtClient }): NativePrice {
  const cache = new Map<ChainId, { at: number; usd: number }>();
  let inflight: Promise<void> | undefined, cgFailedAt = -Infinity;

  async function loadCg(): Promise<void> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await o.fetch(CG_PRICE_URL, { signal: ctl.signal });
      if (!r.ok) throw new MarketError(r.status === 429 ? "rate" : "unreachable", `HTTP ${r.status}`);
      const j = await r.json() as Record<string, { usd?: number }>;
      let any = false;
      for (const c of Object.keys(CG_ID) as ChainId[]) { const v = num(j?.[CG_ID[c]]?.usd); if (v && v > 0) { cache.set(c, { at: o.now(), usd: v }); any = true; } }
      if (!any) throw new MarketError("bad_response", "no prices");
    } catch (e) { cgFailedAt = o.now(); throw e; } finally { clearTimeout(timer); }
  }
  const refresh = (): Promise<void> => {
    if (!inflight) inflight = loadCg().finally(() => { inflight = undefined; });
    return inflight;
  };
  async function viaGt(chain: ChainId): Promise<number> {
    const a = WRAPPED_NATIVE[chain];
    const j = await o.gt.get<{ data?: { attributes?: { token_prices?: Record<string, string | null> } } }>(`simple/networks/${GT_NETWORK[chain]}/token_price/${a}`, NATIVE_TTL_MS);
    const v = num(j.data?.attributes?.token_prices?.[a]);
    if (!(v && v > 0)) throw new MarketError("bad_response", "no price");
    cache.set(chain, { at: o.now(), usd: v });
    return v;
  }

  return async function nativeUsd(chain, a) {
    const hit = cache.get(chain), age = hit ? o.now() - hit.at : Infinity;
    if (hit && age < Math.min(NATIVE_TTL_MS, a?.maxAgeMs ?? Infinity)) return hit.usd;
    const canAsk = o.now() - cgFailedAt >= CG_RETRY_MS;
    if (hit && age < Math.min(NATIVE_STALE_MS, a?.maxAgeMs ?? Infinity)) { if (canAsk) void refresh().catch(() => {}); return hit.usd; }
    if (canAsk) { try { await refresh(); const v = cache.get(chain); if (v) return v.usd; } catch { /* the fallback below */ } }
    return viaGt(chain);
  };
}

/** How old the price that sizes a dollar buy may be (audit MKT-1), and how long a checked one is kept. */
export const SIZING_AGE_MS = 60_000;
export const SIZING_KEEP_MS = 30_000;
/** How far one source's price may be from the chain's own (a deep pool's spot) when the other source is down. */
export const SPOT_SPREAD = 0.05;

/**
 * The deep native / dollar pool each chain's own price is read from (market/spot.ts), when one market source is down. Each
 * read on chain on 28 Oct 2026 against CoinGecko: Raydium CLMM SOL/USDC (~$8M) 0.02 % apart, PancakeSwap v2 WBNB/USDT
 * (~$48M) 0.11 %, Uniswap v3 WETH/USDG on Robinhood Chain (~$13M) 0.02 %.
 */
export const NATIVE_SPOT_POOLS: Partial<Record<ChainId, SpotPool>> = {
  sol: { chain: "sol", pool: "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv", dex: "raydium-clmm", coin: { address: WSOL, decimals: 9 }, quote: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, kind: "stable" } },
  bsc: { chain: "bsc", pool: "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae", dex: "pancakeswap_v2", coin: { address: WRAPPED_NATIVE.bsc, decimals: 18 }, quote: { address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18, kind: "stable" } },
  hood: { chain: "hood", pool: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca", dex: "uniswap-v3-robinhood", coin: { address: WRAPPED_NATIVE.hood, decimals: 18 }, quote: { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6, kind: "stable" } },
};

/** 1Click's token list, asked directly (never through ZeroFee's relay): the core's own price of each chain's coin. */
export const ONECLICK_TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";
const ONECLICK_ID: Record<ChainId, string> = { sol: "nep141:sol.omft.near", bsc: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", hood: "nep141:eth.omft.near", near: "nep141:wrap.near" };
/** How old 1Click's own price may be (its priceUpdatedAt), as the core takes it. */
export const CORE_PRICE_AGE_MS = 15 * 60_000;
/** The core's price is read again after this long. */
export const CORE_PRICE_TTL_MS = 30_000;

/**
 * The core's price of a chain's coin (audit R-2): the same 1Click token list the core sets a session's caps in, asked
 * DIRECTLY with a plain fetch, so it never goes through the relay both market sources go through. Null when 1Click can't
 * be read or its price is older than CORE_PRICE_AGE_MS.
 */
export function createCorePrice(o: { fetch: typeof fetch; now: () => number }): (chain: ChainId) => Promise<number | null> {
  let kept: { at: number; list: any[] } | undefined, asking: Promise<any[]> | undefined;
  const list = async (): Promise<any[]> => {
    if (kept && o.now() - kept.at < CORE_PRICE_TTL_MS) return kept.list;
    asking ??= (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const r = await o.fetch(ONECLICK_TOKENS_URL, { signal: ctl.signal });
        if (!r.ok) throw new MarketError("unreachable", `HTTP ${r.status}`);
        const l = await r.json();
        if (!Array.isArray(l)) throw new MarketError("bad_response", "no token list");
        kept = { at: o.now(), list: l };
        return l;
      } finally { clearTimeout(timer); asking = undefined; }
    })();
    return asking;
  };
  return async (chain) => {
    try {
      const t = (await list()).find((x) => x?.assetId === ONECLICK_ID[chain]);
      const price = Number(t?.price), at = Date.parse(String(t?.priceUpdatedAt));
      return Number.isFinite(price) && price > 0 && Number.isFinite(at) && o.now() - at < CORE_PRICE_AGE_MS ? price : null;
    } catch { return null; }
  };
}

/**
 * The price a dollar buy is sized in (audit MKT-1: it was one source's answer, served up to 10 min old). The checked price
 * (CoinGecko and GeckoTerminal, each at most a minute old, within 3 %, the higher: fewer coins for the dollars), kept 30 s
 * so a quote waits for it at most once. When the check can't be made because a source is down or rate-limited, the other
 * source's answer at most a minute old, and only within SPOT_SPREAD of the chain's own price (`spot`: a deep pool read on
 * chain), the higher of the two; when the market's two disagree, or the one left has no chain price to agree with, it
 * throws and nothing is sized.
 */
export function createSizingPrice(o: { checked: (chain: ChainId) => Promise<number>; native: NativePrice; spot: (chain: ChainId) => Promise<number | undefined>; now: () => number; core?: (chain: ChainId) => Promise<number | null> }): (chain: ChainId) => Promise<number> {
  const kept = new Map<ChainId, { at: number; usd: number }>();
  const asking = new Map<ChainId, Promise<number>>();
  const relayed = relayedSizing(o, kept, asking);
  if (!o.core) return relayed;
  const core = o.core;
  // audit R-2: CoinGecko and GeckoTerminal both come through the one relay, so their agreeing is one party's word. A trade
  // is sized in the core's own price (1Click, asked directly), once a second witness agrees with it: the relay's checked
  // price within CHECK_SPREAD, or else the chain's own deep pool within SPOT_SPREAD. Without the core's price, the relay's
  // must agree with the chain (never the relay alone); disagreeing witnesses size nothing.
  return async (chain) => {
    const hit = kept.get(chain);
    if (hit && o.now() - hit.at < SIZING_KEEP_MS) return hit.usd;
    const [c, r] = await Promise.all([core(chain).catch(() => null), o.checked(chain).catch((e: unknown) => e as Error)]);
    const near = (a: number, b: number, spread: number) => Math.abs(a - b) / Math.min(a, b) <= spread;
    if (c && c > 0) {
      if (typeof r === "number" && near(c, r, CHECK_SPREAD)) { kept.set(chain, { at: o.now(), usd: c }); return c; }
      const own = await o.spot(chain).catch(() => undefined);
      if (own && own > 0 && near(c, own, SPOT_SPREAD)) { kept.set(chain, { at: o.now(), usd: c }); return c; }
      if (typeof r === "number") throw new PricesDisagree(c, r);
      if (own && own > 0) throw new PricesDisagree(c, own);
      throw new MarketError("unreachable", `the core's price (${c}) and nothing to check it against`);
    }
    // no core price: the relay's answer only as far as the chain agrees with it
    const one = typeof r === "number" ? r : r instanceof PricesDisagree ? undefined : await o.native(chain, { maxAgeMs: SIZING_AGE_MS }).catch(() => undefined);
    if (one === undefined) throw r instanceof Error ? r : new MarketError("unreachable", "no price");
    const own = await o.spot(chain).catch(() => undefined);
    if (!(own && own > 0)) throw new MarketError("unreachable", `the relay's price (${one}) and no chain or core price to check it against`);
    if (!near(one, own, SPOT_SPREAD)) throw new PricesDisagree(one, own);
    return Math.max(one, own);
  };
}

/** The sizing price from the market's two sources alone (no core price given: sample data and tests). */
function relayedSizing(o: { checked: (chain: ChainId) => Promise<number>; native: NativePrice; spot: (chain: ChainId) => Promise<number | undefined>; now: () => number }, kept: Map<ChainId, { at: number; usd: number }>, asking: Map<ChainId, Promise<number>>): (chain: ChainId) => Promise<number> {
  return async (chain) => {
    const hit = kept.get(chain);
    if (hit && o.now() - hit.at < SIZING_KEEP_MS) return hit.usd;
    let p = asking.get(chain);
    if (!p) {
      p = o.checked(chain).then((usd) => { kept.set(chain, { at: o.now(), usd }); return usd; }).finally(() => asking.delete(chain));
      asking.set(chain, p);
    }
    try { return await p; }
    catch (e) {
      if (e instanceof PricesDisagree) throw e;
      const [one, own] = await Promise.all([o.native(chain, { maxAgeMs: SIZING_AGE_MS }), o.spot(chain).catch(() => undefined)]);
      if (!(own && own > 0)) throw new MarketError("unreachable", `one market price (${one}) and no chain price to check it against`);
      if (Math.abs(one - own) / Math.min(one, own) > SPOT_SPREAD) throw new PricesDisagree(one, own);
      return Math.max(one, own);
    }
  };
}
