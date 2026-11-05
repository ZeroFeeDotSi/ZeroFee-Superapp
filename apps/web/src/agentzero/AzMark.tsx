// AgentZero's presence (product decision, 3 Nov): the ZeroFee mark (Mark.tsx: a hairline ring with a slash) with a dot in its middle,
// alive, small, at the top of the screen in the app's name's place. It breathes (about 6 s); its dot pulses softly; while
// AgentZero thinks the ring turns slowly and the dot brightens; while it answers it pulses gently; behind a sheet or the
// menu it dims. It is the only colour in the app: Aurora on Black, Ocean on White (the orb's own palettes). SVG and CSS
// only: no shader, no canvas. A phone set to reduce motion gets a still mark; nothing moves while the tab or the page is
// hidden. Every moving part is an HTML layer moved by transform and opacity only (the glow a pseudo-element, the ring
// its own layer, the dot a span): never a transform on an SVG child, which Chrome and WebKit redo on the main thread
// every frame (perf finding, 3 Nov: the first mark cost a layout and a style pass per animation frame at idle).
import { useEffect, useId, useState, type CSSProperties } from "react";
import "./az-mark.css";

/** What AgentZero is doing, as the mark shows it. */
export type MarkMood = "rest" | "thinking" | "answering" | "sheet";

/** The page hidden (another iPhone app, the phone locked): nothing animates. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

export function AzMark({ mood = "rest", shown = true, size = 44 }: { mood?: MarkMood; shown?: boolean; size?: number }) {
  const id = useId().replace(/:/g, "");
  const hidden = usePageHidden();
  // a true hairline at any size (1.4 px), as Mark.tsx keeps its own; the drawing is 24 units wide
  const unit = size / 24;
  const style = { width: size, height: size, "--az-size": `${size}px`, "--az-stroke": `${1.4 / unit}`, "--az-knock": `${3.6 / unit}` } as CSSProperties;
  const grad = (g: string) => (
    <linearGradient id={g} gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="20" y2="20">
      <stop offset="0" className="az-c1" />
      <stop offset=".5" className="az-c2" />
      <stop offset="1" className="az-c3" />
    </linearGradient>
  );
  return (
    <span className="az-mark" data-m={mood} data-paused={!shown || hidden ? "" : undefined} style={style} role="img" aria-label={mood === "thinking" ? "AgentZero, thinking" : "AgentZero"}>
      {/* the glow is .az-mark::before (a gradient whose opacity and scale breathe); the body breathes on its own layer */}
      <span className="az-body" aria-hidden="true">
        {/* the ring: its own layer, so turning it while AgentZero thinks never redraws the page */}
        <span className="az-ring">
          <svg viewBox="0 0 24 24"><defs>{grad(`${id}g`)}</defs><circle cx="12" cy="12" r="8.2" stroke={`url(#${id}g)`} /></svg>
        </span>
        {/* still: where the slash meets the ring, the ring parts (Mark.tsx's knock); the slash, parted around the dot */}
        <svg className="az-still" viewBox="0 0 24 24">
          <defs>{grad(`${id}s`)}</defs>
          <path className="az-knock" d="M6.2 17.8 7.3 16.7M17.8 6.2 16.7 7.3" />
          <path className="az-slash" d="M6.2 17.8 10.2 13.8M13.8 10.2 17.8 6.2" stroke={`url(#${id}s)`} />
        </svg>
        <span className="az-dot" />
      </span>
    </span>
  );
}
