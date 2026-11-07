// D144: the Activity centre, the whole screen (D135's Sheet): what is going on now, then what happened, newest first.
// Every task is one shared row (LiveRow, ACTIVITY-MOTION 4 Nov): the app's mark, its title, one line (the step under way
// and how long, in words; or where the money is), its dollars, and a progress line under it. The steps themselves live
// one tap away, in the app. Loaded on the bell's first tap (TaskBell.tsx).
import { useEffect, useState, type ReactNode } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { LiveRow, progressOf, timeSlot, type LiveRowState } from "@zerofee/design/LiveRow.tsx";
import { checkpointAt, checkpointKind } from "@zerofee/design/checkpoints.ts";
import { ago, tickEvery } from "@zerofee/design/time.ts";
import { ActSwap, AppAgent, AppBrowser, AppChat, AppHome, AppTrade } from "@zerofee/design/icons.tsx";
import { useShell } from "./AppFrame.tsx";
import { cardStep, timeLeft } from "./job-steps.ts";
import { TASK_APP_HOME, taskStore, type Task, type TaskApp } from "./tasks.ts";
import { useAppHistories, useHistory } from "./history-slot.ts";
import { earlierOf } from "./task-earlier.ts";
import { siteMoneyRow } from "./site-money-rows.ts";
import { TxProofLine } from "./TxProofLine.tsx";
import type { AppId } from "./app-module.ts";
import "./taskcentre.css";

const ICON: Record<TaskApp, () => ReactNode> = { home: AppHome, trade: AppTrade, perps: AppTrade, agentzero: AppAgent, browser: AppBrowser, chat: AppChat };
const ORDER: TaskApp[] = ["home", "trade", "perps", "agentzero", "browser", "chat"];
// "Ended", not "Earlier" (webd-money2 crawl, 4 Nov: a task that ended a moment ago, "now", sat under "Earlier"; the
// Copywriter: the opposite of running, for a trade that worked, failed or was cancelled)
export const CENTRE_WORDS = { title: "Activity", now: "Now", earlier: "Ended", empty: "Nothing yet. What you do in any app shows here." } as const;
/** A receipt's rows (the copywriter, 5 Nov). `public`: under AgentZero's payments only (they never name the Safe). */
/** A row's mark: its app's, or on a swap job of Home's, the swap mark its row on Home has (by the title, as Home's row: live-steps.ts startingTracks). */
export const markOf = (t: Pick<Task, "app" | "id" | "title">): (() => ReactNode) => (t.app === "home" && (t.id.startsWith("swap:") || /^Swap\b/.test(t.title)) ? ActSwap : ICON[t.app]);
export const RECEIPT_WORDS = { amount: "Amount", where: "Where", when: "When", proof: "Proof", public: "Anyone can check this on the chain. It never names your Safe." } as const;
/** A finished task with a public transaction is a receipt: a tap opens it (QA 4 Nov: a receipt row opened nothing). */
export const hasReceipt = (t: Pick<Task, "state" | "proof">): boolean => t.state !== "pending" && !!t.proof?.length;
const ENDED_WORDS: Record<Exclude<Task["state"], "pending">, string> = { done: "Done", failed: "Didn't finish", stopped: "Stopped" };
const ROW_STATE: Record<Task["state"], LiveRowState> = { pending: "going", done: "done", failed: "stopped", stopped: "stopped" };

/** A going task's one line: the step under way (or next) and the time LEFT from the protocol's own estimate (its endsAt;
 *  product decision, 5 Nov), or that there is none: never the time spent. */
export function goingLine(t: Pick<Task, "steps" | "startedAt" | "endsAt"> & { title?: string }, now: number): string {
  const step = t.steps.find((s) => s.state === "doing") ?? t.steps.find((s) => s.state === "waiting") ?? t.steps.at(-1);
  const left = timeLeft(t.endsAt, now, t.startedAt);
  return step ? `${cardStep(step.label, t.title)} · ${left}` : left;
}

/** The going line's two columns (real-tap proof, 6 Nov: at 390 wide, "NEAR Intents is swapping it · 1 s left" lost its time):
 *  the step on the left, the time left under the dollars, as Home's own row (LiveTrack.tsx rowParts). No step: the time alone. */
export function goingParts(t: Pick<Task, "steps" | "startedAt" | "endsAt"> & { title?: string }, now: number): { line: string; left?: string } {
  const line = goingLine(t, now);
  const at = line.lastIndexOf(" · ");
  return at < 0 ? { line } : { line: line.slice(0, at), left: line.slice(at + 3) };
}

/** A finished task's one line: where the money is, or why it stopped. */
export const endedLine = (t: Task): string => (t.state === "done" ? t.where ?? t.detail ?? ENDED_WORDS.done : t.detail ?? t.where ?? ENDED_WORDS[t.state as Exclude<Task["state"], "pending">]);

/** Newest first, across every app (no groups: the mark says which app). */
export const newestFirst = (tasks: readonly Task[]): Task[] => [...tasks].sort((a, b) => (b.endedAt ?? b.updatedAt ?? b.startedAt) - (a.endedAt ?? a.updatedAt ?? a.startedAt) || ORDER.indexOf(a.app) - ORDER.indexOf(b.app));

/** `only`: one app's tasks (tasks.open({ app })); its chip at the top clears it (`onAll`). `onBack`: opened from a list one
 *  step up (Your account): ‹ goes back there, ✕ closes it all. */
export function TaskCentre({ onClose, onBack, only, onAll }: { onClose: () => void; onBack?: () => void; only?: TaskApp; onAll?: () => void }) {
  const shell = useShell();
  const store = taskStore();
  const history = useHistory();
  const others = [...useAppHistories()].filter(([a]) => !only || a === only).sort(([a], [b]) => ORDER.indexOf(a as TaskApp) - ORDER.indexOf(b as TaskApp));
  const [over, setOver] = useState<ReactNode>(null);
  const [, changed] = useState(0);
  useEffect(() => store.subscribe(() => changed((n) => n + 1)), [store]);
  const all = store.list().filter((t) => !only || t.app === only);
  const now = newestFirst(all.filter((t) => t.state === "pending"));
  // Home's finished tasks live in its history (the Money list), never twice. Home's history is drawn on the whole centre
  // and on Home alone (`only` home), so the rule holds on both.
  const homeHistory = !!history && (!only || only === "home");
  const earlier = newestFirst(earlierOf(all, homeHistory, new Set(others.map(([a]) => a))));
  // the words of what is still going ("12 s", "4 min"): every second under a minute, then every 15 s
  const [at, setAt] = useState(() => Date.now());
  const youngest = now.length ? Math.min(...now.map((t) => at - t.startedAt)) : Infinity;
  useEffect(() => {
    if (!now.length) return;
    const t = setTimeout(() => setAt(Date.now()), tickEvery(youngest));
    (t as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(t);
  }, [now.length > 0, at]);
  // a site wallet's money row the Browser made before (browser-sites crawl F2: it opened the Browser's start page): its
  // move is Home's own job now, so it opens Home's Activity; every other row opens its app at its own route
  const open = (t: Task) => {
    onClose();
    if (siteMoneyRow(t)) return shell.openApp(TASK_APP_HOME.home.app as AppId, "activity");
    shell.openApp(TASK_APP_HOME[t.app].app as AppId, t.open?.route);
  };
  const row = (t: Task) => {
    const Icon = markOf(t);
    const going = t.state === "pending";
    const line = going ? goingLine(t, Math.max(at, Date.now())) : endedLine(t);
    const parts = going ? goingParts(t, Math.max(at, Date.now())) : null;
    const slot = parts ? timeSlot(parts.left) : {};
    const when = parts ? slot.when : ago(new Date(t.endedAt ?? t.updatedAt ?? t.startedAt).toISOString(), Date.now());
    return (
      <li key={`${t.app}:${t.id}`}>
        <LiveRow mark={<Icon />} title={t.title} line={parts ? parts.line : line} {...(slot.below ? { below: slot.below } : {})} usd={t.usd} when={when} state={ROW_STATE[t.state]} p={going ? progressOf(t.steps) : undefined} {...(going ? { track: { kind: checkpointKind(t), at: checkpointAt(t.steps) } } : {})}
          onOpen={() => (hasReceipt(t) ? setOver(<Receipt t={t} onClose={() => setOver(null)} onView={(url) => { setOver(null); onClose(); shell.openApp("browser", undefined, url); }} />) : open(t))} label={[t.title, line, t.usd, parts ? undefined : when, `Open ${TASK_APP_HOME[t.app].name}`].filter(Boolean).join(". ")} />
        {t.proof?.map((x) => <TxProofLine key={x.hash} tx={x} onView={(url) => { onClose(); shell.openApp("browser", undefined, url); }} />)}
      </li>
    );
  };
  const part = (label: string, tasks: Task[]) => tasks.length > 0 && (
    <section className="tc-part" aria-label={label}>
      <h2 className="tc-h">{label}</h2>
      <ul className="zf-lrows" role="list">{tasks.map(row)}</ul>
    </section>
  );
  return (
    <>
    <Sheet title={CENTRE_WORDS.title} onClose={onClose} {...(onBack ? { onBack } : {})}>
      <div className="tc" data-testid="task-centre">
        {only && <button type="button" className="tc-chip" onClick={onAll} aria-label={`Only ${TASK_APP_HOME[only].name}. Show every app`}>{TASK_APP_HOME[only].name}<span aria-hidden="true">✕</span></button>}
        {all.length === 0 && only && !history && others.length === 0 ? <p className="zf-small tc-empty">{`Nothing from ${TASK_APP_HOME[only].name} yet.`}</p> : all.length === 0 && !history && others.length === 0 ? <p className="zf-small tc-empty">{CENTRE_WORDS.empty}</p> : <>{part(CENTRE_WORDS.now, now)}{part(CENTRE_WORDS.earlier, earlier)}</>}
        {/* the money history Home keeps, under what is going on: one Activity (D144, the grade's §4.7) */}
        {homeHistory && <section className="tc-part tc-history" aria-label="History">{history(setOver, onClose)}</section>}
        {/* another app's own history (Trade's trades): its name over it, under Home's */}
        {others.map(([a, draw]) => <section className="tc-part tc-history" key={a} aria-label={`${TASK_APP_HOME[a as TaskApp].name} history`}><h3 className="zf-small tc-part__h">{TASK_APP_HOME[a as TaskApp].name}</h3>{draw(setOver, onClose)}</section>)}
      </div>
    </Sheet>
    {over}
    </>
  );
}

/** A receipt (any app's finished task with a public transaction): what it was, how much, where, when, and its proof. */
export function Receipt({ t, onClose, onView }: { t: Task; onClose: () => void; onView: (url: string) => void }) {
  const when = ago(new Date(t.endedAt ?? t.updatedAt ?? t.startedAt).toISOString(), Date.now());
  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="tc tc-receipt" data-testid="task-receipt">
        {t.usd && <p className="tc-receipt__row"><span className="zf-small">{RECEIPT_WORDS.amount}</span><span>{t.usd}</span></p>}
        <p className="tc-receipt__row"><span className="zf-small">{RECEIPT_WORDS.where}</span><span>{endedLine(t)}</span></p>
        <p className="tc-receipt__row"><span className="zf-small">{RECEIPT_WORDS.when}</span><span>{when}</span></p>
        <h2 className="tc-h">{RECEIPT_WORDS.proof}</h2>
        {t.proof!.map((x) => <TxProofLine key={x.hash} tx={x} onView={onView} />)}
        {t.app === "agentzero" && <p className="zf-small tc-receipt__note">{RECEIPT_WORDS.public}</p>}
      </div>
    </Sheet>
  );
}
