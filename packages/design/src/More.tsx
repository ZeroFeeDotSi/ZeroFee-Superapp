// Summary first, details on demand ($ZEROFEE_HOME/UI-SIMPLICITY-RULES.md, rules 2 and 4): one labelled disclosure, the
// platform's own <details>, so it opens with one tap, reads to VoiceOver as a disclosure, and needs no state. Its label
// says what it holds ("See which coins count", "How it works"), never just "More".
import type { ReactNode } from "react";
import "./more.css";

export function More({ label, lines, children, className }: { label: string; lines?: readonly string[]; children?: ReactNode; className?: string }) {
  return (
    <details className={`zf-more${className ? ` ${className}` : ""}`}>
      <summary className="zf-more__label">
        <span>{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="m7 10 5 5 5-5" /></svg>
      </summary>
      <div className="zf-more__body">
        {lines?.map((l, i) => <p key={i} className="zf-small">{l}</p>)}
        {children}
      </div>
    </details>
  );
}
