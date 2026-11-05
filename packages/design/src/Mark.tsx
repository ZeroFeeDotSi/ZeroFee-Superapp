// The ZeroFee mark: a hairline ring with a slash through it. It draws itself: the ring from a point at the top, then
// the slash cuts through. `mode="once"` draws and stays (the title screen); `mode="loading"` keeps drawing, fading
// and redrawing while something is in progress. Phones set to reduce motion get the finished mark.
import type { CSSProperties } from "react";
import "./mark.css";

export function Mark({ size = 232, mode = "once", label }: { size?: number; mode?: "once" | "loading" | "still"; label?: string }) {
  // Keep the line a true hairline (1.25 px) at any size, with an 8.5 px gap where the slash crosses the ring. The drawing
  // is 24 units wide, so both are converted from pixels to drawing units.
  const unit = size / 24;
  const style = { width: size, height: size, "--zf-stroke": `${1.25 / unit}`, "--zf-knock": `${8.5 / unit}` } as CSSProperties;
  return (
    <div className={`zf-mark zf-mark--${mode}`} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 24 24">
        <circle className="zf-ring" cx="12" cy="12" r="8.2" />
        <path className="zf-knock" d="M6.2 17.8 17.8 6.2" />
        <path className="zf-slash" d="M6.2 17.8 17.8 6.2" />
      </svg>
    </div>
  );
}
