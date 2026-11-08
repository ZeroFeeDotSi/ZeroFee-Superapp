// AgentZero's own wallet on screen (design $ZEROFEE_HOME/AGENTZERO-WALLET.md §5, L9), loaded only when AGENTZERO_WALLET
// is on (wallet-flag.ts): the one number on top, its Details, the first run, Add money, the low / empty / cap / paused
// lines above the box. Every money step is the core's own door and sheet (use-agent-wallet.ts); this file only shows.
// The look is the app's: black and white, quiet grey lines, the orb the only colour; no boxes, no bars.
import { intentsPaid } from "@zerofee/core/zero-fee";
import { TimeLeft } from "@zerofee/wallet/app/money/JobMade.tsx";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { useEffect, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { KeysSource } from "./AgentZeroChat.tsx";
import { KeyForm, ModelPick } from "./KeySetup.tsx";
import type { Done, WalletSource } from "./use-agent-wallet.ts";
import { OPENING, fundTap } from "./fund-tap.ts";
import { UNREAD_LINE } from "@zerofee/agent/chat/turn";
import {
  ADD, ADD_MONEY, CONTINUE, REFUSE_LINE, PUBLIC_LINE, chatCostLine, meterLabel, DETAILS_TITLE, EMPTY_LINE, FEES_LOW_LINE, FEES_ROW, FILL_SHORT, FILL_TITLE, FROM_ONLY, FUND_AMOUNTS, FUND_BODY, FUND_TITLE,
  LIMIT_NOTE, LIMIT_ROW, LOWER, MONTH_ROW, MOVE_ALL, OTHER, OTHER_AMOUNT, OWN_KEY_LINK, PAUSED_LINE, PRICE_LINE, RAISE, RAISE_LIMIT, CHANGE_LIMIT, SETTLE_LINE,
  capLine, doneLine, FILL_LATE, FILL_LATE_MS, fillShows, feesLine, firstPick, fillButton, fillFloor, fromLine, leftChip, limit, lowLine, money, monthLine, moveDone, todayLine, usedChip,
  priceLine,
  shownPrice,
} from "./wallet-words.ts";
import "./wallet.css";
import "@zerofee/design/receipt.css";
import { mark } from "@zerofee/design/tap.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";

/** The cost meter, a chip under the top bar above the thread, quiet (product decision, 4 Nov): "$0.034 used" today, rising while AgentZero thinks; when
 *  AgentZero is low or empty, what it has left on a second line. Its tap opens the wallet's sheet. */
export function WalletChip({ w, onOpen }: { w: WalletSource; onOpen: () => void }) {
  const used = w.usedUsd + w.liveUsd;
  const low = w.totalUsd !== null && (w.state === "low" || w.state === "empty");
  return (
    <button type="button" className="zf-chip azw-meter" onClick={onOpen} aria-label={meterLabel(used, w.totalUsd)}>
      <span className="azw-used">{usedChip(used)}</span>
      {low && <span className="azw-left">{leftChip(w.totalUsd!)}</span>}
    </button>
  );
}

export type Pane = "details" | "fill" | "key" | "limit";

/** Details (D152; product decision, 4 Nov): what AgentZero has, today's figures (used, paid, owed), how it pays ZeroFee (in one go at
 *  $0.25), what this chat cost (Claude's price, nothing added), the month against its limit, the NEAR it keeps for sending
 *  fees, Add money, Move all to my Safe (what it owes paid first), the limit, the Model and Effort picker; the person's
 *  own key only in a developer build (own-key.ts). */
export function WalletSheet({ w, keys, chatUsd = 0, onClose, start = "details", amount, other = false }: { w: WalletSource; keys?: KeysSource | undefined; chatUsd?: number; onClose: () => void; start?: Pane; amount?: number | undefined; other?: boolean }) {
  const [pane, setPane] = useState<Pane>(start);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const moveAll = async () => {
    setBusy(true);
    setLine(null);
    // what moves: AgentZero's money once what it owes ZeroFee is paid
    const held = w.totalUsd ?? 0;
    const r = await w.empty();
    setBusy(false);
    if ("line" in r) setLine(r.line);
    else if ("ok" in r) setLine(moveDone(held));
  };
  if (pane === "fill") return <FillSheet w={w} amount={amount} other={start === "fill" && amount === undefined && other} onClose={onClose} />;
  if (pane === "limit") return <LimitSheet w={w} onClose={onClose} />;
  return (
    <Sheet title={pane === "key" ? "AI key" : DETAILS_TITLE} onClose={onClose}>
      {pane === "key" && keys ? (
        <KeyForm keys={keys} onSaved={onClose} />
      ) : (
        <div className="azw">
          <p className="azw-big">{w.totalUsd === null ? "Can't see it right now" : money(w.totalUsd)}</p>
          <p className="azw-today">{todayLine(w.usedUsd + w.liveUsd, w.paidUsd)}</p>
          <p className="zf-small azw-quiet">{SETTLE_LINE}</p>
          <p className="zf-small azw-quiet">{`${chatCostLine(chatUsd)} · ${PRICE_LINE}`}</p>
          <div className="azw-rows">
            {w.month && <p className="azw-row"><span>{MONTH_ROW}</span><span>{monthLine(w.month.spentUsd, w.month.capUsd)}</span></p>}
            {w.month && <button type="button" className="azw-row azw-rowbtn" onClick={() => setPane("limit")}><span>{LIMIT_ROW}</span><span>{`${limit(w.month.capUsd)} a month`}</span></button>}
            {w.feesNear !== null && <p className="azw-row"><span>{FEES_ROW}</span><span>{feesLine(w.feesNear)}</span></p>}
          </div>
          <div className="azw-acts">
            <button type="button" className="zf-btn" onClick={() => setPane("fill")}>{ADD_MONEY}</button>
            {(w.walletUsd ?? 0) > 0 && <button type="button" className="zf-btn azc-btn-quiet" disabled={busy} onClick={() => void moveAll()}>{MOVE_ALL}</button>}
          </div>
          {line && <p className="zf-small azw-quiet" role="status">{line}</p>}
          <p className="zf-small azw-quiet">{PUBLIC_LINE}</p>
          {keys?.model && <ModelPick model={keys.model} />}
          {keys?.own && <button type="button" className="azc-link azw-link" onClick={() => setPane("key")}>{OWN_KEY_LINK}</button>}
        </div>
      )}
    </Sheet>
  );
}

/** Add money: an amount ($5, $20, $50 or Other), from the NEAR wallet (its balance), then the core's own sheet. */
export function FillSheet({ w, amount, other: otherFirst = false, onClose, onDone }: { w: WalletSource; amount?: number | undefined; other?: boolean; onClose: () => void; onDone?: (usd: number) => void }) {
  const [pick, setPick] = useState<number | "other" | null>(otherFirst ? "other" : (amount ?? firstPick(w.nearUsd)));
  const [other, setOther] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // after a fill went through: AgentZero's USDC before it (the line waits for the balance it reads, never before + amount)
  const [done, setDone] = useState<number | null>(null);
  /** The fill's job (runJob's made): its receipt follows its own rows, never another job's (the audit's finding, 7 Nov). */
  const [fillJob, setFillJob] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (done === null) return;
    const t = setTimeout(() => setLate(true), FILL_LATE_MS);
    return () => clearTimeout(t);
  }, [done]);
  const landed = done !== null && fillShows(done, w.walletUsd);
  const usd = pick === "other" ? Number(other) : (pick ?? 0);
  // the core's own floor as read now ($2.30 while AgentZero needs NEAR for fees); unread, the core alone checks
  const ok = Number.isFinite(usd) && usd > 0 && (w.fillMinUsd === null || usd >= w.fillMinUsd - 1e-9);
  const short = ok && w.nearUsd !== null && usd > w.nearUsd;
  // D143: the person's own tap on the Add button (marked with its amount) is what lets the core start the fill
  const go = async (tap: unknown) => {
    if (!ok || short || busy) return;
    setBusy(true);
    setLine(null);
    mark("tap");
    const before = w.walletUsd ?? 0;
    // the job is made (bug report, 5 Nov): "Job created." here at once; the core's answer ends its row, never this sheet
    let made = false;
    const r = await w.fund(usd, tap, (j) => { made = true; setFillJob(j); mark("away"); setBusy(false); setDone(before); });
    setBusy(false);
    if ("line" in r) { mark("refused"); return made ? undefined : setLine(r.line); }
    if ("declined" in r) return setDone(null);
    setDone(before);
    onDone?.(before + usd);
  };
  return (
    <Sheet title={FILL_TITLE} onClose={onClose}>
      <div className="azw">
        {done !== null ? (
          <>
            {landed ? <p className="azw-big azw-done" role="status">{doneLine(w.walletUsd!)}</p> : (
              <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid="az-fill-made">
          <div className="zf-receipt__obj">
            <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></div>
          </div>
                <p className="zf-receipt__amount">{limit(usd)}</p>
                <p className="zf-receipt__head">{JOB_WORDS.created}</p>
                <TimeLeft etaSec={LEG_SEC.nearToSafe} watch job={fillJob} />
                {late && FILL_LATE.map((l) => <p key={l} className="zf-small azw-quiet">{l}</p>)}
              </div>
            )}
            <button type="button" className="zf-btn" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <div className="azw-amounts" role="group" aria-label="Amount">
              {FUND_AMOUNTS.map((a) => <button key={a} type="button" className="azw-amount" aria-pressed={pick === a} onClick={() => setPick(a)}>{limit(a)}</button>)}
              <button type="button" className="azw-amount" aria-pressed={pick === "other"} onClick={() => setPick("other")}>{OTHER}</button>
            </div>
            {pick === "other" && <input className="azc-field azw-other" inputMode="decimal" placeholder={OTHER_AMOUNT} aria-label={OTHER_AMOUNT} value={other} onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, ""))} />}
            <p className="azw-row azw-from"><span>{fromLine(w.nearUsd)}</span></p>
            <p className="zf-small azw-quiet">{FROM_ONLY}</p>
            {/* the least, up front (QA 5 Nov: "$2.00" shown, $2.30 needed); an alert once a smaller amount is typed */}
            {w.fillMinUsd !== null && <p className="zf-small azw-quiet" {...(pick === "other" && other !== "" && !ok ? { role: "alert" } : {})}>{fillFloor(w.fillMinUsd, w.fillFeesUsd)}</p>}
            {short && <p className="zf-small azw-quiet" role="alert">{FILL_SHORT}</p>}
            {line && <p className="zf-small azw-quiet" role="alert">{line}</p>}
            {/* who the fee goes to, right above the button (the copy review, 6 Nov): a fill leaves the NEAR wallet through NEAR Intents (core agent-wallet.ts toAgent) */}
            <div className="zf-fee"><p className="zf-small azw-quiet" data-testid="az-fill-paid">{intentsPaid()}</p></div>
            <button type="button" className="zf-btn" disabled={!ok || short || busy} data-agentzero-fill={ok ? String(Math.round(usd * 1e6)) : undefined} onClick={(e) => void go(e.nativeEvent)}>{ok ? fillButton(usd) : FILL_TITLE}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The monthly limit (P1): lower holds at once; raise goes through the core's own sheet (Face ID). */
function LimitSheet({ w, onClose }: { w: WalletSource; onClose: () => void }) {
  const cap = w.month?.capUsd ?? 20;
  const [text, setText] = useState(String(cap));
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usd = Number(text);
  const valid = text !== "" && Number.isFinite(usd) && usd >= 0 && usd <= 200 && usd !== cap;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setLine(null);
    const r = await w.setCap(usd);
    setBusy(false);
    if ("line" in r) setLine(r.line);
    else if ("ok" in r) onClose();
  };
  return (
    <Sheet title={LIMIT_ROW} onClose={onClose}>
      <div className="azw">
        <p className="azw-big">{`${limit(cap)} a month`}</p>
        <p className="zf-small azw-quiet">{LIMIT_NOTE}</p>
        <input className="azc-field azw-other" inputMode="decimal" aria-label="New monthly limit in dollars" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))} />
        {line && <p className="zf-small azw-quiet" role="alert">{line}</p>}
        <button type="button" className="zf-btn" disabled={!valid || busy} onClick={() => void save()}>{!valid ? CHANGE_LIMIT : usd > cap ? `${RAISE} to ${limit(usd)}` : `${LOWER} to ${limit(usd)}`}</button>
      </div>
    </Sheet>
  );
}

/** First run (§5): in the chat, in place of the ready line; the box stays below for the free first try. Its amounts open
 *  the chat's own wallet sheet (`onAmount`), so the sheet outlives this card (it goes once AgentZero has money). */
export function FundCard({ keys, onAmount }: { keys?: KeysSource | undefined; onAmount: (usd: number | undefined) => Promise<Done> }) {
  const [key, setKey] = useState(false);
  // the tapped amount ("other" for Other) while AgentZero's wallet is set up; every amount waits meanwhile
  const [busy, setBusy] = useState<number | "other" | null>(null);
  const [line, setLine] = useState<{ line: string; final: boolean } | null>(null);
  const tap = async (usd: number | undefined) => {
    if (busy !== null || line?.final) return;
    setBusy(usd ?? "other");
    setLine(null);
    const said = await fundTap(() => onAmount(usd));
    setBusy(null);
    setLine(said);
  };
  return (
    <div className="azw-fund">
      <p className="azw-fundtitle">{FUND_TITLE}</p>
      <p className="zf-small azw-quiet">{FUND_BODY}</p>
      {line && <p className="zf-small azw-fundline" role="alert">{line.line}</p>}
      {!line?.final && <div className="azw-amounts" role="group" aria-label="Fund AgentZero" aria-busy={busy !== null}>
        {FUND_AMOUNTS.map((a) => <button key={a} type="button" className="azw-amount" disabled={busy !== null} aria-pressed={busy === a} onClick={() => void tap(a)}>{busy === a ? OPENING : limit(a)}</button>)}
        <button type="button" className="azw-amount" disabled={busy !== null} aria-pressed={busy === "other"} onClick={() => void tap(undefined)}>{busy === "other" ? OPENING : OTHER}</button>
      </div>}
      {keys && !key && <button type="button" className="azc-link azw-link" onClick={() => setKey(true)}>{OWN_KEY_LINK}</button>}
      {keys && key && <KeyForm keys={keys} />}
    </div>
  );
}

export { priceLine, shownPrice };

/** The one line above the box: a message refused for money (D37), low, empty, the month's cap, or a reply paused
 *  mid-task; and always what a message costs (D37). `state` "refused": the relay refused it for money. */
export function WalletLine({ w, onContinue, onSheet, state, model, busy }: { w: WalletSource; onContinue?: () => void; onSheet: (p: Pane) => void; state?: "refused"; model?: string | undefined; busy?: boolean }) {
  const setSheet = onSheet;
  const price = <span className="zf-small azw-quiet azw-price">{shownPrice(model, w.turnPaidUsd ?? null, !!busy)}</span>;
  // D37: refused before Claude was asked: what is missing, Add money, and the price of a message
  if (w.refused === "money" || state === "refused") return (
    <div className="azw-line" role="alert">
      <span className="zf-small">{REFUSE_LINE}</span>
      <button type="button" className="azw-act" onClick={() => setSheet("fill")}>{ADD_MONEY}</button>
      {price}
    </div>
  );
  if (w.refused === "unread" && !w.problem) return <div className="azw-line" role="alert"><span className="zf-small">{UNREAD_LINE}</span>{price}</div>;
  const kind = w.paused ? "paused" : w.state;
  // the core's own refusal first, word for word (a purchase with the phone's clock off: "Set the right time, …"); the price
  // stays under it (QA 4 Nov: an idle chat showed only "AgentZero's wallet has no money yet.", no price)
  if (w.problem) return (
    <div className="azw-line" role="alert">
      <span className="zf-small">{w.problem}</span>
      {kind === "paused" && onContinue && <button type="button" className="azw-act" onClick={onContinue}>{CONTINUE}</button>}
      {price}
    </div>
  );
  if (!["paused", "low", "empty", "cap", "fees"].includes(kind)) return <div className="azw-line azw-line-quiet">{price}</div>;
  const say = kind === "paused" ? PAUSED_LINE : kind === "low" ? lowLine(w.totalUsd ?? 0) : kind === "empty" ? EMPTY_LINE : kind === "fees" ? FEES_LOW_LINE : capLine(w.month?.capUsd ?? 20, w.month?.endsAtIso ?? null);
  return (
    <div className="azw-line" role="status">
      <span className="zf-small">{say}</span>
      {kind === "cap" ? (
        <button type="button" className="azw-act" onClick={() => setSheet("limit")}>{RAISE_LIMIT}</button>
      ) : (
        <button type="button" className="azw-act" onClick={() => setSheet("fill")}>{kind === "empty" || kind === "fees" ? ADD : ADD_MONEY}</button>
      )}
      {kind === "paused" && onContinue && <button type="button" className="azw-act" onClick={onContinue}>{CONTINUE}</button>}
      {price}
    </div>
  );
}
