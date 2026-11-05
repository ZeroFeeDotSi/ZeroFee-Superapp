// Social Trading, ready before its first open (product decision, 2 Nov): once the account is home, each hub site's own wallet is
// made from the backup words in the background (core site-wallets.ts: the same wallet every time, so asking again is
// harmless), so the hub shows it at once and its site can sign in with it at the first tap. Nothing moves, nothing is
// signed, no sheet. The sites' sign-in steps are compiled into the app (sign-in-recipes.ts), so they need nothing here.
import type { Bridge } from "@zerofee/core/bridge";
import { SITE_WALLETS } from "@zerofee/core/site-wallets";
import { HUB_SITES } from "./hub-state.ts";

/** `bridge`: Social Trading's own (forApps(…, "social")): it may make a site's wallet, and nothing that moves money.
 *  ST13: every one of a site's wallets the core has (GMGN: Solana and Base), Solana first, so a sheet only
 *  ever fills one and never makes one. */
export async function prepareSites(bridge: Bridge): Promise<string[]> {
  const made: string[] = [];
  for (const site of HUB_SITES) {
    const chains = SITE_WALLETS.find((s) => s.site === site)?.chains ?? ["sol"];
    for (const chain of ["sol", ...chains.filter((c) => c !== "sol")]) {
      const r = await bridge.call<{ id: string }>("subwallet.create", { kind: "site", chain, siteId: site }).catch(() => null);
      if (r && "ok" in r) made.push(r.ok.id);
    }
  }
  return made;
}

/** The shell's start once the account is home: Spending's engine (`run`), then the hub's wallets, quietly. */
export function withSitesPrepared(run: () => () => void, bridge: () => Bridge): () => () => void {
  return () => {
    const stop = run();
    void prepareSites(bridge());
    return stop;
  };
}
