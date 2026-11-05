// The web wallet's first screens (product decision, 4 Nov: like Phantom, NO Safe): Create my wallet (24 words shown once,
// then the same three-word check as the app's), or I already have one (24 words typed). `onWords` gets the words; the
// caller hands them on (before the lock: kept in memory for the App, web-start.ts; after it: account.web.import).
import { useState } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Check, Words } from "./Onboarding.tsx";
import { RestoreWords } from "./Recovery.tsx";
import { BRAND_LINE } from "../brand.ts";
import { WEB_START, newWebWords, typedWordsBack } from "./web-start.ts";

export { WEB_START };

type Step = { k: "welcome" } | { k: "words"; words: string[] } | { k: "check"; words: string[] } | { k: "import"; badWord?: number; wrong?: true; words?: string[] };

/** `made`: the words were made here (Create my wallet), so the wallet is new and empty; typed ones may hold money. */
export function WebStart({ onWords }: { onWords: (words: string[], made: boolean) => void }) {
  const [step, setStep] = useState<Step>({ k: "welcome" });
  if (step.k === "words") return <Words web words={step.words} onBack={() => setStep({ k: "welcome" })} onDone={() => setStep({ k: "check", words: step.words })} />;
  if (step.k === "check") return <Check web words={step.words} onBack={() => setStep({ k: "words", words: step.words })} onDone={() => onWords(step.words, true)} />;
  if (step.k === "import") {
    return (
      <RestoreWords
        web
        {...(step.badWord ? { badWord: step.badWord } : {})}
        {...(step.wrong ? { wrong: true } : {})}
        {...(step.words ? { initial: step.words } : {})}
        onBack={() => setStep({ k: "welcome" })}
        onSubmit={(words) => {
          const back = typedWordsBack(words);
          if (back) return setStep({ k: "import", ...back, words });
          onWords(words, false);
        }}
      />
    );
  }
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ob-center zf-enter">
        <Mark size={64} mode="still" />
        <div className="zf-label" style={{ marginTop: 34 }}>ZeroFee</div>
        <h1 className="zf-display" style={{ marginTop: 16 }}>{BRAND_LINE}</h1>
        <p className="zf-body" style={{ marginTop: 12 }}>{WEB_START.sub}</p>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        <button className="zf-btn" onClick={() => setStep({ k: "words", words: newWebWords() })}>{WEB_START.create}</button>
        <button className="zf-link" onClick={() => setStep({ k: "import" })}>{WEB_START.have}</button>
      </div>
    </div>
  );
}
