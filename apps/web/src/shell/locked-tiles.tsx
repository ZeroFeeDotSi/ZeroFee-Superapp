// The locked tiles (D141, product decision, 3 Nov): Earn, Perps and Predict, "just icons, and locked". A hairline icon with a small
// lock in its corner and the name, in the tray and, when a person drags one into the first four places, in the bottom
// row (D147), so they load with the shell. A tap opens their "Coming soon" sheet (locked-apps.tsx, loaded later).
import type { ReactNode } from "react";
import type { TrayApp } from "@zerofee/design/Tray.tsx";

const P = (d: string) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d={d} /></svg>
);
/** Earn: a sprout. Perps: one arrow up, one down. Predict: a crystal ball on its stand. */
const GLYPHS: Record<string, string> = {
  earn: "M12 20v-7.5M12 12.5c0-3.6 2.4-6 6.5-6 0 4-2.5 6-6.5 6ZM12 15c0-3-2-5-5.5-5 0 3.4 2 5 5.5 5Z",
  perps: "M8 19V5M4.5 8.5 8 5l3.5 3.5M16 5v14m-3.5-3.5L16 19l3.5-3.5",
  predict: "M12 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM9.4 7.8A3 3 0 0 1 12 6.5M8.5 16.5l-1.5 4h10l-1.5-4",
};
const LOCK = (
  <span className="zf-tray__lock" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 24 24"><path className="zf-hl" style={{ strokeWidth: 2.6 }} d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3M5.5 11h13v9.5h-13z" /></svg>
  </span>
);

/** The tiles: the glyph with its lock (the sheet shows the glyph alone, `glyph`). */
export const LOCKED_APPS: readonly (TrayApp & { glyph: () => ReactNode })[] = [["earn", "Earn"], ["perps", "Perps"], ["predict", "Predict"]].map(([id, label]) => ({
  id: id!,
  label: label!,
  locked: true,
  glyph: () => P(GLYPHS[id!]!),
  icon: () => <>{P(GLYPHS[id!]!)}{LOCK}</>,
}));
