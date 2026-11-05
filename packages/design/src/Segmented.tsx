// A segmented control (J2, 2 Nov): an app's own sections (Wallet: Balance · Activity; Trade: Home · Trade · Activity)
// at the top of the app, so the only bar at the bottom is the app bar. A hairline pill, one name per section, a soft
// thumb with the marker's glow that glides to the section chosen (the shared spring as CSS, --ease-spring).
import type { CSSProperties } from "react";
import "./segmented.css";

export interface Segment<T extends string> {
  id: T;
  label: string;
}

export function Segmented<T extends string>({ items, value, onChange, label, className = "" }: { items: readonly Segment<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  const at = Math.max(0, items.findIndex((s) => s.id === value));
  return (
    <div className={`zf-seg ${className}`.trim()} role="tablist" aria-label={label} style={{ "--n": items.length, "--at": at } as CSSProperties}>
      <span className="zf-seg__thumb" aria-hidden="true" />
      {items.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={s.id === value} className={`zf-seg__item zf-press${s.id === value ? " on" : ""}`} onClick={() => onChange(s.id)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
