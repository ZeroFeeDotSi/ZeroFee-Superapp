// T2-6 (the copy review's walk, 8 Nov) and QA QA's SHOULD: the trade receipt's own words, apart from the design package's shared
// Receipt (the Safe's swaps keep theirs). The proof line says when its public page is still to come; a buy's receipt
// names what lies between what was paid and what the coins are worth, once, from the trade's own quote and record.
import { PROOF_CHAIN, proofLine } from "@zerofee/core/proof-line";
import { TX_EXPLORERS, txUrl } from "@zerofee/core/tx-proof";
import type { Quote } from "../types.ts";
import { usd } from "./format.ts";
import { marketGapLine } from "./held-net.ts";

/** The receipt's proof (the copy review's words): "On Solana" with See proof once the transaction has its explorer page; "On Solana.
 *  Proof page in a moment." while it has none yet (no page to open: its id is behind Copy proof); a chain with no explorer
 *  people know (Robinhood Chain) says so, as everywhere ("On Robinhood Chain · No public page yet."). Never the id. */
export function receiptProof(chain: string, hash: string): { line: string; url?: string } {
  const url = txUrl(chain, hash), name = PROOF_CHAIN[chain] ?? "the network";
  if (url) return { line: `On ${name}`, url };
  if (TX_EXPLORERS[chain]) return { line: `On ${name}. Proof page in a moment.` };
  return { line: proofLine(chain, false) };
}
export const SEE_PROOF = "See proof";

/**
 * QA QA's SHOULD (8 Nov): a buy's receipt said "$25.00" and the holding "$24.85" with nothing naming the gap. Named once,
 * under the paid figure, in the Buy sheet's own words: how far the trade's quote was over the market price
 * (held-net.ts marketGapLine: the quote's payUsd less its coins' getUsd, none under a cent, never called a fee), then the
 * network fee the trade paid, "Fee $0.002" (`feeUsd`: the chain's booked figure, else the quote's own). The receipt's
 * only gap line (copy review, 8 Nov: a second one under the holding read as two prices for one coin). No quote: nothing is said.
 */
export function buyCostLine(q: Pick<Quote, "payUsd" | "getUsd" | "feeUsd"> | undefined, feeUsd: number | undefined): string | null {
  return tradeCostLine("buy", q, feeUsd);
}
/** the audit's Trade S3 (8 Nov): a sale's receipt names its gap the same way, under the market price ("About $0.07 under the
 *  market price. Fee $0.002."), as the Sell sheet's own line does (marketGapLine "sell"). */
export function tradeCostLine(side: "buy" | "sell", q: Pick<Quote, "payUsd" | "getUsd" | "feeUsd"> | undefined, feeUsd: number | undefined): string | null {
  if (!q) return null;
  const gap = marketGapLine(side, q);
  const fee = feeUsd !== undefined && Number.isFinite(feeUsd) && feeUsd > 0 ? `Fee ${usd(feeUsd)}.` : null;
  return [gap, fee].filter(Boolean).join(" ") || null;
}
