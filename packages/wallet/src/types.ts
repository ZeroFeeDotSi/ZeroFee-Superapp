// The ledger's shapes, as docs/interfaces.md lists them (S3). Pay, Trade and the Wallet screens import them from here.
//
// Amounts are decimal strings in the coin's own units ("12.5"), never floats and never raw units: the ledger turns them
// into whole numbers only when it builds a transaction. Chain ids are 1Click's blockchain ids ("near", "sol", "base",
// "hood" for Robinhood Chain, …). Times are ISO-8601 UTC.
import type { MoveProof } from "@zerofee/core/tx-proof";
import type { Problem } from "@zerofee/core/problem";
import type { PlainWords } from "@zerofee/core/signer";

/** A network money can arrive from, for the "Send from" picker. */
export interface Chain {
  id: string;
  name: string;
  /** Logo key for the design system's CoinIcon (the chain's own logo). */
  icon: string;
  nativeSymbol: string;
  /** The smallest deposit of the chain's own coin that the bridge credits. */
  minDeposit?: string;
  /** The coins (asset ids) that are credited when sent on this network; anything else may be lost. */
  coins: string[];
}

/** Where to send coins on one network so they land in this account's balance. */
export interface DepositAddress {
  address: string;
  /** Some networks (Stellar) need this memo with every deposit, or the coins can't be credited. */
  memo?: string;
  chain: string;
  /** The coin these figures are for: the chain's own coin unless one was asked for. */
  token: string;
  minAmount: string;
  /** The text to draw as a QR code: the address alone (a memo is always shown on its own line). */
  qr: string;
  note?: string;
}

/** One coin in one place. The Wallet screen groups rows by symbol into one line per coin. */
export interface Balance {
  tokenId: string;
  symbol: string;
  name: string;
  icon: string;
  /** The coin's home network. */
  chain: string;
  amount: string;
  /** An estimate, from 1Click's price list. */
  usd?: string;
  /** A claim on a coin that lives on another network, held through a bridge. */
  bridged: boolean;
  /** "ledger": inside NEAR Intents. "account": on the NEAR account itself (sent from a NEAR wallet), moved in when used.
   *  "private": in the Private pocket (ledger.private only, never in ledger.balances, so nothing spends it by mistake). */
  held: "ledger" | "account" | "private";
  /**
   * False for a coin 1Click doesn't list: its symbol is only what its own contract says (anyone can call a coin
   * "USDC"), so it never gets a logo (`icon` is ""), no price, and is never grouped with a listed coin of that symbol.
   */
  listed: boolean;
  /** B28 (security review H1): its dollars are from a coin list kept on the device or shipped with the app, not read
   *  just now. Shown; never used to size a move (the core's Top up refuses to pay with such a coin until 1Click answers). */
  priceKept?: true;
  /** Test NEAR on a test account (worth nothing): shown so, with the test account's note. */
  test?: true;
  /** Two NEAR operators gave this amount (product decision, 3 Nov). A screen's fast read (ledger.balances { shown: true }) is one
   *  node's first answer until a second confirms it: a figure may go UP on one node's word, never DOWN; a lower figure
   *  waits for `agreed`. A read without `shown` is always agreed (two nodes at one block). */
  agreed?: true;
}

/** A coin 1Click can price and move, straight from its list. */
export interface Token {
  assetId: string;
  chain: string;
  symbol: string;
  decimals: number;
  /** As the chain writes it; null for the chain's own coin. */
  contract: string | null;
  priceUsd?: string;
  name?: string;
  icon?: string;
}

export interface Quote {
  id: string;
  from: string;
  to: string;
  amountIn: string;
  /** What 1Click expects to deliver. */
  amountOut: string;
  /** The least it promises; anything worse is refunded. */
  minOut: string;
  /** Everything the conversion costs, in dollars, an estimate (1Click's fee and the price difference). */
  feeUsd?: string;
  feeNote: string;
  etaSeconds?: number;
  expiresAtIso: string;
}

/** Who receives: an address on a chain, or a NEAR account inside its ledger (instant, between ZeroFee people). */
/** `confidential`: into that NEAR account's private balance (NEAR Confidential), as Move pays the NEAR wallet from Private. */
export type Payee = { kind: "chain"; chain: string; address: string; memo?: string } | { kind: "ledger"; accountId: string; confidential?: true };

export interface PayQuote {
  id: string;
  fromTokenId: string;
  toTokenId: string;
  to: Payee;
  /** The most that leaves the balance. */
  amountIn: string;
  /** What the payment is expected to use; any difference comes back by itself. */
  amountInExpected: string;
  /** Exactly what the receiver gets. */
  amountOut: string;
  feeUsd?: string;
  feeNote: string;
  etaSeconds?: number;
  expiresAtIso: string;
  /** Where any refund goes: always this account's own balance. */
  refundTo: string;
  /**
   * What the account's protection will do with this payment, as the approval sheet will say it (tx.describe): run at
   * Face ID, wait, or need the second device. A partner's price that can't wait out a hold reads as "wait". Absent when
   * the account has no protection contract, or it couldn't be read; the sheet still says it before Face ID.
   */
  protection?: NonNullable<PlainWords["protection"]>;
  /** The most the network fee can be, in the approval sheet's own words ("0.011 NEAR"), read from the same tx.describe
   *  as the sheet. Absent when the payment takes more than one approval or it couldn't be read (grade 02f, F1). */
  fee?: string;
  /** What it pays, in the approval sheet's own words ("about $30.34 (7.1049 NEAR)"), from the same tx.describe: the
   *  core's one NEAR price, so Send's review says the sheet's dollars (grade 02h, H1). Absent when the sheet says no
   *  dollar figure (a step it can't price), or with more than one approval. */
  amount?: string;
}

export interface RecipientInfo {
  exists: boolean;
  /** True when the account already holds coins in the ledger, so a transfer inside it reaches them at once. */
  hasLedgerBalance: boolean;
  /** The code the account runs (its global contract's hash, else its own code hash, base58), read on two nodes; null
   *  when it runs none or doesn't exist. */
  code: string | null;
}

export interface Movement {
  id: string;
  /** "trading": the Add (ledger.toTrading), USDC from the main balance into the Trading balance; `to` is "trading". */
  /** "account": a step the account signed that moved no money of its own (a rules change, a key, a restore), from the
   *  account's record on chain: `label` is its words, `by` the key that signed (grade 02f, item 4: one Activity). */
  /** "swap": a swap in place inside NEAR Intents (ledger.swap: the Safe's, or the NEAR wallet's private balance). */
  kind: "deposit" | "convert" | "withdraw" | "transfer" | "pay" | "private" | "trading" | "account" | "swap";
  status: "waiting" | "moving" | "done" | "refunded" | "problem";
  from?: string;
  to?: string;
  /** A site wallet's Take out on its way home (kind "trading" from "trading"): the site's name, where it truly came from. */
  site?: string;
  amount: string;
  startedAtIso: string;
  updatedAtIso: string;
  problem?: Problem;
  explorerUrls: string[];
  /** The asking app's own name for it (e.g. a shop's name from Pay), if it gave one. */
  label?: string;
  /** Held by the account's protection (status "waiting", D17): pass it to useShell().showWaiting. Nothing has moved. */
  held?: { id: string; readyAtIso: string; needsSecondDevice: boolean };
  /** The app that asked for it. ledger.movementUpdated reaches only that app and Wallet; other apps never see its label. */
  caller?: string;
  /** Which key signed it, from the account's record: "This phone", "Your backup words", "Another device", … */
  by?: string;
  /** Paid from Private (D27): Activity says so. */
  private?: boolean;
  /** Audit H1 (fix #3): of what its first step brought, this much (decimal, the same coin) stayed in the private
   *  balance, the inflow rounded up to a grid so an explorer can't pair it with the payment by amount. */
  kept?: string;
  /** A Top up (kind "trading"): 1Click's id for it, the deposit address its status answers for, so a row that hasn't
   *  settled can name it ("1Click is still settling it (its id: …)"). It is on chain already: the payment's receiver. */
  depositAddress?: string;
  /** Home's Send: the network it paid on (the payee's chain, "near" for a NEAR account), so the next Send to the same
   *  address starts there and a new 0x address never does (security review M1). Optional; older movements have none. */
  toChain?: string;
  /** A Top up (kind "trading"): the swap service's own time estimate in seconds, from its quote. Display only. */
  etaSeconds?: number;
  /** Money that came in (kind "deposit"): its dollars when it landed, at the core's own price, fixed then (the
   *  Statement's "Dollars" and its "came in"; AgentZero's "how much came in"). A move from replaced words into Private
   *  (kind "private", from "oldWords"): its dollars when it moved, which its Activity row says. */
  usd?: string;
  /** Money that came in: where it landed. None: the Safe (a bridge deposit). */
  into?: "safe" | "sol" | "hood" | "near" | "bsc";
  /** An Add that came in: what the swap service kept on the way, in dollars at the same price. A Swap (kind "convert"):
   *  its quote's own fee estimate. Activity's row page shows it as Fee. */
  feeUsd?: string;
  /** A swap in place that ended (kind "swap"): what really arrived, in the `to` coin's units (decimal), from the chain's
   *  or 1Click's answer, never the quote; and how long it took from the tap, measured (ms). */
  amountOut?: string;
  settledMs?: number;
  /** A payment from Private to a wallet (kind "pay"): the payout quote's least in the payee's coin, its own units
   *  (minAmountOut), so a Move's tick waits for a read of that wallet that shows it (audit, 5 Nov). */
  minOut?: string;
  /** A swap in place: where it ran ("safe": the Safe's intents.near balance; "private": the NEAR wallet's). */
  source?: "safe" | "private";
  /** A Safe swap in place: the relay's tag for its deposit address, so 1Click's status says what arrived. Kept on this
   *  device only, never passed to an app (the ledger strips it). */
  statusTag?: string;
  /** The money that opened the account. */
  opened?: true;
  /** The opening only: what opening the account keeps of `amount` (its storage, the fee reserve, the opening's fees),
   *  in NEAR, so the row adds up to the Safe right after (finding 10). */
  openKept?: string;
  /** Its proof (product decision, 3 Nov; core tx-proof.ts): the payee's transaction that landed it, from 1Click's record, and the
   *  private balance it left from (no public transaction there). The Safe's own transaction stays in explorerUrls. */
  proof?: MoveProof;
}

/** The subwallet kind of the Private pocket (D27): the core holds its key; subwallet.list names it so. */
export const PRIVATE_KIND = "private";

/**
 * Private (D27): a small separate wallet just for private payments. Its key is an ordinary one that Security holds and
 * caps; money moved in shows on chain, what is done with it after doesn't (1Click's confidential mode, quoted through a
 * server that holds the partner key). NEAR's operators can still see it.
 */
export interface PrivatePocket {
  /** False until this phone can use Private (the pocket, the quote server, Security's cap): nothing is shown then (D13). */
  available: boolean;
  /** The pocket exists. */
  ready: boolean;
  /** What's in it, one row per coin (held: "private"). */
  rows: Balance[];
  /** Pay's Private switch starts on (the person chose so once; changed on the Private screen). Kept on this phone. */
  defaultOn: boolean;
  /** O-2b review H1: a move from the Safe into Hidden can be priced on this build (the NEAR-origin route is open). False
   *  where ledger.quoteToPrivate would refuse every move, so nothing offers one (D116: drop, don't degrade). */
  canAdd?: boolean;
  /** The Move route's Safe → Private fill is open (safe-fill-open.ts, the ledger's own switch): closed, only Private's own
   *  coins pay a Move, and Spending picks the coin from them alone (core spending.ts topUp; the proof, 5 Nov). */
  fillOpen?: boolean;
  /** Security audit 4 Nov, finding 2: money still in the old wallets (the private balance and NEAR wallet of replaced
   *  backup words), on its way to the new ones or not yet (core subwallet.oldWords). Counted in the total, never spent
   *  from here. `moving`: some is on its way; `stuck`: some didn't move yet (Try again is offered); `left`: some is too
   *  small for 1Click to move; `unread`: not all of it loaded, so the total may be low. */
  oldWords?: { rows: Balance[]; moving: boolean; stuck: boolean; left: boolean; unread?: true };
}

/** A network the first NEAR can be bought from (M7), named and ordered as Add money's picker; every coin 1Click quotes there. */
export interface StartNetwork {
  id: string;
  name: string;
  icon: string;
  coins: Token[];
}

/**
 * Where to send what, so a brand-new account gets the NEAR it needs to start (M7): a real 1Click quote, exact output
 * (with 5% headroom) to the new account's implicit address. Nothing is signed; the person sends from their own wallet.
 */
export interface StartQuote {
  depositAddress: string;
  /** Some networks need it with the deposit (Stellar). */
  memo?: string;
  /** What to send, a decimal in the coin's own units. */
  amountIn: string;
  symbol: string;
  tokenId: string;
  chain: string;
  /** NEAR that arrives at least. */
  nearOut: string;
  /** 1Click's estimate, in seconds. */
  etaSeconds?: number;
  /** The price holds until then; after that, ask again. */
  expiresIso: string;
  /** If something goes wrong, the coins go back here: the wallet the person sends from. */
  refundTo: string;
}
