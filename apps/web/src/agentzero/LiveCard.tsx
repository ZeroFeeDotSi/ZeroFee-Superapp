// AgentZero's browser inside the chat (D122): a small card that opens and closes, never a full-screen takeover. A
// "browse" sheet from the turn carries the task; the person's tap on Start begins it (useLiveSession, the same session
// the Browser tab uses: nothing copied). The card says what AgentZero is doing, and gives Stop, Take over and Hand back;
// "Watch" opens the Browser tab where the page itself runs (on the iPhone). It never pays: NEVER_HERE says so.
import { useMemo } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { useLiveSession } from "@zerofee/browser/agent/use-live-session";
import { AGENT_BROWSER, NEVER_HERE, liveLine } from "@zerofee/browser/agent/live";
import { OPEN_ON_IPHONE } from "@zerofee/browser/agent/phone";
import { browserBridge } from "./browser-bridge.ts";

/** The site a task names, plainly (https only), or null. */
export const hostOf = (url: string | null): string | null => {
  try {
    const u = url ? new URL(url) : null;
    return u && u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
};

export function LiveCard({ task, url }: { task: string; url: string | null }) {
  const browser = useMemo(() => browserBridge(), []);
  // no Browser app here (the sample demo, a computer): the same card, saying where it works
  if (!browser) return <Card line={`AgentZero will open ${hostOf(url) ?? "a site"} for you.`} state="Browser" task={task} off={AGENT_BROWSER ? OPEN_ON_IPHONE : "AgentZero's browser is off in this version."} />;
  return <LiveCardOn browser={browser} task={task} url={url} />;
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

function LiveCardOn({ browser, task, url }: { browser: Bridge; task: string; url: string | null }) {
  const shell = useShell();
  const live = useLiveSession(browser);
  const host = hostOf(url);
  const s = live.state;
  const line = s.phase === "idle" ? `AgentZero will open ${host ?? "a site"} for you.` : liveLine(s);
  const off = !AGENT_BROWSER ? "AgentZero's browser is off in this version." : !live.phone ? OPEN_ON_IPHONE : null;
  return (
    <details className="azc-step azc-live" open>
      <summary><span className="azc-step-line">{line}</span><span className="zf-small azc-step-state">{s.phase === "agent" || s.phase === "starting" ? "Working" : s.phase === "you" ? "Your turn" : s.phase === "ended" ? "Done" : "Browser"}</span></summary>
      <p className="zf-small">{task}</p>
      {off ? (
        <p className="zf-small azc-system">{off}</p>
      ) : (
        <div className="azc-acts">
          {s.phase === "idle" && <button type="button" className="azc-act" onClick={() => live.start(task, url, host)}>Start</button>}
          {(s.phase === "starting" || s.phase === "agent") && <button type="button" className="azc-act azc-act--quiet" onClick={() => live.stop()}>Stop</button>}
          {s.phase === "agent" && <button type="button" className="azc-act-link" onClick={() => live.takeOver()}>Take over</button>}
          {s.phase === "you" && s.why === "took-over" && <button type="button" className="azc-act-link" onClick={() => live.handBack()}>Hand back</button>}
          {s.phase !== "idle" && s.phase !== "ended" && <button type="button" className="azc-act-link" onClick={() => shell.openApp("browser")}>Watch</button>}
        </div>
      )}
      <p className="zf-small azc-step-state">{NEVER_HERE}</p>
    </details>
  );
}
