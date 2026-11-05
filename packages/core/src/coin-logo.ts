// A coin's logo, one source for every screen (product decision, 3 Nov: Home drew a bought memecoin, MAMESUKE, as a plain "M"
// tile while Trade showed its picture). A coin is named by its chain and its address alone: the relay's
// GET /v0/market/logo?c=<chain>&a=<address> (apps/quotes logo.mjs) finds its picture from the coin's own on-chain
// metadata (Metaplex / Token-2022 uri → its image, IPFS over several gateways), the token lists, then GeckoTerminal,
// and Vercel's edge keeps it for a week, so the sources see one ask per coin, not one per person. The phone asks the
// relay only: no image host sees the person's address or their IP, and the url never carries a wallet address.
// Home, Activity and AgentZero use this; Trade builds the very same url (packages/trade/src/market/index.ts relayLogo),
// so the edge's copy is shared. The letter tile is only what shows while the picture loads, or for a coin no source names.
import { relayBase } from "./relay.ts";

/** The chains the relay finds logos on. */
export type LogoChain = "sol" | "bsc" | "hood" | "near";
export const LOGO_CHAINS: readonly LogoChain[] = ["sol", "bsc", "hood", "near"];

/** The relay's own check (apps/quotes logo.mjs logoRequestOk), so the phone never asks for a url it would refuse. */
export function logoAddressOk(chain: string, a: unknown): chain is LogoChain {
  if (typeof a !== "string") return false;
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "bsc" || chain === "hood") return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain === "near") return a.length >= 2 && a.length <= 64 && /^(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/.test(a);
  return false;
}

/** The relay this build talks to (VITE_ZEROFEE_RELAY), or undefined. */
export function buildRelay(): string | undefined {
  return relayBase((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_RELAY);
}

/** The coin's logo url on the relay, by chain and address only; undefined with no relay or an address it wouldn't take.
 *  A NEAR coin given as "nep141:<contract>" is named by its contract. */
export function coinLogoUrl(relay: string | undefined | null, chain: string, address: string): string | undefined {
  const a = chain === "near" ? address.replace(/^nep141:/, "") : address;
  if (!relay || !logoAddressOk(chain, a)) return undefined;
  return `${relay.replace(/\/+$/, "")}/v0/market/logo?c=${chain}&a=${encodeURIComponent(a)}`;
}
