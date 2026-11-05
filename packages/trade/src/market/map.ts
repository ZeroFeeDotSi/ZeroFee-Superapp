// GeckoTerminal pool -> the coin's row (the BASE token of the pool, unless the pool is listed the other way round).
import type { ChainId } from "../types.ts";
import { CHAIN_OF_NETWORK, type GtList, type GtPool, type GtToken } from "./gt.ts";
import type { CoinRow, MoveWindow } from "./types.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** GeckoTerminal names a chain's native coin 0xEeee…EEeE on some EVM AMMs: it is the native coin, i.e. the zero address. */
export const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const WSOL = "So11111111111111111111111111111111111111112";

/** Tokens that are money, not coins: a pool "X / USDC" is X's pool. */
export type QuoteKind = "native" | "stable";
const QUOTES: Record<ChainId, Record<string, QuoteKind>> = {
  sol: {
    [WSOL]: "native",
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "stable", // USDC
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "stable", // USDT
  },
  bsc: {
    [ZERO_ADDRESS]: "native",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "native", // WBNB
    "0x55d398326f99059ff775485246999027b3197955": "stable", // USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "stable", // USDC
    "0xe9e7cea3dedca5984780bafc599bd69add087d56": "stable", // BUSD
    "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": "stable", // FDUSD
    "0xce24439f2d9c6a2289f741120fe202248b666666": "stable", // U
  },
  hood: {
    [ZERO_ADDRESS]: "native",
    "0x0bd7d308f8e1639fab988df18a8011f41eacad73": "native", // WETH
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "stable", // USDG
  },
  // NEAR (2 Nov 2026, GeckoTerminal's near pools): wNEAR is NEAR itself; the dollars are Circle's and Tether's own and
  // their NEAR Intents and Rainbow bridge copies (each listed by GeckoTerminal as USDC or USDT on near)
  near: {
    "wrap.near": "native",
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "stable",   // USDC
    "usdt.tether-token.near": "stable",                                              // USDT
    "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": "stable",            // USDC (Ethereum, Intents)
    "eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": "stable",            // USDT (Ethereum, Intents)
    "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": "stable",           // USDC (Base, Intents)
    "arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near": "stable",            // USDC (Arbitrum, Intents)
    "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": "stable",              // USDC (Solana, Intents)
    "sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": "stable",              // USDT (Solana, Intents)
    "tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near": "stable",             // USDT (Tron, Intents)
    "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near": "stable",        // USDC.e
    "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near": "stable",        // USDT.e
  },
};
export const isEvm = (c: ChainId): boolean => c === "bsc" || c === "hood";
/** A NEAR account id (nep141 contracts are accounts): 2 to 64 of a-z, 0-9 and - _ . with no separator first, last or twice
 *  ("qtc.omft.near", "token.v2.ref-finance.near", a 64-hex implicit account). */
export const NEAR_ACCOUNT = /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;
export const validTokenAddress = (chain: ChainId, a: string): boolean =>
  chain === "near" ? NEAR_ACCOUNT.test(a) : isEvm(chain) ? /^0x[0-9a-fA-F]{40}$/.test(a) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
/** EVM addresses compare lower-cased, NEAR accounts are lower-case by rule; Solana addresses are case-sensitive. */
export const normAddr = (chain: ChainId, a: string): string => (chain === "sol" ? a : a.toLowerCase());
export const quoteKindOf = (chain: ChainId, address: string): QuoteKind | undefined => QUOTES[chain][normAddr(chain, address)];
/** Dollars the lists treat as money and nothing else does (S13, 5 Nov: Rhea's pages are full of DAI and FRAX
 *  pairs): a pool of two is no coin's row, a coin paired with one is the coin's. Never a trade's quote ($1 is not assumed). */
const LIST_MONEY: Partial<Record<ChainId, ReadonlySet<string>>> = {
  near: new Set([
    "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near",   // DAI (Rainbow bridge)
    "eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near",       // DAI (Ethereum, Intents)
    "853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near",   // FRAX (Rainbow bridge)
    "eth-0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d.omft.near",       // USD1 (Ethereum, Intents)
  ]),
};
const isListMoney = (chain: ChainId, a: string): boolean => quoteKindOf(chain, a) !== undefined || !!LIST_MONEY[chain]?.has(normAddr(chain, a));
const isNativeAddr = (a: string): boolean => { const x = a.toLowerCase(); return x === ZERO_ADDRESS || x === NATIVE_SENTINEL; };

export const num = (s: unknown): number | undefined => {
  if (s === null || s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const tokenAddr = (id: string): string => { const a = id.slice(id.indexOf("_") + 1); return a.toLowerCase() === NATIVE_SENTINEL ? ZERO_ADDRESS : a; };

/** A provider-supplied name or symbol made fit to show and compare: every format character (right-to-left override, isolates, soft hyphen, zero-width, BOM)
 *  and control character out, whitespace collapsed, at most 32 characters (counted as characters, not UTF-16 halves). */
export const LABEL_MAX = 32;
export function cleanLabel(x: string | null | undefined): string {
  if (typeof x !== "string") return "";
  const t = x.replace(/[\p{Cf}\p{Cc}]+/gu, "").replace(/\s+/g, " ").trim();
  // sd-security (h): a label with no letter, digit or emoji at all ("██████") says nothing a person can read: none
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(t)) return "";
  const chars = Array.from(t);
  return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join("").trim() : t;
}
/** QA (3 Nov): a coin's name on screen is never a contract id. GeckoTerminal names NEAR Intents' bridged coins by their
 *  NEAR contract ("eth.omft.near", "tron-d28a….omft.near"), and an unnamed coin can come back as its address. A bridged
 *  coin named by its own contract reads as the coin it carries ("Ether"); any other id-like name reads as its symbol,
 *  never a well-known name (a coin elsewhere calling itself "eth.omft.near" must not show as "Ether"). */
const ID_LIKE = /\.(near|testnet)$|\.omft\b|^nep\d+:|^0x[0-9a-f]{40}$|^[0-9a-f]{40,}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/i;
const KNOWN_NAMES: Record<string, string> = {
  ETH: "Ether", BTC: "Bitcoin", SOL: "Solana", XRP: "XRP", TRX: "TRON", USDC: "USD Coin", USDT: "Tether", DOGE: "Dogecoin",
  ZEC: "Zcash", LTC: "Litecoin", BCH: "Bitcoin Cash", BNB: "BNB", NEAR: "NEAR", WNEAR: "NEAR", POL: "Polygon", AVAX: "Avalanche",
  ARB: "Arbitrum", OP: "Optimism", SUI: "Sui", TON: "Toncoin", ADA: "Cardano", APT: "Aptos", XLM: "Stellar", WBTC: "Wrapped Bitcoin",
};
export const isIdLike = (name: string): boolean => ID_LIKE.test(name.trim());
export function coinName(name: string, symbol: string, address: string, chain: string): string {
  if (name && !isIdLike(name)) return name;
  const bridged = chain === "near" && /\.omft\.near$/i.test(address) && name.toLowerCase() === address.toLowerCase();
  return (bridged ? KNOWN_NAMES[symbol.toUpperCase()] : undefined) ?? symbol;
}
/** A logo url we will hand to an <img>: https only (not GeckoTerminal's "missing" placeholder), or an image bundled as
 *  data (the web demo's own sample coins: no host at all). */
export const logoOf = (u?: string | null): string | undefined => (typeof u === "string" && ((/^https:\/\//i.test(u) && !/missing/i.test(u)) || /^data:image\/[a-z+]+[,;]/.test(u)) ? u : undefined);

export interface PoolView {
  chain: ChainId; pool: string; dex: string;
  coin: { address: string; symbol: string; name: string; logo?: string; decimals?: number; priceUsd: number; listed: boolean };
  /** The quote side: its decimals and its last market price when the list says them (an on-chain spot price is quote per coin). */
  quote: { address: string; symbol: string; kind?: QuoteKind; decimals?: number; priceUsd?: number };
  liquidityUsd: number; createdAt?: string;
  change24h?: number; marketCapUsd?: number; fdvUsd?: number; volume24hUsd?: number;
  /** The pool's price change over each window GeckoTerminal reports (the Trade tab's movers). */
  changes?: Partial<Record<MoveWindow, number>>;
  /** The last 24 hours in this pool. */
  crowd?: { buys: number; sells: number; buyers: number; sellers: number };
}

type Tokens = Map<string, GtToken["attributes"]>;
export const tokensOf = (included: GtList["included"]): Tokens => {
  const m: Tokens = new Map();
  for (const i of included ?? []) if (i.type === "token") m.set((i as GtToken).id, (i as GtToken).attributes);
  return m;
};

/** Every pool of a list as a PoolView. "by-id" = the cross-network list (the chain is the prefix of each pool id). A pool we cannot read is skipped, never guessed. */
export function poolViews(chain: ChainId | "by-id", list: GtList): PoolView[] {
  const tokens = tokensOf(list.included);
  const out: PoolView[] = [];
  for (const p of list.data ?? []) {
    const c = chain === "by-id" ? CHAIN_OF_NETWORK[p.id.slice(0, p.id.indexOf("_"))] : chain;
    if (!c) continue;
    const v = poolView(c, p, tokens);
    if (v) out.push(v);
  }
  return out;
}

export function poolView(chain: ChainId, p: GtPool, tokens: Tokens): PoolView | undefined {
  const a = p.attributes, rel = p.relationships;
  if (!a || !rel?.base_token?.data || !rel.quote_token?.data) return undefined;
  const baseId = rel.base_token.data.id, quoteId = rel.quote_token.data.id;
  const bAddr = tokenAddr(baseId), qAddr = tokenAddr(quoteId);
  // A coin's address is ALWAYS the token contract (an ERC-20 / a Solana mint): never a pool address, never a 32-byte v4 pool id.
  if (!validTokenAddress(chain, bAddr) || !validTokenAddress(chain, qAddr)) return undefined;
  const bKind = quoteKindOf(chain, bAddr), qKind = quoteKindOf(chain, qAddr);
  const flip = isListMoney(chain, bAddr) && !isListMoney(chain, qAddr); // "WSOL / SomeCoin": the coin is the quote side
  const [cId, cAddr, kId, kAddr] = flip ? [quoteId, qAddr, baseId, bAddr] : [baseId, bAddr, quoteId, qAddr];
  if (cAddr.toLowerCase() === a.address?.toLowerCase()) return undefined; // the coin is never its own pool
  const ct = tokens.get(cId), kt = tokens.get(kId);
  const coinPrice = num(flip ? a.quote_token_price_usd : a.base_token_price_usd);
  if (!(coinPrice !== undefined && coinPrice > 0)) return undefined;
  const nameParts = (a.name ?? "").split(" / ");
  const clean = (x?: string) => cleanLabel(x?.replace(/\s+\d+(\.\d+)?%$/, ""));
  const symFallback = clean(flip ? nameParts[1] : nameParts[0]);
  const quoteSymFallback = clean(flip ? nameParts[0] : nameParts[1]);
  // a coin with no readable symbol anywhere is no row (sd-security (h): it showed as "██████")
  if (!(cleanLabel(ct?.symbol) || symFallback)) return undefined;
  const mc = num(a.market_cap_usd);
  const h24 = a.transactions?.h24;
  const crowd = h24 && num(h24.buyers) !== undefined && num(h24.sellers) !== undefined
    ? { buys: num(h24.buys) ?? 0, sells: num(h24.sells) ?? 0, buyers: num(h24.buyers)!, sellers: num(h24.sellers)! } : undefined;
  return {
    chain, pool: a.address, dex: rel.dex?.data?.id ?? "unknown",
    coin: { address: cAddr, symbol: cleanLabel(ct?.symbol) || symFallback, name: coinName(cleanLabel(ct?.name) || cleanLabel(ct?.symbol) || symFallback, cleanLabel(ct?.symbol) || symFallback, cAddr, chain), logo: logoOf(ct?.image_url), decimals: ct?.decimals, priceUsd: coinPrice, listed: !!ct?.coingecko_coin_id },
    quote: { address: kAddr, symbol: cleanLabel(kt?.symbol) || quoteSymFallback, kind: flip ? bKind : qKind, ...(Number.isInteger(kt?.decimals) ? { decimals: kt!.decimals } : {}), ...((qp) => (qp && qp > 0 ? { priceUsd: qp } : {}))(num(flip ? a.base_token_price_usd : a.quote_token_price_usd)) },
    liquidityUsd: num(a.reserve_in_usd) ?? 0,
    createdAt: a.pool_created_at ?? undefined,
    change24h: num(a.price_change_percentage?.h24),
    changes: Object.fromEntries((["m5", "h1", "h6", "h24"] as const).map((k) => [k, num(a.price_change_percentage?.[k])] as const).filter(([, v]) => v !== undefined)),
    marketCapUsd: mc && mc > 0 ? mc : undefined, fdvUsd: num(a.fdv_usd), volume24hUsd: num(a.volume_usd?.h24),
    ...(crowd ? { crowd } : {}),
  };
}

/** A pool whose coin side is the chain's own native coin or a stable (SOL / USDC, WBNB / USDT) is not "a coin to buy". */
export const isMoneyPool = (v: PoolView): boolean => isListMoney(v.chain, v.coin.address) || (isEvm(v.chain) && isNativeAddr(v.coin.address));

export function rowOf(v: PoolView): CoinRow {
  return {
    chain: v.chain, address: v.coin.address, symbol: v.coin.symbol, name: v.coin.name,
    ...(v.coin.logo ? { logoUrl: v.coin.logo } : {}),
    priceUsd: v.coin.priceUsd,
    ...(v.change24h !== undefined ? { change24hPct: v.change24h } : {}),
    ...(v.changes && Object.keys(v.changes).length ? { changePct: v.changes } : {}),
    liquidityUsd: v.liquidityUsd,
    ...(v.volume24hUsd !== undefined ? { volume24hUsd: v.volume24hUsd } : {}),
    ...((v.marketCapUsd ?? v.fdvUsd) !== undefined ? { marketCapUsd: v.marketCapUsd ?? v.fdvUsd } : {}),
  };
}

/** A ticker as people type it: no leading "$" (dogwifhat lists as "$WIF"), upper case. */
export const tickerOf = (s: string): string => s.trim().replace(/^\$+/, "").toUpperCase();
/** A copy has under this share of the real coin's market money. */
export const COPYCAT_SHARE = 0.1;
/**
 * A search's rows, best first (AgentZero's suite, 3 Nov: "WIF" gave two Robinhood Chain copies and no dogwifhat): the coins
 * whose ticker is what was typed (a "$" aside) first, then the rest; each group by the money in its market (liquidity, then
 * the day's volume), never one chain then another. A coin with the same ticker as a far deeper one is marked as its copy.
 */
export function rankSearch(rows: readonly CoinRow[], q: string): CoinRow[] {
  const want = tickerOf(q);
  const depth = (r: CoinRow) => (r.liquidityUsd ?? 0) * 1_000 + Math.min(r.volume24hUsd ?? 0, (r.liquidityUsd ?? 0) * 50);
  const exact = (r: CoinRow) => tickerOf(r.symbol) === want;
  const sorted = [...rows].sort((a, b) => Number(exact(b)) - Number(exact(a)) || depth(b) - depth(a));
  const real = new Map<string, CoinRow>();
  for (const r of sorted) { const t = tickerOf(r.symbol); if (!real.has(t)) real.set(t, r); }
  return sorted.map((r) => {
    const top = real.get(tickerOf(r.symbol))!;
    return top !== r && (r.liquidityUsd ?? 0) < (top.liquidityUsd ?? 0) * COPYCAT_SHARE ? { ...r, copycatOf: { chain: top.chain, address: top.address } } : r;
  });
}

/** Fair interleave: one from each list in turn, each list in its own order, a coin only once. */
export function interleave(lists: CoinRow[][]): CoinRow[] {
  const out: CoinRow[] = [], seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const c = l[i];
      if (!c) continue;
      const k = `${c.chain}:${normAddr(c.chain, c.address)}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(c);
    }
  }
  return out;
}
