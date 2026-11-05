// What a browser's first visit chose before the lock (FirstRun.tsx): create, restore or guard, and the recovery wait.
// On its own so the App reads them in Home's first load without the set-up screens (speed budget, 5 Nov).
import type { DelayChoice } from "./recovery-words.ts";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { setupFinished, setupUnfinished } from "./setup-unfinished.ts";

/** "guard" (dead ends row 16): this browser as another account's second phone or guardian, with no account of its own. */
export type FirstChoice = "create" | "restore" | "guard";
/** The recovery wait chosen at set-up (release 7), until account.create carries it; none: the core's default (48 h). */
let delay: number | null = null;
export const setChosenDelay = (seconds: number) => { delay = seconds; };
export const chosenDelay = () => delay;
/** The release's own set-up choices, as the core's account.recoveryChoices gives them (off mainnet, a minute too, for the
 *  short-waits build): for the screen shown before the core is open. */
export const setupChoices = (mainnet: boolean): DelayChoice[] =>
  (mainnet ? ACCOUNT_POLICY.recoveryDelayChoices : [60, ...ACCOUNT_POLICY.recoveryDelayChoices]).map((seconds) => ({ seconds, default: seconds === ACCOUNT_POLICY.defaultRecoveryDelaySeconds }));
/** Grade 01d, Q8: set-up's unfinished mark (setup-unfinished.ts, on its own so the lock screen can read it). */
export { setupFinished, setupUnfinished };
let choice: FirstChoice | null = null;
export const setFirstChoice = (c: FirstChoice) => { choice = c; };
/** The choice made before the lock, once: App reads it when the core says there is no account yet. */
export const takeFirstChoice = (): FirstChoice | null => {
  const c = choice;
  choice = null;
  return c;
};

