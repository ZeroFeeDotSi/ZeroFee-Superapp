// The shell's per-app queue of overlays (a Problem screen, a Waiting screen). Each app has its own first-in, first-out
// line; the shell shows the first item of whichever app is on screen, so a neighbour's Problem never covers the app the
// person is looking at, and an item asked for while another is showing waits its turn instead of replacing it. Every
// Problem resolves its own promise with the step the person tapped, no matter how many were queued behind it. The same
// Problem asked again while one is lined up is that one screen (its askers all get the step tapped).
//
// Pure: no React, no DOM, so it's unit-tested on its own (overlay-queue.test.ts).
import type { NextStep, Problem } from "@zerofee/core/problem";

export type Overlay =
  | { kind: "problem"; problem: Problem }
  /** `inPlace`: opened from a step on this app's own screen (a Top up's "Finish my new rules"): its Back and Done stay here. */
  | { kind: "waiting"; held: { id: string; readyAtIso: string; needsSecondDevice: boolean }; inPlace?: true };

interface Entry { item: Overlay; done: ((step: NextStep) => void)[] }

/** The same Problem (its code and its words) as one already lined up: one screen, never one per ask (QA, 4 Nov:
 *  each hold of Swap lined up "Solana's price isn't read yet" again, so after Close each Back showed the next copy and only a
 *  reload got out). */
const same = (a: Overlay, b: Overlay) => a.kind === "problem" && b.kind === "problem" && a.problem.code === b.problem.code && a.problem.whatHappened === b.problem.whatHappened;

export interface OverlayQueue {
  /** Line this item up behind the app's others. Resolves when the person finishes with it (a Problem: the tapped step). */
  push(app: string, item: Overlay): Promise<NextStep>;
  /** The item this app should be showing now, if any. */
  first(app: string): Overlay | undefined;
  /** The person finished with the app's first item: resolve it and move on. False when nothing was showing. */
  finish(app: string, step: NextStep): boolean;
  /** How many items this app has lined up (the showing one included). */
  count(app: string): number;
}

export function createOverlayQueue(): OverlayQueue {
  const lines = new Map<string, Entry[]>();
  const line = (app: string) => {
    let l = lines.get(app);
    if (!l) lines.set(app, (l = []));
    return l;
  };
  return {
    push(app, item) {
      return new Promise<NextStep>((done) => {
        const l = line(app), twin = l.find((e) => same(e.item, item));
        if (twin) twin.done.push(done);
        else l.push({ item, done: [done] });
      });
    },
    first(app) {
      return lines.get(app)?.[0]?.item;
    },
    finish(app, step) {
      const entry = lines.get(app)?.shift();
      if (!entry) return false;
      for (const done of entry.done) done(step);
      return true;
    },
    count(app) {
      return lines.get(app)?.length ?? 0;
    },
  };
}
