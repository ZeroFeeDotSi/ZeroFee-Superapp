// Approve's arm (the audit's R4, 6 Nov; the audit's ruling (c), 8 Nov): off for ARM_MS after a sheet appears, so a tap meant for the
// app can't land on it. The core's sheet that takes the Getting-ready sheet's place with the same headline keeps that
// sheet's arm (the same figures never restart it); another headline, or a sheet whose signed quote broke the plan's bound
// (its head, COSTS_MORE_HEAD), re-arms: Approve goes off and the arm starts again from when it came. Pure: a table test.
import { COSTS_MORE_HEAD } from "@zerofee/core/float-floors";
export { COSTS_MORE_HEAD };

/** How long Approve stays off after a sheet appears, so a tap meant for the app can't land on it. */
export const ARM_MS = 700;

/** The Getting-ready sheet whose arm this sheet keeps, or null: it re-arms. */
export function keptArm<G extends { headline: string }>(getting: G | null, words: { title: string; lines: readonly string[] }): G | null {
  return getting && getting.headline === words.title && !words.lines.includes(COSTS_MORE_HEAD) ? getting : null;
}

