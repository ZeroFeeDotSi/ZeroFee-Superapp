// The Safe update's held screen (the design review's spec U3/U4; product decision, 5 Nov): always findable, from
// Home's card or line and from Security's Protection. Its time is the contract's own (account.safeUpdate's readyAtIso,
// read again every 15 seconds and whenever a waiting request ends), never a typed number. It says who can still stop it
// and has Cancel; once ready, Finish runs both steps (one Face ID); then "Your Safe is up to date." Unknown code waiting
// is red and only offers Cancel (MUST 1). Loaded only when opened (App.tsx, lazy), never in Home's first load.
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { useBack } from "@zerofee/design/back.ts";
import { ShieldDown, askUpdate, useSafeUpdate } from "./SafeUpdateCard.tsx";
import { SAFE_UPDATE_WORDS as W, atLine, cardLine, stopLines, whenLine } from "./safe-update-words.ts";

export function SafeUpdateHeld({ bridge, onClose, onProblem }: { bridge: Bridge; onClose: () => void; onProblem: (p: Problem) => void }) {
  const [u, reread] = useSafeUpdate(bridge);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useBack(onClose, el);
  // The spec's 15 s: the words count down, and the contract is read again (its ready time can move: a laptop's yes).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      reread();
    }, 15_000);
    return () => clearInterval(t);
  }, []);
  const send = async (method: string, then: () => void) => {
    setBusy(true);
    try {
      const res = await bridge.call<TxOutcome>(method);
      if ("problem" in res) return onProblem(res.problem);
      if (res.ok.status === "problem") return onProblem(res.ok.problem);
      if (res.ok.status === "done") then();
    } finally {
      setBusy(false);
      reread();
    }
  };

  const close = <button type="button" className="zf-link su-held__close" onClick={onClose}>{W.close}</button>;
  if (done) {
    return (
      <div className="zf-screen su-held" ref={el}>
        <div className="su-held__body">
          <div className="su-ring"><ShieldDown size={56} tick /></div>
          <h1 className="su-held__title">{W.doneTitle}</h1>
        </div>
        <div className="su-held__floor"><button type="button" className="zf-btn" onClick={onClose}>{W.done}</button></div>
      </div>
    );
  }
  if (!u) return <div className="zf-screen su-held" ref={el}>{close}</div>;
  if (u.state === "unknown") {
    return (
      <div className="zf-screen su-held su-held--bad" ref={el} data-testid="safe-update-held-unknown">
        {close}
        <div className="su-held__body">
          <div className="su-ring su-ring--bad"><ShieldDown size={56} /></div>
          <h1 className="su-held__title">{W.unknownTitle}</h1>
          <p className="su-held__sub">{W.unknownLine}</p>
        </div>
        <div className="su-held__floor"><button type="button" className="zf-btn alert" disabled={busy} onClick={() => void send("account.safeUpdate.cancel", onClose)}>{W.unknownCancel}</button></div>
      </div>
    );
  }
  if (u.state === "none") {
    return (
      <div className="zf-screen su-held" ref={el}>
        {close}
        <div className="su-held__body">
          <div className="su-ring"><ShieldDown size={56} tick /></div>
          <h1 className="su-held__title">{W.doneTitle}</h1>
        </div>
      </div>
    );
  }
  if (u.state === "offer") {
    return (
      <div className="zf-screen su-held" ref={el}>
        {close}
        <div className="su-held__body">
          <div className="su-ring"><ShieldDown size={56} /></div>
          <h1 className="su-held__title">{W.cardTitle}</h1>
          <p className="su-held__when">{u.whatChanged}</p>
          <p className="su-held__sub">{cardLine(u.phoneOnlySeconds, u.withSecondDeviceSeconds, u.hasSecondDevice)}</p>
        </div>
        <div className="su-held__floor"><button type="button" className="zf-btn" disabled={busy} onClick={() => { setBusy(true); void askUpdate(bridge, reread, onProblem).finally(() => setBusy(false)); }}>{W.update}</button></div>
      </div>
    );
  }
  const readyAt = Date.parse(u.readyAtIso);
  const ready = u.state === "ready";
  return (
    <div className="zf-screen su-held" ref={el} data-testid="safe-update-held">
      {close}
      <div className="su-held__body">
        <div className={`su-ring${ready ? "" : " su-ring--live"}`}><ShieldDown size={56} /></div>
        <h1 className="su-held__title">{W.heldTitle}</h1>
        <p className="su-held__when" data-testid="safe-update-when">{ready ? "Ready now" : whenLine(readyAt, now)}</p>
        <p className="su-held__sub">{ready ? W.stays : atLine(readyAt, now)}</p>
        <p className="su-held__sub">{u.whatChanged}</p>
        {!ready && stopLines(u.coSigned, u.hasSecondDevice).map((l) => <p key={l} className="su-held__sub">{l}</p>)}
      </div>
      <div className="su-held__floor">
        {ready && <button type="button" className="zf-btn" disabled={busy} onClick={() => void send("account.safeUpdate.finish", () => setDone(true))}>{W.finish}</button>}
        <button type="button" className="zf-link" disabled={busy} onClick={() => void send("account.safeUpdate.cancel", onClose)}>{W.cancel}</button>
      </div>
    </div>
  );
}
