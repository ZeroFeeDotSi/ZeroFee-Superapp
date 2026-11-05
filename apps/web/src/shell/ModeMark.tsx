// The mode mark (mode-mark.ts): a small pill at the top centre on every screen. Real: "Beta · Use dust amounts only." with
// a small × that hides the dust words for a day (Beta stays); Sim: "Sim", quiet and dashed.
import { useState } from "react";
import { COPY_NOTE, HIDE_DUST, SIM_NOTE, dustHiddenAt, hideDust, modeMark, type MarkMode } from "./mode-mark.ts";
import "./mode-mark.css";

/** `strip`: a browser, where the mark has its own strip above the app (full-app.tsx). */
export function ModeMark({ mode, strip = false }: { mode: MarkMode; strip?: boolean }) {
  const [hiddenAt, setHiddenAt] = useState(() => dustHiddenAt());
  const mark = modeMark(mode, hiddenAt, Date.now());
  const at = strip ? " zf-mode-mark--strip" : "";
  // the Sim pill is a quiet mark only: the public site's way to Real is its Sim | Real switch above the app (site-switch.ts)
  if (mode === "sim") return <div className={`zf-mode-mark zf-mode-mark--sim${at}`} role="note" aria-label={SIM_NOTE}><b>{mark.label}</b></div>;
  if (mode === "copy") return <div className={`zf-mode-mark zf-mode-mark--sim zf-mode-mark--copy${at}`} role="note" aria-label={COPY_NOTE}><b>{mark.label}</b></div>;
  if (!mark.line) return <div className={`zf-mode-mark zf-mode-mark--alone${at}`} role="note"><b>{mark.label}</b></div>;
  const hide = () => {
    const now = Date.now();
    hideDust(now);
    setHiddenAt(now);
  };
  return (
    <div className={`zf-mode-mark${at}`} role="note">
      <b>{mark.label}</b>
      <span className="zf-mode-mark__line">· {mark.line}</span>
      <button className="zf-mode-mark__x" onClick={hide} aria-label={HIDE_DUST}>×</button>
    </div>
  );
}
