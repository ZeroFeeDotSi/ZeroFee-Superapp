// Home's Send (the Home plan §1.3, E3, E4; D128): the join check of a Safe's Send and the pocket's payment for it, in their
// own file so they load with the first Send, never in Home's first load (speed budget). D143 (approval-policy.ts): the
// pocket is a hot key, so its payment has no sheet of its own; the Safe's own sheet (Face ID) is the one for leg 1.
// Nothing here reads the network.
import { FEES_KEPT } from "./zero-fee.ts";
import type { parseQuote } from "./intents.ts";

type Quote = NonNullable<ReturnType<typeof parseQuote>>;
const CHAIN_WORDS: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };

/** The network a 1Click payout lands on, for a sheet: NEAR for a NEAR account's balance or a NEAR coin; null if unknown. */
export function landsOn(assetId: string, recipientType?: string): string | null {
  if (recipientType === "INTENTS") return "NEAR";
  if (assetId.startsWith("nep245:v2_1.omni.hot.tg:56_")) return "BNB Chain";
  const m = /^nep141:([a-z]+)(?:-[a-z0-9]+)?\.omft\.near$/.exec(assetId);
  if (m) return CHAIN_WORDS[m[1]!] ?? null;
  return /^nep141:[a-z0-9_.-]+$/.test(assetId) ? "NEAR" : null;
}
/** The outside-send sheet's words (QA's ruling, 5 Nov; the Copywriter's). */
export const OUTSIDE_WORDS = {
  title: (from: string) => `Send from your ${from}`,
  to: (address: string) => `To ${address}`,
  get: (usd: string) => `They get about $${usd}`,
  fees: (usd: string) => `Fees · about $${usd}`,
  kept: FEES_KEPT,
  high: (pct: string) => `${pct}% goes to fees. On a bigger send, fees are a smaller part.`,
  declined: (from: string) => `You said no. Nothing left your ${from}.`,
  /** What a send out doesn't hide (privacy audit, 4 Nov; QA's filing, 5 Nov): the payee's side is public, said
   *  by its network (the copy review's ruling, 5 Nov: "Public on Ethereum."); a network not known, the plain form. */
  seen: (network?: string | null) => (network === PRIVATE_LANDS ? "Private." : network ? `Public on ${network}.` : "Anyone can see it land."),
} as const;
/** A payee paid into their private balance (1Click's CONFIDENTIAL_INTENTS): its line is "Private." (the copy review's ruling, 5 Nov),
 *  never "Public on NEAR.". */
export const PRIVATE_LANDS = "private";
/** A coin's own name that already says its network (D124: "ETH (RH)" is ETH on Robinhood Chain). */
const NAMED_ON: Record<string, RegExp> = { "Robinhood Chain": /\(RH\)$/ };
/** " on Ethereum" after a payee, once: never when the coin's words already name that network ("ETH on Base … on Base",
 *  "ETH (RH) … on Robinhood Chain"). */
export const onNetwork = (coinWords: string, assetId: string, recipientType?: string): string => {
  const net = landsOn(assetId, recipientType);
  return net && !coinWords.endsWith(` on ${net}`) && !NAMED_ON[net]?.test(coinWords) ? ` on ${net}` : "";
};

/**
 * A Send's leg 1 into the pocket, as 1Click signed it, fit to be joined: still waiting, in date, the same coin in and
 * out, paid on its own chain, exact input, to the pocket and refunded to it privately, no memo. Then the join: leg 2
 * pays only what leg 1 promises to bring, in that same coin. Null: fit; else why not.
 */
// leg 1 paid out of the Safe on NEAR (ORIGIN_CHAIN: ft_withdraw or the coin's own transfer) or inside intents.near
// (INTENTS: Train 19's one bridge leg, one mt_transfer; checkIntents holds the bytes to it)
export function throughJoinRefusal(q1: Quote | null, pocket: string, paid: { tokenId: string; amount: string }, nowMs: number): string | null {
  const fit = q1 && q1.status === "PENDING_DEPOSIT" && Date.parse(q1.deadline) > nowMs && q1.originAsset === q1.destinationAsset && (q1.depositType === "ORIGIN_CHAIN" || q1.depositType === "INTENTS") && q1.swapType === "EXACT_INPUT" &&
    q1.recipient === pocket && q1.recipientType === "CONFIDENTIAL_INTENTS" && q1.refundTo === pocket && q1.refundType === "CONFIDENTIAL_INTENTS" && !q1.depositMemo && /^\d{1,30}$/.test(q1.amountIn) && /^\d{1,30}$/.test(q1.minAmountOut);
  if (!fit) return "The price for the move into your private balance isn't the one asked for. Nothing moved.";
  if (paid.tokenId !== q1!.destinationAsset || BigInt(paid.amount) > BigInt(q1!.minAmountOut)) return "The move into your private balance may bring less than the payment needs. Nothing moved.";
  return null;
}

/** What subwallets.ts hands sendPay: its own reads of the kept moves in and of 1Click's signed quotes, and its key. */
export interface SendPayCore {
  pocket: string;
  keptThrough: (inDeposit: string, nowMs: number) => Promise<{ tag?: string } | null>;
  readQuote: (depositAddress: string, tag?: string) => Promise<Quote | null>;
  markPaid: (inDeposit: string, gone: string) => Promise<void>;
  sign: () => Promise<unknown>;
  refused: (why: string) => Error;
}

/**
 * privatePay for Home's Send (D128: no pot cap; a price still a must): the pocket's own share, or leg 2 of a Send from the
 * Safe (E4, `inDeposit`: joined to its leg 1, a kept unpaid `through` NEAR address read back as 1Click signed it, which is
 * marked paid before it is signed so no second payment joins it). No sheet (D143): Wallet's Hold is the act.
 */
export async function sendPay(c: SendPayCore, t: { tokenId: string; amount: string }, usd: string, inDeposit?: string): Promise<{ signedData: unknown }> {
  const now = Date.now();
  const gone = "This send's move into your private balance wasn't priced here, or its price ran out. Nothing moved.";
  if (inDeposit !== undefined) {
    const kept = await c.keptThrough(inDeposit, now);
    if (!kept) throw c.refused(gone);
    const q1 = await c.readQuote(inDeposit, kept.tag);
    const refusal = throughJoinRefusal(q1, c.pocket, t, now);
    if (refusal) throw c.refused(refusal);
  }
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd)) throw c.refused("The swap service gave this payment no price, so it can't go. Nothing moved.");
  if (inDeposit !== undefined) await c.markPaid(inDeposit, gone);
  return { signedData: await c.sign() };
}
