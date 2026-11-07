// The buy and sell moment: the Buy page becomes the trade itself, then its receipt, on the design package's one
// object (Receipt.tsx, UI concept v3.1, 5 Nov; the old moment was "weird shapes"): the coin, which grows when
// the tap takes, gets its ring and tick badge when the chain answers, or a red cross when the chain refuses.
//   sending:  "On its way · About 7,505 DOPE", the live dot and a clock counting the real time from the tap
//   done:     "Bought · 7,505 DOPE · in your SOL wallet" and "Done in under a second." (the chain's confirmed answer only;
//             T2-6, the copy review's walk: "Done in 2 seconds." from a second on), "You now hold 7,505 DOPE · $24.85", the proof
//   checking: the chain's answer was lost after the send: "Still checking", never a refusal (QA)
//   refused:  the chain, or the core before signing, said no: "DOPE didn't buy · Nothing left your wallet."
// One lit verb per screen: Done once landed or checking, Try again once refused, none while it sends.
import { useEffect, useRef, useState } from "react";
import { copyText } from "@zerofee/shell-api/copy-text.ts";
import { PROOF_LINE } from "@zerofee/core/proof-line";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Receipt } from "@zerofee/design/Receipt.tsx";
import type { ReceiptState } from "@zerofee/design/receipt.ts";
import { doneIn } from "../format.ts";
import { receiptProof, SEE_PROOF } from "../receipt-words.ts";

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

/** T2-6 (the copy review's words): "On Solana · See proof" once its page is there; "On Solana. Proof page in a moment." while not, its id
 *  behind Copy proof (says "Copied" only when it copied). Never the id on screen. */
function Proof({ tx }: { tx: { chain: string; hash: string } }) {
  const [copied, setCopied] = useState(false);
  const p = receiptProof(tx.chain, tx.hash);
  const copy = () => void copyText(tx.hash).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <p className="zf-small tm-proof" data-testid="task-proof">
      <span className="tm-proof__id">{p.url ? `${p.line} · ` : p.line}</span>
      {p.url
        ? <button type="button" className="zf-link" onClick={() => view(p.url!)}>{SEE_PROOF}</button>
        : <button type="button" className="zf-link" onClick={copy} aria-label={PROOF_LINE.copy}>{copied ? PROOF_LINE.copied : PROOF_LINE.copy}</button>}
    </p>
  );
}

export function TradeMoment({ phase, side, symbol, logo, coinAmount, where, usd, tapAt, landedMs, feeTaken, feeUsd, held, cost, tx, onSell, onMore, onDone }: {
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
  /** once landed: what is held now ("3,002 DOPE", and its dollars when priced: what selling it all gets, T2-4). No market
   *  line under it (copy review, 8 Nov: two gap lines read as two prices for one coin; the buy's line is the one) */
  held?: { coins: string; usd?: string } | undefined;
  /** once a buy landed (QA QA's SHOULD): how far its quote was over the market price, and its network fee, said once
   *  (receipt-words.ts buyCostLine) */
  cost?: string | null;
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
        {...(landed && landedMs !== undefined ? { say: { chain: doneIn(landedMs) } } : {})}
        icon={<CoinIcon symbol={symbol} src={logo} size={64} />} {...(phase === "sending" ? { extra: <Clock since={tapAt} /> } : {})} />
      {landed && cost && <p className="zf-small tm-gap" data-testid="receipt-cost">{cost}</p>}
      {landed && held && (
        <div className="tm-held">
          <CoinIcon symbol={symbol} src={logo} size={36} />
          {/* T2-6 (the copy review's words): "You now hold" over "7,505 DOPE · $24.85 if sold now", the coin said once; the figure is what
              selling it all gets (T2-4), so it says so (QA QA's SHOULD, 8 Nov); "if sold now" drops whole to its own mute line */}
          <span className="tm-held-t"><small>You now hold</small>{held.usd ? <span>{`${held.coins} · ${held.usd} `}<span className="tm-held-if">if sold now</span></span> : held.coins}</span>
        </div>
      )}
      {landed && tx && <Proof tx={tx} />}
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
