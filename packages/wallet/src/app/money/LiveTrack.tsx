// D137: the live step monitor's faces. On Home, one row per Add, Send, Swap or Move in flight under "Jobs" (was "Now", 5 Nov), at the top of
// the wallets it touches (the shared LiveRow, ACTIVITY-MOTION 4 Nov: its hairline is its progress line); a tap opens the
// tracker, the whole screen (D135's Sheet), each step with when it was reached. Times come from live-steps.ts (the
// engine's own states, or the moment this phone saw a step done), always in words ("2 min"), never a clock. Loaded
// after Home's first paint.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { timeLeft } from "@zerofee/shell-api/job-steps.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ReceiptMark } from "@zerofee/design/Receipt.tsx";
import "@zerofee/design/receipt.css";
import { LiveRow, progressOf, type LiveRowState } from "@zerofee/design/LiveRow.tsx";
import { shortElapsed, tickEvery } from "@zerofee/design/time.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import type { Movement } from "../../types.ts";
import { endGone, endLine, rowTitle, publishTracks, keptTrack, SLOW_MS, startingTracks, stillGoing, watchLive, type LiveStep, type LiveTrack, type LiveWatch, type StopGo } from "./live-steps.ts";
import type { HomeWallet } from "@zerofee/shell-api/money.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { sealJobs } from "@zerofee/shell-api/job-start.ts";
import { ActAdd, ActMove, ActSend, ActSwap } from "../icons.tsx";
import { watchAddsOnWay, type AddOnWay } from "./adds-on-way.ts";
import { swapLabel } from "./swap-follow.ts";
import { swapLands } from "@zerofee/shell-api/job-carry.ts";
import { ownSlot } from "../overlay-slot.ts";
import "./live.css";

export { endLine, publishTracks, rowTitle, taskOf, watchLive } from "./live-steps.ts";
export type { LiveTrack } from "./live-steps.ts";

/** Activity's feed: it reads the Adds on their way itself (Home already holds them). */
function followLive(bridge: Bridge, movements: () => Movement[], on: (t: LiveTrack[], covered: ReadonlySet<string>, tell?: LiveTrack[], gone?: string[]) => void): LiveWatch {
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
export function LiveHome({ bridge, feed, only = "all", overlay, onCovered, buzz }: { bridge: Bridge; feed: { current: { adds?: AddOnWay[]; movements: Movement[] } }; only?: string; overlay?: ((node: ReactNode) => void) | undefined; onCovered?: (ids: ReadonlySet<string>) => void; buzz?: () => void }) {
  const [tracks, setTracks] = useState<LiveTrack[]>([]);
  // jobs just made (job-start.ts): their rows at once, before the core's own row for them comes
  const [starting, setStarting] = useState<LiveTrack[]>(() => startingTracks(taskStore().list()));
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
    const on = (list: LiveTrack[], covered: ReadonlySet<string>, tell?: LiveTrack[], gone?: string[]) => { setTracks(list); onCovered?.(covered); publishTracks(tasks, tell ?? list, sent); endGone(tasks, gone, sent); };
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
  useEffect(() => { if (opened) setOpened((o) => (o ? keptTrack(o, [...starting, ...tracks].find((t) => t.id === o.id)) : o)); }, [tracks, starting]);
  // a stopped job's next tap (rule 8): Move again (it pays from Private first), Private's own screen, or Send
  const shell = useShell();
  const onNext = (go: StopGo) => {
    setOpened(null);
    if (go.kind === "private") shell.openApp("wallet", "private");
    else if (go.kind === "move") shell.openMoney({ kind: "move", from: "safe", to: go.to as HomeWallet, ...(go.usd ? { usd: go.usd } : {}) });
    else shell.openMoney({ kind: "send", ...(go.wallet ? { wallet: go.wallet } : {}) });
  };
  const tracker = opened ? <LiveTracker key={opened.id} track={opened} onClose={() => setOpened(null)} onNext={onNext} /> : null;
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
  const list = [...starting.filter((s) => !s.end?.ok && !tracks.some((t) => t.id === s.id)), ...tracks.filter((t) => (only === "all" || (only === "hot" ? t.wallets.some((w) => w !== "safe") : t.wallets.includes(only))) && !folded.has(t.id))];
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

/** A finished row holds this long (motion --m-hold-ms), then leaves in FOLD_MS (opacity and a 4 px rise, live.css). */
export const FOLD_AFTER_MS = 2500;
export const FOLD_MS = 200;

/** An Add still on its way after SLOW_MS: it isn't ended (it lands whenever 1Click delivers), but the row says so. */
const slowAdd = (t: LiveTrack, now: number) => !t.end && t.kind === "add" && Number.isFinite(t.startMs) && now - t.startMs >= SLOW_MS;

/** The row's line: the step now and the time LEFT, from the protocol's own estimate ("Through NEAR · 3 min left"; the
 *  HARD RULE, 5 Nov), or that there is none; "Done in 2 min"; where it stopped; an Add slower than usual says so. */
export function rowLine(t: LiveTrack, now: number): string {
  if (t.end?.ok) {
    const took = shortElapsed((t.endMs !== undefined && Number.isFinite(t.endMs) ? t.endMs : now) - t.startMs);
    return took === "now" ? "Done" : `Done in ${took}`;
  }
  if (t.end) return endLine(t) ?? t.end.line;
  if (slowAdd(t, now)) return `Slower than usual · ${shortElapsed(now - t.startMs)}`;
  const step = t.steps.find((s) => s.state === "doing") ?? t.steps.find((s) => s.state === "waiting");
  return `${step?.label ?? "On its way"} · ${timeLeft(t.endsAt, now, t.startMs)}`;
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
  if (t.end) return /came back/i.test(t.end.line) ? "back" : "stopped";
  return "going";
}

const KIND_MARK: Record<LiveTrack["kind"], () => ReactNode> = { add: ActAdd, send: ActSend, swap: ActSwap, move: ActMove };

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
            <LiveRow mark={<Mark />} title={title} line={parts.words} {...(parts.time ? { when: parts.time } : {})} state={rowState(t, now)} p={t.end && !t.end.ok && !stillGoing(t) ? undefined : progressOf(t.steps, !!t.end?.ok)}
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

/** A step's mark: a drawn check once done, the live dot while it's being done, a cross where it stopped. */
function Mark({ s }: { s: LiveStep }) {
  if (s.state === "done") return <svg className="lv-mark is-done" viewBox="0 0 16 16" aria-hidden="true"><path className="zf-draw" pathLength={1} d="M3.5 8.5l3 3 6-7" /></svg>;
  if (s.state === "doing") return <span className="lv-mark is-doing" aria-hidden="true"><span className="zf-live" /></span>;
  if (s.state === "failed") return <svg className="lv-mark is-failed" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  return <span className="lv-mark is-waiting" aria-hidden="true" />;
}

/** The tracker: the whole screen, each step on its own line with when it was reached; where it stopped, and where the
 *  money is. Its one status line is the row's ("Through NEAR privately · 2 min"), never a clock. */
export function LiveTracker({ track: t, onClose, onNext }: { track: LiveTrack; onClose: () => void; /** a stopped job's tap (rule 8) */ onNext?: (go: StopGo) => void }) {
  const now = useNow(stillGoing(t) ? [t.startMs] : []);
  // the head's spaced capitals fit a short title, "MOVE $5.00" (its last step names where it goes)
  return (
    <Sheet title={rowTitle(t).replace(/ to your .+$/, "")} onClose={onClose}>
      <div className="lv-tracker">
        <div className="lv-tracker__head">
          <ReceiptMark state={!t.end ? "away" : t.end.ok ? "landed" : stillGoing(t) ? "away" : "refused"} size={72} icon={<span className="zf-receipt__disc">{KIND_MARK[t.kind]()}</span>} />
          <p className="lv-tracker__title">{rowTitle(t)}</p>
        </div>
        <p className="lv-tracker__status" role="status">{!t.end ? rowLine(t, now) : t.end.ok ? rowLine(t, now) : t.end.unshown ? UNSHOWN_STATUS : stillGoing(t) ? `Slower than usual · ${shortElapsed(now - t.startMs)}` : "Stopped"}</p>
        <ol className="lv-steps">
          {t.steps.map((s, i) => (
            <li key={i} className={`lv-step is-${s.state}`}>
              <Mark s={s} />
              <span className="lv-step__label">{s.state === "doing" ? `${s.label.replace(/\.$/, "")}…` : s.label}</span>
              <span className="lv-step__time">{i > 0 && s.state === "done" && s.atMs !== undefined ? shortElapsed(s.atMs) : ""}</span>
            </li>
          ))}
        </ol>
        {t.end && <p className={`lv-tracker__end${t.end.ok || stillGoing(t) ? "" : " is-bad"}`}>{endLine(t)}</p>}
        {/* rule 8: what to tap next, the first lit (look: the design review) */}
        {t.end && !t.end.ok && onNext && t.next?.map((n, i) => <button key={n.label} type="button" className={`zf-btn${i ? " zf-btn--quiet" : ""} lv-tracker__next`} data-testid="tracker-next" onClick={() => onNext(n.go)}>{n.label}</button>)}
        {!t.end && t.eta && <p className="zf-small lv-tracker__note">{t.eta}</p>}
        {!t.end && <p className="zf-small lv-tracker__note">Each step shows the moment it's done. You can close this. It keeps going.</p>}
      </div>
    </Sheet>
  );
}
