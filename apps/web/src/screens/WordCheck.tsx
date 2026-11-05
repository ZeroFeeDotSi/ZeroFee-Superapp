// The backup word check (finding 36): three rounds, a guess never passes. Loaded with the words before it (Onboarding's
// Check), never in Home's first load.
import { useState } from "react";
import { CHECK_MISSED, CHECK_STOPPED, pickWord, startCheck, type CheckState } from "./word-check.ts";
import { CANT_SHOW_AGAIN, Top, WEB_SHOW_AGAIN, WordsTop } from "./Onboarding.tsx";

/** Three quick rounds: tap the right word. A wrong pick brings a new word with new choices; a second wrong pick stops the
 *  check until the person has looked at the paper (finding 36: a guess must never pass). The core checks the words
 *  again. It is never skipped (J2, B2): the words can't be shown again after this. */
export function Check({ words, onBack, onDone, renew = false, moneyIn, web = false }: { words: string[]; onBack: () => void; onDone: (positions: number[], picked: string[]) => void; renew?: boolean; moneyIn?: boolean; web?: boolean }) {
  const [s, setS] = useState<CheckState>(() => startCheck(words));
  const pick = (w: string) => {
    const r = pickWord(s, words, w);
    setS(r.state);
    if (r.done) onDone(r.done.positions, r.done.picked);
  };
  if (s.stopped) {
    return (
      <div className="zf-screen zf-pad">
        {web ? <Top label="" onBack={onBack} /> : renew ? <Top label="New backup words" onBack={onBack} /> : <WordsTop moneyIn={moneyIn} onBack={onBack} />}
        <div className="ob-center zf-enter" style={{ marginTop: 68 }}>
          <h1 className="zf-title">{CHECK_STOPPED.title}</h1>
          <p className="zf-small" style={{ marginTop: 8 }}>{CHECK_STOPPED.line}</p>
        </div>
        <div className="zf-fill" />
        <div className="zf-floor">
          <button className="zf-btn" onClick={onBack}>See my words again</button>
        </div>
      </div>
    );
  }
  const r = s.now;
  return (
    <div className="zf-screen zf-pad">
      {web ? <Top label="" onBack={onBack} /> : renew ? <Top label="New backup words" onBack={onBack} /> : <WordsTop moneyIn={moneyIn} onBack={onBack} />}
      <div className="ob-center" style={{ marginTop: 40 }}>
        <h1 className="zf-title zf-enter" key={r.pos} style={{ marginTop: 28 }}>Which is word {r.pos}?</h1>
        <p className="zf-small" style={{ marginTop: 8 }}>{s.missed ? CHECK_MISSED : "Tap the one on your paper. Three checks."}</p>
      </div>
      <div className="ob-options zf-enter-2" key={`o${r.pos}`} translate="no">
        {r.options.map((w) => (
          <button key={w} className="ob-option" onClick={() => pick(w)}>{w}</button>
        ))}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {!renew && <p className="zf-small">{web ? WEB_SHOW_AGAIN : CANT_SHOW_AGAIN}</p>}
        <button className="zf-link" onClick={onBack}>See my words again</button>
      </div>
    </div>
  );
}
