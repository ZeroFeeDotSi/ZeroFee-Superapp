// lap FAIL 2 (QA's k-trade3 lap, 5 Nov): a Move saved before its Safe signed (`signing`) and not known to have
// gone (a page closed on its sheet; the refresh before asked the chain and couldn't say) still counts on its coin, which
// the Safe's read still shows: a second Move, from Home or from Trade (both are spending.topUp), can't promise the same
// money. Refused before it saves, in the trade engine's own code and words (trade-problems.ts floatTaken,
// packages/trade/errors.md). Loaded only when such a Move is listed, never in Home's first load (the speed budget).
// Types only from spending.ts.
import type { Problem } from "./problem.ts";
import type { EngineMove, SpendingLib } from "./spending.ts";

/** The Problem when `pays` dollars of this coin (`tokenId`, "" for USDC as dollars) don't fit beside what other Moves
 *  saved before their signature promised of it; null when they fit. `covers`: the coin's dollars as the Safe's read has it. */
export function promisedTaken(moves: readonly EngineMove[], tokenId: string, covers: number, pays: number): Problem | null {
  const promised = moves.filter((m) => m.kind === "add" && m.signing && (m.signing.tokenId ?? "") === tokenId).reduce((n, m) => n + m.usd, 0);
  if (!(promised > 0 && covers - promised + 0.004 < pays)) return null;
  const free = Math.max(0, Math.floor((covers - promised) * 100 + 1e-6) / 100);
  return {
    code: "trade.float.taken",
    whatHappened: `Another move is using this money. $${free.toFixed(2)} is free to move.`,
    money: { state: "safe", where: "where it was" },
    next: { kind: "fix-input", label: "Change the amount", field: "usd" },
  };
}

/** spending.topUp's check (reached through spending-move.ts, already lazy): throws the Problem (as `lib`'s ProblemError)
 *  when the coin picked (`pick`, pickSafeCoin's) can't pay `pays` beside what other Moves promised of it. USDC: dollars (""). */
export function taken(lib: Pick<SpendingLib, "ProblemError">, moves: readonly EngineMove[], pick: { coin: { symbol: string; tokenId: string }; coversUsd: number }, pays: number): void {
  const t = promisedTaken(moves, /^USDC$/i.test(pick.coin.symbol) ? "" : pick.coin.tokenId, pick.coversUsd, pays);
  if (t) throw new lib.ProblemError(t);
}
