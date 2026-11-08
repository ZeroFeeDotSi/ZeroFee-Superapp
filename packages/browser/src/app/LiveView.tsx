// "Send AgentZero" and its live view (D79, BR1–BR3), loaded only when opened and only behind AGENT_BROWSER. The remote
// page is AgentZero's cloud browser: read-only while it acts; on the person's turn (Take over, or a page that needs them)
// it becomes touchable and AgentZero waits. Stop is always on screen. The live-view URL is a bearer secret: it lives in
// the frame's src only, never in a log, a line or a receipt.
import { useEffect, useMemo, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import { LIVE_ORIGINS, NEVER_HERE, liveFrameUrl, liveLine, readTask, touchable } from "../agent/live.ts";
import { OPEN_ON_IPHONE, forgetSite } from "../agent/phone.ts";
import { useLiveSession } from "../agent/use-live-session.ts";
import "./live.css";


export default function LiveView({ onClose }: { onClose: () => void }) {
  const { bridge } = useShell();
  // D114: on the phone, no cloud; anywhere else the view says to open the iPhone app. The session, the live URL and the
  // "AgentZero is working" dot all come from the one hook the Browser tab's sheet uses too (D118).
  const live = useLiveSession(bridge);
  // only the cloud browser's own https origins (audit L30); anything else shows no page
  const liveUrl = liveFrameUrl(live.liveUrl, LIVE_ORIGINS);
  const { state } = live;
  const cloud = live.phone;
  const session = live.phone ? live : null;
  const [typed, setTyped] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  // The last site it was on, for "Forget this site" once the task ends (M12).
  const [lastHost, setLastHost] = useState<string | null>(null);
  useEffect(() => {
    if ((state.phase === "agent" || state.phase === "you") && state.host) setLastHost(state.host);
  }, [state]);

  if (!cloud || !session) return <p className="zf-note br-note">{OPEN_ON_IPHONE}</p>;

  if (state.phase === "idle") {
    return (
      <div className="br-page zf-enter">
        <p className="zf-label br-head">What should AgentZero do?</p>
        <form
          className="br-field"
          onSubmit={(e) => {
            e.preventDefault();
            const r = readTask(typed);
            if (!r.ok) return setSaid(r.line);
            setSaid(null);
            void session.start(r.task, r.url, r.host);
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Sign in to Axiom" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" aria-label="What AgentZero should do" />
          <button type="submit" className="zf-btn">Go</button>
        </form>
        {said && <p className="zf-note br-note" role="status">{said}</p>}
        <p className="zf-small">{NEVER_HERE}</p>
      </div>
    );
  }

  const yours = touchable(state);
  return (
    <div className="br-live">
      <p className="br-live-chip" role="status">{liveLine(state)}</p>
      {state.phase === "agent" && state.steps?.length ? (
        <ol className="br-live-steps" aria-label="AgentZero's steps">
          {state.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      ) : null}
      {liveUrl && state.phase !== "ended" && (
        <iframe className="br-live-page" title="AgentZero's browser" src={liveUrl} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" style={{ pointerEvents: yours ? "auto" : "none" }} />
      )}
      <div className="br-live-floor">
        {state.phase === "agent" && <button className="zf-btn zf-btn--quiet" onClick={session.takeOver}>Take over</button>}
        {state.phase === "you" && <button className="zf-btn" onClick={session.handBack}>Hand back</button>}
        {state.phase === "ended" && lastHost && <button className="zf-btn zf-btn--quiet" onClick={() => void forgetSite(bridge, lastHost).then(setSaid)}>{`Forget ${lastHost}`}</button>}
        {state.phase === "ended" ? <button className="zf-btn" onClick={onClose}>Done</button> : <button className="zf-btn zf-btn--danger" onClick={session.stop}>Stop</button>}
      </div>
      {said && state.phase === "ended" && <p className="zf-note br-note" role="status">{said}</p>}
    </div>
  );
}
