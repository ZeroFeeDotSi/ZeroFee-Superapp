// D143 (product decision, 3 Nov 2026), every app: Face ID (the approve sheet) only when money leaves the Safe.
//
// The one rule every signer asks before it shows a sheet. "safe": the Safe's own NEAR account key signs (a top-up, a
// Move or Send from the Safe, Safe → private, anything the account itself signs): it asks, as today (approve() → the
// sheet with Face ID). "hot": a key the core keeps sealed for speed signs (the chain wallets' SOL and EVM keys, the NEAR
// wallet's float, the private pocket's legs, the site wallets, AgentZero's pocket): it never asks in the person's own flow
// (hotNeedsApproval: a listed site's own wallet or no site, inside the one cap, two test runs). When it does ask, its
// sheet is one tap, never Face ID (the core's `tap`, signer.ts; review, 3 Nov: Face ID only when money leaves the Safe).
// It signs after the core's own checks, and in the person's own flow refuses (a Problem that names the cause) what those
// don't pass. Those checks never move with this rule: a hot key pays only the person's own addresses or a checked trade
// route, unless it's a Send the Wallet app's own Hold started; each method answers only the apps allowed today; the one
// cap (per signature and per 24 hours, over all the hot keys together: audit C1) holds; a site signs only with its own
// wallet, never a shared chain wallet (audit C1).

/** Who signs: the Safe's account key, or one of the core's hot keys. */
export type Signer = "safe" | "hot";

/** True when the Safe's account key signs: the approve sheet (Face ID) always shows. A hot key: see hotNeedsApproval. */
export function needsApproval(signer: Signer): boolean {
  return signer === "safe";
}

/**
 * D143 refinement (3 Nov, after the security review; DECISIONS.md): a hot key's signature that passed
 * the core's checks still asks (the one-tap approve sheet) when it is outside the person's own flow: a site asked and the
 * wallet isn't that LISTED site's own (an unlisted host's own wallet always asks; a shared chain wallet is refused to a
 * site outright, audit C1), it's past the one cap or has no price, or only one server could test it (Trade's own buy
 * aside, B36, and Trade's own sale of a coin the market prices, the test, 4 Nov). Otherwise no sheet. subwallets.ts hotGate reads exactly this.
 */
export function hotNeedsApproval(o: { siteAsked: boolean; ownSiteWallet: boolean; withinCaps: boolean; twoServers: boolean }): boolean {
  return (o.siteAsked && !o.ownSiteWallet) || !o.withinCaps || !o.twoServers;
}

/**
 * D146 (product decision, 3 Nov 2026): an app's approve sheet shows only while that app is on screen; asked by an app the person
 * isn't on, it is answered Not now (nothing is signed). `asker`: the app that asked, as forApps stamped it (the core's
 * approval.needed `app`, the words' `asker`; a Top up through Spending names the app that asked Spending); none: ZeroFee's
 * own screens, which always may. Two ask for whichever app is on screen: Home's money sheet runs on Wallet's bridge over
 * the app that opened it (AppHost openMoney), and Spending's engine asks as Trade; their sheets show only while that
 * money step is still open (`moneyOpen`), or Trade is on screen for Trade's own Add. `onScreen`: the app the shell has on screen;
 * none yet (before the first app opens): it may show. The web sheet (ApprovalSheet.tsx) and the phone's own
 * (SheetWords.swift mayShow) read the same rule.
 */
export function mayShowSheet(asker: string | undefined, onScreen: string | undefined, moneyOpen = true): boolean {
  if (!asker) return true;
  if (!onScreen) return true;
  // review M5: a relay asks for whichever app is on screen, so its sheet shows only while the money step that asked is
  // still open there (Home's money sheet up), or, for Trade's own Add, while Trade is on screen; checked the instant the
  // sheet would show, so a call still in flight when the person left never puts it over the next app
  if (asker === "wallet") return moneyOpen;
  if (asker === "trade") return onScreen === "trade" || moneyOpen;
  return asker === onScreen;
}

