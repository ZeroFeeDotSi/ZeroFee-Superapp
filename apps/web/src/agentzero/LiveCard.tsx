// AgentZero's browser inside the chat (D122): a small card that opens and closes, never a full-screen takeover. A
// "browse" sheet from the turn carries the task; the person's tap on Start begins it (useLiveSession, the same session
// the Browser tab uses: nothing copied). The card says what AgentZero is doing, and gives Stop, Take over and Hand back;
// "Watch" opens the Browser tab where the page itself runs (on the iPhone). It never pays: NEVER_HERE says so.
import { useEffect, useMemo, useState } from "react";
import { onSecond, receiptLeft, tookIn } from "@zerofee/shell-api/job-steps.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { useLiveSession } from "@zerofee/browser/agent/use-live-session";
import { AGENT_BROWSER, KEEP_OPEN_LINE, NEVER_HERE, liveLine, runPlan, type Live } from "@zerofee/browser/agent/live";
import { OPEN_ON_IPHONE } from "@zerofee/browser/agent/phone";
import { browserBridge } from "./browser-bridge.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { cardKey, cardWas, keepCardRun } from "./live-card-was.ts";
import { simSitesOn } from "@zerofee/browser/sim/sites-data";

/** b18: the Sim's run never calls a host (sites-data simAgent is its whole browser). */
const SIM_NO_HOST: Bridge = { call: async () => ({ problem: { code: "host.unavailable", whatHappened: "Not in the Sim.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }), on: () => () => {} };

/** The site a task names, plainly (https only), or null. */
export const hostOf = (url: string | null): string | null => {
  try {
    const u = url ? new URL(url) : null;
    return u && u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
};

export function LiveCard({ task, url, at = "" }: { task: string; url: string | null; /** b18: the card's place in the chat (its message id and part), so two cards with the same words are two cards */ at?: string }) {
  // b18: the Sim needs no Browser app here: its run is the Sim's own (its made-up sites, its own thinker)
  const browser = useMemo(() => browserBridge() ?? (simSitesOn() ? SIM_NO_HOST : null), []);
  // no Browser app here (the sample demo, a computer): the same card, saying where it works
  if (!browser) return <Card line={`AgentZero will open ${hostOf(url) ?? "a site"} for you.`} state="Browser" task={task} off={AGENT_BROWSER ? OPEN_ON_IPHONE : "AgentZero's browser is off in this version."} />;
  return <LiveCardOn browser={browser} task={task} url={url} at={at} />;
}

function Card({ line, state, task, off }: { line: string; state: string; task: string; off: string }) {
  return (
    <details className="azc-step azc-live" open>
      <summary><span className="azc-step-line">{line}</span><span className="zf-small azc-step-state">{state}</span></summary>
      <p className="zf-small">{task}</p>
      <p className="zf-small azc-system">{off}</p>
      <p className="zf-small azc-step-state">{NEVER_HERE}</p>
    </details>
  );
}

/** E3 + E5: the card's time line on the run's one clock: time left while AgentZero works ("About 40 seconds left."), how
 *  long it took once it finished ("Took 23 s."), nothing on the person's turn or after a stop. Pure. */
export function runTimeLine(s: Live, now: number): string | null {
  // audit 17's H8: a run that didn't find it says its time too, beside "Didn't finish."
  if (s.phase === "ended") return (s.done || s.missed) && typeof s.at === "number" && typeof s.endedAt === "number" ? tookIn(s.endedAt - s.at) : null;
  if ((s.phase === "agent" || s.phase === "starting") && typeof s.endsAt === "number") return receiptLeft(s.endsAt, now, s.at);
  return null;
}

/** Audit 17's H7 + H8: the card's state word by how the run ended ("Done", "Stopped", "Didn't finish."), and its tone:
 *  a run that didn't finish is in the problem colour; a person's Stop is not a problem. Pure. */
export function runChip(s: Live): { word: string; tone?: "problem" } {
  if (s.phase === "agent" || s.phase === "starting") return { word: "Working" };
  if (s.phase === "you") return { word: "Your turn" };
  if (s.phase === "ended") return s.done ? { word: "Done" } : s.stopped ? { word: "Stopped" } : { word: "Didn't finish.", tone: "problem" };
  return { word: "Browser" };
}

/** Audit 17's H6: the run's plan from its first frame (live.ts runPlan), each step ticking on the run's own events. */
function RunPlan({ s, host }: { s: Live; host: string | null }) {
  const plan = runPlan(s, host);
  return plan.length ? <ol className="azc-plan" data-testid="az-run-plan">{plan.map((p) => <li key={p.label} className="zf-small" data-state={p.state}>{p.label}</li>)}</ol> : null;
}

/** The run's time line, ticking on the second (job-steps onSecond: the Activity row ticks on the same second). */
function RunTime({ s }: { s: Live }) {
  const [now, setNow] = useState(() => Date.now());
  const going = s.phase === "agent" || s.phase === "starting";
  useEffect(() => {
    if (!going) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => (setNow(Date.now()), (t = setTimeout(tick, onSecond(1000, Date.now()))));
    t = setTimeout(tick, onSecond(1000, Date.now()));
    return () => clearTimeout(t);
  }, [going]);
  const line = runTimeLine(s, going ? now : Date.now());
  return line ? <p className="zf-small azc-step-state" data-testid="az-run-time">{line}</p> : null;
}

function LiveCardOn({ browser, task, url, at }: { browser: Bridge; task: string; url: string | null; at: string }) {
  const shell = useShell();
  const live = useLiveSession(browser);
  const host = hostOf(url);
  const s = live.state;
  const line = s.phase === "idle" ? `AgentZero will open ${host ?? "a site"} for you.` : liveLine(s);
  const chip = runChip(s);
  const off = live.sim ? null : !AGENT_BROWSER ? "AgentZero's browser is off in this version." : !live.phone ? OPEN_ON_IPHONE : null;
  // b18 (4a): the card's own run from before a reload, read back from its Activity row (never Start again)
  const key = useMemo(() => cardKey(task, url, at), [task, url, at]);
  const [rows, setRows] = useState(() => taskStore().list());
  useEffect(() => taskStore().subscribe(() => setRows(taskStore().list())), []);
  useEffect(() => {
    if (s.phase === "starting" && typeof s.at === "number") keepCardRun(key, s.at);
  }, [key, s.phase, s.at]);
  const was = s.phase === "idle" ? cardWas(key, rows) : null;
  if (was) {
    return (
      <details className="azc-step azc-live" open data-card={key}>
        <summary><span className="azc-step-line">{was.line}</span><span className="zf-small azc-step-state">{was.chip}</span></summary>
        <p className="zf-small">{task}</p>
        {was.took && <p className="zf-small azc-step-state" data-testid="az-run-time">{was.took}</p>}
        <p className="zf-small azc-step-state">{NEVER_HERE}</p>
      </details>
    );
  }
  return (
    <details className="azc-step azc-live" open data-card={key}>
      <summary><span className="azc-step-line">{line}</span><span className="zf-small azc-step-state" data-tone={chip.tone} data-testid="az-run-chip">{chip.word}</span></summary>
      <p className="zf-small">{task}</p>
      {s.phase === "ended" && s.summary && <p className="zf-small azc-live-report" data-testid="az-run-report">{s.summary}</p>}
      <RunPlan s={s} host={host} />
      <RunTime s={s} />
      {/* H9: never on the person's turn (the line says what to tap) */}
      {!off && s.phase !== "ended" && s.phase !== "you" && <p className="zf-small azc-step-state">{KEEP_OPEN_LINE}</p>}
      {off ? (
        <p className="zf-small azc-system">{off}</p>
      ) : (
        <div className="azc-acts">
          {s.phase === "idle" && <button type="button" className="azc-act" onClick={() => live.start(task, url, host)}>Start</button>}
          {(s.phase === "starting" || s.phase === "agent" || s.phase === "you") && <button type="button" className="azc-act azc-act--quiet" onClick={() => live.stop()}>Stop</button>}
          {s.phase === "agent" && <button type="button" className="azc-act-link" onClick={() => live.takeOver()}>Take over</button>}
          {s.phase === "you" && s.why === "took-over" && <button type="button" className="azc-act-link" onClick={() => live.handBack()}>Hand back</button>}
          {s.phase !== "idle" && s.phase !== "ended" && <button type="button" className="azc-act-link" onClick={() => shell.openApp("browser")}>Watch</button>}
        </div>
      )}
      <p className="zf-small azc-step-state">{NEVER_HERE}</p>
    </details>
  );
}
