// Discover's pure rules (the A+ pass of 3 Nov), kept apart from the screen so they are tested without a browser.
import type { CoinRow } from "../../market/types.ts";
import { changeIn, type ListWindow } from "../movers.ts";

export type Win = ListWindow | "new";
/** The same six lists on every chain, so nothing moves under a finger ("Hot" is GeckoTerminal's trending order). */
export const LISTS: [Win, string][] = [["trending", "Hot"], ["new", "New"], ["m5", "5m"], ["h1", "1h"], ["h6", "6h"], ["h24", "24h"]];
/** A coin up or down this much over the window shown may glow in its own colour… */
export const HOT_PCT = 25;
/** …and only the few that moved most do (ambient, never a wall of light). */
export const HOT_MAX = 2;

/** The few rows that glow: the biggest movers over the window shown, at HOT_PCT or more, at most HOT_MAX of them. */
export function litRows(rows: readonly CoinRow[], win: Win): Set<string> {
  const w = win === "new" ? "trending" : win;
  return new Set(rows.map((r) => [r, Math.abs(changeIn(r, w) ?? 0)] as const).filter(([, a]) => a >= HOT_PCT).sort((a, b) => b[1] - a[1]).slice(0, HOT_MAX).map(([r]) => `${r.chain}:${r.address}`));
}

/** New on All: each market chain's newest launches together, newest first. */
export function newestAcross(lists: readonly (readonly CoinRow[] | null)[]): CoinRow[] {
  return lists.flatMap((l) => l ?? []).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** A row rises in only when it joins a list already shown: the first screen of rows is drawn at full ink at once (UX audit
 *  4 Nov: the first rows reached 95 % ink only at ~900 ms, behind a 0.55 s rise and a 45 ms stagger). */
export function risesIn(seen: ReadonlySet<string>, key: string): boolean {
  return seen.size > 0 && !seen.has(key);
}

/** What a search says when it can't be any coin's address, at once and without asking the market (finding 14). */
export const NOT_AN_ADDRESS = "That's not a coin address. Check it, or search by name.";

/**
 * A search that is trying to be an address but can't be one on any chain (finding 14, real money 4 Nov: "0xNOTANADDRESS!!zzz"
 * waited on the market and then blamed it). Three shapes: 0x and hex of the wrong length (an EVM address cut short or too
 * long); 0x and a character no address or name has; one long word that isn't a Solana address or a 64-hex NEAR account
 * (a dot, a colon or a slash is a NEAR id or a link, read by their own reader). A name ("BONK", "0xBitcoin", "dog wif hat")
 * never is one.
 */
export function notAnAddress(term: string): boolean {
  const q = term.trim();
  if (/\s/.test(q)) return false;
  if (/^0x[0-9a-f]*$/i.test(q)) return q.length >= 10 && q.length !== 42;
  if (/^0x/i.test(q)) return /[^A-Za-z0-9]/.test(q);
  return q.length >= 32 && !/[.:/]/.test(q) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !/^[0-9a-fA-F]{64}$/.test(q);
}
