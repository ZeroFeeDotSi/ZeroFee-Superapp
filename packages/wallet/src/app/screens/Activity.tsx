// Activity: only what the person did, what waits on them, and what went wrong (D52), newest first, built on the account's
// record from the chain, the same rows Security lists (grade 02f, item 4: ledger.activity merges it). The Safe's own
// movements come from the ledger; Spending adds its own: Top up, Put away, the move after a key export, a paused step
// and any move that failed (hub.ts activityRows: one row per move; Spending's row wins, as it follows spending.changed).
// Quiet moves (refills, gas, rotation, the cap) stay out: Details lists them
// under "Behind the scenes". A hold opens the Waiting screen; every other row opens its full page (product decision, 3 Nov:
// ActivityDetail, loaded on the tap): its steps, times and amounts, and its proof (the transaction that set it off and
// the one that landed it, each with Copy and View; a private step says it has no public record), with its Problem and
// who a Hidden payment went to there. A label from another app is shown as text, never as a name we've checked.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { SpendingActivity } from "@zerofee/core/spending";
import { EarlierHistory } from "@zerofee/shell-api/EarlierHistory.tsx";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { Waiting } from "../Waiting.tsx";
import { describe, movementDollars, ownRowOf, ownRows, payeeOf } from "../format.ts";
import { swapDetail } from "../swap-detail.ts";
import { Bang, SmallCheck } from "../icons.tsx";
import type { Movement } from "../../types.ts";
import { useWallet } from "../runtime.tsx";
import { activityRows, homeRowOf, byEnd, carriedJob, endedNow, endsOf, goingOf, jobFacts, jobRowLine, joinTracks, movementEnded, rowEnded, whenOf, nameOf, onScreen, rowEndIso, rowFace, sendJobOf, sendRowOf, stoppedWays, usdOf, type JobRow } from "../activity-rows.ts";
import { inplaceDetail, inplaceJobDetail, inplaceRowOf, inplaceRows, isInplaceRow, type FloatSwapMove, type InplaceRow } from "../money/inplace-activity.ts";
import { isHomeSwapRow, watchSwapEnds } from "../money/swap-ended.ts";
import { SWAP_AGAIN } from "../../near-swap-words.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { NavRow } from "./NavRow.tsx";
import { ownSlot } from "../overlay-slot.ts";
import type * as LiveModule from "../money/LiveTrack.tsx";
import type * as DetailModule from "./ActivityDetail.tsx";
import { untilDate } from "../money/add-coins.ts";
import { addPage, movementPage, spendingPage, withTrackSteps } from "../proof.ts";
import { movementFacts, spendingFacts } from "../statement.ts";
import type { AddOnWay } from "../money/adds-on-way.ts";
import type { SiteBack } from "../money/site-back.ts";

/** A site wallet's Take out (the Activity centre's "back:<move id>" task, site-back.ts): its steps, proof and both 1Click
 *  deposits, from the core's own record; never the Browser (QA, 5 Nov: its row opened the Browser tab). */
async function openBack(bridge: ReturnType<typeof useWallet>["bridge"], id: string): Promise<Omit<DetailModule.DetailProps, "onClose"> | null> {
  const r = await bridge.call<SiteBack[]>("subwallet.site.moveBacks");
  const { BACK_ID, backPage, backTrack } = await import("../money/site-back.ts");
  const b = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => `${BACK_ID}${x.back?.id}` === id) : undefined;
  if (!b) return null;
  const { endLine, stepsLine } = await import("../money/live-steps.ts");
  const t = backTrack(b);
  return { title: t.title, line: endLine(t) || stepsLine(t), ...(b.back.usd ? { usd: `$${b.back.usd.toFixed(2)}` } : {}), atIso: new Date(t.startMs).toISOString(), page: backPage(b) };
}

type Row = { at: string; ledger: Movement } | { at: string; spending: JobRow };

/** `openId`: a task the Activity centre opened (live-steps.ts taskOf: "move:<id>", "send:<id>"): its page opens at once. */
/** An Add's page (Activity centre's "add:<key>" task): its words and proof, read from the core's job (subwallet.add.onWay). */
async function openAdd(bridge: ReturnType<typeof useWallet>["bridge"], id: string): Promise<Omit<DetailModule.DetailProps, "onClose"> | null> {
  const r = await bridge.call<AddOnWay[]>("subwallet.add.onWay");
  const a = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => `add:${x.key}` === id) : undefined;
  if (!a) return null;
  const { addTrack, endLine, stepsLine } = await import("../money/live-steps.ts");
  const t = addTrack(a);
  if (!t) return null;
  const labels = [t.steps[0]!.label, t.steps[1]!.label, t.steps[2]!.label] as const;
  const at = a.at?.landed ?? a.at?.private ?? a.at?.received;
  return { title: t.title, line: endLine(t) || stepsLine(t), ...(a.usd ? { usd: `$${Number(a.usd).toFixed(2)}` } : {}), atIso: new Date(at ?? Date.now()).toISOString(), page: addPage(a, labels) };
}

export function Activity({ onProblem, onHeld, onStatement, statementFailed, overlay, openId, onDone }: { /** In the Activity centre: ✕ on a row's page closes the centre too (its ‹ goes back to the list). */ onDone?: () => void;  onProblem: (p: Problem) => void; onHeld: (held: NonNullable<Movement["held"]>) => void; onStatement: () => void; statementFailed: boolean; overlay?: (node: ReactNode) => void; openId?: string }) {
  const { bridge, activity, tokens, chains, spending, wallets } = useWallet();
  const shell = useShell();
  const [moved, setMoves] = useState<SpendingActivity[]>([]);
  // the NEAR wallet's swaps in place (bug hunt, 4 Nov, item 2), from the core's own record of its moves
  const [swaps, setSwaps] = useState<InplaceRow[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!spending) return () => { live = false; };
    // its rows follow spending.changed, as Home's do: one source, never "On its way" here while Home says Done
    // (QA's UX hunt, 5 Nov); the swaps in place with them, and each swap's own end
    const read = () => {
      void bridge.call<SpendingActivity[]>("spending.activity").then((r) => live && "ok" in r && setMoves(r.ok), () => undefined);
      void bridge.call<FloatSwapMove[]>("subwallet.float.moves").then((r) => live && "ok" in r && Array.isArray(r.ok) && setSwaps(inplaceRows(r.ok, (id) => tokens.get(id))), () => undefined);
    };
    read();
    const off = bridge.on("spending.changed", read);
    // bug report (6 Nov): a job's end comes from the live watch's own 4 s read (live-steps watchLive), with no
    // spending.changed: Home's task ending is this list's cue to read its rows again, on the same tick (endedNow)
    const store = taskStore();
    let pending = new Set(store.list().filter((t) => t.app === "home" && t.state === "pending").map((t) => t.id));
    const offTasks = store.subscribe(() => {
      const list = store.list();
      if (endedNow(pending, list)) read();
      pending = new Set(list.filter((t) => t.app === "home" && t.state === "pending").map((t) => t.id));
      if (live) { setEnds(endsOf(list)); setGoing(goingOf(list)); }
    });
    // and a swap's end, however it was followed (real-tap proof, 6 Nov: a reloaded job's end left this list without it)
    const offSwaps = watchSwapEnds(taskStore(), read);
    return () => { live = false; off(); offSwaps(); offTasks(); };
  }, [bridge, spending]);
  // what the task store says ended (its end wins over a stale row of ours: activity-rows onScreen, rowFace)
  const [ends, setEnds] = useState(() => endsOf(taskStore().list()));
  // what is going in Now: its row is there only (the audit's M1, 7 Nov)
  const [going, setGoing] = useState(() => goingOf(taskStore().list()));
  const all = swaps?.length ? [...moved, ...swaps] : moved;
  // D137: what is in flight on top, its steps live (the same cards as Home's); the rows below are the record
  const [Live, setLive] = useState<typeof LiveModule.LiveHome | null>(null);
  // J2: a Send row's page is the job face (LiveTracker) with its proof (ActivityDetail JobProof), loaded on the tap
  const [Tracker, setTracker] = useState<typeof LiveModule.LiveTracker | null>(null);
  const [Proof, setProof] = useState<typeof DetailModule.JobProof | null>(null);
  const [job, setJob] = useState<{ t: LiveModule.LiveTrack; m: Movement } | null>(null);
  const feed = useRef({ movements: activity ?? [] });
  feed.current = { movements: activity ?? [] };
  useEffect(() => { let on = true; void import("../money/LiveTrack.tsx").then((m) => { if (on) { setLive(() => m.LiveHome); setTracker(() => m.LiveTracker); } }, () => undefined); return () => { on = false; }; }, []);
  // a swap in place: its one row is the centre's Now there (`onDone`: this is the centre), its going row here on Activity's own page; ended, the list's
  // J1: the centre's Now row opens its job's page here at once (LiveHome openId), never this list first
  const liveTop = Live ? <Live bridge={bridge} feed={feed} overlay={overlay} swaps={onDone ? "none" : "going"} {...(openId ? { openId } : {})} /> : null;
  // a job's steps, the same as its Jobs row (live-steps.ts, in the cards' own chunk): its page lists them all
  const [Steps, setSteps] = useState<typeof import("../money/live-steps.ts") | null>(null);
  useEffect(() => { let on = true; void import("../money/live-steps.ts").then((m) => on && setSteps(m), () => undefined); return () => { on = false; }; }, []);
  // a row's full page (product decision, 3 Nov): its code loads on the first tap
  const [Detail, setDetail] = useState<typeof DetailModule.ActivityDetail | null>(null);
  const [shown, setShown] = useState<Omit<DetailModule.DetailProps, "onClose"> | null>(null);
  const show = (p: Omit<DetailModule.DetailProps, "onClose">) => {
    setShown(p); setJob(null);
    if (!Detail) void import("./ActivityDetail.tsx").then((m) => setDetail(() => m.ActivityDetail), () => undefined);
  };
  const openJob = (t: LiveModule.LiveTrack, m: Movement) => {
    setShown(null); setJob({ t, m });
    if (!Proof) void import("./ActivityDetail.tsx").then((d) => setProof(() => d.JobProof), () => undefined);
  };
  const jobPage = job && Tracker ? <Tracker key={job.t.id} track={job.t} onClose={onDone ? () => { setJob(null); onDone(); } : () => setJob(null)} onBack={() => setJob(null)} {...(job.t.end ? { when: untilDate(job.m.updatedAtIso) } : {})} {...(Proof ? { proof: <Proof page={movementPage(job.m)} /> } : {})} /> : null;
  const detail = shown && Detail ? <Detail {...shown} onClose={onDone ? () => { setShown(null); onDone(); } : () => setShown(null)} {...(onDone ? { onBack: () => setShown(null) } : {})} /> : jobPage;
  // the page is a full-screen sheet over everything (D135), drawn where `overlay` draws (Home's page, or over the Activity
  // centre); never inside the list, where the centre's own sheet stack hid it or squeezed it (phone test, 4 Nov)
  // S10b: the same overlay holds the live tracker's page; this draws or clears only the row's own page
  const slot = useMemo(() => (overlay ? ownSlot(overlay) : null), [overlay]);
  useEffect(() => { slot?.draw(detail); }, [shown, Detail, job, Tracker, Proof]);
  useEffect(() => () => slot?.release(), [slot]);
  // an Add from another chain (live-steps.ts addTrack, "add:<last 6 of its address>"): its page from the core's own job,
  // whatever the list below holds (an empty Activity opens it too)
  useEffect(() => {
    const open = openId?.startsWith("add:") ? openAdd : openId?.startsWith("back:") ? openBack : null;
    if (!open || !openId) return;
    let live = true;
    void open(bridge, openId).then((p) => live && p && show(p), () => undefined);
    return () => { live = false; };
  }, [openId]);
  const asked = useRef<string | undefined>(undefined);
  // Reading: the list's own shape at once with one quiet line, never a spinner alone (Job 1, criterion 5).
  if (!activity) return (
    <div className="wl zf-enter" aria-busy="true">
      <p className="zf-small" role="status">Reading your activity…</p>
      <div className="wl-rows">{[0, 1, 2].map((i) => <div key={i} className="wl-row wl-row-skel" aria-hidden="true"><span /><div /><div /></div>)}</div>
    </div>
  );
  // one action, one row: a job still going is its live card above (Now), never a row here too (onScreen)
  const record = activityRows(activity, all, carriedJob);
  const { ledger, spending: moves } = onScreen(record, Date.now(), ends, going);
  // newest END first (the walk, item 2): a Move that ended last is on top, never under rows that ended during it
  const rows: Row[] = byEnd(ledger, moves, ends);
  // a web wallet's Send is its own card above this list (task-earlier.ts OWN_RECORD, "web-send:"): never "Nothing yet" under it
  const ownSends = rows.length === 0 && taskStore().list().some((t) => t.app === "home" && t.id.startsWith("web-send:"));
  if (record.ledger.length + record.spending.length === 0) return <div className="wl wl-empty">{liveTop}{!ownSends && <p className="zf-small wl-none">{webWallet() ? "Nothing yet. Money you add or send shows here." : <><span className="wl-none__solo">Nothing yet. Money you add, send or move shows here.</span><span className="wl-none__all">Nothing yet. Money you add, send, move or trade shows here.</span></>}</p>}<EarlierHistory bridge={bridge} /></div>;
  const now = Date.now();
  const own = ownRows(wallets);
  /** A ledger item's page: its words, its proof, its Problem and who a Hidden payment went to. */
  const ledgerPage = (m: Movement) => {
    const { title: said, detail: line0 } = describe(m, tokens, chains, own);
    // Private's way home, folded (the copy review's MUST, 8 Nov): the job's one row, each coin's figure on its page
    const home = homeRowOf(m, tokens);
    const send = home ? { title: home.title, line: home.line, usd: home.usd } : sendRowOf(m, undefined, tokens);
    const title = send?.title ?? said;
    const line = line0;
    const payee = m.private && m.kind === "pay" && !ownRowOf(m, own) ? payeeOf(m) : "";
    const swap = swapDetail(m, tokens, chains, own);
    return { title, line: send?.line ?? line, ...(send ? { usd: send.usd } : movementDollars(m, tokens) ? { usd: movementDollars(m, tokens)! } : {}), atIso: m.updatedAtIso, page: swap ? { ...movementPage(m), ended: swap.ended } : movementPage(m), ...(m.problem ? { onProblem: () => onProblem(m.problem!) } : {}), ...(payee ? { payee } : {}), facts: home ? [...movementFacts(m, tokens, chains, own), ...home.coins.map((c) => ({ label: c.symbol, value: c.usd }))] : movementFacts(m, tokens, chains, own), ...(swap?.line ? { line: swap.line } : {}), ...(swap?.dayFirst ? { dayFirst: true } : {}), };
  };
  // finding 61: a site's Add that stopped in the NEAR wallet: its page offers the one tap that ends it
  const waysOf = (s: (typeof moves)[number]) => stoppedWays(s, wallets).map((w) => ({
    label: w.label,
    run: () => {
      setShown(null);
      if (w.kind === "home" && w.parked) return void bridge.call("spending.putAway", { parked: w.parked }).then((r) => { if ("problem" in r) onProblem(r.problem); });
      if (w.kind === "home") return void shell.openMoney({ kind: "putaway" });
      void bridge.call("spending.makeReady", { network: w.network, usd: w.usd, ...(w.wallet ? { wallet: w.wallet } : {}) }).then((r) => { if ("problem" in r) onProblem(r.problem); });
    },
  }));
  // a swap in place's page; a true refund's next tap is Swap again (copy review, 6 Nov)
  const inplacePageOf = (s: InplaceRow) => {
    const { again, ...d } = inplaceDetail(s);
    return again ? { ...d, ways: [{ label: SWAP_AGAIN, run: () => { setShown(null); onDone?.(); shell.openMoney({ kind: "swap", wallet: "near" }); } }] } : d;
  };
  const spendingOf = (s: (typeof moves)[number]) => ({ title: nameOf(s), line: jobRowLine(s), ...(usdOf(s) ? { usd: usdOf(s)! } : {}), atIso: s.atIso, page: withTrackSteps(spendingPage(s, activity), Steps ? joinTracks([{ ...s, status: s.own ?? s.status }, ...(s.parts ?? [])].map((x) => Steps.moveTrack(x))) : undefined), facts: jobFacts(s, spendingFacts(s)), ...(isInplaceRow(s) ? inplacePageOf(s as InplaceRow) : {}), ...(s.stoppedShort ? { ways: waysOf(s) } : {}) });
  // the Activity centre's task, once: "move:<row id>" or "send:<movement id>"
  // a swap in place's job (its running row's tap): its own page, once the core's record is read, kept up as that record changes;
  // never reopened once closed
  if (openId && isHomeSwapRow(openId)) {
    if (swaps) {
      const s = swaps.find((x) => x.id === inplaceRowOf(openId));
      const job = s ? null : taskStore().list().find((t) => t.app === "home" && t.id === openId);
      const at = `${openId}:${s?.status ?? job?.state ?? ""}`;
      if (asked.current !== at && (s || job)) {
        const first = asked.current === undefined;
        asked.current = at;
        if (first || shown) queueMicrotask(() => show(s ? spendingOf(s) : inplaceJobDetail(job!)));
      }
    }
  } else if (openId && asked.current !== openId && !/^(add|back):/.test(openId)) {
    const id = openId.replace(/^(move|send):/, "");
    // J1: a job still going opens its live page (LiveHome openId, above); an ended one its row's page, once its row is read
    // (the first render may have no Spending rows yet: never marked asked before it is found, or the tap opened the list)
    const going = taskStore().list().some((t) => t.app === "home" && t.id === openId && t.state === "pending");
    const s = record.spending.find((x) => x.id === id || !!x.parts?.some((p) => p.id === id)), m = record.ledger.find((x) => x.id === id) ?? activity.find((x) => x.id === id);
    const sj = m ? sendJobOf(m, tokens) : null;
    if (going) asked.current = openId;
    else if (s) { asked.current = openId; queueMicrotask(() => show(spendingOf(s))); }
    else if (m && sj) { asked.current = openId; queueMicrotask(() => openJob(sj, m)); }
    else if (m) { asked.current = openId; queueMicrotask(() => show(ledgerPage(m))); }
  }
  return (
    <div className="wl zf-enter">
      {liveTop}
      <div className="wl-rows wl-top">
        {rows.map((row) => {
          if ("spending" in row) {
            const s = row.spending;
            // finding 61: an Add that stopped in the NEAR wallet is marked as stopped, never ticked as done; a job the
            // store says ended while our copy still goes: the store's end (rowFace)
            const face = rowFace(s, ends, now);
            const usd = usdOf(s);
            const inside = (
              <>
                <span className={`zf-tick${face.mark === "bad" ? " wl-tick-alert" : face.mark === "on" ? " on" : " off"}`} aria-hidden="true">{face.mark === "bad" ? <Bang /> : face.mark === "on" ? <SmallCheck /> : null}</span>
                <div><div className="t">{nameOf(s)}</div><div className="d">{face.line}</div></div>
                <div className="r">{usd && <div className="v">{usd}</div>}<div className="vd">{whenOf(rowEndIso(s, ends), rowEnded(s), now)}</div></div>
              </>
            );
            return <button className="wl-row wl-pick" key={s.id} onClick={() => (s.held ? onHeld(s.held) : show(spendingOf(s)))} data-testid="activity-row">{inside}</button>;
          }
          const m = row.ledger;
          const { title: said, detail } = describe(m, tokens, chains, own);
          // a Send keeps its job's name and figure once it ends (the walk, item 7); Private's way home is its job's one row
          const home = homeRowOf(m, tokens);
          const send = home ? { title: home.title, line: home.line, usd: home.usd } : sendRowOf(m, undefined, tokens);
          const title = send?.title ?? said;
          const usd = send?.usd ?? movementDollars(m, tokens);
          // every row opens: a hold its Waiting screen, any other its full page (its proof, its Problem, who a Hidden
          // payment went to, from this phone's record: no explorer shows that)
          // J2: a Send's page is the job face (its Now row's page), with its proof under it
          const sj = sendJobOf(m, tokens);
          const open = m.status === "waiting" && m.held ? () => onHeld(m.held!) : sj && Tracker ? () => openJob(sj, m) : () => show(ledgerPage(m));
          const inside = (
            <>
              <span className={`zf-tick${m.status === "moving" || m.status === "waiting" ? " off" : m.problem || m.status === "problem" ? " wl-tick-alert" : " on"}`} aria-hidden="true">
                {m.status === "done" || m.status === "refunded" ? <SmallCheck /> : m.problem || m.status === "problem" ? <Bang /> : null}
              </span>
              <div><div className="t">{title}</div><div className="d">{send?.line ?? detail}</div></div>
              <div className="r">{usd && <div className="v">{usd}</div>}<div className="vd">{whenOf(m.updatedAtIso, movementEnded(m), now)}</div></div>
            </>
          );
          return <button className="wl-row wl-pick" key={m.id} onClick={open} data-testid="activity-row">{inside}</button>;
        })}
      </div>
      {/* H-3: every move in a month, as a file the person keeps */}
      <div className="wl-rows wl-st-row"><NavRow title="Statement" line={statementFailed ? "Didn't open. Tap to try again." : "Every move in a month, as a file"} onClick={onStatement} /></div>
      {overlay ? null : detail}
    </div>
  );
}
