// Say no's confirm words (release 10, the laptop veto): their own module, imported only by the second device's list,
// the guardian's screen and the confirm sheet, so none of it rides in Home's first load with recovery-words.ts (which
// re-exports second-device-words.ts).
// Release 10 (round 2, the laptop veto; contract round 3's MUST): a no from a second device of age pauses the main
// device for a change's wait (lib.rs `decline`, `floor_ns`), so Say no asks first, in these words (the Copywriter's).
// `{wait}`: that wait, from the account's own delay (pauseWait). `maybe…`: the account couldn't be read just then (the
// core's pauseUnknown), so it asks all the same, saying "may" and no length.
const NO_PAUSE_SHARED = { headTitle: "Before you say no", sayNo: "Say no anyway", back: "Go back" };
export const NO_PAUSE = {
  mine: {
    ...NO_PAUSE_SHARED,
    title: "This pauses your main device for {wait}",
    maybeTitle: "This may pause your main device",
    maybeLead: "If it does:",
    lines: ["Its Face ID payments stop, AgentZero's too.", "Anything it asked alone that still waits ends too.", "It can't ask for anything new that has to wait.", "Your backup words can end the pause at any time."],
  },
  theirs: {
    ...NO_PAUSE_SHARED,
    title: "This pauses their main device for {wait}",
    maybeTitle: "This may pause their main device",
    maybeLead: "If it does:",
    lines: ["Their Face ID payments stop, AgentZero's too.", "Anything they asked alone that still waits ends too.", "Their device can't ask for anything new that has to wait.", "Their backup words can end the pause at any time."],
  },
} as const;

/** The pause's length in words: hours up to 72 (48 or 72 on the app's 24- and 48-hour accounts), else whole days
 *  (a 3-day account's 4 days, a 7-day account's 8), else hours. */
export function pauseWait(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours <= 72 || hours % 24 !== 0) return `${hours} hours`;
  return `${hours / 24} days`;
}

/** What a tap does: Say yes, or a no that pauses nothing, is answered at once; a no that pauses asks first. */
export const sayNoFirst = (r: { pauseSeconds?: number | undefined; pauseUnknown?: boolean | undefined }, approve: boolean): "answer" | "ask" => (approve || (r.pauseSeconds === undefined && !r.pauseUnknown) ? "answer" : "ask");
