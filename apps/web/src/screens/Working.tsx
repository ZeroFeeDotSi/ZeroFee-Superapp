// "One moment…" and the opening's steps (the App's boot, reroute and every lazy screen's fallback draw it): on its own so
// Home's first load has it without the rest of set-up (Onboarding.tsx; speed budget, 5 Nov). Its look is onboarding.css's.
import { Mark } from "@zerofee/design/Mark.tsx";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
// the thread's look first, as Onboarding.tsx loads it, so the styles keep their order
import "@zerofee/design/thread.css";
import "./onboarding.css";

/** The phone makes the key in its secure chip behind Face ID; a browser keeps it on the device, encrypted (D20). */
const phone = onPhone();

/** The first run's three steps (the core's account.create.step), in the order the core does them. */
export const OPENING_STEPS = ["Making your account", phone ? "Locking it to this phone" : "Locking it to this device", "Double-checking it"];

/** `steps` and `at` (1-based, the step the core is on): each line ticks once the core has moved past it. */
export function Working({ text, steps, at = 0 }: { text: string; steps?: readonly string[]; at?: number }) {
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ob-center">
        <Mark size={120} mode="loading" />
        <p className="zf-small" style={{ marginTop: 34 }}>{text}</p>
        {/* the design review §4.2: one line that changes ("Making your account" → "Locking it…" → "Double-checking it"),
            never a checklist (one progress device in the app: the thread) */}
        {steps && <p className="ob-step-now" aria-live="polite">{steps[Math.max(0, Math.min(steps.length, at || 1) - 1)]}</p>}
      </div>
      <div className="zf-fill" />
    </div>
  );
}

