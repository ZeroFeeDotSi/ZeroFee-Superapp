// What the second device lists (the laptop page, and the web demo's laptop: one component, so both say the same):
// - its own removal, asked by the phone (R7-1): a warning with no yes or no;
// - a waiting move to a new device (release 7: approve_recovery / refuse_recovery): what happened, then the answers, each
//   with what it does; when the phone has asked to stop the move, confirming that stop comes first (no freeze, R7-4);
// - anything else waiting for its yes, as before.
// The core's own lines (read from the contract on two nodes) come under each; every answer still goes through the
// device's own sheet.
import { useState } from "react";
import { LAPTOP_ANSWERS } from "./second-device-words.ts";
import { sayNoFirst } from "./decline-words.ts";
import { DeclineConfirm } from "./DeclineConfirm.tsx";
import { More } from "@zerofee/design/More.tsx";
import { useCountdown } from "../screens/countdown.ts";
import "./laptop.css";

/** `secondDeviceSaidYes` (H43): this device already said yes; it shows as said, with nothing left to answer, until it goes. */
export interface LaptopRequest { accountId: string; id: string; title: string; lines: string[]; details?: { label: string; lines: string[] }[]; readyAtIso: string; kind?: string; needsSecondDevice?: boolean; warning?: string; secondDeviceSaidYes?: boolean; /** How long its no pauses the main device (the core's pauseOnNo): Say no asks first. */ pauseSeconds?: number; /** The account couldn't be read just then: its no may pause it, so Say no asks all the same. */ pauseUnknown?: boolean }

/** The list, in the order the core gives it. `onAnswer(accountId, id, approve, freeze)`: `freeze` only on a refusal of a
 *  move while the phone's stop waits (re-audit 7, R7-9: refuse and freeze, or confirm the phone's stop instead). */
/** `compact` (the web demo's drawn laptop): the answers without their explanations, which the phone says under it. */
export function LaptopRequestList({ requests, busy, onAnswer, compact = false }: { requests: readonly LaptopRequest[]; busy: string | null; onAnswer: (accountId: string, id: string, approve: boolean, freeze?: boolean) => void; compact?: boolean }) {
  const moving = new Set(requests.filter((r) => r.kind === "Recovery").map((r) => r.accountId));
  // A no that pauses the main device asks first (DeclineConfirm); only its Say no anyway sends it.
  const [asking, setAsking] = useState<LaptopRequest | null>(null);
  const tap = (r: LaptopRequest, approve: boolean) => (sayNoFirst(r, approve) === "ask" ? setAsking(r) : onAnswer(r.accountId, r.id, approve));
  return (
    <>
      {asking && <DeclineConfirm whose="mine" seconds={asking.pauseSeconds ?? null} onBack={() => setAsking(null)} onNo={() => { setAsking(null); onAnswer(asking.accountId, asking.id, false); }} />}
      {requests.map((r) => {
        // Ids are per account, so two accounts can hold a request "3": the key is the account and the id.
        const key = `${r.accountId}:${r.id}`;
        if (r.kind === "RemoveThisDevice") return <RemovalWarning key={key} request={r} />;
        if (r.kind === "Recovery") {
          const stop = requests.find((x) => x.accountId === r.accountId && x.kind === "CancelRecovery");
          return <RecoveryRequestCard key={key} compact={compact} request={r} busy={busy === r.id || (stop !== undefined && busy === stop.id)} onAnswer={(approve) => onAnswer(r.accountId, r.id, approve, stop && !approve ? true : undefined)} onConfirmStop={stop ? () => onAnswer(r.accountId, stop.id, true) : undefined} />;
        }
        // The phone's stop of a move this device also sees as a move: answered on the move's card (R7-4).
        if (r.kind === "CancelRecovery" && moving.has(r.accountId)) return null;
        // H43: what this device already said yes to, said plainly until it goes (the phone says the same).
        if (r.secondDeviceSaidYes && r.kind !== "Recovery") return <SaidYesCard key={key} request={r} />;
        return (
          <div key={key} className="lp-req">
            <div className="lp-req__t">{r.title}</div>
            {r.lines.map((l, i) => <div key={i} className="zf-small">{l}</div>)}
            {r.details?.map((d, i) => <More key={i} label={d.label} lines={d.lines} />)}
            <div className="lp-req__actions">
              <button className="zf-btn" disabled={busy === r.id} onClick={() => tap(r, true)}>Say yes</button>
              <button className="zf-link" disabled={busy === r.id} onClick={() => tap(r, false)}>Say no</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Your yes is given: what it was, and when it goes (the phone sends it then, or cancels it). Nothing to answer. */
export function SaidYesCard({ request }: { request: Pick<LaptopRequest, "title" | "readyAtIso"> }) {
  const { left, text } = useCountdown(request.readyAtIso);
  return (
    <div className="lp-req lp-said" role="status">
      <div className="zf-label">You said yes</div>
      <div className="lp-req__t">{request.title}</div>
      <div className="zf-small">{left > 0 ? <>{SAID_YES.goesIn} <b className="lp-rec__count">{text}</b>. {SAID_YES.phoneCanCancel}</> : SAID_YES.ready}</div>
    </div>
  );
}

/** The second device's words for a yes it gave (H43), and for what its yes or no just did. */
export const SAID_YES = {
  goesIn: "It goes in",
  phoneCanCancel: "Your main device can still cancel it until then.",
  ready: "Its wait is over. Your main device can send it now.",
  sent: "You said yes. It's sent.",
  waiting: "You said yes. It goes when its wait is over.",
  no: "You said no. It won't go.",
};

/** R7-1: the phone asked to remove this device. Nothing to answer here: what to do if it wasn't the owner. */
function RemovalWarning({ request }: { request: LaptopRequest }) {
  const { left, text } = useCountdown(request.readyAtIso);
  return (
    <div className="lp-req lp-rec" role="alert">
      <div className="zf-label" style={{ color: "var(--alert)" }}>Warning</div>
      <div className="lp-req__t">{request.warning ?? request.title}</div>
      {left > 0 && <div className="zf-small">It happens in <b className="lp-rec__count">{text}</b>. {LAPTOP_ANSWERS.removal}</div>}
    </div>
  );
}

/** `needsSecondDevice` false: this device already said yes (only a refusal is left). `onConfirmStop`: the phone asked to
 *  stop the move (R7-9): "Refuse and freeze payments" first, the safe default; "Confirm my main device's stop (no freeze)" second. */
export function RecoveryRequestCard({ request, busy, onAnswer, onConfirmStop, compact = false }: { request: Pick<LaptopRequest, "title" | "lines" | "readyAtIso" | "needsSecondDevice">; busy: boolean; onAnswer: (approve: boolean) => void; onConfirmStop?: () => void; compact?: boolean }) {
  const said = request.needsSecondDevice === false;
  const { left, text } = useCountdown(request.readyAtIso);
  return (
    <div className={`lp-req lp-rec${compact ? " lp-rec--compact" : ""}`} role="group" aria-label={LAPTOP_ANSWERS.title}>
      <div className="zf-label" style={{ color: "var(--alert)" }}>{LAPTOP_ANSWERS.title}</div>
      <div className="lp-req__t">{onConfirmStop ? LAPTOP_ANSWERS.stopAsked : said ? LAPTOP_ANSWERS.approved : LAPTOP_ANSWERS.ask}</div>
      {left > 0 && <div className="zf-small">The new device can finish in <b className="lp-rec__count">{text}</b>{said ? "." : ", only with your yes."}</div>}
      {!compact && request.lines.map((l, i) => <div key={i} className="zf-small">{l}</div>)}
      <div className="lp-rec__answers">
        {onConfirmStop && (
          <>
            <div className="lp-rec__answer">
              <button className="zf-btn alert" disabled={busy} onClick={() => onAnswer(false)}>{LAPTOP_ANSWERS.refuseAndFreeze.button}</button>
              {!compact && <p className="zf-small">{LAPTOP_ANSWERS.refuseAndFreeze.what}</p>}
            </div>
            <div className="lp-rec__answer">
              <button className="zf-link" disabled={busy} onClick={onConfirmStop}>{LAPTOP_ANSWERS.confirmStop.button}</button>
              {!compact && <p className="zf-small">{LAPTOP_ANSWERS.confirmStop.what}</p>}
            </div>
          </>
        )}
        {!said && !onConfirmStop && (
          <div className="lp-rec__answer">
            <button className="zf-btn" disabled={busy} onClick={() => onAnswer(true)}>{compact ? "Approve" : LAPTOP_ANSWERS.approve.button}</button>
            {!compact && <p className="zf-small">{LAPTOP_ANSWERS.approve.what}</p>}
          </div>
        )}
        {!onConfirmStop && (
          <div className="lp-rec__answer">
            <button className="zf-btn alert" disabled={busy} onClick={() => onAnswer(false)}>{compact ? "Refuse" : LAPTOP_ANSWERS.refuse.button}</button>
            {!compact && <p className="zf-small">{LAPTOP_ANSWERS.refuse.what}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
