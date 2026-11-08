import { APP_CHAINS } from "@zerofee/core/app-chains";
// Native coins (product decision, 5 Nov, items 4-5): the coins NEAR Intents lists (1Click's GET /v0/tokens, ~215 assets), each
// bought and sold from the Safe by ONE swap inside NEAR Intents (swap.ts). Pure: no fetch, no React. What this module
// decides: which of the 215 are shown (one row per coin, its home asset), where its market data lives (CoinGecko's id,
// as 1Click lists it; GeckoTerminal's network and token), and the ranking (best 24 h first). Market data is display
// only: it never sizes a swap (the quote is 1Click's, signed, read by the core).

/** One asset as 1Click's token list gives it (read 5 Nov 2026: assetId, decimals, blockchain, symbol, price, contractAddress?, coingeckoId?). */
export interface IntentsToken { assetId: string; decimals: number; blockchain: string; symbol: string; price?: number; contractAddress?: string; coingeckoId?: string }

/** Where GeckoTerminal has a coin: its network id and the token's address there. */
export interface GtSpot { network: string; address: string }

/** A coin as Native coins shows it: the asset bought (in the Safe), and where its market data is. */
export interface NativeCoin { assetId: string; symbol: string; blockchain: string; decimals: number; cgId?: string; gt?: GtSpot; price1c?: number }

/** The Safe's cash: Buy pays with it and Sell returns it (the swap-in-place builder, 5 Nov). USDC on NEAR. */
export const SAFE_CASH = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** An intents asset id, by shape: nep141:<account> or nep245:<contract>:<token>. */
export const ASSET_ID = /^(?:nep141:[a-z0-9_.-]{2,64}|nep245:[a-z0-9_.-]{2,64}:[A-Za-z0-9_.-]{1,80})$/;
export const isAssetId = (s: string): boolean => ASSET_ID.test(s);

/** GeckoTerminal's network id for 1Click's blockchain names (GT's /networks, checked 5 Nov 2026; near and robinhood are Trade's own). */
export const GT_NETWORK_OF: Readonly<Record<string, string>> = {
  eth: "eth", base: "base", arb: "arbitrum", op: "optimism", sol: "solana", near: "near", bsc: "bsc", pol: "polygon_pos",
  avax: "avax", gnosis: "xdai", hood: "robinhood", scroll: "scroll", starknet: "starknet-alpha", xlayer: "x-layer", bera: "berachain",
};
/** A chain's own coin has no contract: GeckoTerminal prices its wrapped twin (by CoinGecko id). Others: CoinGecko only. */
export const WRAPPED: Readonly<Record<string, GtSpot>> = {
  ethereum: { network: "eth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  bitcoin: { network: "eth", address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599" },
  solana: { network: "solana", address: "So11111111111111111111111111111111111111112" },
  binancecoin: { network: "bsc", address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" },
  "avalanche-2": { network: "avax", address: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7" },
  near: { network: "near", address: "wrap.near" },
  "wrapped-near": { network: "near", address: "wrap.near" },
  "polygon-ecosystem-token": { network: "polygon_pos", address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270" },
};

/** Cash, test and retired assets: listed (any coin can be bought) but never ranked as performing. */
const STABLE_IDS = new Set(["usd-coin", "tether", "dai", "usds", "ethena-usde", "frax", "usd1-wrapped-by-world-liberty-financial", "global-dollar", "monerium-eur-money", "monerium-gbp-money", "falcon-finance", "xdai", "usdt0", "bridged-usdc-polygon-pos-bridge"]);
export function hidden(t: { symbol: string; coingeckoId?: string; cgId?: string }): boolean {
  const id = t.coingeckoId ?? t.cgId;
  if (/DEPRECATED|^TEST/i.test(t.symbol)) return true;
  if (id && STABLE_IDS.has(id)) return true;
  return /^(?:[a-z]*usd[a-z0-9]*|eur[a-z]?|gbp[a-z]?|xdai)$/i.test(t.symbol) || /usdc|usdt/i.test(t.symbol);
}

/** 1Click's list, read strictly: a row without a valid id, decimals or symbol is dropped, never guessed. */
export function readTokens(raw: unknown): IntentsToken[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): IntentsToken[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.assetId !== "string" || !isAssetId(o.assetId) || typeof o.symbol !== "string" || !o.symbol || typeof o.blockchain !== "string") return [];
    if (typeof o.decimals !== "number" || !Number.isInteger(o.decimals) || o.decimals < 0 || o.decimals > 36) return [];
    return [{
      assetId: o.assetId, decimals: o.decimals, blockchain: o.blockchain, symbol: o.symbol.slice(0, 16),
      ...(typeof o.price === "number" && o.price > 0 ? { price: o.price } : {}),
      ...(typeof o.contractAddress === "string" && o.contractAddress ? { contractAddress: o.contractAddress } : {}),
      ...(typeof o.coingeckoId === "string" && /^[a-z0-9-]{1,80}$/.test(o.coingeckoId) ? { coingeckoId: o.coingeckoId } : {}),
    }];
  });
}

/** Where GeckoTerminal has this asset: its own contract on its own network, else its wrapped twin, else nowhere. */
export function gtSpot(t: IntentsToken): GtSpot | undefined {
  const network = GT_NETWORK_OF[t.blockchain];
  if (network && t.contractAddress) return { network, address: network === "solana" || network === "near" ? t.contractAddress : t.contractAddress.toLowerCase() };
  return t.coingeckoId ? WRAPPED[t.coingeckoId] : undefined;
}

/** A coin people know by another name than its asset's: the Safe's NEAR is wNEAR inside NEAR Intents, but it is NEAR
 *  everywhere a person reads it (the design review, 5 Nov). Its asset id never changes. */
export const SHOWN_AS: Readonly<Record<string, { symbol: string; name: string }>> = { "nep141:wrap.near": { symbol: "NEAR", name: "NEAR" } };

export function nativeOf(t: IntentsToken): NativeCoin {
  const gt = gtSpot(t);
  return { assetId: t.assetId, symbol: SHOWN_AS[t.assetId]?.symbol ?? t.symbol, blockchain: t.blockchain, decimals: t.decimals, ...(t.coingeckoId ? { cgId: t.coingeckoId } : {}), ...(gt ? { gt } : {}), ...(t.price ? { price1c: t.price } : {}) };
}

/** Every asset 1Click lists (owner: the Safe can buy ANY of the ~215), one row each but the Safe's cash, which pays. */
export function nativeCoins(tokens: readonly IntentsToken[]): NativeCoin[] {
  const seen = new Set<string>();
  return tokens.filter((t) => t.assetId !== SAFE_CASH && !seen.has(t.assetId) && seen.add(t.assetId)).map(nativeOf);
}

/** 1Click's chain names as people say them (a symbol on many chains says which). */
export const CHAIN_WORDS: Readonly<Record<string, string>> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", sol: "Solana", near: "NEAR", bsc: "BNB Chain", pol: "Polygon", avax: "Avalanche",
  gnosis: "Gnosis", hood: "Robinhood", scroll: "Scroll", starknet: "Starknet", xlayer: "X Layer", bera: "Berachain", btc: "Bitcoin", zec: "Zcash",
  doge: "Dogecoin", xrp: "XRP Ledger", tron: "TRON", ton: "TON", sui: "Sui", aptos: "Aptos", stellar: "Stellar", cardano: "Cardano", ltc: "Litecoin",
  bch: "Bitcoin Cash", dash: "Dash", monad: "Monad", abs: "Abstract", plasma: "Plasma", hypercore: "Hyperliquid", movement: "Movement", aleo: "Aleo",
};
export const chainWords = (b: string): string => CHAIN_WORDS[b] ?? b.toUpperCase();

/** A coin's market row, read strictly: GeckoTerminal's (tokens/multi) or, where it has none, CoinGecko's (coins/markets). */
export interface MarketRow { id: string; name: string; symbol?: string; image?: string; price?: number; change24h?: number; volume24h?: number; marketCap?: number; fdv?: number }
const num = (v: unknown): number | undefined => { const x = typeof v === "string" && v.trim() ? Number(v) : v; return typeof x === "number" && Number.isFinite(x) ? x : undefined; };
const httpsImage = (v: unknown): string | undefined => (typeof v === "string" && v.startsWith("https://") && v.length <= 600 ? v : undefined);
export function readMarkets(raw: unknown): Map<string, MarketRow> {
  const out = new Map<string, MarketRow>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
    const image = httpsImage(r.image);
    out.set(r.id, {
      id: r.id, name: typeof r.name === "string" ? r.name.slice(0, 40) : r.id, ...(typeof r.symbol === "string" ? { symbol: r.symbol.slice(0, 16) } : {}),
      ...(image ? { image } : {}),
      ...opt("price", num(r.current_price)), ...opt("change24h", num(r.price_change_percentage_24h)), ...opt("volume24h", num(r.total_volume)),
      ...opt("marketCap", num(r.market_cap)), ...opt("fdv", num(r.fully_diluted_valuation)),
    });
  }
  return out;
}
function opt<K extends string>(k: K, v: number | undefined): Partial<Record<K, number>> { return v === undefined ? {} : ({ [k]: v } as Record<K, number>); }

/** One GeckoTerminal token, the same key on the way out (a batch) and back (its answer): Solana's case kept, others lower-cased. */
export const gtKey = (s: GtSpot): string => `${s.network}:${s.network === "solana" ? s.address : s.address.toLowerCase()}`;
/** GeckoTerminal's multi-token call takes at most this many addresses. */
export const GT_MULTI_MAX = 30;
/** An address GeckoTerminal's path takes as it is (no separator, no escape): anything else is never asked. */
const GT_ADDR = /^[A-Za-z0-9_.:-]{2,100}$/;
/**
 * The list's GeckoTerminal calls (v2 paths): one per network per 30 coins, each `networks/{n}/tokens/multi/{a,b,…}` with its
 * top pool (the coin's 24 h move is that pool's when the coin is its base). A coin on two chains with one twin (ETH on
 * eleven: WETH on Ethereum) is asked once. Cash (never ranked; 1Click's price says it) costs no call of its own: it rides
 * only in a network's batches that have room, for its logo and its day's volume.
 */
export function gtMultiPaths(coins: readonly NativeCoin[]): { network: string; path: string }[] {
  const by = new Map<string, { shown: Map<string, string>; cash: Map<string, string> }>();
  for (const c of coins) {
    if (!c.gt || !GT_ADDR.test(c.gt.address)) continue;
    const m = by.get(c.gt.network) ?? { shown: new Map<string, string>(), cash: new Map<string, string>() };
    (hidden(c) ? m.cash : m.shown).set(gtKey(c.gt), c.gt.address);
    by.set(c.gt.network, m);
  }
  const out: { network: string; path: string }[] = [];
  for (const [network, { shown, cash }] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    if (!shown.size) continue;
    const room = Math.ceil(shown.size / GT_MULTI_MAX) * GT_MULTI_MAX - shown.size;
    const addrs = [...shown.values()].sort().concat([...cash].filter(([k]) => !shown.has(k)).map(([, a]) => a).sort().slice(0, room));
    for (let i = 0; i < addrs.length; i += GT_MULTI_MAX) out.push({ network, path: `networks/${network}/tokens/multi/${addrs.slice(i, i + GT_MULTI_MAX).join(",")}?include=top_pools` });
  }
  return out;
}
/** A multi-token answer, read strictly, keyed by gtKey: name, symbol, image, price, FDV, market cap, the day's volume and move. */
export function readGtTokens(raw: unknown, network: string, into = new Map<string, MarketRow>()): Map<string, MarketRow> {
  const data: unknown[] = Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: unknown[] }).data : [];
  const inc: any[] = Array.isArray((raw as { included?: unknown })?.included) ? (raw as { included: any[] }).included : [];
  const pools = new Map<string, any>(inc.filter((p) => p?.type === "pool" && typeof p?.id === "string").map((p) => [p.id, p]));
  for (const t of data as any[]) {
    const a = t?.attributes;
    if (t?.type !== "token" || typeof t?.id !== "string" || typeof a?.address !== "string" || !GT_ADDR.test(a.address)) continue;
    const key = gtKey({ network, address: a.address });
    const pool = pools.get(String(t.relationships?.top_pools?.data?.[0]?.id ?? ""));
    // the pool's move is its base token's: a coin that is its top pool's quote has no move here (CoinGecko's, if any)
    const change = pool && String(pool.relationships?.base_token?.data?.id ?? "") === t.id ? num(pool.attributes?.price_change_percentage?.h24) : undefined;
    const image = httpsImage(a.image_url);
    const nn = (v: unknown) => { const x = num(v); return x !== undefined && x >= 0 ? x : undefined; };
    into.set(key, {
      id: key, name: typeof a.name === "string" && a.name ? a.name.slice(0, 40) : String(a.symbol ?? "").slice(0, 16),
      ...(typeof a.symbol === "string" ? { symbol: a.symbol.slice(0, 16) } : {}), ...(image ? { image } : {}),
      ...opt("price", nn(a.price_usd)), ...opt("change24h", change), ...opt("volume24h", nn(a.volume_usd?.h24)),
      ...opt("marketCap", nn(a.market_cap_usd)), ...opt("fdv", nn(a.fdv_usd)),
    });
  }
  return into;
}
/** CoinGecko's ids still to ask (one call, at most 250): coins GeckoTerminal has no token, price or day's move for. */
export function cgFallbackIds(coins: readonly NativeCoin[], gt: ReadonlyMap<string, MarketRow>): string[] {
  const need = coins.filter((c) => {
    if (!c.cgId || hidden(c)) return false;
    const m = c.gt ? gt.get(gtKey(c.gt)) : undefined;
    return m?.price === undefined || m.change24h === undefined;
  });
  return [...new Set(need.map((c) => c.cgId!))].slice(0, 250);
}

/** A shown row: the coin and its market. */
export interface NativeRow extends NativeCoin { name: string; logo?: string; spark?: number[]; price?: number; change24h?: number; volume24h?: number; marketCap?: number; fdv?: number; high24h?: number; low24h?: number }

/** Least 24 h volume for the ranked list: a coin that barely trades has no "best performance" worth showing. */
export const MIN_VOLUME_USD = 100_000;

/**
 * The Native coins list: each coin with its market, best 24 h first; cash, thinly traded or unpriced coins after, by
 * volume. Each figure is GeckoTerminal's (`gt`, by the coin's token) and, only where it has none, CoinGecko's (`markets`).
 */
export function rankNative(coins: readonly NativeCoin[], markets: ReadonlyMap<string, MarketRow>, gt: ReadonlyMap<string, MarketRow> = new Map()): NativeRow[] {
  const rows = coins.map((c): NativeRow => {
    const g = c.gt ? gt.get(gtKey(c.gt)) : undefined;
    const m = c.cgId ? markets.get(c.cgId) : undefined;
    // its market's name only when it is that coin (WETH is ETH's twin on GeckoTerminal: the row keeps its own symbol)
    const same = (x?: MarketRow) => !!x?.name && (!x.symbol || x.symbol.toUpperCase() === c.symbol.replace(/^\$/, "").toUpperCase());
    const name = SHOWN_AS[c.assetId]?.name ?? (same(g) ? g!.name : same(m) ? m!.name : c.symbol);
    const logo = g?.image ?? m?.image;
    // the day's move and the price are one source's pair (a move from one, a price from the other, would disagree)
    const pair = g?.price !== undefined && g.change24h !== undefined ? g : m?.change24h !== undefined ? m : g ?? m;
    return {
      ...c, name, ...(logo ? { logo } : {}),
      ...opt("price", pair?.price ?? g?.price ?? m?.price ?? c.price1c), ...opt("change24h", pair?.change24h),
      ...opt("volume24h", g?.volume24h ?? m?.volume24h), ...opt("marketCap", g?.marketCap ?? m?.marketCap), ...opt("fdv", g?.fdv ?? m?.fdv),
    };
  });
  // one row per coin among the best (ETH on eleven chains is one entry there); its other chains follow, still searchable
  const firsts = new Set<string>();
  const best = new Set(rows.filter((r) => r.change24h !== undefined && (r.volume24h ?? 0) >= MIN_VOLUME_USD && !hidden(r))
    .sort((a, b) => b.change24h! - a.change24h!).filter((r) => { const k = r.cgId ?? (r.gt ? gtKey(r.gt) : r.assetId); if (firsts.has(k)) return false; firsts.add(k); return true; }));
  const ranked = (r: NativeRow) => best.has(r);
  return rows.sort((a, b) => {
    const ra = ranked(a), rb = ranked(b);
    if (ra !== rb) return ra ? -1 : 1;
    if (ra) return b.change24h! - a.change24h!;
    return (b.volume24h ?? 0) - (a.volume24h ?? 0);
  });
}

/** The order a coin's row is picked from when NEAR Intents lists it on more than one rail: NEAR first (the Safe's own
 *  chain), then the app's wallets' chains (core app-chains.ts), then any other, in the list's own (ranked) order. */
const PICK_ORDER: readonly string[] = ["near", ...APP_CHAINS.filter((c) => c !== "near")];
const pickRank = (chain: string): number => { const i = PICK_ORDER.indexOf(chain); return i < 0 ? PICK_ORDER.length : i; };
/** The Safe's cash, by the name people know it: it pays a Buy and takes a Sell, so it is no row to buy. */
const CASH_SYMBOL = "USDC";
/**
 * Audit 17's H1 (the review's ruling, 8 Nov: the owner's SOL, NEAR and Robinhood rule is about the wallets a person
 * holds and trades from; the Safe holds any NEAR Intents coin). The list Trade's NEAR Intents tab shows: every coin the
 * Safe can hold, ONE row per coin (ETH once, never "ETH · Base", "ETH · Arbitrum"): the row is the asset, not the rail
 * it came by, so no chain word; never the Safe's cash. Ranked order is kept; a coin on several rails keeps its NEAR row,
 * else its row on one of the app's chains, else its best-ranked one.
 */
export function appCoins<T extends { symbol: string; blockchain: string }>(rows: readonly T[]): T[] {
  const pick = new Map<string, T>();
  for (const r of rows) {
    const k = r.symbol.toUpperCase();
    if (k === CASH_SYMBOL) continue;
    const had = pick.get(k);
    if (!had || pickRank(r.blockchain) < pickRank(had.blockchain)) pick.set(k, r);
  }
  const keep = new Set(pick.values());
  return rows.filter((r) => keep.has(r));
}

/** Search the list: symbol, name, chain or asset id, case-blind; the empty query is the whole list. */
export function searchNative(rows: readonly NativeRow[], q: string): NativeRow[] {
  const w = q.trim().toLowerCase();
  if (!w) return [...rows];
  const hit = (r: NativeRow) => r.symbol.toLowerCase().includes(w) || r.name.toLowerCase().includes(w) || chainWords(r.blockchain).toLowerCase().includes(w) || r.assetId.toLowerCase() === w;
  const exact = (r: NativeRow) => (r.symbol.toLowerCase() === w ? 0 : 1);
  return rows.filter(hit).sort((a, b) => exact(a) - exact(b));
}
/** Symbols listed on more than one chain: their rows say which chain. */
export function sharedSymbols(rows: readonly { symbol: string }[]): Set<string> {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.symbol.toUpperCase(), (n.get(r.symbol.toUpperCase()) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c > 1).map(([s]) => s));
}

/** A CoinGecko image as the relay's logo route takes it (GET /v0/market/logo?cg=<n>/<size>/<file>): the path only. */
export function cgLogoPath(image: string | undefined): string | undefined {
  const m = image ? /^https:\/\/coin-images\.coingecko\.com\/coins\/images\/(\d{1,8}\/(?:thumb|small|large)\/[A-Za-z0-9_.%-]{1,96}\.(?:png|jpe?g|webp|gif))(?:\?.*)?$/.exec(image) : null;
  return m && !m[1]!.includes("..") ? m[1] : undefined;
}
/** The relay's chains for a logo by address (GET /v0/market/logo?c=<chain>&a=<address>, apps/quotes logo.mjs logoRequestOk). */
export const LOGO_CHAIN_OF: Readonly<Record<string, string>> = { solana: "sol", bsc: "bsc", robinhood: "hood", near: "near" };
/**
 * The logo an <img> may load: the relay's copy (the page loads images only from the relay). GeckoTerminal's image is
 * CoinGecko's for a listed coin (by its path); its own (assets.geckoterminal.com) the relay finds by the coin's address on
 * Solana, BNB Chain, Robinhood and NEAR, GeckoTerminal's image among its sources. Anything else: none, the letter mark.
 */
export const logoVia = (relay: string | undefined, image: string | undefined, small = true, spot?: GtSpot): string | undefined => {
  if (!relay || !image) return undefined;
  const p = cgLogoPath(image);
  if (p) return `${relay}/v0/market/logo?cg=${encodeURIComponent(small ? p.replace("/large/", "/small/") : p)}`;
  const chain = spot ? LOGO_CHAIN_OF[spot.network] : undefined;
  return chain && /^https:\/\/assets\.geckoterminal\.com\//.test(image) ? `${relay}/v0/market/logo?c=${chain}&a=${encodeURIComponent(spot!.address)}` : undefined;
};
