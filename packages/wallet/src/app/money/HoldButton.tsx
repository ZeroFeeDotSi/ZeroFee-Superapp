// Hold to send (the Home plan §1.3, §6): a ring fills over HOLD_MS while the finger stays down; let go early and nothing
// happens. Full: a buzz through the shell's own haptic bridge (device.haptic, the iPhone's Taptic Engine), then `onDone`,
// which sends: from a wallet the hold is the act (D143, no Face ID); from the Safe the Safe's own Approve sheet (Face ID)
// follows. The ring is CSS (a stroke drawn by a transition, send.css); the time is a
// timer (hold.ts), so Reduce Motion keeps the same hold with no drawing.
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { REAL_TIMERS, buzz, createHold, type HoldTimers } from "./hold.ts";

export function HoldButton({ label, disabled, onDone, bridge, timers = REAL_TIMERS, testId = "send-hold" }: { label: string; disabled: boolean; onDone: () => void; bridge?: Pick<Bridge, "call">; timers?: HoldTimers; testId?: string }) {
  const [holding, setHolding] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const hold = useRef<ReturnType<typeof createHold> | null>(null);
  hold.current ??= createHold({ timers, feel: (k) => buzz(bridge, k), done: () => done.current(), changed: setHolding });
  const h = hold.current;
  // a control turned off mid-hold (a line arrived) lets go; leaving the screen clears the timer
  useEffect(() => { if (disabled) h.stop(); }, [disabled]);
  useEffect(() => () => h.stop(), []);
  return (
    <button
      type="button"
      className={`zf-btn wl-hold${holding ? " is-holding" : ""}`}
      disabled={disabled}
      aria-label={holding ? "Keep holding" : label}
      data-testid={testId}
      onPointerDown={(e) => { e.preventDefault(); h.start(disabled); }}
      onPointerUp={() => h.stop()}
      onPointerLeave={() => h.stop()}
      onPointerCancel={() => h.stop()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); h.start(disabled); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") h.stop(); }}
    >
      <svg className="wl-hold__ring" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle className="wl-hold__track" cx="12" cy="12" r="10" />
        <circle className="wl-hold__fill" cx="12" cy="12" r="10" pathLength="100" />
      </svg>
      <span>{holding ? "Keep holding" : label}</span>
    </button>
  );
}
