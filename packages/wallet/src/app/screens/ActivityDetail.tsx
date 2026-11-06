// One Activity item in full (product decision, 3 Nov): a full-screen page (D135) with what it was, its steps, their times and amounts,
// and its proof: the transaction that set it off and the one that landed it, each a short id with Copy and View (its
// explorer, opened in ZeroFee's own Browser, never Safari). A step inside the NEAR wallet's private balance says it has
// no public record. Loaded when a row is tapped (Activity's own chunk stays as it was).
import { useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { intentsUrl, type TxProof } from "@zerofee/core/tx-proof";
import { PROOF_LINE, proofLine } from "@zerofee/core/proof-line";
import { PROOF_WORDS as W, type ProofEnd, type ProofPage, dayTime } from "../proof.ts";
import type { Fact } from "../statement.ts";
import { copyText } from "../copy-text.ts";

const when = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export interface DetailProps {
  title: string;
  line: string;
  usd?: string;
  atIso: string;
  page: ProofPage;
  onClose: () => void;
  /** Opened from the Activity centre's list: ‹ back to the list (✕ then closes the centre too). */
  onBack?: () => void;
  /** It stopped: what happened, on the shell's Problem screen. */
  onProblem?: () => void;
  /** Paid to someone from the private balance: who, from this phone's own record, to copy. */
  payee?: string;
  /** Where it came from and went, and its fee (statement.ts movementFacts / spendingFacts). */
  facts?: readonly Fact[];
  /** Finding 61: it stopped on the way: the one tap that ends it (send it on, or bring it home). */
  ways?: readonly { label: string; run: () => void }[];
  /** A NEAR wallet swap's page: what it was and its time on two lines ("6 Nov"). */
  dayFirst?: boolean;
}

export function ActivityDetail({ title, line, usd, atIso, page, onClose, onBack, onProblem, payee, facts = [], ways = [], dayFirst = false }: DetailProps) {
  const { openApp } = useShell();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => void copyText(text).then((ok) => { if (!ok) return; setCopied(text); setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500); });
  // the Browser opens only an explorer's page handed over this way (core tx-proof.ts PROOF_HOSTS)
  const view = (url: string) => openApp("browser", undefined, url);
  const end = (label: string, e: ProofEnd | undefined, key: string) => {
    if (!e) return null;
    if ("private" in e) return <div className="wl-row wl-row-2" key={key} data-testid="proof-private"><div><div className="t">{label}</div><div className="d">{W.private}</div></div></div>;
    return <TxLine key={key} label={label} tx={e.tx} copied={copied === e.tx.hash} onCopy={() => copy(e.tx.hash)} onView={e.tx.url ? () => view(e.tx.url!) : undefined} />;
  };
  return (
    <Sheet title={W.bar} onClose={onClose} {...(onBack ? { onBack } : {})}>
      <div className="wl wl-detail" data-testid="activity-detail">
        {/* R2 (G3): the bar says Activity (a row's whole title never fits a 17 pt bar); the amount is the hero (T1), what
            it was under it (T5), and how it went and when as one T6 line. With no amount, the title is the page's T2. */}
        <div className="wl-detail__hero">
          {usd && <p className="wl-detail__usd">{usd}</p>}
          <h2 className="wl-detail__title">{title}</h2>
          {dayFirst
            ? <>{line && <p className="wl-detail__sub">{line}</p>}{atIso && <p className="wl-detail__sub">{dayTime(atIso)}</p>}</>
            : <p className="wl-detail__sub">{[line, when(atIso)].filter(Boolean).join(" · ")}</p>}
        </div>
        {onProblem && <button className="zf-btn" onClick={onProblem}>{W.problem}</button>}
        {ways.map((w, i) => <button key={w.label} className={i === 0 ? "zf-btn" : "zf-btn zf-btn--quiet"} onClick={w.run} data-testid="detail-way">{w.label}</button>)}
        {facts.length > 0 && (
          <div className="wl-rows" data-testid="detail-facts">
            {facts.map((f) => (
              <div className="wl-row wl-row-2" key={f.label} data-testid="detail-fact">
                <div><div className="t">{f.label}</div><div className="d">{copied === f.copy ? `${W.copied}` : f.value}</div></div>
                {f.copy && <div className="r"><button className="zf-link" onClick={() => copy(f.copy!)} aria-label={`${W.copy} ${f.copy}`}>{copied === f.copy ? W.copied : W.copy}</button></div>}
              </div>
            ))}
          </div>
        )}
        {payee && <div className="wl-rows"><button className="wl-row wl-row-2 wl-pick" onClick={() => copy(payee)}><div><div className="t">Paid to</div><div className="d">{copied === payee ? `${W.copied} ${payee}` : payee}</div></div></button></div>}
        <div className="wl-rows" data-testid="proof-ends">
          {end(W.started, page.started, "s")}
          {page.finished ? end(W.finished, page.finished, "f") : page.ended === null ? null : <div className="wl-row wl-row-2"><div><div className="t">{page.ended?.label ?? W.finished}</div><div className="d">{page.ended?.line ?? (page.done ? W.doneNoLink : W.notYet)}</div>{page.ended?.check && <div className="d" data-testid="detail-check">{page.ended.check}</div>}</div></div>}
        </div>
        {(page.steps.length > 1 || (page.stepsShown && page.steps.length > 0)) && (
          <>
            <h3 className="zf-small wl-detail__head">{W.steps}</h3>
            {page.steps.map((s, i) => (
              <div className="wl-rows" key={i} data-testid="proof-step">
                <div className="wl-row wl-row-2"><div><div className="t">{s.label}</div><div className="d">{[s.usd ? `$${s.usd}` : "", dayFirst && s.atIso ? dayTime(s.atIso) : when(s.atIso)].filter(Boolean).join(" · ")}</div></div></div>
                {end(W.started, s.start, `s${i}`)}
                {s.end ? end(W.finished, s.end, `f${i}`) : s.ended && <div className="wl-row wl-row-2" data-testid="proof-step-done"><div><div className="t">{W.finished}</div><div className="d">{W.doneNoLink}</div></div></div>}
              </div>
            ))}
          </>
        )}
        {page.swaps.length > 0 && <div className="wl-rows">{page.swaps.map((id) => { const url = intentsUrl(id); return <TxLine key={id} label={W.swap} tx={{ chain: "intents", hash: id, ...(url ? { url } : {}) }} copied={copied === id} onCopy={() => copy(id)} onView={url ? () => view(url) : undefined} />; })}</div>}
      </div>
    </Sheet>
  );
}

/** One transaction: what it was and its network ("On NEAR"), then View where its network has an explorer people know,
 *  else "Copy proof". Never its id on screen (QA, 5 Nov: "D6po1b…Z1x4" graded C). */
function TxLine({ label, tx, copied, onCopy, onView }: { label: string; tx: TxProof; copied: boolean; onCopy: () => void; onView?: (() => void) | undefined }) {
  const line = proofLine(tx.chain, !!onView);
  return (
    <div className="wl-row wl-row-2" data-testid="proof-tx">
      <div><div className="t">{label}</div>{line && <div className="d">{line}</div>}</div>
      <div className="r">
        {onView
          ? <button className="zf-link" onClick={onView}>{W.view}</button>
          : <button className="zf-link" onClick={onCopy} aria-label={PROOF_LINE.copy}>{copied ? PROOF_LINE.copied : PROOF_LINE.copy}</button>}
      </div>
    </div>
  );
}
