// The one React entry point for AgentZero's browser task (D114, D118): the Browser tab's swipe-up sheet and LiveView use
// the same session, so nothing is copied. On the iPhone (its host bridge) the task runs in the tab's own web view; anywhere
// else there's no browser for AgentZero and `phone` is false (say OPEN_ON_IPHONE). The "AgentZero is working · Stop" dot
// is set while AgentZero acts and cleared on the person's turn, at the end, and when the caller unmounts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { pastRunMs, runTask, sweepClosedRuns } from "../site-tasks.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { setAgentZeroWorking } from "@zerofee/shell-api/agentzero-working.ts";
import { liveSession, type CloudBrowser, type Live } from "./live.ts";
import { phoneBrowser } from "./phone.ts";
import { simAgent } from "../sim/sites-data.ts";

/** Inside the ZeroFee iPhone app (its host bridge). */
export const inPhoneApp = (): boolean => typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: { zerofee?: unknown } } }).webkit?.messageHandlers?.zerofee;

/** E5: the runs going on this page (site-tasks.ts sweepClosedRuns ends every other run's row still going). */
const onThisPage = new Set<string>();
let sweeping = false;
function sweepOnce(): void {
  if (sweeping) return;
  sweeping = true;
  sweepClosedRuns(taskStore(), onThisPage);
  // the sealed copy joins after the unlock (tasks.ts keep): swept again on each change
  taskStore().subscribe(() => sweepClosedRuns(taskStore(), onThisPage));
}

/**
 * `bridge`: the "browser" app's bridge (PartnerBridge refuses others). `askAboveUsd`: a price on a page above it is the
 * person's turn; null (the default) means every price is the person's.
 */
export function useLiveSession(bridge: Bridge, o: { askAboveUsd?: number | null } = {}) {
  const askAboveUsd = o.askAboveUsd ?? null;
  // b18: in the Sim (never on the phone), the same loop and guards over the Sim's made-up sites and its own thinker
  const [simCloud, setSimCloud] = useState<CloudBrowser | null>(null);
  useEffect(() => {
    if (inPhoneApp()) return;
    let on = true;
    void simAgent().then((c) => void (on && c && setSimCloud(c)), () => undefined);
    return () => void (on = false);
  }, []);
  const cloud: CloudBrowser | null = useMemo(() => (inPhoneApp() ? phoneBrowser(bridge, { askAboveUsd }) : simCloud), [bridge, askAboveUsd, simCloud]);
  const [state, setState] = useState<Live>({ phase: "idle" });
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  // audit 17's H6: the first frame's time left from this device's own finished runs (Activity's rows)
  const session = useMemo(() => (cloud ? liveSession(cloud, setState, setLiveUrl, { pastMs: () => pastRunMs(taskStore().list()) }) : null), [cloud]);
  useEffect(() => () => session?.stop(), [session]);
  useEffect(() => {
    if (session && (state.phase === "agent" || state.phase === "starting")) setAgentZeroWorking({ host: state.phase === "agent" ? state.host : (state.host ?? "a site"), stop: session.stop });
    else setAgentZeroWorking(null);
  }, [session, state]);
  useEffect(() => () => setAgentZeroWorking(null), []);
  // D144: the run is one task in the Activity centre, each step as it happens, ended with the run's own line
  const tasks = useShell().tasks;
  useEffect(sweepOnce, []);
  const run = useRef<{ at: number; host: string | null; seen: string[]; ended: boolean } | null>(null);
  useEffect(() => {
    if (state.phase === "idle") return;
    if (state.phase === "starting" && (!run.current || run.current.ended)) {
      run.current = { at: state.at ?? Date.now(), host: state.host, seen: [], ended: false };
      onThisPage.add(`az-browser-${run.current.at}`);
    }
    const r = run.current;
    if (!r || r.ended) return;
    if (state.phase === "agent") {
      r.host = state.host;
      const last = state.steps?.at(-1);
      if (last && r.seen.at(-1) !== last) r.seen.push(last);
    }
    const t = runTask(state, r.seen, r.at, r.host);
    if (!t) return;
    tasks?.publish(t.task);
    if (t.end) {
      r.ended = true;
      onThisPage.delete(t.task.id);
      // the review's ruling: the final line (the report, its time) goes to the sealed store first, then the end
      tasks?.update(t.task.id, { detail: t.end.detail });
      tasks?.end(t.task.id, t.end.state, t.end.detail);
    }
  }, [state, tasks]);
  return {
    /** False off the iPhone: show OPEN_ON_IPHONE instead of a start button. */
    phone: session !== null,
    /** b18: the Sim's browser (its made-up sites, its own thinker), not the phone's. */
    sim: session !== null && !inPhoneApp(),
    state,
    /** The live view's own frame only (a bearer secret; never logged). Unused on the phone, where the tab's web view is it. */
    liveUrl,
    start: (task: string, url: string | null, host: string | null) => session?.start(task, url, host),
    stop: () => session?.stop(),
    takeOver: () => session?.takeOver(),
    handBack: () => session?.handBack(),
  };
}
