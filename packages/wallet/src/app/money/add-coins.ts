// Home's Add and Request (D123, D127, D128; the Home plan §1.2): the rows, the words, the address's letters and when a
// one-time address is swapped for a new one, apart from the sheet so they are tested without a page. Nothing here asks
// 1Click: every address and figure on the sheet comes from the core's own checked quote (subwallet.add.quote).
// Swap's and Receive's coin lists live here too (swapCoins, receiveChains): their own rules, unchanged.
import { shortTime, weekdayName } from "@zerofee/core/clock";
import { ADD_OPEN, ADD_USED, COIN_SHOWN_DECIMALS, type AddAddress, type AddChain, type AddTo } from "@zerofee/core/add-outside";
import type { Token } from "../../types.ts";
import { spanWords } from "@zerofee/core/time-words";

/** One row of Add (and Request): a chain's own coin, never a token (D123: nothing arrives that a wallet can't move). */
export interface AddRow {
  chain: AddChain;
  /** The coin's symbol, as the chain's wallet shows it. */
  symbol: string;
  /** The row's name (D124: "ETH (RH)", never "ETH on Robinhood"). */
  name: string;
  /** The coin's logo key, and the chain's badge where the coin's own logo doesn't say the chain. */
  icon: string;
  badge?: string;
  /** The chain's name, for "Send only ETH on Robinhood Chain." */
  network: string;
}
export const ADD_ROWS: readonly AddRow[] = [
  { chain: "sol", symbol: "SOL", name: "SOL", icon: "sol", network: "Solana" },
  { chain: "hood", symbol: "ETH", name: "ETH (RH)", icon: "eth", badge: "hood", network: "Robinhood Chain" },
  { chain: "near", symbol: "NEAR", name: "NEAR", icon: "near", network: "NEAR" },
  { chain: "bsc", symbol: "BNB", name: "BNB", icon: "bsc", network: "BNB Chain" },
];
/** The rows Add and Request show: only chains whose Add works end to end in the core (ADD_OPEN: SOL and ETH (RH) now). */
export const addRows = (open: Readonly<Record<AddChain, boolean>> = ADD_OPEN): AddRow[] => ADD_ROWS.filter((r) => open[r.chain]);

/** A fresh key for one ask (one row, one open, one swap): the same key again gives the same address. */
export function addKey(chain: AddChain, to: AddTo, random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(12))): string {
  return `add-${chain}-${to}-${Array.from(random(), (b) => b.toString(36).padStart(2, "0")).join("")}`.slice(0, 64);
}

/** The whole address in groups of four (one rule for every screen: core address-group). */
export { addressEnds, addressShort, groupAddress } from "@zerofee/core/address-group";

/**
 * When the row swaps its address for a new one: at the address's own end (untilIso, from the core). `due` once that time
 * has come (or the time can't be read: never an address shown past an end nobody knows); `inMs` until then, never more
 * than a timer can hold.
 */
export function swapDue(untilIso: string, nowMs: number): { due: boolean; inMs: number } {
  const end = Date.parse(untilIso);
  if (!Number.isFinite(end) || end <= nowMs) return { due: true, inMs: 0 };
  return { due: false, inMs: Math.min(end - nowMs, 2_147_000_000) };
}

/** An answer of the core's fit to show on a row: its chain and its side, an address, its least and an end to come. */
export function addFits(a: unknown, chain: AddChain, to: AddTo, nowMs: number): AddAddress | null {
  const x = a as Partial<AddAddress> | null;
  if (!x || x.chain !== chain || x.to !== to || typeof x.depositAddress !== "string" || !/^[A-Za-z0-9]{20,100}$/.test(x.depositAddress)) return null;
  if (typeof x.minAmountIn !== "string" || !/^\d{1,40}$/.test(x.minAmountIn) || typeof x.amountIn !== "string" || !/^\d{1,40}$/.test(x.amountIn)) return null;
  if (typeof x.decimals !== "number" || !Number.isInteger(x.decimals) || x.decimals < 0 || x.decimals > 24 || typeof x.symbol !== "string") return null;
  if (typeof x.untilIso !== "string" || swapDue(x.untilIso, nowMs).due) return null;
  return x as AddAddress;
}

/**
 * What a row does with the core's answer for its key (owner's Bugs:, 6 Nov: every row read "used up" on his phone). An
 * address that fits: shown. The core's ADD_USED (money reached it, or its shown day ran out): a NEW address with the same
 * meaning at once, never "used up" as a resting state (V1 has fixed wallets: this is a fresh 1Click quote for the same
 * row, not a wallet rotation). `fresh`: the key was made by such a renewal and has shown nothing yet; the core calling
 * it used too is said as a failure, never asked again in a loop. Any other refusal: its own words.
 */
export type AddStep = { show: AddAddress } | { renew: true } | { why: string };
export function addStep(r: { ok: unknown } | { problem: { code?: unknown; whatHappened?: unknown; more?: unknown } }, chain: AddChain, to: AddTo, nowMs: number, fresh: boolean): AddStep {
  if ("ok" in r) {
    const ok = addFits(r.ok, chain, to, nowMs);
    return ok ? { show: ok } : { why: ADD_WORDS.noAddress };
  }
  if (r.problem.code === ADD_USED) return fresh ? { why: ADD_WORDS.noAddress } : { renew: true };
  return { why: problemLine(r.problem) ?? ADD_WORDS.noAddress };
}

/** The words of the sheet (copy F: short, a five-year-old can read; "ETH (RH)"; no "Hidden", no "Private"). */
/** How often a shown address is checked with the core (works once, review H1): money reaching it swaps it within this. */
export const ADD_RECHECK_MS = 20_000;

/** D132: one private send is up to $10,000 (the quote server's POCKET_USD and the core's mirror); Wallet's figure. */
export const HIDDEN_MAX_USD = 10_000;
/** "$10,000" (D132). */
export const HIDDEN_MAX_TEXT = `$${HIDDEN_MAX_USD.toLocaleString("en-US")}`;

// D138 (product decision, 3 Nov): a row says its wallet's name and nothing else; the QR sheet says the rest.
export const ADD_WORDS = {
  title: "Add money",
  /** A row's name: "SOL wallet", "ETH (RH) wallet"; the Safe's, "Safe". */
  rowName: (name: string, to: AddTo) => (to === "safe" ? "Safe" : `${name} wallet`),
  // the QR sheet's two quiet lines: the one coin it takes and its least; then its end (and, for the Safe, its USDC)
  only: (symbol: string, network: string, least: string) => `Send only ${symbol} on ${network}, at least ${least} ${symbol}.`,
  // review M3: the Safe is credited on its own NEAR account, so the line promises no privacy it can't give
  until: (t: string, to: AddTo) => `${to === "safe" ? "Lands in your Safe as USDC. " : ""}Until ${t}.`,
  asking: "Getting a new address…",
  /** The row's second line in the Sim (the copy review's row spec, 6 Nov): its made-up address, never shown as a real one. */
  sampleRow: "Sample address",
  /** A row's two lines (the audit's MUST + the copy review's words, 6 Nov: money sent as another coin, on another chain or under the least
   *  can go astray, so the row and its Copy always carry the rule): the coin, its chain and its least; then its end. */
  rowOnly: (symbol: string, network: string, least: string) => `Only ${symbol} on ${network}, at least ${least} ${symbol}.`,
  rowUntil: (when: string) => `Until ${when}.`,
  /** Copy's flash (copy review, 6 Nov): in place of the end's line for 2.5 s; the rule line keeps its words, lit. */
  rowCopied: "Copied.",
  /** A row with no address to copy (its ask failed): the QR button asks again. */
  tapQr: "Tap QR for a new address.",
  /** The Copy button's name (the copy review's row spec, 6 Nov). */
  copyAddress: "Copy address",
  /** The QR sheet: who it is for (finding 39). */
  forYou: "Only for you. To be paid by someone else, tap Ask someone to pay you.",
  /** The sample page's made-up address (finding 56). */
  sample: "Sample address. It's made up, so don't send money to it.",
  getting: "Getting it…",
  noAddress: "NEAR Intents gave no address. Nothing was sent.",
  retry: "Try again",
  copy: "Copy",
  copied: "Copied",
  /** Over the one-line address on the QR sheet; the whole address opens under it on a tap (desktop audit, 5 Nov). */
  yourAddress: "Your address",
  showFull: "Show full address",
  hideFull: "Hide full address",
  qr: "Show QR code",
  ask: "Ask someone to pay you",
  close: "Close",
} as const;

/** The wallets Home's tabs open Add from (Home's onAdd(wallet)). */
export type AddWallet = "safe" | AddChain;
/**
 * Add's rows in order: every open wallet, and the Safe (its first coin, SOL). Opened from a wallet's tab, that wallet's
 * row comes first; from the Safe's tab, the Safe's. From a wallet whose Add isn't open yet (NEAR, BNB): plain Add, as if
 * opened from nowhere in particular (product decision, 3 Nov: no not-yet line; the tab's round Add is a way in, not a dead end).
 */
export function addOrder(wallet: AddWallet | undefined, rows: readonly AddRow[]): { rows: AddRow[]; safe: AddRow | null; safeFirst: boolean } {
  const mine = rows.find((r) => r.chain === wallet);
  // HOME-VISUAL §3.8: the open tab's wallet first; on All (no tab) the Safe first, where new money mostly goes
  return { rows: mine ? [mine, ...rows.filter((r) => r !== mine)] : [...rows], safe: rows[0] ?? null, safeFirst: wallet === "safe" || !mine };
}

/**
 * Where Add opens (MoneyAsk prefill; UI's rehearsal, 3 Nov: AgentZero's "receive SOL" opened the list): a coin filled in
 * by the app that opened it opens straight on that coin's address page, its wallet's (the Safe's in that coin when opened
 * from the Safe). No coin (Home's own Add: the D138 list), a Request, or a coin whose Add isn't open yet: null, the list.
 */
export function addOpensOn(coin: AddChain | undefined, wallet: AddWallet | undefined, request: boolean, rows: readonly AddRow[]): { row: AddRow; to: AddTo } | null {
  if (!coin || request) return null;
  const row = rows.find((r) => r.chain === coin);
  return row ? { row, to: wallet === "safe" ? "safe" : "wallet" } : null;
}

/**
 * Home's address card keeps one key per wallet on this phone (the same key gives the same address from the core), so a
 * tab shows the same one-time address each time it opens, until it runs out or money reached it; then a new one. Only
 * the key, its end and the address's last 6 are kept: never the address.
 */
const CARD_KEYS = "zf.addcard.v1";
/** A kept key's place: a chain's wallet ("sol"), or the Safe's line for that chain ("safe-sol"). */
export type CardSlot = AddChain | `safe-${AddChain}`;
type CardKeys = Partial<Record<CardSlot, { key: string; untilMs: number; last6?: string }>>;
export const cardKeys = (store: Pick<Storage, "getItem"> | undefined): CardKeys => {
  try {
    const v = JSON.parse(store?.getItem(CARD_KEYS) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as CardKeys) : {};
  } catch {
    return {};
  }
};
/** The card's key for this wallet now (row 16, 4 Nov): the kept one, whatever its age, until the core says its
 *  address can take no more (ADD_USED) and the row renews it (changeCardKey); a new one only when none is kept. Never a
 *  new address on reopen or reload. `used` is no longer read (kept for its callers). */
export function cardKey(store: Pick<Storage, "getItem" | "setItem"> | undefined, chain: CardSlot, _used: ReadonlySet<string> = new Set(), nowMs: number = Date.now()): string {
  const had = cardKeys(store)[chain];
  if (had && typeof had.key === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(had.key)) return had.key;
  const key = chain.startsWith("safe-") ? addKey(chain.slice(5) as AddChain, "safe") : addKey(chain as AddChain, "wallet");
  keepCardKey(store, chain, key, nowMs + 3_600_000);
  return key;
}
/** A row's renewal (addStep's renew: the core said its address can take no more): a new key for this wallet, kept at once
 *  (a reload never brings the old address back). The old address isn't forgotten by the core: money sent to it still lands. */
export function changeCardKey(store: Pick<Storage, "getItem" | "setItem"> | undefined, chain: CardSlot, nowMs: number = Date.now()): string {
  const key = chain.startsWith("safe-") ? addKey(chain.slice(5) as AddChain, "safe") : addKey(chain as AddChain, "wallet");
  keepCardKey(store, chain, key, nowMs + 3_600_000);
  return key;
}
/** Kept once the core answered: the address's own end and its last 6. */
export function keepCardKey(store: Pick<Storage, "getItem" | "setItem"> | undefined, chain: CardSlot, key: string, untilMs: number, address?: string): void {
  try {
    store?.setItem(CARD_KEYS, JSON.stringify({ ...cardKeys(store), [chain]: { key, untilMs, ...(address ? { last6: address.slice(-6) } : {}) } }));
  } catch {
    // a full or blocked store: the card asks for a new address next time, nothing else changes
  }
}

/** The core's refusal in its own words: a refusal's real line is its `more` ("Ask for $3 or more…"), its whatHappened
 *  the generic one; a partner that didn't answer says so in whatHappened ("1Click didn't answer…"). Null: no words. */
export function problemLine(p: { whatHappened?: unknown; more?: unknown } | null | undefined): string | null {
  const more = typeof p?.more === "string" ? p.more.trim() : "";
  if (more) return more.slice(0, 200);
  const what = typeof p?.whatHappened === "string" ? p.whatHappened.trim() : "";
  return what ? what.slice(0, 200) : null;
}

/** A row's least (copy review, 6 Nov): rounded UP to two significant figures, never down (0.0293 → "0.03", 0.00151 → "0.0016"),
 *  so sending exactly the figure shown is never under what the address takes. Plain digits, no exponent. */
export function leastTwoFigures(units: string, decimals: number): string {
  if (!/^\d+$/.test(units) || BigInt(units) === 0n) return "0";
  const n = BigInt(units).toString();
  const scale = n.length > 2 ? 10n ** BigInt(n.length - 2) : 1n;
  const up = ((BigInt(n) + scale - 1n) / scale) * scale;
  const s = up.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A row's end (copy review, 6 Nov): "7 Nov", the phone's own time; never "tomorrow", never "PM". */
export function untilDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const h = d.getHours() % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`;
}
/** What a row says about its address (the audit's MUST): its rule (the coin, chain and least) and its end. */
export function addRule(a: Pick<AddAddress, "minAmountIn" | "decimals" | "untilIso">, row: Pick<AddRow, "symbol" | "network">): { only: string; until: string } {
  const least = leastTwoFigures(a.minAmountIn, a.decimals);
  return { only: ADD_WORDS.rowOnly(row.symbol, row.network, least), until: ADD_WORDS.rowUntil(untilDate(a.untilIso)) };
}

/** A row line's phrases (the copy review's grid, 6 Nov): the line may wrap only at its commas, so "at least 0.03 SOL." and "10:37 pm."
 *  each stay whole, never an orphan unit. The row draws each phrase in its own nowrap span, a plain space between. */
export function rulePhrases(line: string): string[] {
  return line.split(/(?<=,) +/).filter((p) => p.length > 0);
}
/** The QR sheet's two lines (QA, 6 Nov): the row's own least (leastTwoFigures) and end (untilDate), so the row and its
 *  sheet never say two figures or two times for one address. */
export function qrLines(a: Pick<AddAddress, "minAmountIn" | "decimals" | "untilIso">, row: Pick<AddRow, "symbol" | "network">, to: AddTo): { only: string; until: string } {
  return { only: ADD_WORDS.only(row.symbol, row.network, leastTwoFigures(a.minAmountIn, a.decimals)), until: ADD_WORDS.until(untilDate(a.untilIso), to) };
}

/** "4:15 PM" today; "4:15 PM tomorrow"; "Thu 4:15 PM" on another day. */
export function untilWords(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso);
  const t = shortTime(d);
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(d.getTime()) === day(nowMs)) return t;
  const next = new Date(nowMs);
  next.setDate(next.getDate() + 1);
  return day(d.getTime()) === day(next.getTime()) ? `${t} tomorrow` : `${weekdayName(d)} ${t}`;
}

/** Our rows' own coins, in Home's order: the chain in 1Click's list, and the row's name (Swap's list). */
export const ROW_COINS: readonly { chain: string; symbol: string; row: string; network?: "sol" | "hood" | "bsc" }[] = [
  { chain: "sol", symbol: "SOL", row: "SOL", network: "sol" },
  { chain: "hood", symbol: "ETH", row: "ETH (RH)", network: "hood" },
  { chain: "near", symbol: "NEAR", row: "NEAR" },
  { chain: "bsc", symbol: "BNB", row: "BNB", network: "bsc" },
];

/** A network's name for a person ("Bitcoin"), from 1Click's chain id; the id itself in capitals when we have no name. */
const NETWORK: Record<string, string> = {
  sol: "Solana", hood: "Robinhood Chain", near: "NEAR", bsc: "BNB Chain", btc: "Bitcoin", eth: "Ethereum", base: "Base", arb: "Arbitrum",
  doge: "Dogecoin", xrp: "XRP Ledger", tron: "Tron", ton: "TON", zec: "Zcash", ltc: "Litecoin", pol: "Polygon", avax: "Avalanche",
  op: "Optimism", gnosis: "Gnosis", bera: "Berachain", sui: "Sui", stellar: "Stellar", cardano: "Cardano", aptos: "Aptos", bch: "Bitcoin Cash",
};
export const networkName = (chain: string): string => NETWORK[chain] ?? chain.toUpperCase();

/**
 * D115 (product decision, 3 Nov, for release): Swap and Receive offer only the chains ZeroFee trades on and their dollar coins, the
 * same as set-up (fund-start.ts FUND_EVERY_CHAIN). Every other coin 1Click lists stays in the code behind this switch,
 * off, for the first update. (Add and Request take native coins only: addRows, D123.)
 */
export const ADD_EVERY_COIN = false;
const TRADING_CHAINS = new Set(["sol", "hood", "near"]);
/** NEAR's own coin in 1Click's list is wNEAR (nep141:wrap.near, contract "wrap.near"), never a contract-less row (review 1). */
const NEAR_COIN = "nep141:wrap.near";
/** The dollar coins we trade, by their ids (review 8: never by a symbol a list could repeat): USDC and USDT on Solana and
 *  NEAR. Swap's list only: never Add's or Request's (D123). */
const TRADING_STABLES = new Set([
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near",
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:usdt.tether-token.near",
]);
/** The networks a Receive screen offers (Pay's Receive, D115): our trading chains only while the switch is off. */
export const receiveChains = <C extends { id: string }>(chains: readonly C[], every: boolean = ADD_EVERY_COIN): C[] => chains.filter((c) => every || TRADING_CHAINS.has(c.id));
/** A chain's own coin as 1Click lists it (a row's coin): contract-less, or NEAR's wNEAR. */
const ownCoin = (t: Pick<Token, "chain" | "contract" | "assetId">): boolean => t.contract === null || (t.chain === "near" && t.assetId === NEAR_COIN);
/** A coin on one of our trading chains: its own coin, or USDC / USDT there. */
export const tradingCoin = (t: Pick<Token, "chain" | "contract" | "symbol" | "assetId">): boolean => TRADING_CHAINS.has(t.chain) && (ownCoin(t) || TRADING_STABLES.has(t.assetId));
/** The row a coin is the own coin of (SOL, ETH (RH), NEAR, BNB), if any. */
export const rowOf = (t: Pick<Token, "chain" | "contract" | "symbol" | "assetId">) => (ownCoin(t) ? ROW_COINS.find((r) => r.chain === t.chain && r.symbol === t.symbol.toUpperCase()) : undefined);

/** Swap's pick list: our rows' coins first, then (with `every`) every other coin 1Click lists, by network then symbol;
 *  `q` filters. */
export function addCoins(tokens: Iterable<Token>, q = "", every: boolean = ADD_EVERY_COIN, bnb = false): Token[] {
  const all = [...tokens].filter((t) => /^[A-Za-z0-9.$_-]{1,12}$/.test(t.symbol) && (every || tradingCoin(t) || (bnb && t.chain === "bsc" && ownCoin(t))));
  const rowIndex = (t: Token) => { const r = rowOf(t); return r ? ROW_COINS.indexOf(r) : -1; };
  const needle = q.trim().toLowerCase();
  const hit = (t: Token) => !needle || t.symbol.toLowerCase().includes(needle) || (t.name ?? "").toLowerCase().includes(needle) || networkName(t.chain).toLowerCase().includes(needle);
  const first = all.filter((t) => rowIndex(t) >= 0 && hit(t)).sort((a, b) => rowIndex(a) - rowIndex(b));
  const rest = all.filter((t) => rowIndex(t) < 0 && hit(t)).sort((a, b) => networkName(a.chain).localeCompare(networkName(b.chain)) || a.symbol.localeCompare(b.symbol));
  return [...first, ...rest];
}

/** 600 s → "10 min", 45 s → "45 s". */
export const etaWords = (s?: number): string | null => (typeof s === "number" && s > 0 ? spanWords(s * 1000) : null);

/** Dollars → the coin's smallest units at 1Click's listed price (the ask only; the signed quote says what counts). */
export function unitsFor(usd: number, t: Pick<Token, "priceUsd" | "decimals">): string | null {
  const price = Number(t.priceUsd);
  if (!(price > 0) || !(usd > 0)) return null;
  const whole = usd / price;
  const [i, f = ""] = whole.toFixed(Math.min(t.decimals, 12)).split(".");
  const units = BigInt(i + f.padEnd(t.decimals, "0").slice(0, t.decimals));
  return units > 0n ? units.toString() : null;
}

/** "50000", 8 → "0.0005": the coin amount, never a long tail. */
export function formatUnits(units: string, decimals: number): string {
  if (!/^\d+$/.test(units)) return "0";
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "").slice(0, 8);
  return frac ? `${whole}.${frac}` : whole;
}
/** A least as the sheet says it: at most 4 decimals, rounded UP (leastShown), so "at least" is never under what the address takes. */
export function leastWords(units: string, decimals: number): string {
  return formatUnits(leastShown(units, decimals), decimals);
}
/** A coin amount that came (Home's line), as a person reads it: at most COIN_SHOWN_DECIMALS places, rounded DOWN (never
 *  more than arrived). */
export function coinShown(units: string, decimals: number): string {
  if (!/^\d+$/.test(units)) return "0";
  const scale = decimals > COIN_SHOWN_DECIMALS ? 10n ** BigInt(decimals - COIN_SHOWN_DECIMALS) : 1n;
  return formatUnits(((BigInt(units) / scale) * scale).toString(), decimals);
}
/** The least the sheet asks for, in smallest units: the quote's least rounded UP to COIN_SHOWN_DECIMALS places (the
 *  rule: at most 4 decimals of a coin), so sending exactly the figure shown is never under what the address takes. */
export function leastShown(units: string, decimals: number): string {
  if (!/^\d+$/.test(units) || BigInt(units) === 0n) return "0";
  const scale = decimals > COIN_SHOWN_DECIMALS ? 10n ** BigInt(decimals - COIN_SHOWN_DECIMALS) : 1n;
  return (((BigInt(units) + scale - 1n) / scale) * scale).toString();
}

/** Swap's "You get" (D115): our trading chains' coins and USDC/USDT on them, plus BNB, which the sheet
 *  answers with its own line ("Hidden can't swap BNB yet."); every other coin 1Click prices behind the same switch, off. */
export const swapCoins = (tokens: Iterable<Token>, q = "", every: boolean = ADD_EVERY_COIN): Token[] => addCoins(tokens, q, every, true);
