// AgentZero can do what Home does (product decision, 3 Nov: "it's just like having Claude: hey can you do this, and it does it, end
// to end"), by opening Home's OWN sheet filled in: Send, Swap, Move, Add, Request. AgentZero never draws a money sheet and
// never signs: the person sees Home's sheet and approves with Face ID. This file reads Claude's ask in our own code (the
// address's shape per chain, the dollars the person said, the places), and writes the ask and ZeroFee's own line.
// Pure: node tests it. The screen (apps/web/src/agentzero/MoneyCard.tsx) opens it with useShell().openMoney.
import { isNearName } from "../zero/jobs.ts";
import { tokensOf } from "../zero/rulebox.ts";
import { obfuscated, textHides } from "../guard/index.ts";
import { HOME_LEG_MIN_USD, SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { APP_CHAINS, appChain, type AppChain } from "@zerofee/core/app-chains";

/** Home's tab: the Safe or one wallet (shell-api money.ts HomeWallet). */
// Audit 18's I8 (builder 22's item 14; product decision, 8 Nov: SOL, NEAR and Robinhood only): the wallets are core app-chains.ts's,
// no BNB coin, place or chain anywhere AgentZero or Claude reads
export type HomePlace = "safe" | AppChain;
/** The coins a sheet is asked in. ETH is ETH (RH). */
export type HomeCoin = "SOL" | "ETH" | "NEAR" | "USDC";
export const HOME_COINS: readonly HomeCoin[] = ["SOL", "ETH", "NEAR", "USDC"];
export const HOME_PLACES: readonly HomePlace[] = ["safe", ...APP_CHAINS];

/**
 * The ask, in the shape Home's product decision (3 Nov; shell-api money.ts gets these optional fields on home/prefill):
 * send {to, usd, wallet, note}, swap {from, to, usd}, move {from, to, usd}, receive {coin}, request {usd, coin, note}.
 * A narrow local copy until it lands. `link` and `wallet` are today's fields (the payee filled in through Pay's send link,
 * and the tab a sheet opens on), so the sheet is as full as it can be before the new fields exist.
 * `trade` is not a money sheet: Trade's own entry (openTrade) isn't there yet, so it opens Trade's market (openApp).
 */
export type HomeAsk =
  | { kind: "send"; to: string; chain: "sol" | "hood" | "near"; usd: string; coin?: HomeCoin; wallet?: HomePlace; note?: string }
  | { kind: "swap"; from: HomeCoin; to: HomeCoin; usd: string; wallet?: HomePlace }
  /** `all`: the whole of `from` ("move everything"); `usd` then is what ZeroFee read there, for its own checks and line */
  | { kind: "move"; from: HomePlace; to: HomePlace; usd?: string; all?: true }
  /** no coin: Add on that wallet as Home opens it (the Safe's own Add) */
  | { kind: "receive"; coin?: HomeCoin; wallet?: HomePlace }
  | { kind: "request"; usd: string; coin?: HomeCoin; note?: string }
  /** Trade's own Buy or Sell page (useShell().openTrade, Trade's channel: shell-api trade-ask.ts), the coin named by its
   *  chain and address only (a symbol could be a copycat), found first with Trade's market search. */
  | { kind: "trade"; side: "buy" | "sell"; chain: TradeChain; address: string; symbol: string; name: string; usd?: number; pct?: number };
export type TradeChain = AppChain;
/** A coin Trade's market search found (skills.ts FoundCoin). */
export interface Found { chain: TradeChain; address: string; symbol: string; name: string; liquidityUsd: number; /** Trade's search: a same-ticker coin under a tenth of the real one's market (trade/search CoinRow) */ copycatOf?: { chain: TradeChain; address: string } }
/** Trade's market search's coins on the app's chains only (core app-chains.ts): a coin elsewhere is never offered, and a
 *  copy's "real one" elsewhere is not named (audit 18's I8). */
export function appFound(all: readonly { chain: string; address: string; symbol: string; name: string; liquidityUsd: number; copycatOf?: { chain: string; address: string } }[] | null): Found[] | null {
  if (!all) return null;
  return all.flatMap((f) => {
    if (!appChain(f.chain)) return [];
    const { copycatOf, ...rest } = f;
    return [{ ...rest, chain: f.chain, ...(copycatOf && appChain(copycatOf.chain) ? { copycatOf: { chain: copycatOf.chain, address: copycatOf.address } } : {}) }];
  });
}

/** What the chat shows: the ask, ZeroFee's own one line (never Claude's), its dollars, and the payee shortened. */
export interface HomeSheet {
  ask: HomeAsk;
  /** "Send $5.00 in SOL to Do1R…7vcy." */
  line: string;
  /** whole cents, or null (move everything, add) */
  usd: number | null;
}

/** A Solana address: base58, 32 to 44 characters. */
export const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** An ETH (RH) address: 0x and 40 hex. */
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A NEAR implicit account: 64 hex. */
export const NEAR_IMPLICIT = /^[0-9a-f]{64}$/;

/** The chain an address is on, by its shape in our own code (never Claude's guess); null when it fits none. */
export function chainOf(to: string): "sol" | "hood" | "near" | null {
  if (EVM_ADDRESS.test(to)) return "hood";
  if (NEAR_IMPLICIT.test(to) || isNearName(to)) return "near";
  if (SOL_ADDRESS.test(to)) return "sol";
  return null;
}

/** "Do1R…7vcy" for an address, and for a NEAR account that is 64 hex (mainnet rehearsal, 3 Nov: the card said all 64
 *  characters, a raw id); a NEAR name as it is. */
export const short = (to: string): string => ((isNearName(to) && !NEAR_IMPLICIT.test(to)) || to.length <= 14 ? to : `${to.slice(0, 4)}…${to.slice(-4)}`);
const usdText = (n: number): string => `$${n.toFixed(2)}`;
const COIN_WORD: Record<HomeCoin, string> = { SOL: "SOL", ETH: "ETH", NEAR: "NEAR", USDC: "USDC" };
export const PLACE_WORD: Record<HomePlace, string> = { safe: "your Safe", sol: "your SOL wallet", hood: "your Robinhood wallet", near: "your NEAR wallet" };
/** The wallet a coin lives in (Home's tab a sheet opens on). USDC is the Safe's. */
const COIN_PLACE: Record<HomeCoin, HomePlace> = { SOL: "sol", ETH: "hood", NEAR: "near", USDC: "safe" };
/** The coins Home's Send pays in on each chain. */
const SENDS: Record<"sol" | "hood" | "near", readonly HomeCoin[]> = { sol: ["SOL", "USDC"], hood: ["ETH"], near: ["NEAR", "USDC"] };
const CHAIN_WORD = { sol: "Solana", hood: "Robinhood", near: "NEAR" } as const;

export const WHO_ANY = "Who should get it? Paste their address (SOL, Robinhood or NEAR) or say their NEAR name (it ends in .near). Nothing moved.";
export const HOW_MUCH = "How much, in dollars? Say it like $5. Nothing moved.";
export const NOT_SAID = "Paste the address again, exactly as it is. AgentZero only uses an address you wrote yourself. Nothing moved.";

const DOLLAR_WORD = /[$＄]|\b(?:dollars?|dolars?|dollers?|usd|usdc|bucks?)\b|dólar|ดอลลาร์|ڈالر/i;
/** The person said dollars, and if they wrote digits, this amount is among them (turn.ts dollarsSaid, over their words). */
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
/** "five bucks", "twenty-five dollars", "a hundred": the person's number words as digits (dictation writes them so). */
export const withNumbers = (words: string): string =>
  words
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi, (_m, t: string, u: string) => String(NUMBER_WORDS[t.toLowerCase()]! + NUMBER_WORDS[u.toLowerCase()]!))
    .replace(/\b(?:a|one)\s+hundred\b/gi, "100")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi, (m) => String(NUMBER_WORDS[m.toLowerCase()]));
/** The person said dollars, and this amount is among the figures they said (digits, or number words). Audit L15: words
 *  with no figure at all never let Claude's amount through; AgentZero asks how much instead. */
export const saidDollars = (words0: string, usd: number): boolean => {
  const words = withNumbers(words0);
  if (!DOLLAR_WORD.test(words)) return false;
  const nums = [...words.replace(/(?<=\d),(?=\d{3}\b)/g, "").matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => Number(m[0]));
  return nums.some((n) => Math.abs(n - usd) < 0.005);
};
/** The most one sheet is asked for here; Home's own limits apply under it. */
export const HOME_MAX_USD = 10_000;
/**
 * The least Home's own sheets take (mainnet rehearsal, 3 Nov: "Swap $1" and "Move $1" opened sheets whose button stayed
 * off with "At least $2 per swap/move", and "Request $0.50" one that said "Ask for $3 or more": a dead end after a tap).
 * Said here first, in one line, and no sheet opens. Copies of Home's and the core's own (home-ask.test.ts holds them
 * equal): a move's and a swap's SPENDING_MIN_MOVE_USD / SWAP_MIN_USD, a request's ADD_LEAST_USD.
 */
export const MOVE_LEAST_USD = 2;
export const SWAP_LEAST_USD = 2;
export const REQUEST_LEAST_USD = 3;
const leastText = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
export const leastLine = (what: "move" | "swap" | "request", least: number): string =>
  what === "request" ? `Ask for ${leastText(least)} or more: under that, most of it goes on fees. Nothing moved.` : `A ${what} takes at least ${leastText(least)}. Say ${leastText(least)} or more. Nothing moved.`;
/** Home's own floors for a leg between the Safe and a wallet (core float-floors.ts, read, never copied: mainnet
 *  rehearsal, 3 Nov: a Safe → wallet swap of $2.00–$2.08 passed AgentZero's $2 and dead-ended on Home's sheet). */
export const FLOORS = { safeLeg: SAFE_LEG_MIN_USD, homeLeg: HOME_LEG_MIN_USD };
const WALLET: readonly HomePlace[] = ["sol", "hood"];
/** The least a move between two places takes: Safe → SOL or ETH (RH) wallet, the other way, or any other move. */
export function moveLeast(from: HomePlace, to: HomePlace, f: { safeLeg: number; homeLeg: number } = FLOORS): number {
  if (from === "safe" && WALLET.includes(to)) return Math.max(MOVE_LEAST_USD, f.safeLeg);
  if (WALLET.includes(from) && to === "safe") return Math.max(MOVE_LEAST_USD, f.homeLeg);
  return MOVE_LEAST_USD;
}
/** The least a swap takes: the Safe's USDC to a wallet's coin (SOL, ETH (RH)) is a Safe → wallet leg, and back. */
export function swapLeast(from: HomeCoin, to: HomeCoin, f: { safeLeg: number; homeLeg: number } = FLOORS): number {
  if (from === "USDC" && (to === "SOL" || to === "ETH")) return Math.max(SWAP_LEAST_USD, f.safeLeg);
  if ((from === "SOL" || from === "ETH") && to === "USDC") return Math.max(SWAP_LEAST_USD, f.homeLeg);
  return SWAP_LEAST_USD;
}

/** The dollars, read: whole cents, over 0, at most HOME_MAX_USD, and said by the person; else the line to ask again. */
function dollars(v: unknown, words: string): number | string {
  const usd = Number(v);
  if (typeof v !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > HOME_MAX_USD || Math.round(usd * 100) / 100 !== usd) return HOW_MUCH;
  return saidDollars(words, usd) ? usd : HOW_MUCH;
}
const coinOf = (v: unknown): HomeCoin | null => {
  const s = typeof v === "string" ? v.trim().toUpperCase().replace(/\s*\(RH\)$/, "") : "";
  return (HOME_COINS as readonly string[]).includes(s) ? (s as HomeCoin) : null;
};
const placeOf = (v: unknown): HomePlace | null => (typeof v === "string" && (HOME_PLACES as readonly string[]).includes(v) ? (v as HomePlace) : null);
/** A note on a Send or a Request: only one the person wrote themselves (audit L20: a note is model-written otherwise),
 *  found in their own words (any case, any spacing); anything else is dropped, never shown on Home's sheet. */
const note = (v: unknown, words: string): string | undefined => {
  if (typeof v !== "string" || !v.trim() || v.length > 120 || textHides(v)) return undefined;
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return flat(words).includes(flat(v)) ? v.trim() : undefined;
};

/** The person's words as typed or as the phone's dictation writes them: "kim dot near" is kim.near (suite, 3 Nov). Only
 *  " dot " between two words: an address never holds a space, so nothing else is changed. (" at " is left: no payee
 *  ZeroFee sends to has an @.) */
export const spoken = (words: string): string => words.replace(/(?<=[A-Za-z0-9_-])\s+(?:dot|period)\s+(?=[A-Za-z0-9_-])/gi, ".");

/** The payee, checked: in the person's own words exactly (a NEAR name in any case; dictation's "dot" as "."), and a
 *  shape we know per chain. */
export function payee(to: unknown, words0: string): { to: string; chain: "sol" | "hood" | "near" } | string {
  const words = spoken(words0);
  const raw = typeof to === "string" ? to.trim() : "";
  if (!raw) return WHO_ANY;
  if (raw.length > 128 || obfuscated(raw)) return "That payee couldn't be read. Nothing moved.";
  const near = isNearName(raw);
  const t = near ? raw.toLowerCase() : raw;
  const chain = chainOf(t);
  if (!chain) {
    if (/^0x/i.test(raw)) return "That isn't a whole Robinhood address: it's 0x and 40 letters and numbers. Paste it again. Nothing moved.";
    if (raw.includes(".")) return `${raw} isn't a NEAR name. NEAR names end in .near. Nothing moved.`;
    return WHO_ANY;
  }
  // never Claude's copy of it: the address must be in the person's own words, letter for letter
  // whole tokens only (audit M11): "kim.near" never matches inside "joakim.near", nor part of an address the whole one
  const inWords = near ? tokensOf(words.toLowerCase()).includes(t) : tokensOf(words).includes(t);
  if (!inWords) return NOT_SAID;
  return { to: t, chain };
}

/** words: the person's own words in this chat (newest last), so "sol pls, like 5$" then the address reads as one ask. */
export function sendSheet(input: Record<string, unknown>, words: string): HomeSheet | string {
  const p = payee(input.to, words);
  if (typeof p === "string") return p;
  let coin = input.coin === undefined ? null : coinOf(input.coin);
  if (input.coin !== undefined && !coin) return "Which coin? SOL, ETH, NEAR or USDC. Nothing moved.";
  if (coin && !SENDS[p.chain].includes(coin)) return `That's a ${CHAIN_WORD[p.chain]} address, so it can't get ${COIN_WORD[coin]}. Check the address or the coin. Nothing moved.`;
  if (!coin && p.chain !== "near") coin = SENDS[p.chain][0]!;
  const usd = dollars(input.usd, words);
  if (typeof usd === "string") return usd;
  const from = input.from === undefined ? null : placeOf(input.from);
  if (input.from !== undefined && !from) return "Send from which: your Safe or a wallet? Nothing moved.";
  const n = note(input.note, words);
  const ask: HomeAsk = { kind: "send", to: p.to, chain: p.chain, usd: usd.toFixed(2), ...(coin ? { coin } : {}), ...(from ? { wallet: from } : {}), ...(n ? { note: n } : {}) };
  return { ask, usd, line: `Send ${usdText(usd)}${coin ? ` in ${COIN_WORD[coin]}` : ""} to ${short(p.to)}${from ? `, from ${PLACE_WORD[from]}` : ""}.` };
}

export function swapSheet(input: Record<string, unknown>, words: string): HomeSheet | string {
  const from = coinOf(input.from);
  const to = coinOf(input.to);
  if (!from || !to) return "Swap which coins? Like USDC to SOL. Nothing moved.";
  if (from === to) return "Those are the same coin. Nothing moved.";
  const usd = dollars(input.usd, words);
  if (typeof usd === "string") return usd;
  const sLeast = swapLeast(from, to);
  if (usd < sLeast) return leastLine("swap", sLeast);
  return { ask: { kind: "swap", from, to, usd: usd.toFixed(2), wallet: COIN_PLACE[from] }, usd, line: `Swap ${usdText(usd)} of ${COIN_WORD[from]} to ${COIN_WORD[to]}.` };
}

/** "everything" said in the person's words: a move of all of it ("all my", "my NEAR wallet's money", "whatever is in",
 *  "the whole thing", "empty it"). */
export const ALL_WORDS = /\b(?:everything|all of it|all my|all the|all|whole|entire|empty it|clear it out)\b|\bwallet'?s (?:money|cash|balance)\b|\bwhat(?:ever)?(?:'s| is)? (?:left )?in (?:my|the|your)\b/i;
export function moveSheet(input: Record<string, unknown>, words: string): HomeSheet | string {
  const from = placeOf(input.from);
  const to = placeOf(input.to);
  if (!from || !to) return "Move from where to where? Your Safe, your SOL wallet, your Robinhood wallet or your NEAR wallet. Nothing moved.";
  if (from === to) return "That's the same place. Nothing moved.";
  const all = input.all === true || (input.usd === undefined && ALL_WORDS.test(words));
  if (all) {
    if (!ALL_WORDS.test(words)) return HOW_MUCH;
    return { ask: { kind: "move", from, to, all: true }, usd: null, line: `Move everything from ${PLACE_WORD[from]} to ${PLACE_WORD[to]}.` };
  }
  const usd = dollars(input.usd, words);
  if (typeof usd === "string") return usd;
  const mLeast = moveLeast(from, to);
  if (usd < mLeast) return leastLine("move", mLeast);
  return { ask: { kind: "move", from, to, usd: usd.toFixed(2) }, usd, line: `Move ${usdText(usd)} from ${PLACE_WORD[from]} to ${PLACE_WORD[to]}.` };
}

export function addSheet(input: Record<string, unknown>): HomeSheet | string {
  // "Add money to my Safe": the Safe's own Add, no coin to pick (suite, 3 Nov: it asked "which coin?")
  const to = placeOf(input.to);
  if (to && input.coin === undefined) return { ask: { kind: "receive", wallet: to }, usd: null, line: `A one-time private address to add money to ${PLACE_WORD[to]}.` };
  const coin = coinOf(input.coin);
  if (!coin) return "Add which coin? SOL, ETH, NEAR or USDC. Nothing moved.";
  return { ask: { kind: "receive", coin, wallet: COIN_PLACE[coin] }, usd: null, line: `A one-time private address to add ${COIN_WORD[coin]} to ${PLACE_WORD[COIN_PLACE[coin]]}.` };
}

export function requestSheet(input: Record<string, unknown>, words: string): HomeSheet | string {
  const usd = dollars(input.usd, words);
  if (typeof usd === "string") return usd;
  if (usd < REQUEST_LEAST_USD) return leastLine("request", REQUEST_LEAST_USD);
  const coin = input.coin === undefined ? null : coinOf(input.coin);
  if (input.coin !== undefined && !coin) return "Ask in which coin? USDC, SOL, ETH or NEAR. Nothing moved.";
  // who it's for is only said in the line (a request is a link the person shares); it must be in their words too
  const who = input.from === undefined ? null : payee(input.from, words);
  if (typeof who === "string") return who;
  const n = note(input.note, words);
  return { ask: { kind: "request", usd: usd.toFixed(2), ...(coin ? { coin } : {}), ...(n ? { note: n } : {}) }, usd, line: `Ask ${who ? short(who.to) : "someone"} for ${usdText(usd)}${coin ? ` in ${COIN_WORD[coin]}` : ""}. You share the link.` };
}

/** What the person asked Trade for, read in our own code: buy (dollars) or sell (a share), and the coin as they named it
 *  (a ticker to look up, or an address they pasted). */
export type TradeWant = { side: "buy" | "sell"; usd?: number; pct?: number; symbol: string; chain?: TradeChain; address?: string };
const TRADE_CHAINS: readonly TradeChain[] = APP_CHAINS;
export const TRADE_CHAIN_WORD: Record<TradeChain, string> = { sol: "Solana", hood: "RH", near: "NEAR" };
/** Trade's own limit on a filled-in buy (shell-api trade-ask.ts ASK_MAX_USD). */
export const TRADE_MAX_USD = 10_000;
export function tradeWant(input: Record<string, unknown>, words: string): TradeWant | string {
  const side = input.side === "sell" ? "sell" : input.side === "buy" ? "buy" : null;
  if (!side) return "Buy or sell? Nothing moved.";
  const coin = typeof input.coin === "string" ? input.coin.trim().replace(/^\$/, "") : "";
  const chain = (TRADE_CHAINS as readonly unknown[]).includes(input.chain) ? (input.chain as TradeChain) : undefined;
  let want: TradeWant;
  if (SOL_ADDRESS.test(coin) || EVM_ADDRESS.test(coin)) {
    if (!tokensOf(words).includes(coin)) return NOT_SAID;
    const on: TradeChain = EVM_ADDRESS.test(coin) ? "hood" : "sol";
    want = { side, symbol: "", chain: on, address: coin };
  } else {
    const sym = coin.toUpperCase();
    if (!/^[A-Z0-9.]{1,12}$/.test(sym)) return "Which coin? Say its name. Nothing moved.";
    // the ticker as a whole word the person said ("$WIF" or "wif"), never inside another ("BONK" in "BONKERS")
    if (!tokensOf(words.toUpperCase()).some((t) => t.replace(/^\$/, "") === sym)) return "Which coin? Say its name. Nothing moved.";
    want = { side, symbol: sym, ...(chain ? { chain } : {}) };
  }
  if (side === "buy") {
    if (input.pct !== undefined) return "A buy is in dollars. How much? Nothing moved.";
    if (input.usd !== undefined) {
      const usd = Number(input.usd);
      // over Trade's own cap: its reason, never "how much?" (review, 3 Nov: a refusal says why)
      if (typeof input.usd === "number" && usd > TRADE_MAX_USD && saidDollars(words, usd)) return `A buy is between $0.01 and $${TRADE_MAX_USD.toLocaleString("en-US")}. Nothing moved.`;
      if (typeof input.usd !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > TRADE_MAX_USD || Math.round(usd * 100) / 100 !== usd || !saidDollars(words, usd)) return HOW_MUCH;
      want.usd = usd;
    }
  } else {
    if (input.usd !== undefined) return "A sale is a share of what you hold, like 50%. How much? Nothing moved.";
    if (input.pct !== undefined) {
      const pct = Number(input.pct);
      const said = /\b(?:all|everything)\b/i.test(words) ? pct === 100 : /\bhalf\b/i.test(words) ? pct === 50 : new RegExp(`\\b${String(pct).replace(".", "\\.")}\\s*(?:%|percent)`, "i").test(words);
      // a share with a fraction ("sell 33.5%"): Trade sells whole percents, so the person picks one (review, 3 Nov:
      // never refused without saying why)
      if (said && Number.isFinite(pct) && !Number.isInteger(pct) && pct > 1 && pct < 100) return `Trade sells whole percents. Say ${Math.floor(pct)}% or ${Math.ceil(pct)}%. Nothing moved.`;
      if (!Number.isInteger(pct) || pct < 1 || pct > 100 || !said) return "How much of it, as a share? Like 50% or all of it. Nothing moved.";
      want.pct = pct;
    }
  }
  return want;
}
/** The coin picked from what Trade's market found: the only one, or one that trades ten times more than the next; else
 *  the person is asked which (copycats share tickers). The card shows the coin picked: its name, chain, short address. */
export function tradeSheet(w: TradeWant, found: readonly Found[] | null): HomeSheet | string {
  let c: Pick<Found, "chain" | "address" | "symbol" | "name"> | null = null;
  if (w.address && w.chain) c = { chain: w.chain, address: w.address, symbol: found?.[0]?.symbol ?? "", name: found?.[0]?.name ?? "" };
  else {
    if (!found) return `Trade's market couldn't be searched right now. Paste ${w.symbol}'s address instead. Nothing moved.`;
    // Trade's own order (its search ranks the real coin first, trade/search); the chain the person named, if any
    const all = found;
    const open = w.chain ? all.filter((f) => f.chain === w.chain) : all;
    if (!open.length) return `Trade's market has no coin called ${w.symbol}${w.chain ? ` on ${TRADE_CHAIN_WORD[w.chain]}` : ""}. Paste its address. Nothing moved.`;
    const a = open[0]!;
    // a copy of another coin (Trade marks it): never opened without saying so; the real one is offered
    if (a.copycatOf) {
      const real = all.find((f) => f.chain === a.copycatOf!.chain && f.address === a.copycatOf!.address);
      const realWords = real ? `${real.name || real.symbol} on ${TRADE_CHAIN_WORD[real.chain]} (${short(real.address)})` : `the ${w.symbol} on ${TRADE_CHAIN_WORD[a.copycatOf.chain]} (${short(a.copycatOf.address)})`;
      return `That ${w.symbol} on ${TRADE_CHAIN_WORD[a.chain]} (${short(a.address)}) is a copy of ${realWords}, the real one, which trades far more. Nothing opened. Say "the real one" to ${w.side} that, or paste the copy's address if you're sure.`;
    }
    const b = open.slice(1).find((f) => !f.copycatOf);
    if (b && !(a.liquidityUsd > 0 && a.liquidityUsd >= 10 * b.liquidityUsd)) return `More than one coin is called ${w.symbol}: ${[a, b].map((f) => `${f.name} on ${TRADE_CHAIN_WORD[f.chain]} (${short(f.address)})`).join(", ")}. Which one? Paste its address. Nothing moved.`;
    c = { ...a, symbol: a.symbol.toUpperCase().replace(/^\$/, "") };
  }
  const label = c.symbol || short(c.address);
  const what = `${c.name && c.symbol ? `${c.name}, ` : ""}${TRADE_CHAIN_WORD[c.chain]}, ${short(c.address)}`;
  const amount = w.side === "buy" ? (w.usd ? `${usdText(w.usd)} of ` : "") : w.pct ? (w.pct === 100 ? "all of " : `${w.pct}% of `) : "";
  return {
    ask: { kind: "trade", side: w.side, chain: c.chain, address: c.address, symbol: c.symbol, name: c.name, ...(w.usd ? { usd: w.usd } : {}), ...(w.pct ? { pct: w.pct } : {}) },
    usd: w.usd ?? null,
    line: `${w.side === "buy" ? "Buy" : "Sell"} ${amount}${label} (${what}) in Trade.`,
  };
}

/** The line once the sheet is open, while Home's own sheet can't take every field yet (prefill not landed): what to put. */
export function putLine(a: HomeAsk): string {
  switch (a.kind) {
    case "send": return `Send is open: put $${a.usd}${a.coin ? ` in ${COIN_WORD[a.coin]}` : ""}, to ${short(a.to)}.`;
    case "swap": return `Swap is open: pay $${a.usd} of ${COIN_WORD[a.from]}, get ${COIN_WORD[a.to]}.`;
    case "move": return `Move is open: ${a.usd ? `$${a.usd}` : "all of it"} from ${PLACE_WORD[a.from]} to ${PLACE_WORD[a.to]}.`;
    case "receive": return `Add is open on ${a.coin ? COIN_WORD[a.coin] : PLACE_WORD[a.wallet ?? "safe"]}. Each address works once.`;
    case "request": return `Add is open: tap Ask someone to pay you, and ask for $${a.usd}.`;
    case "trade": return `Trade is open on ${a.symbol || short(a.address)}: ${a.side} ${a.usd ? `${usdText(a.usd)} of it` : a.pct ? `${a.pct}% of it` : "it"} there.`;
  }
}

/** What Claude reads back once the sheet is shown (the person's tap and Face ID come next). */
export const SHOWN = "Shown to the person on Home's own sheet, filled in. Only their Face ID moves it. Say one short line; don't repeat the amount or address.";
