// A request the account's protection is holding: what it is, how long is left, and what this device can do about it.
// Shown by the shell for every app (apps call useShell().showWaiting), so a held payment always looks the same and only
// the shell ever runs or cancels it.
//
// The app only hands over the id. Everything shown (the words, the countdown, whether it's ready, whether the second
// device must say yes) comes from the core's own account.waiting item for that id, so an app can't make a request look
// ready or not. Until the core lists it there are no buttons; when it stops listing it, account.waiting.status says
// whether it was sent, cancelled or declined (on this device or another device), and that is what's shown.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Back } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { afterConfirming, endedWords, settle, type Ended, type WaitingStatus } from "@zerofee/shell-api/waiting-outcome.ts";
import { useCountdown } from "../screens/Recovery.tsx";
import { endsWords } from "../screens/countdown.ts";
import { waitPlain } from "../apps/security/rules.ts";
import { ProblemView } from "./ProblemView.tsx";
import { onApprovalAnswered } from "@zerofee/shell-api/approval-answered.ts";
import "../screens/recovery.css";

export interface Held { id: string; readyAtIso: string; needsSecondDevice: boolean }
/** `secondDeviceSaidYes` (H43): it needed the second device's yes, and the device gave it: said here, never silently. */
interface HeldItem extends Held { title: string; lines: string[]; details?: { label: string; lines: string[] }[]; ready: boolean; change?: boolean; warning?: string; sampleDevice?: boolean; skip?: boolean; secondDeviceSaidYes?: boolean }

const LOOK_MS = 3000;
const LOOKS = 10;
const RECHECK_MS = 15_000;
/** After "sent, confirming": how long before asking the account whether it shows the run. */
const CONFIRM_MS = 20_000;

/** `onOpen`: the ended screen's next step is a place in the whole app ("security/activity"); the shell takes the person there. */
export function WaitingView({ bridge, held, onClose, onOpen }: { bridge: Bridge; held: Held; onClose: () => void; onOpen?: (label: string, screen: string) => void }) {
  const id = String(held.id);
  const [item, setItem] = useState<HeldItem | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [busy, setBusy] = useState(false);
  // What a tap is doing, said from the tap (grade 01c, P13: "Finish it now" showed nothing for 4 s, its Approve 2 s):
  // getting the sheet ready, then, once Approve is tapped, finishing or cancelling.
  const [phase, setPhase] = useState<null | { run: boolean; approved: boolean }>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [look, setLook] = useState(0);
  // Back and Escape leave as Done does, on every face of this screen (grade 01d, Q3: the ended screen trapped the person).
  useBack(onClose);
  const { left, text } = useCountdown(item?.readyAtIso ?? new Date(0).toISOString());
  // One name for the second device: "laptop" when every one the account has is a laptop, else "second device" (grade
  // 1 Nov, item 7). Read once; until it answers, the general name.
  const [device, setDevice] = useState("second device");
  useEffect(() => {
    let gone = false;
    void bridge.call<{ kind?: string }[]>("account.secondDevices").then((r) => !gone && "ok" in r && Array.isArray(r.ok) && r.ok.length > 0 && r.ok.every((d) => d.kind === "laptop") && setDevice("laptop"));
    return () => { gone = true; };
  }, [bridge]);

  // The held request's own words and readiness, from the account. Just after it's held, the nodes may not list it yet,
  // so look again a few times; once found, look again now and then and when the countdown ends (the core says
  // `ready`). Ids are compared as text: the contract's numbers and the outcome's strings must still match. When it's no
  // longer listed, ask where it stands: it may have ended on this device or on the other device. Once it has ended the
  // looking stops: a shown outcome ("Cancelled.") is never replaced, without a tap, by a later and staler read (01d, Q3).
  const done = ended !== null;
  useEffect(() => {
    setItem(null);
    setEnded(null);
  }, [id]);
  useEffect(() => {
    if (done) return;
    let tries = 0;
    let found = false;
    let timer = 0;
    let gone = false;
    const status = async () => {
      const res = await bridge.call<WaitingStatus>("account.waiting.status", { id });
      if (gone) return;
      const s = "ok" in res ? res.ok : { state: "unknown" as const };
      if (s.state === "waiting") return void (timer = window.setTimeout(seek, LOOK_MS)); // listed again: keep looking
      const next: Ended = { state: s.state, explorerUrl: s.explorerUrl };
      setEnded((e) => e ?? next);
    };
    const seek = async () => {
      const res = await bridge.call<HeldItem[]>("account.waiting");
      if (gone) return;
      const now = "ok" in res ? res.ok.find((w) => String(w.id) === id) : undefined;
      if (now) {
        found = true;
        setItem(now);
        const untilReady = Math.max(0, Date.parse(now.readyAtIso) - Date.now());
        timer = window.setTimeout(seek, now.ready ? RECHECK_MS : Math.min(RECHECK_MS, untilReady + 500));
        return;
      }
      if (found || ++tries >= LOOKS) return void status();
      timer = window.setTimeout(seek, LOOK_MS);
    };
    void seek();
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [bridge, id, look, done]);

  // Ended here (this device ran or cancelled it, maybe from another screen): say so at once.
  useEffect(() => bridge.on<{ id: string; ended: "ran" | "cancelled"; explorerUrl?: string }>("account.waiting.ended", (e) => {
    if (String(e.id) === id) setEnded({ state: e.ended, explorerUrl: e.explorerUrl });
  }), [bridge, id]);

  // "Sent, confirming": after a while, ask the account whether it shows the run; then Sent, or still confirming.
  useEffect(() => {
    if (ended?.state !== "confirming") return;
    let gone = false;
    const t = window.setTimeout(async () => {
      const res = await bridge.call<WaitingStatus>("account.waiting.status", { id });
      if (!gone) setEnded(afterConfirming("ok" in res ? res.ok : { state: "unknown" }, ended));
    }, CONFIRM_MS);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [bridge, id, ended]);

  const act = async (method: "account.waiting.run" | "account.waiting.cancel") => {
    setBusy(true);
    const run = method === "account.waiting.run";
    setPhase({ run, approved: false });
    const stop = onApprovalAnswered((approved) => approved && setPhase({ run, approved: true }));
    const s = settle(method, await bridge.call<TxOutcome>(method, { id }).finally(stop));
    setBusy(false);
    setPhase(null);
    if ("problem" in s) return setProblem(s.problem);
    if ("declined" in s) return;
    if ("lookAgain" in s) return setLook((n) => n + 1);
    setEnded(s.ended);
  };

  // The web demo only (its MockBridge lists these; the real core never does): the second device's answer, as the laptop
  // would give it, and Skip ahead to the end of the wait. Then look again: the account says how it stands.
  const demoAct = async (method: "account.waiting.sampleDevice" | "account.waiting.skip", params: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await bridge.call(method, { id, ...params });
    setBusy(false);
    if ("problem" in r) return setProblem(r.problem);
    // the laptop's yes may have run it at once: say how it ended now, never "Looking it up…" while it is already done
    const st = await bridge.call<WaitingStatus>("account.waiting.status", { id });
    if ("ok" in st && st.ok.state !== "waiting" && st.ok.state !== "unknown") return setEnded({ state: st.ok.state, explorerUrl: st.ok.explorerUrl });
    setLook((n) => n + 1);
  };

  if (problem) return <ProblemView problem={problem} onNext={() => { setProblem(null); setLook((n) => n + 1); }} />;
  if (ended) {
    const words = endedWords(ended, item ?? undefined);
    return <ProblemView problem={words} onNext={onClose} onOpen={onOpen && ((screen) => onOpen(words.next.label, screen))} />;
  }

  if (!item) {
    return (
      <div className="zf-screen zf-pad" role="dialog" aria-labelledby="held-title">
        {/* A way out while it looks (grade 02f, F8: no Back for seconds); Escape and the browser's Back do the same. */}
        <div className="zf-top">
          <button className="zf-icon-btn" onClick={onClose} aria-label="Back"><Back /></button>
          <span style={{ width: 28 }} />
        </div>
        <div className="zf-fill" />
        <div className="rc-center zf-enter">
          <Mark size={96} mode="loading" />
          <div className="zf-label" style={{ marginTop: 32 }}>Waiting</div>
          <h1 id="held-title" className="zf-title" style={{ marginTop: 18 }}>Looking it up…</h1>
          <p className="zf-body" style={{ marginTop: 14 }}>A payment or change is held. Finding it…</p>
        </div>
        <div className="zf-fill" />
        <div className="zf-floor">
          <p className="zf-small">Nothing has moved yet.</p>
        </div>
      </div>
    );
  }

  const ready = item.ready || left === 0;
  // A change to the account's rules (a Legacy or Agent set-up, new protection): the backup words can stop it too.
  const startsIn = waitPlain(Math.max(0, (Date.parse(item.readyAtIso) - Date.now()) / 1000));
  // The phone's stop of a move to a new phone: whoever started the move holds the backup words, so they are never
  // offered as a way to stop anything here (grade 1 Nov, item 7).
  const stopOfMove = /^Stop (the|a) move/i.test(item.title);
  // H43: the second device's yes, on this phone too: who said it and when it goes ("Your laptop said yes. It goes in 23h 58m.").
  const saidYes = item.secondDeviceSaidYes === true && !item.needsSecondDevice;
  // Grade 1 Nov, D4: "It takes effect in 2 minutes" was not true. A change takes effect only once it is finished (Finish
  // it now, after the wait), and one that needs the second device's yes only once that yes is given. Said plainly, with
  // the moment the wait ends (D20), so a change can never silently not happen.
  const endsAt = endsWords(item.readyAtIso);
  const deviceToo = item.needsSecondDevice ? ` Your ${device} must also say yes.` : "";
  const body = saidYes
    ? ready ? `Your ${device} said yes. ${item.change ? "Finish it now." : "You can send it now."}` : `Your ${device} said yes. It goes in ${startsIn}.`
    : !ready
    ? item.change
      ? `Nothing changes until you finish it after the wait.${deviceToo} ${stopOfMove ? "You can cancel it until then." : "You or your backup words can stop it."}`
      : `Big payments wait, so you can stop one you didn't make.${deviceToo}`
    // Never "the wait is over" (grade 30 Oct, item 6): a hold for the second device alone had no wait to be over.
    : item.needsSecondDevice
      ? `Your ${device} must say yes first. Open ZeroFee on it.`
      : item.change ? "The wait is over. Finish it now." : "The wait is over. You can send it now.";
  // Held only for the second device's yes, with no time left to count: it says what it waits for, never "Ready".
  const forDevice = ready && item.needsSecondDevice;
  return (
    <div className="zf-screen zf-pad" role="dialog" aria-labelledby="held-title">
      {/* A way out that leaves it as it is (UX walk 2 Nov: once listed, the only buttons were Finish and Cancel). */}
      <div className="zf-top">
        <button className="zf-icon-btn" onClick={onClose} aria-label="Back"><Back /></button>
        <span style={{ width: 28 }} />
      </div>
      <div className="zf-fill" />
      <div className="rc-center zf-enter">
        <Mark size={96} mode={ready ? "still" : "loading"} />
        <div className="zf-label" style={{ marginTop: 32 }}>{item.needsSecondDevice ? `Waiting for your ${device}` : saidYes ? `Your ${device} said yes` : ready && item.change ? "Not finished" : "Waiting"}</div>
        {!forDevice && <div className="zf-display rc-count">{ready ? (item.change ? "Finish it" : "Ready") : text}</div>}
        {!ready && endsAt && <p className="zf-small" style={{ marginTop: 2 }}>Ends {endsAt}</p>}
        <h1 id="held-title" className="zf-title" style={{ marginTop: 18, ...(item.warning ? { color: "var(--alert)" } : {}) }}>{item.title}</h1>
        {item.warning && <p className="zf-body" style={{ marginTop: 8, color: "var(--alert)" }}>{item.warning}</p>}
        {/* once the wait is over, a line about the wait ("…You can cancel it until then.") is no longer true: not shown */}
        {/* UI-SIMPLICITY-RULES 9: what is happening first, then what it is in short; long parts (a rule's every coin)
            one tap down, never a wall that pushes Finish off the screen (phone test, 2 Nov) */}
        <p className="zf-body" style={{ marginTop: 10 }}>{body}</p>
        <div className="held-what">
          {(ready || item.change ? item.lines.filter((l) => !/until then\.$/.test(l)) : item.lines).map((l, i) => <p key={i} className="zf-small">{l}</p>)}
          {item.details?.map((d, i) => <More key={i} label={d.label} lines={d.lines} />)}
        </div>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {phase && <p className="zf-small" role="status" style={{ textAlign: "center", margin: "0 0 10px" }}>{phaseWords(phase, item.change === true)}</p>}
        {item.ready && !item.needsSecondDevice
          ? <button className="zf-btn" disabled={busy} onClick={() => act("account.waiting.run")}>{item.change ? "Finish it now" : "Send it now"}</button>
          : <button className="zf-btn" onClick={onClose}>Done</button>}
        <button className="zf-link" disabled={busy} onClick={() => act("account.waiting.cancel")}>Cancel it</button>
        {item.skip && !ready && <button className="zf-link" disabled={busy} onClick={() => void demoAct("account.waiting.skip")}>Skip ahead</button>}
        {item.sampleDevice && (
          <div className="held-device" role="group" aria-label="On your laptop">
            <span className="zf-label">On your laptop</span>
            <button className="zf-link" disabled={busy} onClick={() => void demoAct("account.waiting.sampleDevice", { approve: true })}>Say yes</button>
            <button className="zf-link" disabled={busy} onClick={() => void demoAct("account.waiting.sampleDevice", { approve: false })}>Say no</button>
          </div>
        )}
        {/* a change moves no money: no money line on it (grade 1 Nov, item 8) */}
        {/* A change says "Nothing changes yet" in its own words above: never twice (grade 1 Nov c, P15). */}
        {!item.change && <p className="zf-small">Nothing has moved yet. Your money is in your Safe.</p>}
      </div>
    </div>
  );
}

/** When a wait ends ("7:12 PM"): with the countdown it lives in, for the recovery wait too (N6). */
export { endsWords } from "../screens/countdown.ts";

/** The status line under a tap on the Waiting screen: before the sheet, then after Approve. */
export function phaseWords(phase: { run: boolean; approved: boolean }, change: boolean): string {
  if (!phase.approved) return phase.run ? `Getting it ready to approve…` : "Getting the cancel ready for you to approve…";
  if (!phase.run) return "Cancelling it…";
  return change ? "Finishing it. This takes a few seconds…" : "Sending it…";
}
