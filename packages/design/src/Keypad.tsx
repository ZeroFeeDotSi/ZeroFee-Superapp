// The amount keypad: twelve big keys, no system keyboard sliding over the screen. The amount is typed with
// ./keypad.ts, so it is a decimal string from first tap to the bridge. Rebrand (DESIGN-REBRAND §2.2): each glyph sits in
// its own span (it gives under the finger while a soft disc fades in behind it), a key the amount can't take tells the
// caller (onRefuse: it shakes the figure and buzzes), and holding Delete clears the amount.
import { useRef, type CSSProperties } from "react";
import { isRefused, press, type Key } from "./keypad.ts";
import "./keypad.css";

const KEYS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
/** How long Delete is held before it clears the whole amount. */
export const CLEAR_HOLD_MS = 450;

/** `box`: attributes for the keypad's own box, e.g. wallet restsProps (inert and dimmed while its sheet can't go, audit 16's
 *  G1), where a wrapper would break the sheet's own layout (Swap's `> .zf-keypad` rows). */
export function Keypad({ value, decimals, onChange, onRefuse, box }: { value: string; decimals: number; onChange: (v: string) => void; onRefuse?: (() => void) | undefined; box?: { inert?: true; "aria-disabled"?: true; "data-rests"?: "1"; style?: CSSProperties } }) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; cleared: boolean } | null>(null);
  const endHold = () => { if (hold.current) clearTimeout(hold.current.timer); };
  const tap = (k: Key) => {
    if (k === "del" && hold.current?.cleared) { hold.current = null; return; }
    const next = press(value, k, decimals);
    if (isRefused(value, next, k)) onRefuse?.();
    onChange(next);
  };
  return (
    <div className="zf-keypad" role="group" aria-label="Amount" {...box}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => tap(k)}
          onPointerDown={k === "del" ? () => { endHold(); hold.current = { cleared: false, timer: setTimeout(() => { if (hold.current) hold.current.cleared = true; onChange("0"); }, CLEAR_HOLD_MS) }; } : undefined}
          onPointerUp={k === "del" ? endHold : undefined}
          onPointerLeave={k === "del" ? endHold : undefined}
          onPointerCancel={k === "del" ? endHold : undefined}
          aria-label={k === "del" ? "Delete" : k === "." ? "Point" : undefined}
          disabled={k === "." && decimals === 0}
        >
          {k === "del" ? (
            <span><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M9 6h11v12H9l-5-6 5-6ZM13 10l4 4M17 10l-4 4" /></svg></span>
          ) : <span>{k}</span>}
        </button>
      ))}
    </div>
  );
}
