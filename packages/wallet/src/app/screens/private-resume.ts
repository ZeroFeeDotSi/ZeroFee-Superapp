// the audit's way-home audit P3 (7 Nov): a reload mid way home kept the Jobs row (job-start reopenOf "resume") but Private's
// page held `away` and `madeAt` in memory only: all of it gone, it said "$0.00" and "Nothing here yet."; coins still
// listed showed a live "Move it all to your Safe" and a lit Move over money already on its way. The page now reads the
// open way home back: its starting row still going, and the parts its carry kept by id the moment the core answered.
// Pure: a table test.
import { PRIVATE_HOME_TITLE, STARTING } from "@zerofee/shell-api/job-start.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";

/** The way home still going, as the job rows and their carry keep it: its figure at the tap, its movements, its tap. */
export function resumeAway(tasks: readonly Pick<Task, "id" | "title" | "state" | "usd" | "startedAt">[], partsOf: (job: string) => readonly string[] | undefined): { usd: string; ids: string[]; madeAt: number } | null {
  for (const t of tasks) {
    if (t.state !== "pending" || t.title !== PRIVATE_HOME_TITLE || !t.id.startsWith(STARTING) || !t.usd) continue;
    const ids = partsOf(t.id);
    // before the core answered no parts are kept: the reopen ended that row (unsure or closed), never this page's
    if (ids?.length) return { usd: t.usd, ids: [...ids], madeAt: t.startedAt ?? 0 };
  }
  return null;
}
