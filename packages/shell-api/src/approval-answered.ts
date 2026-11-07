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

/** The core's word that a Safe job's last signature is made (job.signed: the chip's, after its one Face ID, and Private's
 *  leg released with it), before anything is sent (the audit's ruling c6, 6 Nov). Only the shell's ApprovalSheet tells it, from
 *  the core's own event; a Safe job is made on it ("Job created."), never at the tap and never on a sheet's yes alone. */
/** `jobKey`: the job its request named (TxRequest.job), when it named one. */
const signedListeners = new Set<(jobKey?: string) => void>();
export const jobSigned = (jobKey?: string): void => { for (const l of [...signedListeners]) l(jobKey || undefined); };
/** Hear every Safe signature until the returned stop is called (job-run.ts runJob, move-run.ts). */
export function onSafeSigned(listener: (jobKey?: string) => void): () => void {
  signedListeners.add(listener);
  return () => void signedListeners.delete(listener);
}

/** The core's word that a job's sheet is about to show (approval.asked, the audit's MUST, 7 Nov): its key only (TxRequest.job).
 *  On the phone the chip's sheet is Swift's own, never heard here; this is how its job hears it, the web and the Sim the
 *  same way. Only the shell's ApprovalSheet tells it, from the core's own event. */
const askedListeners = new Set<(jobKey: string) => void>();
export const approvalAsked = (jobKey?: string): void => { if (jobKey) for (const l of [...askedListeners]) l(jobKey); };
/** Hear every job's sheet asked until the returned stop is called (job-run.ts safeAskedAfterAll). */
export function onApprovalAsked(listener: (jobKey: string) => void): () => void {
  askedListeners.add(listener);
  return () => void askedListeners.delete(listener);
}

/**
 * The "Check this" sheet at the tap (the copy review's W2, the audit's R4, 6 Nov): put up by the money sheet the moment Approve-to-be is
 * tapped, with the typed headline, before the core has bound the exact amounts. The core's own sheet takes its place when
 * it comes (approval.needed; on the iPhone, Swift's sheet over it with no motion). Its Close is the person's No: the money
 * sheet's moneyClosed, so nothing unsigned is signed after it. `failed`: binding didn't come, Approve stays off.
 */
export type Pending = { headline: string; at: number; failed?: true };
let pendingNow: Pending | null = null;
const pendingListeners = new Set<(p: Pending | null) => void>();
const tellPending = () => { for (const l of [...pendingListeners]) l(pendingNow); };
/** Put up the Getting-ready sheet; the returned end takes it down (the call answered, or the core's sheet came). */
export function pendingSheet(headline: string, at: number = Date.now()): { end: () => void; fail: () => void } {
  const mine: Pending = { headline, at };
  pendingNow = mine;
  tellPending();
  return {
    end: () => { if (pendingNow === mine) { pendingNow = null; tellPending(); } },
    fail: () => { if (pendingNow === mine) { pendingNow = { ...mine, failed: true }; tellPending(); } },
  };
}
export const pendingShown = (): Pending | null => pendingNow;
/** The sheet host hears the Getting-ready sheet (ApprovalSheet). */
export function onPending(l: (p: Pending | null) => void): () => void {
  pendingListeners.add(l);
  return () => void pendingListeners.delete(l);
}
/** Close on the Getting-ready sheet: it goes, and whoever put it up hears the No. */
const pendingCloseListeners = new Set<() => void>();
export function closePending(): void {
  if (!pendingNow) return;
  pendingNow = null;
  refusing = true;
  tellPending();
  for (const l of [...pendingCloseListeners]) l();
}
export function onPendingClosed(l: () => void): () => void {
  pendingCloseListeners.add(l);
  return () => void pendingCloseListeners.delete(l);
}
/** After a Close on the Getting-ready sheet, while its call still runs: a money sheet the core puts up for it is answered
 *  No unseen (ApprovalSheet), so no late sheet comes for a job the person closed. runJob ends it with its call. */
let refusing = false;
export const refuseClosed = (on: boolean): void => { refusing = on; };
export const refusingClosed = (): boolean => refusing;
