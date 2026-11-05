// H34: the account's first 24 hours, when adding a second device goes on at once (the contract's set-up window,
// lib.rs created_at_ns + a day; the core's account.state gives its end as setupUntilIso). After it, any change waits the
// floor (3 days on the 48-hour wait). Said while it lasts, with its end, so nobody learns it only after it closed.
//
// The words are careful: inside the window the device is ADDED at once; it still ages for recovery like any device, so
// this never says it "counts fully" at once (vault-gate.ts countsFullyLine says when it does).
import { changeWaitSeconds, waitPlain, whenWords } from "./rules.ts";

/** The line, or null when the window is over (or unknown). */
export function setupWindowLine(setupUntilIso: string | undefined, recoveryDelaySeconds: number, now = Date.now(), when: (iso: string) => string = (iso) => whenWords(iso)): string | null {
  if (!setupUntilIso) return null;
  const until = Date.parse(setupUntilIso);
  if (!Number.isFinite(until) || until <= now) return null;
  const later = recoveryDelaySeconds > 0 ? waitPlain(changeWaitSeconds(recoveryDelaySeconds)) : "longer";
  return `Add it by ${when(setupUntilIso)} and it's added at once. After that, adding takes ${later}.`;
}
