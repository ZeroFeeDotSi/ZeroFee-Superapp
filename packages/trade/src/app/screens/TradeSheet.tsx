// Buy and Sell (D136: V1's trade page, rebuilt in the superapp's look): the whole screen (D135), the coin in its own
// light, one big amount, what you get, the wallet it pays from (D129: your SOL wallet, never "Trading"), 25 % · 50 % ·
// Max, the keypad, and one button. The tap turns the page into the trade itself (Moment.tsx): it lifts, a clock counts,
// and on landing it says how long it took. Presets are the one-tap path; the keypad types a custom figure. The quote is
// prepared again on every change (after a short pause) and every 8 s, so the swap is already built and checked when the
// pill wakes: the tap only signs and sends. A press before that is kept and goes the moment the quote for that same amount
// is checked (V1). Three rows say what matters; "Details" has the rest. A fill is felt and heard (feedback.ts: a success
// tap and a soft ting, a step lower for a sell, with Trade sounds on), a refusal is a warning tap, each keypad press a light one.
import { useEffect, useMemo, useRef, useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive, padBase } from "@zerofee/design/keypad.ts";
import { chipAt } from "@zerofee/design/money-entry.ts";
import "@zerofee/design/moneyentry.css";
import { Mark } from "@zerofee/design/Mark.tsx";
import { MoneySheet } from "@zerofee/design/MoneySheet.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ProblemError, type NextStep, type Problem } from "@zerofee/core/problem";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { CoinDetail } from "../../market/types.ts";
import { DEFAULT_POLICY, instantUsd } from "../../float.ts";
import { buyRoomUsd, emptyWallet } from "../buy-room.ts";
import { gasAfterBuy } from "../gas-after.ts";
import { landedDetail, whenCosted } from "../landed-detail.ts";
import { CHAINS, type TradeRecord } from "../../service.ts";
import type { Amount, Prepared, Side } from "../../types.ts";
import { amount as fmtAmount, change, keptLine, usd } from "../format.ts";
import { saleNetUsd, tradeUsd } from "../../trade-usd.ts";
import { heldAfter, heldNetOf, marketGapLine } from "../held-net.ts";
import { buyCostLine } from "../receipt-words.ts";
import { markIfUnsellable } from "../not-for-sale.ts";
import { buyPresets, canTap, intentOf, queuedGoes } from "../intent.ts";
import { createFeedback } from "../feedback.ts";
import { followRecord, recordOf, UNCONFIRMED } from "../unconfirmed-follow.ts";
import { followTurn, turnTask, type Turn } from "../trade-turn.ts";
import { landedSaid, whenBooked } from "../fill-words.ts";
import { epochOf, tradeMs } from "../../tap-time.ts";
import { useOnline } from "../online.ts";
import { useFloat, useLive, useTrade } from "../runtime.tsx";
import { addWords, ShortChain, shortWay } from "./ShortChain.tsx";
import { shortChain } from "../boards.ts";
import { secsText, TradeMoment, type MomentPhase } from "./Moment.tsx";
import { tapBurst } from "@zerofee/design/tap.ts";
import "./sheet.css";
import "./buy-check.css";
import { useQuickBuy } from "./quick-buy.ts";
import { ASK_LIMIT_MS, QUEUED_LIMIT_MS, boughtRaw, buttonWords, buyButtonLabel, buyLabel, createAsks, createOneTap, openAmount, quoteDelayMs, withCommas, withinMs } from "./buy-button.ts";
import { tradeProblems } from "../../trade-problems.ts";
import { coinGlow } from "../glow.ts";
import { useSwitchedLine } from "../../near/switched.ts";
import { getLine, paidLine, saleLine } from "../paid.ts";
import { WALLET_NAME } from "@zerofee/core/spending";

const SELL_PRESETS = ["25", "50", "100"];
/** A buy's dollar chips (the approved mockup: $5 · $25 · $50 · Max). */
const BUY_CHIPS = ["5", "25", "50"];
/** The chain's own coin, as the bundled logos name it (trusted keys). */
const NATIVE_ICON = { sol: "sol", bsc: "bsc", hood: "hood", near: "near" } as const;
/** How long the landed moment stays before the page goes (V1: 1.7 s). */
const LANDED_MS = 1_600;
/** A page another app filled in takes no tap for this long after it shows. */
export const FILLED_GRACE_MS = 700;
const REFRESH_MS = 8_000;
/** The fee a sale with no gas gets from Trading: clear of the core's $2 floor for a move (a move's dollars are re-priced in
 *  the chain's coin, so exactly $2 can come out a hair under), and more than any one sale's fee. */
const GAS_USD = 2.5;


/** A Buy sheet opens on no amount (Finding 37: never the last buy's or $25, one tap from buying it). `onOpen`: a
 *  problem said in the sheet whose step is one of Trade's own screens ("fund") goes straight there, not via a second screen;
 *  it is handed the amount on the sheet, so a Top up from here comes back to it (UX walk 2 Nov). `start`: the amount to
 *  open at (that Buy sheet, again). */
/** `filledBy`: the line saying another app filled this page in (trade-ask.ts ASK_LINE): shown until the person changes it. */
/** `onSwitch`: the landed buy's Sell (the coin's Sell page, in place of this one). `onDone` is told when the trade lands;
 *  the page stays as its receipt until Close (review 12). */
export function TradeSheet({ side, coin, start, filledBy, onBusy, onSwitch, onClose, onDone, onProblem, onOpen }: { side: Side; coin: CoinDetail; start?: string; filledBy?: string; onBusy?: (busy: boolean) => void; onSwitch?: (side: Side) => void; onClose: () => void; onDone: (r: TradeRecord, value: string) => void; onProblem: (p: Problem) => Promise<NextStep>; onOpen?: (screen: string, value: string) => boolean }) {
  const { svc, active } = useTrade();
  const { bridge, tasks, endProblem } = useShell();
  const feel = useMemo(() => createFeedback(bridge), [bridge]);
  const online = useOnline();
  // the Quick buy amount from Settings, the one the row's Buy chip buys with: a buy opens on it, its chip lit (product decision, 5 Nov)
  const quick = useQuickBuy(bridge);
  const [value, setValue] = useState(openAmount(side, start, quick));
  // NEAR's trades on NEAR's public servers while ZeroFee's server isn't answering (doors.ts onSwitch): one calm line
  const switched = useSwitchedLine();
  const [keypad, setKeypad] = useState(false);
  // Finding 37: an amount the person didn't type (the page's start, a chip, the smaller buy) is replaced by the first key
  // ("1" after $25 is $1, not $251); keys after it add to what was typed
  const [fresh, setFresh] = useState(true);
  // the pad is always there (V1); a tap on the amount means the next key starts a new figure
  const openKeypad = () => { setKeypad(true); setFresh(true); };
  const [details, setDetails] = useState(false);
  /** Bumped by a key the amount can't take: the figure shakes once (rebrand §2.2). */
  const [refused, setRefused] = useState(0);
  // `for`: the intent (side and amount) this quote was asked for; only one for the intent on screen is ever signed
  const [quote, setQuote] = useState<{ p?: Prepared; for?: string; problem?: Problem; checked?: boolean }>({});
  const [busy, setBusy] = useState(false);
  /** "Ready NEAR for trading" (near/problems.ts rheaReady, the person's one tap): running, and the quote asked again after. */
  const [readying, setReadying] = useState(false);
  const [readied, setReadied] = useState(0);
  const readyNear = async () => {
    if (readying) return;
    setReadying(true);
    try {
      // the core moves the NEAR coin wallet's NEAR into its own account on Rhea (core near-rhea.ts), then trades are one call
      const r = await bridge.call("subwallet.near.rheaAdd", { amount: "all" });
      if ("problem" in r) throw new ProblemError(r.problem);
      setReadied((n) => n + 1);
    } catch {
      const { nearProblems } = await import("../../near/problems.ts");
      setQuote({ problem: nearProblems.rheaReadyFailed() });
    } finally { setReadying(false); }
  };
  /** The quote asks in order (createAsks): the 8 s refresh never drops one still on its way. */
  const asks = useRef(createAsks());
  const symbol = coin.symbol ?? "this coin";
  const wallet = useLive(() => svc.wallets().then((ws) => ws.find((w) => w.chain === coin.chain)), [coin.chain]);
  const pos = useLive(() => svc.positions().then((ps) => ps.find((p) => p.chain === coin.chain && p.coin === coin.address)), [coin.chain, coin.address]);
  const amt: Amount = side === "buy" ? { usd: Number(value) } : Number(value) >= 100 ? { fraction: 1 } : { fraction: Number(value) / 100 };

  // the chain's wallets as the one balance sees them (S4), and what's ready there: when it changes, the quote is asked again
  const { view: floatView, snap: floatSnap } = useFloat();
  // while this sheet is open the planner pulls nothing back from its chain (re-walk, 10.3)
  // NEAR coins trade inside Spending itself (TN2): no chain wallet for the planner to keep or fill
  const fc = coin.chain === "near" ? undefined : coin.chain;
  useEffect(() => (fc ? floatView.keep(fc) : undefined), [floatView, fc]);
  const chainView = floatSnap.chains.find((x) => x.chain === coin.chain);
  const chainReady = chainView?.readyUsd ?? 0;
  const intent = intentOf(side, value);
  // what the quote is for: only a new amount, side or coin throws the quote on screen away (money landing on the chain asks
  // again but keeps the checked pill until the new answer replaces it)
  const askedFor = useRef("");
  /** The next change isn't a key typed: quote it at once (opening the page, a chip, money landing). Only the keypad waits a
   *  beat for the next key (UX audit 4 Nov: the page's first quote waited 250 ms for nothing). */
  const instant = useRef(true);
  useEffect(() => {
    const key = `${side}|${value}|${coin.chain}|${coin.address}`;
    if (askedFor.current !== key) { askedFor.current = key; setQuote({}); }    // a new amount or side: the old quote is gone at once, never signed
    if (!active) return;                                                       // swiped to another app: quoting pauses
    if (!isPositive(value)) return;
    const asked = intentOf(side, value);
    // QA's re-test: each ask is answered within ASK_LIMIT_MS (or says why), and the 8 s refresh skips while
    // one is on its way, so a slow coin's quote still lands instead of being dropped by the next refresh
    const ask = async (refresh: boolean) => {
      const n = asks.current.begin(refresh);
      if (n === null) return;
      const live = () => asks.current.live(n);
      try {
        await withinMs(ASK_LIMIT_MS, (async () => {
          const p = await svc.quote(side, coin.chain, coin.address, amt);
          if (!live()) return;
          setQuote((q) => ({ p, for: asked, checked: q.p?.key === p.key && q.checked }));
          await p.ready();
          if (live()) setQuote({ p, for: asked, checked: true });
        })(), () => new ProblemError(tradeProblems.networkDown(CHAINS[coin.chain].name)));
      } catch (e) {
        if (live()) setQuote({ problem: e instanceof ProblemError ? e.problem : undefined });
      } finally {
        asks.current.end(n);
      }
    };
    // a chip is one deliberate tap: its quote is asked at once; typing waits a beat for the next key (D145, speed worker)
    const first = setTimeout(() => void ask(false), quoteDelayMs(instant.current));
    instant.current = true;
    const again = setInterval(() => void ask(true), REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(again); };
  }, [value, side, coin.chain, coin.address, svc, active, Math.floor(chainReady), readied]);

  // a coin the quote refused for it can't be sold says "Not for sale" on its list rows from now on (the audit's note)
  useEffect(() => markIfUnsellable(quote.problem?.code, coin.chain, coin.address), [quote.problem?.code, coin.chain, coin.address]);
  const [gasAsked, setGasAsked] = useState(false);
  // a press kept for the intent it was made for (the quote not ready yet, or a sale's fee still on its way)
  const [queued, setQueued] = useState<string | null>(null);
  const [gasFailed, setGasFailed] = useState(false);
  // the moment (Moment.tsx): the page becomes the trade from the tap (D143: the core asks nothing, no Face ID), and the
  // real time from the tap to the chain is measured here, where the person's finger was
  // `got`: the coins ("7,505"); `usd`: the dollars from the signed quote, the chain's own figure once read (Receipt.tsx)
  const [moment, setMoment] = useState<{ phase: MomentPhase; at: number; ms?: number; got: string; usd?: string; feeTaken?: boolean; feeUsd?: string; tx?: { chain: string; hash: string }; cost?: string | null; about?: boolean;
    /** the audit's T5: what is held after it, read once the trade has booked (undefined until then: no "You now hold"; null: nothing) */
    held?: { raw: string; decimals: number } | null } | null>(null);
  // T2-4 (the copy review's walk): the receipt's holding figure is what selling all of it gets now, by the Sell sheet's own function
  // (trade-usd.ts heldNetUsd), from one sale quote for exactly the coins held. Until it answers, or if it can't, the line
  // shows the coins only: the market price times the coins (pos.valueUsd) is not what a sale gets, so it is never shown here
  const [heldNet, setHeldNet] = useState<{ raw: string; usd: number } | null>(null);
  const done = moment?.phase === "done", heldRaw = moment?.held?.raw;
  useEffect(() => {
    if (!done || !heldRaw || BigInt(heldRaw) <= 0n) return;
    let live = true;
    // the audit's MUST: a figure only (held-net.ts): the prepared sale is never readied, signed, sent or booked, and is dropped there
    void heldNetOf(svc.quote, coin.chain, coin.address, heldRaw).then((net) => {
      if (live && net !== undefined) setHeldNet({ raw: heldRaw, usd: net });
    }, () => undefined);
    return () => { live = false; };
  }, [done, heldRaw, coin.chain, coin.address, svc]);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  // QA QA's SHOULD (8 Nov): a buy's receipt names, once, what lies between what it paid and its coins' worth: its own
  // quote's gap over the market price and the network fee it paid (the chain's booked figure, else its quote's)
  const costOf = (r: TradeRecord): string | null => (r.kind === "buy" ? buyCostLine(r.quote, r.costs?.feeUsd ?? r.quote?.feeUsd) : null);
  // the receipt's figures, read from the quote at the moment it lands (set below, where the quote is read)
  let heroOf = (): string => "";
  let coinsOf = (_fill?: TradeRecord["fill"]): string => "";
  // the audit's T1: the landed receipt's figures, "about" the quote's until the chain's read books the trade, then redrawn
  // with the read figures (fill-words.ts), only while this page is up and still that trade's receipt
  // the audit's T5: what is held is read only now, from the booked book (a sale of all holds nothing); the page's own read too
  const booked = (at: number, said: { hero: string; sold: string }, soldAll: boolean) => (r: TradeRecord) => {
    if (!alive.current) return;
    const same = (m: typeof moment) => !!m && m.phase === "done" && m.at === at;
    setMoment((m) => (same(m) ? { ...m!, ...landedSaid(r, said) } : m));
    pos.reload();
    void svc.positions().then((ps) => {
      const p = ps.find((x) => x.chain === coin.chain && x.coin === coin.address);
      if (alive.current) setMoment((m) => (same(m) ? { ...m!, held: heldAfter(soldAll, p) } : m));
    }, () => undefined);
  };
  // the asked trade is "on its way" until the page goes: through the landed moment too, so a newer ask can't end it
  // as not gone in the 1.6 s between landing and onDone (re-review M1)
  useEffect(() => { onBusy?.(busy || moment?.phase === "done" || moment?.phase === "checking"); }, [busy, moment?.phase]);
  useEffect(() => () => clearTimeout(leave.current), []);
  // QA and the audit's MUST (7 Nov): while the "not confirmed yet" card is on screen and Trade is, the service looks at
  // the trade again every RECHECK_MS (history reads only); closing the card, leaving Trade or the background stops it
  const [watching, setWatching] = useState(false);
  useEffect(() => (watching && active ? svc.watch() : undefined), [watching, active, svc]);
  // a trade still not confirmed when its card closed: its task is followed until it ends, or this page goes
  const following = useRef<(() => void) | null>(null);
  useEffect(() => () => { following.current?.(); following.current = null; }, []);
  // T2 (the audit's Trade audit): a turn after "done" redraws the receipt only while this page is up (the task's follow outlives it)
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // one tap, one trade: taken before any await, never React state (a second click lands before the next render)
  const oneTap = useRef(createOneTap()).current;
  const tap = async () => {
    if (!canTap(quote, intent, busy) || !quote.p || !oneTap.take()) return;
    setBusy(true);
    const at = tapAt.current || performance.now();
    const got = coinsOf();
    const soldAll = side === "sell" && Number(value) >= 100;   // amt's own rule: 100 % is all of it
    setMoment({ phase: "sending", at, got });
    // D144: the trade in the Activity centre, with its live steps (tap → landed → in the wallet), from the tap
    const taskId = `trade-${Date.now()}`;
    const taskAt = Date.now();
    tasks?.publish({ id: taskId, title: label2, open: { route: `coin:${coin.chain}:${coin.address}:${symbol}` },
      steps: [{ label: "Sent", state: "doing", at: taskAt }, { label: "Landed", state: "waiting" }, { label: side === "buy" ? `In ${walletName}` : `Back in ${walletName}`, state: "waiting" }] });
    const taskEnd = (state: "failed" | "stopped", detail?: string) => tasks?.end(taskId, state, detail);
    const walletStep = side === "buy" ? `In ${walletName}` : `Back in ${walletName}`;
    // T2 (the audit's Trade audit, 8 Nov): a trade done on one node's word can still turn (two nodes say failed or expired, Ref
    // kept the coin, its final amount unproven): the open receipt says the turn (trade-turn.ts), the task is rewritten
    const turnedTo = (r: TradeRecord, t: Turn) => {
      if (!alive.current) return;
      if (t.moment === "refused") setMoment({ phase: "refused", at, got, feeTaken: t.feeTaken, ...(t.feeTaken && r.costs?.feeUsd !== undefined ? { feeUsd: usd(r.costs.feeUsd) } : {}) });
      else if (t.moment === "checking") setMoment({ phase: "checking", at, got });
      else { setMoment(null); if (r.problem) void onProblem(r.problem); }
      feel.failed();
    };
    let turned = false;
    try {
      const rec = await svc.trade(quote.p, undefined, { task: taskId, tapAt: epochOf(at) });
      if (rec.status === "done") {
        const landed = Date.now(), ms = tradeMs(rec, at);   // the audit's T4: the record's time, from the press
        tasks?.update(taskId, {
          detail: landedDetail(secsText(ms), rec, c.name),
          proof: (rec.hashes ?? []).map((hash) => ({ chain: coin.chain, hash })), steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "done", at: landed }, { label: side === "buy" ? `In ${walletName}` : `Back in ${walletName}`, state: "doing", at: landed }] });
        // the title stays the ask; the chain's figure joins the detail once the second node's check books it (the crawl, 4 Nov)
        whenCosted(svc.on, rec, () => void tasks?.update(taskId, { detail: landedDetail(secsText(ms), rec, c.name) }));
        // T2: followed by its id until its check clears; a turn rewrites the task's end and the open receipt
        followTurn(svc, rec.id, (r, t) => { turned = true; turnTask(tasks, taskId, t, { taskAt, wallet: walletStep }); turnedTo(r, t); });
        // the second node's check books it a moment later; the task ends once the page has read the wallet again
        setTimeout(() => { if (turned) return; tasks?.update(taskId, { steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "done", at: landed }, { label: side === "buy" ? `In ${walletName}` : `Back in ${walletName}`, state: "done", at: Date.now() }] }); tasks?.end(taskId, "done"); }, LANDED_MS);
        void feel.filled(side);
        // the time from the tap to the chain (D143: nothing asks in between)
        // the receipt's figure is the chain's once it is read (a buy's every cent out, a sale's every cent in)
        // its proof on the receipt: the short tx id, Copy and View (webd-money2 crawl, 4 Nov: no tx id on Bought / Sold)
        const last = rec.hashes?.[rec.hashes.length - 1];
        const said = { hero: heroOf(), sold: coinsOf() };
        setMoment({ phase: "done", at, ...landedSaid(rec, said), ms, ...(last ? { tx: { chain: coin.chain, hash: last } } : {}), cost: costOf(rec) });
        whenBooked(svc, rec.id, booked(at, said, soldAll));
        // told at once (the record, the ask, the next open's amount); the page stays as the receipt (review 12)
        onDone(rec, value);
        pos.reload();
        leave.current = setTimeout(() => pos.reload(), LANDED_MS);
        return;
      }
      // the person's own no: the page again, no receipt. The chain's answer lost after the send: "Still checking", never a
      // refusal (QA). The chain, or the core, said no: the refused receipt ("Nothing left your wallet.")
      // a refusal the chain made after landing (status "failed" with a hash sent) took its network fee; an expired send or a
      // refusal before signing took nothing (QA, 5 Nov)
      const feeTaken = rec.status === "failed" && rec.hashes.length > 0;
      setMoment(rec.status === "declined" ? null : rec.status === "unconfirmed" ? { phase: "checking", at, got } : { phase: "refused", at, got, feeTaken, ...(feeTaken && rec.costs?.feeUsd !== undefined ? { feeUsd: usd(rec.costs.feeUsd) } : {}) });
      taskEnd(rec.status === "declined" ? "stopped" : "failed", rec.status === "declined" ? "You said no. Nothing moved." : rec.problem?.whatHappened);
      if (rec.status !== "declined" && rec.status !== "unconfirmed") feel.failed();   // a "no" the person said is no failure
    } catch (e) {
      // a trade the core refused shows the core's Problem, named; nothing was sent
      setMoment(null);
      // a trade sent that no read can place yet (it may still land): never a failed task or buzz; its card ends the moment
      // the chain answers (the service's live re-check): landed is the normal done, a proven expiry its own card
      if (e instanceof ProblemError && e.problem.code === UNCONFIRMED) {
        const p = e.problem, rec = await recordOf(svc, p);
        const wallet = side === "buy" ? `In ${walletName}` : `Back in ${walletName}`;
        tasks?.update(taskId, { detail: "Not confirmed yet", steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "doing" }, { label: wallet, state: "waiting" }] });
        let ended: TradeRecord | undefined, now: Problem = p;
        const taskOf = (r: TradeRecord) => {
          if (r.status === "done") { const t = Date.now(); tasks?.update(taskId, { detail: "Landed", steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "done", at: t }, { label: wallet, state: "done", at: t }] }); tasks?.end(taskId, "done"); followTurn(svc, r.id, (r2, tt) => { turnTask(tasks, taskId, tt, { taskAt, wallet }); turnedTo(r2, tt); }); }
          else taskEnd("failed", r.problem?.whatHappened);
        };
        // its words changed (the live look stopped after an hour): the card is shown again with them
        const stop = rec ? followRecord(svc, rec.id, (r) => { ended = r; taskOf(r); endProblem?.(now); }, (r) => { const was = now; now = r.problem!; endProblem?.(was); }) : () => {};
        setWatching(true);
        await onProblem(p);
        while (!ended && now !== p && now.code === UNCONFIRMED) { const shown = now; await onProblem(shown); if (now === shown) break; }
        setWatching(false);
        if (!ended) { following.current?.(); following.current = stop; return; }
        const r = ended as TradeRecord;
        if (r.status === "done") {
          void feel.filled(side);
          const said = { hero: heroOf(), sold: coinsOf() };
          setMoment({ phase: "done", at, ...landedSaid(r, said), ...(r.hashes.at(-1) ? { tx: { chain: coin.chain, hash: r.hashes.at(-1)! } } : {}), cost: costOf(r) });
          whenBooked(svc, r.id, booked(at, said, soldAll));
          onDone(r, value);
          pos.reload();
          return;
        }
        feel.failed();
        if (r.problem) await onProblem(r.problem);
        return;
      }
      taskEnd("failed", e instanceof ProblemError ? e.problem.whatHappened : "It didn't go through. Nothing moved.");
      feel.failed();
      const next = e instanceof ProblemError ? await onProblem(e.problem) : undefined;
      if (next?.kind === "fix-input") { setFresh(true); setKeypad(true); }
    } finally { setBusy(false); oneTap.done(); }
  };

  const q = quote.p?.quote;
  const c = CHAINS[coin.chain];
  const getText = q ? (side === "buy" ? `about ${fmtAmount(q.getRaw, q.decimals)} ${symbol}` : `about ${fmtAmount(q.getRaw, c.decimals)} ${c.symbol}`) : "";
  const minText = q ? (side === "buy" ? `${fmtAmount(q.getMinRaw, q.decimals)} ${symbol}` : `${fmtAmount(q.getMinRaw, c.decimals)} ${c.symbol}`) : "";
  const share = side === "sell" ? Math.min(1, Number(value) / 100) : 1;
  const partCost = pos.value ? pos.value.costUsd * share : undefined;
  const label = side === "buy" ? buyLabel(value, symbol) : share >= 1 ? `Sell all of my ${symbol}` : share === 0.5 ? `Sell half of my ${symbol}` : `Sell ${value}% of my ${symbol}`;
  // one balance (product decision, 27 Oct): a buy bigger than what's on this chain offers what's there, at once, instead of a fund step
  // (S4) the chain's wallets as the one balance sees them: what's ready now, what's on its way, "Move more to Solana"
  // the float hasn't answered yet: an empty chain may just not be read yet, so never "Trading is empty" until it has
  // …nor while money for this chain is waiting its turn or on its way there
  const landing = floatSnap.moves.some((m) => (m.kind === "out" && m.chain === coin.chain && (m.status === "waiting" || m.status === "moving")) || (m.kind === "add" && m.status === "moving"));
  // …nor once money has landed but the quote on screen is still the one from before it (the next one comes at once)
  const stale = !!chainView && chainView.readyUsd >= (Number(value) || 0);
  // gas inside the confirm: a sale whose
  // wallet can't pay its network fee gets the fee from Trading as step one, said in one line, and the sale goes by itself
  // the moment the fee has landed (the person's tap is kept; no second tap, no error)
  const feeShort = /^trade\.(sol\.low|wallet\.empty)$/.test(quote.problem?.code ?? "");
  const needsGas = side === "sell" && feeShort && floatSnap.reserveUsd >= GAS_USD && !gasFailed;
  // (any other problem once the fee is asked shows as itself, never behind "Getting the fee ready")
  const gasComing = needsGas || (side === "sell" && gasAsked && !gasFailed && !quote.p && (!quote.problem || feeShort));
  const gettingReady = side === "buy" && (!floatSnap.loaded || landing || stale) && /^trade\.(sol\.low|wallet\.empty)$/.test(quote.problem?.code ?? "");
  const ready = chainView ? buyRoomUsd(chainView) : side === "buy" && wallet.value ? instantUsd({ onChain: { [coin.chain]: wallet.value.nativeUsd }, floatUsd: 0 }, DEFAULT_POLICY, coin.chain) : 0;
  const short = side === "buy" && !!chainView && /^trade\.(sol\.low|wallet\.empty)$/.test(quote.problem?.code ?? "") && Number(value) > ready;
  // T2-5 (the copy review's walk): the smaller buy is all it can spend, with cents like every Buy button ("Buy $144.06 instead"; was
  // whole dollars, "$144"), the same figure as Max and the sheet's "to spend"
  const shortBuyNow = short && chainView && shortChain({ ...chainView, readyUsd: ready }, Number(value)).buyNow !== undefined ? Math.floor(ready * 100) / 100 : undefined;
  // and the one way on when nothing spare can move: the floor's quiet second button (ShortChain.shortWay)
  const shortAdd = short && !!fc && !!chainView && shortWay(chainView, Number(value), floatSnap.reserveUsd) === "add";

  // step one of a sale with no gas: the fee goes from Trading to this chain's wallet, once
  useEffect(() => {
    if (!needsGas || gasAsked) return;
    setGasAsked(true);
    // a move the core refused (or that came back): the sale's own problem shows, with its way on (Add to Trading)
    // to the wallet the sale signs from (an older one may hold the coin), not just the chain's current one
    void svc.sellerWallet(coin.chain, coin.address).catch(() => undefined).then((wallet) => (fc ? floatView.moveNow(fc, GAS_USD, { ...(wallet ? { wallet } : {}), why: "gas" }) : Promise.reject(new Error("no chain wallet"))))
      .then((r) => { if (r.status === "failed" || r.status === "refunded") setGasFailed(true); }, () => setGasFailed(true));
  }, [needsGas, gasAsked]);
  // …and the sale the person already tapped goes the moment a checked quote is there
  useEffect(() => { if (online && queuedGoes(queued, quote, intent, busy)) { setQueued(null); void tap(); } }, [queued, quote.p?.key, quote.checked, quote.for, intent, busy, online]);
  // a kept press is for its amount only: another amount drops it; a problem (not the fee on its way) drops it, said in the sheet
  useEffect(() => { if (queued && queued !== intent) setQueued(null); }, [intent, queued]);
  useEffect(() => { if (queued && quote.problem && !gasComing) { setQueued(null); feel.failed(); } }, [quote.problem, gasComing, queued]);
  // a kept press waits at most QUEUED_LIMIT_MS for its check, then is dropped and the sheet says why (QA's
  // re-test: AODF sat on "Buying when it's checked…" for 70 s). The ask goes on; a quote that lands after is ready to tap.
  // A sale waiting for its fee to land (gasComing) has its own wait and its own words.
  useEffect(() => {
    if (!queued || gasComing) return;
    const t = setTimeout(() => {
      setQueued(null);
      feel.failed();
      setQuote((q) => (q.checked ? q : { ...q, problem: tradeProblems.networkDown(CHAINS[coin.chain].name) }));
    }, QUEUED_LIMIT_MS);
    return () => clearTimeout(t);
  }, [queued, gasComing]);
  // the press itself: the pill squishes and its ring bursts (tap.ts), the fill's sound is let go (a phone plays audio only from a touch), and
  // it signs now if the quote is ready, or is kept until it is
  const tapAt = useRef(0);
  // a page another app filled in (review H1): it opened by itself, at a moment the person didn't choose, so a finger
  // already on its way there is never taken: nothing for its first 700 ms, never a press kept for later, only a tap on a
  // checked quote
  const shownAt = useRef(performance.now());
  // …timed from when the person can see it: swiped away while it opened, it starts again on return (re-review L)
  useEffect(() => { if (active) shownAt.current = performance.now(); }, [active]);
  const press = (el?: HTMLElement) => {
    if (filledBy && (performance.now() - shownAt.current < FILLED_GRACE_MS || !canTap(quote, intent, busy))) return;
    tapAt.current = performance.now();
    // the tap is felt at once (tap.ts: the mint ring bursts from the button, a light haptic, the crawl's marks), whether
    // it signs now or is kept until the quote is checked
    if (el) tapBurst(el, () => feel.key());
    feel.arm();
    if (canTap(quote, intent, busy)) void tap(); else if (!busy) setQueued(intent);
  };
  const glow = coinGlow(coin.chain);
  // what the buy can really spend (buy-room.ts: the engine's own keep, never the planner's flat reserve; webd-money2 crawl)
  const walletUsd = side === "buy" ? (chainView ? buyRoomUsd(chainView) : wallet.value?.nativeUsd) : undefined;
  // what the wallet keeps for its network fees, said under the line, so "$198.82 to spend" beside Home's $199.82 adds up
  // (a web test, the copywriter's line)
  const keptUsd = side === "buy" && chainView ? Math.round((chainView.nativeUsd - buyRoomUsd(chainView)) * 100) / 100 : 0;
  const walletName = WALLET_NAME[coin.chain];
  // a buy's wallet with nothing in it is never a dead Buy (the copy review's ruling, 7 Nov): its refusal, and one lit "Add money to it"
  const empty = emptyWallet({ side, loaded: floatSnap.loaded, chain: chainView, landing, walletName });
  const gasAfter = side === "buy" && q && fc && wallet.value ? gasAfterBuy({ chain: fc, nativeUsd: wallet.value.nativeUsd, payUsd: q.payUsd, feeUsd: q.feeUsd, floatUsd: floatSnap.reserveUsd }) : null;
  // the review (TRADE-A-PLUS 13): dollars first, as the approved mockup has them; Max is what the wallet has ready. A sale is
  // a share of what is held (25 % · 50 % · All), said in the quote's own dollars
  const maxUsd = walletUsd !== undefined && walletUsd >= 1 ? String(Math.floor(walletUsd * 100) / 100) : undefined;
  const chips: (readonly [string, string])[] = side === "buy"
    ? [...[...new Set([...BUY_CHIPS, String(quick)])].sort((x, y) => Number(x) - Number(y)).map((v) => [`$${v}`, v] as const), ...(maxUsd ? [["Max", maxUsd] as const] : [])]
    : SELL_PRESETS.map((v) => [v === "100" ? "All" : `${v}%`, v] as const);
  // the hero: a buy's typed dollars; a sale's dollars from its quote (a shimmer until it comes), never a percent
  // a sale's one figure (trade-usd.ts): what comes back, the same on the button, the receipt and Activity (test)
  // T2-4: the one net rule (trade-usd.ts saleNetUsd), the same function the receipt's holding line reads
  const saleFigure = q ? saleNetUsd(q) : 0;
  const big = side === "buy" ? `$${withCommas(value || "0")}` : q ? usd(saleFigure) : "";
  const fs = big.length <= 4 ? 84 : big.length <= 6 ? 70 : big.length <= 8 ? 58 : 46;
  const ready2 = online && canTap(quote, intent, busy) && !quote.problem;
  const checking = !!q && !quote.checked && !busy && online;
  const soldText = side === "sell" && pos.value ? `${fmtAmount(BigInt(pos.value.raw) * BigInt(Math.round(share * 1e6)) / 1_000_000n, pos.value.decimals)} ${symbol}` : "";
  // a dot never leads the line (UI audit 5 Nov): a sale with no holding read yet says "Fee $0.002" alone (paid.ts getLine)
  // T2-4: a sale says its fee once, "Fee $0.002", in the copy review's form (the quote's own network fee, never a figure made up)
  const getWords = q ? (side === "buy" ? getLine(`About ${fmtAmount(q.getRaw, q.decimals)} ${symbol}`, usd(q.feeUsd)) : saleLine(soldText, usd(q.feeUsd))) : { head: "", fee: "" };
  const label2 = side === "sell" && q ? `Sell ${usd(saleFigure)} of ${symbol}` : label;
  const gapLine = q ? marketGapLine(side, q) : null;
  // the moment's figures: dollars first (a buy's pay, a sale's proceeds), then the coins and where (review 12)
  heroOf = () => (q ? usd(side === "buy" ? q.payUsd : saleFigure) : "");
  // what landed (the fill), as Activity and Sell say it; the quote's figure only until the fill is known (re-test)
  coinsOf = (fill) => (q ? (side === "buy" ? fmtAmount(boughtRaw(q.getRaw, fill), q.decimals) : soldText.split(" ")[0] ?? "") : "");
  return (
    <div className="tr-sheet-wrap">
    {/* D135: the whole screen; D129: the wallet is named, never "Trading". While it sends there is no way out; once it
        has landed, the page is the receipt with Close (review 12) */}
    <MoneySheet title={moment ? "" : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`} closable={moment?.phase !== "sending"} onClose={moment?.phase === "sending" ? () => {} : onClose}>
      <div className="tp" style={{ ["--glow" as string]: glow }}>
        {/* the coin's own light: its logo, blurred large behind the top of the page, under the glass header (review 1) */}
        {/* not behind the receipt: its one object is the coin itself, mid-page (the 5 Nov Black walk: a brown smear above it) */}
        {!moment && <div className="tp-glow" aria-hidden="true">{coin.logoUrl && <img src={coin.logoUrl} alt="" />}</div>}
        {moment ? (
          <TradeMoment phase={moment.phase} side={side} symbol={symbol} logo={coin.logoUrl} coinAmount={moment.got} {...(moment.phase === "done" && moment.about ? { about: true } : {})} where={walletName} usd={moment.phase !== "done" && side === "sell" ? `About ${heroOf()}` : moment.usd ?? heroOf()} tapAt={moment.at}
            {...(moment.phase === "done" && moment.tx ? { tx: moment.tx } : {})} {...(moment.feeTaken ? { feeTaken: true } : {})} {...(moment.feeUsd ? { feeUsd: moment.feeUsd } : {})} {...(moment.ms !== undefined ? { landedMs: moment.ms } : {})}
            {...(moment.phase === "done" ? {
              held: moment.held ? { coins: `${fmtAmount(moment.held.raw, moment.held.decimals)} ${symbol}`, ...(heldNet?.raw === moment.held.raw ? { usd: usd(heldNet.usd) } : {}) } : undefined,
              ...(moment.cost ? { cost: moment.cost } : {}),
              // the audit's T5: Sell only once the buy has booked (before, its Sell page would read the book without these coins)
              ...(side === "buy" ? { ...(moment.held !== undefined ? { onSell: () => onSwitch?.("sell") } : {}), onMore: () => { setMoment(null); feel.key(); } } : {}),
            } : moment.phase === "refused" ? { onMore: () => { setMoment(null); feel.key(); } } : {})}
            onDone={onClose} />
        ) : empty ? (<>
          <div className="tp-coin">
            <span className="zf-halo zf-halo--big is-on tp-logo">{coin.logoUrl && <img className="zf-halo__light" src={coin.logoUrl} alt="" />}<CoinIcon symbol={symbol} src={coin.logoUrl} size={56} /></span>
          </div>
          <div className="tr-inline tp-empty" role="alert" data-testid="trade-empty">
            <p className="zf-body">{empty.head}</p>
            <p className="zf-small">{empty.body}</p>
          </div>
          <div className="tp-floor">
            <button className="zf-btn tr-press tp-go" data-ready="1" onClick={() => { feel.key(); onOpen?.("move", value); }}>{empty.add}</button>
          </div>
        </>) : (<>
          {/* the coin is its logo; its name is the title (said once, review 14) */}
          <div className="tp-coin">
            <span className="zf-halo zf-halo--big is-on tp-logo">{coin.logoUrl && <img className="zf-halo__light" src={coin.logoUrl} alt="" />}<CoinIcon symbol={symbol} src={coin.logoUrl} size={56} /></span>
          </div>
          {/* a screen reader hears the amount itself, not only what the button does (break row, 2 Nov) */}
          <button key={`amt-${refused}`} className={`tp-amt${refused ? " zf-me-refuse" : ""}`} onClick={side === "buy" ? openKeypad : undefined} aria-label={side === "buy" ? `Change the amount: ${big}` : `You get ${big || "…"}`} style={{ ["--fs" as string]: `${fs}px` }}>
            {big ? <span className={`tp-amt-n${side === "buy" && !isPositive(value) ? " zero" : ""}`}>{big}</span> : <span className="zf-shimmer tp-amt-sk" />}
          </button>
          {/* the one line under it: what you get (or give) and the fee; a tap opens the rest (review 15) */}
          <button className="tp-get" aria-live="polite" onClick={() => q && setDetails(true)} disabled={!q}>
            {q ? <>{getWords.head}<span className="tp-fee">{getWords.fee}</span><span className="tp-chev" aria-hidden="true" /></>
              : " "}
          </button>
          {/* the audit's SHOULD, the copy review's words: how far the quote is from the market price, one mute line, never called a fee */}
          {gapLine && <p className="zf-small tp-gap" data-testid="trade-quote-gap">{gapLine}</p>}
          {switched && coin.chain === "near" && <p className="zf-small tp-switched" role="status" data-testid="near-switched">{switched}</p>}
          {filledBy && value === (start ?? value) && <p className="tp-filled" role="note"><span className="tp-orb" aria-hidden="true" />{filledBy}</p>}
          <p className="tp-pay">
            <CoinIcon symbol={c.symbol} icon={NATIVE_ICON[coin.chain]} size={16} />
            {side === "buy"
              // what a buy can spend: the wallet less its network-fee reserve (instantUsd), so said as that, never as the
              // wallet's balance (UI, 4 Nov: "$148.22" here beside AgentZero's "$149.22" read as $1 off)
              ? <span>From {walletName} · <b>{walletUsd === undefined ? "…" : usd(walletUsd)}</b> to spend</span>
              : <span>To {walletName}</span>}
          </p>
          {keptUsd >= 0.01 && <p className="zf-small tp-kept" data-testid="trade-kept">{keptLine(usd(keptUsd))}</p>}
          {/* the chips are one track with a thumb that slides to the chosen one (rebrand §2: a real control) */}
          <div className="zf-me__chips tp-chips" role="group" aria-label="Amount" style={{ ["--n" as string]: chips.length, ["--at" as string]: Math.max(0, chipAt(chips.map(([, v]) => v), value)) }} data-none={chipAt(chips.map(([, v]) => v), value) < 0 || undefined}>
            <span className="zf-me__thumb" aria-hidden="true" />
            {chips.map(([l, v]) => <button key={l} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => { feel.key(); setFresh(true); instant.current = true; setValue(v); }}>{l}</button>)}
          </div>
          {gasComing ? (
            <div className="tr-inline"><div className="zf-body tr-getready"><Mark size={18} mode="loading" /> Getting the fee ready…</div><p className="zf-small">The network fee goes to {walletName} first, then it sells.</p></div>
          ) : gettingReady ? (
            <div className="tr-inline"><div className="zf-body tr-getready"><Mark size={18} mode="loading" /> Getting {walletName} ready…</div></div>
          ) : short ? (
            fc && <ShortChain chain={fc} wantUsd={Number(value)} wantText={big} haveUsd={usd(ready)} walletName={walletName} onProblem={onProblem} />
          ) : readying ? (
            <div className="tr-inline"><div className="zf-body tr-getready"><Mark size={18} mode="loading" /> Moving your NEAR to Rhea…</div></div>
          ) : quote.problem ? (
            <div className="tr-inline">
              <p className="zf-body">{quote.problem.whatHappened}</p>
              {quote.problem.more && <p className="zf-small">{quote.problem.more}</p>}
              <button className="zf-link" onClick={() => {
                const p = quote.problem!;
                // near/problems.ts RHEA_READY_SCREEN: the sheet's own step, run here (never Trade's screens)
                if (p.next.kind === "open" && p.next.screen === "near-rhea-ready") { void readyNear(); return; }
                if (p.next.kind === "open" && onOpen?.(p.next.screen, value)) return;
                // "Go back" (an unseen trap coin's refusal, the audit's note): back to where the sheet was opened from
                if (p.next.kind === "nothing") { onClose(); return; }
                void onProblem(p).then((next) => { if (next.kind === "fix-input") { setFresh(true); setKeypad(true); } });
              }}>{quote.problem.next.label}</button>
            </div>
          ) : (
            <>
              {q?.copycat && <p className="zf-small tr-copycat" role="alert">Careful: {q.copycat}. Check the address before you buy.</p>}
              {/* all of a NEAR coin worth under $1 still sells (never stuck), said plainly */}
              {q?.mostlyFees && <p className="zf-small tp-note">Most of this goes on fees.</p>}
              {/* said before the tap (the crawl, 4 Nov: "$2.10 kept for fees on Solana" moved with no word): the gas this buy sets off */}
              {gasAfter !== null && <p className="zf-small tp-note" data-testid="tp-gas-after">{`After this buy, ${usd(gasAfter)} moves from your NEAR wallet to ${walletName} for fees.`}</p>}
            </>
          )}
          {/* the keypad sits on the button, in the thumb's reach; a sale has its three shares and no keypad (review 6, 14) */}
          {side === "buy" && <div className="tp-pad"><Keypad value={padBase(value, fresh)} decimals={2} onRefuse={() => { feel.failed(); setRefused((n) => n + 1); }} onChange={(v) => { feel.key(); setFresh(false); instant.current = false; setValue(v); }} /></div>}
          <div className={`tp-floor${side === "sell" ? " tp-floor--sell" : ""}`}>
            {/* who gets the fee, right above the button (the copy review, 6 Nov): the exchange, the network's figure from the quote */}
            {q && !quote.problem && <div className="zf-fee"><p className="zf-small" data-testid="trade-paid">{paidLine(q, CHAINS[coin.chain].name)}</p></div>}
            {gasComing && (
              <button className="zf-btn tr-press" disabled={queued === intent} onClick={(e) => press(e.currentTarget)}>{queued === intent ? "Selling as soon as the fee lands…" : label2}</button>
            )}
            {!quote.problem && !gasComing && (
              <button className={`zf-btn tr-press tp-go${checking ? " tp-go--checking" : ""}`} disabled={busy || queued === intent || !isPositive(value) || !online} onClick={(e) => press(e.currentTarget)} data-ready={ready2 ? "1" : undefined} aria-busy={checking || undefined}>
                {/* the words stay "Buy $25 of DOPE" while it's checked (UX audit 4 Nov: they flipped twice on every amount);
                    the check is the thin line filling along the button's edge, and a press is kept */}
                {buttonWords({ online, busy, queued: queued === intent, side, label: side === "buy" ? buyButtonLabel(value) : label2 })}
                {checking && <span className="tp-check" aria-hidden="true" />}
              </button>
            )}
            {/* not enough money: the one button is the buy the wallet can pay (UX audit 4 Nov: the button went, and the
                smaller buy was an underlined link) */}
            {short && shortBuyNow !== undefined && (
              <button className="zf-btn tr-press tp-go" onClick={() => { feel.key(); setFresh(true); instant.current = true; setValue(String(shortBuyNow)); }}>{`Buy ${usd(shortBuyNow)} instead`}</button>
            )}
            {/* T2-5: second and quiet, a real 44 px button (was bold text in the page) */}
            {shortAdd && fc && <button className="zf-btn zf-btn--quiet tp-add-quiet" onClick={() => { onOpen?.("move", value); }}>{addWords(fc, walletName)}</button>}
          </div>
        </>)}
      </div>
      {/* the rest, for whoever asks, on a screen of its own (D135) */}
      {details && q && (
        <Sheet title="Details" onClose={() => setDetails(false)}>
          <div className="tr-kvs tr-kvs--sheet">
            <div className="tr-kv"><span>{side === "buy" ? "You get about" : "You get about"}</span><span>{getText.replace(/^about /, "")}</span></div>
            <div className="tr-kv"><span>At least</span><span>{minText}</span></div>
            <div className="tr-kv"><span>Fee</span><span>{usd(q.feeUsd)}</span></div>
            {side === "buy" && <div className="tr-kv"><span>Pays</span><span>{fmtAmount(q.payRaw, c.decimals)} {c.symbol}</span></div>}
            {side === "sell" && partCost !== undefined && <div className="tr-kv"><span>On this part</span><span>{change(q.getUsd - partCost, partCost > 0 ? ((q.getUsd - partCost) / partCost) * 100 : undefined)}</span></div>}
            {q.route && coin.chain !== "near" && <div className="tr-kv"><span>Trades on</span><span>{q.route}</span></div>}
            {q.priceImpactPct !== undefined && <div className="tr-kv"><span>Price impact</span><span>{q.priceImpactPct.toFixed(2)}%</span></div>}
            <div className="tr-kv"><span>Price can move up to</span><span>{(q.slippageBps / 100).toFixed(1)}%</span></div>
          </div>
        </Sheet>
      )}
    </MoneySheet>
    </div>
  );
}
