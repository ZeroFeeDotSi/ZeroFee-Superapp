// The float's moves (TRADE-FLOAT §3–§5): out of the float to one of the person's own trading wallets, in from one of them,
// and home to the main balance. Each is a confidential 1Click quote the core asks for itself through ZeroFee's pinned relay: the recipient
// comes from the core's own list (Trade never passes an address), and a refund always comes back to the float.
//
// Before it signs, the core reads the quote back by its deposit address through the relay (never from the app) and
// checks the transfer 1Click prepared is exactly the one payment the quote needs (the private pocket's recorded shape,
// private-pocket.ts), and that the quote is the one it asked for: the coin, the recipient, at least the amount, and a
// price no more than 10 % over the core's own. A move is saved before each step, so a restart finds it; Trade's `key`
// makes asking again safe: the same key gives the same move, never a second one.
//
// The float's balance is the core's own count (float.balance): what each move signed away, and what 1Click's status
// says settled into it (an Add's or a move in's amountOut, any refundedAmount). Nothing else can spend the float: its key
// never leaves the core. Moves let go after a week are folded into a base kept in the same record.
import { moveProof, type MoveProof } from "./tx-proof.ts";
import { FLOAT_MIN_USD, FLOAT_MOVES_PER_DAY, FLOAT_NO_SHEET_USD_PER_DAY, type FloatGuard } from "./float.ts";
import { HOME_LEAST_PERCENT, leastIn, mostIn } from "./float-floors.ts";
import { parseQuote, type QuoteFacts } from "./intents.ts";
import { type Nep413Payload, pocketIntentRefusal, signNep413 } from "./private-pocket.ts";
import { formatShort } from "./format.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { withMoveKey } from "./move-key.ts";
import { utf8 } from "./sol/bytes.ts";
import type { Vault } from "./vault.ts";
import type { SiteCostWallet } from "./site-add-cost.ts";
import type { AddAddress, AddChain, AddOnWayFacts, AddTo, AddWatch, Received } from "./add-outside.ts";
import type { AddHost } from "./float-add.ts";
import { QUOTE_DEADLINE_STEP_MS, quoteDeadline } from "./quote-deadline.ts";
import { nearWalletRefused, upstreamRefused } from "./near-chain-refused.ts";

export type TradeChain = "sol" | "bsc" | "hood";
/** The slot that names a network's site (Browser) wallet in a move (D52): Spending's one pot feeds the sites too. The
 *  recipient is still the core's own: the Browser wallet on that network from this phone's list. */
export const SITE_SLOT = 5;
/** Which chain wallet a move reaches (D55): by its id from the core's own list; by a legacy slot (a journal from before
 *  D55, 0–4 or SITE_SLOT); with neither, the chain's current wallet. */
export type WalletRef = { id?: string; slot?: number; back?: string };
/** A wallet id as the core makes them: `<kind>-<chain>-<6 of its address>`. */
// a chain wallet's id, or a site's own wallet's (site-wallets.ts: "site-pump-sol-…"); the core's walletOf decides what each may do
const WALLET_ID = /^(?:trade|browser|site-[a-z0-9]{1,16})-(sol|bsc|hood|eth|base|gnosis|arb)-[0-9A-Za-z]{1,12}$/;
/** The float's own coin: USDC on NEAR Intents. */
export const FLOAT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** Each trading chain's own coin on NEAR Intents, and its decimals. BNB Chain waits for its own dust test (§5). */
/** The NEAR coin wallet's coin as 1Click names it: NEAR (wNEAR on NEAR Intents, 24 places). */
export const NEAR_COIN_TOKEN = "nep141:wrap.near";
export const CHAIN_COIN: Record<TradeChain, { tokenId: string; decimals: number; open: boolean }> = {
  sol: { tokenId: "nep141:sol.omft.near", decimals: 9, open: true },
  hood: { tokenId: "nep141:hood.omft.near", decimals: 18, open: true },
  bsc: { tokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", decimals: 18, open: false },
};
/**
 * A price may be at most 3 % from the core's own, plus up to $0.50 of network fees (audit NF-17: 1Click's signature
 * doesn't cover a quote's app fees, so a relay that adds one is held to this). 1Click's 1 % slippage fits inside. The
 * figures live in float-floors.ts, which Move's sheet reads to say the least that reaches the Safe.
 */
const most = mostIn;
const least = leastIn;
const QUOTE_MINUTES = 10;
/** A Move's own key (spending.topUp's `key`): the job an Add belongs to. */
const JOB_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const RECORD = "float-move-log";
const KEEP_MS = 7 * 86_400_000;
/** An Add not seen paid by its price's end stays open this much longer: the main account's payment may still be landing. */
const ADD_GRACE_MS = 60 * 60_000;
/** At most this many open moves and Adds are asked about for one balance read; the rest on the next. */
const REFRESH_AT_MOST = 20;

export interface FloatMove {
  id: string;
  /** F5: "agentzero" only for a move AgentZero's act door started (SubWallets.markAgentMove); none: the person's or the engine's. */
  by?: "agentzero";
  /** "swap": a NEAR coin bought or sold inside Spending (TN2, D74): USDC to the coin or back, both in its confidential balance. */
  kind: "out" | "in" | "home" | "swap";
  chain?: TradeChain;
  /** Legacy (before D55): the slot a journal named. */
  slot?: number;
  /** The chain wallet it reached (D55), by id. */
  wallet?: string;
  status: "pending" | "done" | "failed" | "refunded";
  where: "float" | "chain" | "in-flight" | "main";
  sent: { tokenId: string; amount: string };
  expected: { tokenId: string; amount: string };
  usd: number;
  startedAtIso: string;
  updatedAtIso: string;
  /** What 1Click's status says settled, once the move ended (done or refunded): what arrived, and any refund. */
  settled?: { amountOut?: string; refunded?: string };
  /** Its proof (product decision, 3 Nov): the transaction that set it off and the one that landed it, each on its chain, and
   *  1Click's deposit address; an end in the NEAR wallet's private balance has none and says so (tx-proof.ts). */
  proof?: MoveProof;
  /** Why it is where it is, in words, when that isn't plain from its status: a move in whose transfer wasn't sent says
   *  why (the nodes' own words), and once it ends unpaid, that the money is still in the wallet. */
  reason?: string;
  /** Social Trading's Move back (a move in from a site's own wallet, the person's own, on the core's sheet): the site's id. */
  site?: string;
  /** That Move back's second leg, once it started: Spending → the Safe, by its move id. */
  homeId?: string;
  /** That second leg refused before anything was signed, for good (its words): the money waits in Spending, said on the
   *  Take out's row, never a silent loop (QA's real $2 Take out, 5 Nov). Gone once it starts. */
  homeStopped?: string;
  /** S21, the copy review's ruling (5 Nov): a move home 1Click says is done that intents.near hasn't shown in the Safe within
   *  LANDED_WAIT_MS. Still pending (on its way: the Safe's total and Activity count it so), with `reason` HOME_UNREAD,
   *  read again on every refresh; the first read that shows it ends it done, at that read's time. Never the green Done. */
  unshown?: true;
  /** A swap that landed (subwallet.float.move): how much of its coin Spending holds now, by the core's own count. */
  heldAfter?: string;
  /** D119 landing 3: a move to or from the person's own Perps account on Hyperliquid (no chain wallet). */
  perps?: true;
  /** A swap inside the confidential balance (no deposit, no withdrawal): when its real quote was asked, when 1Click took
   *  the signed intent (submit-intent), and when the core first read it ended (ms since the epoch). Measured, for QA to
   *  time quote → settled; never shown as a promise. `settledMs` is as soon as the core read it (each move read). */
  timing?: { quotedMs: number; submittedMs?: number; settledMs?: number };
}

/** At most this many of the newest transactions at an Add's address go to 1Click (review QA L1): dust sent there
 *  after the real deposit can't push it out of the hint. */
export const ADD_HINT_TXS = 3;

/** A swap inside the balance whose signed intent 1Click refused: dropped, never sent again, so nothing moved. */
export const SWAP_NOT_TAKEN = "NEAR Intents didn't take it. Nothing moved.";
/** A swap whose submit-intent got no answer (1Click's server trouble, or a timeout): it may have run, so it stays open, sent
 *  again on each read, until 1Click says, or its deadline passed and 1Click's own balance was read (review QA L2). */
export const SWAP_UNANSWERED = "NEAR Intents didn't answer. ZeroFee keeps asking.";

/** A move paid out of the float (fromFloat), as Home's Add's forward asks it (float-add.ts): FromFloatAsk. */
export type FromFloat = FromFloatAsk;

/** What a move in's signed transfer depends on, kept before it is sent: so the move can later prove it never landed. */
export interface PayTry {
  /** Solana: the blockhash it was signed with (it can't land once that expires). */
  blockhash?: string;
  /** EVM: the wallet's nonce it was signed with. */
  nonce?: number;
  /** The transaction's own id. */
  tx?: string;
}

/** k-trade re-test (4 Nov): a move's 1Click deposit address is on its proof from the moment 1Click gave it, not only
 *  once 1Click's status was read (a leg that failed with no status read kept it only in the vault): Activity's page names
 *  it ("Swap order"), so its status can always be looked up. A copy: the kept record is never changed here. */
const withDeposit = (k: Kept): FloatMove => (k.depositAddress && !k.move.proof?.deposit ? { ...k.move, proof: { ...(k.move.proof ?? {}), deposit: k.depositAddress } } : { ...k.move });

/** A move as the phone keeps it: the public part, and what a restart needs to carry on. */
export interface Kept {
  move: FloatMove;
  key: string;
  fields: string;
  /** A parked remainder's move home (under the $2 floor): one at a time on the float (QA's SHOULD). */
  parked?: true;
  depositAddress?: string;
  tag?: string;
  /** The signed transfer, kept until 1Click has it: sending it again is harmless (its one-time number is used once). */
  signed?: unknown;
  submitted?: boolean;
  /** An Add (main balance → float): the core asked for its quote; Wallet pays it. Not one of Trade's moves. */
  add?: true;
  /** The person's job this Add is (Move's key): kept with its deposit address before any sheet, so a page closed while
   *  the Safe signed finds the Add again by it (bug report, 5 Nov). */
  job?: string;
  /** A move out: when 1Click first said SUCCESS while its chain didn't show the landing yet (landedThere). */
  successAt?: number;
  /** A move home (S21): the Safe it pays and what the Safe held of the coin it brings, read from intents.near just before
   *  the move was sent; it lands once a read shows at least its least more than that. */
  homeTo?: string;
  homeBefore?: string;
  /** What 1Click's status says settled (swapDetails), once it ended: `amountIn`, what was deposited (an Add's money in). */
  settled?: { amountOut?: string; refunded?: string; amountIn?: string };
  /** A move in: the id of the core's own transfer to the deposit address, to ask the chain about it (audit RM-2). */
  paidTx?: string;
  /** A move in: what its signed transfer depended on, kept before it was sent (PayTry). */
  tried?: PayTry;
  /** A move in whose transfer wasn't sent: why, in words (mainnet 2 Nov: it was thrown away, and the move said "moving"). */
  payError?: string;
  /** Social Trading's Move back: once this move in settles into Spending, what arrived goes on home to the Safe. */
  thenHome?: true;
  /** A swap: the amount out 1Click signed (its settled figure is held to it, review L2). */
  signedOut?: string;
  /** D119 landing 3, a Take out of Perps: the day's place it holds (FloatGuard), given back if it ends without money. */
  place?: string;
  /** Home's Add or Request from another chain (E1, E2; add-outside.ts): a one-time 1Click address on the coin's own chain,
   *  the same coin delivered into the float, then forwarded on (`fwd`). "setup": a new account's first money (fund-start.ts),
   *  forwarded as NEAR to the account being opened, at its 64-hex setup address (`setup`). */
  outside?: { chain: AddChain; to: AddTo | "setup"; untilMs: number; minIn: string; usd?: string; eta?: number; setup?: string; checked?: true; deadlineMs?: number;
    /** When money was first seen at the address (the phone's push, or 1Click's first word), and when 1Click said it was in
     *  the float (ms; display only), and what 1Click says was deposited while it is still on its way (display only). */
    seenMs?: number; privateMs?: number; inUnits?: string;
    /** 1Click's last word was INCOMPLETE_DEPOSIT: less than the least arrived, so it goes back to the float at the
     *  deadline unless more comes first (1Click OpenAPI, FLEX_INPUT: "Deposits below minAmountIn are refunded if the total
     *  received by the deadline is below this amount"). Cleared on any other word. */
    short?: true };
  /** The forward on, once the Add landed (float-add.ts planParts): its parts, and `skip`: why the rest stays in the float
   *  (words), never tried again. */
  fwd?: { parts: FwdPart[]; skip?: string };
}

/** One part of an Add's forward: its coin amount, when it goes, its tries, the key of a try started but not yet marked
 *  (`key`: a restart asks with it again), the move that carries it (`id`), and whether that move landed. */
export interface FwdPart {
  units: string;
  atMs: number;
  tries: number;
  key?: string;
  id?: string;
  done?: true;
}

/** A move paid out of the float, as fromFloat takes it. */
export type FromFloatAsk = {
    kind: "out" | "home"; key: string; fields: string; usd: number; chain?: TradeChain; slot?: number; wallet?: string; words: string; atLeast: bigint; perps?: true;
    /** A Put away of a parked remainder (a top-up's or an Add's leg 2 that stopped under $2 in Spending): home under the
     *  $2 floor too, as a Move back's home leg (still one of the day's moves). */
    parked?: true;
    /** The float's coin it's paid with: USDC, or a chain's own coin a refund left there (home only), or an Add's own coin. */
    from?: string;
    /** A coin going home that the core has no price for: no dollar minimum (audit RM-1). */
    unpriced?: true;
    /** SR3 L12: what the quote says it delivers, in its own signed dollars, must lie in [least, most] (AgentZero's fees
     *  leg: NEAR worth between half and twice its $0.30), else `outUsdLine` and nothing moves. */
    outUsd?: [number, number];
    outUsdLine?: string;
    /** An Add's forward on (E1, E2): the money the person sent to their own one-time address, going where they chose.
     *  Counted by the fee guard, never a sheet in the background (a restart included). */
    noAsk?: boolean;
    ask: { swapType: string; destinationAsset: string; amount: string; recipient: string; recipientType: string };
  };

/** What float-perps.ts (D119 landing 3, lazy) borrows of FloatMoves: its own steps, never a new path round them. */
export interface PerpsKit {
  d: FloatMoveDeps;
  now: () => number;
  paying: Set<string>;
  again(key: unknown, fields: string): Promise<FloatMove | null>;
  fromFloat(o: FromFloatAsk): Promise<FloatMove | { declined: true }>;
  keep(k: Kept): Promise<void>;
  amend(id: string, f: (now: Kept | undefined) => Kept | null): Promise<Kept | null>;
  notAskedIn(q: QuoteFacts | null, o: { coin: string; float: string; units: bigint; usd: number }): string | null;
  refusePastGuard(why: "moves" | "dollars" | undefined, release: () => Promise<void>): Promise<never>;
}

/** `checkedAtMs`: when the count was last held against what 1Click holds for the float (balance()). */
type Book = { base: Record<string, string>; kept: Kept[]; checkedAtMs?: number };
/** How often, at most, the count is held against what 1Click holds, while no move is open. */
export const RECONCILE_MS = 5 * 60_000;
/** The same, for a float with nothing in it and nothing ever moved (a $0 account): each read signs in to 1Click with the
 *  float's key, which tells 1Click this device asked about that wallet, so with nothing to correct it asks hourly at most
 *  (privsec hunt P2, 5 Nov: a $0 Home signed in on every open). Money from another device with the same words still shows
 *  within the hour; the first move here reads at once again (its count is no longer empty). */
export const EMPTY_RECONCILE_MS = 60 * 60_000;
/** Nothing counted and nothing kept: what the float holds by this phone's count is nothing at all. */
const emptyBook = (b: Book): boolean => !b.kept.length && !Object.values(b.base).some((v) => /[1-9]/.test(String(v)));
const digits = (v: unknown): string | undefined => (typeof v === "string" && /^\d{1,40}$/.test(v) ? v : undefined);

/** ZeroFee's quote relay (apps/quotes), the pinned one: 1Click's quote, generate-intent, submit-intent and status. */
export interface FloatRelay {
  /** The relay's own address (demo-core's privateQuotes): AgentZero's chat and its per-reply payments use it too (D152). */
  base?: string;
  quote(body: Record<string, unknown>): Promise<any>;
  generateIntent(signerId: string, depositAddress: string): Promise<any>;
  submitIntent(signedData: unknown): Promise<any>;
  /** 1Click's "Submit deposit hash": the deposit's transaction, so 1Click needn't find it on the chain (a hint only;
   *  1Click still checks the chain). With the quote's tag: the relay passes on only deposits it quoted. */
  submitDeposit?(depositAddress: string, txHash: string, tag?: string): Promise<unknown>;
  status(depositAddress: string, tag?: string): Promise<unknown | null>;
}

export interface FloatMoveDeps {
  vault: Vault;
  guard: FloatGuard;
  relay: FloatRelay | undefined;
  usdPrice: ((chain: TradeChain) => Promise<number | null>) | undefined;
  /** The float (Trade's NEAR wallet) and its key; refused if there is none yet. */
  float: () => Promise<{ address: string; secret: () => Promise<Uint8Array> }>;
  /** The chain wallet the move names (WalletRef: by id, a legacy slot, or the chain's current one), from the core's own
   *  list; `id` is the one found. D56: a wallet whose key was shown is filled as before (bounded by Spending's cap and
   *  this fee guard); if it may have leaked, the person puts Spending away and gets new words.
   *  `oldWords`: it opens with backup words the person replaced, asked for when the old ones may have been seen: never
   *  filled again (security review 2 Nov). `filling`: money goes in, so a legacy slot holding an old words' wallet and
   *  the new words' one gives the new one. `exportedOlder`: an older wallet (not its chain's current one) whose key was
   *  shown: never filled either. */
  wallet: (chain: TradeChain, ref: WalletRef, filling?: boolean) => Promise<{ id?: string; address: string; oldWords?: boolean; exportedOlder?: boolean }>;
  /** The account's own NEAR account id (Take out's recipient). */
  mainAccount: () => Promise<string>;
  /** What that chain wallet can send of its own coin, its network fee kept back (`keep`: that much, read by the caller). */
  spendable: (chain: TradeChain, ref: WalletRef, keep?: bigint) => Promise<bigint>;
  /**
   * The core's own plain transfer from that chain wallet: exactly `amount` of its coin to `to`, nothing else, costing at
   * most `feeAtMost`. The transaction's id once a node took it; thrown, in words, if it wasn't sent. `tried` hears what
   * the signed transfer depends on before it is sent, and may refuse (nothing is then sent).
   */
  pay: (chain: TradeChain, ref: WalletRef, to: string, amount: bigint, feeAtMost?: bigint, tried?: (t: PayTry) => Promise<void>) => Promise<string | null>;
  /** The most one plain transfer from that chain wallet can cost in network fee now, in its own coin, room for a small rise
   *  included: a move in keeps this back for "all" and its transfer is held to it. */
  networkFee?: (chain: TradeChain, ref?: WalletRef) => Promise<bigint>;
  /** A move in whose transfer no node took: true only if it provably never landed and never will (PayTry; the deposit
   *  address never paid). Anything uncertain: false, and the move stays open. */
  unpaid?: (chain: TradeChain, ref: WalletRef, depositAddress: string, tried?: PayTry) => Promise<boolean>;
  /**
   * Where one of the core's own transfers stands on that chain, as two nodes have it (audit RM-2): "ok" landed, "failed",
   * "none" (neither node has it), or null when they can't say.
   */
  landed?: (chain: TradeChain, txId: string) => Promise<"ok" | "failed" | "none" | null>;
  /** The newest confirmed transactions at an Add's one-time address (SOL only today, at most ADD_HINT_TXS), for 1Click's
   *  deposit hint: several, so dust sent there after the real deposit can't hide it. */
  depositTxs?: (chain: AddChain, address: string) => Promise<string[]>;
  /**
   * The NEAR coin wallet (Rhea trades, 3 Nov; D153/D70): filled and emptied ONLY through NEAR Confidential, never by a
   * public send from the Safe. `pay`: the core's own plain NEAR transfer from it (wNEAR unwrapped first when its NEAR
   * alone is short), exactly `amount` to `to`, its hash once a node took it. `spendable`: its NEAR and wNEAR, less the
   * gas it keeps. Not set: none on this phone.
   */
  nearCoin?: {
    wallet: () => Promise<{ id: string; address: string }>;
    nearUsd: () => Promise<number | null>;
    spendable: () => Promise<bigint>;
    pay: (to: string, amount: bigint) => Promise<string>;
  };
  now?: () => number;
  /** The key a 1Click quote must be signed with. Default: 1Click's own; tests sign their quotes with a test key. */
  quoteKey?: string;
  /** What 1Click holds for the float (oneclick-account.ts): where the count starts on a phone that has none (a restore). */
  confidentialBalances?: () => Promise<{ tokenId: string; amount: string }[]>;
  /** A NEAR Intents coin in dollars, its decimals and its symbol, from 1Click's own token list (the core's, never the
   *  app's): a swap's fair price and the words on its sheet. Null when 1Click can't say. */
  tokenPrice?: (tokenId: string) => Promise<{ usd: number; decimals: number; symbol?: string } | null>;
  /** Which chains' Add is open: ADD_OPEN (BNB also needs CHAIN_COIN.bsc.open). Tests only: the switches stay in code. */
  addOpen?: (chain: AddChain) => boolean;
  /** S21 (rule 11): what the Safe holds of one coin inside NEAR Intents, read from intents.near itself (mt_balance_of, the
   *  core's own agreed NEAR read), in smallest units; null when the nodes can't say. A move home ticks done only once
   *  this shows it landed. Not set (a core with no NEAR reads): 1Click's word, as before. */
  safeHeld?: (accountId: string, tokenId: string) => Promise<bigint | null>;
}

/** A NEAR coin's id in a swap: a nep141 contract account (2–64 of a-z 0-9 - _ ., no separator first, last or twice). */
const SWAP_COIN = /^nep141:(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;
/** The least a swap may move: under it most would go on fees. */
export const SWAP_MIN_USD = 1;
/** The line on the sheet of a sale of all of a coin worth under SWAP_MIN_USD (the only swap allowed under it). */
export const SWAP_SMALL_SALE_LINE = "Most of this goes on fees.";
/** A swap's least may be at most this far under its worth at 1Click's own listed price (and SWAP_FEE_ROOM_USD of fees). */
export const SWAP_FAIR = 0.9;
export const SWAP_FEE_ROOM_USD = 0.1;
/** What a swap is, for its sheet or a session: the dollars it's worth and its words. */
/** `sheetOnly`: the person's own sheet, never a session (a whole sale under the floor: its price list is the only check
 *  left, so the person sees "Most of this goes on fees." and the least before it goes; review of 6c9d2920, Low 2). */
export interface SwapAsk { usd: number; words: PlainWords; sheetOnly?: boolean }
/** How long a swap's signed intent can run: our price's 10 minutes, rounded up to the next 5-minute mark (privacy P7,
 *  quote-deadline.ts: at most one QUOTE_DEADLINE_STEP_MS more), plus the 3 days 1Click adds to every confidential quote
 *  (recorded 25 Oct: request deadline + exactly 3 days, the intent's deadline equal to it), and a minute of clock. */
const SWAP_DEADLINE_MS = QUOTE_MINUTES * 60_000 + QUOTE_DEADLINE_STEP_MS + 3 * 86_400_000 + 60_000;
/** A coin's symbol fit for the core's sheet: one plain ASCII word of up to 12 (letters, digits, . $ _ -), with its contract in
 *  brackets when 1Click lists the symbol twice (review M2). Never a sentence: words in a coin's name never become the sheet's. */
const SHEET_SYMBOL = /^[A-Za-z0-9.$_-]{1,12}(?: \([a-z0-9._-]{2,64}\))?$/;

/** What a done swap brought: 1Click's settled amount when it lies between the signed least and the signed amount out
 *  plus 5 %; else the least (a relay's unsigned word never counts in more than 1Click signed). */
const swapGot = (k: Kept): string => {
  const got = k.settled?.amountOut, least = BigInt(k.move.expected.amount), most = k.signedOut ? (BigInt(k.signedOut) * 105n) / 100n : least;
  return got && /^\d{1,40}$/.test(got) && BigInt(got) >= least && BigInt(got) <= (most > least ? most : least) ? got : k.move.expected.amount;
};
const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
/** The wallet a kept move reached: by id (D55), a legacy slot, or the chain's current one. */
const refOf = (m: FloatMove): WalletRef => (m.wallet ? { id: m.wallet } : m.slot !== undefined ? { slot: m.slot } : {});
/** A move in that ended unpaid, in its row's words. */
const stillThere = (chain: TradeChain) => `Didn't go · the money is still in your ${CHAIN_NAME[chain]} wallet`;
/** An error's own words, short: a Problem's what-happened, else its message (a node's refusal, as it said it). */
const wordsOf = (e: unknown): string => {
  const p = (e as { problem?: { whatHappened?: unknown } })?.problem?.whatHappened;
  return (typeof p === "string" ? p : String((e as Error)?.message ?? e)).replace(/\s+/g, " ").slice(0, 200);
};
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
const CHAIN_NAME: Record<TradeChain, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };
const CHAIN_COIN_NAME: Record<TradeChain, string> = { sol: "SOL", hood: "ETH", bsc: "BNB" };
/** A short, steady tag for a coin with no chain of its own, for its move's key (`<key>-<tag>`). */
const coinTag = (tokenId: string): string => {
  let h = 0x811c9dc5;
  for (const c of tokenId) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `c${h.toString(36)}`;
};
/** How long past its price's deadline a submitted move waits before the core checks whether it can still happen (RM-2). */
const OUT_GRACE_MS = 60 * 60_000;
/** A move out 1Click says landed, whose chain's nodes never say so (they can't read it), is done on 1Click's word after this. */
const LANDED_WAIT_MS = 10 * 60_000;
/** A move home 1Click says is done that intents.near hasn't shown in the Safe within LANDED_WAIT_MS (S21, the copy review's words):
 *  its `unshown` line, on its way until a read shows it. */
export const HOME_UNREAD = "NEAR Intents says it's done. Your Safe hasn't shown it yet. Pull down on Home to check.";
const IN_GRACE_MS = 24 * 60 * 60_000;
/**
 * A move in whose transfer no node took is asked whether it provably never landed this long after OUR price's 10 minutes
 * (1Click's own deadline is days on: mainnet 2 Nov, two such moves said "moving" with the money still in the wallets).
 * On Solana only within UNPAID_SOL_MS of its start: a node's history can be cut at about a day, and "no transaction" from
 * a node that no longer remembers that far back would be a false proof.
 */
const UNPAID_GRACE_MS = 10 * 60_000;
const UNPAID_SOL_MS = 20 * 60 * 60_000;
/** A Solana transfer signed with a blockhash this core kept, no node took: asked this soon (product decision, 5 Nov: 20
 *  minutes of "Leaving your SOL wallet"). Its proof is the chain's own: that blockhash expired on both nodes (about a
 *  minute on) and the deposit address untouched; until both say so it stays open, so asking early never ends one early. */
const UNPAID_SOL_SIGNED_MS = 2 * 60_000;

/** The Add's quote, kept for the main sheet's words for this long. */
const ADD_QUOTE_MS = 30 * 60_000;

/** A Move back's home leg goes the moment its first leg settled: D137 (product decision, 3 Nov), "the only delay our app
 *  should have is the network". No private gap. */
/** A Move back's home leg refused for good, before anything was signed: said on its row (homeStopped). */
const FOR_GOOD = new Set(["security.request.not-allowed", "security.request.invalid", "security.subwallet.refused"]);

export function homeGapMs(_key: string): number {
  return 0;
}

/**
 * NEAR's price for a move into or out of the NEAR coin wallet, asked up to 3 times 0.3 s apart, each read bounded at 0.6 s (the test speed run,
 * 4 Nov: one unanswered read stopped the NEAR rounds before any move: "the price service" unreachable). Still null after
 * the third: the move is refused as before, nothing moved. A read that answers is never asked again.
 */
export async function nearPriceSoon(read: () => Promise<number | null>, tries = 3, gapMs = 300, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), readMs = 600): Promise<number | null> {
  // each read is bounded (a code review): a read that hangs counts as unanswered after readMs, so three misses
  // can't pass ~2.4 s (3 x 600 + 2 x 300); the kept price (sheetNearUsd's minute) answers at once when warm
  for (let i = 0; i < tries; i++) {
    const px = await Promise.race([read().catch(() => null), sleep(readMs).then(() => null)]);
    if (px && px > 0) return px;
    if (i < tries - 1) await sleep(gapMs);
  }
  return null;
}

export class FloatMoves {
  /** Home legs of Move backs: the person's sheet for the whole move was their yes (never a background sheet). */
  private readonly approvedHome = new Set<string>();
  private readonly d: FloatMoveDeps;
  private readonly now: () => number;
  /** Writes to the record, one at a time. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(deps: FloatMoveDeps) {
    this.d = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  private async book(): Promise<Book> {
    const raw = await this.d.vault.get(RECORD);
    if (!raw) return { base: {}, kept: [] };
    try {
      const v = JSON.parse(new TextDecoder().decode(raw));
      // Before float.balance the record was the list of moves alone.
      if (Array.isArray(v)) return { base: {}, kept: v };
      return { base: v?.base && typeof v.base === "object" ? v.base : {}, kept: Array.isArray(v?.kept) ? v.kept : [], ...(typeof v?.checkedAtMs === "number" ? { checkedAtMs: v.checkedAtMs } : {}) };
    } catch {
      return { base: {}, kept: [] };
    }
  }

  private async kept(): Promise<Kept[]> {
    return (await this.book()).kept;
  }

  /** Save one move (new or changed); moves older than a week are let go, what they did folded into the base. */
  private async keep(k: Kept): Promise<void> {
    await this.amend(k.move.id, () => k);
  }

  /**
   * One move's read-and-write as one step, in the record's own order: `change` sees the move as it is kept now and
   * answers what to keep (null: nothing is written). So a write made from an older read never lands over a newer one
   * (a refresh that read the move before its transfer was kept: audit of 045f88c0).
   */
  private amend(id: string, change: (now: Kept | undefined) => Kept | null): Promise<Kept | null> {
    const next = this.writing.then(async () => {
      const { base, kept, checkedAtMs } = await this.book();
      const k = change(kept.find((x) => x.move.id === id));
      if (!k) return null;
      k.move.updatedAtIso = new Date(this.now()).toISOString();
      const others = kept.filter((x) => x.move.id !== k.move.id);
      const old = (x: Kept) => !(Date.parse(x.move.startedAtIso) > this.now() - KEEP_MS);
      for (const x of others.filter(old)) for (const [t, a] of this.effect(x)) base[t] = (BigInt(base[t] ?? "0") + a).toString();
      await this.d.vault.put(RECORD, utf8(JSON.stringify({ base, kept: [k, ...others.filter((x) => !old(x))], ...(checkedAtMs ? { checkedAtMs } : {}) })));
      return k;
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /**
   * A Top up's Add from the Safe (quoteAdd) as the core follows it: its status by the deposit address the Safe paid, or
   * null for any other address. The core keeps it and asks the relay with its quote's tag on every balance read, so this
   * outlives the page that started it: Spending's row ends from here when Wallet's own follow is gone (finding 18).
   */
  async addStatus(depositAddress: unknown, job?: unknown): Promise<{ status: FloatMove["status"]; depositAddress?: string; tokenId?: string; deadlineMs?: number } | null> {
    // by the job's key (a page closed while the Safe signed knows no deposit address yet): its address and coin too
    if (typeof job === "string" && JOB_KEY.test(job)) {
      await this.writing;
      const k = (await this.kept()).find((x) => x.add && !x.outside && x.job === job);
      return k ? { status: k.move.status, ...(k.depositAddress ? { depositAddress: k.depositAddress } : {}), tokenId: k.move.sent.tokenId, deadlineMs: Date.parse(k.move.startedAtIso) + QUOTE_MINUTES * 60_000 } : null;
    }
    if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) return null;
    await this.writing;
    const k = (await this.kept()).find((x) => x.add && !x.outside && x.depositAddress === depositAddress);
    return k ? { status: k.move.status } : null;
  }

  async moves(): Promise<FloatMove[]> {
    await this.writing;
    return (await this.kept()).filter((k) => !k.add).map(withDeposit).sort((a, b) => Date.parse(b.startedAtIso) - Date.parse(a.startedAtIso));
  }

  /**
   * What one move or Add did to the float, by the core's own count. Paid out of it (out, home): gone once signed, until
   * 1Click says it never left (failed). Paid into it (in, an Add): only once 1Click says it settled. A refund always
   * comes back to the float, in the coin that was sent.
   */
  /** The count, by coin: the base and what every move kept did. */
  private counts(b: Book): Map<string, bigint> {
    const sum = new Map<string, bigint>(Object.entries(b.base).filter(([, a]) => /^-?\d+$/.test(a)).map(([t, a]) => [t, BigInt(a)]));
    for (const k of b.kept) for (const [t, a] of this.effect(k)) sum.set(t, (sum.get(t) ?? 0n) + a);
    return sum;
  }

  private effect(k: Kept): Map<string, bigint> {
    const m = k.move;
    const e = new Map<string, bigint>();
    const add = (tokenId: string, units: string | undefined, sign = 1n) => {
      if (units !== undefined && /^\d+$/.test(units)) e.set(tokenId, (e.get(tokenId) ?? 0n) + sign * BigInt(units));
    };
    const ended = m.status === "done" || m.status === "refunded";
    if (m.kind === "out" || m.kind === "home" || m.kind === "swap") {
      if (ended || (m.status === "pending" && (k.signed || k.submitted))) add(m.sent.tokenId, m.sent.amount, -1n);
      // a swap stays inside Spending: what it bought (or sold for) lands back in the float once 1Click says it settled
      // review L2: the relay's settled figure only between the signed least and the signed amount out (+5 %)
      if (m.kind === "swap" && m.status === "done") add(m.expected.tokenId, swapGot(k));
      // an Add from another chain (E1, E2) lands as its own coin, never USDC
    } else if (m.status === "done") add(k.outside ? m.expected.tokenId : FLOAT_USDC, k.settled?.amountOut ?? m.expected.amount);
    if (m.status === "done") add(m.sent.tokenId, k.settled?.refunded);
    // a relay's unsigned refund figure is never more than what was sent (review L1); an Add from another chain takes any
    // deposit (FLEX_INPUT), so a refund over its sized amount counts once 1Click's own balance is read (balance())
    const capped = (r: string | undefined) => (r !== undefined && /^\d{1,40}$/.test(r) && BigInt(r) <= BigInt(m.sent.amount) ? r : m.sent.amount);
    if (m.status === "refunded") add(m.sent.tokenId, capped(k.settled?.refunded));
    return e;
  }

  /**
   * What the float holds, by the core's own count: open moves and Adds asked about first (through the relay), then the
   * base and every move kept. `usd` is about, at the core's prices; a coin without a price isn't in it.
   */
  /**
   * No count on this phone yet (a restore, or a float that never moved): it starts from what 1Click holds for the float,
   * read with the float's own sign-in. False when that couldn't be read (the count is then unknown, not zero).
   */
  private async seeded(): Promise<boolean> {
    if (await this.d.vault.get(RECORD)) return true;
    if (!this.d.confidentialBalances) return true;
    const held = await this.d.confidentialBalances().catch(() => null);
    if (!held) return false;
    const next = this.writing.then(async () => {
      if (await this.d.vault.get(RECORD)) return;
      await this.d.vault.put(RECORD, utf8(JSON.stringify({ base: Object.fromEntries(held.map((t) => [t.tokenId, t.amount])), kept: [], checkedAtMs: this.now() })));
    });
    this.writing = next.catch(() => undefined);
    await next;
    return true;
  }

  async balance(): Promise<{ tokens: { tokenId: string; amount: string }[]; usd: number; asOfIso: string; unread?: true }> {
    await this.writing;
    if (!(await this.seeded())) return { tokens: [], usd: 0, asOfIso: new Date(this.now()).toISOString(), unread: true };
    // Adds from another chain take their own turns (outsideStep): a sheet opened often leaves many unpaid addresses, and
    // they never crowd out Trading's own moves here
    const open = (await this.kept()).filter((k) => k.move.status === "pending" && k.depositAddress && !k.outside).slice(0, REFRESH_AT_MOST);
    await Promise.all(open.map((k) => this.refresh(k).catch(() => undefined)));
    await this.writing;
    // an Add that landed goes on (its forward), and a restart picks one up where it stopped (its code loads only then)
    if ((await this.kept()).some((k) => k.outside)) await this.add((m, h) => m.outsideStep(h)).catch(() => undefined);
    await this.writing;
    // a Move back that settled in Spending goes on home now, before anything counts it as Spending's cash to plan with
    for (const k of (await this.kept()).filter((x) => x.thenHome && x.move.status === "done" && !x.move.homeId)) await this.goHome(k).catch(() => undefined);
    await this.writing;
    const book = await this.book();
    const { kept, checkedAtMs } = book;
    let sum = this.counts(book);
    // Moves' statuses come through the relay outside 1Click's signature, so a relay could misreport one. With no move
    // open, every few minutes, the count is held against what 1Click holds for the float, read with the float's own
    // sign-in (never through the relay), and any difference is kept as a correction: the moves stay listed as they are.
    // An Add's address no money has reached yet (open for days) changes nothing in the count, so it never holds this up.
    if (this.d.confidentialBalances && !kept.some((k) => k.move.status === "pending" && !(k.outside && k.move.where === "chain")) && this.now() - (checkedAtMs ?? 0) >= (emptyBook(book) ? EMPTY_RECONCILE_MS : RECONCILE_MS)) {
      const held = await this.d.confidentialBalances().catch(() => null);
      if (held) {
        const actual = new Map(held.filter((t) => /^\d{1,40}$/.test(t.amount)).map((t) => [t.tokenId, BigInt(t.amount)]));
        // review M1: with an Add open, every open Add is asked about first (after 1Click's balance was read), so money that
        // landed is counted by its own move, never also here; a coin whose open Adds weren't all read keeps its count
        const open = kept.filter((k) => k.outside && k.move.status === "pending");
        const skip = open.length ? await this.add((m, h) => m.readOpen(h)).catch(() => new Set(open.map((k) => k.move.sent.tokenId))) : null;
        const next = this.writing.then(async () => {
          const b = await this.book();
          const now = skip ? this.counts(b) : sum;
          for (const t of new Set([...now.keys(), ...actual.keys()])) {
            const diff = (actual.get(t) ?? 0n) - (now.get(t) ?? 0n);
            if (diff !== 0n && !skip?.has(t)) b.base[t] = (BigInt(b.base[t] ?? "0") + diff).toString();
          }
          await this.d.vault.put(RECORD, utf8(JSON.stringify({ base: b.base, kept: b.kept, checkedAtMs: this.now() })));
        });
        this.writing = next.catch(() => undefined);
        await next;
        sum = this.counts(await this.book());
      }
    }
    const tokens = [...sum].filter(([, a]) => a > 0n).map(([tokenId, a]) => ({ tokenId, amount: a.toString() }));
    // Every coin's price asked at once (Home speed, 3 Nov: one coin after another, each a round trip), summed in order.
    const priced = await Promise.all(tokens.map(async (t) => {
      const chain = (Object.keys(CHAIN_COIN) as TradeChain[]).find((c) => CHAIN_COIN[c].tokenId === t.tokenId);
      return { t, chain, price: chain && this.d.usdPrice ? await this.d.usdPrice(chain).catch(() => null) : null };
    }));
    let usd = 0;
    for (const { t, chain, price } of priced) {
      if (t.tokenId === FLOAT_USDC) usd += Number(t.amount) / 1e6;
      if (chain && price) usd += (Number(t.amount) / 10 ** CHAIN_COIN[chain].decimals) * price;
    }
    return { tokens, usd: Math.round(usd * 100) / 100, asOfIso: new Date(this.now()).toISOString() };
  }

  /** The same key again: that move. A key used for a different move, or none: refused. */
  /**
   * One call per move key at a time (audit AUD-CORE-1): a call whose key is already in flight gets that call's answer,
   * so two that overlap (a bridge timeout, then the job runner's retry with the same key) never sign two transfers. The
   * key's own record (again) still refuses one used for a different move once the first is kept.
   */
  private readonly inFlight = new Map<string, Promise<FloatMove | { declined: true }>>();
  /** The moves in whose transfer this core is making right now: never ended as unpaid while it may still be sent. */
  private readonly paying = new Set<string>();
  private once(key: unknown, run: () => Promise<FloatMove | { declined: true }>): Promise<FloatMove | { declined: true }> {
    if (typeof key !== "string") return run();
    const had = this.inFlight.get(key);
    if (had) return had;
    // And across cores on the same vault (audit RM-4).
    const p = withMoveKey(this.d.vault, `float:${key}`, () => this.now(), run).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async again(key: unknown, fields: string): Promise<FloatMove | null> {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw invalid("key is Trade's own id for this move: 16 to 64 letters, digits, - or _");
    await this.writing;
    const had = (await this.kept()).find((k) => k.key === key && !k.add);
    if (!had) return null;
    if (had.fields !== fields) throw invalid("Trade sent this move's id before, for a different move.");
    return { ...had.move };
  }

  /** The chain, and which of its wallets (D55): `id` (to or from), else a legacy slot, else the chain's current wallet. */
  private chainOf(chain: unknown, slot: unknown, id?: unknown): { chain: TradeChain; ref: WalletRef } {
    if (chain !== "sol" && chain !== "bsc" && chain !== "hood") throw invalid("chain is sol, hood or bsc");
    if (!CHAIN_COIN[chain].open) throw refused(`${CHAIN_NAME[chain]} opens once ZeroFee has tested it with real money.`);
    if (id !== undefined) {
      if (slot !== undefined) throw invalid("name the wallet by its id or, from an older journal, its slot: not both");
      if (typeof id !== "string" || !WALLET_ID.test(id)) throw invalid("the wallet is one of your chain wallets' ids");
      return { chain, ref: { id } };
    }
    if (slot === undefined) return { chain, ref: {} };
    // Legacy (before D55): 0–4 the trading wallets; SITE_SLOT the old apps wallet, Solana only.
    if (slot === SITE_SLOT && chain !== "sol") throw invalid("a site's wallet is on Solana");
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > SITE_SLOT) throw invalid("slot is 0 to 4, or 5 for the site's wallet");
    return { chain, ref: { slot: slot as number } };
  }

  private async price(chain: TradeChain): Promise<number> {
    const p = this.d.usdPrice ? await this.d.usdPrice(chain).catch(() => null) : null;
    if (!p) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    return p;
  }

  /** Float → that trading wallet: exactly `amount` of the chain's own coin arrives (exact out). */
  /** `to`: the chain wallet's id (D55); none, the chain's current wallet. `slot`: legacy only. */
  out(chain: unknown, slot: unknown, amount: unknown, key: unknown, to?: unknown): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => this.outNow(chain, slot, amount, key, to));
  }

  private async outNow(chain: unknown, slot: unknown, amount: unknown, key: unknown, toId?: unknown): Promise<FloatMove | { declined: true }> {
    // The same shape as before D55 (so a journal's saved key still matches), with `to` only when it is given.
    const fields = JSON.stringify(["out", chain, slot, amount, ...(toId === undefined ? [] : [{ to: toId }])]);
    const had = await this.again(key, fields);
    if (had) return had;
    const c = this.chainOf(chain, slot, toId);
    if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is the chain's own coin in smallest units, as text");
    // Refused before anything is asked of the network (a price read first made the answer depend on it).
    if (!this.d.relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    // D56: an exported key changes nothing here (the wallet stays its chain's one); what can reach it stays bounded by
    // Spending's cap and this fee guard ($1,000 and 20 moves in 24 hours without the sheet)
    const to = await this.d.wallet(c.chain, c.ref, true);
    // New words were asked for because the old ones may have been seen: a wallet that opens with them is never filled
    // (security review 2 Nov), not even with gas; its own coin still comes back.
    if (to.oldWords) throw refused("That wallet uses your old words, so ZeroFee stopped filling it. You can still move its money out.");
    // An older wallet whose key was shown is outside ZeroFee's hands as well: D56 keeps only the network's current wallet
    // filled, so an exported older one gets nothing, not even gas (security review 2 Nov, Low).
    if (to.exportedOlder) throw refused("You showed that wallet's key, so ZeroFee stopped filling it. You can still move its money out.");
    const coin = CHAIN_COIN[c.chain];
    const usd = (Number(amount) / 10 ** coin.decimals) * (await this.price(c.chain));
    return this.fromFloat({
      kind: "out", key: key as string, fields, usd, chain: c.chain, slot: c.ref.slot, wallet: to.id,
      ask: { swapType: "EXACT_OUTPUT", destinationAsset: coin.tokenId, amount, recipient: to.address, recipientType: "DESTINATION_CHAIN" },
      atLeast: BigInt(amount),
      words: `Move about $${usd.toFixed(2)} to your ${CHAIN_NAME[c.chain]} wallet`,
    });
  }

  /**
   * Float → the main balance (Take out): `amount` of USDC, in smallest units, or "all". No sheet: money going home.
   * "all" is every coin the float holds by the core's own count (float.balance), each its own move arriving as USDC: a
   * refund of a move in comes back in the chain's own coin (audit AUD-CORE-2), and it must be able to leave too. The
   * answer is the USDC move (or, with none, the first coin's); the others are in float.moves, keyed `<key>-<chain>`.
   */
  home(amount: unknown, key: unknown, parked = false): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => this.homeNow(amount, key, parked));
  }

  private async homeNow(amount: unknown, key: unknown, parked = false): Promise<FloatMove | { declined: true }> {
    const fields = JSON.stringify(["home", amount]);
    // the same key again is the same move (a journal's resume asks again with it): never a second one
    const had = await this.again(key, fields);
    if (had) return had;
    // QA's SHOULD: `parked` only under the $2 floor (USDC), and only while no other parked move home is still
    // open on the float, so a Trade bug can't spend the day's moves on dust
    if (parked) {
      if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || !(BigInt(amount) > 0n && BigInt(amount) < BigInt(FLOAT_MIN_USD * 1e6))) throw invalid(`parked is only for USDC under $${FLOAT_MIN_USD}`);
      await this.writing;
      if ((await this.kept()).some((k) => k.parked && k.move.status === "pending")) throw refused("A move home of money left in your NEAR wallet is already on its way.");
    }
    if (!this.d.relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    if (amount !== "all") {
      if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid('amount is USDC in smallest units, as text, or "all"');
      return this.homeOne(FLOAT_USDC, BigInt(amount), key as string, fields, false, parked);
    }
    // Every coin it holds (audit RM-1): an Add paid in another vault coin (NEAR among them) that 1Click refunds comes back
    // to the float in that coin, and must be able to leave too.
    const coins = (await this.balance()).tokens
      .map((t) => ({ ...t, chain: (Object.keys(CHAIN_COIN) as TradeChain[]).find((c) => CHAIN_COIN[c].tokenId === t.tokenId) }))
      .sort((a, b) => Number(b.tokenId === FLOAT_USDC) - Number(a.tokenId === FLOAT_USDC));
    if (coins.length === 0) throw invalid("Your NEAR wallet has nothing to move.");
    const [first, ...rest] = coins;
    const answer = await this.homeOne(first!.tokenId, BigInt(first!.amount), key as string, fields);
    if ("declined" in answer) return answer;
    // The others after the first is kept: a call again with the key answers with it and starts nothing new.
    for (const t of rest) await this.homeOne(t.tokenId, BigInt(t.amount), `${key}-${t.chain ?? coinTag(t.tokenId)}`, JSON.stringify(["home", "all", t.tokenId])).catch(() => undefined);
    return answer;
  }

  /**
   * One coin of the float home: a chain's own coin as USDC, at a fair price for exactly that much; any other coin
   * (USDC, or one an Add's refund left, audit RM-1) as itself, at least 98 % of it, so no price is needed.
   */
  /** `noAsk`: an Add's forward home (E2), never a sheet in the background. */
  private async homeOne(tokenId: string, units: bigint, key: string, fields: string, noAsk = false, parked = false): Promise<FloatMove | { declined: true }> {
    const chain = (Object.keys(CHAIN_COIN) as TradeChain[]).find((c) => CHAIN_COIN[c].tokenId === tokenId);
    const ask = { swapType: "EXACT_INPUT", destinationAsset: chain ? FLOAT_USDC : tokenId, amount: units.toString(), recipient: await this.d.mainAccount(), recipientType: "INTENTS" };
    if (tokenId === FLOAT_USDC) {
      const usd = Number(units) / 1e6;
      return this.fromFloat({ kind: "home", key, fields, usd, ask, noAsk, ...(parked ? { parked: true as const } : {}), atLeast: (units * HOME_LEAST_PERCENT) / 100n, words: `Move $${usd.toFixed(2)} from your NEAR wallet to your Safe` });
    }
    if (!chain) {
      return this.fromFloat({ kind: "home", key, fields, usd: 0, unpriced: true, from: tokenId, ask, noAsk, atLeast: (units * HOME_LEAST_PERCENT) / 100n, words: "Move a coin left in your NEAR wallet to your Safe" });
    }
    const usd = (Number(units) / 10 ** CHAIN_COIN[chain].decimals) * (await this.price(chain));
    return this.fromFloat({
      kind: "home", key, fields, usd, from: tokenId, ask, noAsk,
      atLeast: BigInt(Math.ceil(least(usd) * 1e6)),
      words: `Move about $${usd.toFixed(2)} of ${CHAIN_COIN_NAME[chain]} from your NEAR wallet to your Safe`,
    });
  }

  /**
   * That trading wallet → the float, as USDC: a fresh confidential quote for each move (a one-time deposit address, never
   * a pinned one: one address every wallet paid would link them all on chain), read back through the relay, then the
   * core's own transfer of exactly the quote's amount. "all": what the wallet can send, its network fee kept back.
   */
  /** `from`: the chain wallet's id (D55); none, the chain's current wallet. `slot`: legacy only. `back`: Social Trading's
   *  Move back from a site's own wallet (the core's subwallet.site.moveBack, after its sheet): the site's id, and the money
   *  goes on home to the Safe once it settles in Spending. */
  in(chain: unknown, slot: unknown, amount: unknown, key: unknown, from?: unknown, back?: { site: string }): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => this.inNow(chain, slot, amount, key, from, back));
  }

  private async inNow(chain: unknown, slot: unknown, amount: unknown, key: unknown, fromId?: unknown, back?: { site: string }): Promise<FloatMove | { declined: true }> {
    const fields = JSON.stringify(["in", chain, slot, amount, ...(fromId === undefined ? [] : [{ from: fromId }]), ...(back ? [{ back: back.site }] : [])]);
    const had = await this.again(key, fields);
    if (had) return had;
    const c = this.chainOf(chain, slot, fromId);
    // a Move back names its own key: the core opened that site wallet for this one move only (review A, M1)
    if (back) c.ref = { ...c.ref, back: key as string };
    if (amount !== "all" && (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n)) throw invalid('amount is the chain\'s own coin in smallest units, as text, or "all"');
    const relay = this.d.relay;
    if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const float = await this.d.float();
    const w = await this.d.wallet(c.chain, c.ref);
    // The wallet as it was found now, for every step after (the current one can't change under a move).
    const ref: WalletRef = w.id ? { id: w.id, ...(c.ref.back ? { back: c.ref.back } : {}) } : c.ref;
    const coin = CHAIN_COIN[c.chain];
    // Its network fee is signed with no sheet (audit NF-16): at most 2% of the move and $0.50, and it counts in the
    // guard's dollars. The transfer is then signed only if its fee is no more than this; "all" keeps exactly this back,
    // so what's sent and its fee always fit in the wallet.
    const fee = this.d.networkFee ? await this.d.networkFee(c.chain, ref) : 0n;
    const units = amount === "all" ? await this.d.spendable(c.chain, ref, this.d.networkFee ? fee : undefined) : BigInt(amount as string);
    if (units <= 0n) throw invalid("That wallet has nothing to move.");
    const price = await this.price(c.chain);
    const usd = (Number(units) / 10 ** coin.decimals) * price;
    const feeUsd = (Number(fee) / 10 ** coin.decimals) * price;
    if (fee * 50n > units || feeUsd > 0.5) throw new ProblemError(securityProblems.feeHigh());
    const place = await this.d.guard.take(usd + feeUsd);
    // past the guard: refused, named (D143: no sheet); a Move back to the Safe always goes
    if (place.ask && !back) await this.refusePastGuard(place.why, place.release);
    const at = new Date(this.now()).toISOString();
    const k: Kept = {
      key: key as string, fields, ...(back ? { thenHome: true as const } : {}),
      move: { id: `fm-${key}`, kind: "in", chain: c.chain, ...(c.ref.slot === undefined ? {} : { slot: c.ref.slot }), ...(w.id ? { wallet: w.id } : {}), ...(back ? { site: back.site } : {}), status: "pending", where: "chain", sent: { tokenId: coin.tokenId, amount: units.toString() }, expected: { tokenId: FLOAT_USDC, amount: "0" }, usd: Math.round(usd * 100) / 100, startedAtIso: at, updatedAtIso: at },
    };
    let depositAddress = "";
    try {
      const raw = await relay.quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: coin.tokenId, depositType: "ORIGIN_CHAIN",
        destinationAsset: FLOAT_USDC, amount: units.toString(), refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
        recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS", deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      });
      depositAddress = raw?.quote?.depositAddress;
      const shape = c.chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/;
      if (typeof depositAddress !== "string" || !shape.test(depositAddress)) throw refused("NEAR Intents gave no address to pay on that network. Nothing moved.");
      k.depositAddress = depositAddress;
      if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
      await this.keep(k);
      const q = parseQuote(await relay.status(depositAddress, k.tag), depositAddress, this.d.quoteKey);
      const why = this.notAskedIn(q, { coin: coin.tokenId, float: float.address, units, usd });
      if (why) throw refused(why);
      k.move.expected = { tokenId: FLOAT_USDC, amount: q!.minAmountOut };
      await this.keep(k);
    } catch (e) {
      await place.release();
      if (k.depositAddress) (k.move.status = "failed"), await this.keep(k);
      throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    // From here the money may move, so the move is answered, never thrown: with no node taking the transfer it stays
    // pending on the chain, saying why, until it is provably unpaid (refresh) or its price runs out (subwallet.float.move).
    // What the signed transfer depends on is kept before it is sent; a move a refresh already ended is never paid.
    // The check and the keeping are one step in the record's order, and never past our price's 10 minutes: a refresh
    // asks whether it was paid only 10 minutes after that, and never while this core is still making the transfer.
    const tried = async (t: PayTry) => {
      if (this.now() > Date.parse(k.move.startedAtIso) + QUOTE_MINUTES * 60_000) throw new Error("its price ran out before it was signed");
      const ok = await this.amend(k.move.id, (now) => (now?.move.status === "pending" ? ((k.tried = t), k) : null));
      if (!ok) throw new Error("this move had already ended");
    };
    this.paying.add(k.move.id);
    try {
      const sent = await this.d.pay(c.chain, ref, depositAddress, units, fee, tried);
      if (!sent) throw new Error("no node took it");
      Object.assign(k, { submitted: true, paidTx: sent });
      k.move.where = "in-flight";
      this.hintDeposit(k);
    } catch (e) {
      // Mainnet 2 Nov: this was thrown away, so the move said "moving" for 3 days and nobody could say why.
      k.payError = wordsOf(e);
      // Never signed (product decision, 5 Nov: a SOL wallet -> Safe Move said "Leaving your SOL wallet" for 20 minutes with no
      // transaction): `tried` runs after the transfer is signed and before it is sent, so with none kept no transfer exists
      // and nothing can have left the wallet. It ends now, the money in the wallet, never "on its way". Only this attempt's
      // own k: a move asked again (its record reloaded) is answered from that record by again() and never pays here, so an
      // EARLIER attempt's kept `tried` keeps its move pending: a retry after a real send can never say "still in your wallet".
      if (!k.tried) {
        Object.assign(k.move, { status: "failed", where: "chain", reason: `Didn't go: ${k.payError} · the money is still in your ${CHAIN_NAME[c.chain]} wallet` });
        await place.release();
      } else k.move.reason = `Not sent from your ${CHAIN_NAME[c.chain]} wallet: ${k.payError}`;
    } finally {
      this.paying.delete(k.move.id);
    }
    // A move that ended meanwhile (1Click's own word) stays ended: only what the transfer did is added to it.
    const kept = await this.amend(k.move.id, (now) =>
      !now || now.move.status === "pending" ? k : { ...now, ...(k.submitted ? { submitted: true, paidTx: k.paidTx } : {}), ...(k.tried ? { tried: k.tried } : {}), ...(k.payError ? { payError: k.payError } : {}) },
    );
    return { ...(kept ?? k).move };
  }

  /**
   * Spending → the NEAR coin wallet (Make ready for NEAR coins on Rhea, 3 Nov; D153/D70): exactly `amount` yoctoNEAR
   * delivered by a confidential 1Click quote from Spending's USDC (the same fromFloat as a SOL wallet's fill: paid from the
   * confidential balance, refunded into it), never a public send from the Safe. `key` makes asking again safe.
   */
  /** `usd` in place of `amount`: that many dollars of NEAR at the core's own price (Home's Move, Spending's Make ready). */
  nearOut(amount: unknown, key: unknown, usd?: unknown): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => this.nearOutNow(amount, key, usd));
  }

  private async nearOutNow(amount0: unknown, key: unknown, usd0?: unknown): Promise<FloatMove | { declined: true }> {
    const fields = JSON.stringify(["near-out", amount0, ...(usd0 === undefined ? [] : [{ usd: usd0 }])]);
    const had = await this.again(key, fields);
    if (had) return had;
    const n = this.d.nearCoin;
    if (!this.d.relay || !n) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const to = await n.wallet();
    const px = await nearPriceSoon(n.nearUsd);
    if (!px) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    const amount = amount0 === undefined && typeof usd0 === "number" && Number.isFinite(usd0) && usd0 >= FLOAT_MIN_USD ? ((BigInt(Math.floor((usd0 / px) * 1e6)) * 10n ** 18n) / 10n ** 22n * 10n ** 22n).toString() : amount0;
    if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is yoctoNEAR, as text (or usd, at least the least a move takes)");
    const usd = (Number(BigInt(amount) / 10n ** 18n) / 1e6) * px;
    return this.fromFloat({
      kind: "out", key: key as string, fields, usd, wallet: to.id,
      ask: { swapType: "EXACT_OUTPUT", destinationAsset: NEAR_COIN_TOKEN, amount, recipient: to.address, recipientType: "DESTINATION_CHAIN" },
      atLeast: BigInt(amount),
      words: `Move about $${usd.toFixed(2)} to your NEAR coin wallet`,
    });
  }

  /**
   * The NEAR coin wallet → Spending (Put away, 3 Nov; D153/D70): its NEAR (`amount` yocto, or "all" it can spend) paid to
   * a confidential 1Click quote's one-time NEAR address, arriving as USDC in Spending's confidential balance, a refund
   * coming back there too. The quote is read back as 1Click signed it and held to the ask before anything is paid.
   */
  nearIn(amount: unknown, key: unknown, usd?: unknown): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => this.nearInNow(amount, key, usd));
  }

  private async nearInNow(amount: unknown, key: unknown, usd0?: unknown): Promise<FloatMove | { declined: true }> {
    const fields = JSON.stringify(["near-in", amount, ...(usd0 === undefined ? [] : [{ usd: usd0 }])]);
    const had = await this.again(key, fields);
    if (had) return had;
    const byUsd = amount === undefined && typeof usd0 === "number" && Number.isFinite(usd0) && usd0 >= FLOAT_MIN_USD;
    if (!byUsd && amount !== "all" && (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n)) throw invalid('amount is yoctoNEAR, as text, or "all" (or usd)');
    const n = this.d.nearCoin, relay = this.d.relay;
    if (!relay || !n) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const [float, w] = await Promise.all([this.d.float(), n.wallet()]);
    const px = await nearPriceSoon(n.nearUsd);
    if (!px) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    const can = await n.spendable();
    const units = amount === "all" ? can : byUsd ? BigInt(Math.floor(((usd0 as number) / px) * 1e6)) * 10n ** 18n : BigInt(amount as string);
    if (units <= 0n) throw invalid("That wallet has nothing to move.");
    if (units > can) throw refused("Your NEAR coin wallet doesn't have that much to move.");
    const usd = (Number(units / 10n ** 18n) / 1e6) * px;
    const place = await this.d.guard.take(usd);
    if (place.ask) await this.refusePastGuard(place.why, place.release);
    const at = new Date(this.now()).toISOString();
    const k: Kept = {
      key: key as string, fields,
      move: { id: `fm-${key}`, kind: "in", wallet: w.id, status: "pending", where: "chain", sent: { tokenId: NEAR_COIN_TOKEN, amount: units.toString() }, expected: { tokenId: FLOAT_USDC, amount: "0" }, usd: Math.round(usd * 100) / 100, startedAtIso: at, updatedAtIso: at },
    };
    let depositAddress = "";
    try {
      const raw = await relay.quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: NEAR_COIN_TOKEN, depositType: "ORIGIN_CHAIN",
        destinationAsset: FLOAT_USDC, amount: units.toString(), refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
        recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS", deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      });
      depositAddress = raw?.quote?.depositAddress;
      if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay on NEAR. Nothing moved.");
      k.depositAddress = depositAddress;
      if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
      await this.keep(k);
      const q = parseQuote(await relay.status(depositAddress, k.tag), depositAddress, this.d.quoteKey);
      const why = this.notAskedIn(q, { coin: NEAR_COIN_TOKEN, float: float.address, units, usd });
      if (why) throw refused(why);
      k.move.expected = { tokenId: FLOAT_USDC, amount: q!.minAmountOut };
      await this.keep(k);
    } catch (e) {
      await place.release();
      if (k.depositAddress) (k.move.status = "failed"), await this.keep(k);
      // NEAR's own coin in from its chain, which 1Click didn't take (near-chain-refused.ts): NEAR Intents', by name
      if (!k.depositAddress && upstreamRefused(e)) throw refused(nearWalletRefused(usd));
      throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    // from here the money may move: answered, never thrown; 1Click's own record ends it (refresh)
    this.paying.add(k.move.id);
    try {
      const sent = await n.pay(depositAddress, units);
      Object.assign(k, { submitted: true, paidTx: sent });
      k.move.where = "in-flight";
      this.hintDeposit(k);
    } catch (e) {
      k.payError = wordsOf(e);
      k.move.reason = `Not sent from your NEAR coin wallet: ${k.payError}`;
    } finally {
      this.paying.delete(k.move.id);
    }
    const kept = await this.amend(k.move.id, (now) => (!now || now.move.status === "pending" ? k : { ...now, ...(k.submitted ? { submitted: true, paidTx: k.paidTx } : {}), ...(k.payError ? { payError: k.payError } : {}) }));
    return { ...(kept ?? k).move };
  }

  /** The core's own deposit was sent: 1Click hears its transaction at once (deposit/submit), so it needn't find it on
   *  the chain. Never waited on and never failing the move: a hint only, 1Click still checks the chain. */
  hintDeposit(k: Pick<Kept, "depositAddress" | "paidTx" | "tag">): void {
    const r = this.d.relay;
    if (!r?.submitDeposit || !k.depositAddress || !k.paidTx) return;
    void Promise.resolve().then(() => r.submitDeposit!(k.depositAddress!, k.paidTx!, k.tag)).catch(() => undefined);
  }

  /** D119 landing 3: Trading ↔ the person's own Perps account on Hyperliquid (float-perps.ts, loaded on first use so it
   *  is never in Home's first load). */
  toPerps(amount: unknown, key: unknown, recipient: unknown): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => import("./float-perps.ts").then((m) => m.toPerps(this.kit(), amount, key, recipient)));
  }
  fromPerps(amount: unknown, key: unknown, pay: (depositAddress: string, amountIn: string) => Promise<void>): Promise<FloatMove | { declined: true }> {
    return this.once(key, () => import("./float-perps.ts").then((m) => m.fromPerps(this.kit(), amount, key, pay)));
  }
  /** Also lent to agent-wallet.ts toAgent (AgentZero's fill from the NEAR wallet), through SubWallets.agentWalletDo. */
  private kit(): PerpsKit {
    return { d: this.d, now: this.now, paying: this.paying, again: (k, f) => this.again(k, f), fromFloat: (o) => this.fromFloat(o), keep: (k) => this.keep(k), amend: (id, f) => this.amend(id, f), notAskedIn: (q, o) => this.notAskedIn(q, o), refusePastGuard: (w, r) => this.refusePastGuard(w, r) };
  }

  /** A move in is the one asked for: this wallet's coin, exactly the amount, USDC to the float, refunds to the float, a fair price. */
  private notAskedIn(q: QuoteFacts | null, o: { coin: string; float: string; units: bigint; usd: number }): string | null {
    if (!q) return "NEAR Intents doesn't know this payment address.";
    if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > this.now())) return "This price has run out.";
    if (q.originAsset !== o.coin || q.depositType !== "ORIGIN_CHAIN") return "It isn't paid from this wallet's own coin.";
    if (q.destinationAsset !== FLOAT_USDC || q.recipient !== o.float || q.recipientType !== "CONFIDENTIAL_INTENTS") return "It doesn't pay into your NEAR wallet.";
    if (q.refundTo !== o.float || q.refundType !== "CONFIDENTIAL_INTENTS") return "A refund must come back to your NEAR wallet.";
    if (q.amountIn !== o.units.toString()) return "Its amount isn't the one asked for.";
    if (!/^\d+$/.test(q.minAmountOut) || Number(q.minAmountOut) / 1e6 < least(o.usd)) return "Its price is too far from ZeroFee's own.";
    return null;
  }

  /**
   * The Add's quote (main balance → float, TRADE-FLOAT §1 S7): the core asks the relay itself, so the recipient and the
   * refund are the float, never an app's choice. Wallet pays it from the main balance (ledger.toTrading); the main key's
   * sheet then reads this quote through the core and says "Add … to Trading" (addFacts). Nothing moves here.
   */
  /**
   * `tokenId`: the main balance's coin it's paid with (a NEAR coin, "nep141:…"; default USDC). Any other coin is
   * converted inside the Add: 1Click's quote takes exactly `amount` of it and promises USDC to the float.
   */
  async quoteAdd(amount: unknown, tokenId: unknown = FLOAT_USDC, job?: unknown): Promise<{ depositAddress: string; amountIn: string; minAmountOut: string; deadlineIso: string; etaSeconds?: number }> {
    if (typeof tokenId !== "string" || !/^nep141:[a-z0-9_.-]{2,64}$/.test(tokenId)) throw invalid("The coin must be one held in your Safe.");
    if (job !== undefined && (typeof job !== "string" || !JOB_KEY.test(job))) throw invalid("job is the move's own key: 16 to 64 letters, digits, - or _");
    const usdc = tokenId === FLOAT_USDC;
    if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is the coin's smallest units, as text");
    const tooSmall = () => new ProblemError(securityProblems.requestNotAllowed(`A top up under $${FLOAT_MIN_USD} would mostly go on fees.`));
    if (usdc && Number(amount) / 1e6 < FLOAT_MIN_USD) throw tooSmall();
    const relay = this.d.relay;
    if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const float = await this.d.float();
    const raw = await relay
      .quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: tokenId, depositType: "ORIGIN_CHAIN", destinationAsset: FLOAT_USDC,
        amount, refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS", recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS",
        deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      })
      .catch((e: unknown) => {
        throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      });
    const depositAddress = raw?.quote?.depositAddress;
    if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay. Nothing moved.");
    const tag = typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag) ? raw.zerofeeStatusTag : undefined;
    const q = parseQuote(await relay.status(depositAddress, tag), depositAddress, this.d.quoteKey);
    const ok = q && q.status === "PENDING_DEPOSIT" && q.originAsset === tokenId && q.destinationAsset === FLOAT_USDC && q.recipient === float.address && q.recipientType === "CONFIDENTIAL_INTENTS" && q.refundTo === float.address && q.refundType === "CONFIDENTIAL_INTENTS" && q.amountIn === amount && /^\d{1,30}$/.test(q.minAmountOut);
    if (!ok) throw refused("NEAR Intents priced it differently than asked. Nothing moved.");
    // Another coin: what 1Click promises in USDC decides whether it's worth the fees.
    if (!usdc && Number(q!.minAmountOut) / 1e6 < FLOAT_MIN_USD) throw tooSmall();
    const at = new Date(this.now()).toISOString();
    await this.keep({
      add: true, key: `add:${depositAddress}`, fields: "", depositAddress, ...(tag ? { tag } : {}), ...(job ? { job: job as string } : {}),
      move: { id: `fa-${depositAddress}`, kind: "in", status: "pending", where: "main", sent: { tokenId, amount }, expected: { tokenId: FLOAT_USDC, amount: q!.minAmountOut }, usd: Math.round((Number(usdc ? amount : q!.minAmountOut) / 1e6) * 100) / 100, startedAtIso: at, updatedAtIso: at },
    });
    // 1Click's own time estimate (Home's Swap says "about 20 s"): display only, never part of a check or a signature.
    const eta = raw?.quote?.timeEstimate;
    return { depositAddress, amountIn: q!.amountIn, minAmountOut: q!.minAmountOut, deadlineIso: q!.deadline, ...(Number.isInteger(eta) && eta > 0 && eta <= 3600 ? { etaSeconds: eta as number } : {}) };
  }

  /** The core asked a Top up's Add (the Safe pays it, into Trading's balance) for this address: the tag's record. */
  async addAsked(depositAddress: string): Promise<boolean> {
    await this.writing;
    return (await this.kept()).some((x) => x.add && !x.outside && x.depositAddress === depositAddress);
  }

  /** For the main key's sheet: the Add's quote by its deposit address, as the relay has it; null for any other address. */
  async addFacts(depositAddress: string): Promise<unknown | null> {
    await this.writing;
    // only a Top up's Add (the Safe pays it); an Add from another chain is never paid by the main sheet
    const k = (await this.kept()).find((x) => x.add && !x.outside && x.depositAddress === depositAddress);
    if (!k || !(this.now() - Date.parse(k.move.startedAtIso) <= ADD_QUOTE_MS) || !this.d.relay) return null;
    return this.d.relay.status(depositAddress, k.tag).catch(() => null);
  }

  /**
   * Home's Add and Request from another chain (E1, E2) and set-up's private route: a one-time confidential address on the
   * coin's own chain into the float, then on to the chain's wallet, the Safe or the account being opened. Their code
   * loads with their first use (float-add.ts), reaching the float only through this host.
   */
  private add<T>(run: (m: typeof import("./float-add.ts"), h: AddHost) => Promise<T>): Promise<T> {
    // the float itself is the host: its own members, by name (AddHost)
    return import("./float-add.ts").then((m) => run(m, this as unknown as AddHost));
  }
  addOutside(chain: unknown, to: unknown, key: unknown, usd?: unknown): Promise<AddAddress> {
    return this.add((m, h) => m.addOutside(h, chain, to, key, usd));
  }
  addSetup(chain: unknown, key: unknown, setupAddress: unknown, usd: unknown): Promise<AddAddress> {
    return this.add((m, h) => m.addSetup(h, chain, key, setupAddress, usd));
  }
  setupFacts(key: string, everyMs?: number) {
    return this.add((m, h) => m.setupFacts(h, key, everyMs));
  }
  addsOnWay(): Promise<AddOnWayFacts[]> {
    return this.add((m, h) => m.addsOnWay(h));
  }
  /** The phone saw money reach one of its one-time addresses (its push): asked about now, and followed fast. */
  addSeen(address: unknown): Promise<boolean> {
    return this.add((m, h) => m.addSeen(h, address));
  }
  /** The one-time addresses still open for money, for the phone's push to watch (subwallet.add.watch). */
  addWatch(): Promise<AddWatch[]> {
    return this.add((m, h) => m.addWatch(h));
  }
  /** subwallet.received: every Add that ended, kept for good (float-add.ts addsReceived). */
  addsReceived(): Promise<Received[]> {
    return this.add((m, h) => m.addsReceived(h));
  }
  /**
   * The coins the float's own moves into or out of the Safe touched (a move home, an Add from the Safe) while open or
   * since `sinceMs`: the ledger's Safe watch never counts money one of them brought as money from someone else.
   */
  async safeTouched(sinceMs: number): Promise<string[]> {
    await this.writing;
    const out = new Set<string>();
    for (const k of await this.kept()) {
      if (!(k.add || k.move.kind === "home")) continue;
      if (k.move.status !== "pending" && !(Date.parse(k.move.updatedAtIso) >= sinceMs)) continue;
      out.add(k.move.sent.tokenId).add(k.move.expected.tokenId);
    }
    return [...out];
  }

  /** A move paid out of the float: quote, read back, check, sign, send; saved before each step. */
  private async fromFloat(o: FromFloatAsk): Promise<FloatMove | { declined: true }> {
    const from = o.from ?? FLOAT_USDC;
    const relay = this.d.relay;
    if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const float = await this.d.float();
    // Money going home to the main balance takes one of the day's moves, but not from its dollars.
    // a Move back's home leg sends what leg 1 delivered, whatever its size: under $2 it was refused, silently, and the money
    // stayed in Spending (QA's real $2 Take out, 5 Nov: $1.90 arrived); still one of the day's moves
    const backHome = o.kind === "home" && (this.approvedHome.has(o.key) || o.parked === true);
    const place = await this.d.guard.take(o.usd, o.kind !== "home", o.unpriced === true || backHome);
    // a Move back's home leg: the person's own sheet for the whole move was the yes; counted, never asked again in the
    // background (review A, M4)
    // past the guard: refused, named (D143: no sheet); money going home to the Safe, an Add's forward and a Move back's
    // home leg always go
    if (place.ask && !o.noAsk && !this.approvedHome.has(o.key) && o.kind !== "home") await this.refusePastGuard(place.why, place.release);
    const at = new Date(this.now()).toISOString();
    const k: Kept = {
      key: o.key, fields: o.fields, ...(o.parked ? { parked: true as const } : {}),
      move: { id: `fm-${o.key}`, kind: o.kind, ...(o.perps ? { perps: true as const } : {}), ...(o.chain ? { chain: o.chain, ...(o.slot === undefined ? {} : { slot: o.slot }), ...(o.wallet ? { wallet: o.wallet } : {}) } : o.wallet ? { wallet: o.wallet } : {}), status: "pending", where: "float", sent: { tokenId: from, amount: "0" }, expected: { tokenId: o.ask.destinationAsset, amount: o.ask.swapType === "EXACT_OUTPUT" ? o.ask.amount : o.atLeast.toString() }, usd: Math.round(o.usd * 100) / 100, startedAtIso: at, updatedAtIso: at },
    };
    try {
      const raw = await relay.quote({
        dry: false, swapType: o.ask.swapType, slippageTolerance: 100, originAsset: from, depositType: "CONFIDENTIAL_INTENTS",
        destinationAsset: o.ask.destinationAsset, amount: o.ask.amount, refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
        recipient: o.ask.recipient, recipientType: o.ask.recipientType, deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      });
      const depositAddress = raw?.quote?.depositAddress;
      if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay. Nothing moved.");
      k.depositAddress = depositAddress;
      if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
      await this.keep(k);
      // S21: a move home's landing is read on intents.near, against what the Safe held before it was sent; read beside
      // generate-intent, so the move is no slower (none read: it waits for LANDED_WAIT_MS, then says so; landedHome)
      const homeBefore = o.kind === "home" && this.d.safeHeld ? this.d.safeHeld(o.ask.recipient, o.ask.destinationAsset).catch(() => null) : null;
      const gen = await relay.generateIntent(float.address, depositAddress);
      const p = gen?.intent?.payload;
      const payload: Nep413Payload | null = gen?.intent?.standard === "nep413" && typeof p?.message === "string" && typeof p?.nonce === "string" && typeof p?.recipient === "string" ? { message: p.message, nonce: p.nonce, recipient: p.recipient, ...(p.callbackUrl !== undefined ? { callbackUrl: p.callbackUrl } : {}) } : null;
      if (!payload) throw refused("NEAR Intents sent nothing to approve. Nothing moved.");
      // The quote by its deposit address, as 1Click signed it (the relay only passes it on): never the app's word, nor the answer above.
      const quote = parseQuote(await relay.status(depositAddress, k.tag), depositAddress, this.d.quoteKey);
      const why = pocketIntentRefusal(payload, quote, depositAddress, float.address, this.now()) ?? this.notAsked(quote!, o);
      if (why) throw refused(why);
      k.move.sent = { tokenId: from, amount: quote!.amountIn };
      if (homeBefore) {
        k.homeTo = o.ask.recipient;
        const before = await homeBefore;
        if (before !== null) k.homeBefore = before.toString();
      }
      k.signed = signNep413(payload, await float.secret());
      await this.keep(k);
    } catch (e) {
      // Nothing was signed: the money never left the float, and the move gives its place back.
      await place.release();
      if (k.depositAddress) (k.move.status = "failed"), await this.keep(k);
      throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    // Signed: from here the money may move, so a move that 1Click may have is answered, never thrown. Only 1Click's own
    // "no" ends it here; with no answer at all it stays pending, and subwallet.float.move sends it again.
    try {
      await relay.submitIntent(k.signed);
      k.submitted = true;
      k.move.where = "in-flight";
    } catch (e) {
      if ((e as { refused?: boolean }).refused) {
        delete k.signed;
        k.move.status = "failed";
        await place.release();
        await this.keep(k);
        throw refused(`NEAR Intents didn't take it. See Activity for where your money is. ${String((e as Error).message).slice(0, 120)}`);
      }
    }
    await this.keep(k);
    return { ...k.move };
  }

  /**
   * The quote is the one asked for: the coin, its recipient, a confidential deposit from the float, enough, and a fair
   * price. Paid in a chain's coin: exactly the amount asked, its fairness then in `atLeast` (the USDC it must bring).
   */
  private notAsked(q: QuoteFacts, o: { usd: number; atLeast: bigint; from?: string; outUsd?: [number, number]; outUsdLine?: string; ask: { destinationAsset: string; amount: string; recipient: string; recipientType: string } }): string | null {
    const from = o.from ?? FLOAT_USDC;
    if (q.originAsset !== from || q.depositType !== "CONFIDENTIAL_INTENTS") return from === FLOAT_USDC ? "It isn't paid from your NEAR wallet's USDC." : "It isn't paid from your NEAR wallet's own coin.";
    if (from !== FLOAT_USDC && q.amountIn !== o.ask.amount) return "Its amount isn't the one asked for.";
    if (q.destinationAsset !== o.ask.destinationAsset) return "It doesn't deliver the coin asked for.";
    if (q.recipient !== o.ask.recipient || q.recipientType !== o.ask.recipientType) return "It doesn't pay the wallet ZeroFee picked.";
    if (!/^\d+$/.test(q.minAmountOut) || BigInt(q.minAmountOut) < o.atLeast) return "It promises less than asked for.";
    if (o.outUsd) {
      const out = Number(q.amountOutUsd);
      if (!Number.isFinite(out) || out < o.outUsd[0] || out > o.outUsd[1]) return o.outUsdLine ?? "Its price is too far from ZeroFee's own.";
    }
    if (from === FLOAT_USDC && (!/^\d+$/.test(q.amountIn) || Number(q.amountIn) / 1e6 > Math.max(most(o.usd), FLOAT_MIN_USD))) return "Its price is too far from ZeroFee's own.";
    return null;
  }

  /**
   * A NEAR coin bought or sold inside Spending (TN2, D74, privacy first under D70): Spending's confidential USDC → the
   * coin, or the coin → USDC, by a confidential 1Click quote the core asks for itself. Both legs stay in Spending's
   * confidential balance: the recipient and the refund are always the float itself, so nothing can leave it, and no
   * public wallet or the Safe ever takes part. The core prices the coin itself (1Click's own token list, never the app's
   * figure) and holds the quote to it: at least `atLeast` (the least the person's sheet showed) and at most SWAP_FAIR
   * under the coin's worth. `ask` is the core's decision on the person's yes (a Trade session within its caps, else the
   * sheet with these words); it hears the dollars and words only after the quote is read back and checked. `key` makes
   * asking again safe (the same key answers with the same move). Not a move: it takes none of the fee guard's 20 a day.
   */
  /**
   * A swap's price for Trade's Buy and Sell sheets (display only): a DRY confidential 1Click quote, the same shape swap()
   * asks for (from and into the float), with the coin's decimals, symbol and worth from 1Click's own list. Nothing is
   * kept, signed or moved; the tap's own quote is asked again by swap() and held to the core's own floor there.
   */
  async swapQuote(side: unknown, coin: unknown, amount: unknown): Promise<{ amountIn: string; amountOut: string; minAmountOut: string; decimals: number; symbol?: string; coinUsd: number; etaSeconds?: number }> {
    if (side !== "buy" && side !== "sell") throw invalid('side is "buy" or "sell"');
    if (typeof coin !== "string" || !SWAP_COIN.test(coin) || coin === FLOAT_USDC) throw invalid("coin is a NEAR coin's id: nep141:<its contract>");
    if (typeof amount !== "string" || !/^\d{1,40}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is smallest units, as text: USDC to buy with, or the coin to sell");
    const relay = this.d.relay;
    if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    const px = this.d.tokenPrice ? await this.d.tokenPrice(coin).catch(() => null) : null;
    if (!px || !(px.usd > 0) || !Number.isInteger(px.decimals)) throw new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
    if (!px.symbol || !SHEET_SYMBOL.test(px.symbol)) throw refused("NEAR Intents doesn't name this coin, so it wasn't traded. Nothing moved.");
    const float = await this.d.float();
    const [from, to] = side === "buy" ? [FLOAT_USDC, coin] : [coin, FLOAT_USDC];
    const raw = await relay.quote({
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: from, depositType: "CONFIDENTIAL_INTENTS",
      destinationAsset: to, amount, refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
      recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS", deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
    }).catch((e: unknown) => {
      throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    });
    const q = raw?.quote;
    const out = digits(q?.amountOut), min = digits(q?.minAmountOut) ?? (out ? ((BigInt(out) * 99n) / 100n).toString() : undefined);
    if (!out || !min || BigInt(out) === 0n) throw refused("NEAR Intents gave no price for this coin. Nothing moved.");
    const eta = q?.timeEstimate;
    return { amountIn: amount, amountOut: out, minAmountOut: min, decimals: px.decimals, ...(px.symbol ? { symbol: px.symbol } : {}), coinUsd: px.usd, ...(Number.isInteger(eta) && eta > 0 && eta <= 3600 ? { etaSeconds: eta as number } : {}) };
  }

  /** ST3: what a site's Add costs, in dollars (display only; site-add-cost.ts, loaded with its first ask). */
  async siteAddCost(p: Record<string, unknown>, wallets: () => Promise<SiteCostWallet[]>) {
    return (await import("./site-add-cost.ts")).siteAddCost({ ...this.d, now: this.now, wallets }, p);
  }

  /** What a Home Swap really brings, from 1Click's dry quotes of its legs (swap-cost.ts): nothing moves. */
  async swapCost(p: Record<string, unknown>) {
    return (await import("./swap-cost.ts")).swapCost({ ...this.d, now: this.now }, p);
  }

  swap(side: unknown, coin: unknown, amount: unknown, atLeast: unknown, key: unknown, ask: (a: SwapAsk) => Promise<boolean>): Promise<FloatMove | { declined: true }> {
    // review M1: one swap at a time, from the count of what Spending holds to its signed state kept (or its end), so two
    // swaps can never both spend the same cash
    return this.once(key, () => {
      const run = this.swapping.then(() => this.swapNow(side, coin, amount, atLeast, key, ask));
      this.swapping = run.catch(() => undefined);
      return run;
    });
  }
  private swapping: Promise<unknown> = Promise.resolve();

  private async swapNow(side: unknown, coin: unknown, amount: unknown, atLeast: unknown, key: unknown, ask: (a: SwapAsk) => Promise<boolean>): Promise<FloatMove | { declined: true }> {
    const fields = JSON.stringify(["swap", side, coin, amount, atLeast]);
    const had = await this.again(key, fields);
    if (had) return had.reason === "declined" ? { declined: true } : had;
    if (side !== "buy" && side !== "sell") throw invalid('side is "buy" or "sell"');
    if (typeof coin !== "string" || !SWAP_COIN.test(coin) || coin === FLOAT_USDC) throw invalid("coin is a NEAR coin's id: nep141:<its contract>");
    if (typeof amount !== "string" || !/^\d{1,40}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is smallest units, as text: USDC to buy with, or the coin to sell");
    if (typeof atLeast !== "string" || !/^\d{1,40}$/.test(atLeast)) throw invalid("atLeast is the least that may come back, smallest units, as text");
    const relay = this.d.relay;
    if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
    // the coin's worth, its decimals and its name: 1Click's own list, read by the core (no price, no swap)
    const px = this.d.tokenPrice ? await this.d.tokenPrice(coin).catch(() => null) : null;
    if (!px || !(px.usd > 0) || !Number.isFinite(px.usd) || !Number.isInteger(px.decimals) || px.decimals < 0 || px.decimals > 36) throw new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
    const units = BigInt(amount);
    const [from, to] = side === "buy" ? [FLOAT_USDC, coin] : [coin, FLOAT_USDC];
    const usd = side === "buy" ? Number(units) / 1e6 : (Number(units) / 10 ** px.decimals) * px.usd;
    // what Spending holds of what it pays with, by the core's own count: never a quote for money that isn't there
    const held = await this.counted(from);
    // a sale of ALL of a coin Spending holds goes at any size (its sheet says most of it goes on fees), so a coin is never
    // stuck under the floor; a buy or a part of a coin under it is refused, named
    const wholeSale = side === "sell" && units === held;
    if (usd < SWAP_MIN_USD && !wholeSale) throw new ProblemError(securityProblems.requestNotAllowed(`A trade under $${SWAP_MIN_USD} would mostly go on fees.`));
    if (held < units) throw refused(side === "buy" ? "Your NEAR wallet doesn't have that much cash." : "Your NEAR wallet doesn't hold that much of this coin.");
    const float = await this.d.float();
    // the core's own floor: the least back is never more than SWAP_FAIR under the worth at 1Click's listed price
    const fairLeast = Math.max(0, usd * SWAP_FAIR - SWAP_FEE_ROOM_USD);
    const scaled = side === "buy" ? Math.floor((fairLeast / px.usd) * 10 ** Math.min(px.decimals, 15)) : Math.floor(fairLeast * 1e6);
    if (!Number.isFinite(scaled)) throw new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
    const floor = side === "buy" ? BigInt(scaled) * 10n ** BigInt(Math.max(0, px.decimals - 15)) : BigInt(scaled);
    // at least 1 unit back: a quote paying 0 is refused even where the fair floor rounds to nothing (Low 1). Below about
    // $0.11 that is all the floor guards; the sale's own sheet (sheetOnly, 'Most of this goes on fees.') is the protection.
    const least = [BigInt(atLeast), floor, 1n].reduce((a, b) => (a > b ? a : b));
    const at = new Date(this.now()).toISOString();
    const k: Kept = {
      key: key as string, fields,
      move: { id: `fm-${key}`, kind: "swap", status: "pending", where: "float", sent: { tokenId: from, amount: amount as string }, expected: { tokenId: to, amount: least.toString() }, usd: Math.round(usd * 100) / 100, startedAtIso: at, updatedAtIso: at },
    };
    // review M2: the exact coin, named on the sheet by 1Click's own list; a coin it doesn't name plainly isn't traded
    if (!px.symbol || !SHEET_SYMBOL.test(px.symbol)) throw refused("NEAR Intents doesn't name this coin, so it wasn't traded. Nothing moved.");
    const name = px.symbol;
    let words: PlainWords;
    k.move.timing = { quotedMs: this.now() };
    try {
      const raw = await relay.quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: from, depositType: "CONFIDENTIAL_INTENTS",
        destinationAsset: to, amount, refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
        recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS", deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      });
      const depositAddress = raw?.quote?.depositAddress;
      if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay. Nothing moved.");
      k.depositAddress = depositAddress;
      if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
      await this.keep(k);
      // the transfer to approve and the quote as 1Click signed it, read together (never the app's word, nor the answer above)
      const [gen, signedQuote] = await Promise.all([relay.generateIntent(float.address, depositAddress), relay.status(depositAddress, k.tag)]);
      const p = gen?.intent?.payload;
      const payload: Nep413Payload | null = gen?.intent?.standard === "nep413" && typeof p?.message === "string" && typeof p?.nonce === "string" && typeof p?.recipient === "string" ? { message: p.message, nonce: p.nonce, recipient: p.recipient, ...(p.callbackUrl !== undefined ? { callbackUrl: p.callbackUrl } : {}) } : null;
      if (!payload) throw refused("NEAR Intents sent nothing to approve. Nothing moved.");
      const quote = parseQuote(signedQuote, depositAddress, this.d.quoteKey);
      const why = pocketIntentRefusal(payload, quote, depositAddress, float.address, this.now()) ?? this.notSwap(quote, { from, to, amount, float: float.address, least });
      if (why) throw refused(why);
      k.move.expected = { tokenId: to, amount: quote!.minAmountOut };
      if (quote!.amountOut && /^\d{1,40}$/.test(quote!.amountOut)) k.signedOut = quote!.amountOut;
      // S1's words (D71): dollars first, the exact coin once, what comes back and where
      const min = BigInt(quote!.minAmountOut);
      words = side === "buy"
        ? { title: `Buy $${usd.toFixed(2)} of ${name}`, lines: [`From your NEAR wallet. At least ${formatShort(min, px.decimals, "down")} ${name} lands in it.`], warnings: [], effect: [] }
        : { title: `Sell about $${usd.toFixed(2)} (${formatShort(units, px.decimals, "down")} ${name})`, lines: [`At least $${(Math.floor(Number(min) / 1e4) / 100).toFixed(2)} comes back to your NEAR wallet.`, ...(usd < SWAP_MIN_USD ? [SWAP_SMALL_SALE_LINE] : [])], warnings: [], effect: [] };
      // the person's yes (a session within its caps, else this sheet), before anything is signed
      if (!(await ask({ usd, words, ...(usd < SWAP_MIN_USD ? { sheetOnly: true } : {}) }))) {
        k.move.status = "failed";
        k.move.reason = "declined";
        await this.keep(k);
        return { declined: true };
      }
      k.signed = signNep413(payload, await float.secret());
      await this.keep(k);
    } catch (e) {
      // nothing was signed: the money never left Spending
      if (k.depositAddress) (k.move.status = "failed"), await this.keep(k);
      throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    // signed: from here 1Click may run it, so it is answered, never thrown; only 1Click's own "no" ends it here
    try {
      await relay.submitIntent(k.signed);
      k.submitted = true;
      k.move.where = "in-flight";
      if (k.move.timing) k.move.timing.submittedMs = this.now();
    } catch (e) {
      if ((e as { refused?: boolean }).refused) {
        // 1Click's own no: the signed intent is dropped and never sent again, so the money never left the balance
        delete k.signed;
        k.move.status = "failed";
        k.move.reason = SWAP_NOT_TAKEN;
        await this.keep(k);
        throw refused(`${SWAP_NOT_TAKEN} ${String((e as Error).message).slice(0, 120)}`);
      }
      // no answer: it may have run, so it is never "nothing moved" here (refresh follows it)
      k.move.reason = SWAP_UNANSWERED;
    }
    await this.keep(k);
    return { ...k.move };
  }

  /** What the float holds of one coin by the core's own count as it stands (no read through the relay: a swap's tap waits
   *  for nothing it doesn't need). A phone with no count yet starts it from what 1Click holds (seeded), as balance() does. */
  private async counted(tokenId: string): Promise<bigint> {
    await this.writing;
    if (!(await this.seeded())) return 0n;
    return this.counts(await this.book()).get(tokenId) ?? 0n;
  }

  /** A swap's quote is the one asked for: from Spending's confidential balance, exactly the amount, the coin asked for,
   *  into Spending itself, refunds to Spending, and at least the least. */
  private notSwap(q: QuoteFacts | null, o: { from: string; to: string; amount: string; float: string; least: bigint }): string | null {
    if (!q) return "NEAR Intents doesn't know this payment address.";
    if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > this.now())) return "This price has run out.";
    if (q.originAsset !== o.from || q.depositType !== "CONFIDENTIAL_INTENTS") return "It isn't paid from your NEAR wallet.";
    if (q.amountIn !== o.amount) return "Its amount isn't the one asked for.";
    if (q.swapType !== "EXACT_INPUT" || q.confidentiality !== "basic") return "It isn't the kind of price asked for.";
    if (Date.parse(q.deadline) > this.now() + SWAP_DEADLINE_MS) return "Its price lasts longer than asked.";
    if (q.destinationAsset !== o.to) return "It doesn't deliver the coin asked for.";
    if (q.recipient !== o.float || q.recipientType !== "CONFIDENTIAL_INTENTS") return "It doesn't pay into your NEAR wallet.";
    if (q.refundTo !== o.float || q.refundType !== "CONFIDENTIAL_INTENTS") return "A refund must come back to your NEAR wallet.";
    if (!/^\d{1,40}$/.test(q.minAmountOut) || BigInt(q.minAmountOut) < o.least) return "Its price is too far from ZeroFee's own.";
    return null;
  }

  /** Past the fee guard (20 moves, or its dollars, in 24 hours). D143 (approval-policy.ts): the NEAR wallet is a hot key,
   *  so no sheet asks for one more: its place is given back and the move is refused, named. Money going home to the Safe
   *  never comes here (its callers let it go). */
  private async refusePastGuard(why: "moves" | "dollars" | undefined, release: () => Promise<void>): Promise<never> {
    await release();
    throw refused(
      why === "dollars"
        ? `Over $${FLOAT_NO_SHEET_USD_PER_DAY.toLocaleString("en-US")} moved inside your NEAR wallet in 24 hours. Each move costs fees, so the next one waits a day. Nothing moved.`
        : `Your NEAR wallet made ${FLOAT_MOVES_PER_DAY} moves in 24 hours. Each costs fees, so the next one waits a day. Nothing moved.`,
    );
  }

  /** Where one move's money is now, from 1Click's status through the relay (and a signed transfer sent again if a restart cut it off). */
  async move(id: unknown): Promise<FloatMove> {
    await this.writing;
    const k = (await this.kept()).find((x) => x.move.id === id && !x.add);
    if (!k) throw new ProblemError(securityProblems.floatMoveUnknown());
    await this.refresh(k);
    // As kept: a refresh read before a newer write is let go (amend), so its own copy may be the older one.
    await this.writing;
    const now = (await this.kept()).find((x) => x.move.id === id && !x.add) ?? k;
    await this.goHome(now);
    await this.writing;
    const m = withDeposit((await this.kept()).find((x) => x.move.id === id && !x.add) ?? now);
    // a swap that landed says how much of its coin Spending holds now, by the core's own count (counted: never reset to a
    // lagging read of 1Click's), so Trade's position is exactly what Spending holds (review M2)
    if (m.kind === "swap" && m.status === "done") {
      const coin = m.sent.tokenId === FLOAT_USDC ? m.expected.tokenId : m.sent.tokenId;
      return { ...m, heldAfter: (await this.counted(coin)).toString() } as FloatMove;
    }
    return m;
  }

  /**
   * Social Trading's Move back, its second leg: a move in from a site's wallet that settled in Spending goes on home to
   * the Safe, exactly what arrived, once (its own key, `<key>-home`: asking again answers with the same move). Started by
   * the core itself after the person's own sheet for the whole Move back; never for any other move in.
   */
  private async goHome(k: Kept): Promise<void> {
    if (!k.thenHome || k.move.kind !== "in" || k.move.status !== "done" || k.move.homeId) return;
    const arrived = k.settled?.amountOut ?? k.move.expected.amount;
    if (!/^\d{1,30}$/.test(arrived) || BigInt(arrived) === 0n) return;
    // D137: no gap, it goes the moment leg 1 settled
    const settledAt = Date.parse(k.move.updatedAtIso);
    if (this.now() < settledAt + homeGapMs(k.key)) return;
    const homeKey = `${k.key}-home`.slice(0, 64);
    this.approvedHome.add(homeKey);
    // a refusal is kept on the move back (its row says it, and where the money is); one that may pass later (the partner
    // or the nodes busy) is only tried again on the next read, as before
    const home = await this.home(arrived, homeKey).catch((e: unknown) => {
      const p = (e as ProblemError)?.problem;
      return p && FOR_GOOD.has(p.code) ? { stopped: String(p.whatHappened).slice(0, 200) } : null;
    });
    if (home && "stopped" in home) {
      if (k.move.homeStopped !== home.stopped) await this.amend(k.move.id, (now) => (now ? ((now.move.homeStopped = home.stopped), now) : null));
      return;
    }
    if (!home || "declined" in home) return;
    await this.amend(k.move.id, (now) => (now ? ((now.move.homeId = home.id), delete now.move.homeStopped, now) : null));
  }

  /** Social Trading's Move backs (moves in from a site's own wallet), newest first, each with its home leg as it stands. */
  async moveBacks(): Promise<{ back: FloatMove; home?: FloatMove }[]> {
    await this.writing;
    const kept = await this.kept();
    const backs = kept.filter((k) => k.thenHome && !k.add);
    // open ones are asked about (and a settled one goes on home) before they are listed
    for (const k of backs.filter((x) => x.move.status === "pending" || (x.move.status === "done" && !x.move.homeId))) await this.move(k.move.id).catch(() => undefined);
    const homes = kept.filter((k) => k.move.kind === "home");
    for (const k of homes.filter((x) => x.move.status === "pending" && backs.some((b) => b.move.homeId === x.move.id))) await this.refresh(k).catch(() => undefined);
    await this.writing;
    const now = await this.kept();
    return now
      .filter((k) => k.thenHome && !k.add)
      .sort((a, b) => Date.parse(b.move.startedAtIso) - Date.parse(a.move.startedAtIso))
      .map((k) => {
        const h = k.move.homeId ? now.find((x) => x.move.id === k.move.homeId) : undefined;
        return { back: { ...k.move }, ...(h ? { home: { ...h.move } } : {}) };
      });
  }

  /** A move in no node took is asked about (unpaid) only past our price's 10 minutes and UNPAID_GRACE_MS; on Solana, only
   *  while the nodes' history still reaches its start (UNPAID_SOL_MS). */
  private unpaidDue(k: Kept): boolean {
    const start = Date.parse(k.move.startedAtIso);
    if (k.move.chain === "sol" && k.tried?.blockhash !== undefined) return start + UNPAID_SOL_SIGNED_MS <= this.now() && this.now() - start <= UNPAID_SOL_MS;
    if (!(start + QUOTE_MINUTES * 60_000 + UNPAID_GRACE_MS <= this.now())) return false;
    return k.move.chain !== "sol" || this.now() - start <= UNPAID_SOL_MS;
  }

  /** A move out to a chain's wallet: does that chain show 1Click's landing (its destination transaction, read on two
   *  nodes)? One with no landing named, a chain this core can't read, or nodes that can't say for LANDED_WAIT_MS after
   *  1Click's SUCCESS: 1Click's word, as before (never on its way for ever). */
  private async landedThere(k: Kept): Promise<boolean> {
    if (k.move.kind === "home") return this.landedHome(k);
    const end = k.move.proof?.end;
    if (k.move.kind !== "out" || !k.move.chain || !this.d.landed || !end || end.chain !== k.move.chain) return true;
    if ((await this.d.landed(k.move.chain, end.hash).catch(() => null)) === "ok") return true;
    k.successAt ??= this.now();
    return this.now() - k.successAt >= LANDED_WAIT_MS;
  }

  /** S21 (rule 11): a move home ticks done only once intents.near shows the Safe holding at least its least more of the
   *  coin than before it was sent. A read that fails or shows the old figure keeps it on its way. Past LANDED_WAIT_MS
   *  after 1Click's SUCCESS with no read showing it (the copy review's ruling, 5 Nov), it is `unshown`: still on its way, saying
   *  HOME_UNREAD, never done on 1Click's word; it is read again on every refresh, and the first read that shows it ends it
   *  done. A core with no NEAR reads: 1Click's word, as before. */
  private async landedHome(k: Kept): Promise<boolean> {
    if (!this.d.safeHeld) return true;
    if (k.homeTo && k.homeBefore !== undefined) {
      const now = await this.d.safeHeld(k.homeTo, k.move.expected.tokenId).catch(() => null);
      if (now !== null && now - BigInt(k.homeBefore) >= BigInt(k.move.expected.amount)) {
        if (k.move.unshown) (delete k.move.unshown, delete k.move.reason);
        return true;
      }
    }
    k.successAt ??= this.now();
    if (this.now() - k.successAt >= LANDED_WAIT_MS) Object.assign(k.move, { unshown: true, reason: HOME_UNREAD });
    return false;
  }

  /** One open move or Add, from 1Click's status; what settled is kept once it ends. True when 1Click's word was read. */
  private async refresh(k: Kept): Promise<boolean> {
    if (k.move.status !== "pending" || !k.depositAddress || !this.d.relay) return true;
    const relay = this.d.relay;
    // The move as this refresh read it: its write lands only if nothing was kept since (amend, below).
    const seen = JSON.stringify(k);
    const raw = (await relay.status(k.depositAddress, k.tag).catch(() => null)) as { status?: unknown } | null;
    const status = typeof raw?.status === "string" ? raw.status : "";
    const quote = parseQuote(raw, k.depositAddress, this.d.quoteKey);
    if (k.signed && !k.submitted && status === "PENDING_DEPOSIT" && quote && Date.parse(quote.deadline) > this.now()) {
      await relay.submitIntent(k.signed).then(() => ((k.submitted = true), (k.move.where = "in-flight")), () => undefined);
    }
    if (k.move.reason === SWAP_UNANSWERED && (k.submitted || ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"].includes(status))) delete k.move.reason;
    const arrived = k.move.kind === "out" ? "chain" : k.move.kind === "home" ? "main" : "float";
    // its proof, from 1Click's own record of this deposit and the core's own transfer: each end's chain, or the private
    // balance (the NEAR wallet's confidential side has no public transaction)
    if (raw) {
      const chainOf = (side: "float" | "chain" | "main") => (side === "chain" ? (k.outside ? k.outside.chain : k.move.chain ?? "") : side === "main" ? "near" : "private");
      const from = k.outside ? "chain" : k.add ? "main" : k.move.kind === "in" ? "chain" : "float";
      const proof = moveProof(raw, { from: chainOf(from), to: chainOf(arrived), deposit: k.depositAddress, ...(k.paidTx ? { paid: k.paidTx } : {}), ...(k.move.proof ? { was: k.move.proof } : {}) });
      if (JSON.stringify(proof) !== JSON.stringify(k.move.proof ?? {})) k.move.proof = proof;
    }
    // an Add from another chain starts on that chain, at the payer's wallet
    const start = k.outside ? "chain" : k.add ? "main" : k.move.kind === "in" ? "chain" : "float";
    // lap FAIL 3 (QA, 5 Nov: "Done in 51 s" 1 m 27 s before the SOL landed): a move out is done once its chain
    // shows the landing, never on 1Click's word alone; until then it is on its way
    if (status === "SUCCESS" && !(await this.landedThere(k))) k.move.where = "in-flight";
    else if (status === "SUCCESS") Object.assign(k.move, { status: "done", where: arrived });
    else if (status === "REFUNDED") Object.assign(k.move, { status: "refunded", where: "float" });
    else if (status === "FAILED") Object.assign(k.move, { status: "failed", where: k.submitted ? "float" : start });
    // A swap whose submit got no answer, past its deadline (it can't run any more) and still waiting by 1Click's word:
    // failed only once 1Click's own balance was read and still holds what it would have spent (review QA L2);
    // a read that fails, or shows less, keeps it open
    else if (status === "PENDING_DEPOSIT" && quote && k.move.kind === "swap" && k.signed && !k.submitted && Date.parse(quote.deadline) <= this.now()) {
      const held = this.d.confidentialBalances ? await this.d.confidentialBalances().catch(() => null) : null;
      const has = held?.find((t) => t.tokenId === k.move.sent.tokenId)?.amount;
      if (has && /^\d{1,40}$/.test(has) && BigInt(has) >= BigInt(k.move.sent.amount)) Object.assign(k.move, { status: "failed", where: "float", reason: SWAP_NOT_TAKEN });
    }
    // Past the quote's deadline and never paid: it failed, the money where it started. Paid (the core sent the transfer or
    // the intent): followed until 1Click says where the money went, a late deposit's refund included (audit AUD-CORE-3).
    else if (status === "PENDING_DEPOSIT" && quote && Date.parse(quote.deadline) + (k.add ? ADD_GRACE_MS : 0) <= this.now() && !k.submitted) Object.assign(k.move, { status: "failed", where: start });
    // A move in whose transfer no node took, past our own price's 10 minutes and a grace: ended only when it provably
    // never landed and never will (subwallets.ts unpaidIn), the money still in the wallet, so the planner asks again.
    // Anything the nodes can't say keeps it open.
    else if (status === "PENDING_DEPOSIT" && quote && k.move.kind === "in" && !k.add && !k.submitted && k.move.chain && this.d.unpaid && !this.paying.has(k.move.id) && this.unpaidDue(k) && (await this.d.unpaid(k.move.chain, refOf(k.move), k.depositAddress, k.tried).catch(() => false))) {
      Object.assign(k.move, { status: "failed", where: "chain", reason: stillThere(k.move.chain) });
    }
    // Submitted and still waiting well past its deadline (audit RM-2: never for ever). A move out or home is the float's
    // own intent, signed to expire with its price: after the deadline it can't run, so it failed and the money is in the
    // float. A move in is the core's own transfer: it failed, the money in the wallet, only when two nodes show it
    // failed or don't have it at all; landed (1Click refunds a late deposit) or unknown, it stays open.
    else if (status === "PENDING_DEPOSIT" && quote && k.submitted && !k.add && k.move.kind !== "in" && Date.parse(quote.deadline) + OUT_GRACE_MS <= this.now()) Object.assign(k.move, { status: "failed", where: "float" });
    else if (status === "PENDING_DEPOSIT" && quote && k.submitted && k.move.kind === "in" && k.move.chain && k.paidTx && this.d.landed && Date.parse(quote.deadline) + IN_GRACE_MS <= this.now()) {
      const there = await this.d.landed(k.move.chain, k.paidTx).catch(() => null);
      if (there === "none" || there === "failed") Object.assign(k.move, { status: "failed", where: "chain" });
    }
    // D119 landing 3 (review L4): a Take out of Perps that Hyperliquid sent (its transfers are final in seconds) but
    // 1Click still hasn't seen an hour past its price's end: ended, never waiting for ever. If the money did leave Perps,
    // 1Click returns a late deposit to Trading (the quote's refund), and Trading's count is held to 1Click's own.
    else if (status === "PENDING_DEPOSIT" && quote && k.submitted && k.move.kind === "in" && k.move.perps && Date.parse(quote.deadline) + OUT_GRACE_MS <= this.now()) {
      Object.assign(k.move, { status: "failed", where: "chain", reason: "NEAR Intents didn't see it. If it left Perps, NEAR Intents returns it to your NEAR wallet." });
    }
    else if (["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"].includes(status)) k.move.where = "in-flight";
    // a swap's quote → settled, as the core first read it ended (FloatMove.timing)
    if (k.move.timing && k.move.timing.settledMs === undefined && k.move.status !== "pending") k.move.timing.settledMs = this.now();
    // an Add from another chain: when this phone first saw its money and saw it in the float, and what 1Click says was
    // deposited while it is on its way (display only: what counts is its settled figure, once it ended)
    // under the address's least (1Click's INCOMPLETE_DEPOSIT), an Add's or set-up's: said so until 1Click's word changes
    if (k.outside && status === "INCOMPLETE_DEPOSIT") k.outside.short = true;
    else if (k.outside && status) delete k.outside.short; // a read that failed changes nothing
    if (k.outside && k.outside.to !== "setup") {
      const o = k.outside, d = (raw as { swapDetails?: { amountIn?: unknown; depositedAmount?: unknown } } | null)?.swapDetails;
      if (o.seenMs === undefined && ["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT", "SUCCESS", "REFUNDED"].includes(status)) o.seenMs = this.now();
      if (o.privateMs === undefined && status === "SUCCESS") o.privateMs = this.now();
      const inUnits = digits(d?.amountIn) ?? digits(d?.depositedAmount);
      if (k.move.status === "pending" && inUnits && inUnits !== "0") o.inUnits = inUnits;
    }
    // a Take out of Perps that ended without bringing anything gives its place in the day's moves back (review L4)
    const ended = k.move.status as FloatMove["status"];
    if (k.move.perps && k.move.kind === "in" && (ended === "failed" || ended === "refunded") && k.place) {
      await this.d.guard.releaseId(k.place).catch(() => undefined);
      delete k.place;
    }
    if (k.move.status !== "pending") delete k.signed;
    if (status === "SUCCESS" || status === "REFUNDED") {
      const d = (raw as { swapDetails?: { amountOut?: unknown; refundedAmount?: unknown; amountIn?: unknown } } | null)?.swapDetails;
      k.settled = { amountOut: digits(d?.amountOut), refunded: digits(d?.refundedAmount), ...(k.outside && digits(d?.amountIn) ? { amountIn: digits(d?.amountIn) } : {}) };
      k.move.settled = Object.fromEntries(Object.entries({ amountOut: k.settled.amountOut, refunded: k.settled.refunded }).filter(([, v]) => v !== undefined));
      // a swap's move says what the core counted in (swapGot: between the signed least and amount out), never the
      // relay's unsigned figure: Trade books the same coins the core holds (oversight review, Medium)
      if (k.move.kind === "swap" && status === "SUCCESS") k.move.settled = { ...k.move.settled, amountOut: swapGot(k) };
    }
    // Written only over the move as it was read: a transfer kept meanwhile (its blockhash or nonce, its id) is never
    // written over by this older copy, nor is the move ended unpaid on a read that didn't have it. The next refresh asks again.
    await this.amend(k.move.id, (now) => (JSON.stringify(now) === seen ? k : null));
    return raw !== null;
  }
}
