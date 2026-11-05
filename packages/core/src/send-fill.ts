// A Send's fill sheet (product decision, 5 Nov; QA's MUSTs 1 and 4): the Safe's move into Private and the payout it
// pays for, under ONE Face ID. Its own file, loaded only when a request carries the sendFill marker (dev-signer), never in
// Home's first load (speed budget). Every figure is the core's own: the Safe's from the signed bytes, the payout's from
// 1Click's signed quote that the core read when the pocket's payment was joined to this very move in.
import type { Block, Chain } from "./chain.ts";
import { formatAmount } from "./format.ts";
import { cleanMetadata, coin, fourPlacesText, isUnits, nep141Contract, type IntentsFacts, type QuoteFacts, type SendPayout } from "./intents.ts";
import { landsOn } from "./send-words.ts";
import { SEND_LEG_WORDS, fillStepUsd } from "./private-route.ts";

/** Dollars from a quote's figure ("39.6") in whole cents, rounded down (never says more arrives); null: none or not a figure. */
const centsOf = (usd: string | undefined): bigint | null => (typeof usd === "string" && /^\d{1,15}(\.\d+)?$/.test(usd) ? BigInt(Math.floor(Number(usd) * 100 + 1e-6)) : null);
const dollarsText = (c: bigint): string => `$${(c / 100n).toLocaleString("en-US")}.${String(c % 100n).padStart(2, "0")}`;

/** The payout fits this move in: the same coin, and no more than the move in promises to bring (send-words
 *  throughJoinRefusal's own rule), with real figures and a payee. */
export function sendPayoutFits(out: SendPayout, q: QuoteFacts): boolean {
  if (!isUnits(out.amountIn) || !isUnits(out.amountOut) || !isUnits(q.minAmountOut) || BigInt(out.amountIn) <= 0n || BigInt(out.amountOut) <= 0n) return false;
  if (typeof out.recipient !== "string" || !out.recipient) return false;
  return out.originAsset === q.destinationAsset && BigInt(out.amountIn) <= BigInt(q.minAmountOut);
}

/** The payout's coin, read as every sheet coin is (ft_metadata at the sheet's block), so "They get" names it. */
export async function sendPayoutCoin(facts: IntentsFacts, out: SendPayout, chain: Chain, block: Block): Promise<void> {
  const contract = nep141Contract(out.destinationAsset);
  if (!contract || facts.tokens.has(contract)) return;
  const info = cleanMetadata(await chain.view(contract, "ft_metadata", {}, block).catch(() => null));
  if (info) facts.tokens.set(contract, info);
}

/** The payout lands as a coin the core names with its decimals (the audit's ruling, 5 Nov): a price alone isn't enough. False:
 *  the fill is refused before its sheet (dev-signer: securityProblems.sendCoinUnknown), never "an amount of an unnamed
 *  coin" nor a dollars-only "They get". */
export function sendPayoutNamed(facts: IntentsFacts, out: SendPayout): boolean {
  const c = coin(out.destinationAsset, facts);
  return !!c && typeof c.symbol === "string" && c.symbol.length > 0 && Number.isInteger(c.decimals) && c.decimals >= 0;
}

/**
 * The block (the UI lead's rulings, 5 Nov): "Your Safe sends · $Y" (the move in's amountIn, the bytes' own), "Stays in
 * Private · $Z" (left out at 0); `gets` is $T (the payout's amountIn, what leaves Private to them), said in brackets on
 * the sheet's one "They get" line after the signed coin figure (intents.ts: "They get · 1.2345 SOL ($40.00)", the audit's
 * MUST 4); Y = Z + T always, in whole cents. `to`: whom it pays, the full address open, never folded (D37 and the audit's
 * MUST). Null: a coin the core can't name.
 */

export function sendFillWords(q: QuoteFacts, s: SendPayout, facts: IntentsFacts): { title: string; lines: string[]; gets: string; to: string; seen: string } | null {
  if (!isUnits(q.amountIn) || s.originAsset !== q.destinationAsset) return null;
  const c = coin(q.originAsset, facts);
  if (!c) return null;
  const dollar = /^USD[CT]$/i.test(c.symbol) && c.decimals >= 2;
  const unit = (u: bigint) => (dollar ? u / 10n ** BigInt(c.decimals - 2) : u);
  const say = (v: bigint): string => (dollar ? `$${(v / 100n).toLocaleString("en-US")}.${String(v % 100n).padStart(2, "0")}` : fourPlacesText(`${formatAmount(v, c.decimals)} ${c.symbol}`));
  const safeRaw = BigInt(q.amountIn), pays = BigInt(s.amountIn) > safeRaw ? safeRaw : BigInt(s.amountIn);
  const together = unit(pays), stays = unit(safeRaw) - together;
  // QA's Sim walk (5 Nov): what the payee's coin is worth (the signed amountOutUsd), and the network fees the payout
  // pays (T less that, in whole cents; T in dollars: the dollar coin's own figure, else the quote's amountInUsd), named
  const outC = centsOf(s.amountOutUsd), tC = dollar ? together : centsOf(s.amountInUsd);
  const feesC = outC !== null && tC !== null && tC > outC ? tC - outC : 0n;
  // every outside sheet (QA's D37 condition, 5 Nov; subwallets.ts OUTSIDE_WORDS): the FULL address first,
  // unfolded, then where the payee's side lands in the copy review's words ("Public on Solana.", or "Private." into a private balance)
  const net = s.recipientType === "CONFIDENTIAL_INTENTS" ? null : landsOn(s.destinationAsset, s.recipientType);
  return {
    title: `Send ${say(together)} from your Safe`,
    lines: [`${SEND_LEG_WORDS.sends} · ${say(together + stays)}`, ...(stays > 0n ? [`${SEND_LEG_WORDS.stays} · ${say(stays)}`] : []), ...(feesC > 0n ? [SEND_LEG_WORDS.fees(dollarsText(feesC))] : [])],
    gets: outC !== null ? dollarsText(outC) : "",
    to: `To ${s.recipient}`,
    seen: s.recipientType === "CONFIDENTIAL_INTENTS" ? "Private." : net ? `Public on ${net}.` : "Anyone can see it land.",
  };
}

/** The least a Send from the Safe takes, in dollars (an outside move is sized for no less: add-outside ADD_LEAST_USD). */
export { ADD_LEAST_USD as SEND_FLOOR_USD } from "./add-outside.ts";

const USDC_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** The day's Face ID limit and what one Send can still take today, in dollars, from the contract's own band state:
 *  `protection()` (bands, each coin's limit at today's price) and `spent_today()` (each coin's 24-hour total). One budget
 *  across a band's coins (lib.rs level_for_moves): the used share is each coin's total over its own limit, added up; the
 *  dollars are USDC's limit (a dollar coin). What one Send can take is the most whose fill (fillStepUsd, the whole step
 *  that goes into Private) still fits what is left. Null: no Face ID band in dollars to read (the generic refusal). */
export function sendRoom(bands: unknown, spent: unknown): { limitUsd: number; leftUsd: number } | null {
  if (!Array.isArray(bands)) return null;
  const first = bands[0] as { up_to?: unknown; level?: unknown } | undefined;
  if (!first || first.level !== "FaceId" || !Array.isArray(first.up_to)) return null;
  const limits = (first.up_to as unknown[]).flatMap((x) => (Array.isArray(x) && typeof x[0] === "string" && /^\d{1,40}$/.test(String(x[1])) ? [[x[0], BigInt(String(x[1]))] as const] : []));
  const usdc = limits.find(([c]) => c === USDC_ID)?.[1];
  if (!usdc || usdc <= 0n) return null;
  const totals = new Map((Array.isArray(spent) ? spent : []).flatMap((x) => (Array.isArray(x) && typeof x[0] === "string" && /^\d{1,40}$/.test(String(x[1])) ? [[x[0] as string, BigInt(String(x[1]))] as const] : [])));
  const PPM = 1_000_000n;
  let used = 0n;
  for (const [c, limit] of limits) if (limit > 0n) used += ((totals.get(c) ?? 0n) * PPM) / limit;
  const limitUsd = Number(usdc) / 1e6;
  const room = used >= PPM ? 0 : (limitUsd * Number(PPM - used)) / 1e6;
  // the most a Send can ask whose fill fits the room (cents, by halving: fillStepUsd only grows with the ask)
  let lo = 0, hi = Math.floor(room * 100);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fillStepUsd(mid / 100) <= room + 1e-9) lo = mid; else hi = mid - 1;
  }
  return { limitUsd, leftUsd: lo / 100 };
}
