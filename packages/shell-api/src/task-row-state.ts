// A task's row mark in Activity (TaskCentre.tsx). Audit 18's I5 (builder 22's item 12): a Stop (the person's own, or a run
// that ended with nothing done) is no error: a neutral mark; only a failure wears the problem colour ("Didn't finish.").
import type { LiveRowState } from "@zerofee/design/live-row.ts";
import type { Task } from "./tasks.ts";

export const ROW_STATE: Record<Task["state"], LiveRowState> = { pending: "going", done: "done", failed: "stopped", stopped: "ended" };
