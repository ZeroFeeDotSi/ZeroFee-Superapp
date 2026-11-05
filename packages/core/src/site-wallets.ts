// A site's own wallet (product decision, 2 Nov, B15/B24: "each site app gets its own created wallet, shown in that app's own
// settings"; FLOW-V3 part C, "Sites are apps"). Each site in this fixed table has one wallet per network of its own,
// made from the backup words at its own place on the key path (hot-keys.ts, kind "site", the site's index), so a
// restore brings it back. The core binds it to the site: it signs and sends only for a page on one of the site's own
// hosts, never for Trade, Chat, ZeroFee's own screens or another site. Money reaches it only through Spending's moves
// (Make ready), and leaves it the same way, or by the person's own export.
//
// The index is the wallet's place on the key path: it never changes and is never reused. A new site takes the next one.
export interface SiteWallet {
  /** The Browser preset's id ("pump"). */
  site: string;
  /** Its place on the key path (0–15): fixed for ever. */
  index: number;
  /** Its name on the sheet: "From your pump.fun wallet". */
  name: string;
  /** The exact hosts it signs for, as WebKit reports the page's origin. */
  hosts: readonly string[];
  /** The networks it has a wallet on: the site's own (the Browser preset's chains). */
  chains: readonly string[];
  /** AgentZero's own pocket (D90), not a site: no hosts, so it signs for no web page; never a Social trading tile. */
  agent?: true;
}

export const SITE_WALLETS: readonly SiteWallet[] = [
  { site: "pump", index: 0, name: "pump.fun", hosts: ["pump.fun"], chains: ["sol"] },
  { site: "gmgn", index: 1, name: "GMGN", hosts: ["gmgn.ai"], chains: ["sol", "base"] },
  { site: "jupiter", index: 2, name: "Jupiter", hosts: ["jup.ag"], chains: ["sol"] },
  { site: "raydium", index: 3, name: "Raydium", hosts: ["raydium.io"], chains: ["sol"] },
  { site: "orca", index: 4, name: "Orca", hosts: ["www.orca.so"], chains: ["sol"] },
  { site: "kamino", index: 5, name: "Kamino", hosts: ["kamino.com"], chains: ["sol"] },
  { site: "sanctum", index: 6, name: "Sanctum", hosts: ["app.sanctum.so"], chains: ["sol"] },
  // D90: AgentZero's pocket for the copy job. Its balance is all it may spend: it can't spend what it doesn't hold. Filled
  // from Spending (the person's own Approve), emptied home the same way as a site's wallet (D60).
  { site: "agentzero", index: 7, name: "AgentZero's pocket", hosts: [], chains: ["sol"], agent: true },
];

/** Is this AgentZero's pocket (D90), not a site's wallet? */
export const isAgentPocket = (site: unknown): boolean => siteWallet(site)?.agent === true;

/**
 * The sites AgentZero's own window signs in to with its pocket (bug report, 5 Nov; QA's ruling (a)–(d)): these
 * exact hosts only, a sign-in message only (never a transaction: siteBinding keeps refusing the pocket for those), never
 * the person's SOL wallet or one of their site wallets. The pocket still has no hosts of its own above, so no other path
 * (a site's own window, a Browser tab, an app's call) ever reaches it.
 */
export const AGENT_SIGN_IN_HOSTS: readonly string[] = ["pump.fun", "gmgn.ai"];

/** A LISTED site's own wallet by its site (SITE_WALLETS). An unlisted host's own wallet ("host:<host>", audit C1) is read
 *  by site-hosts.ts siteWallet, loaded with the core's signing, never in Home's first load. */
export const siteWallet = (site: unknown): (SiteWallet & { host?: true }) | undefined => (typeof site === "string" ? SITE_WALLETS.find((s) => s.site === site) : undefined);
