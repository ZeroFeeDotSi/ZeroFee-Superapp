// D160 (the Browser's thesis: every site gets its own wallet): a site's own wallet's name on a sheet or a row, a listed
// site's ("pump.fun") or an unlisted host's own wallet's host ("app.example.com"). Its own small module, loaded with the
// first ask that needs it (Spending's Top up for a site, a site Add's cost), never in Home's first load.
import { siteWallet } from "./site-wallets.ts";

/** An unlisted host's own wallet's site id ("host:app.example.com", audit C1), as site-hosts.ts makes it: the host is
 *  plain, lower case, with a port only when it isn't 443. */
const HOST_SITE = /^host:((?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?)$/;

/** A site's own wallet's name: a listed site's, or an unlisted host's own wallet's host; none for anything else. */
export const siteNameOf = (site: unknown): string | undefined => siteWallet(site)?.name ?? (typeof site === "string" ? HOST_SITE.exec(site)?.[1] : undefined);
