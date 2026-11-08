// Audit 18's I2 (builder 22, 8 Nov): a Move's job screen said "Job created. / Moving it to your Safe. / NEAR Confidential
// moves it. NEAR lands it. / About 2 min left." and the same 8 s later: no steps, while its Jobs row's steps tick. A job's
// receipt now draws its own rows' steps (its starting row, then the core's rows it was made with: job-start jobRows), each
// as its row says it and ticked only on that row's read (live-steps' watch updates the rows). No time on a step: the
// receipt keeps its one clock.
import { jobRows } from "@zerofee/shell-api/job-start.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";

export interface RowStep { key: string; label: string; state: string }

/** The job's steps, row by row, in the store's order. None: no job yet, or no row of it in the store. */
export function jobStepsOf(list: readonly Pick<Task, "id" | "steps">[], job: string | null | undefined): RowStep[] {
  if (!job) return [];
  const mine = jobRows(job);
  return list.filter((t) => mine(t.id)).flatMap((t) => (t.steps ?? []).map((x, i) => ({ key: `${t.id}:${i}`, label: x.label, state: x.state })));
}
