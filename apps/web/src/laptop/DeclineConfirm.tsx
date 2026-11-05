// Say no's one confirm (release 10, the laptop veto; contract round 3's MUST): a second device of age's no pauses the
// main device for a change's wait and ends what it asked alone (lib.rs `decline`), so before the no is sent this says
// so, on the one full-screen sheet (D135: whole screen, Close, a fixed size). Close and Go back send nothing.
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { NO_PAUSE, pauseWait } from "./decline-words.ts";

/** `whose` "mine": the person's own laptop; "theirs": a guardian, for someone else's account. `seconds` null: the account
 *  couldn't be read just then (pauseUnknown), so it says "may", with no length. */
export function DeclineConfirm({ seconds, whose, onNo, onBack }: { seconds: number | null; whose: "mine" | "theirs"; onNo: () => void; onBack: () => void }) {
  const w = NO_PAUSE[whose];
  return (
    <Sheet title={w.headTitle} onClose={onBack}>
      <div className="decline-confirm" data-testid="decline-confirm">
        <h2 className="zf-title">{seconds === null ? w.maybeTitle : w.title.replace("{wait}", pauseWait(seconds))}</h2>
        {seconds === null && <p className="zf-body" style={{ marginTop: 10 }}>{w.maybeLead}</p>}
        {w.lines.map((l) => <p key={l} className="zf-body" style={{ marginTop: 10 }}>{l}</p>)}
        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
          <button className="zf-btn alert" data-act="say-no" onClick={onNo}>{w.sayNo}</button>
          <button className="zf-link" data-act="go-back" onClick={onBack}>{w.back}</button>
        </div>
      </div>
    </Sheet>
  );
}
