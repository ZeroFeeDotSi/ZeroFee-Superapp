// The buy and sell moment: the Buy page becomes the trade itself, then its receipt, on the design package's one
// object (Receipt.tsx, UI concept v3.1, 5 Nov; the old moment was "weird shapes"): the coin, which grows when
// the tap takes, gets its ring and tick badge when the chain answers, or a red cross when the chain refuses.
//   sending:  "On its way · About 7,505 DOPE", the live dot and a clock counting the real time from the tap
//   done:     "Bought · 7,505 DOPE · in your SOL wallet" and "Landed in 1.05 s" (the chain's confirmed answer only)
//   checking: the chain's answer was lost after the send: "Still checking", never a refusal (QA)
//   refused:  the chain, or the core before signing, said no: "DOPE didn't buy · Nothing left your wallet."
// One lit verb per screen: Done once landed or checking, Try again once refused, none while it sends.
import { useEffect, useRef, useState } from "react";
import { TxProofLine } from "@zerofee/shell-api/TxProofLine.tsx";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Receipt } from "@zerofee/design/Receipt.tsx";
import type { ReceiptState } from "@zerofee/design/receipt.ts";

export type MomentPhase = "sending" | "done" | "checking" | "refused";
const STATE: Record<MomentPhase, ReceiptState> = { sending: "away", done: "landed", checking: "checking", refused: "refused" };

/** "0.62 s" under 10 s, "12 s" over: the real time from the tap to the chain. */
export const secsText = (ms: number): string => (ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms / 1000)} s`);

/** The clock while it is sending: written straight into its element each frame, no React render per frame. */
function Clock({ since }: { since: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const step = () => { if (el.current) el.current.textContent = secsText(performance.now() - since); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [since]);
  return <span ref={el} className="tm-clock">{secsText(0)}</span>;
}

/** View: the explorer in its own tab (as Send's receipt; the web has no Browser) */
const view = (url: string) => { try { globalThis.open?.(url, "_blank", "noopener,noreferrer"); } catch { /* no window to open */ } };

export function TradeMoment({ phase, side, symbol, logo, coinAmount, where, usd, tapAt, landedMs, feeTaken, feeUsd, held, tx, onSell, onMore, onDone }: {
  phase: MomentPhase; side: "buy" | "sell"; symbol: string; logo?: string;
  /** the coins: "7,505" (a buy: what arrived; a sale: what went) */
  coinAmount: string;
  /** the wallet: "your SOL wallet" */
  where: string;
  /** the dollars, from the signed quote until the chain's own figure is read: "$25.00" */
  usd: string;
  /** performance.now() at the tap, for the clock */
  tapAt: number;
  /** the real time from the tap to the chain, once landed */
  landedMs?: number;
  /** once refused: the chain landed and failed it, so its network fee left the wallet (receipt.ts) */
  feeTaken?: boolean; feeUsd?: string;
  /** once landed: what is held now ("3,002 DOPE", and its dollars when priced) */
  held?: { coins: string; usd?: string } | undefined;
  /** once landed: the trade's own transaction, said short with Copy and View (TxProofLine, as Send's receipt) */
  tx?: { chain: string; hash: string };
  /** once a buy landed: its Sell (the coin's Sell page) and Buy more (this page again), quiet; Done is the lit verb.
   *  Once refused: Try again (onMore) is the lit verb. */
  onSell?: () => void;
  onMore?: () => void;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  const landed = phase === "done";
  return (
    <div className={`tm tm--${phase}${shown ? " is-in" : ""}`}>
      <Receipt state={STATE[phase]} side={side} coin={symbol} coinAmount={coinAmount} where={where} usd={usd} {...(landedMs !== undefined ? { landedMs } : {})} {...(feeTaken ? { feeTaken } : {})} {...(feeUsd ? { feeUsd } : {})}
        icon={<CoinIcon symbol={symbol} src={logo} size={64} />} {...(phase === "sending" ? { extra: <Clock since={tapAt} /> } : {})} />
      {landed && held && (
        <div className="tm-held">
          <CoinIcon symbol={symbol} src={logo} size={36} />
          <span className="tm-held-t">You hold {symbol}<small>{held.coins}</small></span>
          {held.usd && <span className="tm-held-v">{held.usd}</span>}
        </div>
      )}
      {landed && tx && <TxProofLine tx={tx} onView={view} className="tm-proof" />}
      {phase !== "sending" && (
        <div className="tm-floor">
          {phase === "refused" ? (
            <>{onMore && <button className="zf-btn tm-btn1" onClick={onMore}>Try again</button>}{onDone && <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onDone}>Close</button>}</>
          ) : (
            <>
              {landed && onSell && <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onSell}>Sell</button>}
              {landed && onMore && <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onMore}>Buy more</button>}
              {onDone && <button className="zf-btn tm-btn1" onClick={onDone}>Done</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
