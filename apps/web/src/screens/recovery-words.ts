// Release 7's recovery in plain words (contracts/account-policy/src/lib.rs, the header is the rule): pure, so it's tested
// without a browser. The screens are RecoveryChoice and RecoveryWaiting (Recovery.tsx), the Home banner (freeze.ts), the
// laptop's request card (laptop/RecoveryRequest.tsx) and Security's Recovery tab.
//
// - The person chooses the recovery delay at set-up (D49: 48 hours by default and at least, then 3, 7, 14 or 30 days;
//   older accounts may have 24 hours); it never changes.
// - A change to the rules or the keys waits the floor: the delay plus as much again, up to a day more (48 hours on a
//   24-hour account, 3 days on 48 hours, 4 days on 3, 8 days on 7).
// - With a second device of age on the account, a move to a new phone needs that device's yes, after the delay; the
//   device can refuse it at any time. Without its yes, the words alone finish after the fallback: 3 times the delay, at
//   least a week and at most 30 days (7 days on 24 or 48 hours, 9 on 3 days, 21 on 7).
import type { RecoveryPending } from "@zerofee/core/signer";
import type { Problem } from "@zerofee/core/problem";
import { ruleChangeWaitWords, waitName, whenWords } from "../apps/security/rules.ts";
import { ThisDevice, thisDevice } from "@zerofee/shell-api/approval-words.ts";

const HOUR = 3600, DAY = 86_400;
// Typing a backup word (NOT_A_WORD, enteredWord, closeWords) is in word-entry.ts, with the word list: never in Home's
// first load (freeze.ts reads this file there; speed budget, 5 Nov).
export const floorSeconds = (delay: number) => delay + Math.min(delay, DAY);
export const fallbackSeconds = (delay: number) => Math.min(30 * DAY, Math.max(7 * DAY, 3 * delay));

export { waitName } from "../apps/security/rules.ts";

/** One set-up choice, as account.recoveryChoices gives it (its seconds and whether it's the default). */
export interface DelayChoice { seconds: number; default: boolean }

/** Set-up's one line and its Change sheet (D24 folded in, grade 1 Nov c P9): 48 hours unless the person changes it. */
export const CHOICE_WORDS = {
  line: "Recovery wait",
  /** Finding 50: who waits, how you hear of it, and that you can stop it (not "You can stop them" with no how). */
  sub: "If someone uses your words, they must wait this long first. This phone tells you, and you can stop them.",
  /** Said plainly: the choice is made once (D49), never "No one can shorten it later" as if it could grow. */
  fixed: "You pick this once. It can't change later, not even by you.",
  /** What "your rules" are, said where they're first named. */
  rules: "Your rules are your spend limits and who can say yes.",
  /** The sheet's way back: keeps the wait as it is. */
  keep: (wait: string) => `Keep ${wait}`,
  /** Set-up's figure is the new account's: a longer wait picked later for big payments makes changes wait that long too
   *  (grade 02g, F2: set-up said 2 minutes, Steps 1 hour on an account whose big payments wait 1 hour). */
  later: "Rule changes always wait at least this long.",
};

/** The one line under each choice: what it means, and what every change to your rules then waits. Never "Recommended". */
/** `bandWait`: the new account's strictest band's own wait (its default rules, demo-core defaultBands): a change waits
 *  that or the floor, whichever is longer, the figure Protection and the contract use (grade 02f, F2). */
export function choiceLine(c: DelayChoice, all: readonly DelayChoice[], bandWait = 0): string {
  const changes = `Changes to your rules wait ${ruleChangeWaitWords(bandWait, c.seconds)}.`;
  const least = Math.min(...all.map((x) => x.seconds)), most = Math.max(...all.map((x) => x.seconds));
  if (c.seconds === least) return `The quickest way back. ${changes}`;
  if (c.seconds === most) return `The most time to stop a stranger. ${changes}`;
  return changes;
}

/** What the new phone shows while a move waits: a label, the countdown's end, one plain paragraph, and the fallback. */
export interface NewPhoneWait { label: string; untilIso: string; body: string; fallback: string | null; ready: boolean }

/**
 * The new phone's screen from recovery.status's `pending` (release 7: needsSecondDevice, approved, fallbackAtIso,
 * canFinishAtIso; older releases give only readyAtIso). `delaySeconds`: the account's delay, to say the fallback's length.
 */
/** `device`: the second device's name when the screen knows it ("laptop"), one name on every line (grade 1 Nov, item 7). */
export function newPhoneWait(p: RecoveryPending, delaySeconds: number, now = Date.now(), when: (iso: string) => string = (iso) => whenWords(iso), device = "second device"): NewPhoneWait {
  const finishAt = p.canFinishAtIso ?? p.readyAtIso;
  if (now >= Date.parse(finishAt)) return { label: "Ready", untilIso: finishAt, body: `The wait is over. Bring your account to ${thisDevice()}.`, fallback: null, ready: true };
  if (p.needsSecondDevice && !p.approved) {
    const delayOver = now >= Date.parse(p.readyAtIso);
    // The fallback's length is the account's rule, counted from the move's start (3 times the delay, 7 to 30 days: the
    // Recovery post's 7, 7, 9 and 21 days), never from a ready time that moved (grade 30 Oct, item 1: 7 became 9).
    const fallback = p.fallbackAtIso
      ? `Lost your ${device} too? Then you can finish without it after ${waitName(fallbackSeconds(delaySeconds))}, on ${when(p.fallbackAtIso)}.`
      : null;
    return {
      label: `Waiting for your ${device}`,
      untilIso: delayOver ? finishAt : p.readyAtIso,
      // The count goes on to the fallback here, so it never says "the wait is over" beside a countdown (item 1).
      body: delayOver
        ? `Your ${device} can say yes now in ZeroFee. Or finish when this count ends.`
        : `Your ${device} must say yes in ZeroFee. Then finish here after ${waitName(delaySeconds)}.`,
      fallback,
      ready: false,
    };
  }
  if (p.needsSecondDevice && p.approved) {
    return { label: `Your ${device} said yes`, untilIso: finishAt, body: `Your account comes here when the wait ends. Only your ${device} can stop it.`, fallback: null, ready: false };
  }
  return { label: "On its way", untilIso: p.readyAtIso, body: `Your account is coming here after a wait. Your other device can stop it.`, fallback: null, ready: false };
}

/**
 * Who can stop a waiting move, said on the old phone (the banner, the alert, Security's Recovery tab). Re-audit 7: with a
 * second device of age the phone stops a move once, and never one that device said yes to.
 */
/** `device`: what the second device is, when the screen knows ("your laptop"); else "your second device". */
export function whoCanStop(p: Pick<RecoveryPending, "needsSecondDevice" | "approved" | "stopAtIso">, when: (iso: string) => string = (iso) => whenWords(iso), device = "your second device"): string {
  const Device = device.charAt(0).toUpperCase() + device.slice(1);
  if (p.needsSecondDevice && p.approved) return `${Device} said yes to this move: only it can stop it now.`;
  if (p.needsSecondDevice && p.stopAtIso) return `${ThisDevice()} asked to stop it. It stops ${when(p.stopAtIso)}, or at once if ${device} says yes.`;
  // The contract's rule (R7-2): with a second device of age, this phone gets one stop per move.
  return p.needsSecondDevice ? `${Device} can refuse it any time. ${ThisDevice()} can ask to stop it once.` : `${ThisDevice()} can stop it.`;
}
/** Can this phone still ask to stop the move (re-audit 7, R7-2)? */
export const phoneCanStop = (p: Pick<RecoveryPending, "needsSecondDevice" | "approved" | "stopAtIso">) => !(p.needsSecondDevice && (p.approved || p.stopAtIso));

/** The old phone's countdown during a move: to the earliest it could finish, and what that needs. `atZero`: the words
 *  once the count reaches nothing, never "It finishes in 0s" (grade 1 Nov, item 7). */
export function oldPhoneCount(p: RecoveryPending, device = "your second device", now = Date.now()): { untilIso: string; before: string; after: string; atZero: string } {
  const Device = device.charAt(0).toUpperCase() + device.slice(1);
  // The delay is over without a yes: never "It can finish in 0s" (item 1): the count is to the words-only fallback.
  if (p.needsSecondDevice && !p.approved && now >= Date.parse(p.readyAtIso) && p.fallbackAtIso && now < Date.parse(p.fallbackAtIso)) {
    return { untilIso: p.fallbackAtIso, before: `It can finish now if ${device} says yes. Without it, it finishes in `, after: " unless you stop it.", atZero: "It can finish now unless you stop it." };
  }
  if (p.needsSecondDevice && !p.approved) return { untilIso: p.readyAtIso, before: "It can finish in ", after: `, only if ${device} says yes.`, atZero: `It can finish now if ${device} says yes.` };
  if (p.needsSecondDevice && p.approved) return { untilIso: p.canFinishAtIso ?? p.readyAtIso, before: `${Device} said yes. Finishes in `, after: ".", atZero: `${Device} said yes. It can finish now.` };
  // the copy review (7 Nov): one sentence form for a countdown, "Finishes in 1 day 23 hours unless you stop it." (countdown.ts waitWords)
  return { untilIso: p.readyAtIso, before: "Finishes in ", after: " unless you stop it.", atZero: "It can finish now unless you stop it." };
}

/** The second device's two answers to a waiting move, and what each does (the laptop page and the demo's laptop). */
export { LAPTOP_ANSWERS } from "../laptop/second-device-words.ts";

/** What the second device does for a move, said once under "If you lose this device" (the facts' row says only its state). */
export const SECOND_DEVICE_MOVE_WORDS = { none: "With a second device, a move to a new device also needs its yes.", young: "Once its own wait ends, a move needs your second device too.", "re-add": "Add your second device again. Then it counts for Recovery." } as const;

/** Security's Recovery tab: the chosen wait, the fallback, and whether the second device is needed. */
/** `bandWait`: the strictest band's own wait the account holds (known.ts), null until read: the rules-change row then
 *  waits for it, never the floor alone (grade 02f, F2: "2 minutes" here, "1 hour" in Protection, 59m 57s on chain). */
export function recoveryFacts(delaySeconds: number, secondDevice: "none" | "young" | "ready" | "re-add", bandWait: number | null = 0, changeFloorDelaySeconds = delaySeconds): { label: string; value: string }[] {
  // A row's value is one short fact (round 3, Black walk: "None yet. With one, a move also needs its yes" wrapped to three
  // lines with "yes" alone); what it means is under "If you lose this device" (SECOND_DEVICE_MOVE_WORDS).
  const device =
    secondDevice === "ready" ? "Needed for a move"
      : secondDevice === "young" ? "Needed once its wait ends"
        : secondDevice === "re-add" ? "Add it again"
          : "None yet";
  return [
    { label: "Recovery wait", value: `${waitName(delaySeconds)}, chosen at set-up` },
    { label: "Second device", value: device },
    // The words-only fallback applies only where a second device of age would otherwise be needed.
    ...(secondDevice === "none" ? [] : [{ label: "If you lose it too", value: `Your words alone, after ${waitName(fallbackSeconds(delaySeconds))}` }]),
    ...(bandWait === null ? [] : [{ label: "Changes to your rules wait", value: ruleChangeWaitWords(bandWait, changeFloorDelaySeconds) }]),
  ];
}

/**
 * Why the typed words came back to their screen after a Problem (grade 02e, E1: after a declined Approve, Try again said
 * "One of them is wrong"): the word the core named, or that one is wrong somewhere it can't name (a checksum, or words
 * that belong to no account). Any other Problem (the network, a busy service) keeps them and calls none wrong.
 */
export function wordsBack(problem: Problem): { badWord?: number; wrong?: true } {
  const field = problem.next.kind === "fix-input" ? problem.next.field : "";
  return /^word-\d+$/.test(field) ? { badWord: Number(field.slice(5)) } : field === "words" ? { wrong: true } : {};
}
