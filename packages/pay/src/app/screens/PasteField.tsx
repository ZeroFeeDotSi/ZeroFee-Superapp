// One paste field (Card, Bank, Your exchange). D33: the clipboard is read only when the person taps to paste,
// never on its own (not on open, not on coming back from a partner's window), so iOS's paste prompt only ever follows
// "Paste". Back from the partner's window (device.returned), the field takes focus and the screen's pill is "Paste the
// … you copied": the obvious next step. Nothing copied says so right under the field.
import { useEffect, useRef, useState } from "react";
import { readCopied } from "../clipboard.ts";
import { usePay } from "../runtime.tsx";

/** The pill's paste: reads once, on the person's tap. `none` is true after a tap that found nothing copied. */
export function usePaste(onChange: (text: string) => void) {
  const { bridge } = usePay();
  const [none, setNone] = useState(false);
  const paste = async () => {
    const t = await readCopied(bridge);
    setNone(!t);
    if (t) onChange(t);
  };
  return { paste, none, clear: () => setNone(false) };
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** The field's name for a screen reader. */
  label: string;
  /** From usePaste: the last tap found nothing copied. */
  none: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function PasteField({ value, onChange, label, none, placeholder = "Paste it here", autoFocus }: Props) {
  const { bridge } = usePay();
  const input = useRef<HTMLInputElement>(null);
  // Back from the partner's own window: focus only. Nothing is read until the person taps Paste (D33).
  useEffect(() => bridge.on("device.returned", () => input.current?.focus()), [bridge]);
  return (
    <>
      <label className="py-field" style={{ marginTop: 22 }}>
        <input ref={input} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
      </label>
      {none && !value && <p className="zf-small" role="status" style={{ marginTop: 8 }}>Nothing copied yet. Copy it there, then tap Paste.</p>}
    </>
  );
}
