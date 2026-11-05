// The shell's own word that the person answered an approval sheet, for a screen that waits under the sheet and wants to
// say what happens next ("Finishing…", "Sending…" once Approve is tapped, grade 01c P13, 01d Q2). Only the shell's ApprovalSheet tells it;
// nothing here can answer a sheet. Kept small: it is in Home's first load (speed budget).
type Heard = (approved: boolean, id?: string) => void;
/** A sheet as put up: its request id; `tap`: a hot key's one tap (no Face ID); `amount`: money leaves (words.ts). */
export type Opened = { id: string; words: { tap?: true; amount?: string } };
const listeners = new Set<Heard>();
const openers = new Set<(p: Opened) => void>();

/** Called by ApprovalSheet once it has handed the answer to the core; `p`: the sheet answered. */
export function approvalAnswered(approved: boolean, p?: { id: string }): void {
  for (const l of [...listeners]) l(approved, p?.id);
}

/** Called by ApprovalSheet when a sheet is put up for the person (never for one answered Not now unseen). */
export const approvalOpened = (p: Opened): void => openers.forEach((o) => o(p));

/** Hear every answer until the returned stop is called. */
export function onApprovalAnswered(listener: Heard): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Hear every sheet put up until the returned stop is called (job-run.ts onOwnApproval). */
export function onApprovalOpened(o: (p: Opened) => void): () => void {
  openers.add(o);
  return () => void openers.delete(o);
}

/** Who draws the approve sheets right now (QA's MUST, Sim test: "Job created." painted, then "Check this"
 *  over it, then "Job created." again): `hot`, the shell's own sheet is up and hears every hot key's sheet; `safe`, it
 *  hears the Safe's too (the web, the Sim, the extension's window). On the iPhone the Safe's Face ID is Swift's own sheet,
 *  never heard here. A job whose sheet is heard is made on its yes (ask first, then "Job created." once); one whose sheet
 *  isn't heard is made at the tap (rule 2). */
const hosts: { safe: boolean }[] = [];
export function hostSheets(h: { safe: boolean }): () => void {
  const mine = { ...h };
  hosts.push(mine);
  return () => { const i = hosts.indexOf(mine); if (i >= 0) hosts.splice(i, 1); };
}
/** True when a sheet of this kind is drawn by the shell and its answer heard (approvalOpened / approvalAnswered). */
export const sheetsHeard = (kind: "safe" | "hot"): boolean => hosts.some((h) => kind === "hot" || h.safe);
