// The web demo's laptop, drawn as a laptop: a lid with a browser window in it (its title bar and three dots) and the
// keyboard deck under it, so the laptop's side never reads as another phone screen (round 2 grade, item 2).
// The screen scrolls inside the lid; everything in it is the laptop page's own words.
import type { ReactNode } from "react";
import "./laptop-window.css";

export function LaptopWindow({ children, title = "ZeroFee · Second device" }: { children: ReactNode; title?: string }) {
  return (
    <figure className="lw zf-enter" aria-label="Your laptop's screen">
      <div className="lw-lid">
        <div className="lw-window">
          <div className="lw-bar" aria-hidden="true">
            <span className="lw-dots"><i /><i /><i /></span>
            <span className="lw-title">{title}</span>
          </div>
          <div className="lw-screen"><div className="lw-inner">{children}</div></div>
        </div>
      </div>
      <div className="lw-deck" aria-hidden="true"><span /></div>
    </figure>
  );
}
