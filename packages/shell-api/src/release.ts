// The public web release (VITE_ZEROFEE_PUBLIC=1, apps/web/deploy-app.sh): a build-time constant, never read from the
// address. Apps read it here, so the shell and every app agree on what the release has.
//
// Send, Receive and Withdraw live in Wallet in every build (D48: Pay folds into Wallet; its card and provider flows are
// postponed, so nothing links to them). Private is open in the release (gates grade, 5 Nov: audit P-1 was a words
// problem, not a code one): its words claim only what's true, private from the public, and NEAR Intents' solver sees the
// payment (wallet format.ts PRIVATE_SEEN). Every money move already goes through the pocket; the lock only hid a screen.

/** Is this the public release build? Under node (tests) and in every other build: false. */
export const PUBLIC_RELEASE: boolean = import.meta.env?.VITE_ZEROFEE_PUBLIC === "1";

/** The public build's Sim mode (sample money; apps/web mode.ts): main.tsx marks the page (`data-public="sim"`) before
 *  any app code runs. Real is `data-public="real"`. False in every other build. */
export const simPage = (): boolean => PUBLIC_RELEASE && (globalThis as { document?: Document }).document?.documentElement?.dataset.public === "sim";
/** The web wallet (product decision, 4 Nov; apps/web mode.ts WEB_WALLET): the public build's "web" mode, the three hot
 *  wallets from the 24 words kept in this browser, and NO Safe. main.tsx marks the page (`data-public="web"`) before any
 *  app code runs, so every app reads the same answer here. False in every other build. */
export const webWallet = (): boolean => PUBLIC_RELEASE && (globalThis as { document?: Document }).document?.documentElement?.dataset.public === "web";
/** Trade on the web wallet: on only when the build sets VITE_WEB_TRADE=1 (QA; deploy-app.sh sets it, a product
 *  call). The core's web allowlist (fork A) reads the same flag, so Trade shows exactly when it can sign. */
export const WEB_TRADE: boolean = import.meta.env?.VITE_WEB_TRADE === "1";
/** The sample-money demo: ?demo, and the public site's Sim. */
export const onDemoPage = (search: string = typeof location === "undefined" ? "" : location.search) => simPage() || new URLSearchParams(search).has("demo");

/** The free build (VITE_ZEROFEE_FREE=1, apps/web build-free.sh on feat/free-zero-cost): no relay and no partner key. */
export const FREE_BUILD: boolean = import.meta.env?.VITE_ZEROFEE_FREE === "1";
/**
 * Is Private open here? In every build but the free one: the release (its Sim, its extension), the phone, testnet. The
 * web wallet has no Safe, so WalletApp sends its Private to the On your phone page before it asks this.
 * The free build: a real limit, not a lock on a working path. Its every move in or out is a confidential 1Click quote,
 * and 1Click gives those only under a partner key (a person's own 1Click sign-in is refused, "Invalid token",
 * FREE-BUILD.md on feat/free-zero-cost); a key in the app could be read by anyone (apps/quotes/README.md), and the free
 * build has no relay to hold one. So Private isn't offered there (drop, don't degrade). What opens it today: the
 * person's own relay holding their own partner key (README, "Your own relay"), the same code as the release.
 * Any build with no relay, free or not, already shows nothing: the ledger answers pocket.available false, so Home has no
 * door (safe-hot.ts privateDoor) and a link to Private lands on Home (WalletApp). VITE_ZEROFEE_FREE is set by no script
 * on main yet (build-free.sh is on feat/free-zero-cost).
 */
export const privateOpen = (free = FREE_BUILD) => !free;

/** Native coins (product decision, 5 Nov, HOME-SAFE-HOT-SPEC §4-5): Trade's coin page for a Safe coin ("coin:intents:<assetId>")
 *  and its list of the 215 ("native"). On only when the build sets VITE_NATIVE_COINS=1 (the Trade builder's switch);
 *  off, a Safe coin opens Wallet's own coin screen and the Safe has no Buy (end to end or hidden). */
export const NATIVE_COINS: boolean = import.meta.env?.VITE_NATIVE_COINS === "1";
