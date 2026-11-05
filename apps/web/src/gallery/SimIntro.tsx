// The public site's first screen (D157, 3 Nov): superapp.zerofee.si is the Sim, the whole app on pretend
// money, because a browser tab can't do it all. Real money is the iPhone app and, on a computer, the Chrome extension
// (it is offered only after its security review). Shown once, before set-up; the set-up anatomy of the
// revamp (glyph, title, one line; then one button). Words: the Copywriter.
import { Mark } from "@zerofee/design/Mark.tsx";

import { INTRO_EXTENSION, INTRO_LINE, INTRO_SOURCE, INTRO_TITLE, INTRO_TRY, keepIntroSeen } from "./sim-intro.ts";

export function SimIntro({ onTry }: { onTry: () => void }) {
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ob-center ob-hero zf-enter">
        <Mark size={64} mode="still" />
        <h1 className="zf-title" style={{ marginTop: 28 }}>{INTRO_TITLE}</h1>
        <p className="zf-body" style={{ marginTop: 12 }}>{INTRO_LINE}</p>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        <button className="zf-btn" onClick={() => { keepIntroSeen(); onTry(); }}>{INTRO_TRY}</button>
        <p className="zf-small">{INTRO_EXTENSION}</p>
        <p className="zf-small">{INTRO_SOURCE}</p>
      </div>
    </div>
  );
}
