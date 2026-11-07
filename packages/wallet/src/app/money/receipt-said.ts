// A receipt's first line: what happened to the person, from the job's own figures (the copy review's item 1, 7 Nov). Under "Job created."
// and above "It goes through NEAR Confidential." (the product rule: the protocol by name) and the time.

import type { ReceiptState } from "@zerofee/shell-api/job-steps.ts";

/** A receipt line in both tenses: `going` while the job goes, `landed` only once its chain read says it landed. */
export type SaidWords = { going: string; landed: string };
/** The one choice (QA's MUST, 7 Nov): going, the present; landed, the past; stopped or unsure, the present and
 *  the job's own stop words, never the past. */
export function receiptSaid(w: SaidWords, s: Pick<ReceiptState, "state"> & { words?: string }): string {
  if (s.state === "landed") return w.landed;
  if (s.state === "stopped" || s.state === "unsure") return s.words ? `${w.going} ${s.words}` : w.going;
  return w.going;
}

/** Send: "Sending $25.00 to bob.near." then "Sent $25.00 to bob.near." `what`: the job's own "$25.00 to bob.near". */
export const sentLine = (what: string): string => `Sent ${what}.`;
export const sendWords = (what: string): SaidWords => ({ going: `Sending ${what}.`, landed: sentLine(what) });

/** Swap: "$25.00 swapped: about 0.2419 SOL is in your SOL wallet." `gets`: the figure the sheet priced at the tap ("0.2419
 *  SOL"), `where` the wallet it lands in ("your SOL wallet"). Unpriced: "$25.00 swapped. It goes to your SOL wallet."
 *  (provisional), never a made-up figure. */
export const swappedLine = (usd: string, gets: string | undefined, where: string): string =>
  gets ? `${usd} swapped: about ${gets} is in ${where}.` : `${usd} swapped. It goes to ${where}.`;

/** A site wallet's Add: "Added $10.00 to your pump.fun wallet." (`network`: a site with more than one, "Solana"). */
export const addedLine = (usd: string, site: string, network?: string): string => `Added ${usd} to your ${site}${network ? ` ${network}` : ""} wallet.`;
/** "Adding $10.00 to your pump.fun wallet." then "Added …". */
export const addWords = (usd: string, site: string, network?: string): SaidWords => ({ going: `Adding ${usd} to your ${site}${network ? ` ${network}` : ""} wallet.`, landed: addedLine(usd, site, network) });

/** AgentZero's funding: "Adding $25.00 to AgentZero's wallet." while it goes (provisional); "$25.00 is in AgentZero's
 *  wallet." only once a read of AgentZero's wallet shows it (copy review, 7 Nov). */
export const agentFundLine = (usd: string, shown: boolean): string =>
  receiptSaid({ going: `Adding ${usd} to AgentZero's wallet.`, landed: `${usd} is in AgentZero's wallet.` }, { state: shown ? "landed" : "going" });

/** Swap while it goes (the copy review's J5, 7 Nov): "Swapping $10.00 of USDC for SOL."; swappedLine once its job landed. */
export const swappingLine = (usd: string, pay: string, get: string): string => `Swapping ${usd} of ${pay} for ${get}.`;

/** Where a Move goes, by name (the copy review's J5: "your SOL and ETH (RH) wallets"). `names`: "Safe", "Private" or a wallet's name
 *  ("SOL", "ETH (RH)"). The Safe or Private beside wallets (provisional): "your Safe and your SOL wallet". */
export function moveWhere(names: readonly string[]): string {
  const u = [...new Set(names)];
  const wallets = u.filter((n) => n !== "Safe" && n !== "Private");
  const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts = [...(u.includes("Safe") ? ["your Safe"] : []), ...(u.includes("Private") ? ["Private"] : []), ...(wallets.length ? [`your ${list(wallets)} wallet${wallets.length > 1 ? "s" : ""}`] : [])];
  return parts.length ? parts.join(" and ") : "your wallets";
}
/** Move's first line (the copy review's J5): "Moving $135.00 to your SOL and ETH (RH) wallets."; once its legs landed, "Moved …" (provisional). */
export const movingLine = (usd: string, where: string, landed: boolean): string => `${landed ? "Moved" : "Moving"} ${usd} to ${where}.`;
