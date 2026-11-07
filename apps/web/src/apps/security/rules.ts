// Protection by amount, in plain words, and the Recovery tab's clock words: pure, so they're tested without a browser.
// (The screens are Protection.tsx and SecurityApp.tsx.)
//
// The screen opens on the account's own rules, as the core reads them from the contract (account.protection.get's
// `usd`, set-up's DEFAULT_PROTECTION for a new account). There is no screen-side default: a number here would be a
// rule the account doesn't have.
import { bandCoins, type ProtectionBand } from "@zerofee/core/protection-bands";
import { approvalWords, type ApprovalWords } from "@zerofee/shell-api/approval-words.ts";
import { needWords, waitSpan } from "@zerofee/core/rule-words";

export type Level = "faceid" | "wait" | "device" | "both";
export interface Band { upToUsd: number | null; level: Level; waitSeconds: number }

export const HOUR = 3600, DAY = 86_400;
/** The waits the person can pick for a band (plus the band's own wait, when it holds another: waitChoices). */
export const WAITS = [HOUR, DAY, 3 * DAY];

const RANK: Record<Level, number> = { faceid: 0, wait: 1, device: 2, both: 3 };
export const stricter = (a: Band, b: Band) => RANK[a.level] > RANK[b.level] || (RANK[a.level] === RANK[b.level] && a.waitSeconds > b.waitSeconds);
export const LIMITS = [100, 500, 1000, 5000, 10000, 50000];

/**
 * The account's protection, as the core reads it from the contract in dollars (account.protection.get's `usd`), in this
 * screen's shape. Nothing is invented: a band without a wait carries the wait of the account's own waiting band (or a
 * day), used only if the person switches that band to a wait and sees it picked. Null in, null out.
 */
export function fromCore(usd: readonly ProtectionBand[] | null | undefined): Band[] | null {
  if (!Array.isArray(usd) || usd.length === 0) return null;
  const own = usd.find((b) => typeof b.waitSeconds === "number")?.waitSeconds ?? DAY;
  return usd.map((b) => ({ upToUsd: b.upToUsd, level: b.level, waitSeconds: typeof b.waitSeconds === "number" ? b.waitSeconds : own }));
}

/** What a save sends: the bands as shown, a wait only where the level has one. */
export const toCore = (bands: readonly Band[]): ProtectionBand[] =>
  bands.map((b) => ({ upToUsd: b.upToUsd, level: b.level, ...(b.level === "wait" || b.level === "both" ? { waitSeconds: b.waitSeconds } : {}) }));

/** What the Protection screen shows once the core answered: the account's bands (and what they were, to know a
 *  change), or why it can't. */
export type Loaded =
  | { k: "loading" }
  | { k: "bands"; bands: Band[]; from: Band[]; first: boolean; now: string[]; fewCoins?: boolean }
  | { k: "unread"; now: string[] };

/** H01: rules saved before every coin was counted list only NEAR, USDC and USDT (no wNEAR): any other coin, at any size,
 *  then waits at the strictest level. A band with limits and no wNEAR is such a rule. */
export const countsFewCoins = (bands: unknown): boolean => {
  const coins = bandCoins(bands);
  return coins.length > 0 && !coins.includes("nep141:wrap.near");
};
/** The line the Protection screen shows for those rules (true: the save itself waits like any rule change). */
export const FEW_COINS_LINE = "Your rules on NEAR are an older kind, so some moves wait. Save them once to fix it.";

/** Did the person change anything from what the account holds? A save with no change would only re-sign the same rules. */
export const changed = (now: readonly Band[], from: readonly Band[]) => JSON.stringify(toCore(now)) !== JSON.stringify(toCore(from));

/** The waits to offer a band: the usual three, the band's own when it holds another (e.g. testnet's 2 minutes), and every
 *  wait the account held when the screen opened (`held`), so a choice never disappears once another is picked (N8). */
export const waitChoices = (current: number, held: readonly number[] = []) => [...new Set([...WAITS, current, ...held])].sort((a, b) => a - b);

/** What Save says while it works (N3): from the tap until the approval sheet or a Problem, never a dead button. */
export const SAVING_STATUS = "Getting your rules ready to approve…";
/** From the tap on Approve until the account answers (grade 01d, Q10): never the line above again once approved. */
export const SAVED_STATUS = "Approved. Saving your rules…";
/** Protection's one button: what it does now. While saving it says so (and is off, so a second tap sends nothing twice). */
export function saveLabel({ first, edited, fewCoins, saving }: { first: boolean; edited: boolean; fewCoins: boolean; saving: boolean }): string {
  if (saving) return "Saving…";
  return first ? "Turn on" : edited || fewCoins ? "Save my rules" : "Nothing changed";
}

/**
 * What Security's score says after "safety steps done" (grade 02e, E9: "strong for big money" beside a 1-minute recovery
 * wait). Whoever has the words takes the account once the wait is over, so a wait under 48 hours (D49's least) is never
 * strong for big money; testnet's short wait is said to be the test one.
 */
export function strengthWords(on: number, delaySeconds: number, network: string): string {
  if (delaySeconds > 0 && delaySeconds < 2 * DAY) return network === "mainnet" ? "strong" : `${waitFor(delaySeconds)} test wait, not real protection`;
  return on >= 4 ? "strong" : "stronger with more steps";
}

/** Dollars as people write them: $500, $1,000, $487.25 (cents only when there are some). */
export const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`;
/** 120 → "2-minute", 3600 → "1-hour", 86400 → "1-day". */
/** A wait as a word before a noun: "1-day", "2-hour", "2-minute" (a 1-day wait). */
export const waitFor = (s: number) => waitSpan(s);
/** A wait's button: "1 hour", "3 days", "2 minutes". */
export const waitLabel = (s: number) => waitPlain(s);
/** A band's need as Protection's row says it (design review §3, grade 5): "Your face", "Your face, then a 1-day wait",
 *  "Your face and your second device". Where there is no Face ID (a browser), "Your yes". The ONE form (rule-words.ts):
 *  the rows, "Now on your account" and the Sim's sheet all say it so (QA sd-security (j)). */
export const youWord = (w: ApprovalWords = approvalWords()) => (w.level === "Face ID" ? "Your face" : "Your yes");
export function rowWords(b: Band, w: ApprovalWords = approvalWords()): string {
  return needWords(b.level, b.waitSeconds, youWord(w));
}
/** Kept for its callers: the same words as rowWords (one form, never "Face ID + 1-day wait" beside "Your face, then…"). */
export const levelWords = rowWords;
/** A change to the rules' wait on chain (lib.rs floor_ns): the recovery wait plus as much again, up to a day more. */
export const changeWaitSeconds = (recoveryDelaySeconds: number) => recoveryDelaySeconds + Math.min(recoveryDelaySeconds, DAY);
/** The strictest (last) band's own wait, 0 when it has none: what the contract places a change at, beside the floor. */
export const strictestWait = (held: readonly { level: string; waitSeconds?: number }[] | null | undefined): number => {
  const s = held?.[held.length - 1];
  return s && (s.level === "wait" || s.level === "both") ? s.waitSeconds ?? 0 : 0;
};
/**
 * The ONE wait of a change to the rules (lib.rs `place`): the strictest band's own wait or the floor, whichever is longer.
 * Set-up, Security's Recovery tab, its overview and Protection all say this figure (grade 02f, F2: Recovery and set-up
 * said "2 minutes" while Protection said "1 hour" and the change waited 59m 57s).
 */
export const ruleChangeWait = (strictestBandWait: number, recoveryDelaySeconds: number): number => Math.max(strictestBandWait, changeWaitSeconds(recoveryDelaySeconds));
/** A wait as people say it: hours up to two days, days from three: 86400 → "24 hours", 172800 → "48 hours",
 *  259200 → "3 days", 691200 → "8 days", 60 → "1 minute". The recovery waits and the rules-change wait use it. */
export function waitName(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds >= 3 * DAY) return unit(Math.round(seconds / DAY), "day");
  if (seconds >= HOUR) return unit(Math.round(seconds / HOUR), "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}
/**
 * The ONE way every screen says the rules-change wait (grade 02g, F2): set-up's wait sheet, Security → Steps, the
 * Recovery tab and Protection all call this, with the account's strictest band wait (set-up: the new account's own
 * default band) and its recovery delay. "1 hour", "2 minutes", "3 days".
 */
export const ruleChangeWaitWords = (strictestBandWait: number, recoveryDelaySeconds: number): string => waitName(ruleChangeWait(strictestBandWait, recoveryDelaySeconds));
/**
 * What any change to the rules really takes, as the account contract places it (lib.rs `place`): the strictest band's
 * level, and a wait of at least a change's wait, whichever is longer. The contract makes every change wait, a stricter
 * one too (it can't tell who asked), so the screen says so and why: "Any change to these rules, even a safer one, needs
 * Face ID and waits 3 days. …". `held`: the rules the account HOLDS, never the ones on screen being picked: the contract
 * places a change by its current strictest band (its last), so the page says the wait the approval sheet says (01d Q7).
 */
export function changeRuleWords(held: readonly Band[], recoveryDelaySeconds: number, w: ApprovalWords = approvalWords()): string {
  const strictest = held[held.length - 1];
  const wait = ruleChangeWait(strictestWait(held), recoveryDelaySeconds);
  const device = strictest.level === "device" || strictest.level === "both";
  const needs = `${w.level}${device ? " and your second device" : ""}`;
  if (wait <= 0) return `Every change here needs ${needs}.`;
  return `Every change here needs ${needs} and waits ${ruleChangeWaitWords(strictestWait(held), recoveryDelaySeconds)}. So you can stop one you didn't make.`;
}
/** Protection's one line about changing the rules (round 3, UI-SIMPLICITY-RULES 2, 10): the wait alone, e.g. "A change
 *  to these rules takes 3 days." (the copy review's S5); with no wait, the full sentence (it is short then). `waits`: the full one goes one tap down. */
export function changeRuleLine(held: readonly Band[], recoveryDelaySeconds: number, w: ApprovalWords = approvalWords()): { line: string; waits: boolean } {
  if (ruleChangeWait(strictestWait(held), recoveryDelaySeconds) <= 0) return { line: changeRuleWords(held, recoveryDelaySeconds, w), waits: false };
  return { line: `A change to these rules takes ${ruleChangeWaitWords(strictestWait(held), recoveryDelaySeconds)}.`, waits: true };
}
export const rangeWords = (bands: Band[], i: number) => {
  const lo = i === 0 ? 0 : bands[i - 1].upToUsd ?? 0;
  const hi = bands[i].upToUsd;
  if (hi === null) return i === 0 ? "Any amount" : `Over ${usd(lo)}`;
  return i === 0 ? `Up to ${usd(hi)}` : `${usd(lo)} to ${usd(hi)}`;
};

/** Bigger amounts never get less care than smaller ones: raising a band raises every band above it to match. */
export function keepOrder(bands: Band[]): Band[] {
  const out = bands.map((b) => ({ ...b }));
  for (let i = 1; i < out.length; i++) if (stricter(out[i - 1], out[i])) out[i] = { ...out[i], level: out[i - 1].level, waitSeconds: out[i - 1].waitSeconds };
  return out;
}



/** The Recovery tab's wait, in plain words: 604800 → "7 days", 3600 → "1 hour", 120 → "2 minutes". */
export function waitPlain(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds >= DAY) return unit(Math.round(seconds / DAY), "day");
  if (seconds >= HOUR) return unit(Math.round(seconds / HOUR), "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

/** A moment, as a person says it: "Sun 1 Nov, 10:27 PM" (no seconds, no year unless it isn't this year). */
export function whenWords(iso: string, now = new Date(), locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "soon";
  const day = at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
  return `${day}, ${at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
}
