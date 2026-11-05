// The one thread (Job 1, the spine; B14: "many things happen but they feel disconnected"). An account has five steps,
// Words → Money in → Protected → Second device → Done, and one bar shows them everywhere a step is open: Home, the
// funding screens, the words screens. It is the only progress device in the app: the funding strip and its "1 of 3",
// "Step 1 of 2", Security's "4 of 5", "4 of 4", "Move the rest to Private" and the $5,000 banner are this bar now.
// Tapping it opens the next step, one screen.
//
// It never says something that hasn't happened: a step is done only on a fact read from the account; a fact not read
// yet is unknown, and an unknown step is neither ticked nor offered. Pure, so it is tested in node (thread.test.ts).
import type { FundView } from "@zerofee/core/fund-start";
import { fundTitle, nothingSeen } from "../screens/fund.ts";

export type ThreadKey = "words" | "money" | "protected" | "device" | "done";
export type StepState = "done" | "now" | "todo";
export interface ThreadStep { key: ThreadKey; label: string; state: StepState }
export interface Thread {
  steps: ThreadStep[];
  /** The step the bar opens (the one under way, or next); null when all are done. */
  next: Exclude<ThreadKey, "done"> | null;
  /** What the bar says: what is happening, or what to do next. */
  line: string;
  /** Every step done. */
  complete: boolean;
}

export const THREAD_LABELS: Record<ThreadKey, string> = { words: "Words", money: "Money in", protected: "Protected", device: "Second device", done: "Done" };
const ORDER: Exclude<ThreadKey, "done">[] = ["words", "money", "protected", "device"];

export interface ThreadFacts {
  /** Where the account stands (the core's account.state). */
  stage: "needs-funding" | "needs-backup" | "ready";
  /** The backup words are on the account and checked (no "check later" due), or checked before the money (J2). */
  wordsDone: boolean;
  /** Set-up can take the words before the money (J2: the core's `wordsDue`, the phone). */
  wordsFirst?: boolean;
  /** Money reached the account: the Safe holds some, or the funding saw it arrive. Null: not read yet. */
  moneyIn: boolean | null;
  /** The funding on record (account.fund.status), if any. */
  fund?: FundView | null;
  /** The account's rules hold protection for big payments. Null: not read yet. */
  protection: boolean | null;
  /** A second device (laptop, guardian or a kept second phone) is on the account. Null: not read yet. */
  secondDevice: boolean | null;
  /** The Safe in dollars, for the $5,000 line. */
  safeUsd?: number;
}

const fundDone = (f: FundView | null | undefined) => Boolean(f && (f.state === "opened" || f.state === "done"));

/** The money step's line while it is under way: the funding's own state, in one short sentence. */
function moneyLine(f: FundView | null | undefined): string {
  if (!f) return "Add money to your Safe";
  if (f.waitsForWords) return "Your NEAR is here"; // O-2c: nothing opens before the words
  // O-1: the bar says the automatic steps as AgentZero acting (display only; the core does them).
  // D155 (product decision, 3 Nov): set-up says what happens, plainly; no AgentZero line here
  if (f.state === "waiting" || nothingSeen(f)) return `Waiting for your ${f.coin.symbol}`;
  if (f.state === "working") return f.coin.id === "near" ? "Some NEAR arrived, not all" : `Your ${f.coin.symbol} is here`;
  if (f.state === "opening") return "Opening your account";
  return fundTitle(f.state);
}

export function threadOf(f: ThreadFacts): Thread {
  const done: Record<Exclude<ThreadKey, "done">, boolean | null> = {
    // checked: with the account ready, or before the money (J2, the core's own mark); never while the words still wait
    words: f.wordsDone && f.stage !== "needs-backup",
    // a funding on record that isn't through yet (or set-up still waiting for money) is the money step under way
    money: f.moneyIn === true || fundDone(f.fund) ? true : f.fund || f.stage === "needs-funding" ? false : f.moneyIn,
    protected: f.protection,
    device: f.secondDevice,
  };
  // Words first (J2): where the words go on chain with the account (the phone), they are written down and checked before
  // any money, so the bar's order is the flow's. Where they can't come first (a browser keeps no words before the
  // account, K-2), the money is the step while it is still coming; once the account is open, the words are.
  const reachable = (k: Exclude<ThreadKey, "done">) => (f.stage === "needs-funding" ? k === "money" || (k === "words" && f.wordsFirst === true) : f.stage === "needs-backup" ? k === "words" || k === "money" : true);
  const next = ORDER.find((k) => done[k] === false && reachable(k)) ?? null;
  const complete = ORDER.every((k) => done[k] === true);
  const steps: ThreadStep[] = [...ORDER.map((key) => ({ key, label: THREAD_LABELS[key], state: (done[key] === true ? "done" : key === next ? "now" : "todo") as StepState })), { key: "done", label: THREAD_LABELS.done, state: complete ? "done" : "todo" }];
  let line = "Your account is set up";
  if (next === "words") line = f.stage === "ready" ? "Check your backup words" : "Write down your backup words";
  if (next === "money") line = moneyLine(f.fund);
  if (next === "protected") line = "Choose what big payments need";
  // one line, one idea (design review §1.2: "More than $5,000 is here." belongs on Devices, not over the money)
  if (next === "device") line = "Add a second device";
  return { steps, next, line, complete };
}

/** Is there anything for the bar to show: a next step, read from facts. Nothing unknown is ever offered. */
export const threadShows = (t: Thread): boolean => t.next !== null;
