// Apps' catalog (app id "social"): which apps it lists, in what order, and what each one says.
//
// Every app here is a Browser preset (../presets.ts), so its exact hosts and chains are pinned on the iPhone
// (PinnedRecipes.swift, checked by apps/web/src/host/recipe-pin.test.ts) and reviewed by Security. An app is listed only
// after a probe at phone width showed (a) its page is made for a phone and (b) "ZeroFee" is in its own wallet list
// (docs/layers/browser.md, "Apps", has the probe table). D47: only sites whose full flow is proven are listed, so fomo
// (no phone site, no outside wallet login) is not; a fomo deposit address is paid with Wallet's Send.
import { PRESETS, type Preset } from "../presets.ts";

export type Category = "Trade" | "Swap" | "Earn";

export interface CatalogApp {
  /** The Browser preset's id: its hosts, chains and logo come from there, never from the page. */
  id: string;
  category: Category;
  /** What it does, in one plain line. */
  what: string;
  /** How to connect ZeroFee inside it, in its own words. */
  steps: readonly string[];
}

// D143 (review H3): a listed app trades from its own wallet with no Face ID inside its limits, and can't pay anyone else
const ASKS = "It trades from its own wallet without asking. It can't send money out.";

export const CATALOG: readonly CatalogApp[] = [
  { id: "pump", category: "Trade", what: "Buy and sell brand-new coins on Solana.", steps: ["Tap Sign in.", "Under \"or connect a wallet\", choose ZeroFee.", ASKS] },
  { id: "gmgn", category: "Trade", what: "Fast trades, with live charts of new coins.", steps: ["Close GMGN's app pop-up, then tap Log In.", "Tap \"Connect with extension wallet\" and choose ZeroFee.", ASKS] },
  // ST5 (product decision, 2 Nov): Jupiter (a swap), Raydium and Orca (pools),
  // Kamino (lending) and Sanctum (staking) left. Their presets stay the Browser's, and their site wallets keep their
  // place on the key path, so money already in one still shows on the hub until it is moved home.
];

// A site a person can't use is never shown, not even as a "can't" line (product decision, 3 Nov, QA's walk of fbbea314: "no site a
// person can't use"). Axiom takes only Phantom (ST5, probed 2 Nov; ZeroFee's wallet never poses as another wallet,
// provider.js), so it has no tile and no line; D81 already scratched Photon the same way.

export const CATEGORIES: readonly Category[] = (["Trade", "Swap", "Earn"] as const).filter((c) => CATALOG.some((a) => a.category === c));

/** Each listed app with its preset. A catalog id with no preset is a mistake the tests catch, so it is left out here. */
export const LISTED: readonly (CatalogApp & { preset: Preset })[] = CATALOG.flatMap((a) => {
  const preset = PRESETS.find((p) => p.id === a.id);
  return preset ? [{ ...a, preset }] : [];
});
