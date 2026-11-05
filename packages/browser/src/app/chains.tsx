// The networks the Browser shows, with the shared set's marks (packages/design/src/logos), the presets' own marks
// (./logos/SOURCE.md), and the small pieces every tab draws them with.
import { logoUrl } from "@zerofee/design/logos.ts";
import type { BrowserChain } from "../engine/engine.ts";
import { SiteMark } from "./icons.tsx";
import fomoLogo from "./logos/fomo.png";
import gmgnLogo from "./logos/gmgn.png";
import jupiterLogo from "./logos/jupiter.png";
import kaminoLogo from "./logos/kamino.png";
import mtpelerinLogo from "./logos/mtpelerin.png";
import orcaLogo from "./logos/orca.png";
import pumpLogo from "./logos/pump.png";
import raydiumLogo from "./logos/raydium.png";
import sanctumLogo from "./logos/sanctum.png";

export const CHAIN: Record<BrowserChain, { name: string; logo?: string; symbol: string }> = {
  sol: { name: "Solana", logo: logoUrl("sol"), symbol: "SOL" },
  eth: { name: "Ethereum", logo: logoUrl("eth"), symbol: "ETH" },
  base: { name: "Base", logo: logoUrl("base"), symbol: "ETH" },
  arb: { name: "Arbitrum", logo: logoUrl("arb"), symbol: "ETH" },
  gnosis: { name: "Gnosis", logo: logoUrl("gnosis"), symbol: "xDAI" },
  bsc: { name: "BNB Chain", logo: logoUrl("bsc"), symbol: "BNB" },
  hood: { name: "Robinhood Chain", logo: logoUrl("eth"), symbol: "ETH" },
};

/** Each preset's own mark, by the preset's id (presets.ts), never by anything a page says about itself. */
export const PRESET_LOGO: Record<string, string> = {
  fomo: fomoLogo, pump: pumpLogo, gmgn: gmgnLogo, mtpelerin: mtpelerinLogo,
  jupiter: jupiterLogo, raydium: raydiumLogo, sanctum: sanctumLogo, orca: orcaLogo, kamino: kaminoLogo,
};

export const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export const short = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);

export function Logo({ src, size = 30 }: { src?: string; size?: number }) {
  return <span className="br-logo" style={{ width: size, height: size }}>{src ? <img src={src} alt="" width={size} height={size} /> : <SiteMark />}</span>;
}
