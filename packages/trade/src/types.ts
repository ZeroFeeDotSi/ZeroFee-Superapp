// The shapes every chain's engine hands the trade service (service.ts), and the market data the engines and screens read.
// One engine per chain and trading wallet: Solana (sol/), BNB Chain and Robinhood Chain (evm/).

/** "near": NEAR coins (TN1, 2 Nov): their market from GeckoTerminal's `near` network (Rhea and NEAR Intents pools); a
 *  buy or a sale happens inside Spending's private balance, never from a chain wallet of its own (near/engine.ts). */
export type ChainId = "sol" | "bsc" | "hood" | "near";
export type Side = "buy" | "sell";
/** A buy is dollars, raw native units or everything; a sell is a share of what is held, raw coins or everything. */
export type Amount = { usd: number } | { max: true } | { fraction: number } | { raw: string };

/** Market data for a coin. Display, and the side-pool and far-price guards; never the amount a trade moves. */
export interface CoinMeta {
  symbol?: string; name?: string; decimals?: number; priceUsd?: number; liquidityUsd?: number;
  /** The coin's pools with their liquidity, from market data. `dex` is the market data's dex id. */
  pools?: { address: string; dex: string; liquidityUsd?: number }[];
  /** How far the price moved in the last minute (max-min over mid, bps). Lifts the slippage floor. */
  moveBps60s?: number;
  /** The day's price change in percent (signed). */
  change24hPct?: number;
}

export interface Quote {
  side: Side; chain: ChainId; coin: string; symbol: string; decimals: number;
  /** buy: native units spent; sell: coins sold (raw). */
  payRaw: string; payUsd: number;
  /** buy: coins out; sell: native units out (raw); and the least the transaction accepts. */
  getRaw: string; getUsd: number; getMinRaw: string;
  /** Network fee (plus a new account's rent on Solana), in native units. */
  feeRaw: string; feeUsd: number;
  /** Where it trades, in words: "pump.fun", "PumpSwap", "Uniswap v4", "four.meme", "Jupiter", "KyberSwap"… */
  route: string; slippageBps: number; priceImpactPct?: number;
  /** Solana: rent of a token account this trade opens (in feeUsd; it comes back when the account closes). */
  rentUsd?: number;
  /** Solana: a full sell closes the coin account; this much rent comes back (not in feeUsd). */
  rentBackUsd?: number; closesAccount?: boolean;
  /** A buy of a coin whose symbol copies a famous one on another contract ("USDT is not the real USDT"): said on the sheet (audit T-9). */
  copycat?: string;
  /** NEAR: a sale of all of a coin worth under $1 (the core lets only that one go under its floor): its sheet says
   *  "Most of this goes on fees." */
  mostlyFees?: true;
  expiresAt: number;
}

/** One transaction to sign: the wallet's own unsigned, chain-native transaction (Solana v0 / EIP-1559), base64. */
export interface TxStep {
  id: "approve" | "swap";
  tx: string;
  /** Solana: the block height after which the transaction can never land. */
  lastValidBlockHeight?: number;
  /** EVM: the nonce in the transaction. */
  nonce?: number;
}

export interface Prepared {
  key: string; at: number; quote: Quote;
  /** In order. The swap is last; an EVM sell may need an approve first. Empty while `provisional`: read it after ready(). */
  steps: TxStep[];
  /** The quote is shown while the route is still being built (an aggregator under load); ready() resolves once it is. */
  provisional?: boolean;
  /** Resolves once the steps may be signed and sent (the route is proven by simulation); throws the chain's refusal. */
  ready(): Promise<void>;
}

/** What really happened, read from the chain after the swap confirmed. */
export interface Fill {
  txHash: string;
  /** The amount isn't the chain's balance (it couldn't be read): what arrived is "about" this. */
  estimated?: boolean;
  /** buy: coins received; sell: native received (raw). */
  got: string;
  /** buy: native spent; sell: coins sent (raw). */
  spent: string;
  /** Network fee paid, native units. */
  fee: string;
  /** The wallet's balances right after, when the chain says them. */
  nativeAfter?: string; coinAfter?: string;
  /** A sale's token-account rent that came back (the accounts it closed), native units: the wallet's own deposit, never
   *  the sale's proceeds (`got` leaves it out). */
  rentBack?: string;
  /** A buy's rent for the wallet's token accounts it opened, native units: a deposit that comes back when the coin is all
   *  sold (`spent` leaves it out). */
  rentPaid?: string;
  /** A buy's one-time pump.fun account for the wallet (its user_volume_accumulator, opened by its first buy there), native
   *  units (`spent` leaves it out). */
  setupPaid?: string;
}

/** "expired": two nodes agree it never landed and now never can (Solana: past its last valid block height). */
export type TxStatus = "pending" | "confirmed" | "failed" | "expired" | "unknown";

/** A coin the wallet holds, as the chain says. */
export interface Holding { coin: string; raw: string; decimals: number }

export interface ChainEngine {
  readonly chain: ChainId;
  /** The trading wallet's address on this chain. */
  readonly owner: string;
  /** `othersHeld`: how many other coins (above dust) this wallet holds on the chain; an EVM buy keeps each one's sale gas
   *  as well as its own (fix review RT-4), so none of them is left unsellable. */
  prepare(side: Side, coin: string, amount: Amount, opts?: { attempt?: number; othersHeld?: number }): Promise<Prepared>;
  /** Broadcasts a signed transaction (base64) to two nodes. Returns its hash. */
  send(signedTx: string): Promise<string>;
  /**
   * The signed transaction's own hash, known before any node answers (Solana: its first signature; EVM: keccak of the raw
   * bytes), so a send that errors can still be followed. Throws when it isn't signed for this chain (then it can't land).
   */
  txHash(signedTx: string): string;
  /** "confirmed", "failed" or "expired" only when two nodes agree; otherwise "pending" or "unknown". `step` says when it expires. */
  status(txHash: string, step?: TxStep): Promise<TxStatus>;
  /** Speed (3 Nov): "landed" as soon as ONE node has it confirmed (Solana) or mined with status 1 (EVM). The screen says
   *  done on it; status() (two nodes) still follows it in the background and has the last word. Optional: an engine
   *  without it is followed by status() alone, as before. */
  landed?(txHash: string, step?: TxStep): Promise<"landed" | "pending">;
  /** Solana: the slot this wallet's last trade landed in, as the landed check read it, while it is recent (undefined: none).
   *  The core's test run of the next trade is on state at or after it (subwallet.signTx / preflight `minSlot`). */
  freshSlot?(): number | undefined;
  fill(p: Prepared, txHash: string): Promise<Fill | undefined>;
  /** Native balance (raw) and the coins held, of `coins` (the ones the app knows about) or every one the engine has seen. */
  holdings(coins?: string[]): Promise<{ native: string; coins: Holding[] }>;
  /** Every coin the wallet holds on the chain (read from the chain, not from what the app has traded), above zero. Solana only. */
  tokenBalances?(): Promise<Holding[]>;
  /** A plain transfer of the native coin out of the trading wallet (back to the main balance), "all" leaving only the fee. */
  transfer?(to: string, raw: string | "all"): Promise<Prepared>;
  /** The coin's pool changed (a live update, a landed trade): the next quote reads it again. */
  poolChanged(coin: string): void;
  /**
   * EVM: the approvals a sale that failed or expired may have left on chain (Permit2's for the router, the coin's to
   * Permit2 or to KyberSwap's router), each set back to 0 (audit T-12). Undefined: none is left, or the gas for it isn't there.
   */
  revokeLeft?(coin: string): Promise<Prepared | undefined>;
  /**
   * NEAR coins (TN2): no transaction for the app to sign. The core buys or sells inside Spending's confidential balance
   * (its own sheet, or the Trade session within its caps), and this follows the move to its end. `key` makes asking again
   * safe; `onMove` hears the core's move id before it is followed (a trade that may still land is looked at again by it).
   * A "no" is { declined }; anything that stops it is a ProblemError.
   */
  /** `timing`: the engine's own signed, sent and landed (a NEAR coin's Rhea trade: landed on the first node);
   *  `verify`: another node's answer, true to book it, false if it didn't happen, undefined if it can't tell yet. */
  settle?(p: Prepared, key: string, onMove?: (id: string, sessionEndsAtIso?: string) => void, session?: { perTxUsd: number; totalUsd: number; minutes: number }): Promise<{ fill: Fill; timing?: { signedAt: number; sentAt: number; landedAt: number }; verify?: Promise<boolean | undefined> } | { declined: true }>;
  /** NEAR coins: look again at a move the core is still finishing (after a restart, or a trade that outran the wait). */
  followMove?(id: string, symbol: string): Promise<{ fill: Fill } | "pending" | { problem: import("@zerofee/core/problem").Problem }>;
}
