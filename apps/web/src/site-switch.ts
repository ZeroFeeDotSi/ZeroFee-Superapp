// The public site's Sim | Real switch (product decision, 4 Nov: "on top of the phone thing there should be a toggle that
// is Sim Real"). Above the phone frame on a computer, at the top of the page above the app on a phone's browser (app.css
// .zf-site-switch). Only where WEB_MODES is on: never in the extension (D157) or the phone app. The page's own DOM, no
// React, so it is there before any app code loads; a tap on the other side keeps the choice and starts the page again
// in that mode (mode.ts switchWebMode). It replaces the Sim pill's "Use real money instead" link.
import { switchWebMode, type WebMode } from "./mode.ts";
import { SIM_LABEL } from "./shell/mode-mark.ts";
import { MONEY_LABEL } from "./shell/settings-words.ts";

/** Its two sides, Settings' words (SettingsPanel's Money switch): Sim is the sample money, Real is the web wallet. */
export const SITE_SIDES = [
  { mode: "sim", label: SIM_LABEL },
  { mode: "web", label: "Real" },
] as const satisfies readonly { mode: WebMode; label: string }[];

/** Each side and whether it is the one this page is in (`sim`: the page runs on sample money). */
export const siteSides = (sim: boolean) => SITE_SIDES.map((s) => ({ ...s, on: (s.mode === "sim") === sim }));

/** Draw the switch at the top of the page, before the app's root. A tap on the side already on does nothing. */
export function mountSiteSwitch(doc: Document, sim: boolean, go: (mode: WebMode) => void = switchWebMode): HTMLElement {
  const bar = doc.createElement("div");
  bar.className = "zf-site-switch";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", MONEY_LABEL);
  for (const side of siteSides(sim)) {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = side.label;
    b.setAttribute("aria-pressed", String(side.on));
    b.addEventListener("click", () => {
      if (!side.on) go(side.mode);
    });
    bar.append(b);
  }
  doc.documentElement.dataset.siteSwitch = "";
  const root = doc.getElementById("root");
  if (root) root.before(bar);
  else doc.body.prepend(bar);
  return bar;
}
