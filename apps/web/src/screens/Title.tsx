// The title screen, which doubles as the loading screen: the mark draws itself, then the name and the promise rise
// in at the floor. Tapping replays it (a development convenience until onboarding exists).
import { useState } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { TAGLINE } from "../brand.ts";
import "./title.css";

export function Title() {
  const [run, setRun] = useState(0);
  return (
    <main className="title" key={run} onClick={() => setRun((n) => n + 1)} aria-label={`ZeroFee. ${TAGLINE}`}>
      <div className="title__mark">
        <Mark size={232} mode="once" />
      </div>
      <div className="title__words">
        <div className="title__name">ZeroFee</div>
        <div className="title__promise">{TAGLINE}</div>
      </div>
    </main>
  );
}
