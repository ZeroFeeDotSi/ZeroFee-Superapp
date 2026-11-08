// Private (D27): a small separate wallet for private payments, Security's pocket with an ordinary key, capped at $100.
// Its own screen says what it is in Security's words, verbatim; Add to Private is the one pill. Moving money in shows on
// chain, which the screen and the approval sheet both say; what's done with it after doesn't.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { claim, runJob } from "@zerofee/shell-api/job-run.ts";
import { refusalWords } from "@zerofee/shell-api/refusal-face.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS, jobKeyPart, newJobKey } from "@zerofee/shell-api/job-start.ts";
import { LEG_SEC, receiptLeft } from "@zerofee/shell-api/job-steps.ts";
import { carried, carryTo } from "@zerofee/shell-api/job-carry.ts";
import { resumeAway } from "./private-resume.ts";
import { mark } from "@zerofee/design/tap.ts";
import { JobReceipt, THROUGH_CONFIDENTIAL } from "../money/JobMade.tsx";
import "../money/move-swap.css";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import type { Balance, Movement, Quote } from "../../types.ts";
import { More } from "@zerofee/design/More.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { PRIVATE_HOW, PRIVATE_MORE, PRIVATE_SEEN, PRIVATE_THROUGH, PRIVATE_WORDS, amountOf, coins, dollars, placeOf, oldWalletsLine, privateAllUsd, privateUsd } from "../format.ts";
import { Down, PrivateMark } from "../icons.tsx";
import { headlineUsd } from "./private-headline.ts";
import { homeRows } from "./private-home-rows.ts";
import { useWallet } from "../runtime.tsx";
import { canGoLabel, otherPartLine } from "./private-from.ts";

/** Under "Job created." on Private's way home (copywriter, 5 Nov). */
export const PRIVATE_JOB_WATCH = "Watch it in Activity.";

/** Check this before Private's way home (the audit's MUST 1, 8 Nov): what reaches the Safe is public, so a mis-tap can't be undone.
 *  A hot key going only to the person's own Safe: no Face ID (D143), Approve alone. */
export const MOVE_ALL_WORDS = {
  open: "Move it all to your Safe",
  bar: "Check this",
  /** P5 (the audit's way-home audit): the figure once, on the rows (was "Move $33.86 from Private to your Safe") */
  head: "Move money from Private to your Safe",
  from: "From Private",
  gets: "Your Safe gets",
  fee: "Fees",
  /** the copy review's rule (8 Nov): never "Stays in Private" on a Check this; the leftover, only above $0 */
  keeps: "Private keeps the rest",
  seen: "Anyone can see what reaches your Safe.",
  approve: "Approve",
  notNow: "Not now",
} as const;

/** Private's own Move (the copy review's A2-2, 8 Nov): one slider, Private to the Safe, never the all-wallets sheet. */
export const PRIVATE_MOVE_WORDS = {
  /** the copy review's trim (8 Nov): the one-slider sheet is a Check this too */
  bar: "Check this",
  head: "Move money from Private to your Safe",
  slider: "How much to move",
  /** QA QA's SHOULD (the copy review's words): while the job goes, the page says where the money is, never "$0.00 / Nothing here yet." */
  onWay: (usd: string) => `${usd} on its way to your Safe`,
  /** the copy review's trim (8 Nov): once the job landed, in the on-its-way slot under the figure, for LANDED_SHOWN_MS, then gone */
  landed: "Landed in your Safe.",
} as const;

/** The way home's time (job-steps LEG_SEC.privateNear: Private to the Safe is one NEAR Confidential transfer): its row and
 *  its page count down from the tap (product decision, 5 Nov and the time left). */
export const HOME_ETA_SEC = LEG_SEC.privateNear;
/** How long "Landed in your Safe." stays under the figure (copy review, 8 Nov). */
export const LANDED_SHOWN_MS = 60_000;
/** The page's "Job created." words while the job goes (pure: `now` given), two short lines (the audit's Move S4, 8 Nov: four
 *  ideas on one line): the job and its time left; then the protocol and where to watch it. */
export const madeLine = (madeAt: number, now: number): string =>
  `${JOB_WORDS.created} ${receiptLeft(madeAt + HOME_ETA_SEC * 1000, now, madeAt)}\n${THROUGH_CONFIDENTIAL} ${PRIVATE_JOB_WATCH}`;
/** Each "\n" a line of its own. */
const linesOf = (t: string) => t.split("\n").flatMap((l, i) => (i ? [<br key={i} />, l] : [l]));
/** Whether "Landed in your Safe." still shows (pure). */
export const landedShown = (landedAt: number | null, now: number): boolean => landedAt !== null && now - landedAt < LANDED_SHOWN_MS;
/** The page's clock (tests: their own; never the wall's in a test). */
export type PageClock = { now: () => number; set: (run: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const WALL: PageClock = { now: () => Date.now(), set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** What the person's sheet showed, per coin (the ledger's `upTo`: each coin at most this; the audit's SHOULD, 8 Nov). */
export type HomeCaps = Record<string, string>;

/**
 * The coins a figure takes from Private, as the sheet shows it (pure): the whole figure, every coin whole (the rows'
 * own amounts, coins with no price too); less, the dearest coins first, whole while they fit, then a part of the next
 * (rounded down: the most it may move). `usd` is what the plan moves, the sheet's "Your Safe gets".
 */
export function homePlan(rows: readonly Balance[], usd: number): { caps: HomeCaps; usd: number } {
  const held = rows.filter((r) => Number(r.amount) > 0);
  const total = Number(privateUsd([...held]));
  if (usd >= total - 0.005) return { caps: Object.fromEntries(held.map((r) => [r.tokenId, r.amount])), usd: total };
  const caps: HomeCaps = {};
  let left = Math.round(usd * 100) / 100, took = 0;
  for (const r of [...held].filter((x) => Number(x.usd) > 0).sort((a, b) => Number(b.usd) - Number(a.usd))) {
    if (left < 0.01) break;
    const has = Number(r.usd);
    if (left >= has - 0.005) { caps[r.tokenId] = r.amount; left = Math.round((left - has) * 100) / 100; took += has; continue; }
    const part = Math.floor((Number(r.amount) * left) / has * 1e6) / 1e6;
    if (part > 0) { caps[r.tokenId] = part.toFixed(6).replace(/\.?0+$/, ""); took += left; }
    left = 0;
  }
  return { caps, usd: Math.round(took * 100) / 100 };
}

/** The way home's steps: the trigger, its Check this, the call before its job, the job made. */
export type HomeStep = "no" | "check" | "asking" | "sent";

/** The way home's taps (the audit's MUST 1): the trigger opens Check this and calls nothing; Not now and Close close it and call
 *  nothing; Approve alone runs it, once (`step` is read as set, never a render behind: a double tap runs one job). */
export function homeTaps(o: { step: () => HomeStep; set: (s: HomeStep) => void; run: () => Promise<void> }) {
  return {
    open: () => { if (o.step() === "no") o.set("check"); },
    close: () => { if (o.step() === "check") o.set("no"); },
    approve: () => { if (o.step() === "check") void o.run(); },
  };
}

// The way out, always offered while anything is in the pocket (even while Private is closed to new money).
// the job (bug report, 5 Nov): the private balance is a hot key, so the job is made on Approve ("Job created.", its row
// on Home and in Activity, the bell's pulse); a refusal after is said on its row, one before it (taken) here
// `caps`/`usd`: what the sheet showed (homePlan), read when it opened: the core moves at most that (the audit's SHOULD, 8 Nov: a
// refund or a fill reaching Private between the sheet and Approve stays private); `onMade`: the job and its figure, for
// the page's "on its way" line (QA QA's SHOULD): its figure at the tap, the moves the core made once it answered (none:
// a refusal, which its job's row says)
export async function homeFromPrivate({ tasks, caps, usd, bridge, set, onProblem, refresh, onMade }: { tasks: Tasks | undefined; caps: HomeCaps; usd: string; bridge: Pick<Bridge, "call">; set: (s: HomeStep) => void; onProblem: (p: Problem) => void; refresh: () => void; onMade?: (o: { usd: string; ids: string[] | null } | null) => void }): Promise<void> {
  mark("tap");
  set("asking");
  const end = await runJob<Movement[]>({
    tasks, title: "Move money from Private to your Safe", usd, safe: false, money: ["private"],
    etaSec: HOME_ETA_SEC,
    call: () => bridge.call<Movement[]>("ledger.fromPrivate", { upTo: caps }),
    declined: (r) => "problem" in r && /declined$/.test(r.problem.code),
    // the row's stop words (the audit's M9): the core's refusal by its own reason, never "This wallet can't approve this"
    words: refusalWords,
    made: () => { mark("away"); onMade?.({ usd, ids: null }); set("sent"); },
  });
  if ("declined" in end) { onMade?.(null); return set("no"); }
  if ("refused" in end) { onMade?.(null); set("no"); return onProblem(end.refused); }
  // the audit's way-home audit P1 (7 Nov): refused after the job was made (every core refusal: the job is made at the tap), the
  // page said "Job created." and ticked on with no end while Jobs said failed. Now the page says the refusal too, its
  // trigger back, "Job created." gone (onMade(null) clears it); the job's row keeps its own stop words
  if ("problem" in end) { onMade?.(null); set("no"); mark("refused"); return onProblem(end.problem); }
  onMade?.({ usd, ids: end.ok.map((m) => m.id) });
  // the audit's MUST (8 Nov): no live track was ever made for a "send:" id out of Private (live-steps sendTrack leaves them out),
  // so its row went after HANDOFF_MS and Jobs had none. Now every coin's movement is a part of this ONE job (its carry),
  // and the job's own row goes on in place: live-steps homeTracks follows the parts under this id, going -> done
  const ids = end.ok.map((m) => `send:${m.id}`);
  // and the job's own carry keeps its parts by id the moment the core answered (the audit's ruling, 8 Nov): a reload resumes it
  if (ids.length) { carryTo(ids, { job: end.job.id }); carryTo([end.job.id], { parts: end.ok.map((m) => m.id) }); }
  end.job.made(ids.length ? [end.job.id] : []);
  refresh();
}

/** Check this (D135: the whole screen, Close in its bar, its size fixed): the dollars Private holds now, what the Safe gets,
 *  what Private keeps (only above $0; the way home moves it all), the privacy line right under the rows, then Approve (lit)
 *  and Not now right under it (copy review, 8 Nov: no void). `slide`: Private's own Move, one slider over what Private holds. */
export function MoveAllSheet({ usd, stays, slide, onApprove, onClose }: { usd: string; stays?: string; slide?: { value: number; max: number; onChange: (v: number) => void }; onApprove: () => void; onClose: () => void }) {
  const w = MOVE_ALL_WORDS;
  const p = slide && slide.max > 0 ? Math.max(0, Math.min(100, (slide.value / slide.max) * 100)) : 0;
  const r = homeRows(Number(usd.replace(/[^0-9.]/g, "")));
  return (
    <Sheet title={slide ? PRIVATE_MOVE_WORDS.bar : w.bar} onClose={onClose}>
      <h2 className="zf-title wl-moveall__head" data-testid="private-home-head">{slide ? PRIVATE_MOVE_WORDS.head : w.head}</h2>
      {slide && <input type="range" className="wl-mv-range wl-moveall__range" min={0} max={slide.max} step={0.01} value={slide.value} aria-label={PRIVATE_MOVE_WORDS.slider} aria-valuetext={usd}
        style={{ ["--p" as string]: `${p}%` } as CSSProperties} data-testid="private-move-slider" onChange={(e) => slide.onChange(Number(e.target.value))} />}
      <div className="wl-kv" data-testid="private-home-from"><span>{w.from}</span><span>{r.from}</span></div>
      <div className="wl-kv" data-testid="private-home-gets"><span>{w.gets}</span><span>{r.gets}</span></div>
      <div className="wl-kv" data-testid="private-home-fee"><span>{w.fee}</span><span>{r.fee}</span></div>
      {/* the ledger's own difference, exact: no "about" (core private-route.ts rule) */}
      {stays !== undefined && Number(stays.replace(/[^0-9.]/g, "")) > 0 && <div className="wl-kv" data-testid="private-home-stays"><span>{w.keeps}</span><span>{stays}</span></div>}
      <p className="zf-small wl-moveall__seen" data-testid="private-home-seen">{w.seen}</p>
      {/* Approve and Not now together on the floor (a pinned .wl-sheet-go's ground band would cover a link under it) */}
      <div className="wl-moveall__foot">
        <button className="zf-btn" disabled={Number(usd.replace(/[^0-9.]/g, "")) < 0.01} onClick={onApprove} data-testid="private-home-approve">{w.approve}</button>
        <button className="zf-link" onClick={onClose} data-testid="private-home-notnow">{w.notNow}</button>
      </div>
    </Sheet>
  );
}

/** The way home's row (the audit's MUST 2): "Job created." stays while its job is made, whatever the rows say after (the refresh
 *  reads $0 once it all left); before, the 44 px quiet trigger while anything is in Private. */
/** `line`: the page's own words while its job goes (madeLine, with the time left); null once it landed (its slot under
 *  the figure says so). */
export function HomeRow({ step, has, onOpen, line }: { step: HomeStep; has: boolean; onOpen: () => void; line?: string | null }) {
  // its own block, 16 px above and below (copy review, 8 Nov), never run together with another line
  if (step === "sent") return line === null ? null : <p className="zf-small wl-explain wl-private-made" role="status" data-testid="private-home-made">{linesOf(line ?? `${JOB_WORDS.created}\n${THROUGH_CONFIDENTIAL} ${PRIVATE_JOB_WATCH}`)}</p>;
  if (!has) return null;
  return <button className="zf-btn zf-btn--quiet wl-capsule" disabled={step === "asking"} onClick={onOpen} data-testid="private-home-open">{MOVE_ALL_WORDS.open}</button>;
}

/** Whether a way home's money is still on its way (pure): until the core answered (`ids` null), and then while any of its
 *  moves is not yet read ended in Activity (the Safe has it: done; or it ended otherwise, which its row says). */
export const stillOnWay = (ids: readonly string[] | null, activity: readonly Pick<Movement, "id" | "status">[] | null): boolean =>
  ids === null || ids.some((id) => { const m = activity?.find((x) => x.id === id); return !m || m.status === "moving" || m.status === "waiting"; });

/** The money a way home made a job of, on the page while it goes (QA QA's SHOULD, 8 Nov: "$0.00 / Nothing here yet." read
 *  as money gone): the figure its sheet showed, until Activity reads its moves ended (stillOnWay), then the line goes. */
/** `onEnd(landed)`: landed, every coin read done in the Safe; else it ended otherwise (its Jobs row says how). */
export const allLanded = (ids: readonly string[] | null, activity: readonly Pick<Movement, "id" | "status">[] | null): boolean =>
  ids !== null && ids.every((id) => activity?.find((x) => x.id === id)?.status === "done");
export function OnItsWay({ away, activity, onEnd }: { away: { usd: string; ids: string[] | null }; activity: readonly Pick<Movement, "id" | "status">[] | null; onEnd: (landed: boolean) => void }) {
  const going = stillOnWay(away.ids, activity);
  useEffect(() => { if (!going) onEnd(allLanded(away.ids, activity)); }, [going]);
  return going ? <p className="zf-small wl-explain" role="status" data-testid="private-on-way">{PRIVATE_MOVE_WORDS.onWay(away.usd)}</p> : null;
}

/** A coin's row, dollars first ("USDC · $25.00"), its units on the line under it, mute (the copy review's A2-2). */
export const coinRowLine = (r: Balance): string => (r.usd !== undefined && r.usd !== null ? `${r.symbol} · ${dollars(String(r.usd))}` : r.symbol);

export function PrivateScreen({ onAdd, onSetUp, onDefault, onProblem, clock = WALL }: { onAdd: () => void; onSetUp: () => void; onDefault: (on: boolean) => void; onProblem: (p: Problem) => void; clock?: PageClock }) {
  const { pocket, bridge, refresh, activity } = useWallet();
  const { tasks } = useShell();
  const rows = pocket?.rows ?? [];
  const ready = pocket?.ready ?? false;
  const [moving, setMoving] = useState<HomeStep>("no");
  const step = useRef<HomeStep>("no");
  const set = (s: HomeStep) => { step.current = s; setMoving(s); };
  // the rows as the sheet opened on them (the audit's SHOULD): its figure and the most the core may move, never re-read under it
  const [shown, setShown] = useState<{ rows: Balance[]; slide: boolean } | null>(null);
  const [pick, setPick] = useState(0);
  const [away, setAway] = useState<{ usd: string; ids: string[] | null; at?: number } | null>(null);
  // the job's tap and its landing, on the page's clock: "Job created." counts down; "Landed in your Safe." for 60 s
  const [madeAt, setMadeAt] = useState<number | null>(null);
  const [landedAt, setLandedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // what Private holds now, as read; `at`: that figure at the tap, kept while the job goes (headlineUsd)
  const live = Number(pocket ? privateAllUsd(pocket) : privateUsd(rows));
  const onMade = (o: { usd: string; ids: string[] | null } | null) => { setAway((was) => (o ? { ...o, at: was?.at ?? live } : null)); if (o && o.ids === null) { setMadeAt(clock.now()); setLandedAt(null); } if (!o) setMadeAt(null); };
  // P3 (the audit's way-home audit): a way home a reload left going is this page's again: its figure on its way, "Job created."
  // from its tap, the trigger off, and Private's money claimed as runJob's own was (released at its end, or as the page goes)
  const resumed = useRef<{ release: (() => void) | null } | null>(null);
  const letGo = () => { resumed.current?.release?.(); if (resumed.current) resumed.current.release = null; };
  useEffect(() => {
    const look = () => {
      if (resumed.current || step.current !== "no") return;
      const r = resumeAway(taskStore().list(), (id) => carried(id)?.parts);
      if (!r) return;
      resumed.current = { release: claim(["private"]) };
      setAway({ usd: r.usd, ids: r.ids }); setMadeAt(r.madeAt); setLandedAt(null); set("sent");
    };
    look();
    const off = taskStore().subscribe(look);
    return () => { off(); letGo(); };
  }, []);
  const onEnd = (landed: boolean) => { letGo(); setAway(null); if (landed) setLandedAt(clock.now()); else set("no"); };
  useEffect(() => {
    if (moving !== "sent") return;
    if (landedAt !== null) { const h = clock.set(() => { setLandedAt(null); set("no"); }, Math.max(0, LANDED_SHOWN_MS - (clock.now() - landedAt))); return () => clock.clear(h); }
    let h: unknown;
    const tick = () => { setTick((n) => n + 1); h = clock.set(tick, 1000); };
    h = clock.set(tick, 1000);
    return () => clock.clear(h);
  }, [moving, landedAt]);
  const shownTotal = shown ? Number(privateUsd(shown.rows)) : 0;
  const plan = homePlan(shown?.rows ?? [], shown?.slide ? pick : shownTotal);
  const usd = dollars(plan.usd.toFixed(2));
  // what Private keeps: the rest of what the sheet showed (the way home moves it all: $0, so its row never shows)
  const stays = dollars(Math.max(0, shownTotal - plan.usd).toFixed(2));
  const taps = homeTaps({ step: () => step.current, set, run: () => homeFromPrivate({ tasks, caps: plan.caps, usd, bridge, set, onProblem, refresh, onMade }) });
  const openSheet = (slide: boolean) => { if (step.current !== "no") return; setShown({ rows: [...rows], slide }); setPick(Number(privateUsd(rows))); taps.open(); };
  const has = rows.length > 0;
  return (
    <div className="wl wl-coin zf-enter">
      <div className="wl-total">
        <PrivateMark size={44} />
        <p className="wl-display">{dollars(headlineUsd(live, away).toFixed(2))}</p>
        {/* QA 20 (8 Nov): where the money is, right under the figure ($0.00 once it left), then its landing, for 60 s */}
        {away && <OnItsWay away={away} activity={activity} onEnd={onEnd} />}
        {!away && moving === "sent" && landedShown(landedAt, clock.now()) && <p className="zf-small wl-explain" role="status" data-testid="private-landed">{PRIVATE_MOVE_WORDS.landed}</p>}
        {/* the copy review's A2-2: "Private" once (the title); this the one line under the figure */}
        <p className="zf-small">{PRIVATE_WORDS}</p>
      </div>
      <div className="wl-where">
        {rows.map((r) => (
          <div className="wl-kv" key={r.tokenId} data-testid="private-row">
            <span><CoinIcon symbol={r.symbol} icon={r.icon} size={20} /><span className="wl-private-coin"><span>{coinRowLine(r)}</span><span className="zf-small">{amountOf(r.amount, r.symbol)} {r.symbol}</span></span></span>
          </div>
        ))}
        {rows.length === 0 && !pocket?.oldWords && !away && <p className="zf-small wl-explain">{ready ? "Nothing here yet." : "Not set up yet."}</p>}
        {/* Security audit 4 Nov, finding 2: money under replaced words, moving here; never hidden, with Try again. */}
        {pocket?.oldWords && (
          <>
            <div className="zf-label">In your old wallets</div>
            {pocket.oldWords.rows.map((r) => (
              <div className="wl-kv" key={`old-${r.tokenId}`}>
                <span><CoinIcon symbol={r.symbol} icon={r.icon} size={20} />{r.symbol}</span>
                <span>{amountOf(r.amount, r.symbol)}</span>
              </div>
            ))}
            <p className="zf-small wl-explain" role="status">{oldWalletsLine(pocket.oldWords)}</p>
            {(pocket.oldWords.stuck || pocket.oldWords.unread) && <button className="zf-link" onClick={() => void bridge.call("ledger.oldWordsMove", {}).then(refresh)}>Try again</button>}
          </>
        )}
        {ready && (
          <button className="wl-kv wl-kv-btn" onClick={() => onDefault(!pocket?.defaultOn)} aria-pressed={pocket?.defaultOn ?? false}>
            <span>Use for payments by default</span>
            <span>{pocket?.defaultOn ? "On" : "Off"}</span>
          </button>
        )}
        <HomeRow step={moving} has={has} onOpen={() => openSheet(false)} line={landedAt !== null ? null : madeAt !== null ? madeLine(madeAt, clock.now()) : undefined} />
        <More label="What to know about Private" lines={[...PRIVATE_MORE, PRIVATE_SEEN, ...PRIVATE_HOW]} />
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {/* the copy review's A2-2: one lit button, Move while Private holds money, else Add to Private; the other quiet. Move opens
            Private's own one-slider sheet, never the all-wallets one */}
        {ready && has && <button className="zf-btn" data-testid="private-move" disabled={moving !== "no"} onClick={() => openSheet(true)}>Move</button>}
        <button className={ready && has ? "zf-btn zf-btn--quiet" : "zf-btn"} data-testid="private-add" onClick={ready ? onAdd : onSetUp}>{ready ? "Add to Private" : "Set up Private"}</button>
      </div>
      {moving === "check" && shown && <MoveAllSheet usd={usd} stays={stays} {...(shown.slide ? { slide: { value: pick, max: shownTotal, onChange: setPick } } : {})} onApprove={taps.approve} onClose={taps.close} />}
    </div>
  );
}

/** Coins that can move into Private: listed coins native to NEAR, in the ledger or on the account (route B). */
/** Kept in step with WalletApp.tsx's own copy (the screen loads later; review: one rule). */
export const canGoPrivate = (b: Balance) => b.listed !== false && b.held !== "private" && b.chain === "near" && !b.bridged;

/** What "Private" is, said where the Move into it is first approved (first-time hunt, 5 Nov; words only). */
export const PRIVATE_IS = "Private is your NEAR wallet the public can't see into.";

export function AddToPrivate({ from, onPickFrom, onDone, onProblem, onHeld }: {
  from: Balance | null;
  onPickFrom: () => void;
  onDone: (m?: Movement) => void;
  onProblem: (p: Problem) => void;
  onHeld: (held: NonNullable<Movement["held"]>) => void;
}) {
  const { bridge, chains, tokens, balances, pocket } = useWallet();
  const { tasks } = useShell();
  // D10 (audit 13): Home's one figure for the coin is this place plus the rest; the rest is said once, under the row
  const otherLine = from ? otherPartLine(from, balances ?? [], pocket?.available ? pocket.rows : [], chains) : null;
  /** The job is made: what it moves, and the receipt shows ("Job created.") until Done. */
  const [made, setMade] = useState<string | null>(null);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  /** Audit 11's B7 (8 Nov): the made screen's time left from its first frame, the quote's own (about 10 s), else Private's measured leg */
  const [madeEta, setMadeEta] = useState<number>(HOME_ETA_SEC);
  const ended = useRef<{ m?: Movement; closed?: boolean }>({});
  const [amount, setAmount] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const symbol = from?.symbol ?? "";
  const decimals = Math.min(6, from?.tokenId === "near" ? 24 : tokens.get(from?.tokenId ?? "")?.decimals ?? 6);

  useEffect(() => {
    setQuote(null);
    setWhy(null);
    if (!from || !isPositive(amount)) return;
    let live = true;
    const t = setTimeout(() => {
      void bridge.call<Quote>("ledger.quoteToPrivate", { tokenId: from.tokenId, amount }).then((r) => {
        if (!live) return;
        if ("ok" in r) setQuote(r.ok);
        else setWhy(r.problem.whatHappened);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bridge, from?.tokenId, amount]);

  // the job (bug report, 5 Nov): made on this move's own Face ID yes (the Safe's Approve), or on the core's answer when
  // no yes is heard here (the phone's own chip sheet); a No makes nothing. A refusal after is said on its row.
  const go = async () => {
    if (!quote || busy) return;
    mark("tap");
    setBusy(true);
    const what = `${coins(amount, decimals)} ${symbol}`.trim();
    const eta = quote.etaSeconds && quote.etaSeconds > 0 ? quote.etaSeconds : HOME_ETA_SEC;
    setMadeEta(eta);
    // M12-5 (8 Nov): this Add's own key, made at the tap; the core stamps it on its movement (Movement.jobKey) and the job
    // keeps it on its carry the moment it is made, so a reload before the core answers ends the job by it (reopenOf)
    const key = newJobKey();
    const end = await runJob<Movement>({
      tasks, title: `Add ${what} to Private`, etaSec: eta, safe: true, money: ["safe"],
      call: () => bridge.call<Movement>("ledger.toPrivate", { quoteId: quote.id, key }),
      declined: (r) => "problem" in r && /declined$/.test(r.problem.code),
      made: (j) => { carryTo([j.id], { parts: [jobKeyPart(key)] }); setMadeJob(j.id); setMade(what); setBusy(false); },
    });
    setBusy(false);
    if ("declined" in end) return setMade(null);
    if ("refused" in end) { mark("refused"); return onProblem(end.refused); }
    if ("problem" in end) return void mark("refused");
    const m = end.ok;
    end.job.made(m.status === "waiting" ? [] : [`send:${m.id}`]);
    if (m.status === "waiting" && m.held) { setMade(null); return onHeld(m.held); }
    setAmount("0");
    if (ended.current.closed) return;
    ended.current.m = m;
  };
  const doneMade = () => { const m = ended.current.m; ended.current = { closed: true }; setMade(null); onDone(m); };

  if (made !== null) {
    return (
      <div className="wl wl-convert">
        <JobReceipt amount={made} icon={<PrivateMark size={44} />} testid="private-add-made" etaSec={madeEta} job={madeJob} onDone={doneMade} />
      </div>
    );
  }

  return (
    <div className="wl wl-convert">
      <button className="wl-chain" onClick={onPickFrom}>
        {from ? <CoinIcon symbol={from.symbol} icon={from.icon} size={24} /> : null}
        <span>{from ? from.symbol : "Choose a coin"}</span>
        {from && <span className="zf-small wl-place">{placeOf(from, chains)}</span>}
        <span className="wl-change">{from ? canGoLabel(from) : ""} <Down /></span>
      </button>
      {/* D10 (audit 13): the rest of Home's figure for the coin, once, and where it is */}
      {otherLine && <p className="zf-small wl-place" data-testid="private-other">{otherLine}</p>}
      <div className="wl-amount">
        <p className="wl-big">{coins(amount, decimals)} <small>{symbol}</small></p>
        <p className="zf-small" aria-live="polite">
          {quote ? `In Private: about ${amountOf(quote.amountOut, symbol)} ${symbol} · at least ${amountOf(quote.minOut, symbol)}` : why ?? (isPositive(amount) && from ? "Getting a price" : " ")}
        </p>
      </div>
      <Keypad value={amount} decimals={decimals} onChange={setAmount} />
      <div className="zf-floor">
        <button className="zf-btn" disabled={!quote || busy} onClick={() => void go()}>{`Move ${coins(amount, decimals)} ${symbol} to Private`.replace(/\s+/g, " ").trim()}</button>
        <p className="zf-small" data-testid="private-is">{PRIVATE_IS}</p>
        <p className="zf-small" data-testid="private-through">{PRIVATE_THROUGH}</p>
      </div>
    </div>
  );
}
