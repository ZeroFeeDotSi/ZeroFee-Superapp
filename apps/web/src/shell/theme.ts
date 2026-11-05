// The person's light or dark choice (Settings → Appearance), on its own so the page's first script can apply it without
// loading Settings and everything it shows (speed, 2 Nov).
//
// Product decision, 4 Nov: the public website (the Sim and the real-money web wallet) opens black; the phone app keeps light. Only a
// choice the person made is kept (zf.theme.picked): until 4 Nov every first load wrote its own light into zf.theme, so
// that key can't tell a pick from a default and is no longer read.
import { SIM, WEB_MODES } from "../mode.ts";

export type Theme = "light" | "dark";
export const THEME_KEY = "zf.theme.picked";
/** What a page with no pick opens in: Black on the website and in the Sim (product decision, 5 Nov), whatever the browser's own
 *  light or dark setting says; the phone app keeps light. */
export const defaultTheme = (web: boolean = WEB_MODES || SIM): Theme => (web ? "dark" : "light");

/** Draws the theme; `keep` only when the person picked it (Settings), never on load. */
export function applyTheme(theme: Theme, keep = true) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  // the browser's own bar matches the page (index.html starts it white)
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
  if (!keep) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked: the choice holds for this visit
  }
}

export function savedTheme(web: boolean = WEB_MODES || SIM): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : defaultTheme(web);
  } catch {
    return defaultTheme(web);
  }
}
