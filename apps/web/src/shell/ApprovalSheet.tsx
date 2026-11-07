// The web demo's approval sheet. On the iPhone the sheet is native and drawn by the security layer; here the shell draws
// it, and it must show PlainWords verbatim: the title, every line, every warning, every effect, in order, with the asking
// app's hint smaller and last. It is the only place that hears `approval.needed` and answers `approval.answer`.
//
// One sheet at a time: a request that arrives while one is showing lines up behind it and never replaces the words on
// screen (a swap under the thumb). Each sheet is a fresh component (keyed by the request's id), Approve is off for the
// first moments after it appears, and when the words are longer than the screen Approve stays off until they have been
// scrolled to the end: nobody approves what they haven't seen. Off is visible (Approve fills in as it arms), and a tap
// while it is off is answered on screen, never lost into what's behind and never a yes.
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { PlainWords } from "@zerofee/core/signer";
import { iosHost } from "../host/ios.ts";
import { approvalAnswered, approvalAsked, approvalOpened, closePending, hostSheets, jobSigned, onPending, pendingShown, refusingClosed, type Pending as Getting } from "@zerofee/shell-api/approval-answered.ts";
import { movesMoney } from "@zerofee/shell-api/job-run.ts";
import { moneyOpenNow, onScreenLeft, screenAppNow } from "./screen-app.ts";
import { mayShowSheet } from "@zerofee/core/approval-policy";
import { passwordAnswer } from "./approval-password.ts";
import { keptArm } from "./approval-arm.ts";

// The view and its words have their own module (ApprovalSheetView.tsx), loaded a moment after the shell starts and
// never in Home's first load (speed budget); the first sheet finds it loaded.
type View = typeof import("./ApprovalSheetView.tsx").ApprovalSheetView;
let viewLoaded: View | null = null;
const loadView = () => import("./ApprovalSheetView.tsx").then((m) => (viewLoaded = m.ApprovalSheetView));

/** `password`: the web wallet's sheet (fork A): Approve answers with the password, which the core checks. */
export type Pending = { id: string; words: PlainWords; app?: string; password?: boolean };

/** `bridge`: the shell's full bridge (the core's in the app, the demo MockBridge in ?demo); apps never get one that hears approvals. */
/**
 * `inWindow` (D157, the extension's real app only, App.tsx): no sheet shows in the side panel; each is answered there,
 * in the extension's own full-screen window (host/extension.ts answerInWindow). The demo page never passes it.
 */
export function ApprovalSheet({ bridge, inWindow }: { bridge: Bridge; inWindow?: (p: Pending) => Promise<boolean> }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  // the view's code, fetched as the shell comes up (never on the path of the first screen); a sheet that comes first waits
  // in the queue for it, a moment, and is never answered for the person
  const [ApprovalSheetView, setView] = useState<View | null>(() => viewLoaded);
  useEffect(() => {
    if (!viewLoaded) void loadView().then((v) => setView(() => v), () => undefined);
  }, []);
  // the jobs hear this sheet (job-run.ts): asked here first, "Job created." on its yes; the phone's Safe Face ID is Swift's
  useEffect(() => hostSheets({ safe: !iosHost() }), []);
  // the core's word that a Safe job's last signature is made (before anything is sent): the job is made on it (job-run.ts)
  useEffect(() => bridge.on<{ jobKey?: string }>("job.signed", (p) => jobSigned(p?.jobKey)), [bridge]);
  // the core's word that a job's sheet is about to show (the chip's own on the phone, never heard here): that job waits on it
  useEffect(() => bridge.on<{ jobKey?: string }>("approval.asked", (p) => approvalAsked(p?.jobKey)), [bridge]);
  // the Safe's "Check this" at the tap, before the core has bound the amounts (the copy review's W2); the core's sheet takes its place
  const [getting, setGetting] = useState<Getting | null>(() => pendingShown());
  const lastGetting = useRef<Getting | null>(null);
  useEffect(() => onPending((g) => { if (g) lastGetting.current = g; setGetting(g); }), []);
  useEffect(() => bridge.on<Pending>("approval.needed", (p) => {
    // a Close on the Getting-ready sheet is the person's No: a money sheet its call still asks is answered No unseen
    if (refusingClosed() && movesMoney(p.words ?? {})) {
      void bridge.call("approval.answer", { id: p.id, approve: false });
      return;
    }
    // D146: asked by an app the person isn't on (a late ask), it never shows: answered Not now, nothing signed
    if (!mayShowSheet(p.app ?? p.words?.asker, screenAppNow() || undefined, moneyOpenNow())) {
      void bridge.call("approval.answer", { id: p.id, approve: false });
      return;
    }
    // a job tied to this sheet (onOwnApproval) knows it is its own: opened while its call runs
    approvalOpened(p);
    setQueue((q) => (q.some((x) => x.id === p.id) ? q : [...q, p]));
  }), [bridge]);
  // D146: an approve sheet belongs to the app that asked: the person moving to another app puts it away, answered Not
  // now (nothing is signed, nothing moves), never shown over the other app
  useEffect(() => onScreenLeft(() => setQueue((q) => {
    for (const p of q) void bridge.call("approval.answer", { id: p.id, approve: false });
    if (q.length) approvalAnswered(false);
    return [];
  })), [bridge]);
  const asking = useRef(false);
  const showing = queue[0];
  // D157: the extension's window shows it and asks the iPhone; the answer goes back from here, and the next one follows
  useEffect(() => {
    if (!inWindow || !showing) return;
    void inWindow(showing)
      .catch(() => bridge.call("approval.answer", { id: showing.id, approve: false }).then(() => false))
      .then((yes) => { setQueue((q) => q.filter((x) => x.id !== showing.id)); approvalAnswered(yes === true, showing); });
  }, [showing?.id, bridge]);
  if (!showing && getting && !inWindow && ApprovalSheetView) {
    return <ApprovalSheetView key={`getting-${getting.at}`} words={{ title: getting.headline, lines: [], warnings: [], effect: [] }} onAnswer={() => { closePending(); }} pending={getting.failed ? { failed: true } : {}} />;
  }
  if (!showing || inWindow) return null;
  /** Answers the sheet. A password sheet's Approve waits for the core: a wrong password or a wait gives back why, and the
   *  sheet stays open to type again; anything else ends it. */
  const answer = async (approve: boolean, password?: string): Promise<string | null> => {
    if (asking.current) return null;
    if (showing.password && approve) {
      if (!password) return null;
      asking.current = true;
      const r = await bridge.call("approval.answer", { id: showing.id, approve: true, password }).catch(() => null);
      asking.current = false;
      const said = passwordAnswer(r as Parameters<typeof passwordAnswer>[0]);
      if ("why" in said) return said.why;
      setQueue((q) => q.filter((x) => x.id !== showing.id));
      approvalAnswered(true, showing);
      return null;
    }
    // On the phone a chip signature never comes here: it is approved on Swift's own sheet (S1.6), the only sheet for it.
    // What does come here doesn't touch the chip (a separate wallet, Agent's setup, the backup words' key), and its
    // Approve passes Face ID first. Not approved (or the phone can't say) is "Not now": nothing reaches the core as a yes.
    // D143: a hot key's sheet (the core's `tap`) is one tap, never Face ID; Face ID is the Safe's
    const host = approve && showing.words.tap !== true ? iosHost() : null;
    if (host) {
      asking.current = true;
      const r = await host.call<{ approved: boolean }>("device.confirm");
      asking.current = false;
      approve = "ok" in r && r.ok.approved === true;
    }
    void bridge.call("approval.answer", { id: showing.id, approve });
    setQueue((q) => q.filter((x) => x.id !== showing.id));
    approvalAnswered(approve, showing);
    return null;
  };
  if (!ApprovalSheetView) return null;
  // R4 (audit, 6 Nov): bound figures that are the Getting-ready sheet's own keep its arm (and its frame); different ones,
  // or a signed quote past the plan's bound (the audit's ruling (c), 8 Nov), swap in as a new sheet and the 700 ms arm starts again
  const same = keptArm(lastGetting.current, showing.words);
  return <ApprovalSheetView key={same ? `getting-${same.at}` : showing.id} id={showing.id} words={showing.words} onAnswer={answer} {...(showing.password ? { password: true } : {})} {...(same ? { armAt: same.at } : {})} />;
}
