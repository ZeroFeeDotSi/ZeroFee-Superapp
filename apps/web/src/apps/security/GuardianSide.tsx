// Being someone's guardian, on the guardian's own phone (guardian.ts): the code the trusted person scans to add this
// phone as their second device, whose account it guards, and what waits for its yes. Only the request itself shows,
// in the words the account's own sheet used: never a balance, nothing else. Saying yes or no signs on this device's
// own sheet, with this device's guardian key, which can do nothing else.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { Back } from "@zerofee/design/icons.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { More } from "@zerofee/design/More.tsx";
import { DeclineConfirm } from "../../laptop/DeclineConfirm.tsx";
import { sayNoFirst } from "../../laptop/decline-words.ts";

interface Code { code: string; fingerprint: string; accounts: string[] }
/** `pauseSeconds`: how long its no pauses their main device (the core's pauseOnNo): Say no asks first. */
interface Request { accountId: string; id: string; title: string; lines: string[]; pauseSeconds?: number; pauseUnknown?: boolean }
const POLL_MS = 15_000;
/** The letters both phones show (k-security crawl, 4 Nov, S4: "guardian key" was jargon). */
export const GUARD_LETTERS = "Check these letters with them";

export function GuardianSide({ bridge, onBack, onProblem, mainnet = false }: { bridge: Bridge; onBack: () => void; onProblem: (p: Problem) => void; mainnet?: boolean }) {
  const [code, setCode] = useState<Code | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const refresh = async () => {
    const c = await bridge.call<Code>("guardian.code");
    if ("problem" in c) return onProblem(c.problem);
    setCode(c.ok);
    if (c.ok.accounts.length === 0) return setRequests([]);
    const r = await bridge.call<Request[]>("guardian.requests");
    if ("ok" in r) setRequests(r.ok);
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [bridge]);
  const answer = async (r: Request, approve: boolean) => {
    setBusy(`${r.accountId}:${r.id}`);
    const res = await bridge.call<TxOutcome>("guardian.answer", { accountId: r.accountId, id: r.id, approve });
    setBusy(null);
    if ("problem" in res) return onProblem(res.problem);
    if (res.ok.status === "problem") return onProblem(res.ok.problem);
    await refresh();
  };
  // A no that pauses their main device asks first (DeclineConfirm); only its Say no anyway sends it.
  const [asking, setAsking] = useState<Request | null>(null);
  const tap = (r: Request, approve: boolean) => (sayNoFirst(r, approve) === "ask" ? setAsking(r) : void answer(r, approve));
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const guarding = (code?.accounts.length ?? 0) > 0;
  const qr = code && (
    <div className="sec-guard__code">
      <div className="sec-guard__qr" data-code={code.code}><QrCode value={code.code} size={560} label="Guardian code" /></div>
      <button className="zf-link" onClick={() => void copy()}>{copied ? "Copied" : "Or copy the code and send it to them"}</button>
      <div className="zf-label" style={{ marginTop: 18 }}>{GUARD_LETTERS}</div>
      <div className="sec-guard__fp">{code.fingerprint}</div>
      <p className="zf-small" style={{ marginTop: 6 }}>Their device shows these letters too. If they differ, stop.</p>
    </div>
  );
  return (
    <div className="zf-screen zf-pad sec-guard-page">
      <div className="zf-top">
        <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button>
        <span className="zf-label">Guardian</span>
        <span style={{ width: 28 }} />
      </div>
      {!code ? null : !guarding ? (
        <div className="sec-center-text zf-enter" style={{ marginTop: 24 }}>
          <h1 className="zf-title">Be someone's guardian</h1>
          <p className="zf-body" style={{ marginTop: 10 }}>Someone you trust scans this to ask for your yes on big payments.</p>
          {qr}
        </div>
      ) : (
        <div className="zf-enter" style={{ marginTop: 18 }}>
          <div className="zf-label">You guard</div>
          {code.accounts.map((a) => <div key={a} className="sec-guard__account">{a}</div>)}
          <div className="zf-label" style={{ marginTop: 26 }}>Waiting for your yes</div>
          {requests.length === 0 && <p className="zf-small" style={{ marginTop: 8 }}>Nothing right now.</p>}
          {requests.map((r) => (
            // Ids are per account: the key is the account and the id.
            <div key={`${r.accountId}:${r.id}`} className="sec-guard__req">
              <div className="t">{r.title}</div>
              <div className="zf-small">For {r.accountId}</div>
              {r.lines.map((l, i) => <div key={i} className="zf-small">{l}</div>)}
              <div className="sec-other__actions">
                <button className="zf-link sec-act" disabled={busy !== null} onClick={() => tap(r, true)}>Say yes</button>
                <button className="zf-link sec-act" disabled={busy !== null} onClick={() => tap(r, false)}>Say no</button>
              </div>
            </div>
          ))}
          <p className="zf-small" style={{ marginTop: 22 }}>You only say yes or no. You never see their money.</p>
          <More label="How guarding works" lines={["They scan it in ZeroFee, in Devices.", "You answer only what they ask. You can't start anything.", "To stop guarding, ask them to remove you."]} />
          <button className="zf-link" style={{ marginTop: 14 }} onClick={() => setShowCode((s) => !s)}>{showCode ? "Hide my code" : "Guard someone else"}</button>
          {showCode && qr}
        </div>
      )}
      {asking && <DeclineConfirm whose="theirs" seconds={asking.pauseSeconds ?? null} onBack={() => setAsking(null)} onNo={() => { setAsking(null); void answer(asking, false); }} />}
    </div>
  );
}
