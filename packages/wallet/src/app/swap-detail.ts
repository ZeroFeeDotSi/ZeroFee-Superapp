// A swap's page in Activity (moved out of format.ts, 7 Nov, so Home's first load doesn't carry it: only Activity's page
// reads it). Its words and rules are unchanged.
import type { Chain, Movement, Token } from "../types.ts";
import { SERVICE_NAMES } from "@zerofee/core/services";
import { NEAR_SWAP_CARD_LINE, NEAR_SWAP_CHECK, NEAR_SWAP_UNFINISHED } from "../near-swap-words.ts";
import { describe, whereNow, type OwnRows } from "./format.ts";

/**
 * A swap's page, by how it ended (copy review, 6 Nov): never "Not finished yet" under "Finished". `ended`: its card (null: none
 * while it runs), with where to look when nobody can prove where its money is. A NEAR wallet swap's sub-line is what it was,
 * then the time on its own line. null: not a swap.
 */
export function swapDetail(m: Movement, tokens: Map<string, Token>, chains: Chain[], rows?: OwnRows): { ended: { label: string; line: string; check?: string } | null; line?: string; dayFirst?: true } | null {
  if (m.kind !== "swap") return null;
  const what = describe(m, tokens, chains, rows).detail.split(" · ")[0]!;
  const near = m.source === "private" ? { line: what, dayFirst: true as const } : {};
  if (m.status === "done") {
    const paid = what.split(" to ")[0]!, into = tokens.get(m.to ?? "")?.symbol;
    return { ended: { label: "Finished", line: `Swapped ${paid} for ${[m.amountOut, into].filter(Boolean).join(" ") || "the coin"}.` }, ...near };
  }
  if (m.status === "refunded") return { ended: { label: "Ended", line: `${SERVICE_NAMES.oneclick} couldn't swap it. Your money is ${whereNow(m, "")}.` }, ...near };
  if (m.status === "problem") return { ended: m.source === "private" ? { label: "Ended", line: NEAR_SWAP_CARD_LINE, check: NEAR_SWAP_CHECK } : { label: "Ended", line: NEAR_SWAP_UNFINISHED }, ...near };
  return { ended: null };
}
