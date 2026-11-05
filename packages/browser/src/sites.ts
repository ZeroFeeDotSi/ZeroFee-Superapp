// Which sites the Browser wallet answers, and how (Security's ruling on C.2, 26 Oct):
// - presets (presets.ts) and recipes whose wallet is the Browser wallet: known, on their exact hosts and chains;
// - any other https site the person opened: unknown, never pre-approved, so it gets an address only after the connect
//   sheet says "ZeroFee doesn't know this site. Only connect if you trust it.", except in a Browser tab, which connects
//   every site at once with its own new wallet (the product Browser thesis, 4 Nov: the host's `auto`, engine.ts);
// - none at all on a child's phone.
import { siteWallet } from "@zerofee/core/site-wallets";
import type { BrowserChain, SiteRule } from "./engine/engine.ts";
import { PRESETS, TYPED_SITE_CHAINS } from "./presets.ts";

/** The part of a recipe the Browser reads (packages/pay/src/partners/recipes.ts). */
export interface RecipeSites {
  name: string;
  hosts: readonly string[];
  wallet?: { kind: string; chains: readonly string[] };
}

const BROWSER_CHAINS: readonly string[] = ["sol", "eth", "base", "arb", "gnosis", "bsc", "hood"];

export function siteRules(options: { recipes?: readonly RecipeSites[]; child?: boolean }): (host: string) => SiteRule | null {
  const known = new Map<string, SiteRule>();
  for (const r of options.recipes ?? []) {
    // The card's window ("pay") is Pay's own engine, never this one.
    if (r.wallet?.kind !== "browser") continue;
    const chains = r.wallet.chains.filter((c): c is BrowserChain => BROWSER_CHAINS.includes(c));
    for (const host of r.hosts) known.set(host, { host, name: r.name, chains, known: true });
  }
  // A preset with its own wallet (core site-wallets.ts): that wallet, on the networks the core makes it on.
  for (const p of PRESETS) {
    const own = siteWallet(p.id);
    // every one of the preset's hosts is one the core binds the wallet to, and every chain it has one on
    // ST6 (product decision, 2 Nov): a site wallet the hub can fill and empty is on Solana only (Add and Take out are Solana's), so a
    // site's EVM side (GMGN's Base) is hidden: its page sees no EVM wallet of ZeroFee's, never one the hub can't show.
    const ownChains = own && p.hosts.every((h) => own.hosts.includes(h)) ? p.chains.filter((c) => own.chains.includes(c) && c === "sol") : [];
    // a site with its own wallet answers only on the networks it has it on: never the shared wallet behind its name.
    // Its own site sees that wallet's address with no connect sheet (Social trading: it opens signed in); the wallet is
    // for that site only, so its address tells the site nothing its first payment there wouldn't.
    for (const host of p.hosts) known.set(host, own && ownChains.length ? { host, name: p.name, chains: ownChains, known: true, wallet: own.site, ownChains, preapproved: true } : { host, name: p.name, chains: p.chains, known: true });
  }
  return (host) => {
    if (options.child) return null;
    host = host.toLowerCase();
    return known.get(host) ?? { host, name: host, chains: TYPED_SITE_CHAINS, known: false };
  };
}

/** What a typed address opens: an https URL, or null. "pump.fun" → https://pump.fun/; http:// is refused. */
export function siteUrl(typed: string): { url: string } | { problem: "invalid" | "insecure"; host?: string } {
  const text = typed.trim();
  if (!text || /\s/.test(text)) return { problem: "invalid" };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { problem: "invalid" };
  }
  if (u.protocol === "http:") return { problem: "insecure", host: u.host };
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return { problem: "invalid" };
  return { url: u.href };
}

/** A host that may be pretending: punycode labels (xn--) can draw letters that look like another site's. */
export const lookAlike = (host: string) => host.split(".").some((label) => label.startsWith("xn--"));
