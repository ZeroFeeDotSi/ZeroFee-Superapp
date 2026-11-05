// The bundled logo set (./logos, see SOURCE.md), by key: a coin's lowercase symbol as the ledger's trusted coin list
// gives it ("usdc"), or a network's chain id ("sol", "bsc"). Never looked up from a symbol a token chose for itself: a
// fake "USDC" must not get the real USDC logo.
import { DARK_DISC } from "./coin-icon.ts";
const files = import.meta.glob<string>("./logos/*.svg", { eager: true, query: "?url", import: "default" });

/** Chain ids and renamed coins that share another key's logo. */
const ALIAS: Record<string, string> = {
  bsc: "bnb", tron: "trx", stellar: "xlm", pol: "matic", usdt0: "usdt", cardano: "ada",
  // Networks' own coins, by symbol, sharing their network's mark.
  apt: "aptos", gno: "gnosis", hype: "hypercore", mon: "monad", move: "movement", strk: "starknet", xpl: "plasma",
};
/**
 * Brand marks with no background of their own (the kit's mark, never cropped, as its guidelines ask): shown on a white
 * disc, so a dark mark reads in the dark theme too. Every other logo is a full round or square badge, cropped to a circle.
 */
const ON_DISC = new Set(["arb", "gnosis", "sui", "aptos", "hood", "hypercore", "movement", "aleo"]);

const keyOf = (icon: string) => ALIAS[icon.toLowerCase()] ?? icon.toLowerCase();

/** True when this logo's own disc is near-black (coin-icon.ts DARK_DISC): it wears a hairline ring. */
export function logoDark(icon: string | undefined): boolean {
  return !!icon && DARK_DISC.has(keyOf(icon));
}

export function logoUrl(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  return files[`./logos/${keyOf(icon)}.svg`];
}

/** True when this logo is a bare mark, to sit on a white disc rather than be cropped. */
export function logoOnDisc(icon: string | undefined): boolean {
  return !!icon && ON_DISC.has(keyOf(icon));
}
