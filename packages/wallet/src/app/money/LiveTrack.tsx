// D137: the live step monitor's faces. On Home, one row per Add, Send, Swap or Move in flight under "Jobs" (was "Now", 5 Nov), at the top of
// the wallets it touches (the shared LiveRow, ACTIVITY-MOTION 4 Nov: its hairline is its progress line); a tap opens the
// tracker, the whole screen (D135's Sheet), each step with when it was reached. Times come from live-steps.ts (the
// engine's own states, or the moment this phone saw a step done), always in words ("2 min"), never a clock. Loaded
// after Home's first paint.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cardStep, rowTook, timeLeft } from "@zerofee/shell-api/job-steps.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ReceiptMark } from "@zerofee/design/Receipt.tsx";
import "@zerofee/design/receipt.css";
import { LiveRow, progressOf, timeSlot, type LiveRowState } from "@zerofee/design/LiveRow.tsx";
import { checkpointAt } from "@zerofee/design/checkpoints.ts";
import { Checkpoints } from "@zerofee/design/Checkpoints.tsx";
import { FACE_CARD, jobEnds, jobFace, linePhrases } from "./job-face.ts";
import { shortElapsed, tickEvery } from "@zerofee/design/time.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import type { Movement } from "../../types.ts";
import { isHomeSwapRow } from "./swap-ended.ts";
import { FOLD_AFTER_MS, FOLD_MS, dropMerged, endFace, endGone, endLine, oneLine, rowTitle, trackMark, publishTracks, keptTrack, SLOW_MS, homeRows, openTrackOf, startingTracks, stillGoing, watchLive, type LiveStep, type LiveTrack, type LiveWatch, type StopGo } from "./live-steps.ts";
import type { HomeWallet } from "@zerofee/shell-api/money.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS, sealJobs } from "@zerofee/shell-api/job-start.ts";
import { ActAdd, ActMove, ActSend, ActSwap } from "../icons.tsx";
import { watchAddsOnWay, type AddOnWay } from "./adds-on-way.ts";
import { swapLabel } from "./swap-follow.ts";
import { swapLands } from "@zerofee/shell-api/job-carry.ts";
import { ownSlot } from "../overlay-slot.ts";
import "./live.css";

export { FOLD_AFTER_MS, FOLD_MS, endLine, publishTracks, rowTitle, taskOf, watchLive } from "./live-steps.ts";
export type { LiveTrack } from "./live-steps.ts";

/** Activity's feed: it reads the Adds on their way itself (Home already holds them). */
function followLive(bridge: Bridge, movements: () => Movement[], on: (t: LiveTrack[], covered: ReadonlySet<string>, tell?: LiveTrack[], gone?: string[], merged?: string[]) => void): LiveWatch {
  let adds: AddOnWay[] = [];
  const stopAdds = watchAddsOnWay(bridge, (l) => { adds = l; });
  const stop = watchLive(bridge, () => ({ adds, movements: movements() }), on, swapLabel, swapLands);
  return Object.assign(() => { stopAdds(); stop(); }, { poke: stop.poke });
}

/**
 * The live cards of a screen (Home's tab, or Activity: only "all") and their tracker, all of it loaded after the first
 * paint. It follows the work in flight itself; `onCovered` hands back the rows a card stands for (drawn once). The
 * tracker is drawn over the whole app through `overlay` (Wallet's own sheets' place), else in place.
 */
export function LiveHome({ bridge, feed, only = "all", overlay, onCovered, buzz, swaps = "all", openId }: { /** J1 (copy review, 7 Nov): the Activity centre's task to open: its page at once, once its track is read (activity-rows openTrackOf) */ openId?: string; /** Swap in place's rows: Home draws them all; Activity lists an ended one itself, and the centre's Now holds a going one. */ swaps?: "all" | "going" | "none"; bridge: Bridge; feed: { current: { adds?: AddOnWay[]; movements: Movement[] } }; only?: string; overlay?: ((node: ReactNode) => void) | undefined; onCovered?: (ids: ReadonlySet<string>) => void; buzz?: () => void }) {
  const [tracks, setTracks] = useState<LiveTrack[]>([]);
  // jobs just made (job-start.ts): their rows at once, before the core's own row for them comes
  const [allStarting, setStarting] = useState<LiveTrack[]>(() => startingTracks(taskStore().list()));
  const swapRows = useMemo(() => allStarting.filter((s) => isHomeSwapRow(s.id) && (swaps === "all" || (swaps === "going" && !s.end))), [allStarting, swaps]);
  const starting = useMemo(() => allStarting.filter((s) => !isHomeSwapRow(s.id) || swapRows.includes(s)), [allStarting, swapRows]);
  useEffect(() => { const s = taskStore(); const read = () => setStarting(startingTracks(s.list())); read(); return s.subscribe(read); }, []);
  // the job rows live in Home's sealed store, never plain localStorage (job-start.ts sealJobs; QA, 5 Nov)
  useEffect(() => void sealJobs(bridge), [bridge]);
  // and Add's address keys (row 16): read at boot, so Add opens on the same address at once (add-keep.ts)
  useEffect(() => void import("./add-keep.ts").then((m) => m.sealAddCards(bridge), () => undefined), [bridge]);
  const [opened, setOpened] = useState<LiveTrack | null>(null);
  const { tasks } = useShell();
  const watch = useRef<LiveWatch | null>(null);
  useEffect(() => {
    const sent = new Map<string, string>();
    const on = (list: LiveTrack[], covered: ReadonlySet<string>, tell?: LiveTrack[], gone?: string[], merged?: string[]) => { setTracks(list); onCovered?.(covered); dropMerged(tasks, merged, sent); publishTracks(tasks, tell ?? list, sent); endGone(tasks, gone, sent); };
    // Home holds its Adds; a screen that doesn't (Activity) reads them itself
    const w = feed.current.adds ? watchLive(bridge, () => ({ adds: feed.current.adds ?? [], movements: feed.current.movements }), on, swapLabel, swapLands) : followLive(bridge, () => feed.current.movements, on);
    watch.current = w;
    return () => { watch.current = null; w(); };
  }, [bridge]);
  // the screen's own movements or Adds changed (its read after an engine event): the cards at once (speed, D145), never at
  // the watch's next 4 s read. An empty list is one key, so a fresh [] each render never pokes again.
  const { adds: feedAdds, movements: feedMoves } = feed.current;
  useEffect(() => { watch.current?.poke(); }, [feedAdds?.length ? feedAdds : 0, feedMoves.length ? feedMoves : 0]);
  // the open tracker follows its own job by id, and keeps the newest of it seen (QA's crawl, 5 Nov: a swap's
  // tracker said "Done in 44 s", then went back to "Leaving your Safe · 3→5 min": once the row left the list, it fell back
  // to the copy taken at the tap); an ended job never goes back to a step before its end
  // the core's own track first, as Home's rows (homeRows): a Swap's starting row with the same id carries no money or
  // figure, so its done page lost "You got about 0.12 SOL." (the copy review's J2-4, 8 Nov)
  useEffect(() => { if (opened) setOpened((o) => (o ? keptTrack(o, [...tracks, ...starting].find((t) => t.id === o.id)) : o)); }, [tracks, starting]);
  // J1: the centre's Now row opens this job's page directly, once (closed, it stays closed)
  const openedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!openId || openedFor.current === openId) return;
    const t = openTrackOf(openId, [...tracks, ...starting]);
    if (t) { openedFor.current = openId; setOpened(t); }
  }, [openId, tracks, starting]);
  // a stopped job's next tap (rule 8): Move again (it pays from Private first), Private's own screen, or Send
  const shell = useShell();
  const onNext = (go: StopGo) => {
    setOpened(null);
    if (go.kind === "close") return;
    if (go.kind === "activity") shell.openApp("wallet", "activity");
    else if (go.kind === "private") shell.openApp("wallet", "private");
    else if (go.kind === "swap") shell.openMoney({ kind: "swap", wallet: "near" });
    else if (go.kind === "move") shell.openMoney({ kind: "move", from: (go.from ?? "safe") as HomeWallet, to: go.to as HomeWallet, ...(go.usd ? { usd: go.usd } : {}) });
    else shell.openMoney({ kind: "send", ...(go.wallet ? { wallet: go.wallet } : {}) });
  };
  // on Activity's own list (it holds no Adds), the page's back chevron goes back to that list (copy review, 6 Nov)
  const tracker = opened ? <LiveTracker key={opened.id} track={opened} onClose={() => setOpened(null)} onNext={onNext} {...(feed.current.adds ? {} : { onBack: () => setOpened(null) })} /> : null;
  // S10b: the overlay is shared with Activity's row page; draw or clear only this tracker, never a page it didn't draw
  const slot = useMemo(() => (overlay ? ownSlot(overlay) : null), [overlay]);
  useEffect(() => { slot?.draw(tracker); }, [opened, tracks]);
  useEffect(() => () => slot?.release(), [slot]);
  // a finished one settles, holds FOLD_AFTER_MS, then leaves (HOME-VISUAL §3.7); a stopped one stays until it is tapped
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const done = tracks.filter((t) => t.end?.ok && !folded.has(t.id));
    if (!done.length) return;
    const t = setTimeout(() => setFolded((f) => new Set([...f, ...done.map((x) => x.id)])), FOLD_AFTER_MS + FOLD_MS);
    (t as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(t);
  }, [tracks]);
  // a job just made shows at once on whichever tab is up (Sim re-check: the Safe tab never drew one, so a Private ->
  // NEAR wallet Move had no Home line); its own row, once the core makes it, takes its place by id. A done one is never
  // drawn again from here: its own row said Done and folded (a Safe Move's row keeps its id in the store for the hour)
  // a swap in place's row has no core row after it: done, it holds and folds here (startingTracks' window)
  useEffect(() => {
    if (!swapRows.some((s) => s.end?.ok)) return;
    const t = setTimeout(() => setStarting(startingTracks(taskStore().list())), FOLD_AFTER_MS + FOLD_MS);
    (t as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(t);
  }, [allStarting]);
  const list = [...homeRows(starting, tracks), ...tracks.filter((t) => (only === "all" || (only === "hot" ? t.wallets.some((w) => w !== "safe") : t.wallets.includes(only))) && !folded.has(t.id)), ...swapRows.filter((s) => s.end?.ok)];
  return (
    <>
      {list.length > 0 && (
        <section className="wl-now" aria-label="Jobs">
          <div className="wl-sec wl-sec--still"><span className="wl-sec__name">Jobs</span></div>
          <LiveRows tracks={list} onOpen={(t) => { buzz?.(); setOpened(t); }} />
        </section>
      )}
      {!overlay && tracker}
    </>
  );
}

/** An Add still on its way after SLOW_MS: it isn't ended (it lands whenever 1Click delivers), but the row says so. */
const slowAdd = (t: LiveTrack, now: number) => !t.end && t.kind === "add" && Number.isFinite(t.startMs) && now - t.startMs >= SLOW_MS;

/** The row's line: the step now and the time LEFT, from the protocol's own estimate ("Through NEAR · 3 min left"; the
 *  HARD RULE, 5 Nov), or that there is none; "Done in 2 min"; where it stopped; an Add slower than usual says so. */
export function rowLine(t: LiveTrack, now: number): string {
  if (t.end?.ok) {
    // audit 10's A8: from the Approve when the job had one (doneFrom), never the tap before its Check sheet
    const from = t.doneFrom !== undefined && t.doneFrom > t.startMs ? t.doneFrom : t.startMs;
    const took = rowTook((t.endMs !== undefined && Number.isFinite(t.endMs) ? t.endMs : now) - from);
    return took === null ? "Done" : `Done in ${took}`;
  }
  if (t.end) return t.end.row ?? endLine(t) ?? t.end.line;
  if (slowAdd(t, now)) return `Slower than usual · ${shortElapsed(now - t.startMs)}`;
  const step = t.steps.find((s) => s.state === "doing") ?? t.steps.find((s) => s.state === "waiting");
  return `${step ? cardStep(step.label, t.title) : "On its way"} · ${timeLeft(t.endsAt, now, t.startMs)}`;
}

/** The row's line in its two columns (a16, Sim re-walk 1b: "NEAR Confidential is paying your SOL wallet. · 30 s left"
 *  wrapped to two lines): a going row's words on the left and its time left on the right, as the Hot moving row; a done
 *  or stopped row's line is one piece. The screen reader's label stays rowLine's one sentence. */
export function rowParts(t: LiveTrack, now: number): { words: string; time?: string } {
  const line = rowLine(t, now);
  if (t.end) return { words: line };
  const at = line.lastIndexOf(" · ");
  return at < 0 ? { words: line } : { words: line.slice(0, at), time: line.slice(at + 3) };
}

/** A job this young, when its row first shows, is scrolled into view (clear of the bar): the person just started it. */
export const SHOW_NEW_MS = 5_000;

/** S21: the job page's status for a move NEAR Intents says is done that the Safe hasn't shown yet (its line is under it). */
export const UNSHOWN_STATUS = "On its way";

/** The row's face: going, slow, done, stopped, or came back (a refund). */
export function rowState(t: LiveTrack, now: number): LiveRowState {
  if (t.end?.ok) return "done";
  if (t.end?.slow || slowAdd(t, now)) return "slow";
  if (t.end) return endFace(t.end);
  return "going";
}

const KIND_MARK: Record<LiveTrack["kind"], () => ReactNode> = { add: ActAdd, send: ActSend, swap: ActSwap, move: ActMove };
/** A step line drawn piece by piece (linePhrases): each piece nowrap, a plain space between, so a wrap never leaves one
 *  lone word on line 2 (as Add's rows, AddSheet Phrases). */
export const StepLine = ({ line }: { line: string }) => <>{linePhrases(line).map((p, i) => <Fragment key={i}>{i > 0 && " "}<span className="lv-keep">{p}</span></Fragment>)}</>;

/** Home's live rows: one shared row each (LiveRow): the kind's mark, what it is doing and for how long, its progress
 *  line; a tap, the tracker. */
export function LiveRows({ tracks, onOpen }: { tracks: readonly LiveTrack[]; onOpen: (t: LiveTrack) => void }) {
  const now = useNow(tracks.filter(stillGoing).map((t) => t.startMs));
  // a16: a job started a moment ago (a Move's Done just tapped) shows its row clear of the All-apps handle: scrolled into
  // view once, only if it is not already (block "nearest"; the row's scroll-margin keeps it above the bar, liverow.css)
  const rows = useRef(new Map<string, HTMLButtonElement | null>());
  const shown = useRef(new Set<string>());
  useLayoutEffect(() => {
    for (const t of tracks) {
      if (shown.current.has(t.id)) continue;
      shown.current.add(t.id);
      if (!stillGoing(t) || !(Date.now() - t.startMs < SHOW_NEW_MS)) continue;
      rows.current.get(t.id)?.scrollIntoView?.({ block: "nearest", behavior: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [tracks.map((t) => t.id).join("|")]);
  return (
    <ul className="zf-lrows" role="list">
      {tracks.map((t) => {
        const Mark = KIND_MARK[t.kind];
        const title = rowTitle(t), line = rowLine(t, now), parts = rowParts(t, now);
        return (
          <li key={t.id}>
            <LiveRow mark={<Mark />} title={title} line={parts.words ? <StepLine line={parts.words} /> : parts.words} {...timeSlot(parts.time)} state={rowState(t, now)} p={t.end && !t.end.ok && !stillGoing(t) ? undefined : progressOf(t.steps, !!t.end?.ok)}
              {...(!t.end?.ok && stillGoing(t) ? { track: { kind: t.kind, at: checkpointAt(t.steps) } } : {})}
              onOpen={() => onOpen(t)} label={`${title}. ${line}. Open its steps`} rowRef={(el) => { rows.current.set(t.id, el); }} />
          </li>
        );
      })}
    </ul>
  );
}

/** The time now, moving while anything shown is going: every second while the youngest is under a minute, then every
 *  15 s (its words only change that often). */
function useNow(going: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now());
  const youngest = going.length ? Math.min(...going.map((s) => now - s)) : Infinity;
  useEffect(() => {
    if (!going.length) return;
    const t = setTimeout(() => setNow(Date.now()), tickEvery(youngest));
    (t as unknown as { unref?: () => void }).unref?.(); // a clock never keeps a process alive (tests, server render)
    return () => clearTimeout(t);
  }, [going.length > 0, now]);
  return going.length ? Math.max(now, Date.now()) : now;
}

/** The job's page (the copy review's spec Part 2, 6 Nov; job-face.ts): the title once (the bar), the figure and what it is, the four
 *  checkpoints (the --bad dot where it stopped), where the money is, the time left or one plain reason line, From and To,
 *  each step once with its one word, and the floor: the real choices only. The bar's X is the way out on every face. */
export function LiveTracker({ track: t, onClose, onNext, onBack, when, proof }: { track: LiveTrack; onClose: () => void; /** an ended job's day and time ("7 Nov"; J2) */ when?: string; /** its transactions (Activity's row: ActivityDetail JobProof) */ proof?: ReactNode; /** a stopped job's tap (rule 8) */ onNext?: (go: StopGo) => void; /** opened from Activity's list: the bar's back chevron goes back to it (copy review) */ onBack?: () => void }) {
  const now = useNow(stillGoing(t) ? [t.startMs] : []);
  const f = jobFace(t);
  const left = f.state === "going" ? rowParts(t, now).time : undefined;
  const tap = (go: StopGo) => (go.kind === "close" ? onClose() : onNext ? onNext(go) : onClose());
  const ends = jobEnds(t);
  return (
    <Sheet title={f.bar} onClose={onClose} {...(onBack ? { onBack } : {})}>
      <div className="lv-tracker lv-job" data-face={f.state}>
        <div className="lv-job__head">
          {f.figure && <p className="lv-job__figure" data-testid="job-figure">{f.figure}</p>}
          <p className="lv-job__what" data-testid="tracker-title">{t.made && !t.end ? `${JOB_WORDS.created} ${f.what}` : f.what}</p>
        </div>
        <Checkpoints kind={t.kind === "move" ? "move" : t.kind} at={f.at} bad={f.bad} className="lv-job__track" />
        {f.money && <p className="lv-job__money" data-testid="job-money"><span>{f.money.lead}</span>{f.money.place}{f.money.after && <span>{f.money.after}</span>}</p>}
        {left && <p className="lv-job__left" role="status">{left}</p>}
        {f.took && <p className="lv-job__left" data-testid="job-took">{f.took}</p>}
        {when && !left && <p className="lv-job__left" data-testid="job-when">{when}</p>}
        {f.reason && <p className="lv-job__reason" role="status" data-testid="job-reason">{f.reason}</p>}
        {ends && <div className="lv-job__card"><div><span>{FACE_CARD.from}</span><b>{ends.from}</b></div><div><span>{FACE_CARD.to}</span><b>{ends.to}</b></div></div>}
        {f.steps.length > 0 && <ol className="lv-steps lv-job__steps">
          {f.steps.map((s, i) => (
            <li key={i} className={`lv-step is-${t.steps[i]?.state ?? "waiting"}`} data-testid="job-step">
              <span className="lv-step__label"><StepLine line={s.label} />{t.steps[i]?.note && <small className="lv-step__note" data-testid="job-step-note">{t.steps[i]!.note}</small>}</span>
              <span className="lv-step__time">{s.word ?? ""}</span>
            </li>
          ))}
        </ol>}
        {proof}
        {f.state === "going" && <p className="zf-small lv-tracker__note">Each step shows the moment it's done. You can close this. It keeps going.</p>}
        {/* the floor: the real choices only (copy review, 6 Nov: lit Resume, quiet the way back; never three). The way out is the bar's X */}
        {f.choices.length > 0 && <div className="lv-job__floor">
          {f.choices.map((n, i) => <button key={n.label} type="button" className={`zf-btn${i ? " zf-btn--quiet" : ""}`} data-testid="tracker-next" onClick={() => tap(n.go)}>{n.label}</button>)}
        </div>}
      </div>
    </Sheet>
  );
}

