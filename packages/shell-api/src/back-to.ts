// Where a step another app handed over goes back to (grade 02g, G6): Apps → pump.fun → Make $10 ready → Top up Spending
// opened Wallet's Top up, and its OK left the person on Wallet, not on pump.fun's page. The asking app names itself (and
// its own page) in the link: `back=social&tab=pumpfun`. Wallet sends the person back there when the step ends, done or not.
import type { AppId } from "./app-module.ts";

const APPS: readonly AppId[] = ["wallet", "pay", "trade", "extension", "browser", "social", "agent", "earn", "chat"];

export interface BackTo {
  app: AppId;
  tab?: string;
}

/** The link part an app adds to openApp(…, link) so the step comes back to it. `usd`: the amount the asking app needs
 *  (Apps' "Make $10 ready" with no cash opens a $10 Top up, UX walk 2 Nov), read with askedUsd. */
export function backLink(b: BackTo, usd?: number): string {
  return new URLSearchParams({ back: b.app, ...(b.tab ? { tab: b.tab } : {}), ...(usd !== undefined && Number.isFinite(usd) && usd > 0 ? { usd: String(usd) } : {}) }).toString();
}

/** The dollars the asking app named in the link (backLink's `usd`), or null: plain dollars and cents, under $1,000,000. */
export function askedUsd(link: string | undefined): string | null {
  const v = link ? new URLSearchParams(link).get("usd") : null;
  return v && /^\d{1,6}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : null;
}

/** The app (and page) to go back to, or null: only an app ZeroFee has, and a page name of plain letters. */
export function readBack(link: string | undefined): BackTo | null {
  if (!link) return null;
  const p = new URLSearchParams(link);
  const app = p.get("back") as AppId | null;
  if (!app || !APPS.includes(app)) return null;
  const tab = p.get("tab") ?? undefined;
  if (tab !== undefined && !/^[a-z0-9-]{1,32}$/.test(tab)) return { app };
  return { app, ...(tab ? { tab } : {}) };
}
