// A proof's one line (the Copywriter, 5 Nov), apart from tx-proof.ts so only the screens that draw it load it (Home's
// first load stays in its budget): Activity's item page and the Activity centre.
/** The networks a proof line names. */
export const PROOF_CHAIN: Readonly<Record<string, string>> = { sol: "Solana", near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", bsc: "BNB Chain", hood: "Robinhood Chain" };
/** The proof's words (the Copywriter, 5 Nov). No raw id on screen (QA graded "D6po1b…Z1x4" C): the id is behind
 *  View (its explorer) or, where a network has none, behind "Copy proof". */
export const PROOF_LINE = { noLink: "No public page yet.", copy: "Copy proof", copied: "Copied" } as const;
/** A proof's one line: "On NEAR"; "On Robinhood Chain · No public page yet." with no explorer; never the id. */
export function proofLine(chain: string, linked: boolean): string {
  const name = PROOF_CHAIN[chain];
  return [name ? `On ${name}` : "", linked ? "" : PROOF_LINE.noLink].filter(Boolean).join(" · ");
}
