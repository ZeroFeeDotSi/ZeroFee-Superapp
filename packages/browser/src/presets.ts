// The sites the Browser knows by name. Each one counts as a recipe host for Security's rule C.2: the wallet answers it
// on exactly these hosts (no wildcards, no paths) and these chains. Every change to this file is reviewed by Security,
// who is sent its SHA. A site that isn't here still opens: in a Browser tab it is connected at once with its own new
// wallet (the product Browser thesis, 4 Nov; engine.ts `auto`), anywhere else only after the connect sheet says
// "ZeroFee doesn't know this site" (sites.ts). Either way an unknown site's trades ask on the core's sheet.
import type { BrowserChain } from "./engine/engine.ts";

export interface Preset {
  id: string;
  name: string;
  /** Where the preset opens. Always on one of `hosts`. */
  url: string;
  /** Exact hosts, as WebKit reports the top frame's origin. */
  hosts: readonly string[];
  /** The Browser wallet's chains on this site; the first EVM chain is where it starts. */
  chains: readonly BrowserChain[];
  /** Ask for the desktop page (desktop user agent and layout), as Safari's "Request Desktop Website" does. */
  desktop?: boolean;
  /** On the phone, open the site's own app instead of a window (fomo only: the host accepts fomo.family alone). */
  ownApp?: boolean;
  /** One line under the name. */
  line: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "fomo",
    name: "fomo",
    url: "https://fomo.family/",
    hosts: ["fomo.family"],
    chains: ["sol", "base"],
    // fomo.family has no phone web app (probed 30 Oct: under 800 CSS px, signed in or not, it is a "get the app" page,
    // whatever the user agent), and its computer page shrunk onto a phone was rejected. So on the phone it opens in
    // fomo's own app (social/fomo-app.ts, PartnerApp in PartnerBridge.swift), from the Browser as from Social trading.
    ownApp: true,
    line: "Trade with friends",
  },
  {
    id: "pump",
    name: "pump.fun",
    url: "https://pump.fun/",
    hosts: ["pump.fun"],
    chains: ["sol"],
    line: "New coins on Solana",
  },
  {
    id: "gmgn",
    name: "GMGN",
    url: "https://gmgn.ai/",
    hosts: ["gmgn.ai"],
    // GMGN connects outside wallets on Solana and on EVM chains; the social wallet answers on Solana, and on Base
    // with the Browser wallet's own Base address.
    chains: ["sol", "base"],
    line: "Fast trades on Solana",
  },
  // Apps' apps (social/catalog.ts), each listed after a phone-width probe showed "ZeroFee" in its own
  // wallet list (30 Oct; docs/layers/browser.md). Solana only: the apps wallet is the Browser wallet on Solana.
  {
    id: "jupiter",
    name: "Jupiter",
    url: "https://jup.ag/",
    hosts: ["jup.ag"],
    chains: ["sol"],
    line: "Swap on Solana",
  },
  {
    id: "raydium",
    name: "Raydium",
    url: "https://raydium.io/swap/",
    hosts: ["raydium.io"],
    chains: ["sol"],
    line: "Swap and pools on Solana",
  },
  {
    id: "orca",
    name: "Orca",
    url: "https://www.orca.so/pools",
    hosts: ["www.orca.so"],
    chains: ["sol"],
    line: "Swap and pools on Solana",
  },
  {
    id: "kamino",
    name: "Kamino",
    // app.kamino.finance moved to kamino.com (it redirects there): only the host the app now lives on is pinned.
    url: "https://kamino.com/",
    hosts: ["kamino.com"],
    chains: ["sol"],
    line: "Lend on Solana",
  },
  {
    id: "sanctum",
    name: "Sanctum",
    url: "https://app.sanctum.so/",
    hosts: ["app.sanctum.so"],
    chains: ["sol"],
    line: "Stake SOL",
  },
  {
    id: "mtpelerin",
    name: "Mt Pelerin",
    url: "https://app.mtpelerin.com/",
    hosts: ["app.mtpelerin.com"],
    // The same host and chain as Pay's Mt Pelerin recipe (Browser wallet on Base).
    chains: ["base"],
    line: "Euro account and cards",
  },
];

/** The chains a site the person typed gets: the Browser wallet's own chains. */
export const TYPED_SITE_CHAINS: readonly BrowserChain[] = ["eth", "base", "arb", "gnosis", "sol"];

export const presetForHost = (host: string): Preset | undefined => PRESETS.find((p) => p.hosts.includes(host.toLowerCase()));
