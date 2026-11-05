// Audit C1 (3 Nov): any connected site's own wallet ("host:<host>"), beside the listed ones (site-wallets.ts). Its own
// module, loaded with the core's signing (subwallets.ts), never in Home's first load (speed budget).
import { sha256 } from "@noble/hashes/sha2.js";
import { SITE_WALLETS, siteWallet as listedWallet, type SiteWallet } from "./site-wallets.ts";

export { SITE_WALLETS };
/** A host a site wallet may be made for: a plain lower-case host name, with a port only when it isn't 443. */
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/;
/** The networks an unlisted site's own wallet may be on: Solana, BNB Chain, Robinhood Chain and the Browser wallet's four. */
const HOST_CHAINS: readonly string[] = ["sol", "bsc", "hood", "eth", "base", "arb", "gnosis"];
/** Audit C1 (3 Nov): an unlisted site's own wallet's place on its key path (hot-keys.ts kind "host"): 31 bits of
 *  sha256("zerofee-site/v1:" + host), so the words and the host alone make it again after a restore. */
export function hostIndex(host: string): number {
  const h = sha256(new TextEncoder().encode(`zerofee-site/v1:${host}`));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) & 0x7fffffff;
}
/** The site id of an unlisted host's own wallet ("host:app.example.com"), or null for a host that isn't plain. */
export const hostSite = (host: string): string | null => (HOST_RE.test(host) ? `host:${host}` : null);

/** A site's own wallet by its site: a listed one (SITE_WALLETS), or ("host:<host>", audit C1) any other connected
 *  site's, bound to exactly that host; `host` set: a site ZeroFee doesn't list, so it never signs with no sheet. */
export const siteWallet = (site: unknown): (SiteWallet & { host?: true }) | undefined => {
  if (typeof site !== "string") return undefined;
  if (site.startsWith("host:")) {
    const host = site.slice(5);
    return HOST_RE.test(host) ? { site, index: hostIndex(host), name: host, hosts: [host], chains: HOST_CHAINS, host: true } : undefined;
  }
  return listedWallet(site);
};
