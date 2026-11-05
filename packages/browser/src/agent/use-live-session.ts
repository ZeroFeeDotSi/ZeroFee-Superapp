// The one React entry point for AgentZero's browser task (D114, D118): the Browser tab's swipe-up sheet and LiveView use
// the same session, so nothing is copied. On the iPhone (its host bridge) the task runs in the tab's own web view; anywhere
// else there's no browser for AgentZero and `phone` is false (say OPEN_ON_IPHONE). The "AgentZero is working · Stop" dot
// is set while AgentZero acts and cleared on the person's turn, at the end, and when the caller unmounts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runTask } from "../site-tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { setAgentZeroWorking } from "@zerofee/shell-api/agentzero-working.ts";
import { liveSession, type CloudBrowser, type Live } from "./live.ts";
import { phoneBrowser } from "./phone.ts";

/** Inside the ZeroFee iPhone app (its host bridge). */
export const inPhoneApp = (): boolean => typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: { zerofee?: unknown } } }).webkit?.messageHandlers?.zerofee;

/**
 * `bridge`: the "browser" app's bridge (PartnerBridge refuses others). `askAboveUsd`: a price on a page above it is the
 * person's turn; null (the default) means every price is the person's.
 */
export function useLiveSession(bridge: Bridge, o: { askAboveUsd?: number | null } = {}) {
  const askAboveUsd = o.askAboveUsd ?? null;
  const cloud: CloudBrowser | null = useMemo(() => (inPhoneApp() ? phoneBrowser(bridge, { askAboveUsd }) : null), [bridge, askAboveUsd]);
  const [state, setState] = useState<Live>({ phase: "idle" });
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const session = useMemo(() => (cloud ? liveSession(cloud, setState, setLiveUrl) : null), [cloud]);
  useEffect(() => () => session?.stop(), [session]);
  useEffect(() => {
    if (session && (state.phase === "agent" || state.phase === "starting")) setAgentZeroWorking({ host: state.phase === "agent" ? state.host : (state.host ?? "a site"), stop: session.stop });
    else setAgentZeroWorking(null);
  }, [session, state]);
  useEffect(() => () => setAgentZeroWorking(null), []);
  // D144: the run is one task in the Activity centre, each step as it happens, ended with the run's own line
  const tasks = useShell().tasks;
  const run = useRef<{ at: number; host: string | null; seen: string[]; ended: boolean } | null>(null);
  useEffect(() => {
    if (state.phase === "idle") return;
    if (state.phase === "starting" && (!run.current || run.current.ended)) run.current = { at: Date.now(), host: state.host, seen: [], ended: false };
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
      tasks?.end(t.task.id, t.end.state, t.end.detail);
    }
  }, [state, tasks]);
  return {
    /** False off the iPhone: show OPEN_ON_IPHONE instead of a start button. */
    phone: session !== null,
    state,
    /** The live view's own frame only (a bearer secret; never logged). Unused on the phone, where the tab's web view is it. */
    liveUrl,
    start: (task: string, url: string | null, host: string | null) => session?.start(task, url, host),
    stop: () => session?.stop(),
    takeOver: () => session?.takeOver(),
    handBack: () => session?.handBack(),
  };
}
