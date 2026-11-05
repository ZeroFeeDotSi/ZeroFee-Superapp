// O-2 "first win" (master plan row 16): right after set-up, one tap moves $2 of the Safe's NEAR into Hidden, through
// Wallet's own doors (ledger.privateSetup, ledger.quoteToPrivate, ledger.toPrivate) and the core's one Approve. Nothing
// here moves money or decides an amount the core doesn't check: this file only says whether to offer it, how much,
// and the words. Loaded only after "Your account is open" (never in the first load).
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

/** The win's size: QA, 3 Nov ("only when the Safe has $2"). */
export const WIN_USD = 2;
/** NEAR kept back for the move's own network fee and the wrap's small storage (it comes back to the Safe). */
export const WIN_GAS_NEAR = 0.01;
/** Offered once per device: shown, it never asks again (Hidden stays one tap away on Home). */
export const WIN_SEEN_KEY = "zf.firstWin";

/** What the offer is read from. `near`: the NEAR on the account (ledger.balances, tokenId "near"). */
export interface WinFacts {
  pocket: { available: boolean; ready: boolean; canAdd?: boolean } | null;
  kid: boolean;
  near: { amount: string; usd?: string; priceKept?: true } | null;
  seen: boolean;
}

/** The move, when it is offered: the NEAR to move and its dollars (never more than $2, never the fee's NEAR). */
export interface WinOffer {
  near: string;
  usd: number;
  /** Hidden's wallet still to be made first (ledger.privateSetup). */
  setUp: boolean;
}

/**
 * Offered only where it can work: Hidden is open on this build, not a child's account, not offered before, and the
 * Safe's NEAR is worth $2 or more at a price read now (a kept price never sizes a move, B28) with the fee's NEAR kept
 * back. The amount is $2 of NEAR, or a little less when the fee's NEAR must stay (never under $1.50: then not offered).
 */
export function winOffer(f: WinFacts): WinOffer | null {
  // canAdd (review H1): the move can be priced on this build; where the route is closed nothing is offered (D116).
  if (f.seen || f.kid || !f.pocket?.available || f.pocket.canAdd !== true || !f.near || f.near.priceKept) return null;
  const amount = Number(f.near.amount);
  const usd = Number(f.near.usd);
  if (!(amount > 0) || !(usd > 0) || usd < WIN_USD) return null;
  const price = usd / amount;
  const spendable = amount - WIN_GAS_NEAR;
  // $2 of NEAR, rounded up to the coin's 5th place so it is never under $2; where the fee's NEAR must stay, what is left.
  const full = Math.ceil((WIN_USD / price) * 1e5) / 1e5;
  const capped = full > spendable;
  const nearText = (capped ? Math.floor(spendable * 1e5) / 1e5 : full).toFixed(5);
  const winUsd = capped ? Math.floor(Number(nearText) * price * 100) / 100 : WIN_USD;
  if (!(winUsd >= 1.5)) return null;
  return { near: nearText, usd: winUsd, setUp: !f.pocket.ready };
}

/** "$2", or "$1.97" when the fee's NEAR stays. */
export const winDollars = (usd: number): string => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);

/** The screens' words (grade 5; "Hidden", never "Private"; nothing claims more than PRIVATE_SEEN says). */
export const WIN_WORDS = {
  title: "Try Private",
  line: (usd: number) => `Move ${winDollars(usd)} from your Safe into Private.`,
  go: (usd: number) => `Hide ${winDollars(usd)}`,
  later: "Later",
  getting: "Getting a price…",
  moving: (usd: number) => `Your ${winDollars(usd)} is on its way to Private…`,
  slow: "It keeps going. You can open ZeroFee.",
  doneTitle: "You did it",
  // never a figure here: the move's fees take a few cents, so "$2 is in Hidden" would be a little untrue
  doneLine: "It is in Private now. The fees took a few cents.",
  failTitle: "Private didn't get it",
  safe: "Your money is still in your Safe.",
  // refunds of a move in go to Hidden itself (privateRequest's refundTo is the pocket), never back to the Safe
  cameBack: "It came back to you. Find it in Private.",
  heldTitle: "Your rules hold it",
  heldLine: "It waits for your yes in Waiting.",
  open: "Open ZeroFee",
} as const;

/** Where the move stands, as Wallet's Activity reads it. */
export type WinState = "offer" | "asking" | "moving" | "held" | "done" | "failed";

/** A movement's status as the win's state: a refund or a problem is "failed" (the money stays in the Safe, or comes back). */
export function winStateOf(status: string | undefined): WinState {
  if (status === "done") return "done";
  if (status === "refunded" || status === "problem") return "failed";
  return "moving";
}

/** The failure screen's one line: the core's own words when it said what happened, else the plain line. */
export const winFailLine = (p: Problem | null): string => p?.whatHappened ?? WIN_WORDS.failTitle;

/** Where the money is after a failure, only as far as it is known (review M2): before anything was signed it is in the
 *  Safe; after, the Problem's own money line says it, or nothing is claimed. */
export function winMoneyLine(p: Problem | null, signed: boolean): string | null {
  if (!signed) return WIN_WORDS.safe;
  const m = p?.money as { state?: string; where?: string } | undefined;
  if (m?.state === "safe" && m.where) return `Your money is ${m.where}.`;
  if (m?.state === "on-the-way" && m.where) return `Your money is on its way: ${m.where}.`;
  if (m?.state === "not-involved") return "Nothing moved.";
  return null;
}

/** Remembered on this device: offered once. */
export function winSeen(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    return store?.getItem(WIN_SEEN_KEY) === "1";
  } catch {
    return true; // storage refused: never risk asking again and again
  }
}
export function markWinSeen(store: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    store?.setItem(WIN_SEEN_KEY, "1");
  } catch {
    // nothing to keep: the worst case is one more offer
  }
}

/**
 * Reads what the offer needs, each read bounded (`ms`): any read that fails or is slow means no offer, so "Open
 * ZeroFee" is never held up. `shell`: the core (account.state); `wallet`: Wallet's ledger (Hidden, the NEAR row).
 */
export async function readWin(shell: Bridge, wallet: Bridge, ms = 3000): Promise<WinOffer | null> {
  if (winSeen()) return null;
  const within = <T,>(p: Promise<T>): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [state, pocket, balances] = await Promise.all([
    within(shell.call<{ kid?: boolean }>("account.state")),
    within(wallet.call<{ available: boolean; ready: boolean; canAdd?: boolean }>("ledger.private")),
    within(wallet.call<{ tokenId: string; held: string; amount: string; usd?: string; priceKept?: true }[]>("ledger.balances")),
  ]);
  if (!state || !("ok" in state) || !pocket || !("ok" in pocket) || !balances || !("ok" in balances)) return null;
  const near = balances.ok.find((b) => b.tokenId === "near" && b.held === "account") ?? null;
  return winOffer({ pocket: pocket.ok, kid: state.ok.kid === true, near, seen: false });
}
