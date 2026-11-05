// AgentZero's Jobs on screen (product decision, 3 Nov): the top bar's "Now" count, the Jobs sheet (now, AgentZero's running
// jobs and routines with Stop, the last day's finished ones; a tap shows one, with "Ask AgentZero about this"), the live
// card a money sheet from the chat leaves in the thread, and AgentZero's email. Loaded with the first of them, never in
// Home's first load. Reads only (use-jobs.ts, jobs.ts): a state shown is the record's own, and a read that failed is said.
// Every sheet is the one Sheet (D135): whole screen, Close, a fixed size; a job's detail opens inside it, with Back.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Job } from "@zerofee/agent/zero/jobs";
import type { Routine } from "@zerofee/agent/zero/routines";
import { engineTasks, keptEngine, localKeep, moneyTask, payPhase, payReceipt, saveEngine, SHEET_LOOK_MS, syncEngine, tasksOf } from "./az-tasks.ts";

/** A money sheet's task (az-tasks.ts moneyTask), made when Review is tapped. */
export type SheetTask = ReturnType<typeof moneyTask>;
export const NOTHING_MOVED = "Nothing new in your activity. If you closed the sheet, nothing moved.";
export const NOTHING_PAID = "No payment receipt. If you closed the sheet, nothing was paid.";
import { resumeAsks, settlePays } from "./az-tasks-live.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { describe } from "@zerofee/wallet/app/format.ts";
import { ledgerRow } from "@zerofee/wallet/app/statement.ts";
import { legsLine } from "@zerofee/wallet/app/activity-rows.ts";
import type { Chain, Token } from "@zerofee/wallet/types.ts";
import { jobLine, jobSentence, jobTitle } from "@zerofee/agent/zero/jobs";
import { doWords, whenWords } from "@zerofee/agent/zero/routines";
import { agoWords, inFlight, jobsOf, MAIL_WORDS, mailLines, startedSince, STATE_WORDS, type JobItem } from "./jobs.ts";
import { useJobs } from "./use-jobs.ts";
import { NOT_HERE } from "./ask-money.ts";
import "./jobs.css";
// The agent package's stop sheet (the core's own), loaded with the first Stop
const ChatSheetCard = lazy(() => import("@zerofee/agent/app/ChatSheetCard.tsx").then((m) => ({ default: m.ChatSheetCard })));

/** One item in words: its title and line as Activity and AgentZero's screens say them (on the phone), and the message
 *  "Ask AgentZero about this" sends: what it was, its state and time, never a name or an address. */
export function itemWords(i: JobItem, tokens: Map<string, Token>, chains: Chain[], nowMs: number): { title: string; line: string; state: string; ask: string } {
  const when = new Date(Date.parse(i.startedIso)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const state = i.kind === "move" && i.state === "done" && "ledger" in i && ["transfer", "withdraw", "pay", "deposit"].includes(i.ledger.kind) ? "Arrived" : STATE_WORDS[i.state];
  if (i.kind === "move" && "ledger" in i) {
    const { title, detail } = describe(i.ledger, tokens, chains);
    const r = ledgerRow(i.ledger, tokens, chains);
    const what = [title.split(" · ")[0], r ? `${r.amount} ${r.coin}`.trim() : ""].filter(Boolean).join(", ");
    return { title, line: detail, state, ask: `What's happening with my move: ${what}, ${state.toLowerCase()}, started ${when}?` };
  }
  if (i.kind === "move" && "spending" in i) return { title: i.spending.words, line: legsLine(i.spending), state, ask: `What's happening with my move: ${i.spending.words}, ${state.toLowerCase()}, at ${when}?` };
  if (i.kind === "job") return { title: jobTitle(i.job.kind), line: jobLine(i.job.kind, i.job), state, ask: `Tell me about my running job: ${jobTitle(i.job.kind)}.` };
  if (i.kind === "routine") return { title: whenWords(i.routine.when), line: doWords(i.routine.do, i.routine.limitUsd), state, ask: `Tell me about my routine: ${whenWords(i.routine.when)}.` };
  void nowMs;
  return { title: i.receipt.title, line: i.receipt.why[0] ?? "", state: i.receipt.state === "refused" ? "AgentZero said no" : i.receipt.state === "note" ? "Nothing moved" : "Done", ask: `Tell me about this: ${i.receipt.title}, at ${when}.` };
}

/** D144: AgentZero's running jobs and routines in the app's one Activity centre (kept in step with its engine); after a
 *  restart, money asks kept from before one task per move are ended and a pay sheet's task is settled. Draws nothing. */
export function AgentTasks({ bridge }: { bridge: Bridge }) {
  const shell = useShell();
  const tasks = tasksOf(shell);
  const st = useJobs(bridge, { on: !!tasks });
  const kept = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!tasks || resumed.has(bridge)) return;
    resumed.add(bridge);
    resumeAsks(tasks, localKeep());
  }, [bridge, tasks]);
  useEffect(() => {
    if (!tasks) return;
    if (st.agent && !settled.has(bridge)) { settled.add(bridge); settlePays(tasks, localKeep(), st.agent.receipts); }
    kept.current ??= keptEngine();
    syncEngine(tasks, st.agent ? engineTasks(st.agent, ENGINE_WORDS) : null, kept.current);
    saveEngine(kept.current);
  }, [tasks, st.agent]);
  return null;
}
const resumed = new WeakSet<Bridge>();
const settled = new WeakSet<Bridge>();
const ENGINE_WORDS = { job: (j: Job) => jobTitle(j.kind), jobLine: (j: Job) => jobLine(j.kind, j), routine: (r: Routine) => whenWords(r.when), routineLine: (r: Routine) => doWords(r.do, r.limitUsd) };

/** The menu row's count: "2 now", or nothing. */
export function NowCount({ bridge }: { bridge: Bridge }) {
  const n = jobsOf(useJobs(bridge), Date.now()).moving;
  return n ? <span className="zf-small azj-count">{`${n} now`}</span> : null;
}

function Row({ i, w, nowMs, onOpen }: { i: JobItem; w: ReturnType<typeof itemWords>; nowMs: number; onOpen: () => void }) {
  return (
    <button type="button" className="azj-row" onClick={onOpen}>
      <span className={`azj-mark azj-mark--${inFlight(i.state) ? "fly" : i.state === "problem" || i.state === "came-back" ? "bad" : i.state === "running" ? "run" : "done"}`} aria-hidden="true" />
      <span className="azj-text"><span className="azj-t">{w.title}</span><span className="zf-small azj-d">{w.line}</span></span>
      <span className="azj-right"><span className="zf-small azj-s">{w.state}</span><span className="zf-small azj-d">{agoWords(i.kind === "job" || i.kind === "routine" ? i.startedIso : i.atIso, nowMs)}</span></span>
    </button>
  );
}

/** The Jobs sheet: now, then the last day; `open`: an item to show first (a live card's tap). */
export function JobsSheet({ bridge, open, onAsk, onClose }: { bridge: Bridge; open?: string | null; onAsk: (words: string) => void; onClose: () => void }) {
  const st = useJobs(bridge);
  const nowMs = Date.now();
  const j = jobsOf(st, nowMs);
  const [shown, setShown] = useState<string | null>(open ?? null);
  const all = [...j.now, ...j.recent];
  const item = shown ? all.find((x) => x.key === shown) ?? null : null;
  const words = (i: JobItem) => itemWords(i, st.tokens, st.chains, nowMs);
  return (
    <Sheet title="Jobs" onClose={onClose}>
      {shown ? (
        <JobDetail bridge={bridge} item={item} w={item ? words(item) : null} nowMs={nowMs} stopRoutine={st.stopRoutine} onBack={() => setShown(null)} onAsk={(w) => (onClose(), onAsk(w))} />
      ) : (
        <div className="azj">
          {j.unread.map((u) => <p key={u} className="zf-small azj-unread" role="status">{u}</p>)}
          <p className="zf-label azj-head">Now</p>
          {j.loading ? <p className="zf-small azj-none" role="status">Reading your activity…</p>
            : j.now.length === 0 ? <p className="zf-small azj-none">Nothing is on its way, and AgentZero has no job running.</p>
            : <div className="azj-rows">{j.now.map((i) => <Row key={i.key} i={i} w={words(i)} nowMs={nowMs} onOpen={() => setShown(i.key)} />)}</div>}
          <p className="zf-label azj-head">Last 24 hours</p>
          {!j.loading && j.recent.length === 0 ? <p className="zf-small azj-none">Nothing finished in the last day.</p>
            : <div className="azj-rows">{j.recent.map((i) => <Row key={i.key} i={i} w={words(i)} nowMs={nowMs} onOpen={() => setShown(i.key)} />)}</div>}
          {st.at && <p className="zf-small azj-when">{`Checked ${new Date(st.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}. Moves come from your Activity.`}</p>}
        </div>
      )}
    </Sheet>
  );
}

function JobDetail({ bridge, item, w, nowMs, stopRoutine, onBack, onAsk }: { bridge: Bridge; item: JobItem | null; w: ReturnType<typeof itemWords> | null; nowMs: number; stopRoutine?: ((id: string) => Promise<void>) | undefined; onBack: () => void; onAsk: (words: string) => void }) {
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!item || !w) return (
    <div className="azj">
      <button type="button" className="zf-link azj-back" onClick={onBack}>Back</button>
      <p className="zf-body">This one isn't in the last day's list any more.</p>
    </div>
  );
  const url = "ledger" in item ? item.ledger.explorerUrls.at(-1) : undefined;
  const at = (iso: string) => new Date(Date.parse(iso)).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="azj">
      <button type="button" className="zf-link azj-back" onClick={onBack}>Back</button>
      <p className="zf-title azj-title">{w.title}</p>
      {w.line && <p className="zf-small azj-d">{w.line}</p>}
      <div className="azj-facts">
        <p className="azj-fact"><span>Status</span><span>{w.state}</span></p>
        <p className="azj-fact"><span>{item.kind === "job" || item.kind === "routine" ? "Started" : "Began"}</span><span>{at(item.startedIso)}</span></p>
        {item.atIso !== item.startedIso && <p className="azj-fact"><span>Last change</span><span>{`${at(item.atIso)} · ${agoWords(item.atIso, nowMs)}`}</span></p>}
        {"by" in item && item.by === "agentzero" && <p className="azj-fact"><span>Started by</span><span>AgentZero, on your tap</span></p>}
        {item.kind === "job" && <p className="azj-fact"><span>What it does</span><span>{jobSentence(item.job)}</span></p>}
        {item.kind === "receipt" && item.receipt.why.slice(1).map((x, k) => <p key={k} className="zf-small azj-d">{x}</p>)}
      </div>
      <div className="azj-acts">
        <button type="button" className="zf-btn" onClick={() => onAsk(w.ask)}>Ask AgentZero about this</button>
        {url && <button type="button" className="zf-btn azc-btn-quiet" onClick={() => void bridge.call("device.openUrl", { url, mode: "sheet" })}>See its public record</button>}
        {item.kind === "job" && <button type="button" className="zf-btn azc-btn-quiet" onClick={() => setStopping(true)}>Stop this job</button>}
        {item.kind === "routine" && stopRoutine && <button type="button" className="zf-btn azc-btn-quiet" disabled={busy} onClick={() => { setBusy(true); void stopRoutine(item.routine.id).finally(() => { setBusy(false); onBack(); }); }}>{busy ? "Stopping…" : "Stop this routine"}</button>}
      </div>
      {stopping && item.kind === "job" && <Suspense fallback={<p className="zf-small">Opening…</p>}><ChatSheetCard bridge={bridge} sheet={{ kind: "stop-job", job: item.job.kind }} onDone={() => (setStopping(false), onBack())} /></Suspense>}
    </div>
  );
}

/** The live card a money sheet from the chat leaves in the thread: the move it started, its state and time, until it
 *  arrives. `since`: when the person tapped Review. Its tap opens the move in Jobs. */
export function JobCard({ bridge, since, onOpen, task, pay = false }: { bridge: Bridge; since: number; onOpen: (key: string | null) => void; task?: SheetTask | null | undefined; pay?: boolean }) {
  const [nowMs, setNow] = useState(Date.now());
  const [eager, setEager] = useState(true);
  // when the sheet closed (this card shows then): "nothing moved" is said only 2 minutes after it
  const [closedAt] = useState(Date.now);
  const st = useJobs(bridge, { eager });
  const j = jobsOf(st, nowMs);
  const it = startedSince([...j.now, ...j.recent], since);
  const done = !!it && !inFlight(it.state);
  const late = nowMs - closedAt > SHEET_LOOK_MS;
  // a pay sheet: AgentZero's own receipt is its record (a pocket payment has no Activity row); its task follows it
  const paid = pay ? payReceipt(st.agent?.receipts ?? [], since) : null;
  useEffect(() => {
    if (!pay || !task || task.ended) return;
    const p = payPhase(paid, { closedAt, now: nowMs });
    task.to(p, p === "closed" ? NOTHING_PAID : paid?.title);
  }, [pay, task, paid?.id, paid?.state, nowMs, closedAt]);
  // the clock on the card moves while it's on its way; reads slow down once it has arrived or nothing came
  useEffect(() => { if (done || (late && !it)) setEager(false); }, [done, late, it]);
  // the clock ticks while the move is on its way, and while its task waits for a confirmed end
  useEffect(() => { if (done && (!task || task.ended)) return; const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, [done, task]);
  if (pay) {
    const line = paid ? paid.title : st.agent === null ? "Reading AgentZero's receipts…" : late ? NOTHING_PAID : "Waiting for the payment's receipt…";
    const state = paid ? (paid.state === "done" ? "Paid" : paid.state === "refused" ? "AgentZero said no" : "Nothing moved") : "";
    return <button type="button" className={`azc-step azj-card${paid ? " is-done" : ""}`} onClick={() => onOpen(paid ? `receipt:${paid.id}` : null)}><span className={`azj-mark azj-mark--${!paid ? "fly" : paid.state === "done" ? "done" : "bad"}`} aria-hidden="true" /><span className="azj-text"><span className="azc-step-line">{line}</span><span className="zf-small azj-d">Open Jobs</span></span>{state && <span className="zf-small azj-s">{state}</span>}</button>;
  }
  if (!it) {
    const line = st.ledger === "unread" ? "Your activity couldn't be read just now." : late ? NOTHING_MOVED : "Looking for it in your activity…";
    return <button type="button" className="azc-step azj-card" onClick={() => onOpen(null)}><span className="azj-text"><span className="azc-step-line">{line}</span><span className="zf-small azj-d">Open Jobs</span></span></button>;
  }
  const w = itemWords(it, st.tokens, st.chains, nowMs);
  return (
    <button type="button" className={`azc-step azj-card${done ? " is-done" : ""}`} onClick={() => onOpen(it.key)} aria-label={`${w.title}. ${w.state}. Open it in Jobs`}>
      <span className={`azj-mark azj-mark--${inFlight(it.state) ? "fly" : it.state === "problem" || it.state === "came-back" ? "bad" : "done"}`} aria-hidden="true" />
      <span className="azj-text"><span className="azc-step-line">{w.title}</span><span className="zf-small azj-d">{[w.line, agoWords(it.startedIso, nowMs)].filter(Boolean).join(" · ")}</span></span>
      <span className="zf-small azj-s">{w.state}</span>
    </button>
  );
}

/** The menu row's second line: the address, or that there is none yet (or that it couldn't be read). */
export function MailHint({ bridge }: { bridge: Bridge }) {
  const address = useMailAddress(bridge);
  if (address === undefined) return null;
  return <span className="zf-small azj-d">{address === "unread" ? "Couldn't be read just now" : address && address.includes("@") ? `${address} · not working yet` : "No address yet"}</span>;
}

/** AgentZero's address, kept on this device by the core (account.agent.mailAddress: nothing is fetched to read it; builder
 *  2's mailbox.address() reads the same method). A core with no mailbox ("not ready") has none. */
function useMailAddress(bridge: Bridge): string | null | undefined | "unread" {
  const [address, setAddress] = useState<string | null | undefined | "unread">(undefined);
  useEffect(() => {
    let live = true;
    void bridge.call<{ address: string | null }>("account.agent.mailAddress", {}).then((r) => {
      if (!live) return;
      if ("ok" in r) setAddress(typeof r.ok?.address === "string" ? r.ok.address : null);
      else setAddress(NOT_HERE.has(r.problem.code) ? null : "unread");
    }, () => live && setAddress("unread"));
    return () => void (live = false);
  }, [bridge]);
  return address;
}

/** AgentZero's email: its address (a Copy that copies), or what it will be and when; never a dead button. */
export function MailSheet({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  const address = useMailAddress(bridge);
  const [copied, setCopied] = useState(false);
  const has = typeof address === "string" && address.includes("@");
  return (
    <Sheet title={MAIL_WORDS.title} onClose={onClose}>
      <div className="azj">
        {address === undefined ? <p className="zf-small azj-none" role="status">Reading…</p> : (
          <>
            <p className="zf-title azj-title">{has ? (address as string) : address === "unread" ? "Can't see it right now" : "No address yet"}</p>
            {mailLines(address).map((l) => <p key={l} className="zf-body azj-mail">{l}</p>)}
            {has && <div className="azj-acts"><button type="button" className="zf-btn azc-btn-quiet" onClick={() => void navigator.clipboard?.writeText(address as string).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy the address"}</button></div>}
          </>
        )}
      </div>
    </Sheet>
  );
}
