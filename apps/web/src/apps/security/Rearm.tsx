// Face ID changed on the phone (audit IOS-1, IOS-1b): ZeroFee stops approving with it, so someone who knows the passcode
// can't add their face and spend. The 24 words, typed on ZeroFee's own screen, turn approvals back on (recovery.rearm).
// The account key on this phone stopped too, and only a move brings it back (the contract's rule): the second button
// starts that with the same words.
import { useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { waitName } from "../../screens/recovery-words.ts";
import { More } from "@zerofee/design/More.tsx";

/** `delaySeconds`: the account's recovery wait (release 7: chosen at set-up); `secondDevice`: a move also needs its yes. */
export function Rearm({ bridge, onProblem, onMoving, startOpen = false, delaySeconds = 172_800, secondDevice = false }: { bridge: Bridge; onProblem: (p: Problem) => void; onMoving: () => void; startOpen?: boolean; delaySeconds?: number; secondDevice?: boolean }) {
  const wait = waitName(delaySeconds);
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<"idle" | "asking" | "done">("idle");
  const go = async (thenRecover: boolean) => {
    if (state === "asking") return;
    setState("asking");
    const r = await bridge.call<{ rearmed: true; readyAtIso?: string }>("recovery.rearm", { thenRecover });
    if ("problem" in r) {
      setState("idle");
      return onProblem(r.problem);
    }
    if (r.ok.readyAtIso) return onMoving();
    setState("done");
  };
  if (!open) return <button className="zf-link sec-act" style={{ display: "block", marginInline: "auto", marginTop: 18 }} onClick={() => setOpen(true)}>Face ID changed? Turn approvals back on</button>;
  return (
    <div className="sec-rearm" style={{ marginTop: 22 }}>
      <div className="zf-label sec-sub">Face ID changed</div>
      {state === "done" ? (
        <p className="zf-body" role="status">Spending approves with Face ID again. Your Safe's key still has to move here.</p>
      ) : (
        <>
          <p className="zf-small">A Face ID change stops approvals. Your 24 words turn them back on.</p>
          <p className="zf-small sec-rearm__warn" style={{ marginTop: 8 }}>Didn't change it yourself? Reset Face ID and set up only your face.</p>
          <More label="How this works" lines={[
            "If a face is added to this phone, ZeroFee stops approving. Same if Face ID is reset. So a thief with your passcode can't add a face and spend.",
            "To remove an extra face: Settings, Face ID & Passcode, Reset Face ID.",
            `Your account key on this phone stopped too. Moving it back waits ${wait}${secondDevice ? " and needs your second device's yes" : ""}. This phone can stop it. Your trading rows come back with it.`,
          ]} />
          <button className="zf-btn" style={{ marginTop: 16 }} disabled={state === "asking"} onClick={() => void go(false)}>Turn approvals back on</button>
          <button className="zf-link sec-act" style={{ display: "block", marginInline: "auto", marginTop: 12 }} disabled={state === "asking"} onClick={() => void go(true)}>Also move my account key ({wait})</button>
        </>
      )}
    </div>
  );
}
