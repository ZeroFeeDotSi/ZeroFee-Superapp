// Send's To line (a Send test, 4 Nov): no raw text, a plain label (the Copywriter's words).
import { outsideShort } from "@zerofee/core/format";
/** Under To, the first payment to an address or name this person never paid or saved: a label, not a button. */
export const FIRST_PAYMENT = "First payment";
/** A long id short, in the core sheet's own form (format.ts outsideShort; the copy review's ruling, 5 Nov: 6+6 everywhere, the
 *  audit's look-alike rule): six at each end past any "0x" ("37764c…465822"); the whole one tap away. Spaces (groups of
 *  four) don't count. */
export function shortId(id: string): string {
  return outsideShort(id.replace(/\s+/g, ""));
}

/** A coin Send lists but can't send now: its one reason (D125: never a broken option), and Swap as its way on. */
/** The fee before the tap (QA, 5 Nov): the core's outside sheet's own words (subwallets.ts OUTSIDE_WORDS, a
 *  test holds them equal), spelled here so Send's chunk doesn't load the core. Over SEND_FEE_WARN the plain warning. */
export const SEND_FEE = {
  fees: (usd: string) => `Fees · about $${usd}`,
  high: (pct: string) => `${pct}% goes to fees. On a bigger send, fees are a smaller part.`,
} as const;
export const SEND_FEE_WARN = 0.05;
/** The fee line and its warning from 1Click's dry figures (what leaves, what they get); null: nothing known yet. */
export function feeLines(f: { inUsd: string; outUsd: string } | null): { fees: string; high: string | null } | null {
  const a = Number(f?.inUsd), b = Number(f?.outUsd);
  if (!f || !(a > 0) || !(b >= 0) || b > a) return null;
  const fee = a - b;
  return { fees: SEND_FEE.fees(fee.toFixed(2)), high: fee / a > SEND_FEE_WARN ? SEND_FEE.high(((fee / a) * 100).toFixed(1)) : null };
}

/** Directly under From, whenever the Safe coin's one figure is more than this Send can pay now (product decision, 5 Nov:
 *  one figure per Safe coin; the audit's filing: nobody types more than can leave). the copy review's words, figure first. `privateOnly`: the
 *  Safe's own route is shut (send-open.ts), so only Private's part goes. */
/** `symbol`: the coin this Send pays (test, MUST 3: "the $8.85 in Private" read as Private's figure, which was $13.86):
 *  the part of Private that can go is that coin's, said by its name. */
export const SEND_PART = (privateOnly: boolean, most: string, symbol = ""): string => (privateOnly ? `Only the ${most}${symbol ? ` of ${symbol}` : ""} in Private can go right now.` : `Up to ${most} can go in one send.`);

export const SEND_CANT = {
  /** Said over its Swap button only (the button says the way on: the Copywriter, 5 Nov). */
  swapFirst: (symbol: string) => `Private can't take ${symbol} yet.`,
  /** A site's own wallet (pump.fun, GMGN): its money goes home first, by the site's Move back (the Copywriter, 5 Nov). */
  siteWallet: "Sends go from your Safe, not from this wallet.",
  siteButton: "Move back",
  nearWallet: "Sending from your NEAR account opens after a real-money test.",
  bnb: "Sending on BNB Chain opens after a real-money test.",
  swapButton: (own: string) => `Swap to ${own}`,
  /** A Solana token's send (QA, 5 Nov): the rent of 1Click's new account for the coin, paid once, never back. */
  rent: (symbol: string, usd: string | null) => `Solana keeps about ${usd ? `${usd} of SOL` : "0.002 SOL"} to set up ${symbol}. You don't get it back.`,
};
