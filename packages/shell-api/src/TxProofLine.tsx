// A transaction's proof line (S3, 4 Nov): its network, and View on its chain's explorer; a chain with no explorer people
// know (Robinhood Chain) has "Copy proof" (core proof-line.ts). Never the id on screen (QA, 5 Nov). Used under an Activity
// task (TaskCentre.tsx) and on the web Send's receipt (WebSendSheet.tsx). Copy is asked in the tap itself (copy-text.ts)
// and says "Copied" only when it copied.
import { useState } from "react";
import { txUrl } from "@zerofee/core/tx-proof";
import { PROOF_LINE, proofLine } from "@zerofee/core/proof-line";
import { copyText } from "./copy-text.ts";

export function TxProofLine({ tx, onView, className = "tc-proof" }: { tx: { chain: string; hash: string }; onView: (url: string) => void; className?: string }) {
  const [copied, setCopied] = useState(false);
  const url = txUrl(tx.chain, tx.hash);
  const copy = () => void copyText(tx.hash).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const line = proofLine(tx.chain, !!url);
  return (
    <p className={`zf-small ${className}`} data-testid="task-proof">
      {line && <span className={`${className}__id`}>{line}</span>}
      {url
        ? <button type="button" className="zf-link" onClick={() => onView(url)}>View</button>
        : <button type="button" className="zf-link" onClick={copy} aria-label={PROOF_LINE.copy}>{copied ? PROOF_LINE.copied : PROOF_LINE.copy}</button>}
    </p>
  );
}
