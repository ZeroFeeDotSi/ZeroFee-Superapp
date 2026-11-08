// A swap's page in Activity (moved out of format.ts, 7 Nov, so Home's first load doesn't carry it: only Activity's page
// reads it). Its words and rules are unchanged.
import type { Chain, Movement, Token } from "../types.ts";
import { SERVICE_NAMES } from "@zerofee/core/services";
import { NEAR_SWAP_CARD_LINE, NEAR_SWAP_CHECK, NEAR_SWAP_UNFINISHED } from "../near-swap-words.ts";
import { amountOf, describe, safeTrade, whereNow, type OwnRows } from "./format.ts";
import { safeTradeSteps, tookIn } from "@zerofee/shell-api/job-steps.ts";
import type { ProofStep } from "./proof.ts";

/**
 * A swap's page, by how it ended (copy review, 6 Nov): never "Not finished yet" under "Finished". `ended`: its card (null: none
 * while it runs), with where to look when nobody can prove where its money is. A NEAR wallet swap's sub-line is what it was,
 * then the time on its own line. null: not a swap.
 */
export function swapDetail(m: Movement, tokens: Map<string, Token>, chains: Chain[], rows?: OwnRows): { ended: { label: string; line: string; check?: string } | null; line?: string; dayFirst?: true; steps?: ProofStep[] } | null {
  if (m.kind !== "swap") return null;
  // a Safe's Buy or Sell's row line names NEAR Confidential (G6): its page reads the coins from the swap's own words
  const what = describe(safeTrade(m) ? (({ source: _s, ...rest }) => rest)(m) : m, tokens, chains, rows).detail.split(" · ")[0]!;
  const near = m.source === "private" ? { line: what, dayFirst: true as const } : {};
  // audit 17's H5: a Safe Buy or Sell's page said its figure twice ("$345.63" over "Swapped 78.0993 NEAR for 345.63402
  // USDC."): the hero is its one dollar figure (format.ts tradeUsd), so this line says the coin side alone, once
  const trade = safeTrade(m);
  if (trade && m.status === "done") {
    const id = trade === "buy" ? m.to : m.from, amt = trade === "buy" ? m.amountOut : m.amount;
    const t = tokens.get(id === "near" ? "nep141:wrap.near" : id ?? "");
    const sym = id === "near" || id === "nep141:wrap.near" ? "NEAR" : t?.symbol ?? "";
    const verb = trade === "buy" ? "Bought" : "Sold";
    // builder 22's item 2: its page shows the job's three steps and "Took N s." as Send's page does (the receipt's own
    // words, job-steps safeTradeSteps / tookIn), from the record's own reads: into Private (inPrivateAtIso), then landed
    const took = typeof m.settledMs === "number" && m.settledMs >= 0 ? m.settledMs : Date.parse(m.updatedAtIso) - Date.parse(m.startedAtIso);
    const inAt = m.inPrivateAtIso ?? m.updatedAtIso;
    const steps: ProofStep[] = safeTradeSteps(trade === "buy" ? sym || "the coin" : "USDC").map((w, i) => ({ label: w.done, atIso: i === 0 ? inAt : m.updatedAtIso, ended: true as const }));
    return { ended: { label: "Finished", line: amt && Number(amt) > 0 && sym ? `${verb} ${amountOf(amt, sym, t?.decimals)} ${sym}.` : `${verb} it.`, ...(Number.isFinite(took) ? { check: tookIn(took) } : {}) }, steps };
  }
  if (m.status === "done") {
    const paid = what.split(" to ")[0]!, got = tokens.get(m.to ?? ""), into = got?.symbol;
    // the coin as a person reads it (format.ts amountOf: USDC to the cent, other coins to 4 decimals), never the raw
    // record ("345.63402 USDC" under "$345.63"): no more than the row and the receipt say
    const out = m.amountOut && into ? amountOf(m.amountOut, into, got?.decimals) : m.amountOut;
    return { ended: { label: "Finished", line: `Swapped ${paid} for ${[out, into].filter(Boolean).join(" ") || "the coin"}.` }, ...near };
  }
  if (m.status === "refunded") return { ended: { label: "Ended", line: `${SERVICE_NAMES.oneclick} couldn't swap it. Your money is ${whereNow(m, "")}.` }, ...near };
  if (m.status === "problem") return { ended: m.source === "private" ? { label: "Ended", line: NEAR_SWAP_CARD_LINE, check: NEAR_SWAP_CHECK } : { label: "Ended", line: NEAR_SWAP_UNFINISHED }, ...near };
  return { ended: null };
}
