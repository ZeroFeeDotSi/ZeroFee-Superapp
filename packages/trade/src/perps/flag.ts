// D119 perps: Trade's Perps tab, Hyperliquid's TEST network only. OFF until the testnet proof passes
// (tools/perps/testnet-proof.ts exits 0 on its run). A WRITTEN PRECONDITION (security review M2): that run's step d must
// print "REFUSED (the agent is revoked)": only Hyperliquid itself can show that a revoke under our agent name stops the
// old agent. Turn this on together with the core's PERPS_CORE_ON (packages/core/src/perps/service.ts), never alone. While it is off, nothing of Perps is shown or loaded: no tab, no
// screen, no chunk (the bundler drops the lazy import with the constant). Turning it on is a one-line change here.
//
// The 390x844 walk (tools/browser/perps-web-walk.mjs) builds once with VITE_ZEROFEE_PERPS_WALK=1 to see the tab on
// sample data; that switch is a build-time setting, never the address, and never in the public build.
// Written as import.meta.env?.VITE_… so the bundler replaces each with its literal and drops Perps from a build without
// the switch; under node (tests) import.meta.env is undefined and both read as off.
export const PERPS_ON: boolean = false || (import.meta.env?.VITE_ZEROFEE_PERPS_WALK === "1" && import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1");

export type TradeTab = "trade" | "perps" | "activity";
/** Trade's tray: Trade, then Perps only when it is on, then Activity. */
/** UX audit 4 Nov (D144, one Activity): no Activity tab; the header's Activity centre is the one place for what is going
 *  on, and the trade history is "Your trades" in Trade's settings. With Perps off there is one section: no switch. */
export const trayTabs = (on: boolean = PERPS_ON): TradeTab[] => (on ? ["trade", "perps"] : ["trade"]);
/** A tab another app asked for by name: "perps" opens only when it is on (else the market). */
export const tabOf = (t: string | undefined, on: boolean = PERPS_ON): TradeTab => (t === "perps" && on ? "perps" : "trade");
