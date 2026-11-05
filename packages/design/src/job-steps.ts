// The job tracker's plain parts (JobTracker.tsx draws): the step's shape, its time in words, and the crawl's step mark.
export type JobStepState = "waiting" | "doing" | "done" | "failed";
export interface JobStep {
  /** A short stable name for the crawl's marks: "safe", "near", "intents", "sol". */
  key: string;
  /** The place or the party, in the product voice: "Your Safe signed", "NEAR Intents is moving it". */
  label: string;
  state: JobStepState;
  /** The engine's own time from the job's start, once done ("0:41"); none: no time is shown, never a made-up one. */
  atMs?: number;
}
export interface JobProof { chain: string; hash: string }

/** The step's time in words: "0.6 s" under 10 s, "41 s" under a minute, "2 min" after. */
export const stepTime = (ms: number): string => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** A crawl's mark for a step: `step:<key>:<state>` on performance and in window.__zfTap (tap.ts's list). */
export function markStep(key: string, state: JobStepState): void {
  const g = globalThis as { performance?: Performance; __zfTap?: { mark: string; t: number }[] };
  const name = `step:${key}:${state}`;
  const t = g.performance?.now?.() ?? 0;
  try { g.performance?.mark?.(name); } catch { /* a page without the mark API */ }
  (g.__zfTap ??= []).push({ mark: name, t });
}

