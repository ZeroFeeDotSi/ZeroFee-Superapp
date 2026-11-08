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
import { MoneySheet, SheetLine, SheetTop } from "@zerofee/design/MoneySheet.tsx";
import { sayWent, type HomeWallet } from "@zerofee/shell-api/money.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { MOVE_LOST, MOVE_SAID_NO, refusedLine, refusedStep, runMove } from "./move-run.ts";
import { endHere, sendEndsHere } from "../money/swap-refused.ts";
import { dollars, privateWhole } from "../format.ts";
import { SHEET_NEEDS, needsWith, restsProps, servicesLine, useHealth } from "../services.ts";
import { useOffline } from "../didnt-open.tsx";
import { useMoveProblem } from "./Spending.tsx";
import { useWallet } from "../runtime.tsx";
import { moveHead, oneTotal, OUTSIDE_WORDS, privateOfLine, safeRowFigure, type OutsideMove } from "../one-total.ts";
import { aboutLegs, alsoMoved, alsoSaysPrivate, madeState, moveFace, moveFee, moveFloor, moveSummary, safeAfter, backLines, footNote, moveUnread, costLine, costRows, withSources, saidOnce, everyLanded, runOf, type MoveFollow, type MoveStep, type Run, fromSlider, typingShown, keptLines, least, leavePlace, leftoverLine, legLine, legsOf, legTime, MOVE_WORDS, moveBlock, nextTyped, PLACE_NAME, PLACES, planSplit, placesNow, planOf, rangeOf, fillLine, fillLegs, fillOf, safeCoinMost, safeSigns, safeSide, safeKeeps, privateGetsLine, safeMostLine, shortLeg, strandLeg, today, totalOf, typeOp, typedUsd, usdShort, WHERE, withLeg, withOp, type Leg, type Place, type PlaceNow, type SetOp, type Split } from "./move-split.ts";
import { ActMove, PrivateMark, TabSafe } from "../icons.tsx";
import { checkLines, floorFromCheck } from "./move-check-floor.ts";
import { whoLine } from "@zerofee/shell-api/job-who.ts";
import { JobRowSteps, TimeLeft, useJobSteps, useReceiptState } from "../money/JobMade.tsx";
import { moveReceiptWords, moveWhere } from "../money/receipt-said.ts";
import { HOME_PROOF } from "@zerofee/core/home-proof";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import "../money/move-swap.css";
import "@zerofee/design/receipt.css";

export { MOVE_WORDS } from "./move-split.ts";
/** Audit 13's D8 (8 Nov): offline, Move says what Send says (builder 13), once, on top; its sliders rest; no Try again. */
export const MOVE_OFFLINE = "You're offline. Your money is safe. Move works again when you're back. It checks again by itself.";
/** The logo key of each place (the Safe has none: its monogram). */
const ICON: Partial<Record<Place, string>> = { sol: "sol", hood: "hood", near: "near", bsc: "bsc" };

/** What each call answered: the row Activity follows it by. */
type Follow = MoveFollow;

/** A key per wallet → wallet job (the same tap, the same job: a double tap never makes two). */
const moveKey = (): string => `home-move-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Where a Move goes, by wallet name ("your Safe", "your SOL wallet", "your SOL and ETH (RH) wallets", the copy review's J5). */
/** In the plan's order (PLACES; 04d said "NEAR and SOL" under a plan that said "SOL and NEAR"), one order everywhere. */
const madeTo = (to: readonly Place[]): string => moveWhere(PLACES.filter((p) => to.includes(p)).map((p) => (p === "safe" ? "Safe" : PLACE_NAME[p])));

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
  const shell = useShell();
  const { bridge, tasks } = shell;
  const { balances, pocket, chains, earning, trading, tradingPartial, wallets } = useWallet();
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
  // the audit's S2 (7 Nov): with the old wallets' money, Home and the Private page said one Private figure (privateAllUsd) and this
  // row another, the gap landing in "Not moved" as "coins in your wallets". One figure: Private's row holds the old wallets'
  // money too (it never moves from here: privMost reads Private's own rows), and the Safe's figure counts it, as Home's total
  const privParts = useMemo(() => privateWhole(pocket), [pocket]);
  const privUsd = privParts?.usd, oldUsd = privParts?.oldUsd ?? 0;
  const privMost = Math.floor(Math.min(privRows ? safeCoinMost(privRows) : 0, room) * 100) / 100;
  // the source a Move pays from: Private while it can give a move, else the Safe (through the fill)
  const fromPriv = privMost >= 2;
  const live = useMemo(() => placesNow({ safeUsd: safeUsd === null ? null : Number(safeUsd) + oldUsd, safeMostUsd: safeMost, ...(privUsd !== undefined ? { privateUsd: privUsd, privateMostUsd: privMost } : {}), networks: status.networks, reserveUsd: status.reserveUsd }), [safeUsd, oldUsd, safeMost, privUsd, privMost, status]);
  // D140 (the grade of 3 Nov: the total fell by the $310 on its way): from the tap on, the sheet holds the places as they
  // were then, so the total stays and each row says what it was and what it will be; money on its way counts where it goes
  const [frozen, setFrozen] = useState<PlaceNow[] | null>(null);
  const [paysHeld, setPaysHeld] = useState<ReturnType<typeof fillLegs> | null>(null);
  // the places read live again (a no, a refusal): so do the legs' figures
  // whether it fills Private first, held from the tap as the legs are (the audit's S8: the time counts both legs till it lands)
  const [fillHeld, setFillHeld] = useState<boolean | null>(null);
  useEffect(() => { if (frozen === null) { setPaysHeld(null); setFillHeld(null); } }, [frozen]);
  const now = frozen ?? live;
  const total = totalOf(now);
  // A2-3 (copy review, 8 Nov: "All your wallets $5,460.55" beside Home's $5,288.01 + $227.48): the headline is Home's one total
  // (one-total.ts, the sum Home's pills and set-up show); what Hot holds outside the places (site wallets, AgentZero's,
  // coins) is one still row, so the rows add up to it. Held from the tap on with the places (D140)
  const headLive = moveHead(oneTotal({ balances, chains, earning, pocket, trading, tradingPartial }), totalOf(live), wallets);
  const outsideHeld = useRef<OutsideMove | null>(null);
  if (frozen === null) outsideHeld.current = headLive.outside;
  const outside = outsideHeld.current;
  const headline = Math.round((total + (outside?.usd ?? 0)) * 100) / 100;
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
  /** "Who can see this?" (R3, spec §4.4): the honest privacy line (audit H1) one tap away, its own full-screen sheet (D135), as Swap's. */
  const [who, setWho] = useState(false);
  // E5 between two chains' wallets only in the test proof build (review L9): until then their sliders trade with the Safe
  // and the NEAR wallet
  const legs = useMemo(() => legsOf(now, split, HOME_PROOF), [now, split]);
  // the grade (3 Nov, r-m04): "Nothing can move here yet." under every slider, then "Drag a slider": when no place can
  // move, it is said once, above Move
  const allStill = now.every((x) => rangeOf(now, x.place, HOME_PROOF).still);
  const block = allStill && total >= 2 ? MOVE_WORDS.still : moveBlock(legs, total, HOME_PROOF, now);
  const [line, setLine] = useState<string | null>(null);
  /** The refusal's next step (rule 8), on the floor's one button: moveFloor. */
  const [step, setStep] = useState<MoveStep | null>(null);
  useEffect(() => { if (line === null) setStep(null); }, [line]);
  const [busy, setBusy] = useState(false);
  /** The job is made (product decision, 5 Nov): the sheet says so; the legs go on after. */
  const [made, setMade] = useState<number | null>(null);
  /** The job its receipt follows (move-run's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  /** When the job was made: the legs' times count from it (one clock for the job, whichever legs are left). */
  const [madeAt, setMadeAt] = useState<number | null>(null);
  /** Audit 13's D1: the job's Jobs rows, as TimeLeft reads them: one rule for "landed" with the legs read off Activity. */
  const rowsState = useReceiptState(madeJob !== null, madeJob);
  // builder 24, item 2: the job's steps on screen (JobRowSteps reads the same rows): they say who does what, once
  const madeSteps = useJobSteps(madeJob);
  /** When the receipt first read the job landed, and the clock it last counted down to (it stays, so "Took 6 s." stays). */
  const doneAt = useRef<number | undefined>(undefined);
  const lastEnds = useRef<number | undefined>(undefined);
  /** The Safe's Approve may be up (its Top up leg, Face ID): only then this sheet steps aside (D143). */
  const [asking, setAsking] = useState(false);
  // one key per planned leg (review M2): a retry of the same leg is the same move, never a second one
  const keys = useRef(new Map<string, string>());
  const keyFor = (what: string) => { let k = keys.current.get(what); if (!k) keys.current.set(what, (k = moveKey())); return k; };
  const [follow, setFollow] = useState<Follow[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  // G3: a Move lands on each wallet's own chain (to or from the SOL wallet: Solana); one down, it can't go: the line says
  // so and Move is off. Only the sheet's own needs down (or offline) rest the rows: a wallet's chain down never locks the
  // slider that asked for it, so the person can take that leg back
  const health = useHealth(bridge);
  const services = servicesLine(health, needsWith(SHEET_NEEDS.move, legs.flatMap((l) => [l.from, l.to])), "Move");
  const sheetDown = servicesLine(health, SHEET_NEEDS.move, "Move").down;
  const offline = useOffline();
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
  // audit 16 re-grade: while the sheet can't go (offline, or a service it or a wallet's chain needs down), no promise line:
  // no "Moves it to your SOL wallet.", no arrives or takes rows; the fee line stays
  const cantGo = services.down && !running;
  const allEnded = running && runs.length === follow!.length && runs.every((r) => r.state !== "moving");

  const go = async () => {
    if (busy || block) return;                                               // one tap, one Move
    setBusy(true); setLine(null);
    setFrozen(now); setPaysHeld(pays); setFillHeld(fillsFirst);
    // the job is made at once (move-run.ts, product decision, 5 Nov): "Job created." here, its row on Home, the bell's pulse; a Safe
    // leg once its Approve said yes (Face ID). The legs' calls go on after: the sheet never waits on them.
    // nothing moved: the job is gone and the sheet reads live again
    const back = () => { setMade(null); setBusy(false); setFrozen(null); };
    const ran = await runMove(legs, planOf(legs, now), {
      call: (m, q) => bridge.call(m, q), tasks, onApproval: onOwnApproval, keyFor, say: (t, st) => sayWent(t, st), asking: setAsking,
      // Private pays the Safe's side whole (the ledger's own fill rule, read before the tap): no Safe sheet, made at the tap
      ...(coinsRead ? { fills: safeSigns(legs, coins, SAFE_FILL_OPEN) } : {}),
      // one figure per Move (QA's MUST, test): "Job created." says what was typed, as the sheet and the job
      made: (usd, j) => { setMadeJob(j); setMade(Math.round(usd * 100) / 100); setMadeAt(Date.now()); setBusy(false); },
      refused: (pr) => { back(); if (sendEndsHere(pr)) return void endHere(shell, pr, onClose); const said = refusedLine(pr); if (said !== null) { setLine(said); setStep(refusedStep(pr)); } else void problem(pr, () => undefined); },
      declined: () => { back(); setStep(null); setLine(MOVE_SAID_NO); },
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
  // the audit's S8 (7 Nov): a Move that fills Private from the Safe first counts both legs in its time (as if it fills until the
  // Safe's coins are read, as move-run's Approve does: never a time shorter than the real one)
  const fillsFirst = fillHeld ?? safeSigns(legs, coins, SAFE_FILL_OPEN) !== false;
  const costed = costRows(legs, fillsFirst);
  const kept = keptLines(now, legs);
  // a UI test (4 Nov, S2): a wallet left under the least a move home can be is said before the tap
  const back = backLines(now, legs);
  // the fill's whole step, said before the tap (QA's lap, 5 Nov: $10 into Private for a $2.10 Move, unsaid)
  const fills = fillLine(legs, coins, SAFE_FILL_OPEN);
  // what each place really pays (QA's Sim re-check, 5 Nov: "Private → SOL $15" while Private fell $10): the ledger's own
  // fill (fillOf), shown on the legs and Private's row; held from the tap on, as the places are (D140)
  const paysLive = useMemo(() => fillLegs(legs, fillOf(legs, coins, SAFE_FILL_OPEN)), [legs, coins]);
  const pays = paysHeld ?? paysLive;
  // audit 10's A7 (QA 16's ruling): the floor reads the plan its Check sheet prints (the core's moveSheet over this split
  // and the same costs: move-check-floor.ts), so it says Check's own "about $54.50, at least $53.22" and "Fees · about
  // $0.50" before the tap (D137); until those costs are read, or when one can't be, the plan's bounds, which Check meets
  const checkKey = running || block || !costed ? "" : JSON.stringify([legs, coins?.length ?? 0, pays.privateUsd]);
  const [checkRows, setCheckRows] = useState<{ key: string; rows: { label: string; value: string }[] } | null>(null);
  useEffect(() => {
    if (!checkKey) return;
    let live = true;
    const cost = (to: Place, usd: number) => bridge.call<{ arrivesUsd: number }>("subwallet.float.swapCost", { from: "safe-usdc", to, usd: usd.toFixed(2) }).then((r) => ("ok" in r ? r.ok.arrivesUsd : null), () => null);
    const t = setTimeout(() => void checkLines(legs, fillOf(legs, coins, SAFE_FILL_OPEN), cost).then((lines) => {
      const rows = lines ? floorFromCheck(lines, costed?.rows.find((r) => r.label === MOVE_WORDS.time)) : null;
      if (live) setCheckRows(rows ? { key: checkKey, rows } : null);
    }, () => { if (live) setCheckRows(null); }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [checkKey]);
  const floorRows = checkRows && checkRows.key === checkKey ? checkRows.rows : costed ? withSources(costed.rows, legs, pays) : [];
  // what else the plan moves, said once with its figures (row 8 b, alsoMoved); it says Private's change, so the fill's
  // foot line ("Your Safe sends … stays in Private.") is not said a second time under it
  const also = running || block ? null : saidOnce(alsoMoved(ops, pays), floorRows.length > 0);
  const runFor = (l: Leg): Run["state"] => (runs.find((r) => r.leg.from === l.from && r.leg.to === l.to) ?? runs.find((r) => r.leg.to === l.to && safeSide(r.leg.from) === safeSide(l.from)))?.state ?? "moving";
  // the sheet's one note under the rows (footNote: the most important of them); none while it can't go (audit 17's H3:
  // "Your Safe sends $60.00. $5.61 stays in Private." promised a fill under "Solana is down, so this can't go now.")
  const foot = running || cantGo ? null : footNote({ back: shortLeg(legs) || strandLeg(now, legs) ? [] : back, fill: block || also ? null : fills, rest: block ? null : costed?.note ?? null, kept, time: block && legs.length > 0 && !cantGo ? aboutLegs(legs, fillsFirst) : null });
  // a leg under its least is named once, above Move, with one tap that leaves its wallet as it is (the test shot)
  // a leg under its least, or one that would leave its wallet with no way back (strandLeg): its "Leave … as it is" tap
  const short = running ? null : shortLeg(legs) ?? strandLeg(now, legs);
  const leave = () => { if (!short) return; setLine(null); setHint(null); const p = leavePlace(short); setOps((o) => [...o.filter((x) => x.place !== p), { place: p, by: "leave", usd: 0 }]); };
  const start = today(now);
  // the Safe's row says one figure, what really stays (safeAfter: its whole fill out, the floors' least home in); its note
  // says that figure and the reason (the UI reviewer, 6 Nov, row 8 a)
  const safeShown = safeAfter(start, legs, pays, !running);
  // Private's figure as its row says it (what the ledger leaves it while legs are set), for the Safe row's one figure
  const privShown = legs.length > 0 ? Math.round(((start.private ?? 0) + pays.privateUsd) * 100) / 100 : split.private ?? 0;
  const keeps = safeKeeps(now, { coinUsd: coinMost, roomUsd: Number(status.roomUsd) || 0, capUsd: status.capUsd }, safeShown);
  // QA 16 (7 Nov): Private's rise said once, under its row, with why
  // audit 10's A6: never a second time when the also line says it ("$9.36" was said twice on the sheet)
  const privGets = running || cantGo || legs.length === 0 || alsoSaysPrivate(also) ? null : privateGetsLine(start.private ?? 0, privShown);
  // the plan's one summary line (item 4)
  const summary = running || cantGo ? null : moveSummary(legs, !!block);

  // the job is made (product decision, 5 Nov): the design's one-object receipt, "away" (it grows at once; no ring, no tick: those
  // say landed, and only the chain's answer can), with the job's words, and Done back to the app that opened Move
  // the job's own state (the copy review's Sim re-walk): Done the moment its legs landed; the time left is the legs still moving
  const job = madeState(runs, legs, follow?.length ?? 0, fillsFirst);
  const face = moveFace({ made: made !== null, busy, running });
  // audit 13's D1: one rule for landed (the legs or the rows), and the receipt's words in that one tense
  const said = moveReceiptWords({ legs: job.state === "landed", rows: rowsState.state === "landed", where: madeTo(legs.map((l) => l.to)), who: whoLine(legs.map((l) => l.to)), steps: madeSteps.length > 0 });
  if (said.landed && doneAt.current === undefined) doneAt.current = Date.now();
  if (job.etaSec !== null && madeAt !== null) lastEnds.current = madeAt + job.etaSec * 1000;
  const ends = lastEnds.current;
  if (made !== null) {
    return (
      // the job exists: no "getting ready" line under "Job created." while the Safe's Face ID is asked (the phone's own sheet)
      <MoneySheet title={MOVE_WORDS.title} onClose={close}>
        <div className="zf-receipt zf-receipt--job wl-mv-made" data-state={said.landed ? "landed" : job.state} role="status" aria-live="polite" data-testid="move-made">
          <div className="zf-receipt__obj">
            <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><ActMove /></span></div>
          </div>
          <p className="zf-receipt__amount">{dollars(made.toFixed(2))}</p>
          <p className="zf-receipt__head" data-testid="move-made-head">{said.head}</p>
          <p className="zf-receipt__line" data-testid="move-made-title">{said.title}</p>
          {said.who && <p className="zf-receipt__line" data-testid="move-made-who">{said.who}</p>}
          {/* audit 18's I2: the job's steps, ticking on each row's read (as the Safe Buy's receipt and Send's page) */}
          <JobRowSteps job={madeJob} testid="move-made-steps" />
          {/* "You can close this. It keeps going." follows the same landing as the time line (the copy review's J2-4, 8 Nov: it stood
              under "Done in 6 seconds."): TimeLeft's own watch line, gone the moment its rows landed. Landed (audit 13's D1),
              the clock it counted down to stays and stops at the landing: "Took 6 s." under "Done." */}
          {ends !== undefined ? <TimeLeft endsAt={ends} watch job={madeJob} doneAt={said.landed ? doneAt.current : undefined} /> : job.etaSec !== null ? <TimeLeft etaSec={job.etaSec} watch job={madeJob} doneAt={said.landed ? doneAt.current : undefined} /> : said.landed ? null : <p className="zf-receipt__line" data-testid="job-watch">{JOB_WORDS.watch}</p>}
        </div>
        <button className="zf-btn wl-sheet-go" onClick={close} data-testid="move-made-done">{MOVE_WORDS.done}</button>
      </MoneySheet>
    );
  }
  // from the tap until the job is made (the Safe's Check this on its way): the start face at once, its line filling in 100 ms
  // (rule 2; the UI reviewer's walk, 6 Nov: "Moving…" on the button for 620 ms), never a job said before the Safe's yes
  if (face === "start") {
    const go1 = moveSummary(legs, false);
    return (
      <MoneySheet title={MOVE_WORDS.title} away onClose={close}>
        <div className="zf-receipt zf-receipt--job wl-mv-made wl-mv-start" role="status" aria-live="polite" aria-busy="true" data-testid="move-start">
          <div className="zf-receipt__obj">
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><ActMove /></span></div>
          </div>
          <p className="zf-receipt__amount">{dollars(legs.reduce((n, l) => n + l.usd, 0).toFixed(2))}</p>
          {go1 && <p className="zf-receipt__line" data-testid="move-start-line">{go1}</p>}
          <span className="wl-mv-start__bar" aria-hidden="true"><span /></span>
        </div>
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
  // offline, the top says it (MOVE_OFFLINE): the floor's line never says it a second time; Move stays off (services.down)
  // audit 16's G1: offline or a service it needs down, the sliders and figures rest (restsProps), as Send's keypad does
  const rests = (offline || sheetDown) && !running;
  // the re-grade of g3-solana-move: a down service is the sheet's problem, ON TOP, full width, its status link under it;
  // the floor never says it again
  const downTop = !offline && !running && services.down ? services.line : null;
  const on = moveFloor({ line, step, block, said: (offline || downTop ? null : services.line) ?? p.slowLine ?? (p.prefill?.raised && ops.length === 0 ? (p.prefill.to === "near" ? MOVE_WORDS.least : MOVE_WORDS.leastFromSafe) : null) ?? null, down: services.down });
  const fee = moveFee(legs, !!block);
  const lessen = () => { const src = fromPriv ? "private" : "safe"; set(src, least(now, src)); };
  return (<>
    <MoneySheet title={MOVE_WORDS.title} away={busy && asking} onClose={close}>
      {/* the UI reviewer's ruling (6 Nov), Swap's floor: the rows and the plan scroll in their own box; the floor under it is its
          own box (line 1, the fee block, the one button, nothing under it), so it is always on the first frame and covers nothing */}
      <div className="wl-swap2 wl-mv2">
      <div className="wl-mv2__scroll" data-testid="move-scroll">
      {offline && !running && <div role="status" data-testid="move-offline" style={{ display: "grid", gap: 12, margin: "4px 0 16px" }}><p className="zf-body">{MOVE_OFFLINE}</p></div>}
      <SheetTop text={downTop} testid="move-down" />
      {/* R3 (spec §4.4, G3): the total, big and still (D140: it never changes during a move), and one line that says what
          to do; no "Where your money sits" header, no "Drag a slider" paragraph above Move */}
      <div className="wl-mv-hero">
        <p className="wl-mv-label" data-testid="move-all">{MOVE_WORDS.all}</p>
        <p className="wl-mv-total" data-testid="move-total" aria-label={`${MOVE_WORDS.head}: ${usdShort(headline)}`}>{usdShort(headline)}</p>
        <p className="wl-mv-lead">{running ? (allEnded ? "" : MOVE_WORDS.closeOk) : MOVE_WORDS.untouched}</p>
      </div>
      {/* R3 (review): no ribbon under the total: a bar with no words that a person can't read */}
      <div className="wl-mv-rows" role="group" aria-label={MOVE_WORDS.head} {...restsProps(rests)} data-testid="move-rows">
        {now.map((x) => {
          const v = split[x.place] ?? 0;
          // the figure said: each row its own place (the copy review's ruling, 5 Nov, QA's Sim test: Safe $5,288.01 + Private $33.86 + the
          // wallets ≠ the headline's $5,494.66): Private has its own row here, so the Safe's row leaves it out and the rows
          // add up to the headline. D128 (Private counted in the Safe) stays only for Home's one big number, with no Private row
          const said = (o: Partial<Record<string, number>>) => o[x.place] ?? 0;
          // Private's figure is what the ledger leaves it (fillLegs), never the slider's share
          // the Safe's row: what really stays (safeAfter: its fill out; before the tap, only what the floors promise lands home)
          const own = x.place === "private" && legs.length > 0 ? Math.round(((start.private ?? 0) + pays.privateUsd) * 100) / 100 : x.place === "safe" ? safeShown : said(split);
          // the copy review's B+ grade (8 Nov): one figure per name. "Safe" is Home's Safe figure, Private inside it (safeRowFigure), and
          // Private's row says it is part of it; the slider still moves only the Safe's own coins
          const shown = x.place === "safe" ? safeRowFigure(own, privShown) : own, was = x.place === "safe" ? safeRowFigure(said(start), start.private ?? 0) : said(start);
          // its own range, from what it keeps to the most it can reach: dollars, whatever the Safe holds
          const r = rangeOf(now, x.place, HOME_PROOF);
          return (
            // the audit's S1 (7 Nov): Private sits inside the Safe's figure, so its row is set in under the Safe's (is-part): the rows
            // that stand at the edge add up to the headline
            <div className={`wl-mv-row wl-mv-${x.place}${x.place === "private" ? " is-part" : ""}${wallet === x.place ? " is-focus" : ""}`} key={x.place} data-testid={`move-${x.place}`}>
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
                  {x.place === "private" && <span className="wl-mv-now" data-testid="move-private-of">{privateOfLine()}</span>}
                </span>
                {running || x.place === "safe" || x.place === "private"
                  ? <span className="wl-mv-usd" aria-label={`After ${usdShort(shown)}`}>{usdShort(shown)}</span>
                  : <input className="wl-mv-usd wl-mv-type" inputMode="decimal" autoComplete="off" enterKeyHint="done" disabled={busy || r.still}
                      aria-label={MOVE_WORDS.typed(WHERE[x.place])} data-testid={`move-type-${x.place}`}
                      value={typing?.place === x.place ? typingShown(typing.text) : usdShort(v)}
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
              {!running && !hint && x.place === "private" && privGets && <p className="zf-small wl-mv-hint" data-testid="move-private-gets">{privGets}</p>}
              {/* under $2 to spare: said plainly, never a slider that looks stuck (UI's mainnet rehearsal, 3 Nov) */}
              {!running && !hint && leftoverLine(x) && <p className="zf-small wl-mv-hint" data-testid={`move-leftover-${x.place}`}>{leftoverLine(x)}</p>}
            </div>
          );
        })}
        {outside && (
          <div className="wl-mv-row wl-mv-outside" data-testid="move-outside">
            <div className="wl-mv-row__h">
              {/* no mark and no slider: nothing here moves */}
              <span aria-hidden="true" />
              <span className="wl-mv-name">
                <span className="t">{OUTSIDE_WORDS.title}</span>
                <span className="wl-mv-now">{OUTSIDE_WORDS.line(outside.names)}</span>
              </span>
              <span className="wl-mv-outside__usd">{usdShort(outside.usd)}</span>
            </div>
          </div>
        )}
      </div>
      {/* before the tap the floor's summary says the plan, and one line what else it moves (alsoMoved): no leg rows (copy review, 83 on
          T-B: "Safe → Robinhood $222" said it again, with an arrow glyph). While it runs, each leg's row says where it is */}
      {running && (
        <ul className="zf-group wl-mv-legs" aria-label="What moves">
          {pays.legs.map((leg) => ({ leg, state: running ? runFor(leg) : "planned" as const, ...(running ? { note: runs.find((r) => r.leg.from === leg.from && r.leg.to === leg.to)?.note } : {}) })).map((r) => (
            <li key={`${r.leg.from}-${r.leg.to}`} className={`wl-mv-leg is-${r.state}`} data-testid={`leg-${r.leg.from}-${r.leg.to}`} style={{ ["--t" as string]: `${legTime(r.leg, fillsFirst)}s` } as CSSProperties} aria-label={legLine(r.leg)}>
              <span className="wl-mv-leg__fill" aria-hidden="true" />
              <span className="wl-mv-leg__t">{`${PLACE_NAME[r.leg.from]} to ${PLACE_NAME[r.leg.to]}`}</span>
              <span className="wl-mv-leg__v">{usdShort(r.leg.usd)}</span>
              <span className="zf-small wl-mv-leg__s">{r.state === "done" ? "Done" : r.state === "stopped" ? "Stopped" : r.state === "moving" ? "On its way" : ""}</span>
              {"note" in r && r.note && <span className="zf-small wl-mv-leg__note">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {also && <p className="zf-small wl-mv-foot" data-testid="move-also">{also}</p>}
      {/* what arrives, only for a move that can go: one under its least says the least instead */}
      {/* what leaves, the least that arrives, the most the fees can be and the time: one grouped block (product decision, 3 Nov:
          "text floats with no clear lines of separation"); its sentence (costLine) is what a screen reader hears */}
      {!running && !block && !cantGo && cost && costed && (
        <dl className="zf-group wl-mv-sum" data-testid="move-least" aria-label={cost}>
          {floorRows.map((r) => <div key={r.label} className="zf-group__row"><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
        </dl>
      )}
      {/* one note at a time, the most important (the copy review's walk, 5 Nov: they stacked): no way back, the fill, then hints */}
      {foot && <p className="zf-small wl-mv-foot" data-testid={foot.kind}>{foot.text}</p>}
      </div>
      <div className="wl-swap2__floor">
      {running
        ? <>
            {/* the legs are on their way: a service's line still says itself over Done (rule 9) */}
            {(line ?? services.line ?? p.slowLine) && <div className="wl-swap2__line" data-testid="move-line"><SheetLine text={line ?? services.line ?? p.slowLine ?? null} /></div>}
            <button className="zf-btn wl-sheet-go" onClick={close}>{MOVE_WORDS.done}</button>
          </>
        : <>
            {/* line 1, one slot: a refusal while it stands, why it can't go, a line it was told, else the privacy link */}
            <div className="wl-swap2__line" data-testid="move-line">
              {on.line === "stopped" && <p className="zf-small" role="alert" data-testid="move-stopped">{on.text}</p>}
              {on.line === "why" && <p className="zf-small" role="status" data-testid="move-why">{on.text}{short && <> <button type="button" className="zf-chip" data-testid="move-leave" onClick={leave}>{MOVE_WORDS.leave(PLACE_NAME[leavePlace(short)])}</button></>}</p>}
              {on.line === "said" && <SheetLine text={on.text} />}
              {on.line === "who" && <button type="button" className="zf-link wl-swap2__who wl-mv2__who" onClick={() => setWho(true)} data-testid="move-who">{MOVE_WORDS.who}</button>}
            </div>
            {/* the fee block, right above the button; a refusal never takes its place. The plan's one summary line first (moveSummary),
                then who keeps the fee (moveFee); the fee's figure is the plan's Fees row, said once (the UI reviewer, 6 Nov) */}
            <div className="zf-fee">{summary && <p className="zf-small" data-testid="move-summary">{summary}</p>}<p className="zf-small" data-testid="move-paid">{fee.kept}</p></div>
            {/* one button: under a refusal it reads its step (moveFloor); Try again is this Move again, its legs' keys the same */}
            <button className={`zf-btn wl-sheet-go${busy ? " is-busy" : ""}`} aria-busy={busy || undefined} disabled={busy || on.off} data-testid="move-go"
              onClick={() => { if (on.tap === "again" || on.tap === "go") return void go(); setLine(null); if (on.tap === "less") lessen(); }}>{busy ? MOVE_WORDS.moving : on.label}</button>
          </>}
      </div>
      </div>
    </MoneySheet>
    {who && <MoneySheet title={MOVE_WORDS.who} onClose={() => setWho(false)}><p className="zf-body wl-sheet-lead" data-testid="move-private">{MOVE_WORDS.privately}</p></MoneySheet>}
  </>);
}
