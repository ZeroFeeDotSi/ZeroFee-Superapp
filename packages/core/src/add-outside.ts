// Home's Add and Request (D123, D127, D128; the Home plan §1.2, engine rows E1 and E2): the shapes and switches both
// sides read, with no imports, so Wallet's sheet reads them without the core (as float-floors.ts).
//
// The money path (float-add.ts addOutside, the core's own): the person (or whoever pays them) sends a chain's own coin
// to a ONE-TIME 1Click address on that chain. 1Click delivers the same coin into the float's confidential balance
// (Trading's cash on NEAR Intents, the NEAR wallet on Home); a refund comes back there too, never to a public address.
// Once 1Click says it landed, the core's saved job forwards it on: to the chain's own wallet (E1, the float's move out)
// or to the Safe (E2, the float's move home, as USDC). The address is never given out twice.

/** The chains Add and Request can take a coin from. */
export type AddChain = "sol" | "hood" | "near" | "bsc";
/** Where the money goes once it has landed in the float: the chain's own wallet (E1), or the Safe (E2). */
export type AddTo = "wallet" | "safe";

/**
 * Which chains' Add is open. SOL and ETH (RH): open. NEAR: built, switched off (1Click lists only wNEAR, and its docs
 * don't say native NEAR sent to a deposit address is credited: the $1 test decides). BNB: built, shut with its
 * chain (float-moves.ts CHAIN_COIN.bsc.open; its coin is a nep245 HOT token, and the relay passes nep141 only).
 */
export const ADD_OPEN: Readonly<Record<AddChain, boolean>> = { sol: true, hood: true, near: false, bsc: false };

/** A coin amount a person reads or sends has at most this many decimals: the core sizes every address's
 *  amount to it, and the sheet says the least taken rounded UP to it, so sending exactly the figure shown is taken. */
export const COIN_SHOWN_DECIMALS = 4;
/** How long the sheet shows one address: a day. 1Click signs a later deadline; money sent after the day still lands. */
export const ADD_SHOWN_MS = 24 * 3_600_000;
/** An Add's address is sized for this many dollars of the coin: 1Click takes any deposit at or above about 99 % of it
 *  (FLEX_INPUT), so the forward on is never under the float's $2 floor. */
export const ADD_LEAST_USD = 3;
/** A Request asks for at most this much: the relay takes one real quote up to $10,000 by 1Click's own dollars (D132,
 *  apps/quotes relay.mjs POCKET_USD), and the core sizes by its own price, so 5 % is room for the two prices to differ. */
export const REQUEST_MOST_USD = 9_500;

/** The core's refusal of a key whose address money already reached, or that ran out (D127: works once; review H1): the
 *  sheet and the card ask again with a new key, at once. */
export const ADD_USED = "security.add.used";

/** The core's answer to subwallet.add.quote: one one-time address, checked against 1Click's signed quote. */
export interface AddAddress {
  /** The key the sheet asked with (the same key again gives this same address). */
  key: string;
  chain: AddChain;
  to: AddTo;
  /** 1Click's one-time address on the coin's own chain. */
  depositAddress: string;
  /** The coin's id in 1Click's list, its symbol ("SOL", "ETH", "NEAR", "BNB") and decimals. */
  tokenId: string;
  symbol: string;
  decimals: number;
  /** The quote's amount (smallest units): a Request's ask; an Add's sizing. */
  amountIn: string;
  /** The least it takes (smallest units): under it, the money comes back to the NEAR wallet. */
  minAmountIn: string;
  /** When the sheet stops showing it: the sooner of a day after it was asked and 1Click's signed deadline. */
  untilIso: string;
  /** 1Click's own signed deadline (days later): money sent up to then still lands. Never shown as the address's end. */
  deadlineIso?: string;
  /** 1Click's own estimate of the time, in seconds (display only). */
  etaSeconds?: number;
  /** A Request's dollars, as asked. */
  usd?: string;
  /** The web demo only (MockBridge): a made-up address that no wallet on any chain accepts. Never set by the core. */
  sample?: true;
}

/** Where one Add stands (subwallet.add.onWay), for Home's line: from 1Click's word and the core's own forward. */
/** "short": less than the address's least arrived (1Click's INCOMPLETE_DEPOSIT); 1Click sends it back to the NEAR wallet
 *  at `backAtMs` unless the rest comes first. */
export type AddStage = "arriving" | "forwarding" | "landed" | "refunded" | "held" | "short";
export interface AddOnWayFacts {
  /** The address's last 6 characters (never the address). */
  key: string;
  chain: AddChain;
  to: AddTo;
  tokenId: string;
  stage: AddStage;
  /** What arrived, in the coin's smallest units, once 1Click says (display only). */
  amount?: string;
  /** About that much in dollars, at the core's own price (display only). */
  usd?: string;
  etaSeconds?: number;
  /** "held": why it stays in the NEAR wallet, in words. */
  reason?: string;
  /** "short": the least the address takes, in the coin's smallest units and in dollars at the core's price (display only),
   *  and when 1Click sends what arrived back to the NEAR wallet (its signed deadline, ms since the epoch). */
  needAmount?: string;
  needUsd?: string;
  backAtMs?: number;
  /** When each step was reached, as this phone first saw it (ms since the epoch): the money reached the one-time address
   *  (`received`: the phone's own push on the address, or 1Click's first word of it), it was in the NEAR wallet's private
   *  balance (`private`), and it was in the wallet or the Safe (`landed`). Display only. */
  at?: { received?: number; private?: number; landed?: number };
  /** The dollars of it in neither the NEAR wallet's count nor the wallet yet (display only, at the core's price): what
   *  reached the one-time address before 1Click put it in the NEAR wallet, or a leg out signed and not landed. Home's
   *  total adds it, so the money counts from "Received" on, and never twice (D140). */
  onWayUsd?: string;
  /** Its proof (Activity, 6ca67960): the deposit's own transaction on its chain, the transaction that landed it, and the
   *  1Click swap's id (the one-time address, as the NEAR Intents explorer searches it). The middle step is private. */
  proof?: { received?: AddTx; landed?: AddTx; swap?: string };
}
/** One public transaction (core tx-proof.ts TxProof): its chain, its id, its explorer page where there is one. */
export interface AddTx { chain: string; hash: string; url?: string }
/** One open Add's one-time address the phone may watch for money (subwallet.add.watch: the Wallet app only). */
export interface AddWatch { chain: AddChain; address: string }

/**
 * Money that came in, kept for good (subwallet.received): Activity's lasting "Received" row, the Statement's and
 * AgentZero's "how much came in". `add`: an Add (D127) once it ended, joined with its forward (what came in, where it
 * landed, what the swap service kept). `open`: the NEAR that opened the account. Never an address.
 */
export interface Received {
  /** The core's own id ("add:<its move id>", "open:<account>"). */
  id: string;
  kind: "add" | "open";
  /** The network it came from. */
  chain: AddChain;
  /** Where it landed: the chain's own wallet, the Safe, or the NEAR wallet (a forward held, or 1Click's refund there). */
  into: AddChain | "safe";
  tokenId: string;
  decimals: number;
  /** What came in, in the coin's smallest units. */
  amount: string;
  /** Its dollars when it landed, at the core's own price, fixed then. */
  usd?: string;
  /** What 1Click kept on the way (its two swaps), in dollars at the same price. */
  feeUsd?: string;
  /** `open` only: what opening the account keeps of `amount`, in the same units (its storage, the fee reserve and the
   *  opening's fees), so the row adds up to the Safe right after (finding 10). */
  keptAmount?: string;
  /** When it landed. */
  atIso: string;
}
/** At most this many are kept (the newest). */
export const RECEIVED_KEPT = 200;
