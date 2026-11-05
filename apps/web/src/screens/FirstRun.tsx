// A browser's first visit (the user robot's walk, 29 Oct; PAR 8, grade 1 Nov c): Welcome → Make your key, with the terms
// and the recovery wait's one line on it → then the lock (UnlockGate's passkey or passcode). Bringing an account back:
// Welcome → the terms → the lock. Before this, the first screen was "Lock ZeroFee on this device", ahead of any
// welcome. The choice made here (create or restore) is handed to the app once the lock is set, so the app goes straight
// on and never shows Welcome twice.
import { useState } from "react";
import { MakeKey, Welcome } from "./Onboarding.tsx";
import { MAINNET, SAMPLE_LINK, WEB_MODES, otherMode } from "../mode.ts";
import { Terms } from "./Terms.tsx";
import { termsAccepted } from "../terms.ts";
import { markSetupUnfinished } from "./setup-unfinished.ts";
import { setChosenDelay, setFirstChoice, setupChoices } from "./first-run-state.ts";

const mark = markSetupUnfinished;

// The choice and the wait chosen here are kept in first-run-state.ts (the App reads them in Home's first load without
// these screens: speed budget, 5 Nov).
export { chosenDelay, setChosenDelay, setupChoices, setupFinished, setupUnfinished, takeFirstChoice, type FirstChoice } from "./first-run-state.ts";

export function FirstRun({ onDone }: { onDone: (lockNow?: boolean) => void }) {
  const [step, setStep] = useState<"welcome" | "terms" | "makekey">("welcome");
  // what the terms screen goes on to: bringing an account back, or being a second phone (both lock first)
  const [after, setAfter] = useState<"restore" | "guard">("restore");
  const choices = setupChoices(MAINNET);
  const [wait, setWait] = useState(() => (choices.find((c) => c.default) ?? choices[0]).seconds);
  // Bringing an account back locks with the passkey on its own tap too (grade 01d, D13): no separate lock screen.
  const restore = () => {
    setFirstChoice("restore");
    mark(true);
    onDone(true);
  };
  // The guardian key keeps its own vault, locked as the app is: lock, then its screen. No account is made.
  const guard = () => {
    setFirstChoice("guard");
    onDone(true);
  };
  if (step === "terms") return <Terms onBack={() => setStep("welcome")} onAgree={after === "guard" ? guard : restore} />;
  // Make my key agrees to the terms (when not yet) and locks ZeroFee with the passkey on the same tap (D13).
  if (step === "makekey") {
    return <MakeKey wait={{ choices, seconds: wait, onChange: setWait }} terms={!termsAccepted()} onBack={() => setStep("welcome")} onContinue={() => { setChosenDelay(wait); setFirstChoice("create"); mark(true); onDone(true); }} />;
  }
  return <Welcome onCreate={() => setStep("makekey")} onRestore={() => (termsAccepted() ? restore() : (setAfter("restore"), setStep("terms")))} onGuard={() => (termsAccepted() ? guard() : (setAfter("guard"), setStep("terms")))} {...(WEB_MODES ? { other: otherMode()! } : SAMPLE_LINK ? { onSample: () => location.assign("/?demo") } : {})} money={MAINNET} />;
}
