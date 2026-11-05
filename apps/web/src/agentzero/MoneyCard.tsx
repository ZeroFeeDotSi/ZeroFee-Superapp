// AgentZero does what Home does (product decision, 3 Nov): a send, swap, move, add or request opens Home's OWN sheet, filled in, over
// the chat (useShell().openMoney: Wallet's MoneyHost, the same sheet Home opens). AgentZero never draws a money sheet and
// never signs: the sheet says "AgentZero filled this in", shows the whole address and asks Face ID. When it went, the
// card follows the move through Activity's own read (ledger.activity, as Home's Activity) and says when it landed or why
// it stopped. Loaded with the first such card (never in Home's first load, nor the chat's).
import { useEffect, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { ReceiptMark } from "@zerofee/design/Receipt.tsx";
import type { ReceiptState } from "@zerofee/design/receipt.ts";
import type { MoneyEnd } from "@zerofee/shell-api/money.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { putLine, type HomeAsk } from "@zerofee/agent/chat/home-ask";
import { HOME_PREFILL, SETTLE_MS, endOf, oldSheetLine, type CardWas, followDelay, sharedRead, followLine, hopLine, hopOf, moneyAsk, movesOf, tradeEndLine, type OpenTrade } from "./money-ask.ts";
import type { StepEnd } from "@zerofee/agent/chat/plan";
// D144 (review, 3 Nov: one task per move): Home's and Trade's own sheets publish the move's task in the Activity
// centre once it's approved; AgentZero publishes none for these asks (this card follows the move in the chat)
import { readMoves } from "./az-tasks-live.ts";
import { SIM } from "../mode.ts";

/** Every move a sheet can start, as Home reads them: Activity's (ledger.activity) and the wallet legs (Spending's own
 *  record, spending.activity: a Move's or a Swap's hop on to the SOL or ETH (RH) wallet); az-tasks-live.ts reads them. */
const moves = readMoves;
/** The moves known now (their ids), so a sheet that hands back no id is followed by the moves that are new; null when
 *  Activity didn't answer in time (readMoves' limit): then no move is ever guessed to be this one. */
async function ids(bridge: Bridge): Promise<Set<string> | null> {
  const r = await moves(bridge).catch(() => null);
  return r?.read ? new Set(r.rows.map((m) => m.id)) : null;
}

/** The Sim (D157): sample money lands in a moment, so its card looks every second and calls it landed after a short
 *  settle (the phone's 8 s waits for a real move's next leg). */
const FOLLOW_MS = SIM ? 1_000 : 2_500;
const SETTLE = SIM ? 1_500 : SETTLE_MS;
const FOLLOW_MAX_MS = 15 * 60_000;

/** One Home sheet AgentZero filled in: its line, Open, then what happened, followed to the end. `onEnd`: how it ended,
 *  for a plan's step (the plan moves on only after a landing); `stale`: a newer card took its place (no Open). */
export function MoneyCard({ ask, line, onOpen, onEnd, onCard, stale = false }: { ask: HomeAsk; line: string; onOpen?: (open: boolean) => void; onEnd?: (end: StepEnd) => void; onCard?: (e: { kind: "opened" } | { kind: "ended"; went: boolean; movementId?: string } | { kind: "landed" }) => void; stale?: boolean }) {
  const shell = useShell();
  const { bridge } = shell;
  const [state, setState] = useState<"ask" | "open" | "closed" | "following" | "ended">("ask");
  const [said, setSaid] = useState<string | null>(null);
  // the receipt mark beside the words (the chat flow, 5 Nov): away while the move is followed; landed only when Activity
  // says it landed; refused when it stopped; checking when it went but can't be followed to its end
  const [mark, setMark] = useState<ReceiptState | null>(null);
  const before = useRef<Set<string> | null>(new Set());
  // each Open is its own: a sheet that ended late (after Open again) changes nothing (no-hang, wait.ts)
  const opens = useRef(0);
  const live = useRef(true);
  // set again on every mount (React's dev double mount ran the cleanup once, leaving the card deaf to the sheet's end)
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // each end said once (a plan never moves on twice for one card)
  const ended = useRef(false);
  const told = (e: StepEnd) => {
    if (e.kind === "opened") return onEnd?.(e);
    if (ended.current) return;
    ended.current = e.kind === "landed" || e.kind === "went";
    onEnd?.(e);
  };
  useEffect(() => {
    if (state !== "open") return;
    onOpen?.(true);
    return () => onOpen?.(false);
  }, [state, onOpen]);

  const follow = (id: string | undefined) => {
    setState("following");
    setMark("away");
    // no id from the sheet and no Activity read from before it opened: no move can be told apart as this one, so none is
    // guessed; it went, and Activity shows it (never a follow that stalls on a guess)
    if (!id && !before.current) {
      setSaid("It went. Activity shows it when it lands.");
      setMark("checking");
      told({ kind: "went" });
      return setState("ended");
    }
    const known = before.current ?? new Set<string>();
    const at = Date.now();
    let settled: { at: number; legs: number } | null = null;
    let wait = FOLLOW_MS;
    const look = async (): Promise<void> => {
      if (!live.current) return;
      // never while the page is hidden (the phone locked, another app): it looks again when it's back in sight
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return void setTimeout(() => void look(), wait);
      // one read shared by every card following now; a failed read backs off (followDelay)
      const { rows, legsRead, read } = await sharedRead(bridge, () => moves(bridge), FOLLOW_MS - 100).catch(() => ({ rows: [], legsRead: false, read: false }));
      wait = followDelay(wait, read, FOLLOW_MS);
      // by its id when the sheet gave one, and every wallet leg new since it opened (a Move's hop on to the wallet)
      const { m, legs } = id ? movesOf([...rows.filter((x) => x.id === id), ...rows.filter((x) => x.id.startsWith("leg:") && !known.has(x.id))], undefined, new Set()) : movesOf(rows, undefined, known);
      let f = followLine(m, Date.now() - at);
      // every leg done, and no new leg for SETTLE_MS, before it's called landed
      if (m?.status === "done") {
        if (!settled || settled.legs !== legs) settled = { at: Date.now(), legs };
        if (Date.now() - settled.at < SETTLE) f = followLine({ status: "moving" }, 0);
      } else settled = null;
      // the step on to the SOL or ETH (RH) wallet can't be read from here: say step one landed, never the whole move
      const hop = hopOf(ask);
      if (hop && !legsRead && m?.status === "done") f = { text: hopLine(hop), end: true };
      if (!live.current) return;
      setSaid(f.text);
      if (f.end || Date.now() - at > FOLLOW_MAX_MS) {
        const end = hop && !legsRead && m?.status === "done" ? { kind: "went" as const } : (f.end ? endOf(m, Date.now() - at) : null) ?? { kind: "went" as const };
        told(end);
        setMark(end.kind === "landed" ? "landed" : end.kind === "stopped" ? "refused" : "checking");
        // kept with the chat: Claude's record of this card says it landed, never "Activity shows when it lands" (D157 walk)
        if (end.kind === "landed") onCard?.({ kind: "landed" });
        return setState("ended");
      }
      setTimeout(() => void look(), wait);
    };
    void look();
  };

  const open = async () => {
    void bridge.call("device.haptic", { kind: "tap" });
    const mine = ++opens.current;
    const current = () => live.current && opens.current === mine;
    // Open again while the last sheet never said how it ended (closed without an end, or Trade never called back): only
    // the newest Open's end counts (current() above); the move's own task is Home's or Trade's (D144)
    if (ask.kind === "trade") {
      // Trade's own Buy or Sell page, filled in (Trade's channel, shell-api trade-ask.ts); until it is on main, the coin's
      // own page in Trade (openApp's coin route) and the card says what to do there
      const openTrade = (shell as unknown as { openTrade?: OpenTrade }).openTrade;
      if (!openTrade) {
        shell.openApp("trade", `coin:${ask.chain}:${ask.address}${ask.symbol ? `:${ask.symbol}` : ""}`);
        setSaid(putLine(ask));
        return setState("ended");
      }
      setState("open");
      setSaid(null);
      onCard?.({ kind: "opened" });
      return openTrade({ side: ask.side, chain: ask.chain, address: ask.address, ...(ask.usd ? { usd: ask.usd } : {}), ...(ask.pct ? { pct: ask.pct } : {}), from: "agentzero" }, (end) => {
        if (!current()) return;
        told(end.went ? { kind: "landed" } : end.refused ? { kind: "stopped", why: end.refused } : { kind: "closed" });
        onCard?.({ kind: "ended", went: end.went, ...(end.tradeId ? { movementId: end.tradeId } : {}) });
        setSaid(tradeEndLine(end));
        setState(end.went ? "ended" : "closed");
      });
    }
    before.current = await ids(bridge);
    if (!current()) return;
    setState("open");
    told({ kind: "opened" });
    onCard?.({ kind: "opened" });
    setSaid(HOME_PREFILL ? null : putLine(ask));
    shell.openMoney(moneyAsk(ask), (end: MoneyEnd) => {
      const closed = end.line ?? (ask.kind === "receive" || ask.kind === "request" ? "Add closed. Money sent to its address shows in your Activity." : "Closed. Nothing moved.");
      // the plan hears how the sheet ended at once, even when this card has left the screen (the person approved in
      // Home's sheet and the chat went away): a step that went lets the plan runner wait for the next one's money
      // (phone test, 3 Nov: AgentZero forgot step 2). Only the newest Open's end counts.
      if (opens.current === mine) {
        told(end.went ? { kind: "went" } : { kind: "closed", ...(end.line ? { why: end.line } : {}) });
        // kept with the chat: a reload and Claude's record say what this card saw (never "nothing moved" unread)
        onCard?.({ kind: "ended", went: end.went, ...(end.went && end.movementId ? { movementId: end.movementId } : {}) });
      }
      if (!current()) return;
      if (!end.went) {
        setSaid(closed);
        return setState("closed");
      }
      if (ask.kind === "receive" || ask.kind === "request") { setSaid(end.line ?? "Done."); return setState("ended"); }
      follow(end.movementId);
    });
  };

  const button = ask.kind === "send" ? "Open Send" : ask.kind === "swap" ? "Open Swap" : ask.kind === "move" ? "Open Move" : ask.kind === "trade" ? "Open Trade" : "Open Add";
  return (
    <div className="azc-card azc-money" data-state={state} {...(mark ? { "data-mark": mark } : {})} data-testid="az-money">
      {mark && <ReceiptMark state={mark} icon={<CoinIcon symbol={coinOf(ask)} icon={ICON_OF[coinOf(ask)]} size={26} />} />}
      <p className="azc-card-line">{line}</p>
      {said && <p className="zf-small azc-system" role="status" data-testid="az-money-line">{said}</p>}
      {stale && (state === "ask" || state === "closed" || state === "open") && <p className="zf-small azc-system" data-testid="az-money-stale">Changed: the newer card below takes its place.</p>}
      {/* "open" too: a sheet that closed without saying how it ended never leaves the card without a way on */}
      {!stale && (state === "ask" || state === "closed" || state === "open") && <div className="azc-acts"><button type="button" className="azc-act" onClick={() => void open()}>{state === "ask" ? button : "Open again"}</button></div>}
    </div>
  );
}

/** The coin the mark shows: the ask's, or the wallet's own (a move's Safe holds USDC; the chain wallets their coin). */
const PLACE_COIN: Record<string, string> = { safe: "USDC", sol: "SOL", hood: "ETH", near: "NEAR", bsc: "BNB" };
const ICON_OF: Record<string, string> = { SOL: "sol", ETH: "hood", NEAR: "near", USDC: "usdc", BNB: "bsc" };
function coinOf(ask: HomeAsk): string {
  if (ask.kind === "trade") return ask.symbol;
  if (ask.kind === "swap") return ask.to;
  if (ask.kind === "move") return PLACE_COIN[ask.from] ?? "USDC";
  return ask.coin ?? PLACE_COIN[("wallet" in ask && ask.wallet) || "safe"] ?? "USDC";
}

/** A money card from before a reload: its line, then what Activity says became of it (money-ask.ts oldSheetLine). */
export function OldSheet({ line, was }: { line: string; was: CardWas }) {
  const { bridge } = useShell();
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void oldSheetLine(was, () => moves(bridge)).then((s) => on && setSaid(s));
    return () => void (on = false);
  }, [bridge, was]);
  return (
    <div className="azc-step azc-money" data-testid="az-old-sheet">
      <p className="azc-step-line">{line}</p>
      <p className="zf-small azc-system" role="status">{said ?? "Looking in your Activity…"}</p>
    </div>
  );
}
