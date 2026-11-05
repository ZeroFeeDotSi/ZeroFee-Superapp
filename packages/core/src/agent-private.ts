import { AGENT_CROSS_CHAIN, AGENT_PRIVATE_OFF, AGENT_PRIVATE_ROUTE, AGENT_TOP_UP_OFF, AGENTZERO_WALLET } from "./agent-route.ts";
import { CHAIN_COIN } from "./float-moves.ts";
import { FLOAT_MIN_USD } from "./float.ts";
import type { Chain } from "./chain.ts";
import { pairWords, readOffer, sealSeed } from "./pair.ts";
import { parseQuote, type OneClickQuoter, type QuoteFacts } from "./intents.ts";
import { ONE_CLICK_QUOTE_KEY } from "./quote-signature.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

const UNITS = /^\d{1,39}$/;

// ── AgentZero's private payment (D89, D91) ──────────────────────────────────────────────────────────────────────────
// AgentZero never pays a person, or Spending, straight from the Safe: a direct mt_transfer would show the Safe paying
// them. The core asks 1Click for a quote itself (USDC in NEAR Intents → USDC to the person, or into Spending's private
// balance), checks it field by field as 1Click signed it, and AgentZero's key pays only that quote's fresh deposit
// address (agent_pay, mt_transfer inside NEAR Intents: "route A"). The deposit address never passes through app code.
// The contract holds such a payment to the budget's "any address" cap (convert_per_day); this core (the signer) is what
// keeps it to a person on the account's own list or to Spending.

/** USDC on NEAR (native), the only coin AgentZero's budget holds (packages/agent zero/budget.ts). */
export { AGENT_USDC } from "./agent-route.ts";
import { AGENT_USDC } from "./agent-route.ts";
import { QUOTE_DEADLINE_STEP_MS, quoteDeadline } from "./quote-deadline.ts";
/** The least a USDC → USDC quote may promise: 98 % (1Click's 1 % slippage and its fee). */
const AGENT_LEAST_PCT = 98n;
const AGENT_QUOTE_MS = 10 * 60_000;

// ── Payees on any chain (D111, G1) ────────────────────────────────────────────────────────────────────────────────
/** The chains a payee may be on today: ZeroFee's own rows. A NEAR name is one case of the general shape. */
export type PayeeChain = "near" | "sol" | "hood" | "bsc";
/** Someone AgentZero pays: an address on a chain, and the coin they want (their chain's own coin when none). */
export interface Payee {
  chain: PayeeChain;
  address: string;
  /** A 1Click asset id on that chain; none: the chain's own coin. */
  coin?: string;
}
export const PAYEE_CHAIN_NAME: Record<PayeeChain, string> = { near: "NEAR", sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
const PAYEE_ADDRESS: Record<PayeeChain, RegExp> = {
  near: /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  hood: /^0x[0-9a-fA-F]{40}$/,
  bsc: /^0x[0-9a-fA-F]{40}$/,
};

/** A payee from an app's or the tray's words, or the one line why not (it names the chain). `chain` defaults to NEAR. */
export function readPayee(to: unknown, chain: unknown = "near", coin?: unknown): Payee | { refused: string } {
  if (typeof chain !== "string" || !(chain in PAYEE_ADDRESS)) return { refused: "AgentZero can't pay on that chain. Nothing was sent." };
  const c = chain as PayeeChain;
  if (typeof to !== "string" || !PAYEE_ADDRESS[c].test(to)) return { refused: c === "near" ? "That isn't a NEAR account. Nothing was sent." : `That isn't a ${PAYEE_CHAIN_NAME[c]} address. Nothing was sent.` };
  if (coin !== undefined && (typeof coin !== "string" || !/^nep(141|245):[\w.:-]{2,128}$/.test(coin))) return { refused: "That coin isn't one AgentZero knows. Nothing was sent." };
  return { chain: c, address: to, ...(coin === undefined ? {} : { coin }) };
}

/** The asset a payee gets: theirs if named, else their chain's own coin (from Spending's own table). */
function payeeAsset(p: Payee): { tokenId: string; decimals: number } | null {
  if (p.coin) return null; // a named coin needs its decimals: only through a seller's exact amount (amountOut)
  if (p.chain === "near") return null;
  const c = CHAIN_COIN[p.chain];
  return c.open ? { tokenId: c.tokenId, decimals: c.decimals } : null;
}

/** The most a payment to an address on another chain may cost, in USDC units: the amount plus Spending's own room for a
 *  move (3 % and $0.50 of network fees). Every cap counts this, never the amount alone. */
export const payeeCeiling = (units: string): string => ((BigInt(units) * 103n) / 100n + 500_000n).toString();

/** Who AgentZero's private payment is for: a person on the account's list, the person's own Spending, or (D111) an
 *  address on another chain, getting exactly `amountOut` of `asset`. */
export type AgentPayee =
  | { kind: "person"; name: string }
  | { kind: "spending"; address: string }
  | { kind: "payee"; payee: Payee; asset: string; amountOut: string; maxIn: string };

function agentPrivateRequest(accountId: string, amount: string, to: AgentPayee, nowMs: number): Record<string, unknown> {
  if (to.kind === "payee") {
    // Exactly what they asked for arrives on their chain; AgentZero pays at most `maxIn` USDC for it.
    return {
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: AGENT_USDC,
      depositType: "INTENTS",
      destinationAsset: to.asset,
      amount: to.amountOut,
      refundTo: accountId,
      refundType: "INTENTS",
      recipient: to.payee.address,
      recipientType: "DESTINATION_CHAIN",
      deadline: quoteDeadline(nowMs, AGENT_QUOTE_MS),
      confidentiality: "basic",
    };
  }
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: AGENT_USDC,
    depositType: "INTENTS",
    destinationAsset: AGENT_USDC,
    amount,
    refundTo: accountId,
    refundType: "INTENTS",
    recipient: to.kind === "person" ? to.name : to.address,
    recipientType: to.kind === "person" ? "INTENTS" : "CONFIDENTIAL_INTENTS",
    deadline: quoteDeadline(nowMs, AGENT_QUOTE_MS),
    confidentiality: "basic",
  };
}

/** May AgentZero pay `amount` USDC into this quote? Only the quote asked for, as 1Click signed it. Null if yes. */
export function agentPrivateRefusal(q: QuoteFacts | null, accountId: string, amount: string, to: AgentPayee, nowMs: number): string | null {
  if (!q) return "NEAR Intents didn't confirm this price.";
  if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > nowMs)) return "That price has run out.";
  if (Date.parse(q.deadline) > nowMs + AGENT_QUOTE_MS + QUOTE_DEADLINE_STEP_MS + 60_000) return "Its price lasts longer than asked.";
  if (to.kind === "payee") return payeeRefusal(q, accountId, to);
  if (q.depositType !== "INTENTS" || q.swapType !== "EXACT_INPUT") return "It isn't the kind of price asked for.";
  // The privacy asked for, as 1Click signed it (security review L1): a quote without it isn't a private payment.
  if (q.confidentiality !== "basic") return "It isn't a private payment.";
  if (q.originAsset !== AGENT_USDC || q.destinationAsset !== AGENT_USDC || q.amountIn !== amount) return "The payment's terms don't match.";
  if (q.refundTo !== accountId || q.refundType !== "INTENTS") return "A refund must come back to your own Safe.";
  const wantTo = to.kind === "person" ? to.name : to.address;
  const wantType = to.kind === "person" ? "INTENTS" : "CONFIDENTIAL_INTENTS";
  if (q.recipient !== wantTo || q.recipientType !== wantType) return to.kind === "person" ? `It doesn't pay ${to.name}.` : "It doesn't pay into your NEAR wallet.";
  if (!UNITS.test(q.minAmountOut) || BigInt(q.minAmountOut) * 100n < BigInt(amount) * AGENT_LEAST_PCT) return "Its price is too far from what you pay.";
  return null;
}

/** A cross-chain payee's quote, field by field as 1Click signed it (the same checks as Spending's exact-out moves). */
function payeeRefusal(q: QuoteFacts, accountId: string, to: Extract<AgentPayee, { kind: "payee" }>): string | null {
  const name = PAYEE_CHAIN_NAME[to.payee.chain];
  if (q.depositType !== "INTENTS" || q.swapType !== "EXACT_OUTPUT") return "It isn't the kind of price we asked for.";
  if (q.originAsset !== AGENT_USDC || q.destinationAsset !== to.asset) return "The payment's terms don't match.";
  if (q.refundTo !== accountId || q.refundType !== "INTENTS") return "A refund must come back to your own Safe.";
  if (q.recipient !== to.payee.address || q.recipientType !== "DESTINATION_CHAIN") return `It doesn't pay that ${name} address.`;
  // Hidden only (D70, review M): a quote without 1Click's signed privacy is never paid by AgentZero.
  if (q.confidentiality !== "basic") return `It isn't a hidden payment on ${name}.`;
  // What arrives: exactly what was asked (1Click's exact-out promise, signed).
  const out = q.amountOut ?? q.minAmountOut;
  if (!UNITS.test(out) || BigInt(out) < BigInt(to.amountOut)) return `It pays less than asked on ${name}.`;
  // What it costs: never more USDC than the most AgentZero may pay for it.
  if (!UNITS.test(q.amountIn) || BigInt(q.amountIn) === 0n || BigInt(q.amountIn) > BigInt(to.maxIn)) return "It costs more than AgentZero may pay for it.";
  return null;
}

/**
 * AgentZero's private payment, made by the core: a real 1Click quote for exactly `amount` USDC to `to`, checked, then
 * the agent_pay its key may sign (into the quote's deposit address). `to` must already be checked by the caller against
 * the account's list (a person) or be Spending's own address.
 */
export async function agentPrivatePlan(
  quoter: OneClickQuoter,
  accountId: string,
  to: AgentPayee,
  amount: unknown,
  nowMs: number,
  quoteKey: string = ONE_CLICK_QUOTE_KEY,
): Promise<{ payout: unknown; to: string; amount: string; hidden?: boolean }> {
  if (typeof amount !== "string" || !UNITS.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("Say the amount, in USDC's smallest units."));
  let res: any;
  try {
    res = await quoter(agentPrivateRequest(accountId, amount, to, nowMs));
  } catch {
    throw new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
  }
  const at = res?.quote?.depositAddress;
  if (typeof at !== "string" || !/^[0-9a-f]{64}$/.test(at)) throw new ProblemError(securityProblems.requestNotAllowed("NEAR Intents gave no payment address."));
  // Audit T-1: believed only as 1Click signed it, a real (not dry) quote for that very deposit address.
  const signed = parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: res }, at, quoteKey, nowMs);
  const why = agentPrivateRefusal(signed, accountId, amount, to, nowMs);
  if (why) throw new ProblemError(securityProblems.requestNotAllowed(why));
  // A cross-chain payee's quote is exact out: AgentZero pays its amount in (checked against the most it may pay), and
  // whether it went hidden is the quote's own word (the receipt says which).
  if (to.kind === "payee") return { payout: { Ledger: { token_id: AGENT_USDC } }, to: at, amount: signed!.amountIn, hidden: signed!.confidentiality === "basic" };
  return { payout: { Ledger: { token_id: AGENT_USDC } }, to: at, amount };
}

/**
 * AgentZero's sandbox (AGENTZERO-WALLET.md L8): with its own wallet on, AgentZero pays from that wallet only, so the
 * account's agent_pay (a payment, a private payment or a top-up from the Safe's account, its key's daily cap) is refused
 * for it before anything is asked. A standing order and a convert are not AgentZero's payments. Off today.
 */
export const agentPayOff = (kind: unknown, wallet: boolean = AGENTZERO_WALLET): boolean => wallet && (kind === "pay" || kind === "pay-private" || kind === "top-up");
export const AGENT_PAY_OFF_LINE = "AgentZero pays only from its own wallet now. Nothing moved.";

/**
 * What AgentZero's key may sign for a "pay" or "pay-private" (the core's agentSpend, before any key is used):
 * - with real money a plain "pay" (a public send from the Safe) is refused (D70, D91; security review M1);
 * - the signer's own check (D89): only a name on the account's list, whatever the budget's any-address cap allows;
 * - "pay-private": shut until route A is proven (AGENT_PRIVATE_ROUTE, mainnet only); then the core's own quote.
 */
export async function agentPayPlan(
  p: { kind: unknown; payout: unknown; to: unknown; amount: unknown; chain?: unknown; coin?: unknown; usd?: unknown; amountOut?: unknown },
  d: { chain: Chain; accountId: string; quoter: OneClickQuoter; quoteKey?: string; route?: boolean; nowMs?: number; spending?: () => Promise<string | null>; crossChain?: boolean; vault?: { get(n: string): Promise<Uint8Array | null> }; price?: (chain: "sol" | "hood" | "bsc") => Promise<number | null>; wallet?: boolean },
): Promise<{ payout: unknown; to: unknown; amount: unknown; hidden?: boolean }> {
  // L8: AgentZero's own wallet on, agent_pay is off for it, before anything else (the core's agentSpend reaches here for
  // every pay, pay-private and top-up).
  if (agentPayOff(p.kind, d.wallet)) throw new ProblemError(securityProblems.requestNotAllowed(AGENT_PAY_OFF_LINE));
  // "Ask me above $X": a payment to someone over it isn't AgentZero's to make, before any quote (a top-up stays in the account).
  // An address on another chain is counted at the most it can cost (the rail's review, Medium: the quote may cost up to
  // its ceiling, so every cap counts that); a NEAR name pays its own amount, exactly as before.
  const elsewhere = p.chain !== undefined && p.chain !== "near" && typeof p.amount === "string" && UNITS.test(p.amount);
  if (p.kind !== "top-up" && d.vault) await askFirst(d.vault, p.payout, elsewhere ? payeeCeiling(p.amount as string) : p.amount);
  const mainnet = d.chain.network === "mainnet";
  const refuse = (why: string) => new ProblemError(securityProblems.requestNotAllowed(why));
  if (p.kind === "top-up") {
    // D89: keep money in Spending. The core asks 1Click itself for USDC from the Safe into Spending's private balance,
    // refund to the Safe; AgentZero's key pays only that quote's deposit address (never a name, never an address from
    // app code: whatever `to` the app sent is ignored). Shut with the private route.
    if (!(d.route ?? AGENT_PRIVATE_ROUTE) || !mainnet) throw refuse(AGENT_TOP_UP_OFF);
    if (typeof p.amount !== "string" || !/^\d{1,15}$/.test(p.amount) || Number(p.amount) / 1e6 < FLOAT_MIN_USD) throw refuse(`A top up under $${FLOAT_MIN_USD} would mostly go on fees. Nothing moved.`);
    const spending = d.spending ? await d.spending() : null;
    if (!spending) throw refuse("Your NEAR wallet isn't set up on this device yet. Nothing moved.");
    return agentPrivatePlan(d.quoter, d.accountId, { kind: "spending", address: spending }, p.amount, d.nowMs ?? Date.now(), d.quoteKey);
  }
  if (p.kind === "pay" && mainnet) throw refuse(AGENT_PRIVATE_OFF);
  // D111: an address on another chain. A NEAR name (no chain, or "near") pays exactly as before.
  if (p.chain !== undefined && p.chain !== "near") return payeePlan(p, d, refuse);
  const view = (await d.chain.view(d.accountId, "agent", {}, await d.chain.commonBlock()).catch(() => null)) as { budget?: { recipients?: unknown } } | null;
  const listed = Array.isArray(view?.budget?.recipients) ? (view!.budget!.recipients as unknown[]).filter((r): r is string => typeof r === "string") : [];
  if (typeof p.to !== "string" || !listed.includes(p.to)) throw refuse("AgentZero pays only the people on your list. Nothing was sent.");
  if (p.kind !== "pay-private") return { payout: p.payout, to: p.to, amount: p.amount };
  if (!(d.route ?? AGENT_PRIVATE_ROUTE) || !mainnet) throw refuse(AGENT_PRIVATE_OFF);
  return agentPrivatePlan(d.quoter, d.accountId, { kind: "person", name: p.to }, p.amount, d.nowMs ?? Date.now(), d.quoteKey);
}

/**
 * A payee on another chain (D111, G1): off until release 11's on-chain payee list (AGENT_CROSS_CHAIN); then only a payee
 * on that list, only privately routed, exactly `amountOut` (a seller's price) or `usd` worth of their chain's coin, for at
 * most `amount` USDC (the cap the caller passes). Every refusal names the chain.
 */
async function payeePlan(
  p: { kind: unknown; to: unknown; amount: unknown; chain?: unknown; coin?: unknown; usd?: unknown; amountOut?: unknown },
  d: Parameters<typeof agentPayPlan>[1],
  refuse: (why: string) => ProblemError,
): Promise<{ payout: unknown; to: string; amount: string; hidden?: boolean }> {
  const payee = readPayee(p.to, p.chain, p.coin);
  if ("refused" in payee) throw refuse(payee.refused);
  const name = PAYEE_CHAIN_NAME[payee.chain];
  if (!(d.crossChain ?? AGENT_CROSS_CHAIN)) throw refuse(`AgentZero can't pay a ${name} address yet. Nothing was sent.`);
  if (p.kind !== "pay-private") throw refuse(AGENT_PRIVATE_OFF);
  if (!(d.route ?? AGENT_PRIVATE_ROUTE) || d.chain.network !== "mainnet") throw refuse(AGENT_PRIVATE_OFF);
  if (typeof p.amount !== "string" || !UNITS.test(p.amount) || BigInt(p.amount) === 0n) throw refuse("Say the most AgentZero may pay, in USDC's smallest units.");
  // The account's own payee list (release 11), read on NEAR now: a payee not on it is never paid.
  const list = (await d.chain.view(d.accountId, "agent_payees", {}, await d.chain.commonBlock()).catch(() => null)) as unknown;
  const listed = Array.isArray(list) && list.some((x) => x && typeof x === "object" && (x as Payee).chain === payee.chain && (x as Payee).address === payee.address && ((x as Payee).coin ?? undefined) === payee.coin);
  if (!listed) throw refuse(`That ${name} address isn't on AgentZero's list. Nothing was sent.`);
  let asset: string, amountOut: string;
  if (typeof p.amountOut === "string" && UNITS.test(p.amountOut) && BigInt(p.amountOut) > 0n) {
    // A seller's exact price, in its own coin (x402, MPP): that coin must be the payee's.
    const own = payee.coin ?? (payee.chain === "near" || !CHAIN_COIN[payee.chain].open ? null : CHAIN_COIN[payee.chain].tokenId);
    if (!own) throw refuse(`AgentZero can't tell which coin to pay on ${name}. Nothing was sent.`);
    asset = own;
    amountOut = p.amountOut;
  } else {
    const a = payeeAsset(payee);
    const usd = Number(p.usd);
    if (!a || payee.chain === "near") throw refuse(`AgentZero can't pay that coin on ${name} yet. Nothing was sent.`);
    if (!(usd > 0) || !Number.isFinite(usd)) throw refuse("Say how many dollars, more than $0.");
    const price = d.price ? await d.price(payee.chain as "sol" | "hood" | "bsc").catch(() => null) : null;
    if (!price || !(price > 0) || !Number.isFinite(price)) throw refuse(`${name}'s price couldn't be read. Nothing was sent.`);
    asset = a.tokenId;
    amountOut = BigInt(Math.floor((usd / price) * 10 ** Math.min(a.decimals, 15))).toString() + "0".repeat(Math.max(0, a.decimals - 15));
  }
  // The most it may cost: the amount plus Spending's own room for a move (3 % and $0.50 of network fees); the chain's
  // daily cap still holds whatever this says.
  const maxIn = payeeCeiling(p.amount as string);
  return agentPrivatePlan(d.quoter, d.accountId, { kind: "payee", payee, asset, amountOut, maxIn }, p.amount, d.nowMs ?? Date.now(), d.quoteKey);
}

/** AgentZero's budget as the contract holds it (release 10's Budget JSON). */
export interface AgentBudget {
  coins?: { coin: string; per_day?: string; per_month?: string; convert_per_day?: string }[];
  recipients?: string[];
  ends_at_ns?: string;
  max_spends_per_day?: number;
}

/** A number as the contract would read it, or null when it isn't plain canonical digits ("+5", "007", 40 digits): the
 *  contract's parser may still take those, so anything non-canonical counts as loosening (second review, D103). */
const units = (v: unknown): bigint | null => (v === undefined || v === null ? 0n : typeof v === "string" && /^(0|[1-9]\d{0,38})$/.test(v) ? BigInt(v) : null);

/** Would `next` let AgentZero do more than `current`? (A new coin, a higher limit or cap, a new person, a later end, more
 *  payments one day.) With no current budget, anything is more. */
export function budgetLoosens(current: AgentBudget | null, next: AgentBudget): boolean {
  if (!current) return true;
  const more = (a: unknown, b: unknown) => {
    const x = units(a);
    const y = units(b);
    return x === null || y === null || x > y;
  };
  for (const c of next.coins ?? []) {
    const was = (current.coins ?? []).find((x) => x.coin === c.coin);
    if (!was) return true;
    if (more(c.per_day, was.per_day) || more(c.per_month, was.per_month) || more(c.convert_per_day, was.convert_per_day)) return true;
  }
  const had = new Set(current.recipients ?? []);
  if ((next.recipients ?? []).some((r) => !had.has(r))) return true;
  if (more(next.ends_at_ns, current.ends_at_ns)) return true;
  const n = next.max_spends_per_day;
  return !Number.isInteger(n ?? 0) || (n ?? 0) > (current.max_spends_per_day ?? 0);
}

/**
 * Cancel the waiting changes that would LOOSEN AgentZero, and nothing else (security review M4, QA's switch gate): turning
 * AgentZero on (AgentSet), a standing order (AgentAddOrder), a resume (AgentResume), and a budget that does more than
 * the one the account holds now (AgentSetBudget). A tightening in flight is left to land (on a modules account every
 * budget change waits, the stop's own included). Read from the contract's own waiting_requests and agent view; each
 * cancel is the core's own Cancel sheet; nothing of the person's (a payment, a protection change, a recovery, a key) is
 * ever reached.
 */
export async function agentCancelWaiting(
  chain: Chain,
  accountId: string,
  cancel: (id: string) => Promise<import("./signer.ts").TxOutcome>,
): Promise<{ cancelled: number; outcomes: import("./signer.ts").TxOutcome[] }> {
  const block = await chain.commonBlock();
  const [list, view] = await Promise.all([chain.view(accountId, "waiting_requests", {}, block), chain.view(accountId, "agent", {}, block).catch(() => null)]);
  const current = ((view as { budget?: AgentBudget } | null)?.budget ?? null) as AgentBudget | null;
  const loosening = ((Array.isArray(list) ? list : []) as { id?: unknown; change?: unknown }[]).filter((w) => {
    const c = w.change;
    if (c === "AgentResume") return true;
    if (!c || typeof c !== "object") return false;
    if ("AgentSet" in c || "AgentAddOrder" in c || "AgentResume" in c) return true;
    const b = (c as { AgentSetBudget?: { budget?: AgentBudget } }).AgentSetBudget?.budget;
    return !!b && budgetLoosens(current, b);
  });
  const outcomes = [];
  for (const w of loosening) outcomes.push(await cancel(String(w.id)));
  return { cancelled: outcomes.filter((o) => o.status === "done").length, outcomes };
}

/**
 * "Use AgentZero on a computer" (D100, D101), the phone's side: the core reads the computer's offer, shows its own sheet
 * with the check code, and only after the person's yes seals AgentZero's key seed (and the account's id) to the
 * computer's key and leaves the box in the relay's one-time mailbox. Nothing readable leaves the phone; the Safe's owner
 * key and the words are never part of it. `faceId`: the host's own Face ID check when it has one (required then).
 */
export async function agentPairComputer(d: {
  offer: unknown;
  seed: Uint8Array;
  accountId: string;
  approve: (words: import("./signer.ts").PlainWords) => Promise<boolean>;
  post: (mailbox: string, box: string) => Promise<boolean>;
  faceId?: (reason: string) => Promise<boolean>;
  /** AgentZero's its wallet one day on the account (the chain's hard cap), for the sheet's honest line (D104). */
  pocketUsd?: number;
}): Promise<{ status: "paired" | "declined"; words: string[] }> {
  const offer = readOffer(d.offer);
  if (!offer) throw new ProblemError(securityProblems.requestInvalid("That isn't a computer's AgentZero code. Copy it again from the computer."));
  // The words of the key this phone would seal to, on the core's own sheet, BEFORE anything is sealed (security review).
  const words = pairWords(offer.computerKey);
  const sheet: import("./signer.ts").PlainWords = {
    title: "Use AgentZero on a computer",
    lines: [
      `Your computer must show these words: ${words.join(" ")}.`,
      "If they don't match, say No. Someone else is asking.",
      // D104: the bounded loss, said plainly: it is the pocket-money promise.
      d.pocketUsd && d.pocketUsd > 0
        ? `The computer can spend from AgentZero's wallet, the same as AgentZero on this phone: up to $${Number.isInteger(d.pocketUsd) ? d.pocketUsd : d.pocketUsd.toFixed(2)} in any 24 hours, anywhere, until you tap Stop.`
        : "The computer can spend from AgentZero's wallet, the same as AgentZero on this phone, until you tap Stop.",
      "Your computer keeps its own day limit too. Your account's limit is the hard one.",
      "Your Safe's key and your words stay on this phone.",
      "Stop AgentZero here any time: its key stops everywhere at once.",
    ],
    warnings: [],
    effect: [],
  };
  if (!(await d.approve(sheet))) return { status: "declined", words };
  if (d.faceId && !(await d.faceId("Use AgentZero on a computer"))) return { status: "declined", words };
  const box = sealSeed(offer, d.seed, d.accountId);
  if (!(await d.post(offer.mailbox, box))) throw new ProblemError(securityProblems.partnerUnreachable("ZeroFee's server"));
  return { status: "paired", words };
}

/** D103's refusal on a host that can't prove the person is there (the web without a user-verifying passkey). */
export const PAIR_FROM_PHONE = "Pair a computer from the ZeroFee app on your phone.";
export const LOOSEN_FROM_PHONE = "Give AgentZero more from the ZeroFee app on your phone.";

/**
 * D103: on a host without a native Face ID sheet, a budget that loosens AgentZero (or turns it on) needs the host's user
 * check (a passkey with user verification); a tightening never does. No check on that host: refused by name.
 */
export async function agentLooseningNeedsUser(chain: Chain, accountId: string, budget: unknown, userVerified: ((reason: string) => Promise<boolean>) | null): Promise<void> {
  // "always": a standing order, a resume, or set's orders: each lets AgentZero do more (second review).
  if (budget !== "always") {
    const view = (await chain.view(accountId, "agent", {}, await chain.commonBlock()).catch(() => null)) as { budget?: AgentBudget } | null;
    if (!budget || typeof budget !== "object") return void (await requireUser(userVerified));
    if (!budgetLoosens(view?.budget ?? null, budget as AgentBudget)) return;
  }
  await requireUser(userVerified);
}

/** D103 alone: the person, freshly (the web's passkey with UV); no host check: refused. AgentZero's own wallet (a fill,
 *  Move all, a higher limit) asks only this: it is a plain NEAR account of its own, never the Safe's contract. */
export const agentUserCheck = (userVerified: ((reason: string) => Promise<boolean>) | null): Promise<void> => requireUser(userVerified);

async function requireUser(userVerified: ((reason: string) => Promise<boolean>) | null): Promise<void> {
  if (!userVerified || !(await userVerified("Give AgentZero more").catch(() => false))) throw new ProblemError(securityProblems.requestNotAllowed(LOOSEN_FROM_PHONE));
}

/** The core's side of pairing (demo-core hands over only what it holds): AgentZero's seed and the pinned relay. */
export async function agentPairFromCore(d: {
  offer: unknown;
  seed: Uint8Array | null;
  accountId: string;
  relay: string | null;
  approve: (words: import("./signer.ts").PlainWords) => Promise<boolean>;
  /** D103: "native" (the phone's sheet IS Face ID), the host's user check (the web's passkey with UV), or null: refused. */
  strong: "native" | ((reason: string) => Promise<boolean>) | null;
  pocketUsd?: number;
}): Promise<{ status: "paired" | "declined"; words: string[] }> {
  if (!d.strong) throw new ProblemError(securityProblems.requestNotAllowed(PAIR_FROM_PHONE));
  if (!d.seed || !d.relay) throw new ProblemError(securityProblems.requestNotAllowed("AgentZero isn't on this phone yet."));
  const relay = d.relay.replace(/\/$/, "");
  {
    return await agentPairComputer({
      offer: d.offer, seed: d.seed, accountId: d.accountId, approve: d.approve, ...(d.pocketUsd ? { pocketUsd: d.pocketUsd } : {}),
      // On the web the host's user check must pass, or it's refused by name (D103), never a quiet "declined".
      ...(d.strong === "native" ? {} : { faceId: async (r: string) => { if (await (d.strong as (x: string) => Promise<boolean>)(r).catch(() => false)) return true; throw new ProblemError(securityProblems.requestNotAllowed(PAIR_FROM_PHONE)); } }),
      post: (mailbox, box) => fetch(`${relay}/v0/pair/${mailbox}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ box }), signal: AbortSignal.timeout(15_000) }).then((r) => r.status === 201, () => false),
    });
  }
}

// ── "Ask me above $X" (FLOW-V5 §5 item 1) ────────────────────────────────────────────────────────────────────────────
// Kept on this device. Above it, AgentZero's key doesn't pay: the person pays it themselves, on their own sheet. $0 asks
// for every payment; none set: AgentZero pays within its daily limit (on the chain, the hard limit) without asking.
// Raising it (or turning it off) lets AgentZero do more: the core's own sheet, and on the web D103's user check.
const ASK_KEY = "agent-ask-above-usd";
export const ASK_FIRST_CODE = "security.agent.ask-first";

export async function readAskAbove(vault: { get(n: string): Promise<Uint8Array | null> }): Promise<number | null> {
  const raw = await vault.get(ASK_KEY);
  if (!raw) return null;
  const n = Number(new TextDecoder().decode(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0; // unreadable: ask for everything
}

export async function setAskAbove(
  usd: unknown,
  d: { vault: { get(n: string): Promise<Uint8Array | null>; put(n: string, b: Uint8Array): Promise<void>; delete(n: string): Promise<void> }; approve(w: { title: string; lines: string[]; warnings: never[]; effect: never[] }): Promise<boolean>; strong(): Promise<void> },
): Promise<{ askAboveUsd: number | null } | { declined: true }> {
  const want = usd === null ? null : Number(usd);
  if (want !== null && !(Number.isFinite(want) && want >= 0 && want <= 1000)) throw new ProblemError(securityProblems.requestInvalid("usd is $0 to $1,000, or null for never"));
  const now = await readAskAbove(d.vault);
  const loosens = now !== null && (want === null || want > now);
  if (loosens) {
    await d.strong();
    const lines = want === null ? ["AgentZero pays without asking you, up to its daily limit."] : [`AgentZero pays up to $${want} without asking you.`, "Above that, it asks you first."];
    if (!(await d.approve({ title: "Let AgentZero pay more without asking", lines, warnings: [], effect: [] }).catch(() => false))) return { declined: true };
  }
  if (want === null) await d.vault.delete(ASK_KEY);
  else await d.vault.put(ASK_KEY, new TextEncoder().encode(String(want)));
  return { askAboveUsd: want };
}

/** Throws the ask-first refusal when this payment is over the person's "ask me above" amount. USDC is priced 1:1; any
 *  other coin can't be priced here, so with an amount set it asks. */
export async function askFirst(vault: { get(n: string): Promise<Uint8Array | null> }, payout: unknown, amount: unknown): Promise<void> {
  const above = await readAskAbove(vault);
  if (above === null) return;
  const usdc = (payout as { Ledger?: { token_id?: string } } | null)?.Ledger?.token_id === AGENT_USDC.replace(/^nep141:/, "");
  const usd = usdc && typeof amount === "string" && UNITS.test(amount) ? Number(amount) / 1e6 : Number.POSITIVE_INFINITY;
  if (usd <= above) return;
  const line = above === 0 ? "AgentZero asks you first for every payment." : `It's over your $${above}. AgentZero asks you first.`;
  throw new ProblemError({ ...securityProblems.requestNotAllowed(line), code: ASK_FIRST_CODE });
}
