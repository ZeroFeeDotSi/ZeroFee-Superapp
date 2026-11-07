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
  await sendPayCheck(c, t, usd, inDeposit);
  if (inDeposit !== undefined) await c.markPaid(inDeposit, SEND_GONE);
  return { signedData: await c.sign() };
}

const SEND_GONE = "This send's move into your private balance wasn't priced here, or its price ran out. Nothing moved.";

/** Every check sendPay makes before it signs (the one Face ID's pair, the audit's c1, 6 Nov: made before the sheet, nothing
 *  signed, nothing marked paid). */
export async function sendPayCheck(c: Omit<SendPayCore, "sign" | "markPaid">, t: { tokenId: string; amount: string }, usd: string, inDeposit?: string): Promise<void> {
  const now = Date.now();
  if (inDeposit !== undefined) {
    const kept = await c.keptThrough(inDeposit, now);
    if (!kept) throw c.refused(SEND_GONE);
    const q1 = await c.readQuote(inDeposit, kept.tag);
    const refusal = throughJoinRefusal(q1, c.pocket, t, now);
    if (refusal) throw c.refused(refusal);
  }
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd)) throw c.refused("The swap service gave this payment no price, so it can't go. Nothing moved.");
}

/** Leg 2 of a Send from the Safe, prepared and held for the Safe's one sheet (the audit's c1/R1, 6 Nov): in core memory only,
 *  released once, after the chip's signatures of leg 1 check, and deleted on any end. `hash`: sha256 of its payload. */
export interface HeldPair { inDeposit: string; hash: string; atMs: number; release: () => Promise<unknown> }
/** A held pair is good for this long from its making (its quote's own time is shorter); past it, dropped unsigned. */
export const PAIR_KEEP_MS = 10 * 60_000;
/** Which pair, if any, a Safe signature may release (a table): the one held for the address leg 1 pays, in time. */
export function pairFor(pairs: ReadonlyMap<string, HeldPair>, paid: readonly string[], nowMs: number): HeldPair | null {
  const hits = paid.map((d) => pairs.get(d)).filter((p): p is HeldPair => !!p && nowMs - p.atMs <= PAIR_KEEP_MS);
  return hits.length === 1 ? hits[0]! : null;
}

/** Who may ask a pair (the audit's c4, 6 Nov): only Wallet's own Send from the Safe, as the core stamps the app; never AgentZero,
 *  a site, another app or the relay, whatever they send. */
export const pairAsked = (p: { pair?: unknown; app?: unknown }): boolean => p.pair === true && p.app === "wallet";

/** Leg 2 of a Send from the Safe once signed (the audit's MUST, 6 Nov): kept in the core's sealed vault, by leg 1's address,
 *  BEFORE leg 1 is sent, and deleted when its job ends. Never in the page's storage. */
export interface KeptPair { outDeposit: string; outTag?: string; inTag?: string; leg2In: string; signed: unknown; atMs: number; untilMs: number; /** a Move's one fill (the audit's ruling, 7 Nov): every leg joined to it, the first one's fields above too */ legs?: KeptLeg[] }
/** One leg 2 kept under a fill's address. */
export interface KeptLeg { outDeposit: string; outTag?: string; leg2In: string; signed: unknown; /** its job ended: still counted against what landed, never handed again */ ended?: true }
/** A kept record's legs: its `legs`, or the one leg a Send's (or an older build's) record holds. */
export const keptLegs = (k: KeptPair): KeptLeg[] => (Array.isArray(k.legs) && k.legs.length ? k.legs : [{ outDeposit: k.outDeposit, ...(k.outTag ? { outTag: k.outTag } : {}), leg2In: k.leg2In, signed: k.signed }]);
/** How long a kept leg 2 can still run: its own signed deadline and an hour, never past 3 days; unreadable, an hour. */
export function keptPairUntil(payload: { message: string }, nowMs: number): number {
  let at = NaN;
  try { at = Date.parse(JSON.parse(payload.message)?.deadline); } catch { /* unreadable */ }
  return Number.isFinite(at) ? Math.min(at + 60 * 60_000, nowMs + 3 * 86_400_000) : nowMs + 60 * 60_000;
}
/** The follower's rule, the core's own (a table: one-faceid-keep.test.ts): leg 2 goes to 1Click only when leg 1's own
 *  status, read with its tag, says SUCCESS with at least leg 2's amount landed in Private. */
export function leg1Landed(s: { status?: unknown; swapDetails?: { amountOut?: unknown } } | null | undefined, leg2In: string): boolean {
  const landed = s?.swapDetails?.amountOut;
  return s?.status === "SUCCESS" && typeof landed === "string" && /^\d{1,40}$/.test(landed) && /^\d{1,40}$/.test(leg2In) && BigInt(landed) >= BigInt(leg2In);
}
