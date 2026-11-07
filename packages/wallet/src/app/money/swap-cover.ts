// T-F (the UI reviewer's walk, 6 Nov, B-9/B-10): Home's Swap of the Safe's NEAR said "If Private is short, your Safe
// covers the rest" before the tap, then refused "Private has $8.86, and this needs $25.00" after it. The promise and the
// result now come from one rule, the core's own: Spending picks the Safe coin that pays (spending.ts withPrivate +
// pickSafeCoin, Private's share counted on it), Private pays its share first, and the Safe fills the rest into Private
// (wallet safe-send.ts fillUnits, any priced coin) when the fill is open. The real core takes that fill from the Safe's
// NEAR Intents balance (one mt_transfer, the same as USDC: real-core-paths.test.ts "ENTRY 8, NEAR"), and from NEAR on the
// account (wrapped on wrap.near, the Safe's own storage step allowed by the audit's ruling, 6 Nov: real-core-paths "T-F, fixed"),
// so both are a cover. Pure, so every case is a table test.
import type { Problem } from "@zerofee/core/problem";
import { isSwapCoin, pickSafeCoin, withPrivate, type SafeCoin, type SwapCoin } from "@zerofee/core/spending";

const WNEAR = "nep141:wrap.near";

/** `plain`: Private pays it all (or another rule decides: the cap, the most, a coin that can't cover). `cover`: Private
 *  is short and the Safe fills the rest. `refuse`: Private is short and the fill is closed; `privateUsd` is what
 *  Private holds of the coin. */
export type SwapCover = { kind: "plain" } | { kind: "cover" } | { kind: "refuse"; privateUsd: number };

const usdOf = (r: SafeCoin): number => {
  const v = Number(r.usd);
  return Number.isFinite(v) ? v : 0;
};
/** Private's own share of the coin a swap pays with, in dollars (its wNEAR for NEAR). */
export function privateShare(coin: SwapCoin, pocket: readonly SafeCoin[]): number {
  return pocket.filter((r) => r.listed !== false && (coin === "NEAR" ? r.tokenId === WNEAR : isSwapCoin(r, coin))).reduce((n, r) => n + usdOf(r), 0);
}

/**
 * Whether the Safe covers a Swap of `usd` of `coin` that Private is short of. `safe`: the Safe's rows (ledger.balances);
 * `pocket`: Private's (ledger.private); `fillOpen`: the Safe → Private fill (safe-fill-open.ts). Null while either is unread.
 */
export function swapCover(o: { coin: SwapCoin; usd: number; safe: readonly SafeCoin[] | null; pocket: readonly SafeCoin[] | null; fillOpen: boolean }): SwapCover | null {
  if (!o.safe || !o.pocket || !(o.usd > 0)) return null;
  const priv = Math.floor(privateShare(o.coin, o.pocket) * 100 + 1e-6) / 100;
  if (priv + 0.004 >= o.usd) return { kind: "plain" };
  if (!o.fillOpen) return { kind: "refuse", privateUsd: priv };
  // the coin Spending will pay with, by its own rule (spending.ts topUp: withPrivate, isSwapCoin, pickSafeCoin)
  const pick = pickSafeCoin(withPrivate(o.safe as SafeCoin[], o.pocket as SafeCoin[]).filter((c) => isSwapCoin(c, o.coin)), o.usd);
  if (!pick || pick.coversUsd + 0.004 < o.usd) return { kind: "plain" };
  return { kind: "cover" };
}

/** The words (the UI reviewer's, 6 Nov, B-9). */
export const COVER_WORDS = {
  /** the sub-line slot while the Swap can't go past Private's share; the button is off */
  short: (usd: string) => `Private holds ${usd}. Swap up to ${usd}, or top up Private.`,
  /** the receipt's screen when Private turns out short after the tap (refused before anything is signed) */
  title: "Not enough in Private.",
  body: "Your money is safe. Nothing moved.",
  less: "Swap less",
} as const;

/** "$8.86" (two decimals, thousands commas). */
const dollars = (usd: number): string => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The sub-line slot's words for a refusal before the tap, or null. */
export const coverLine = (c: SwapCover | null): string | null => (c?.kind === "refuse" ? COVER_WORDS.short(dollars(c.privateUsd)) : null);

/** Private short, said after the tap on Swap's sheet (the ledger's privateShort, refused before anything is kept or
 *  signed): the reviewer's headline, body and one lit "Swap less". Any other Problem as it is. */
export function swapRefusal(p: Problem): Problem {
  if (p.code !== "ledger.private.short") return p;
  return { code: p.code, whatHappened: COVER_WORDS.title, money: { state: "not-involved" }, more: COVER_WORDS.body, next: { kind: "nothing", label: COVER_WORDS.less } };
}
