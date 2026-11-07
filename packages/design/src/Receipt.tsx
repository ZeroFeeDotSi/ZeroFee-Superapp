// The receipt (UI concept v3.1, 5 Nov): the same sheet a person tapped Buy on becomes the receipt. One object: the coin,
// which grows when the tap takes, gets its ring and its tick badge when the chain answers, or a red cross when the
// chain refuses. The words come from receipt.ts (the reviewer's MUST: "Bought" only on the chain's confirmed answer).
import { useEffect, type ReactNode } from "react";
import { mark } from "./tap.ts";
import { receiptWords, type ReceiptState } from "./receipt.ts";
import "./receipt.css";

const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;
const CROSS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>;
/** The money came back: LiveRow's own "back" arrow, neutral. On a mark only: a full receipt has no such state. */
const BACK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 6L4.8 10.8l4.8 4.8M5.3 10.8H14.4a4.8 4.8 0 010 9.6H12" /></svg>;
type MarkState = ReceiptState | "back";

/** The object alone, small, for a row in a thread (AgentZero's money card, 5 Nov): the same coin, ring and badge at
 *  48 px, the same states. The words are the row's own. Decorative: the row says the state in words. */
export function ReceiptMark({ state, icon, size = 48 }: { state: MarkState; icon: ReactNode; size?: number }) {
  return (
    <div className="zf-receipt zf-receipt--mark" data-state={state} aria-hidden="true" style={{ ["--ring" as string]: `${size}px`, ["--coin" as string]: `${Math.round(size * 0.54)}px`, ["--badge" as string]: `${Math.round(size * 0.375)}px` }}>
      <Obj state={state} icon={icon} />
    </div>
  );
}

function Obj({ state, icon }: { state: MarkState; icon: ReactNode }) {
  return (
    <div className="zf-receipt__obj">
      <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
      <div className="zf-receipt__coin">{icon}</div>
      <span className="zf-receipt__badge" aria-hidden="true">{state === "back" ? BACK : state === "refused" ? CROSS : TICK}</span>
    </div>
  );
}

export function Receipt({ state, side, coin, coinAmount, where, usd, landedMs, feeTaken, feeUsd, about, icon, extra, say }: {
  state: ReceiptState; side: "buy" | "sell"; coin: string; coinAmount: string; where: string;
  /** "$25.00": the figure from the signed quote (min received), never a higher estimate. `state` "refused" only when nothing
   *  was broadcast or the chain confirmed a fail/expire; a lost answer after broadcast is "checking". */
  usd: string; landedMs?: number;
  /** A refusal the chain made after landing: its network fee left the wallet (receipt.ts). */
  feeTaken?: boolean; feeUsd?: string;
  /** Landed, its coins still the quote's (not the chain's read): "About 7,505 DOPE" (receipt.ts). */
  about?: boolean;
  /** The coin's logo (a CoinIcon at 64), drawn inside the object. */
  icon: ReactNode;
  /** On the chain line, after its words: a clock while it is on its way ("· 0.36 s"). */
  extra?: ReactNode;
  /** A flow's own words for a line, where the default would misname the place (the Safe's swaps: "your Safe", never
   *  "your wallet"; a refusal's own reason). Only the lines given change; the state, the object and the marks don't. */
  say?: { head?: string; line?: string; chain?: string };
}) {
  const w0 = receiptWords({ state, side, coin, coinAmount, where, ...(landedMs !== undefined ? { landedMs } : {}), ...(feeTaken ? { feeTaken } : {}), ...(feeUsd ? { feeUsd } : {}), ...(about ? { about } : {}) });
  const w = { ...w0, ...say };
  useEffect(() => { mark(state); }, [state]);   // a crawl's clock: away, checking, landed, refused
  return (
    <div className="zf-receipt" data-state={state} role="status" aria-live="polite">
      <Obj state={state} icon={icon} />
      <p className="zf-receipt__amount">{usd}</p>
      <p className="zf-receipt__head">{w.head}</p>
      <p className="zf-receipt__line">{w.line}</p>
      <p className="zf-receipt__chain">
        {(state === "away" || state === "checking") && <span className="zf-live" aria-hidden="true" />}
        {state === "landed" && <span className="zf-receipt__chain-tick" aria-hidden="true">{TICK}</span>}
        {w.chain}
        {extra && <span className="zf-receipt__extra">{extra}</span>}
      </p>
    </div>
  );
}
