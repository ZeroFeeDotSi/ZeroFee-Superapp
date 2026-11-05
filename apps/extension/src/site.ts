// Which coin a supported site's page shows, read from the page's address only. The page's text is the page's to change,
// so it is never read: the launcher and the panel get the address from here, and the coin's name, logo and price come from
// the chain and market data. One reader for both, so they can't disagree about the coin.

export type SiteId = "axiom" | "pump" | "gmgn";
export interface Site { id: SiteId; name: string; host: string }

/** The sites the panel works on. The manifest's host access and content-script matches are exactly these (site.test.ts). */
export const SITES: Site[] = [
  { id: "axiom", name: "Axiom", host: "axiom.trade" },
  { id: "pump", name: "pump.fun", host: "pump.fun" },
  { id: "gmgn", name: "GMGN", host: "gmgn.ai" },
];
export const MATCHES = SITES.map((s) => `https://${s.host}/*`);

export type PageChain = "sol" | "bsc" | "base" | "other";

export interface PageCoin {
  site: SiteId;
  chain: PageChain;
  address: string;
  /** "coin": the address is the coin's own. "pool-or-coin": the site may name the coin's pool; the panel finds the coin on-chain. */
  names: "coin" | "pool-or-coin";
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
/** GMGN's chain names in its paths (sol, bsc, base, eth, tron, …): any other is "other", which the panel says it can't trade. */
const GMGN_CHAINS: Record<string, PageChain> = { sol: "sol", bsc: "bsc", base: "base" };

/** The supported site an address belongs to: https, the exact host, nothing that only ends like it. */
export function siteOf(href: string): Site | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  return SITES.find((s) => s.host === u.hostname) ?? null;
}

export function coinFromUrl(href: string): PageCoin | null {
  const site = siteOf(href);
  if (!site) return null;
  const u = new URL(href);
  const parts = u.pathname.split("/").filter(Boolean);
  if (site.id === "pump") {
    // /coin/<mint>
    if (parts.length !== 2 || parts[0] !== "coin" || !B58.test(parts[1]!)) return null;
    return { site: "pump", chain: "sol", address: parts[1]!, names: "coin" };
  }
  if (site.id === "gmgn") {
    // /<chain>/token/<address>; a shared link may put an invite code before the address ("<code>_<address>")
    if (parts.length !== 3 || parts[1] !== "token") return null;
    const chain = GMGN_CHAINS[parts[0]!.toLowerCase()] ?? "other";
    const address = parts[2]!.slice(parts[2]!.lastIndexOf("_") + 1);
    // Solana: base58; BNB Chain and Base: 0x; another chain (eth, tron, …): either, as the panel only says it can't trade it
    const fits = chain === "sol" ? B58.test(address) : chain === "other" ? B58.test(address) || EVM.test(address) : EVM.test(address);
    if (!fits) return null;
    return { site: "gmgn", chain, address: EVM.test(address) ? address.toLowerCase() : address, names: "coin" };
  }
  // axiom: /meme/<address>, the chain in ?chain= (Solana when absent)
  if (parts.length !== 2 || parts[0] !== "meme") return null;
  const address = parts[1]!;
  const q = (u.searchParams.get("chain") ?? "").toLowerCase();
  const chain: PageChain = q === "" || q === "sol" || q === "solana" ? "sol" : q === "bnb" || q === "bsc" ? "bsc" : q === "base" ? "base" : "other";
  if (chain === "sol" ? !B58.test(address) : !EVM.test(address)) return null;
  return { site: "axiom", chain, address: chain === "sol" ? address : address.toLowerCase(), names: "pool-or-coin" };
}
