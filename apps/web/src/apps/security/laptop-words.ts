// Where the person finds their laptop's pairing code, said the way the iPhone app says it (H13).
//
// - Mainnet (the iPhone app, and the real app in a browser): the laptop page's one fixed public address (LAPTOP_SITE,
//   its own origin: laptop.zerofee.si), with a Copy for it. Never the page's own host: on the phone that is "app", which no one can open
//   on a laptop.
// - The public web demo (sample money): the app's own instruction, no address (its laptop is drawn beside the phone).
// - Testnet (developers, the test alpha): an address that works, never a dead instruction (grade 01d P17): this
//   page's own host and /laptop. A local one says to use another browser: a browser is never its own account's second
//   device (K-8). The iPhone's test build (host "app") has no laptop page to name, and never a developer's command or a
//   localhost (grade 02e, E12): it says plainly that adding a laptop opens at launch, naming no address.
import { LAPTOP_PATH, SECOND_DEVICE_SITE } from "../../mode.ts";

/** "On your laptop, open ZeroFee and choose Second device": the app's own words, with no address. */
export const OPEN_ON_LAPTOP = "On your laptop, open ZeroFee and choose Second device";
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
/**
 * The laptop page's public address, on mainnet: null until laptop.zerofee.si (SECOND_DEVICE_SITE, its own origin,
 * 5 Nov) answers 200 with the laptop page (QA's MUST: no flip before the page is live). Today it answers 404:
 * zerofee.si is the website's own Vercel project (zerofee-site), which must first serve the laptop build
 * (VITE_ZEROFEE_TARGET=second-device: mainnet whatever the address says) at /laptop. The flip is this one line,
 * `= SECOND_DEVICE_SITE`, on its own branch with apps/web/check-laptop-site.sh, which fails unless the live page answers.
 * Null: mainnet doesn't offer "Add my laptop" (UX walk 2 Nov: it sent people to a 404) and says LAPTOP_SOON.
 */
export const LAPTOP_SITE: string | null = SECOND_DEVICE_SITE;
/** Does the laptop page answer on mainnet? Exactly when LAPTOP_SITE is set. */
export const LAPTOP_SITE_LIVE: boolean = LAPTOP_SITE !== null;
/** Mainnet before launch: in place of "Add my laptop", what is true and what works now. */
export const LAPTOP_SOON = "Adding a laptop opens when ZeroFee launches. A spare phone or a guardian works now.";
/** The iPhone's test build: no laptop page to name (E12), and no address the operator hasn't picked. */
export const AT_LAUNCH = LAPTOP_SOON;

/** Is this a production build (Vite's PROD)? A production build never names a local address (the copy review's desktop audit, 5 Nov:
 *  "open localhost:5209/laptop" in a sentence). */
export const PROD_BUILD: boolean = import.meta.env?.PROD === true;
/** The page's own origin as a person types it: the scheme and "://" dropped, the host kept (a bare host stays as it is). */
const typed = (origin: string): string => origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "").toLowerCase();

/** The laptop page's address to name; null in the public demo (its laptop is drawn beside the phone; its /laptop opens
 *  the Sim, mode.ts parseMode), on the iPhone's test build (no page to name), on mainnet until that page is served
 *  (LAPTOP_SITE), and for a local origin in a production build. `origin`: the page's own (location.origin). */
export function laptopPage(publicBuild: boolean, origin: string | undefined, mainnet = false, site: string | null = LAPTOP_SITE, prod = PROD_BUILD): string | null {
  if (publicBuild) return null;
  if (mainnet) return site;
  const host = origin ? typed(origin) : "";
  if (prod && LOCAL.test(host)) return null;
  return host && (host.includes(".") || LOCAL.test(host)) ? `${host}${LAPTOP_PATH}` : null;
}

/** The pairing steps' first line, where the code shows, and the address to copy (when one is named). `later`: there is
 *  no laptop page here yet, so nothing to pair now (the iPhone's test build). */
export function laptopWords(publicBuild: boolean, origin: string | undefined, mainnet = false, site: string | null = LAPTOP_SITE, prod = PROD_BUILD): { open: string; where: string; address?: string; later?: true } {
  const page = laptopPage(publicBuild, origin, mainnet, site, prod);
  const host = origin ? typed(origin) : undefined;
  if (!page && !publicBuild && mainnet) return { open: LAPTOP_SOON, where: LAPTOP_SOON, later: true };
  if (!page && !publicBuild) return { open: AT_LAUNCH, where: AT_LAUNCH, later: true };
  if (!page) return { open: OPEN_ON_LAPTOP, where: "Your laptop shows it in ZeroFee, under Second device." };
  const how = host && LOCAL.test(host) && !mainnet ? ", in a different browser from this one" : "";
  return { open: `On your laptop, open ${page}`, where: `Your laptop shows it at ${page}${how}.`, address: page };
}
