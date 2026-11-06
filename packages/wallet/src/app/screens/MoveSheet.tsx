// Move (the Home plan §1.5, bug 11; V1's sliders, rewritten): where your money sits, as one ribbon and one slider per
// place: the Safe, SOL, ETH (RH), NEAR, and BNB only while its gate is open. Each shows its dollars, said once. It
// opens on today's split, so nothing moves untouched; dragging one rebalances the others (move-split.ts), and each leg is
// one line as you drag ("SOL → Safe $100"). One Move button: the Safe's money leaves through its Approve (Face ID,
// spending.topUp's legs), wallet → wallet is its own private job (spending.move, E5), money home is one take-out
// (spending.putAway's legs). Every direction works; a Safe under $2 never blocks a wallet's money from coming home.
// While the legs run, the ribbon glows along the moving part and each leg's line fills as it travels (CSS only; Reduce
// Motion snaps it).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SpendingActivity, SpendingStatus } from "@zerofee/core/spending";
import type { NextStep } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { whoLine } from "@zerofee/shell-api/job-who.ts";
import { MoneySheet, SheetLine } from "@zerofee/design/MoneySheet.tsx";
import { sayWent, type HomeWallet } from "@zerofee/shell-api/money.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { MOVE_LOST, refusedLine, refusedStep, runMove } from "./move-run.ts";
import { dollars, privateFigure } from "../format.ts";
import { SHEET_NEEDS, useServices } from "../services.ts";
import { useMoveProblem } from "./Spending.tsx";
import { useWallet } from "../runtime.tsx";
import { aboutLegs, madeState, backLines, footNote, moveUnread, costLine, costRows, everyLanded, runOf, type MoveFollow, type Run, fromSlider, keptLines, least, leavePlace, leftoverLine, legLine, legsOf, legTime, MOVE_WORDS, moveBlock, nextTyped, PLACE_NAME, planSplit, placesNow, planOf, rangeOf, fillLine, fillLegs, fillOf, homeCut, safeCoinMost, safeSigns, safeSide, safeKeeps, safeMostLine, shortLeg, strandLeg, today, totalOf, typeOp, typedUsd, usdShort, WHERE, withLeg, withOp, type Leg, type Place, type PlaceNow, type SetOp, type Split } from "./move-split.ts";
import { ActMove, PrivateMark, TabSafe } from "../icons.tsx";
import { TimeLeft } from "../money/JobMade.tsx";
import { HOME_PROOF } from "@zerofee/core/home-proof";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { intentsKept } from "@zerofee/core/zero-fee";
import "../money/move-swap.css";
import "@zerofee/design/receipt.css";

export { MOVE_WORDS } from "./move-split.ts";
/** The logo key of each place (the Safe has none: its monogram). */
const ICON: Partial<Record<Place, string>> = { sol: "sol", hood: "hood", near: "near", bsc: "bsc" };

/** What each call answered: the row Activity follows it by. */
type Follow = MoveFollow;

/** A key per wallet → wallet job (the same tap, the same job: a double tap never makes two). */
const moveKey = (): string => `home-move-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Where a Move goes, by wallet name ("your Safe", "your SOL wallet"); several, "your wallets". */
const madeTo = (to: readonly Place[]): string => { const u = [...new Set(to)]; return u.length !== 1 ? "your wallets" : u[0] === "safe" ? "your Safe" : `your ${PLACE_NAME[u[0]!]} wallet`; };

export function MoveSheet(p: { status: SpendingStatus;
  /** the read still on its way, named (MoneyHost: the sheet opened on what was known) */ slowLine?: string | null;
  safeUsd: string | null;
  /** the row in focus: Home's tab it opened from, or Private (its own screen's Move: the source) */ wallet?: HomeWallet | "private";
  /** filled in by the app that opened it, read once: the sliders set to this one move */ prefill?: { from: Place;
  to: Place;
  usd?: number;
  /** the whole of `from` (AgentZero's "move all") */ all?: true;
  /** the app's figure was under the least: `usd` is the least, and the sheet says why until the person changes it */ raised?: true };
  /** the asking app's quick Move (Trade): as Home's, "Job created." once the job is made, then Done back to it */ quick?: boolean;
  onClose: () => void;
  onDone: (line: string, movementId?: string) => void;
  onHeld: (h: NonNullable<SpendingActivity["held"]>) => void;
  onOpen: (next: NextStep) => void;
  onAdd?: () => void }) {
  const { status, safeUsd, wallet, onClose, onDone, onHeld, onOpen, onAdd } = p;
  const { bridge, tasks } = useShell();
  const { balances, pocket } = useWallet();
  // what one Move can take from the Safe: its largest coin (one coin pays, its NEAR less its fees), inside Trading's room;
  // a Move pays from Private first, so Private's share of that coin counts too (QA's lap, 5 Nov: "at most $0" with
  // $7.90 in Private). Private not read yet: the line says "Reading", never "$0" (safeMostLine)
  const privRows = useMemo(() => (pocket?.available && pocket.ready ? pocket.rows : null), [pocket]);
  const coins = useMemo(() => [...(balances ?? []), ...(privRows ?? [])], [balances, privRows]);
  const coinsRead = balances !== null && pocket !== null;
  // Private is its own row (the pair-private walk, 5 Nov): what it holds, and what one Move takes from it; the Safe's own
  // coins give only through the fill, and the fill closed (safe-fill-open.ts) they give nothing (the proof run, 5 Nov)
  const room = Number(status.roomUsd) || 0;
  const coinMost = useMemo(() => safeCoinMost(balances ?? [], SAFE_FILL_OPEN), [balances]);
  // one Move's most from the Safe and Private together: the coin that pays, Private's share first, the Safe's fill the
  // rest (one Approve; Sim re-check, 5 Nov). The fill closed: nothing from the Safe's own coins
  const bothMost = useMemo(() => (SAFE_FILL_OPEN ? safeCoinMost(coins, true) : 0), [coins]);
  const safeMost = Math.floor(Math.min(bothMost, room) * 100) / 100;
  // Private's one figure (format.ts privateFigure, test MUST 3): the same as a site's Add and Send say
  const privUsd = useMemo(() => { const f = privateFigure(pocket); return f === null ? undefined : Number(f); }, [pocket]);
  const privMost = Math.floor(Math.min(privRows ? safeCoinMost(privRows) : 0, room) * 100) / 100;
  // the source a Move pays from: Private while it can give a move, else the Safe (through the fill)
  const fromPriv = privMost >= 2;
  const live = useMemo(() => placesNow({ safeUsd: safeUsd === null ? null : Number(safeUsd), safeMostUsd: safeMost, ...(privUsd !== undefined ? { privateUsd: privUsd, privateMostUsd: privMost } : {}), networks: status.networks, reserveUsd: status.reserveUsd }), [safeUsd, safeMost, privUsd, privMost, status]);
  // D140 (the grade of 3 Nov: the total fell by the $310 on its way): from the tap on, the sheet holds the places as they
  // were then, so the total stays and each row says what it was and what it will be; money on its way counts where it goes
  const [frozen, setFrozen] = useState<PlaceNow[] | null>(null);
  const [paysHeld, setPaysHeld] = useState<ReturnType<typeof fillLegs> | null>(null);
  // the places read live again (a no, a refusal): so do the legs' figures
  useEffect(() => { if (frozen === null) setPaysHeld(null); }, [frozen]);
  const now = frozen ?? live;
  const total = totalOf(now);
  // "all" (mainnet run, 3 Nov: {from: "near", to: "safe", all: true} left the sliders where the money sits): the source to
  // $0 and all of it to the target
  const lead = (s: Split): Split => (p.prefill ? withLeg(s, p.prefill.from, p.prefill.to, p.prefill.all ? s[p.prefill.from] ?? 0 : p.prefill.usd ?? 0) : s);
  // finding 65 (no sticky sweeps): the sheet keeps the figures the person set, never a split; the plan is worked out from
  // today's split and those figures on every change, so a figure set back takes back all it moved
  const nowKey = JSON.stringify(now);
  const base = useMemo(() => lead(today(now)), [nowKey]);
  const [ops, setOps] = useState<SetOp[]>([]);
  const split = useMemo(() => planSplit(now, base, ops, HOME_PROOF), [nowKey, base, ops]);
  const [hint, setHint] = useState<{ place: Place; text: string } | null>(null);
  /** "Who can see this?" (R3, spec §4.4): the honest privacy line (audit H1) one tap away, never a grey paragraph. */
  const [who, setWho] = useState(false);
  // E5 between two chains' wallets only in the test proof build (review L9): until then their sliders trade with the Safe
  // and the NEAR wallet
  const legs = useMemo(() => legsOf(now, split, HOME_PROOF), [now, split]);
  // the grade (3 Nov, r-m04): "Nothing can move here yet." under every slider, then "Drag a slider": when no place can
  // move, it is said once, above Move
  const allStill = now.every((x) => rangeOf(now, x.place, HOME_PROOF).still);
  const block = allStill && total >= 2 ? MOVE_WORDS.still : moveBlock(legs, total, HOME_PROOF, now);
  const [line, setLine] = useState<string | null>(null);
  /** The refusal's next step (rule 8): its label, and whether it sets the Safe to what it can move. */
  const [step, setStep] = useState<{ label: string; less: boolean } | null>(null);
  useEffect(() => { if (line === null) setStep(null); }, [line]);
  const [busy, setBusy] = useState(false);
  /** The job is made (product decision, 5 Nov): the sheet says so; the legs go on after. */
  const [made, setMade] = useState<number | null>(null);
  /** When the job was made: the legs' times count from it (one clock for the job, whichever legs are left). */
  const [madeAt, setMadeAt] = useState<number | null>(null);
  /** The Safe's Approve may be up (its Top up leg, Face ID): only then this sheet steps aside (D143). */
  const [asking, setAsking] = useState(false);
  // one key per planned leg (review M2): a retry of the same leg is the same move, never a second one
  const keys = useRef(new Map<string, string>());
  const keyFor = (what: string) => { let k = keys.current.get(what); if (!k) keys.current.set(what, (k = moveKey())); return k; };
  const [follow, setFollow] = useState<Follow[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const services = useServices(bridge, SHEET_NEEDS.move, "Move");
  const problem = useMoveProblem(onOpen, setLine);

  const set = (k: Place, usd: number) => {
    setLine(null);
    const lo = least(now, k);
    // a drag past what a place can let go of says why, under that slider
    setHint(usd < lo - 0.004 ? { place: k, text: k === "safe" ? safeMostLine(safeMost, SAFE_FILL_OPEN ? safeMost : privMost, coinsRead, SAFE_FILL_OPEN) : k === "private" ? safeMostLine(privMost, privMost, coinsRead, false) : MOVE_WORDS.keeps(PLACE_NAME[k], usdShort(lo)) } : null);
    setOps((o) => withOp(o, { place: k, by: "slide", usd }, base));
  };
  /** A figure being typed on a wallet's row (finding 17: each wallet's figure is a field until the legs run, and the slider
   *  follows it; the Safe's is what the wallets leave it), set when the field is left. Findings 62-65: an empty field is $0; the money moves with the Safe only;
   *  more than the Safe can give is not taken and says the most; under what the wallet keeps stops there and says so. */
  const [typing, setTyping] = useState<{ place: Place; text: string } | null>(null);
  const typeIn = (k: Place) => {
    const text = typing?.place === k ? typing.text : null;
    setTyping(null);
    if (text === null) return;
    const usd = text === "" ? 0 : typedUsd(text);
    if (usd === null || Math.abs(usd - (split[k] ?? 0)) < 0.005) return;
    setLine(null);
    const t = typeOp(now, base, ops, k, usd, HOME_PROOF), lo = least(now, k);
    setHint(t.over ? { place: k, text: safeMostLine(t.safeGives, SAFE_FILL_OPEN ? safeMost : privMost, coinsRead, SAFE_FILL_OPEN) } : usd < lo - 0.004 ? { place: k, text: MOVE_WORDS.keeps(PLACE_NAME[k], usdShort(lo)) } : null);
    if (!t.over) setOps(t.ops);
  };

  // the legs as they travel: Activity's rows, read each second while any is on its way
  useEffect(() => {
    if (!follow?.length) return;
    let live = true;
    const look = async () => {
      const r = await bridge.call<SpendingActivity[]>("spending.activity", {});
      if (!live || !("ok" in r)) return;
      setRuns(follow.map((f) => runOf(f, r.ok)));
    };
    void look();
    const t = setInterval(() => void look(), 1000);
    return () => { live = false; clearInterval(t); };
  }, [follow]);
  const running = follow !== null;
  const allEnded = running && runs.length === follow!.length && runs.every((r) => r.state !== "moving");

  const go = async () => {
    if (busy || block) return;                                               // one tap, one Move
    setBusy(true); setLine(null);
    setFrozen(now); setPaysHeld(pays);
    // the job is made at once (move-run.ts, product decision, 5 Nov): "Job created." here, its row on Home, the bell's pulse; a Safe
    // leg once its Approve said yes (Face ID). The legs' calls go on after: the sheet never waits on them.
    // nothing moved: the job is gone and the sheet reads live again
    const back = () => { setMade(null); setBusy(false); setFrozen(null); };
    const ran = await runMove(legs, planOf(legs, now), {
      call: (m, q) => bridge.call(m, q), tasks, onApproval: onOwnApproval, keyFor, say: (t, st) => sayWent(t, st), asking: setAsking,
      // Private pays the Safe's side whole (the ledger's own fill rule, read before the tap): no Safe sheet, made at the tap
      ...(coinsRead ? { fills: safeSigns(legs, coins, SAFE_FILL_OPEN) } : {}),
      // one figure per Move (QA's MUST, test): "Job created." says what was typed, as the sheet and the job
      made: (usd) => { setMade(Math.round(usd * 100) / 100); setMadeAt(Date.now()); setBusy(false); },
      refused: (pr) => { back(); const said = refusedLine(pr); if (said !== null) { setLine(said); setStep(refusedStep(pr)); } else void problem(pr, () => undefined); },
      declined: back,
    }).catch(() => { back(); setLine(MOVE_LOST); return null; });
    setBusy(false);
    if (!ran) return;
    if (ran.held) { onHeld(ran.held); return onDone(""); }
    setRuns(ran.followed.map((f) => ({ leg: f.leg, state: "moving" })));
    setFollow(ran.followed);
  };
  const close = () => {
    // "Job created." and its legs' ids not back yet: it went (the app that opened Move hears so), its row follows it
    if (!running) return made !== null ? onDone("") : onClose();
    const moving = runs.filter((r) => r.state === "moving");
    onDone(moving.length ? `${moving.map((r) => legLine(r.leg)).join(", ")}: on its way.` : runs.some((r) => r.state === "stopped") ? "" : "Moved.", follow?.[0]?.id);
  };
  // The Move's end is the ask's end (the test mainnet run, 3 Nov: every leg said Done on the sheet, and AgentZero still
  // said "still going" 15 minutes later, because the app that opened Move heard nothing until the person closed it). The
  // moment every leg landed, the sheet ends as a Close would then ("Moved."), with the move's id. A leg that stopped keeps
  // the sheet open: its line says where the money is, and the person's Close ends it.
  const landedAll = everyLanded(runs, follow?.length ?? 0);
  useEffect(() => { if (landedAll) close(); }, [landedAll]);

  // what leaves, the least that arrives and the most the fees can be, before the tap (D137), from the core's own floors
  // one figure per Move (QA's MUST, test): a Move pays from Private, so what leaves is what was typed; the
  // Safe's top-up into Private is its own step line (fillLine), never a second "leaves" figure
  const cost = costLine(legs);
  const costed = costRows(legs);
  const kept = keptLines(now, legs);
  // a UI test (4 Nov, S2): a wallet left under the least a move home can be is said before the tap
  const back = backLines(now, legs);
  const keeps = safeKeeps(now, { coinUsd: coinMost, roomUsd: Number(status.roomUsd) || 0, capUsd: status.capUsd });
  // the fill's whole step, said before the tap (QA's lap, 5 Nov: $10 into Private for a $2.10 Move, unsaid)
  const fills = fillLine(legs, coins, SAFE_FILL_OPEN);
  // what each place really pays (QA's Sim re-check, 5 Nov: "Private → SOL $15" while Private fell $10): the ledger's own
  // fill (fillOf), shown on the legs and Private's row; held from the tap on, as the places are (D140)
  const paysLive = useMemo(() => fillLegs(legs, fillOf(legs, coins, SAFE_FILL_OPEN)), [legs, coins]);
  const pays = paysHeld ?? paysLive;
  const runFor = (l: Leg): Run["state"] => (runs.find((r) => r.leg.from === l.from && r.leg.to === l.to) ?? runs.find((r) => r.leg.to === l.to && safeSide(r.leg.from) === safeSide(l.from)))?.state ?? "moving";
  // the sheet's one note under the rows (footNote: the most important of them)
  const foot = running ? null : footNote({ back: shortLeg(legs) || strandLeg(now, legs) ? [] : back, fill: block ? null : fills, rest: block ? null : costed?.note ?? null, kept, time: block && legs.length > 0 ? aboutLegs(legs) : null });
  // a leg under its least is named once, above Move, with one tap that leaves its wallet as it is (the test shot)
  // a leg under its least, or one that would leave its wallet with no way back (strandLeg): its "Leave … as it is" tap
  const short = running ? null : shortLeg(legs) ?? strandLeg(now, legs);
  const leave = () => { if (!short) return; setHint(null); const p = leavePlace(short); setOps((o) => [...o.filter((x) => x.place !== p), { place: p, by: "leave", usd: 0 }]); };
  const start = today(now);

  // the job is made (product decision, 5 Nov): the design's one-object receipt, "away" (it grows at once; no ring, no tick: those
  // say landed, and only the chain's answer can), with the job's words, and Done back to the app that opened Move
  // the job's own state (the copy review's Sim re-walk): Done the moment its legs landed; the time left is the legs still moving
  const job = madeState(runs, legs, follow?.length ?? 0);
  if (made !== null) {
    return (
      // the job exists: no "getting ready" line under "Job created." while the Safe's Face ID is asked (the phone's own sheet)
      <MoneySheet title={MOVE_WORDS.title} onClose={close}>
        <div className="zf-receipt zf-receipt--job wl-mv-made" data-state={job.state} role="status" aria-live="polite" data-testid="move-made">
          <div className="zf-receipt__obj">
            <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><ActMove /></span></div>
          </div>
          <p className="zf-receipt__amount">{dollars(made.toFixed(2))}</p>
          <p className="zf-receipt__head">{JOB_WORDS.created}</p>
          <p className="zf-receipt__line" data-testid="move-made-title">{`Move ${dollars(made.toFixed(2))} to ${madeTo(legs.map((l) => l.to))}`}</p>
          <p className="zf-receipt__line" data-testid="move-made-who">{whoLine(legs.map((l) => l.to))}</p>
          {job.state === "landed" ? <p className="zf-receipt__line" data-testid="move-made-landed">{MOVE_WORDS.done}</p> : job.etaSec !== null && <TimeLeft {...(madeAt !== null ? { endsAt: madeAt + job.etaSec * 1000 } : { etaSec: job.etaSec })} />}
          {job.state === "away" && <p className="zf-receipt__line">{JOB_WORDS.watch}</p>}
        </div>
        <button className="zf-btn wl-sheet-go" onClick={close} data-testid="move-made-done">{MOVE_WORDS.done}</button>
      </MoneySheet>
    );
  }
  // an unread Safe is never "Safe $0" (the crawl, 4 Nov: 3 min of it over a $15.81 Safe, the wallets' $5.63 enough to draw)
  if ((total < 2 || safeUsd === null) && !running) {
    // unread is not empty (real money, 4 Nov: "Nothing to move yet" over a $45 Safe): until the Safe and every wallet
    // answered, the sheet says it is reading, never "Add money first"
    if (moveUnread(safeUsd, status)) {
      return (
        <MoneySheet title={MOVE_WORDS.title} onClose={onClose}>
          {p.slowLine && <SheetLine text={p.slowLine} />}
          <p className="zf-body wl-sheet-lead" role="status" data-testid="move-reading">{MOVE_WORDS.reading}</p>
        </MoneySheet>
      );
    }
    return (
      <MoneySheet title={MOVE_WORDS.title} onClose={onClose}>
        <p className="zf-body wl-sheet-lead" role="status">{MOVE_WORDS.nothing}</p>
        {onAdd && <button className="zf-btn wl-sheet-go" onClick={onAdd}>Add money</button>}
      </MoneySheet>
    );
  }
  return (
    <MoneySheet title={MOVE_WORDS.title} away={busy && asking} onClose={close}>
      {/* R3 (spec §4.4, G3): the total, big and still (D140: it never changes during a move), and one line that says what
          to do; no "Where your money sits" header, no "Drag a slider" paragraph above Move */}
      <div className="wl-mv-hero">
        <p className="wl-mv-total" aria-label={`${MOVE_WORDS.head}: ${usdShort(total)}`}>{usdShort(total)}</p>
        <p className="wl-mv-lead">{running ? (allEnded ? "" : MOVE_WORDS.closeOk) : MOVE_WORDS.untouched}</p>
      </div>
      {/* R3 (review): no ribbon under the total: a bar with no words that a person can't read */}
      <div className="wl-mv-rows" role="group" aria-label={MOVE_WORDS.head}>
        {now.map((x) => {
          const v = split[x.place] ?? 0;
          // the figure said: each row its own place (the copy review's ruling, 5 Nov, QA's Sim test: Safe $5,288.01 + Private $33.86 + the
          // wallets ≠ the headline's $5,494.66): Private has its own row here, so the Safe's row leaves it out and the rows
          // add up to the headline. D128 (Private counted in the Safe) stays only for Home's one big number, with no Private row
          const said = (o: Partial<Record<string, number>>) => o[x.place] ?? 0;
          // Private's figure is what the ledger leaves it (fillLegs), never the slider's share
          // the Safe's row before the tap: only what the floors promise lands (homeCut), the "Arrives" row's one figure
          const shown = x.place === "private" && legs.length > 0 ? Math.round(((start.private ?? 0) + pays.privateUsd) * 100) / 100 : x.place === "safe" && !running ? Math.round((said(split) - homeCut(legs)) * 100) / 100 : said(split), was = said(start);
          // its own range, from what it keeps to the most it can reach: dollars, whatever the Safe holds
          const r = rangeOf(now, x.place, HOME_PROOF);
          return (
            <div className={`wl-mv-row wl-mv-${x.place}${wallet === x.place ? " is-focus" : ""}`} key={x.place} data-testid={`move-${x.place}`}>
              <div className="wl-mv-row__h">
                {/* the Safe's own mark, the shield Home's Safe tab shows; each wallet its chain's logo */}
                {x.place === "safe" ? <span className="wl-mv-shield"><TabSafe /></span> : x.place === "private" ? <PrivateMark size={24} /> : <CoinIcon symbol={PLACE_NAME[x.place]} {...(ICON[x.place] ? { icon: ICON[x.place]! } : {})} size={24} />}
                <span className="wl-mv-name">
                  <span className="t">{PLACE_NAME[x.place]}</span>
                  {/* today's figure (D137) for a place whose figure changes, said once as "was $5,288.01" under its name
                      (spec §4.4); one that doesn't change says its figure once (the grade of 3 Nov: "$5,288.01 $5,288.01") */}
                  {Math.abs(shown - was) >= 0.005 && <span className="wl-mv-now" aria-label={`Now ${usdShort(was)}`}>{MOVE_WORDS.was(usdShort(was))}</span>}
                  {/* a place nothing can move into or out of: no slider, one line under its name (review L4, spec §4.4) */}
                  {!running && r.still && !allStill && <span className="wl-mv-now" data-testid={`move-still-${x.place}`}>{MOVE_WORDS.still}</span>}
                </span>
                {running || x.place === "safe" || x.place === "private"
                  ? <span className="wl-mv-usd" aria-label={`After ${usdShort(shown)}`}>{usdShort(shown)}</span>
                  : <input className="wl-mv-usd wl-mv-type" inputMode="decimal" autoComplete="off" enterKeyHint="done" disabled={busy || r.still}
                      aria-label={MOVE_WORDS.typed(WHERE[x.place])} data-testid={`move-type-${x.place}`}
                      value={typing?.place === x.place ? typing.text : usdShort(v)}
                      onFocus={(e) => { setTyping({ place: x.place, text: usdShort(v).slice(1) }); e.currentTarget.select(); }}
                      onChange={(e) => { const raw = e.target.value; setTyping((t) => ({ place: x.place, text: nextTyped(t?.place === x.place ? t.text : "", raw) })); }}
                      onBlur={() => typeIn(x.place)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
              </div>
              {!r.still && <input type="range" className="wl-mv-range" min={r.min} max={r.max} step={r.step} value={v} disabled={running || busy || r.still}
                style={{ ["--p" as string]: `${Math.max(0, Math.min(100, ((v - r.min) / (r.max - r.min)) * 100))}%` } as CSSProperties}
                aria-label={`${PLACE_NAME[x.place]} slider`} aria-valuetext={dollars(v.toFixed(2))}
                onChange={(e) => set(x.place, fromSlider(r, Number(e.target.value)))} />}
              {!running && hint?.place === x.place && <p className="zf-small wl-mv-hint">{hint.text}</p>}
              {/* the Safe says what stays and why, once, as soon as its slider moves (QA's lap, 5 Nov: it gave at
                  most $2.29 of $10.06 with no reason; the copy review: show it then), and at its lowest (phone test, 3 Nov) */}
              {!running && !hint && x.place === "safe" && !r.still && (v <= r.floor + 0.004 || Math.abs(v - (start.safe ?? 0)) >= 0.005) && keeps && <p className="zf-small wl-mv-hint" data-testid="move-safe-keeps">{keeps}</p>}
              {/* under $2 to spare: said plainly, never a slider that looks stuck (UI's mainnet rehearsal, 3 Nov) */}
              {!running && !hint && leftoverLine(x) && <p className="zf-small wl-mv-hint" data-testid={`move-leftover-${x.place}`}>{leftoverLine(x)}</p>}
            </div>
          );
        })}
      </div>
      {(running || legs.length > 0) && (
        <ul className="zf-group wl-mv-legs" aria-label="What moves">
          {pays.legs.map((leg) => ({ leg, state: running ? runFor(leg) : "planned" as const, ...(running ? { note: runs.find((r) => r.leg.from === leg.from && r.leg.to === leg.to)?.note } : {}) })).map((r) => (
            <li key={`${r.leg.from}-${r.leg.to}`} className={`wl-mv-leg is-${r.state}`} data-testid={`leg-${r.leg.from}-${r.leg.to}`} style={{ ["--t" as string]: `${legTime(r.leg)}s` } as CSSProperties} aria-label={legLine(r.leg)}>
              <span className="wl-mv-leg__fill" aria-hidden="true" />
              <span className="wl-mv-leg__t">{PLACE_NAME[r.leg.from]} → {PLACE_NAME[r.leg.to]}</span>
              <span className="wl-mv-leg__v">{usdShort(r.leg.usd)}</span>
              <span className="zf-small wl-mv-leg__s">{r.state === "done" ? "Done" : r.state === "stopped" ? "Stopped" : r.state === "moving" ? "On its way" : ""}</span>
              {"note" in r && r.note && <span className="zf-small wl-mv-leg__note">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {/* what arrives, only for a move that can go: one under its least says the least instead */}
      {/* what leaves, the least that arrives, the most the fees can be and the time: one grouped block (product decision, 3 Nov:
          "text floats with no clear lines of separation"); its sentence (costLine) is what a screen reader hears */}
      {!running && !block && cost && costed && (
        <dl className="zf-group wl-mv-sum" data-testid="move-least" aria-label={cost}>
          {costed.rows.map((r) => <div key={r.label} className="zf-group__row"><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
        </dl>
      )}
      {/* one note at a time, the most important (the copy review's walk, 5 Nov: they stacked): no way back, the fill, then hints */}
      {foot && <p className="zf-small wl-mv-foot" data-testid={foot.kind}>{foot.text}</p>}
      {!running && legs.length > 0 && (
        <div className="wl-mv-who">
          <button type="button" className="wl-mv-who__q" aria-expanded={who} onClick={() => setWho((w) => !w)} data-testid="move-who">{MOVE_WORDS.who}</button>
          {who && <p className="zf-small wl-mv-foot" data-testid="move-private">{MOVE_WORDS.privately}</p>}
        </div>
      )}
      <SheetLine text={line ?? services.line ?? p.slowLine ?? (p.prefill?.raised && ops.length === 0 ? (p.prefill.to === "near" ? MOVE_WORDS.least : MOVE_WORDS.leastFromSafe) : null)} />
      {!running && line !== null && step && <p className="zf-small wl-mv-why"><button type="button" className="zf-chip" data-testid="move-refused-step" onClick={() => { setLine(null); if (step.less) { const src = fromPriv ? "private" : "safe"; set(src, least(now, src)); } }}>{step.label}</button></p>}
      {running
        ? <button className="zf-btn wl-sheet-go" onClick={close}>{MOVE_WORDS.done}</button>
        : <>
            {/* one place over the button: why it can't go yet, or the fee block (the copy review, 6 Nov); its figure is the Fees row above */}
            {block && block !== MOVE_WORDS.untouched
              ? <p className="zf-small wl-mv-why" role="status" data-testid="move-why">{block}{short && <> <button type="button" className="zf-chip" data-testid="move-leave" onClick={leave}>{MOVE_WORDS.leave(PLACE_NAME[leavePlace(short)])}</button></>}</p>
              : <div className="zf-fee"><p className="zf-small" data-testid="move-paid">{intentsKept(!block && !!cost && !!costed)}</p></div>}
            <button className={`zf-btn wl-sheet-go${busy ? " is-busy" : ""}`} aria-busy={busy || undefined} disabled={busy || !!block || services.down} onClick={() => void go()}>{busy ? MOVE_WORDS.moving : MOVE_WORDS.go}</button>
          </>}
    </MoneySheet>
  );
}
