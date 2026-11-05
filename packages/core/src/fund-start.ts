// "Add money to start" (product decision, 2 Nov): a new mainnet account opens with any big coin, not only NEAR.
//
// The money path, decided here and nowhere else (the page only shows what this returns):
// - PRIVATE (3 Nov, the Home plan §4; every new order): a coin from another chain goes to a one-time 1Click address whose
//   recipient AND refund are the person's own confidential balance (float-add.ts addSetup, Home's Add's own route, the
//   pinned relay). Once it lands, the core sends what arrived on, as NEAR, to the setup address below. No public quote
//   names the payer's wallet, a row or the new account together, and a refund never goes to a wallet's address. Only
//   each chain's own coin (fundOffered): no USDC or USDT. The rest of this header is the public route, kept only to read
//   an order made before.
// - DELIVERY: NEAR, as native NEAR, to the account being opened: its one-time setup address (the 64-hex implicit
//   account whose key only this core holds, Funding.fundAddress). From there account.create opens the named account
//   with all of it, exactly as when the person sends NEAR themselves. 1Click delivers wNEAR to a NEAR address as native
//   NEAR (proven on mainnet 1-2 Nov: fund-publisher.ts, SOL -> native NEAR, checked on chain after each leg).
// - REFUND: the account's own wallet on the coin's network, made from the backup words (D43, one wallet per chain D55),
//   refunded on that network (ORIGIN_CHAIN). Never an address anyone types, never ZeroFee's.
// - AMOUNT: FLEX_INPUT (1Click's spec, /v0/quote swapType): any deposit at or above minAmountIn is swapped, and what
//   comes out must be at least minAmountOut, which this module requires to cover what the account still needs. The
//   amount asked is what the account needs plus 5% (a dry EXACT_OUTPUT price first), so 1% slippage still covers it.
// - TRUST: only 1Click's own signed quote counts (parseQuote: signature, real not dry, the deposit address signed, the
//   one 1Click fee at 20 bps or less, D55). Its every term is compared with what the core asked; any difference and the
//   quote is not used. The same check runs again on every status read, so a status can't name another recipient.
import { formatAmount } from "./format.ts";
import { parseQuote, type QuoteFacts } from "./intents.ts";
import { ProblemError } from "./problem.ts";
import { ONE_CLICK_QUOTE_KEY } from "./quote-signature.ts";
import { securityProblems } from "./security-problems.ts";

/** The networks a coin may come from: the ones the backup words make a wallet on (subwallets.ts createCurrent), and
 *  (D155) any other chain NEAR Intents takes its own coin from (setup-coins.ts), through the private route. */
export type FundChain = "near" | "sol" | "eth" | "base" | "arb" | "hood" | (string & {});

export interface FundCoin {
  /** The coin's id in this list (what the page sends back). */
  id: string;
  symbol: string;
  /** What the tile says: the coin's own name, or the network's where the coin is that network's ETH. */
  name: string;
  network: string;
  chain: FundChain;
  /** 1Click's asset id; "near" for NEAR itself (sent straight to the account's address, no swap). */
  assetId: string;
  decimals: number;
  /** The coin's own address on its network (an ERC-20 contract, a Solana mint); none for the network's own coin. The
   *  deposit watcher (J2) reads the deposit address's balance of it there, on free nodes. */
  token?: string;
}

export const WRAPPED_NEAR = "nep141:wrap.near";

/**
 * Every coin offered, in the order the screen shows them. Each was quoted by 1Click for real on 2 Nov 2026 (no deposit:
 * $ZEROFEE_HOME/reports/fund-any-coin-2026-11-02/quotes.json, tools/fund/quote-every-coin.ts). Not offered:
 * - BNB, and USDC and USDT on BNB Chain: 1Click refused them that day ("Temporary swap limits: minimum swap amount is
 *   $1,000", its HOT bridge), and xDAI on Gnosis ("No liquidity available");
 * - Bitcoin, Tron and every other network the backup words make no wallet on: a refund there would need an address typed in.
 */
export const FUND_COINS: readonly FundCoin[] = [
  { id: "near", symbol: "NEAR", name: "NEAR", network: "NEAR", chain: "near", assetId: "near", decimals: 24 },
  { id: "sol", symbol: "SOL", name: "Solana", network: "Solana", chain: "sol", assetId: "nep141:sol.omft.near", decimals: 9 },
  { id: "eth", symbol: "ETH", name: "Ethereum", network: "Ethereum", chain: "eth", assetId: "nep141:eth.omft.near", decimals: 18 },
  { id: "hood-eth", symbol: "ETH", name: "Robinhood Chain", network: "Robinhood Chain", chain: "hood", assetId: "nep141:hood.omft.near", decimals: 18 },
  { id: "base-eth", symbol: "ETH", name: "Base", network: "Base", chain: "base", assetId: "nep141:base.omft.near", decimals: 18 },
  { id: "arb-eth", symbol: "ETH", name: "Arbitrum", network: "Arbitrum", chain: "arb", assetId: "nep141:arb.omft.near", decimals: 18 },
  { id: "usdc-sol", symbol: "USDC", name: "USDC", network: "Solana", chain: "sol", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { id: "usdc-base", symbol: "USDC", name: "USDC", network: "Base", chain: "base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { id: "usdc-eth", symbol: "USDC", name: "USDC", network: "Ethereum", chain: "eth", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  { id: "usdc-arb", symbol: "USDC", name: "USDC", network: "Arbitrum", chain: "arb", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { id: "usdt-eth", symbol: "USDT", name: "USDT", network: "Ethereum", chain: "eth", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6, token: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  { id: "usdt-sol", symbol: "USDT", name: "USDT", network: "Solana", chain: "sol", assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", decimals: 6, token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
];

/** D155: every other chain's own coin set-up takes (setup-coins.ts), as a tile: its id is its chain's. ETH on Ethereum,
 *  Base and Arbitrum are already above. */
const SETUP_TILES: readonly FundCoin[] = SETUP_COINS.filter((c) => !FUND_COINS.some((b) => !b.token && b.assetId === c.tokenId)).map((c) => ({ id: c.chain, symbol: c.symbol, name: c.name, network: c.name, chain: c.chain, assetId: c.tokenId, decimals: c.decimals }));
/** Every coin set-up knows: FUND_COINS (each on a network the backup words make a wallet on: the old public route's
 *  list, read by the tools' refund check) and, D155, every other chain's own coin (the private route only). */
export const FUND_ANY: readonly FundCoin[] = [...FUND_COINS, ...SETUP_TILES];

export const fundCoin = (id: unknown): FundCoin | undefined => FUND_ANY.find((c) => c.id === id);
/** The coins most people send, first on the page (D155: "the person's likely ones first"), in this order. */
export const FUND_LIKELY: readonly string[] = ["near", "btc", "eth", "sol", "bsc"];

// D115: the switch lives in fund-every-chain.ts (Home reads it without this file in its first load)
import { FUND_EVERY_CHAIN } from "./fund-every-chain.ts";
import { SETUP_COINS, setupCoin } from "./setup-coins.ts";
export { FUND_EVERY_CHAIN };
/**
 * The coins set-up offers now (D123, dead ends row 3): each chain's own coin only, never USDC or USDT (a token refunded
 * to a SOL wallet is stuck there: it can't show or send one); NEAR itself (sent straight to the account's own address);
 * and SOL and ETH (RH), the chains whose coin opens an account the private way (float-add.ts addSetup: the same one-time
 * address as Home's Add, into the person's own confidential balance, then NEAR to the account being opened). Any other
 * chain has no private route, so it isn't offered at all (drop, don't degrade), whatever the switch above says.
 */
export const fundOffered = (every: boolean = FUND_EVERY_CHAIN): readonly FundCoin[] => {
  const offered = FUND_ANY.filter((c) => !c.token && (/^(near|sol|hood)$/.test(c.chain) || (every && !!setupCoin(c.chain))));
  // the likely ones first (FUND_LIKELY's order), then every other by its name
  const rank = (c: FundCoin) => { const i = FUND_LIKELY.indexOf(c.id); return i < 0 ? FUND_LIKELY.length : i; };
  return [...offered].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
};
/** The private route sizes its address for what the opening still needs plus this much (10 %): its least (99 %), the
 *  change to NEAR (1Click's 1 % and fee) and the gap between the core's price and 1Click's all fit inside. */
export const FUND_PRIVATE_ROOM = 1.1;

/**
 * How long the screen offers an address: a day, as Home's Add shows one (D155, product decision, 3 Nov: no "one hour" pressure; a
 * real limit, said calmly). 1Click signs its own, later deadline on a FLEX_INPUT quote (3 days, seen 2 Nov); the private
 * route's refund is the person's own confidential balance, so money sent late is never lost. After it the screen offers a
 * new address.
 */
export const FUND_ADDRESS_MS = 24 * 60 * 60_000;
export const shownUntil = (o: FundOrder): string => {
  const signed = Date.parse(o.deadlineIso);
  const ours = o.startedAtMs + FUND_ADDRESS_MS;
  return new Date(Number.isFinite(signed) ? Math.min(signed, ours) : ours).toISOString();
};
/** 5% over what the account needs, so 1% slippage (FUND_SLIPPAGE_BPS) still covers it. */
const HEADROOM_PCT = 105n;
export const FUND_SLIPPAGE_BPS = 100;

/** One address asked for: everything the screen and the checks need, kept in the core's vault. */
export interface FundOrder {
  coinId: string;
  depositAddress: string;
  memo?: string;
  /** The account's own wallet on the coin's network: 1Click's refund address. */
  refundTo: string;
  /** The account being opened (its setup address): 1Click's recipient. */
  fundAddress: string;
  /** What the account still needed when this was asked (yocto). */
  needYocto: string;
  /** In the coin's smallest units: what to send, and the least that is taken. */
  amountIn: string;
  minAmountIn: string;
  /** 1Click's dollars for amountIn (signed with the quote). */
  amountInUsd?: string;
  deadlineIso: string;
  startedAtMs: number;
  /** 1Click's own estimate of the swap's time, in seconds (its quote's timeEstimate): the live ETA's length. */
  etaSeconds?: number;
  /** The deposit watcher (J2), on the coin's own network: what the deposit address held at its first read (smallest
   *  units), what arrived over that (the most seen, kept so 1Click sweeping the address never un-sees it), and when
   *  money was first seen there or by 1Click. Display only: they tick the checklist, they never move or decide money. */
  baseUnits?: string;
  seenUnits?: string;
  seenAtMs?: number;
  /** "private": the confidential route (float-add.ts addSetup): `addKey` is its job's key in the core's own record,
   *  `refundTo` is empty (a refund goes to the person's own confidential balance, never a wallet's address). None: an
   *  order from before, on the public route, still read as it was. */
  route?: "private";
  addKey?: string;
}

/** The 1Click request for this coin, as the core sends it (and checks it came back). */
export function fundRequest(o: { coin: FundCoin; amount: string; swapType: "EXACT_OUTPUT" | "FLEX_INPUT"; dry: boolean; refundTo: string; fundAddress: string; deadlineIso: string }) {
  return {
    dry: o.dry,
    swapType: o.swapType,
    slippageTolerance: FUND_SLIPPAGE_BPS,
    originAsset: o.coin.assetId,
    depositType: "ORIGIN_CHAIN" as const,
    destinationAsset: WRAPPED_NEAR,
    amount: o.amount,
    refundTo: o.refundTo,
    refundType: "ORIGIN_CHAIN" as const,
    recipient: o.fundAddress,
    recipientType: "DESTINATION_CHAIN" as const,
    deadline: o.deadlineIso,
  };
}

/** What to ask the dry price for: the NEAR still needed plus 5%. */
export const fundTarget = (needYocto: bigint): bigint => (needYocto * HEADROOM_PCT) / 100n;

const UNITS = /^\d{1,40}$/;
const isUnits = (v: unknown): v is string => typeof v === "string" && UNITS.test(v);

/**
 * The dry price's input amount (EXACT_OUTPUT for fundTarget), only from an answer that is the core's own request and
 * prices at least that much NEAR; null otherwise. Nothing is paid from a dry answer: it only sizes the real quote.
 */
export function dryAmountIn(raw: any, coin: FundCoin, want: bigint): string | null {
  const req = raw?.quoteRequest, q = raw?.quote;
  if (!req || !q || req.dry !== true || req.originAsset !== coin.assetId || req.destinationAsset !== WRAPPED_NEAR || req.swapType !== "EXACT_OUTPUT") return null;
  if (!isUnits(q.amountIn) || !isUnits(q.amountOut) || BigInt(q.amountOut) < want || BigInt(q.amountIn) === 0n) return null;
  return q.amountIn;
}

/**
 * A real quote's terms, checked against exactly what the core asked: 1Click's signature (parseQuote), the coin, NEAR out
 * to the account being opened, refunds to the account's own wallet on that network, FLEX_INPUT, and at least the NEAR
 * still needed out. Returns the facts, or throws: a quote that differs in anything is never shown.
 */
export function checkFundQuote(raw: unknown, o: { coin: FundCoin; refundTo: string; fundAddress: string; needYocto: bigint; amountIn?: string }, nowMs: number, quoteKey: string = ONE_CLICK_QUOTE_KEY): QuoteFacts {
  const r = raw as { quote?: { depositAddress?: unknown } } | null;
  const deposit = typeof r?.quote?.depositAddress === "string" ? r.quote.depositAddress : "";
  const facts = parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: raw }, deposit, quoteKey, nowMs);
  if (!facts || !fundTermsOk(facts, o, nowMs) || (o.amountIn !== undefined && facts.amountIn !== o.amountIn)) throw new ProblemError(fundQuoteRefused());
  // The least taken must still open the account (security review 2 Nov): "At least" on the screen is minAmountIn, so
  // its share of the NEAR promised (minAmountOut for amountIn) covers what the account needs.
  const minIn = (raw as { quote?: { minAmountIn?: unknown } })?.quote?.minAmountIn;
  if (!isUnits(minIn) || BigInt(minIn) > BigInt(facts.amountIn) || (BigInt(facts.minAmountOut) * BigInt(minIn)) / BigInt(facts.amountIn) < o.needYocto) throw new ProblemError(fundQuoteRefused());
  return facts;
}

/** The terms that decide where the money goes and how much, the same on the quote and on every status read. */
export function fundTermsOk(f: QuoteFacts, o: { coin: FundCoin; refundTo: string; fundAddress: string; needYocto: bigint }, nowMs: number, live = true): boolean {
  return (
    f.originAsset === o.coin.assetId && f.destinationAsset === WRAPPED_NEAR && f.depositType === "ORIGIN_CHAIN" && f.swapType === "FLEX_INPUT" &&
    f.recipient === o.fundAddress && f.recipientType === "DESTINATION_CHAIN" && f.refundTo === o.refundTo && f.refundType === "ORIGIN_CHAIN" &&
    isUnits(f.amountIn) && BigInt(f.amountIn) > 0n && isUnits(f.minAmountOut) && BigInt(f.minAmountOut) >= o.needYocto &&
    (!live || Date.parse(f.deadline) > nowMs)
  );
}

export const fundQuoteRefused = () => securityProblems.fundQuoteRefused();

/** The order to keep, from a checked quote. */
export function orderFrom(raw: any, facts: QuoteFacts, o: { coin: FundCoin; refundTo: string; fundAddress: string; needYocto: bigint }, nowMs: number): FundOrder {
  const q = raw.quote;
  const minIn = isUnits(q?.minAmountIn) ? q.minAmountIn : facts.amountIn;
  return {
    coinId: o.coin.id,
    depositAddress: q.depositAddress,
    ...(typeof q.depositMemo === "string" && q.depositMemo ? { memo: q.depositMemo } : {}),
    refundTo: o.refundTo,
    fundAddress: o.fundAddress,
    needYocto: o.needYocto.toString(),
    amountIn: facts.amountIn,
    minAmountIn: minIn,
    ...(facts.amountInUsd ? { amountInUsd: facts.amountInUsd } : {}),
    deadlineIso: facts.deadline,
    startedAtMs: nowMs,
    ...(Number.isInteger(Number(q?.timeEstimate)) && Number(q.timeEstimate) > 0 && Number(q.timeEstimate) <= 3600 ? { etaSeconds: Number(q.timeEstimate) } : {}),
  };
}

/**
 * The deposit watcher's reading (J2): what reached the deposit address on its own network over what it held at the first
 * read, in smallest units, never less than what was seen before (1Click sweeps the address once it takes the money).
 * `heldNow` null: the network couldn't be read, so only what was seen before counts (unread is never empty). The first
 * read only sets the start (`base`, to keep).
 */
export function overBase(heldNow: bigint | null, order: Pick<FundOrder, "baseUnits" | "seenUnits">): { arrived: bigint | null; base?: string } {
  const kept = order.seenUnits && UNITS.test(order.seenUnits) ? BigInt(order.seenUnits) : null;
  if (heldNow === null) return { arrived: kept };
  if (order.baseUnits === undefined || !UNITS.test(order.baseUnits)) return { arrived: kept ?? 0n, base: heldNow.toString() };
  const base = BigInt(order.baseUnits);
  const over = heldNow > base ? heldNow - base : 0n;
  return { arrived: kept !== null && kept > over ? kept : over };
}

/** 1Click's word on an address, cut to what the checklist reads; null when the status isn't the order's own quote. */
export interface FundSwap {
  status: "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
  /** What arrived at the address, in the coin's smallest units (when 1Click says). */
  depositedIn?: string;
  /** NEAR out, yocto (when 1Click says). */
  amountOut?: string;
  /** What went back to the person's wallet, in the coin's smallest units. */
  refunded?: string;
}
const SWAP_STATES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;

/**
 * A status read: believed only when it carries 1Click's signed quote for this very address with the order's own terms
 * (the deadline may have passed: a status is still read to say what happened). `status` itself is 1Click's word on
 * progress, which it doesn't sign; it never decides where money goes, only what the checklist ticks.
 */
export function readSwap(raw: any, order: FundOrder, nowMs: number, quoteKey: string = ONE_CLICK_QUOTE_KEY): FundSwap | null {
  const coin = fundCoin(order.coinId);
  if (!coin || !raw || typeof raw !== "object") return null;
  const facts = parseQuote(raw, order.depositAddress, quoteKey, nowMs);
  if (!facts || !fundTermsOk(facts, { coin, refundTo: order.refundTo, fundAddress: order.fundAddress, needYocto: BigInt(order.needYocto) }, nowMs, false) || facts.amountIn !== order.amountIn) return null;
  const status = SWAP_STATES.find((s) => s === raw.status);
  if (!status) return null;
  const d = raw.swapDetails ?? {};
  const pick = (v: unknown) => (isUnits(v) ? v : undefined);
  const depositedIn = pick(d.depositedAmount) ?? pick(d.amountIn);
  const amountOut = pick(d.amountOut);
  const refunded = pick(d.refundedAmount);
  return { status, ...(depositedIn ? { depositedIn } : {}), ...(amountOut ? { amountOut } : {}), ...(refunded && refunded !== "0" ? { refunded } : {}) };
}

/** The steps, as the checklist shows them: each from what was read, never from the clock. */
export type StepState = "done" | "now" | "todo" | "failed";
export type FundStepKey = "seen" | "near" | "open" | "rest";
export interface FundStep {
  key: FundStepKey;
  state: StepState;
}
/** Where the whole thing stands. */
export type FundState = "waiting" | "working" | "opening" | "opened" | "done" | "short" | "expired" | "refunded" | "failed" | "open-failed";

export interface FundFacts {
  order: FundOrder | null;
  coin: FundCoin;
  /** 1Click's answer for the order's address (null: none yet, or it couldn't be read or checked). */
  swap: FundSwap | null;
  /** What reached the order's deposit address on the coin's own network (the watcher, smallest units); null: unread. */
  onChain?: bigint | null;
  /** The NEAR at the account's setup address now (yocto), on two nodes; null once the account is open or unread. */
  haveYocto: bigint | null;
  needYocto: bigint;
  /** The account's stage now (the core's own record). */
  stage: "needs-funding" | "creating" | "needs-backup" | "ready";
  /** The core is opening the account this moment. */
  opening: boolean;
  /** The last try to open it failed (kept until the next try). */
  openFailed: boolean;
  /** The rest beyond the opening, when there is one worth moving (yocto), and whether it reached Private. */
  rest: { yocto: bigint; moved: boolean; moving: boolean } | null;
  nowMs: number;
}

/** The checklist from the facts read. `near` for NEAR itself: seen, then open (no swap step). */
export function fundSteps(f: FundFacts): { state: FundState; steps: FundStep[] } {
  const opened = f.stage === "needs-backup" || f.stage === "ready";
  // "creating": the opening began (the setup address may be spent or gone already): it carries on, never asks again.
  const arrived = opened || f.stage === "creating" || (f.haveYocto !== null && f.haveYocto >= f.needYocto);
  const direct = f.coin.id === "near";
  const s = f.swap?.status;
  // The watcher (J2): money at the deposit address on its own network, seen within seconds of its block, before 1Click
  // says anything. Under the least the address takes: some arrived, not all. 1Click's own word, once it has one, leads.
  const pending = s === undefined || s === "PENDING_DEPOSIT";
  const chainIn = !direct && pending && f.order ? f.onChain ?? 0n : 0n;
  const chainShort = chainIn > 0n && chainIn < BigInt(f.order?.minAmountIn ?? "0");
  const restStep: FundStep[] = f.rest ? [{ key: "rest", state: f.rest.moved ? "done" : f.stage === "ready" ? "now" : "todo" }] : [];
  const seenNow = direct ? arrived || (f.haveYocto ?? 0n) > 0n : arrived || !pending || chainIn > 0n;
  const open: FundStep = { key: "open", state: opened ? "done" : f.openFailed ? "failed" : arrived ? "now" : "todo" };
  const steps: FundStep[] = direct
    ? [{ key: "seen", state: seenNow ? (arrived ? "done" : "now") : "now" }, open, ...restStep]
    : [
        { key: "seen", state: seenNow ? ((s === "INCOMPLETE_DEPOSIT" || chainShort) && !arrived ? "failed" : "done") : "now" },
        { key: "near", state: arrived ? "done" : s === "REFUNDED" || s === "FAILED" ? "failed" : s === "PROCESSING" || s === "SUCCESS" || s === "KNOWN_DEPOSIT_TX" || (chainIn > 0n && !chainShort) ? "now" : "todo" },
        open,
        ...restStep,
      ];
  // A "now" step after a failed or open one is still to come.
  let state: FundState;
  if (opened) state = f.rest && !f.rest.moved ? "opened" : "done";
  else if (f.openFailed) state = "open-failed";
  else if (arrived) state = "opening";
  else if (!direct && s === "REFUNDED") state = "refunded";
  else if (!direct && s === "FAILED") state = "failed";
  else if (!direct && (s === "INCOMPLETE_DEPOSIT" || chainShort)) state = "short";
  else if (direct ? (f.haveYocto ?? 0n) > 0n : !pending || chainIn > 0n) state = "working";
  else if (!direct && f.order && Date.parse(shownUntil(f.order)) <= f.nowMs) state = "expired";
  else state = "waiting";
  if (direct && !arrived && (f.haveYocto ?? 0n) > 0n) steps[0] = { key: "seen", state: "failed" };
  return { state, steps };
}

/** A coin amount in its smallest units, as a short number for a person (never base units on screen). */
export function coinText(units: string | bigint, decimals: number, round: "up" | "down" = "up"): string {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const full = formatAmount(v, decimals);
  // Six significant digits at most; rounded up for what to send (never under), down for what came back.
  const [i, f = ""] = full.split(".");
  if (!f) return i;
  const lead = i === "0" ? f.search(/[1-9]/) : -1;
  const keep = i !== "0" ? Math.max(0, 6 - i.length) : lead < 0 ? 0 : lead + 4;
  if (f.length <= keep) return full;
  const scale = 10n ** BigInt(decimals - keep);
  const cut = round === "up" ? ((v + scale - 1n) / scale) * scale : (v / scale) * scale;
  return formatAmount(cut, decimals);
}

/** What the core keeps in its vault for the checklist (FUND_ORDERS), so it survives the app restarting. */
export interface FundRecord {
  /** The addresses asked for, the newest last (a few kept: money sent to an older one still lands at the account). */
  orders: FundOrder[];
  /** What the account needs in all to open (yocto), as when the first address was asked. */
  fullNeedYocto?: string;
  /** The person closed the checklist and went into the app (the activity bar shows it). */
  away?: boolean;
  /** The setup address's NEAR and the opening's need when the opening began: the rest is the difference. */
  haveAtOpen?: string;
  needAtOpen?: string;
  /** Wallet's own record of the rest's move into Private, and whether it read done. */
  restMovementId?: string;
  restMoved?: boolean;
}

/** account.fund.status's answer: what the checklist shows. Amounts are short numbers with their coin; dollars as text. */
export interface FundView {
  coin: { id: string; symbol: string; name: string; network: string };
  state: FundState;
  steps: FundStep[];
  /** The account's stage now: waiting for money, open with its backup words still to write down, or ready. */
  stage: "needs-funding" | "needs-backup" | "ready";
  away: boolean;
  deposit?: { address: string; memo?: string; amount: string; minimum: string; usd?: string; minimumUsd?: string; untilIso: string };
  /** The account's own wallet on the coin's network, where a refund goes (the same as the address for NEAR). */
  refundTo?: string;
  /** What arrived so far (the coin), and what went back to the person's wallet. */
  arrived?: string;
  refunded?: string;
  /** The rest beyond the opening, in NEAR and dollars, when there is one worth moving to Private. */
  rest?: { near: string; usd?: string; movementId?: string };
  /** The backup words are written down and checked: before any money (J2, words first), or with the account ready. */
  wordsDone: boolean;
  /** O-2c: the NEAR is at the setup address, and the account opens once the words are checked (nothing opens before). */
  waitsForWords?: true;
  /** While the swap runs: when 1Click expects it done (money first seen, plus its own estimate). The live ETA. */
  etaIso?: string;
}

/** The rest goes to Private only when it is worth a move: a dollar or more (0.25 NEAR when no price can be read). */
export const FUND_REST_MIN_USD = 1;
export const FUND_REST_MIN_YOCTO = 250_000_000_000_000_000_000_000n;
