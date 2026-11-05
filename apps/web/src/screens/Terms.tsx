// Before a bank is made or brought to this device: one line, what agreeing says, one button; the facts and the terms one
// tap down. Once per device.
// Making an account, the same block sits on Make your key, so its one button agrees and makes the key (PAR 8, grade 1 Nov c).
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Back } from "@zerofee/design/icons.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { More } from "@zerofee/design/More.tsx";
import { TERMS, TERMS_AGREE, TERMS_AGREE_SHORT, TERMS_POINTS, TERMS_SUMMARY, TERMS_VERSION, acceptTerms } from "../terms.ts";
import "./terms.css";

/** The facts, what the person's tap agrees to, and the full terms one tap away. `compact`: on Make your key. */
export function TermsBlock({ compact = false }: { compact?: boolean }) {
  const [reading, setReading] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  // The sheet goes on the screen itself (as WaitLine's does): inside Make your key's scrolling, entering block it was
  // clipped mid-line over an empty band (grade 02g, F12).
  const host = block.current?.closest(".zf-screen") ?? (typeof document === "undefined" ? null : document.body);
  return (
    <div className={`tm-block${compact ? " tm-block--compact" : ""}`} ref={block}>
      {/* Summary first (UI-SIMPLICITY-RULES 2, 10): one line, then what the tap agrees to in one line; the facts and the
          full statement word for word one tap down, the legal text one more (product decision, 2 Nov). */}
      <p className="tm-sum">{TERMS_SUMMARY}</p>
      <p className="tm-agree">{TERMS_AGREE_SHORT}</p>
      <More label="What you agree to" className="tm-more">
        <ul className="tm-points">
          {TERMS_POINTS.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="tm-agree">{TERMS_AGREE}</p>
        <button className="zf-link tm-read" onClick={() => setReading(true)}>Read the terms</button>
      </More>
      {reading && host && createPortal(
        <Sheet title="Terms" onClose={() => setReading(false)}>
          <div className="tm-full">
            {TERMS.map((s, i) => (
              <section key={s.h}>
                <h2>{i + 1}. {s.h}</h2>
                <p>{s.p}</p>
              </section>
            ))}
            <p className="zf-small">Version {TERMS_VERSION}</p>
          </div>
          <button className="zf-btn" style={{ marginTop: 18 }} onClick={() => setReading(false)}>Done</button>
        </Sheet>,
        host,
      )}
    </div>
  );
}

/** `onBack` is left out on a device that already has a bank: there is nowhere to go back to. */
export function Terms({ onBack, onAgree }: { onBack?: () => void; onAgree: () => void }) {
  // The browser's Back and Escape go back too (D15, D16), as on every set-up screen with a Back.
  useBack(onBack);
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-top">
        {onBack ? <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button> : <span style={{ width: 28 }} />}
        <span className="zf-label">Terms</span>
        <span style={{ width: 28 }} />
      </div>
      <h1 className="zf-title tm-head zf-enter">Before you start</h1>
      <div className="zf-enter-2"><TermsBlock /></div>
      <div className="zf-fill" />
      <div className="zf-floor">
        <button className="zf-btn" onClick={() => { acceptTerms(); onAgree(); }}>Agree</button>
      </div>
    </div>
  );
}
