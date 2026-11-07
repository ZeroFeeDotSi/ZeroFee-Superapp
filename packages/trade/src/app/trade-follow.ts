// QA 16's MUST on T12 (8 Nov): Trade's runtime (TradeProvider) isn't there at a cold start on Home. The shell draws an
// app only when it is on screen, kept, or Home's neighbour after NEIGHBOURS_AFTER_MS (AppHost), so a tray with Trade moved
// away, or a start on another app, never mounts it; and even mounted beside Home, TradeProvider asks the service to look
// at its open trades again (svc.resume) only once Trade is on screen. So after a reload a trade still checking was never
// followed, and its Jobs row never brought to it, until Trade was opened. Now the shell starts this once Home is up
// (App.tsx startHome), with Trade's own bridge, so the very runtime Trade uses (runtimeFor): the rows kept to their
// records (keepTradeTasks, one keeper per service, shared with TradeProvider's) and the open trades looked at again.
// Not Trade's screens: only its service and the rows.
import type { Bridge } from "@zerofee/core/bridge";
import { taskStore, type Tasks } from "@zerofee/shell-api/tasks.ts";
import { runtimeFor } from "../runtime.ts";
import type { TradeService } from "../service.ts";
import { keepTradeTasks } from "./trade-tasks.ts";

type Svc = Pick<TradeService, "on" | "activity" | "resume">;

export function followTrades(bridge: Bridge, o: { svc?: Svc; tasks?: Pick<Tasks, "update" | "end"> } = {}): () => void {
  const svc: Svc = o.svc ?? runtimeFor(bridge).svc;
  const stop = keepTradeTasks(svc, o.tasks ?? taskStore().forApp("trade"));
  // the open trades looked at again now, not when Trade is first opened (its own resume later finds them taken)
  void svc.resume().catch(() => undefined);
  return stop;
}
