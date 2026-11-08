// A receipt's first line: what happened to the person, from the job's own figures (the copy review's item 1, 7 Nov). Under "Job created."
// and above "It goes through NEAR Confidential." (the product rule: the protocol by name) and the time.

import type { ReceiptState } from "@zerofee/shell-api/job-steps.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";

/** A receipt line in both tenses: `going` while the job goes, `landed` only once its chain read says it landed. */
export type SaidWords = { going: string; landed: string; stopped?: string };
/** The one choice (QA's MUST, 7 Nov): going, the present; landed, the past; stopped or unsure, the present and
 *  the job's own stop words, never the past. */
export function receiptSaid(w: SaidWords, s: Pick<ReceiptState, "state"> & { words?: string }): string {
  if (s.state === "landed") return w.landed;
  // the audit's Send S2 (8 Nov): a stopped receipt leads with the stop, never "Sending $25.00 to bob.near. NEAR said no."
  if (s.state === "stopped" && w.stopped) return s.words ? `${w.stopped} ${s.words}` : w.stopped;
  if (s.state === "stopped" || s.state === "unsure") return s.words ? `${w.going} ${s.words}` : w.going;
  return w.going;
}

/** Send: "Sending it to bob.near." then "Sent to bob.near." `to`: whom, as the job says it. The figure is the receipt's
 *  hero, said once (the audit's Send audit M8, 7 Nov: "$5.00" over "Sending $5.00 to bob.near."). */
export const sentLine = (to: string): string => `Sent to ${to}.`;
export const sendWords = (to: string): SaidWords => ({ going: `Sending it to ${to}.`, landed: sentLine(to), stopped: `Not sent to ${to}.` });

/** Swap, landed: "About 0.2419 SOL is in your SOL wallet." `gets`: the figure the sheet priced at the tap ("0.2419 SOL"),
 *  `where` the wallet it lands in ("your SOL wallet"). Unpriced: "It's in your SOL wallet.", never a made-up figure. The
 *  dollars are the receipt's hero, said once (the audit's M8). */
/** `read` (audit 11's B5): the figure is what landed, read off its record, so no "About". */
export const swappedLine = (gets: string | undefined, where: string, read = false): string =>
  gets ? `${read ? "" : "About "}${gets} is in ${where}.` : `It's in ${where}.`;

/** A site wallet's Add: "Added $10.00 to your pump.fun wallet." (`network`: a site with more than one, "Solana"). */
export const addedLine = (usd: string, site: string, network?: string): string => `Added ${usd} to your ${site}${network ? ` ${network}` : ""} wallet.`;
/** "Adding $10.00 to your pump.fun wallet." then "Added …". */
export const addWords = (usd: string, site: string, network?: string): SaidWords => ({ going: `Adding ${usd} to your ${site}${network ? ` ${network}` : ""} wallet.`, landed: addedLine(usd, site, network) });

/** AgentZero's funding: "Adding $25.00 to AgentZero's wallet." while it goes (provisional); "$25.00 is in AgentZero's
 *  wallet." only once a read of AgentZero's wallet shows it (copy review, 7 Nov). */
export const agentFundLine = (usd: string, shown: boolean): string =>
  receiptSaid({ going: `Adding ${usd} to AgentZero's wallet.`, landed: `${usd} is in AgentZero's wallet.` }, { state: shown ? "landed" : "going" });

/** Swap while it goes (the copy review's J5, 7 Nov): "Swapping USDC for SOL." (the dollars are the hero, the audit's M8); swappedLine once
 *  its job landed. */
export const swappingLine = (pay: string, get: string): string => `Swapping ${pay} for ${get}.`;

/** Where a Move goes, by name (the copy review's J5: "your SOL and ETH (RH) wallets"). `names`: "Safe", "Private" or a wallet's name
 *  ("SOL", "ETH (RH)"). The Safe or Private beside wallets (provisional): "your Safe and your SOL wallet". */
export function moveWhere(names: readonly string[]): string {
  const u = [...new Set(names)];
  const wallets = u.filter((n) => n !== "Safe" && n !== "Private");
  const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts = [...(u.includes("Safe") ? ["your Safe"] : []), ...(u.includes("Private") ? ["Private"] : []), ...(wallets.length ? [`your ${list(wallets)} wallet${wallets.length > 1 ? "s" : ""}`] : [])];
  return parts.length ? parts.join(" and ") : "your wallets";
}
/** Move's first line (the copy review's J5): "Moving it to your SOL and ETH (RH) wallets."; once its legs landed, "It's now in …"
 *  (provisional). The figure is the receipt's hero, said once (the audit's way-home audit M6, 7 Nov; Send's M8). */
export const movingLine = (where: string, landed: boolean): string => (landed ? `It's now in ${where}.` : `Moving it to ${where}.`);
/** Audit 13's D1 (8 Nov): Move's receipt in one tense. `legs`: its legs read landed off Activity (madeState); `rows`: its
 *  Jobs rows landed (the clock TimeLeft reads). Either one landed it: one rule, so "Done." never sits beside "Job created.".
 *  Landed: "Done." / "It's now in your SOL wallet." / "It went there through NEAR Confidential."; going: "Job created." / "Moving it
 *  to your SOL wallet." / who does the work ("NEAR Confidential moves it. Solana lands it."). */
/** Builder 24, item 2: `steps`, the job's steps are on screen (JobRowSteps): they say who does what, so no who line. */
export function moveReceiptWords(o: { legs: boolean; rows: boolean; where: string; who: string; steps?: boolean }): { landed: boolean; head: string; title: string; who: string | null } {
  const landed = o.legs || o.rows;
  return { landed, head: landed ? JOB_WORDS.landed : JOB_WORDS.created, title: movingLine(o.where, landed), who: o.steps ? null : landed ? "It went there through NEAR Confidential." : o.who };
}
