// Social trading's Take out (ST13): which of a site's wallets one tap sweeps home, and which it leaves (said, never
// silent). Pure, so node tests it; loaded with the hub only, never in Home's first load (speed budget).
import type { HubRow, SiteChain } from "./hub-state.ts";

/** "0.0012 ETH" → is anything there (as hub-state reads an unpriced coin). */
const holdsSome = (h: string | undefined): boolean => !!h && /[1-9]/.test(h.split(" ")[0] ?? "");

/**
 * ST13: the networks Take out sweeps a site's wallet home from, through Spending (the core's site move-back: Solana; BNB
 * is a leg the core names its own refusal for until BNB Chain opens, D13). Base and Ethereum: Spending never carries
 * them, so their money stays and the wallet sheet says so.
 */
export const TAKES_OUT: readonly SiteChain[] = ["sol", "bsc"];
/** Under this a leg would mostly go on fees (the core's floor, as the money sheet's SITE_MIN_USD). */
const LEG_MIN_USD = 2;
/** The site's funded wallets beside the Solana one that one Take out also sweeps home (their ids from the core's list). */
export function takeOutAlso(r: HubRow): string[] {
  return (r.wallets ?? []).filter((w) => w.network !== "sol" && (TAKES_OUT as readonly string[]).includes(w.network) && w.usd !== null && w.usd >= LEG_MIN_USD).map((w) => w.id);
}
/** The networks Take out sweeps from whose wallet holds money but under $2 (a leg would mostly go on fees): said, never
 *  left without a word (review L5). Solana's own is the sheet's "Under $2" line. */
export function tooSmall(r: HubRow): SiteChain[] {
  return (r.wallets ?? []).filter((w) => w.network !== "sol" && (TAKES_OUT as readonly string[]).includes(w.network) && w.usd !== null && w.usd >= 0.01 && w.usd < LEG_MIN_USD).map((w) => w.network as SiteChain);
}
/** The networks of a site's funded wallets Take out leaves as they are (ZeroFee doesn't carry them). */
export function stays(r: HubRow): SiteChain[] {
  return (r.wallets ?? []).filter((w) => !(TAKES_OUT as readonly string[]).includes(w.network) && (w.usd !== null ? w.usd >= 0.01 : holdsSome(w.holds))).map((w) => w.network as SiteChain);
}

