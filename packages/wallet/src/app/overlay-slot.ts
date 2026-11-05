// One overlay place, several drawers (S10b, the copy review's Sim walk, 5 Nov: an Activity row's tap "did nothing"). Activity's row page
// and its live Jobs tracker draw through the same `overlay` (the Activity centre's, or Home's). The tracker set it on every
// read of its jobs (about every 4 s, and at once on a job's change), null when nothing of its own was open: that closed a
// row's page about two seconds after it opened. Each drawer now draws or clears only what it drew itself.
import type { ReactNode } from "react";

export interface OwnSlot {
  /** Draw this (null: take away what this drawer drew; nothing when it drew nothing). */
  draw(node: ReactNode): void;
  /** The drawer goes: what it drew goes with it, nothing else. */
  release(): void;
}

export function ownSlot(set: (node: ReactNode) => void): OwnSlot {
  let drew = false;
  return {
    draw(node) {
      if (node) { set(node); drew = true; return; }
      if (drew) { drew = false; set(null); }
    },
    release() {
      if (drew) { drew = false; set(null); }
    },
  };
}
