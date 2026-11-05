// THE SPAM FILTER'S BRAIN (product decision, 21 Oct).
//
// A PURE function from market facts to "show or hide, and why". No network, no clock, no storage, no imports but types: the same module runs in the app, in the unit tests and in the
// calibration run (qa/spam-calibration.mjs) against recorded provider answers.
//
// WHAT IS ALWAYS SHOWN (before any data is read)
//   - the chain's native coin (it is never a token row at all),
//   - a major coin on its REAL contract (the canonical stablecoins and wrapped majors below),
//   - a coin this wallet BOUGHT (the trade ledger's cost basis says so; WalletState.tokens does NOT: a scan writes airdrops there too),
//   - a coin the person chose to show (a local override; undoable).
// WHAT IS HIDDEN (each with ONE plain reason), in this order:
//   copycat     a famous symbol (USDT, USDC, SOL, ETH, BNB, WBTC ...) on a contract that is not the real one; a URL in the name or symbol; a "claim / reward / visit / airdrop" name that has
//               no listing, no verification and no real crowd behind it. Needs only the name, so it is decided before any market call.
//   no-market   the provider has never heard of the coin, or none of its pools holds about $1,000 (nothing to sell into).
//   cant-sell   the provider flags a honeypot, or (Solana) the creator can still freeze token accounts.
//   one-entity  the top 10 holders own about 70 % or more of the supply AFTER leaving out the holders the provider labels as a pool, a burn address, an exchange / cold wallet, a vault, a
//               locker or a proxy (a pool or an exchange is not "one person owning it"). Labels matter: Binance's cold wallets hold 93 % of TST, and TST is a real coin.
//   inorganic   in 24 hours the trades come from about 3 distinct wallets or fewer; only one wallet ever sells while many buy; or fewer than about 50 holders.
// A coin the provider LISTS (a CoinGecko id) is vetted by them, not by the token's creator: it skips the crowd rules (never the honeypot / freeze / copycat rules).
// gt_score is NOT used: the test three BNB airdrops scored 49.7, the real TST 74 and our own ZeroFee coin 42.
//
// FAIL CLOSED / OPEN: a coin whose facts cannot be read yet is "checking" (it sits under Hidden, never as a visible coin); a coin that was bought or chosen is shown whatever the facts say.
// An incomplete answer is never a negative: "failed" sources make a verdict wait, they never make one.
import type { ChainId } from "../types.ts";

type ChainKey = ChainId;
type FactState = "ok" | "none" | "failed";
/** What the filter reads about one coin. Everything is optional: a missing field is unknown, never zero.
 *  Without a key GeckoTerminal gives no top-holder list, so `top` stays empty and the one-entity rule cannot run (see classify). */
export interface CoinFacts {
  chain: ChainKey; address: string;
  state: { quote: FactState; info: FactState; pools: FactState; holders: FactState };
  name?: string; symbol?: string;
  /** The deepest pool's reserve, or the sum over pools, USD. */
  liquidityUsd?: number;
  /** The provider lists the coin (a CoinGecko id): vetted by them, not by the token's creator. */
  listed?: boolean; verified?: boolean; gtScore?: number;
  honeypot?: boolean;
  /** Solana: the creator can still freeze token accounts. */
  freezeAuthority?: boolean; mintAuthority?: boolean;
  holders?: number;
  /** The provider's top-10 share of supply in percent, pools and exchanges included. */
  top10Pct?: number;
  /** Per pool, the last 24 hours. */
  pools?: { address?: string; reserveUsd: number; buys: number; sells: number; buyers: number; sellers: number; volumeUsd?: number; createdAt?: string }[];
  top?: { address: string; pct: number; label: string | null }[];
}
type CoinRef = { chain: ChainKey; address: string };

// ---------------------------------------------------------------------------------------------------------------------------------- thresholds (tuned on the calibration set, see status/review.md)
export const T = {
  /** a market needs a pool holding at least this much (USD) */
  minLiquidityUsd: 1_000,
  /** the top 10 non-labelled holders' share of supply (percent) at or above which the coin is "one entity" */
  oneEntityPct: 70,
  /** fewer holders than this is not a crowd */
  minHolders: 50,
  /** distinct wallets that traded in 24 h at or below this is not a market (counted as buyers + sellers, summed over pools: an upper bound) ... */
  maxWallets24h: 3,
  /** ... unless the coin has this many holders: a quiet day is not a wash (a coin nobody traded today but a thousand people hold is a coin, not a pump) */
  quietOkHolders: 1_000,
  /** many buys and only ONE wallet that ever sells */
  lopsidedMinBuyers: 20,
  lopsidedMinSells: 20,
  /** a coin this crowd trades every day (this many distinct buyers AND sellers) is a market, not one entity's pump, whatever the top holders own */
  realCrowdWallets: 25,
  /** holders handed out rather than earned: many times more holders than wallets that traded in 24 h, on a young pool, with no listing (the test BNB airdrops: 1,000 to 38,000 holders per trader, pools 0 to 7 days old) */
  airdropHoldersPerTrader: 100,
  airdropMaxPoolAgeDays: 30,
  /** a suspicious name needs this much real crowd to pass */
  nameNeedsHolders: 1_000,
  nameNeedsLiquidityUsd: 50_000,
  nameNeedsWallets24h: 30,
} as const;
export type Thresholds = { -readonly [K in keyof typeof T]: number };

// ---------------------------------------------------------------------------------------------------------------------------------- the real coins
/** Canonical contracts: lower-case on EVM, exact on Solana. Every address was checked on 21 Oct 2026 (BNB Chain: eth_call symbol() on rpc-bsc.48.club; Solana and Robinhood: the provider lists it with a CoinGecko id). */
export const CANON: Partial<Record<ChainKey, Record<string, readonly string[]>>> = {
  bsc: {
    usdt: ["0x55d398326f99059ff775485246999027b3197955"], usdc: ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"], fdusd: ["0xc5f0f7b66764f6ec8c8dff7ba683102295e16409"],
    usd1: ["0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d"], dai: ["0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3"], busd: ["0xe9e7cea3dedca5984780bafc599bd69add087d56"],
    wbnb: ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"], bnb: ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"], eth: ["0x2170ed0880ac9a755fd29b2688956bd959f933f8"], weth: ["0x2170ed0880ac9a755fd29b2688956bd959f933f8"],
    btcb: ["0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c"], btc: ["0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c"], cake: ["0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"], sol: ["0x570a5d26f7765ecb712c0924e4de545b89fd43df"],
    xrp: ["0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe"], doge: ["0xba2ae424d960c26247dd6c32edc70b295c744c43"], ada: ["0x3ee2200efb3400fabb9aacf31297cbdd1d435d47"], dot: ["0x7083609fce4d1d8dc0c979aab8c869ea2c873402"],
    ltc: ["0x4338665cbb7b2485a8855a139b75d5e34ab0db94"], link: ["0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd"], avax: ["0x1ce0c2827e2ef14d5c4f29a091d735a204794041"], uni: ["0xbf5140a22578168fd562dccf235e5d43a02ce9b1"],
    trx: ["0xce7de646e7208a4ef112cb6ed5038fa6cc6b12e3"],
    wbtc: [],   // no canonical WBTC on BNB Chain (BTCB is Binance's bitcoin): any token that calls itself WBTC here is a copy
  },
  sol: {
    usdt: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"], usdc: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], pyusd: ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
    usds: ["USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"], usd1: ["USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"],
    sol: ["So11111111111111111111111111111111111111112"], wsol: ["So11111111111111111111111111111111111111112"],
    jup: ["JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"], bonk: ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"], wif: ["EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
    eth: ["7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"], weth: ["7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"], wbtc: ["3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"],
    jto: ["jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"], pyth: ["HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"], ray: ["4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
    trump: ["6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"], pengu: ["2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"],
    // no real BTC / BNB / XRP / DOGE here: a token with those symbols on Solana is wrapped by somebody; the people who matter are listed above
    btc: [], bnb: [], xrp: [], doge: [],
  },
  hood: {
    weth: ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", "0x0000000000000000000000000000000000000000"], eth: ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", "0x0000000000000000000000000000000000000000"],
    usdg: ["0x5fc5360d0400a0fd4f2af552add042d716f1d168"],
  },
};
/** The stable / wrapped majors that are shown without a market read when they sit on their real contract. */
const MAJOR_KEEP: Partial<Record<ChainKey, readonly string[]>> = {
  bsc: ["usdt", "usdc", "fdusd", "usd1", "dai", "busd", "wbnb", "eth", "btcb", "cake", "sol", "xrp", "doge", "ada", "dot", "ltc", "link", "avax", "uni", "trx"],
  sol: ["usdt", "usdc", "pyusd", "usds", "usd1", "sol", "jup", "bonk", "wif", "eth", "wbtc", "jto", "pyth", "ray", "trump", "pengu"],
  hood: ["weth", "usdg"],
};

const isEvm = (c: ChainKey): boolean => c !== "sol";
export const canonId = (c: ChainRef): string => `${c.chain}:${isEvm(c.chain) ? c.address.toLowerCase() : c.address}`;
type ChainRef = Pick<CoinRef, "chain" | "address">;

/** The real contract of a major coin: shown at once, on any wallet, with no market read. */
export function isMajor(c: ChainRef): boolean {
  const reg = CANON[c.chain], keep = MAJOR_KEEP[c.chain];
  if (!reg || !keep) return false;
  const a = isEvm(c.chain) ? c.address.toLowerCase() : c.address;
  return keep.some((s) => (reg[s] ?? []).includes(a));
}

// ---------------------------------------------------------------------------------------------------------------------------------- names
/** Letters of other alphabets that are drawn like a Latin letter (Cyrillic, Greek, a few Latin extensions), upper and lower case: a copy of USDC written "USDС" (Cyrillic С) reads as USDC.
 *  Folded to the ASCII letter they imitate so the copy test sees what a person sees. Only the ones that really look alike; a Greek or Russian NAME is not touched by anything but this fold. */
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ѕ: "S", І: "I", Ј: "J", Ӏ: "I", Ԛ: "Q", Ԝ: "W", Ү: "Y", Ғ: "F", Ꭰ: "D",
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ј: "j", ӏ: "l", ԛ: "q", ԝ: "w", ԁ: "d", һ: "h", ԍ: "g", ɡ: "g", ү: "y",
  // Greek
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", γ: "y", η: "n", ϲ: "c", Ϲ: "C", ϳ: "j", ϵ: "e", ς: "c",
  // Latin extensions
  ı: "i", ɑ: "a", ɩ: "i", ᴄ: "c", ᴅ: "d", ᴇ: "e", ᴛ: "t", ᴜ: "u", ꜱ: "s", ᴀ: "a", ʙ: "b", ᴍ: "m", ᴏ: "o", ᴘ: "p", ᴋ: "k", ᴡ: "w", ʏ: "y", ɴ: "n", ʟ: "l", ᴢ: "z", Ɡ: "G", ǀ: "l", ᛁ: "I",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join("")}]`, "gu");
/** Text as a person reads it: compatibility-decomposed (full-width and math-bold letters become plain ones, an accented letter loses its accent), with every format character (\p{Cf}: right-to-left
 *  override U+202E, isolates U+2066.., soft hyphen U+00AD, invisible plus U+2064, Mongolian vowel separator U+180E, zero-width joiners, BOM), every combining mark (\p{M}: U+034F ...) and every control
 *  character taken out, and lookalike letters of other alphabets folded to Latin. Spaces are kept. */
export function fold(s: string | undefined): string {
  return (s ?? "").normalize("NFKD").replace(/[\p{Cf}\p{M}\p{Cc}]+/gu, "").replace(CONFUSABLE_RE, (c) => CONFUSABLE[c] ?? c);
}
/** A symbol or name reduced to what a person reads: fold() (NFKD, no invisible / format / mark characters, lookalikes folded to Latin), no spaces, no leading "$", lower case. */
export function plain(s: string | undefined): string {
  return fold(s).replace(/[\s\p{Z}]+/gu, "").replace(/^\$+/, "").toLowerCase();
}
/** A link written as a link: the name IS an address. No real coin is called "https". */
const LINK = /(https?:\/\/|\bhttps?\b|www\.|t\.me\/)/i;
/** A name that reads as a web address (DogeBonk.com, ARIA.AI): real coins do this too, so it is a flag (like the claim-bait words), not a verdict. */
const DOMAINISH = /\.(com|io|xyz|net|org|app|fi|finance|co|site|club|top|vip|live|online|link|click|gift|cc|me|ai)(\b|\/|$)/i;
/** A claim-bait word in the name or symbol: only a flag (real coins have "Reward" and "Visit" in their names too); it needs a real crowd to pass. */
const BAIT = /(claim|reward|visit|airdrop|giveaway|voucher|free\s?(nft|token|coin|bnb|sol|eth)|bonus|空投|领取|奖励)/i;
/** The famous symbols a copy pretends to be. */
export const FAMOUS: readonly string[] = [...new Set(Object.values(CANON).flatMap((r) => Object.keys(r!)))];

export interface Named { chain: ChainKey; address: string; symbol?: string; name?: string }
/** Why a name is a copy, or undefined. `symbol` and `name` are the chain's / provider's. */
export function copyReason(c: Named): { why: "famous" | "url"; detail: string } | undefined {
  const reg = CANON[c.chain];
  const a = isEvm(c.chain) ? c.address.toLowerCase() : c.address;
  for (const raw of [c.symbol, c.name]) {
    const p = plain(raw);
    if (!p) continue;
    if (reg && Object.prototype.hasOwnProperty.call(reg, p) && !reg[p]!.includes(a)) return { why: "famous", detail: `${raw} is not the real ${p.toUpperCase()}` };
  }
  // a famous symbol hidden inside a longer one ("USDT-TRC20", "TRC20-USDT", "SOL-USDT", "USDC.e"): the part before / after a separator
  if (reg) for (const raw of [c.symbol]) {
    const parts = fold(raw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.length > 1) for (const part of parts) if (["usdt", "usdc", "usd1", "usds", "dai", "busd", "fdusd", "pyusd", "wbtc", "btcb", "weth", "wsol"].includes(part) && Object.prototype.hasOwnProperty.call(reg, part) && !reg[part]!.includes(a)) return { why: "famous", detail: `${raw} looks like ${part.toUpperCase()}` };
  }
  for (const raw of [c.symbol, c.name]) if (raw && LINK.test(fold(raw))) return { why: "url", detail: `${raw} is a link` };
  return undefined;
}
/** A name that tells people not to buy it ("Hoot Test 4 (DO NOT SNIPE)", re-check, 5 Nov: on NEAR's Hot list): a
 *  launchpad's own test coin. Never shown in a list, whatever its market. */
const NO_BUY = /\bdo\s*n[o']?t\s*(snipe|buy|ape|trade)\b/i;
export const noBuyName = (c: Named): boolean => [c.symbol, c.name].some((s) => !!s && NO_BUY.test(fold(s)));
/** A claim-bait or web-address name (a flag, not a verdict: it needs a real crowd to pass). "Test" alone is no flag: TST
 *  on BNB Chain is called Test. */
export const baitName = (c: Named): boolean => [c.symbol, c.name].some((s) => !!s && (BAIT.test(fold(s)) || DOMAINISH.test(fold(s))));

// ---------------------------------------------------------------------------------------------------------------------------------- holders
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "0xdead000000000000000042069420694206942069", "1nc1nerator11111111111111111111111111111111", "11111111111111111111111111111111"]);
/** Labels that name a person's own wallet (the provider's social tags), not infrastructure: those still count as holders. */
const PERSONAL_LABEL = /(^\d+$|^wallet \d+$|\bon (x|twitter|fomo|pump\.fun|telegram|farcaster)\b)/i;
/** A holder that is not "one entity owning the coin": the provider labels it (a pool, an exchange, a cold wallet, a vault, a locker, a proxy ...), or it is a burn address, a pool the facts name, or the token itself. */
export function isInfrastructure(h: { address: string; label: string | null }, f: Pick<CoinFacts, "address" | "chain" | "pools">): boolean {
  const a = isEvm(f.chain) ? h.address.toLowerCase() : h.address;
  if (BURN.has(a) || (isEvm(f.chain) && a === f.address.toLowerCase())) return true;
  if ((f.pools ?? []).some((p) => p.address && (isEvm(f.chain) ? p.address.toLowerCase() === a : p.address === a))) return true;
  const label = (h.label ?? "").trim();
  return label !== "" && !PERSONAL_LABEL.test(label);
}
/** The share of supply (percent) the top 10 holders own once pools, burns, exchanges and the like are left out. undefined = no holder list. */
export function topShareWithoutInfrastructure(f: Pick<CoinFacts, "address" | "chain" | "pools" | "top">): number | undefined {
  if (!f.top || f.top.length === 0) return undefined;
  const rest = f.top.filter((h) => !isInfrastructure(h, f)).slice(0, 10);
  return rest.reduce((a, h) => a + (Number.isFinite(h.pct) ? h.pct : 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------- the verdict
export type Reason = "no-market" | "cant-sell" | "one-entity" | "few-holders" | "inorganic" | "copycat";
export type Verdict =
  | { show: true; why: "stable" | "bought" | "override" | "organic" }
  | { show: false; reason: Reason; detail: string }
  | { show: false; reason: "checking" };

/** The sentence under a hidden coin. No provider name, never "failed" / "error" / "stuck" / "try again". */
export function reasonText(v: Verdict): string {
  if (v.show) return "";
  switch (v.reason) {
    case "checking": return "Checking…";
    case "no-market": return "No market";
    case "cant-sell": return "Can't be sold";
    case "one-entity": return "One holder owns most of it";
    case "few-holders": case "inorganic": return "Few real holders";
    case "copycat": return "Copies a known coin";
  }
}

export interface Context {
  /** this wallet bought it (trade ledger / cost basis) */
  bought?: boolean;
  /** the person chose to show it */
  shown?: boolean;
  /** the clock, ms (pool ages); omitted = the age rule is skipped */
  now?: number;
}

const crowdOf = (f: CoinFacts): { buyers: number; sellers: number; sells: number } => ({ buyers: (f.pools ?? []).reduce((x, p) => x + p.buyers, 0), sellers: (f.pools ?? []).reduce((x, p) => x + p.sellers, 0), sells: (f.pools ?? []).reduce((x, p) => x + p.sells, 0) });
/** Does the verdict need the top holders (one more call)? Only for a coin that looks concentrated, is not listed by the provider and has no real two-sided crowd trading it. */
export function topNeeded(f: CoinFacts, t: Thresholds = T): boolean {
  if (f.listed || f.top10Pct === undefined || f.top10Pct < t.oneEntityPct) return false;
  const c = crowdOf(f);
  return !(c.buyers >= t.realCrowdWallets && c.sellers >= t.realCrowdWallets);
}
const wallets24 = (f: CoinFacts): number | undefined => (f.pools && f.pools.length ? f.pools.reduce((a, p) => a + p.buyers + p.sellers, 0) : undefined);

/**
 * Show or hide one coin. `facts` = undefined while nothing has been read. Pure.
 *   always shown: a major on its real contract, a bought coin, a coin the person chose.
 */
export function classify(coin: Named, facts: CoinFacts | undefined, ctx: Context = {}, t: Thresholds = T): Verdict {
  if (isMajor(coin)) return { show: true, why: "stable" };
  if (ctx.shown) return { show: true, why: "override" };
  if (ctx.bought) return { show: true, why: "bought" };
  const named: Named = { chain: coin.chain, address: coin.address, symbol: facts?.symbol ?? coin.symbol, name: facts?.name ?? coin.name };
  // a copy is a copy before any market is read (and also when the market says nothing)
  const copy = copyReason(named);
  if (copy) return { show: false, reason: "copycat", detail: copy.detail };
  if (noBuyName(named)) return { show: false, reason: "no-market", detail: "its name says not to buy it: a test coin" };
  if (!facts) return { show: false, reason: "checking" };

  const st = facts.state;
  // not known to the provider at all
  if (st.quote === "none" || (st.info === "none" && st.pools === "none")) return { show: false, reason: "no-market", detail: "the provider does not know this coin" };
  // a creator who can freeze your coins / a flagged honeypot: it cannot be relied on to sell (decided as soon as info is in)
  if (facts.honeypot) return { show: false, reason: "cant-sell", detail: "flagged as a honeypot" };
  if (coin.chain === "sol" && facts.freezeAuthority) return { show: false, reason: "cant-sell", detail: "the creator can freeze token accounts" };
  // a market: the deepest pool
  const liq = facts.liquidityUsd ?? (facts.pools && facts.pools.length ? Math.max(...facts.pools.map((p) => p.reserveUsd)) : undefined);
  if (liq !== undefined && liq < t.minLiquidityUsd) return { show: false, reason: "no-market", detail: `deepest pool holds $${Math.round(liq)}` };
  if (st.pools === "ok" && (facts.pools?.length ?? 0) === 0) return { show: false, reason: "no-market", detail: "no pool" };
  // the crowd rules need info + pools (+ the top holders when the holders look concentrated)
  if (st.info === "failed" || st.pools === "failed" || st.quote === "failed") return { show: false, reason: "checking" };
  const w = wallets24(facts);
  const { buyers, sellers, sells } = crowdOf(facts);
  // a coin the provider LISTS (a CoinGecko id) was vetted by somebody other than its creator: it skips the crowd rules below (never the copy / honeypot / freeze / no-market rules above)
  if (!facts.listed) {
    // one entity (labels matter), unless a real two-sided crowd trades it every day (then it is a market, however concentrated)
    if (topNeeded(facts, t)) {
      if (st.holders === "failed") return { show: false, reason: "checking" };
      const share = topShareWithoutInfrastructure(facts);
      if (share !== undefined && share >= t.oneEntityPct) return { show: false, reason: "one-entity", detail: `top holders own ${share.toFixed(0)}% outside pools and exchanges` };
      // no holder list (the list needs a key): we cannot tell a pool or an exchange from one owner, so this rule does not decide alone
    }
    // inorganic trading
    if (facts.holders !== undefined && facts.holders < t.minHolders) return { show: false, reason: "few-holders", detail: `${facts.holders} holders` };
    if (w !== undefined && w <= t.maxWallets24h && !((facts.holders ?? 0) >= t.quietOkHolders)) return { show: false, reason: "inorganic", detail: `${w} wallets traded in 24 h` };
    if (buyers >= t.lopsidedMinBuyers && sellers <= 1 && sells >= t.lopsidedMinSells) return { show: false, reason: "inorganic", detail: `${buyers} buyers and only ${sellers} wallet that ever sells` };
    // holders handed out, not earned: far more holders than traders, on a pool days old
    if (ctx.now !== undefined && facts.holders !== undefined && w !== undefined && facts.pools && facts.pools.length) {
      const born = Math.min(...facts.pools.map((p) => (p.createdAt ? Date.parse(p.createdAt) : Infinity)));
      if (Number.isFinite(born) && (ctx.now - born) / 86_400_000 < t.airdropMaxPoolAgeDays && facts.holders / Math.max(1, w) >= t.airdropHoldersPerTrader) return { show: false, reason: "inorganic", detail: `${facts.holders} holders but ${w} traders on a pool days old` };
    }
  }
  // a claim-bait or web-address name needs a real crowd (a listing does not excuse it: "Where is the airdrop?" is listed)
  if (baitName(named)) {
    const crowd = (facts.holders ?? 0) >= t.nameNeedsHolders && (liq ?? 0) >= t.nameNeedsLiquidityUsd && (w ?? 0) >= t.nameNeedsWallets24h;
    if (!crowd) return { show: false, reason: "copycat", detail: "a name like a web address or a giveaway, with no crowd behind it" };
  }
  // a coin must have been read for real before it is shown: the first quote said it exists; info or pools must also have answered
  if (st.info !== "ok" && st.pools !== "ok") return { show: false, reason: "checking" };
  return { show: true, why: "organic" };
}


// ---------------------------------------------------------------------------------------------------------------------------------- facts from what a list already holds
/** Facts for a coin seen in a pool list (search, trending): its pool's reserve, its last 24 hours of buyers and sellers, its age and whether the provider lists it.
 *  No extra call: the holder count, the freeze flag and the honeypot flag are not known here, and an unknown is never read as a negative. */
export function factsOfPool(v: { chain: ChainKey; coin: { address: string; symbol: string; name: string; listed: boolean }; pool: string; liquidityUsd: number; createdAt?: string; volume24hUsd?: number; crowd?: { buys: number; sells: number; buyers: number; sellers: number } }): CoinFacts {
  const f: CoinFacts = {
    chain: v.chain, address: v.coin.address, name: v.coin.name, symbol: v.coin.symbol, listed: v.coin.listed,
    // "info" is the list's own answer; the holders are not known (none), and without the crowd numbers the pools are not either
    state: { quote: "ok", info: "ok", pools: v.crowd ? "ok" : "none", holders: "none" },
    liquidityUsd: v.liquidityUsd,
  };
  if (v.crowd) f.pools = [{ address: v.pool, reserveUsd: v.liquidityUsd, ...v.crowd, volumeUsd: v.volume24hUsd, createdAt: v.createdAt }];
  return f;
}
