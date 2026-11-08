// D10 (audit 13, 8 Nov): Add to Private's coin row said a bare "1,247.12" for USDC while Home said 1,382.22 USDC. Add moves
// only the one place picked (the USDC on NEAR), so the row now says what its figure is ("1,247.12 can go"), and the line
// under it says the rest of Home's figure once, and where it is ("The other 135.10 USDC is in Private and on Solana.").
// The two add up to Home's one figure for the coin (format.ts safeHeld, over the Safe's rows and Private's).
import { amountOf, andList, chainName, safeHeld } from "../format.ts";
import type { Balance, Chain } from "../../types.ts";

/** The row's figure, labelled: what this place can move now. */
export const canGoLabel = (from: Pick<Balance, "amount" | "symbol">): string => `${amountOf(from.amount, from.symbol)} can go`;

const placeWords = (b: Pick<Balance, "held" | "chain">, chains: Chain[]): string =>
  b.held === "private" ? "in Private" : b.held === "account" ? "on your account" : `on ${chainName(chains, b.chain)}`;

const sameRow = (a: Balance, b: Balance) => a.tokenId === b.tokenId && a.held === b.held && a.chain === b.chain;

/**
 * What Home counts of this coin beyond the place picked, said once with where it is; null when the place is all of it.
 * `rows`: the Safe's rows; `pocket`: Private's rows (counted under the Safe on Home).
 */
export function otherPartLine(from: Balance, rows: readonly Balance[], pocket: readonly Balance[], chains: Chain[]): string | null {
  const all = [...rows, ...pocket];
  const home = safeHeld(all, from.symbol);
  if (!home) return null;
  const others = all.filter((b) => b.symbol === from.symbol && b.listed !== false && !b.test && Number(b.amount) > 0 && !sameRow(b, from));
  const rest = Number(home.amount) - Number(from.amount);
  if (!others.length || !(rest > 0)) return null;
  // the rest at the coin's own decimals (Home's figure less the row's), never a long tail ("135.100000")
  const places = [...new Set(others.map((b) => placeWords(b, chains)))];
  const ins = places.filter((p) => p.startsWith("in ")), ons = places.filter((p) => p.startsWith("on ")).map((p) => p.slice(3));
  const where = andList([...ins, ...(ons.length ? [`on ${andList(ons)}`] : [])]);
  const decimals = Math.max(...[home.amount, from.amount].map((a) => (a.split(".")[1] ?? "").length));
  return `The other ${amountOf(rest.toFixed(Math.min(6, decimals)), from.symbol)} ${from.symbol} is ${where}.`;
}
