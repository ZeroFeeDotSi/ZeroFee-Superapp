// The Trade tab's movers (V1's 5m · 1h · 6h · 24h, re-walk.4): the same coins GeckoTerminal trends, sorted by how much
// each rose over the window picked, biggest first, with that window's change on its row. "Trending" (the default) is
// GeckoTerminal's own order, never one Trade picks.
import type { CoinRow, MoveWindow } from "../market/types.ts";

export type ListWindow = "trending" | MoveWindow;
export const WINDOWS: [ListWindow, string][] = [["trending", "Trending"], ["m5", "5m"], ["h1", "1h"], ["h6", "6h"], ["h24", "24h"]];

/** The change a row shows for the window: the day's for Trending and 24h. */
export const changeIn = (r: CoinRow, w: ListWindow): number | undefined => (w === "trending" || w === "h24" ? r.change24hPct ?? r.changePct?.h24 : r.changePct?.[w]);

/** A coin down this much in a day has lost its market (the spam filter's empty market): no list offers it. */
export const DEAD_PCT = -99.5;
const alive = (r: CoinRow) => !((r.change24hPct ?? r.changePct?.h24 ?? 0) <= DEAD_PCT);

/** Home's trending rows: the Trade tab's own list, so only chains Trade offers and no Solana coin Buy would refuse, the
 *  first `n` (audit 2 Nov: Home offered a BNB Chain coin the Trade tab leaves out). */
export function homeTrending(rows: readonly CoinRow[], offered: readonly string[], refusedSol: { has(a: string): boolean }, n: number): CoinRow[] {
  return rows.filter((r) => offered.includes(r.chain) && !(r.chain === "sol" && refusedSol.has(r.address))).slice(0, n);
}

export function moversOf(rows: readonly CoinRow[], w: ListWindow): CoinRow[] {
  if (w === "trending") return rows.filter(alive);
  return rows.filter((r) => alive(r) && changeIn(r, w) !== undefined).sort((a, b) => changeIn(b, w)! - changeIn(a, w)!);
}
