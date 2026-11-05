// Move's take-out, said before the tap (QA, 3 Nov: a $20 take-out took $20.60 from the SOL row and landed $19.88 in the
// Safe, and the sheet said neither): what leaves each row, and the least that reaches the Safe. The least comes from the
// core's own floors (float-floors.ts): a row's move into Trading is refused under leastIn, and the move home under 98 %,
// so a smaller arrival can't happen; if the swap service says no, the money waits in Trading. No fee figure is made up:
// there is no quote before this tap.
import { POCKET_HOME_LEAST_PERCENT, leastHome, leastIn } from "@zerofee/core/float-floors";
import { dollars } from "../format.ts";

export type TakeOutFrom = "sol" | "hood" | "near" | "bsc" | "hidden";
export interface TakeOutLeg {
  from: TakeOutFrom;
  /** The row's name ("SOL", "ETH on Robinhood", "NEAR"). */
  name: string;
  /** Dollars picked; for "All", the row's cash. */
  usd: number;
  all: boolean;
  /** A chain row: what can leave at once (the current wallet's cash less its fee reserve), when known. The core sends no
   *  more than that, so the least is worked from it (review M1). */
  readyUsd?: number;
}

/** The core's price may be up to this much under the sheet's (review M2): the least is worked from 99 % of the dollars. */
const PRICE_ROOM = 0.99;
const cents = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
const usd = (x: number) => dollars(x.toFixed(2));

/** The least that reaches the Safe from the rows picked and Hidden (QA, 3 Nov: never "comes back whole").
 *  A chain row's money first moves into Trading (leastIn of what left), then everything home (98 % of it); the NEAR row
 *  is Trading's own cash, so only the move home. Each step is cut to the cent below, as the engine records it. */
export function takeOutLeast(legs: readonly TakeOutLeg[]): number {
  let home = 0, hidden = 0;
  for (const l of legs) {
    // Hidden: each coin home as itself, held by the core to 98 % (no swap fee on the same coin, but that is the floor);
    // its figure is rounded text, so a cent less
    if (l.from === "hidden") { hidden += cents((Math.max(0, cents(l.usd) - 0.01) * Number(POCKET_HOME_LEAST_PERCENT)) / 100); continue; }
    // NEAR's row: its figure is rounded text; home is capped at the reserve's exact units, so a cent less (review L5)
    if (l.from === "near") { home += Math.max(0, cents(l.usd) - 0.01); continue; }
    // what the core sends: never more than readyUsd (the current wallet less its fee reserve, review M1); "All" keeps the
    // network fee back too, so never more than the cash less the most a network fee may be
    const sent = Math.max(0, Math.min(l.readyUsd ?? Infinity, l.all ? l.usd - 0.5 : l.usd));
    // the core floors at its own price, which may sit a little under the one this sheet reads: 1 % of room (review M2)
    home += cents(leastIn(sent * PRICE_ROOM));
  }
  return cents((home ? leastHome(cents(home)) : 0) + hidden);
}

/** The lines above the button: what leaves, then the least that arrives, then where fees come from. */
export function takeOutLines(legs: readonly TakeOutLeg[]): string[] {
  if (!legs.length) return [];
  const leaves = legs.map((l) => {
    if (l.from === "hidden") return `About ${usd(l.usd)} leaves your private balance.`;
    // "Up to" where the row can't send the whole pick at once (a fee reserve kept while it holds coins)
    const what = `${l.all ? "About " : l.from !== "near" && l.readyUsd !== undefined && l.readyUsd < l.usd ? "Up to " : ""}${usd(l.usd)}`;
    // a chain row pays its own network fee on top; the NEAR row is Trading's own cash and pays none
    return `${what} leaves your ${l.name} wallet${l.from === "near" ? "" : ", and its network fee"}.`;
  });
  const least = takeOutLeast(legs);
  return [...leaves, `At least ${usd(least)} reaches your Safe.`, "The swap service's fees come out on the way."];
}
