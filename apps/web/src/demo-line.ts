// The public site's one name for itself, in the browser tab and above the phone frame (product decision, 29 Oct: the web is the
// iPhone app). Only the Sim adds " · Sim" to the tab (privsec hunt M1, 5 Nov: the web wallet, real money, said Sim); inside
// the app the mode mark says which mode it is.
export const SITE_TITLE = "ZeroFee Superapp";
/** The browser tab's title: " · Sim" only on the Sim, never on Real (the web wallet). */
export const tabTitle = (sim: boolean): string => (sim ? `${SITE_TITLE} · Sim` : SITE_TITLE);
/** Sim can't start where the browser won't let it keep its own storage (sim-storage.ts: fail closed). */
export const SIM_BLOCKED = "Sim can't start in this browser. Try another browser.";
