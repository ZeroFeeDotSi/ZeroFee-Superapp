// AgentZero's swap inside the Safe (D89): the core's own 1Click quote into this account's own NEAR Intents balance, and
// the checks a convert's quote must pass. Moved out of account-modules.ts (product decision, 3 Nov: nothing AgentZero adds sits in
// Home's first load); loaded only with AgentZero's door (agent-door.ts).
import { parseQuote, type OneClickQuoter, type QuoteFacts } from "./intents.ts";
import { ONE_CLICK_QUOTE_KEY } from "./quote-signature.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { quoteDeadline } from "./quote-deadline.ts";

/**
 * May Agent convert `amount` of `tokenId` by paying `to`? Only into a live 1Click quote that pays this account's own
 * NEAR Intents balance and refunds there too: a prompt-injected agent can't "convert" to someone else. Null if yes.
 */
export function convertQuoteRefusal(quote: QuoteFacts | null, accountId: string, tokenId: string, amount: string, nowMs: number): string | null {
  if (!quote) return "NEAR Intents doesn't know that payment address.";
  if (quote.status !== "PENDING_DEPOSIT" || !(Date.parse(quote.deadline) > nowMs)) return "That price has run out.";
  if (quote.originAsset !== tokenId || quote.amountIn !== amount) return "The swap's terms don't match this payment.";
  if (quote.recipient !== accountId || quote.recipientType !== "INTENTS") return "AgentZero can swap only into your own Safe.";
  if (quote.refundTo !== accountId || quote.refundType !== "INTENTS") return "A swap's refund must come back to your own Safe.";
  return null;
}

const UNITS = /^\d{1,39}$/;
const TOKEN = /^nep(141|245):[\w.:-]{2,128}$/;

/** The 1Click request for Agent's swap: from and into this account's own NEAR Intents balance, refunds there too. */
function convertRequest(accountId: string, fromToken: string, toToken: string, amount: string, dry: boolean, nowMs: number): Record<string, unknown> {
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: fromToken,
    depositType: "INTENTS",
    destinationAsset: toToken,
    amount,
    refundTo: accountId,
    refundType: "INTENTS",
    recipient: accountId,
    recipientType: "INTENTS",
    deadline: quoteDeadline(nowMs, 10 * 60_000),
  };
}

const quoteFacts = (res: any): QuoteFacts => {
  const req = res?.quoteRequest ?? {};
  const q = res?.quote ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    status: "PENDING_DEPOSIT",
    originAsset: s(req.originAsset),
    amountIn: s(q.amountIn),
    refundTo: s(req.refundTo),
    refundType: s(req.refundType),
    destinationAsset: s(req.destinationAsset),
    minAmountOut: s(q.minAmountOut),
    recipient: s(req.recipient),
    recipientType: s(req.recipientType),
    deadline: s(q.deadline),
  };
};

/** A price for Agent's swap, without a deposit address: nothing can pay it. */
export async function agentConvertPrice(quoter: OneClickQuoter, accountId: string, fromToken: unknown, toToken: unknown, amount: unknown, nowMs: number): Promise<{ amountOut: string; minAmountOut: string }> {
  if (typeof fromToken !== "string" || !TOKEN.test(fromToken) || typeof toToken !== "string" || !TOKEN.test(toToken) || typeof amount !== "string" || !UNITS.test(amount)) {
    throw new ProblemError(securityProblems.requestInvalid("Say the coin to swap from, the coin to swap into, and the amount."));
  }
  const res = await quoter(convertRequest(accountId, fromToken, toToken, amount, true, nowMs));
  const out = res?.quote?.amountOut;
  const min = res?.quote?.minAmountOut;
  if (typeof out !== "string" || !UNITS.test(out) || typeof min !== "string" || !UNITS.test(min)) throw new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
  return { amountOut: out, minAmountOut: min };
}

/**
 * Agent's swap, made by the core itself: a real 1Click quote into this account's own NEAR Intents balance, checked
 * field by field, then the payment Agent's key may sign (the deposit address never passes through app code).
 */
export async function agentConvertPlan(
  quoter: OneClickQuoter,
  accountId: string,
  fromToken: unknown,
  toToken: unknown,
  amount: unknown,
  minOut: unknown,
  nowMs: number,
  quoteKey: string = ONE_CLICK_QUOTE_KEY,
): Promise<{ payout: unknown; to: string; amount: string }> {
  if (typeof fromToken !== "string" || !TOKEN.test(fromToken) || typeof toToken !== "string" || !TOKEN.test(toToken) || typeof amount !== "string" || !UNITS.test(amount)) {
    throw new ProblemError(securityProblems.requestInvalid("Say the coin to swap from, the coin to swap into, and the amount."));
  }
  if (minOut !== undefined && (typeof minOut !== "string" || !UNITS.test(minOut))) throw new ProblemError(securityProblems.requestInvalid("The least amount back isn't a whole number ZeroFee can read."));
  const res = await quoter(convertRequest(accountId, fromToken, toToken, amount, false, nowMs));
  const to = res?.quote?.depositAddress;
  // Audit T-1: believed only as 1Click signed it, a real (not dry) quote for that very deposit address.
  const signed = typeof to === "string" && to ? parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: res }, to, quoteKey, nowMs) : null;
  if (typeof to === "string" && to && !signed) throw new ProblemError(securityProblems.requestNotAllowed("NEAR Intents didn't confirm this price."));
  const facts = signed ?? quoteFacts(res);
  const why =
    typeof to !== "string" || !to
      ? "NEAR Intents gave no payment address."
      : (convertQuoteRefusal(facts, accountId, fromToken, amount, nowMs) ??
        (facts.destinationAsset !== toToken ? "The swap's terms don't match this payment." : null) ??
        (minOut !== undefined && !(UNITS.test(facts.minAmountOut) && BigInt(facts.minAmountOut) >= BigInt(minOut as string)) ? "The price moved below the least you'd accept." : null));
  if (why) throw new ProblemError(securityProblems.requestNotAllowed(why));
  return { payout: { Ledger: { token_id: fromToken } }, to: to as string, amount };
}
