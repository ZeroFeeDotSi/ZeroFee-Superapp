// The extension's stand-in for apps/web/src/demo-line.ts: the site's name and the Sim's words are the website's, never the
// extension's (its side panel is the app itself, with no Sim).
export const SITE_TITLE = "ZeroFee";
export const tabTitle = (_sim: boolean): string => SITE_TITLE;
export const SIM_BLOCKED = "";
