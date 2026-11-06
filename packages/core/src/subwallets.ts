// Separate wallets (S1.6b): small wallets for Trade, Browser and Extension, funded from the main balance, so the worst
// case is losing that small balance, never the main one. The core holds their keys; apps only ever get signatures.
//
// Solana: every signature has this wallet the only signer and fee payer, no durable nonce, a blockhash a node still
// accepts (the first that says valid; one behind gets 400 ms for the other's yes: solana.ts firstValid), a simulation on
// two nodes for what leaves the wallet, and the decoder's words on the approval sheet.
// EVM (BNB Chain and Robinhood Chain for Trade; Ethereum, Base, Gnosis and Arbitrum for the Browser wallet, D29): an
// EIP-1559 transaction for this wallet's own chain only, run on two nodes together with this wallet's signed
// transactions that haven't landed yet; the most that can leave is its value plus the highest fee it allows.
// The Browser wallet signs what any site asks, so it always asks, with no fast sessions; the card's wallet on Gnosis is
// its own key (Pay's kind), never the Browser wallet's, so no site the Browser wallet is connected to can sign for it.
// A fast-trade session (Face ID once) skips the sheet only for trades on the allowlist (solana.ts, evm.ts), within its
// caps, with two nodes agreeing. Anything else still asks.
// Trade's float (float.ts) is a NEAR wallet like the private pocket, one per account: the balance its trading wallets
// are filled from. It signs no transactions and has no fast sessions.
import { OUTSIDE_WORDS, PRIVATE_LANDS, landsOn } from "./send-words.ts";
import type { Chain } from "./chain.ts";
import { NEAR_CLOSED, NEAR_COIN_WALLET, NEAR_GATE } from "./near-gate.ts";
import type { NearSignedAnswer } from "./near-coin.ts";

export { NEAR_COIN_WALLET };
import { originLock } from "./origin-lock.ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { BROWSER_EVM, checksumOk, EVM_CHAIN_ID, FEE_CAPS, EVM_CHAIN_NAME, EVM_EXPLORER, KNOWN_COINS, NATIVE, evmAddress, evmPlain, evmSessionRefusal, evmSignable, isTradeEvm, referenceRefusal, REFERENCE_MIN_POOL_USD, signEvmTx, unsignedEvmTx, V3_POOLS } from "./evm.ts";
import { evmCoinsRefusal, outcomeRefusal } from "./evm-checks.ts";
import type { EvmCall, EvmChain, EvmChainName, EvmSimulated, EvmWalletChain, HookFacts } from "./evm.ts";
import { decodeEvmTx } from "./evm/decode.ts";
import { parseTx, toHex } from "./evm/wire.ts";
import { FLOAT_MIN_USD, FLOAT_MOVES_PER_DAY, FloatGuard } from "./float.ts";
import { ADD_HINT_TXS, CHAIN_COIN, FloatMoves, SITE_SLOT, type FloatMove, type FloatRelay, type PayTry, type TradeChain, type WalletRef } from "./float-moves.ts";
import type { AddAddress, AddOnWayFacts, AddWatch, Received } from "./add-outside.ts";
import { PocketMoves, type PocketMove } from "./pocket-moves.ts";
import { INTENTS, parseQuote, type QuoteFacts, type SendPayout } from "./intents.ts";
import { POCKET_MAX_TEXT, POCKET_PAYMENT_MAX_USD, payeeRefusal, pocketIntentRefusal, pocketTransfer, signNep413 } from "./private-pocket.ts";
import { SIGN_IN_GAP_MS, SIGN_IN_PER_HOUR, SIGN_IN_RERUN_PER_HOUR, eip191Hash, eip712Hash, plainSignInRefusal, readSignIn, readTypedData, readableText, signInRefusal, siteSignInRefusal } from "./sign-message.ts";
import type { SignIn, TypedData } from "./sign-message.ts";
import type { Nep413Payload } from "./private-pocket.ts";
import type { PrivateLegRecord } from "./private-route.ts";
import { ProblemError, type Problem } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { hotNeedsApproval } from "./approval-policy.ts";
import { httpsOrigin } from "./https-url.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { base58, base64, fromBase64, u64At, utf8 } from "./sol/bytes.ts";
import { SOL_NAMED_COINS, decodeSolTx, solNamedCoin, type SolDecoded } from "./sol/decode.ts";
import { payoutRefusal, routeProgramsRefusal } from "./sol/payout.ts";
import { decodeTx, decompile, type LookupTable } from "./sol/wire.ts";
import type { Simulated, SolChain } from "./solana.ts";
import { HOT_ROOT, hotSecret } from "./hot-keys.ts";
import { AGENT_SIGN_IN_HOSTS, isAgentPocket } from "./site-wallets.ts";
import { SITE_WALLETS, hostSite, siteWallet } from "./site-hosts.ts";
import type { PocketSession } from "./agent-pocket.ts";
import type { RawKit } from "./agent-wallet.ts";
import { SaltUnread, privateBalances } from "./oneclick-account.ts";
import { faultOf } from "./services.ts";
import { SIM_SALE_GRACE_MS, SOL, extensionSolSecret, isSolPublicDown, ownTokenAccount, sessionRefusal, signSolTx, signableReason, solAddress, solTransferTx } from "./solana.ts";
import type { TokenChange } from "./solana.ts";
import { HIDDEN_COINS, SOL_TOKEN_ACCOUNT_RENT, hiddenCoin, type HiddenCoin } from "./hidden-coins.ts";
import { erc20TransferData, solTokenSendTx } from "./hidden-tx.ts";
import type { Vault } from "./vault.ts";
import { quoteDeadline } from "./quote-deadline.ts";

export type SubWalletKind = "trade" | "browser" | "extension" | "pay" | "private" | "site";
export interface SubWallet {
  id: string;
  kind: SubWalletKind;
  /** "near": the private pocket's own NEAR account (an implicit account from its ed25519 key). */
  chain: "sol" | "near" | EvmWalletChain;
  address: string;
  label: string;
  /** A site's own wallet (kind "site", site-wallets.ts): the site it belongs to ("pump"). It signs for that site only. */
  site?: string;
  /** A trading wallet's place on its chain, 0–4 (Trade rotates through five per chain). */
  slot?: number;
  /** Made from the backup words, so a restore brings it back. Absent: made on this phone only (an older wallet). */
  inWords?: true;
  /** Made from backup words since replaced (recovery.renew): only the old words bring it back. Move its money out. */
  oldWords?: true;
  /** Its key was shown (subwallet.export, marked before the key leaves the core): "Key exported" in Details. D56: the wallet
   *  stays its chain's one and is filled as before, bounded by the cap and the fee guard. */
  keyExported?: true;
  /**
   * One wallet per chain (D55): the chain's current wallet, the one Trade, every app in Apps, the sites and ZeroFee Chat
   * use. Only on chain wallets (the trade and browser kinds, never on NEAR). False: an older wallet on that chain (an
   * earlier slot, the old apps wallet, one from replaced words): never filled again; its own coin drains to Spending.
   */
  current?: boolean;
}

/** The kind a chain's current wallet is made as (its key path, hot-keys.ts): "browser" on Ethereum, Base, Gnosis and
 *  Arbitrum (today's Browser wallet there), "trade" on Solana, Robinhood Chain and BNB Chain. */
export function pathKind(chain: string): "trade" | "browser" {
  return BROWSER_EVM.includes(chain as EvmWalletChain) ? "browser" : "trade";
}
/** Re-review B1: a sale that brings back under 85 % of what its coin is worth at the market price. */
const SALE_CHEAP = "It brings back much less than the coin is worth";
/** Taking an allowance back: a coin's approve(spender, 0) with no ETH sent. It moves nothing, so it may sign with no sheet. */
const allowanceBack = (call: { value: bigint; data: string }) => call.value === 0n && /^0x095ea7b3[0-9a-fA-F]{64}0{64}$/.test(call.data);
/** The cap's dollars for the coins Wallet sends (KNOWN_COINS): the dollar coins at $1; EURe counted at $1.25, so a euro
 *  is never undersold against the cap. */
const COIN_USD: Record<string, number> = { USDC: 1, USDT: 1, "USDC.e": 1, EURe: 1.25 };
/** A chain wallet (D55): on a chain, of the trade or browser kind; never NEAR's float or pocket, the card or the Extension. */
const isChainWallet = (w: { kind: string; chain: string }) => (w.kind === "trade" || w.kind === "browser") && w.chain !== "near";
/** A site's own wallet (site-wallets.ts): never a chain wallet, never current or older, never filled by the planner. */
const isSiteWallet = (w: { kind: string }) => w.kind === "site";
/** A site wallet's coins answer is kept this long (site-coins.ts); where its noted coins are kept, by wallet id. */
const COINS_KEPT_MS = 15_000;
const COINS_NOTED = "site.coins.";
/** A site's own wallet answers only a page on its own site's hosts: never a call with no page (Trade, Chat, ZeroFee's own
 *  screens) nor another site. Null: allowed, or not a site wallet. */
function siteBinding(w: { kind: string; chain: string; site?: string }, host: string | undefined): string | null {
  // audit C1 (3 Nov): a site never signs with the person's shared chain wallets (Trade's, Home's rows): only its own
  if (host !== undefined && isChainWallet(w)) return "This site can use only its own wallet.";
  if (!isSiteWallet(w)) return null;
  const s = siteWallet(w.site);
  if (!s) return "This wallet's site isn't one ZeroFee knows.";
  // AgentZero's pocket (D90) has no hosts: no web page, and no app's plain call, ever signs with it.
  if (s.agent) return "AgentZero's pocket signs only for AgentZero's own trades.";
  if (!host || !s.hosts.includes(host)) return s.host ? `This wallet approves only for ${s.hosts[0]}.` : `Your ${s.name} wallet approves only for ${s.name} (${s.hosts[0]}).`;
  return null;
}
/** Who asked, for a session: the app (stamped by forApps; none: ZeroFee's own screens) and, when a site asked, its page. */
export interface Caller {
  app?: string;
  site?: unknown;
}

interface Stored extends SubWallet {
  /** "direct": the vault holds the ed25519 secret; "extension": it holds the link seed, and the key is derived. */
  derive: "direct" | "extension";
  /** Made from the backup words (hot-keys.ts), so a restore brings it back. Older wallets were made on this phone only. */
  words?: true;
  /** Made from backup words since replaced: only those bring it back. */
  oldWords?: true;
}

/**
 * The account's one private pocket and its one NEAR float (the NEAR wallet's cash): never one the replaced backup words
 * open (security audit 4 Nov, finding 2: after a phishing scare, money moved into Private landed on a key the old words
 * open). After new words each is made again from them and the old one is emptied into it (rotateAfterNewWords).
 */
const isPocket = (w: { kind: string; oldWords?: true }) => w.kind === "private" && !w.oldWords;
const isFloat = (w: { kind: string; chain: string; oldWords?: true }) => w.kind === "trade" && w.chain === "near" && !w.oldWords;
/** A sweep that 1Click refused or refunded is asked again after this long, at most this many times (sweepOldWords). */
const SWEEP_AGAIN_MS = 10 * 60_000;
const SWEEP_TRIES = 5;
const SWEEP_TRIES_RECORD = "old-words-sweep-tries";
interface SweepTries {
  /** Tries since the count last started (the person's Try again, or a new amount). */
  n: number;
  lastMs: number;
  /** The amount the count is for: more money landing starts it over. */
  amount: string;
  /** 1Click called it too small to move: a known leftover, never asked about again at this amount. */
  left?: true;
}
/** One coin in the replaced words' pocket or float: on its way to the new one, to be asked again, out of tries, or too small. */
export interface OldWordsCoin {
  kind: "private" | "trade";
  tokenId: string;
  amount: string;
  state: "moving" | "waiting" | "stuck" | "left";
}
/** `left`: coins not on their way (`unread`: a wallet that didn't read counts as one, never as empty). */
export interface OldWordsSweep {
  moving: number;
  left: number;
  coins: OldWordsCoin[];
  unread?: true;
}
const sweepTag = (id: string, tokenId: string) => `sweep-${id}-${tokenId.replace(/[^A-Za-z0-9]/g, "").slice(-24)}`;
/** 1Click's own no for an amount under its minimum (its words: "too low", "too small", "minimum", "at least"), as
 *  PocketMoves passes it on; never the core's own refusals. */
const tooSmall = (e: unknown) => {
  const more = String((e as { problem?: { more?: unknown } })?.problem?.more ?? "");
  return more.startsWith("NEAR Intents said no.") && /too (low|small)|minimum|at least/i.test(more);
};

interface Session {
  /** The app that started it (the Extension): it covers that app's own calls only, never a site's (D55). */
  app: string | undefined;
  perTx: bigint;
  total: bigint;
  spent: bigint;
  endsAt: number;
}

/** A plain SOL transfer's network fee, in lamports (one signature). */
const SOL_PLAIN_FEE = 5_000n;
/** A plain EVM transfer's gas (plainEvm): never under 21,000; an estimate that needs more than 100,000 is refused. */
const PLAIN_GAS_MIN = 21_000n;
const PLAIN_GAS_MAX = 100_000n;
/** A move in's fee room on an EVM chain: what it keeps back, and the most its transfer may cost, as a share of the fee now. */
const FEE_ROOM_PCT = 125n;
const LIST = "subwallets";
/** The moves into the pocket the core quoted itself, for the main sheet's words (privateQuoteIn); each good for 30 minutes. */
const PRIVATE_INS = "private-in-quotes";
const PRIVATE_IN_MS = 30 * 60_000;
/** A Move's Private leg joins its Safe leg only when paid this recently before it (privateLeg): one Move's own taps. */
const PRIVATE_LEG_MS = 2 * 60_000;
/** Room left in the SOL row for Solana's fee and the account's own minimum (lamports). */
const HIDDEN_ROW_SOL_ROOM = 1_000_000n;
/** Hidden from a row (V4 Send): each row's own coin as 1Click names it, and the row's name on its sheet. */
const HIDDEN_ROWS = { sol: { coin: "nep141:sol.omft.near", row: "SOL wallet", symbol: "SOL" }, hood: { coin: "nep141:hood.omft.near", row: "ETH (RH) wallet", symbol: "ETH" } } as const;
/** Home's Add from another chain (V4 step 6): 1Click's coins on chains whose addresses need no memo (review M1). Robinhood
 *  Chain (hood): 1Click's GET /v0/tokens lists "nep141:hood.omft.near" (ETH, 18 decimals, blockchain "hood"), 3 Nov. */
const OUTSIDE_CHAINS = /^nep141:(?:btc|eth|base|arb|sol|hood|doge|ltc|zec|bch|pol|op|avax|gnosis|bera)(?:-[a-z0-9]+)?\.omft\.near$/;
/** BNB Chain's own coin on 1Click is a nep245 HOT token, not a nep141 (float-moves.ts CHAIN_COIN.bsc): taken from its own
 *  chain only while BNB Chain is open, the same shut gate as every other BNB move (it waits for its $1 test). */
const BNB_COIN = CHAIN_COIN.bsc.tokenId;
const seedName = (id: string) => `subwallet-seed:${id}`;
const addressOf = (chain: SubWallet["chain"], derive: Stored["derive"], seed: Uint8Array) =>
  chain === "sol" ? solAddress(derive === "extension" ? extensionSolSecret(seed) : seed) : chain === "near" ? nearImplicit(seed) : evmAddress(seed);
const KINDS: SubWalletKind[] = ["trade", "browser", "extension", "pay", "private", "site"];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LINK_AD = utf8("zerofee-extension/link/v1");
const LINK_TTL_MS = 5 * 60_000;
const MAX_SESSION_MINUTES = 30;
/** The most a fast-trade session may cover, in dollars at the core's own price, whatever the app asks for. */
const SESSION_MAX_USD = { perTx: 100, total: 500 };
/**
 * D143 refinement, audit C1 (3 Nov): the most the hot keys sign with no sheet, ALL of them together (one rolling cap), in
 * dollars at the core's own price: one signature (plus FEE_ROOM_USD of fees and rent), and every no-sheet signature in
 * any 24 hours (trades, Wallet's Hold sends, private sends from a row or the pocket). Past either, or with no price, the
 * approve sheet asks: one tap (D143: Face ID is only for money leaving the Safe). The Extension's wallet: its own
 * session's caps instead.
 */
const HOT_CAP_USD = { perTrade: SESSION_MAX_USD.perTx, perDay: SESSION_MAX_USD.total };
/** The outside-send sheet's words: send-words.ts OUTSIDE_WORDS (there so Send's own screen says the same line, light). */
export { OUTSIDE_WORDS };
/** Where a 1Click payout's payee side lands, for the outside sheet's last line. */
const landsWords = (q: { destinationAsset: string; recipientType: string }): string | null => (q.recipientType === "CONFIDENTIAL_INTENTS" ? PRIVATE_LANDS : landsOn(q.destinationAsset, q.recipientType));
/** Fees over this share of what leaves are warned on the sheet (the test speed check, 5 Nov: "over ~5 %"). */
export const OUTSIDE_FEE_WARN = 0.05;
const usdOk = (v: string | undefined): number | null => (typeof v === "string" && /^\d{1,12}(\.\d{1,18})?$/.test(v) ? Number(v) : null);
/** The outside sheet's lines: the full address, then what they get and the fee from 1Click's signed dollars (none
 *  known: only the address; never a made-up figure), "Public on <network>." last, and the warning when the fee is
 *  over OUTSIDE_FEE_WARN. `network`: where the payee's side lands (send-words.ts landsOn / CHAIN_WORDS below). */
export function outsideLines(to: string, inUsd: string | undefined, outUsd: string | undefined, network?: string | null): { lines: string[]; warnings: { kind: "large-amount"; text: string }[] } {
  const a = usdOk(inUsd), b = usdOk(outUsd);
  if (a === null || b === null || !(a > 0) || b > a) return { lines: [OUTSIDE_WORDS.to(to), OUTSIDE_WORDS.seen(network)], warnings: [] };
  const fee = a - b, pct = ((fee / a) * 100).toFixed(1);
  return {
    lines: [OUTSIDE_WORDS.to(to), OUTSIDE_WORDS.get(b.toFixed(2)), OUTSIDE_WORDS.fees(fee.toFixed(2)), OUTSIDE_WORDS.kept, OUTSIDE_WORDS.seen(network)],
    warnings: fee / a > OUTSIDE_FEE_WARN ? [{ kind: "large-amount", text: OUTSIDE_WORDS.high(pct) }] : [],
  };
}
/** Smallest units as decimal text ("0.0033"), trailing zeros dropped. */
function fromUnitsText(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${s.slice(0, s.length - decimals)}${frac ? `.${frac}` : ""}`;
}
const HOT_SPENT = "hot-spent";
const DAY_MS = 86_400_000;
/** The approve sheet's words for a hot key's request outside the person's own flow (hot-sheets.ts), loaded when one asks. */
const hotSheets = () => import("./hot-sheets.ts");
/** The most accounts a Solana test run reads (its writable ones); a transaction writing more isn't covered. */
const SOL_WATCH_MAX = 32;
/**
 * In the Trade session, a trade's network fee and a new coin account's rent may go up to this much over its dollars a
 * trade (so a $100 tap is a $100 trade), and still count toward the session's total.
 */
const FEE_ROOM_USD = 1;
/** The Trade session's id in subwallet.session.ended and subwallet.session.end. */
export const TRADE_SESSION = "trade";
const NATIVE_DECIMALS: Record<SubWallet["chain"], number> = { sol: 9, bsc: 18, hood: 18, near: 24, eth: 18, base: 18, gnosis: 18, arb: 18 };
const units = (v: unknown, what: string) => {
  if (typeof v !== "string" || !/^\d{1,30}$/.test(v)) throw new ProblemError(securityProblems.requestInvalid(`${what} must be a whole number written as text`));
  return BigInt(v);
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** Trading wallets per chain (Trade rotates through them, TRADE-FLOAT §2). */
const SLOTS = 5;
/**
 * A sell in a session (the study's item 6): its proceeds count against the caps like a buy's spend, and its minimum must
 * be at least this share of what a test run says it brings back now: never stricter than Trade's own widest slippage
 * (2,000 bps), so a fast sell still goes fast, but a dump at a floor of one unit can't.
 */
const SELL_FLOOR_BPS = 8_000n;
/** At most what closing one token account refunds on Solana (rent), so a refund isn't read as proceeds the floor must meet. */
const RENT_REFUND_MAX = 3_000_000n;

/** Why a session can't cover these sells (null: it can): nothing comes back, or the minimum is too far under it. */
/**
 * What a Solana session trade does to the wallet's coins (audit SOL-1, SOL-2), from the test run's token accounts: one
 * swap per transaction; a buy spends only SOL (no coin of the wallet's falls, so a "buy" on a pool quoted in a coin the
 * wallet holds isn't a cheap trade), and its minimum is at least 80% of what the test run says it gets; a sell spends
 * only the coin it sells. Null when that holds; else why the sheet shows. Unread coins: the sheet.
 */
export function coinsRefusal(swaps: { side: "buy" | "sell"; coin?: string; minOutRaw: string }[], tokens: TokenChange[] | undefined, wsol: string): string | null {
  if (!tokens) return "Its coins aren't read yet";
  if (swaps.length !== 1) return "It isn't one trade";
  const swap = swaps[0]!;
  const fell = tokens.filter((t) => t.address !== wsol && t.after < t.before);
  if (swap.side === "buy") {
    if (fell.length) return "It spends a coin you hold, not SOL";
    const got = tokens.filter((t) => t.address !== wsol && t.after > t.before).reduce((most, t) => (t.after - t.before > most ? t.after - t.before : most), 0n);
    if (got === 0n || BigInt(swap.minOutRaw) * 5n < got * 4n) return "Its minimum is far under what it gets";
    return null;
  }
  if (fell.length > 1 || (swap.coin !== undefined && fell.some((t) => t.mint !== swap.coin))) return "It spends another coin you hold";
  return null;
}

/** Gap 4 (c): both nodes' test runs gave the very same figures: the chain's coin back and every coin in (the lower of the
 *  two equal to the higher). A run with no figures to compare isn't exact. */
export function exactlyAgreed(sim: Pick<EvmSimulated, "agreed" | "nativeIn" | "nativeInHigh" | "coinsIn" | "coinsInHigh">): boolean {
  if (!sim.agreed || !sim.coinsIn || !sim.coinsInHigh) return false;
  if ((sim.nativeIn ?? 0n) !== (sim.nativeInHigh ?? sim.nativeIn ?? 0n)) return false;
  const keys = new Set([...sim.coinsIn.keys(), ...sim.coinsInHigh.keys()]);
  return [...keys].every((k) => (sim.coinsIn!.get(k) ?? 0n) === (sim.coinsInHigh!.get(k) ?? 0n));
}

/** Gap 5: a trade through a middle coin (a path of three) leaves the wallet's balance of that coin unchanged on both nodes'
 *  test runs, read, never assumed (unread is a refusal). Null for any other trade. */
export function middleLeftRefusal(path: readonly string[] | undefined, sim: Pick<EvmSimulated, "coinsIn" | "coinsInHigh">): string | null {
  if (path?.length !== 3) return null;
  const mid = path[1]!.toLowerCase();
  if (!sim.coinsIn || !sim.coinsInHigh) return "It leaves some of another coin in your wallet";
  return (sim.coinsIn.get(mid) ?? 0n) !== 0n || (sim.coinsInHigh.get(mid) ?? 0n) !== 0n ? "It leaves some of another coin in your wallet" : null;
}

/** An EVM buy's minimum is at least 80% of what the test run says it gets, from both nodes' traced Transfer logs (audit
 *  EVM-3; a sale's floor is sellRefusal's). Unread, or a coin the bytes don't name: the sheet. */
export function evmBuyRefusal(swaps: { side: "buy" | "sell"; coin?: string; minOutRaw: string }[], coinsIn: Map<string, bigint> | undefined): string | null {
  const buy = swaps.find((x) => x.side === "buy");
  if (!buy) return null;
  if (!coinsIn || !buy.coin) return "what it gets couldn't be read";
  const got = coinsIn.get(buy.coin.toLowerCase()) ?? 0n;
  if (got <= 0n || BigInt(buy.minOutRaw) * 5n < got * 4n) return "its minimum is far under what it gets";
  return null;
}

function sellRefusal(sells: { minOutRaw: string }[], proceeds: bigint, refunds = 0n): string | null {
  if (sells.length === 0) return null;
  if (proceeds <= 0n) return "It doesn't show what the sale brings back";
  const floor = sells.reduce((sum, s) => sum + BigInt(s.minOutRaw), 0n);
  const net = proceeds > refunds ? proceeds - refunds : 0n;
  return floor * 10_000n < net * SELL_FLOOR_BPS ? "It could get back over 20% less than the sale is worth now" : null;
}
const TRADE_CHAINS = ["sol", "bsc", "hood"] as const;
/**
 * The coins a restore looks for on each EVM chain besides the chain's own coin and a sent transaction (A12, H05): the
 * known coins the wallets hold (KNOWN_COINS), and on BNB Chain its two dollar coins. A wallet that only ever received
 * one of these has sent nothing and may hold no gas, so its nonce and balance alone would miss it.
 */
const RESCAN_COINS: Partial<Record<EvmWalletChain, readonly string[]>> = {
  ...Object.fromEntries(Object.entries(KNOWN_COINS).map(([c, list]) => [c, list!.map((x) => x.token)])),
  bsc: ["0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
};
/**
 * Each trading wallet's slot: the one it was made for, or for a wallet made before slots, the lowest free one in the
 * order they were made (so an account's first trading wallet on a chain is slot 0).
 */
function slotsOf(list: Stored[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const chain of TRADE_CHAINS) {
    const own = list.filter((w) => w.kind === "trade" && w.chain === chain);
    const taken = new Set(own.flatMap((w) => (w.slot === undefined ? [] : [w.slot])));
    let next = 0;
    for (const w of own) {
      if (w.slot !== undefined) {
        out.set(w.id, w.slot);
        continue;
      }
      while (taken.has(next)) next++;
      out.set(w.id, next);
      taken.add(next);
    }
  }
  return out;
}
const CHAIN_WORDS: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };
/** The one site the card's wallet signs for (D29 F2): Gnosis Pay's own app. */
const CARD_SITE = "app.gnosispay.com";
/** { origin } of an https page → its host ("app.example.com", with a port only if it isn't 443), or null. */
function siteHost(site: unknown): string | null {
  const origin = (site as { origin?: unknown } | null)?.origin;
  if (typeof origin !== "string" || origin.length > 300) return null;
  // Without URL (https-url.ts): on the phone's core (JavaScriptCore) URL is missing, and every site read as no site.
  const u = httpsOrigin(origin);
  return u && (u.rest === "" || u.rest === "/") && u.origin === origin.replace(/\/$/, "") ? u.host : null;
}
/** A secp256k1 signature over a 32-byte digest, as wallets return it: r ‖ s ‖ v (27 or 28), 65 bytes. */
function evmSignature(digest: Uint8Array, secret: Uint8Array): Uint8Array {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(digest, secret, { prehash: false, format: "recovered" }), "recovered");
  return new Uint8Array([...sig.toBytes("compact"), 27 + sig.recovery!]);
}
/** Home's Send's join check and pocket payment (send-words.ts): loaded with the first Send, never in Home's first load. */
const sendWords = () => import("./send-words.ts");

/** A NEAR implicit account: the 64-hex of an ed25519 public key (the private pocket's own account). */
const nearImplicit = (secret: Uint8Array) => Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");

export interface SubWalletOptions {
  vault: Vault;
  sol: SolChain;
  evm: EvmChain;
  /** NEAR's nodes, two that must agree (chain.ts), for the NEAR coin wallet's Rhea trades. Not set: none. */
  near?: Chain;
  /** The approval sheet: resolves true only if the person approved (Face ID on the phone). */
  approve: (words: PlainWords) => Promise<boolean>;
  emit: (event: string, payload: unknown) => void;
  /** The chain's own coin in dollars, from a source the app doesn't control (null if it can't be read now). When
   *  given, a session's caps are checked and shown in dollars too. */
  usdPrice?: (chain: "sol" | "bsc" | "hood" | "near") => Promise<number | null>;
  /** A NEAR Intents coin's dollar price and decimals, fresh (1Click's token list), or null: the pocket's tally (INFO-1). */
  tokenPrice?: (tokenId: string) => Promise<{ usd: number; decimals: number; symbol?: string } | null>;
  /** A coin's price in dollars on that chain, from the market (the relay), under a minute old; null when unknown. */
  marketPrice?: (chain: EvmChainName | "sol" | "near", coin: string) => Promise<number | null>;
  /** Many coins' prices at once (a site wallet's coins: the relay's GeckoTerminal, Solana, BNB Chain and Robinhood Chain),
   *  by mint or contract; a coin with no price isn't in it. Display only. */
  marketPrices?: (chain: "sol" | "bsc" | "hood", coins: string[]) => Promise<Map<string, number>>;
  /** Tests only: what the private pocket holds, in dollars, in place of reading it. */
  pocketUsd?: () => Promise<number>;
  /** A confidential quote, read back by its deposit address through the pinned quote server (1Click's public status
   *  doesn't know confidential addresses). Not set: the private pocket can't pay yet. */
  privateStatus?: (depositAddress: string, statusTag?: string) => Promise<unknown | null>;
  /** The same pinned quote server, for the float's moves (float-moves.ts). Not set: the float can't move yet. */
  floatRelay?: FloatRelay;
  /** The account's own NEAR account id, for the float's Take out. */
  mainAccount?: () => Promise<string | null>;
  /** A screen of the device's own for an exported key (the phone, S1.6): the key goes there and never back to the
   *  caller, who hears only { shown }. Not set (the web): the caller gets the key to show. */
  showSecret?: (s: { label: string; secretKey: string }) => Promise<boolean>;
  /** How often and how long a sent transaction is checked for on both nodes. Default: every 2 s, up to 90 s. */
  confirm?: { everyMs: number; forMs: number };
  /** The key a 1Click quote must be signed with. Default: 1Click's own; tests sign their quotes with a test key. */
  quoteKey?: string;
  /** NEAR Intents' current salt (intents.near current_salt, hex), for a confidential wallet's sign-in. Not set: none. */
  intentsSalt?: () => Promise<string | null>;
  /** A sign-in with that salt failed: a salt kept by intentsSalt is asked again next time. */
  forgetSalt?: () => void;
  /** 1Click's account calls go through this (tests); default fetch. */
  oneClickFetch?: typeof fetch;
  /**
   * A browser (audit K-4): a wallet made from the backup words keeps no key in the vault. Its key is made again from
   * the hot root when it signs and kept in memory only (gone when the page locks). Not set (the phone): kept in the
   * Keychain as before.
   */
  hotKeysInMemory?: boolean;
  /**
   * scrypt done by the host, off the core's thread (the phone: CoreContext.swift's, 2 Nov: in its JavaScriptCore the
   * link's scrypt took 21 s, and the whole app waited). The same parameters and bytes as @noble/hashes' scrypt, which is
   * used when this isn't set, or when the host's can't answer.
   */
  scrypt?: HostScrypt;
  /**
   * AgentZero's own wallet (agent-wallet.ts, AGENTZERO-WALLET.md): `on` defaults to AGENTZERO_WALLET (off), and `proof`
   * to HOME_PROOF (the $1 proof build: the NEAR wallet → AgentZero leg opens only there). Only tests set either.
   */
  agentWallet?: { on?: boolean; proof?: boolean };
  /** The moves' clock (FloatMoves.now): tests step it; the app leaves it to Date.now. */
  now?: () => number;
}

/** scrypt(password, salt) with these parameters, by the host: the derived key, or a rejection. */
export type HostScrypt = (password: Uint8Array, salt: Uint8Array, o: { N: number; r: number; p: number; dkLen: number }) => Promise<Uint8Array>;

/** What a site may read through its wallet (D29 C.4): reads only, on the wallet's chain. */
const SITE_READS = new Set(["eth_call", "eth_getBalance", "eth_blockNumber", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getCode"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What a buy's own bytes can make leave the wallet (B36 reviews H2, N1): the larger of the swap's amount in and the SOL
 * the wallet wraps into its own wSOL account, plus the network fee and the rent of each coin account it opens for itself.
 * The bound one server's figures are never allowed under, and the short sheet's limit.
 */
function buyBound(tx: ReturnType<typeof decodeTx>, tables: LookupTable[], wallet: string, inRaw: string, feeLamports: string): bigint {
  let wrapped = 0n, accounts = 0n;
  try {
    const wsol = ownTokenAccount(wallet, SOL.wsol);
    for (const i of decompile(tx, tables).instructions) {
      if (i.programId === SOL.system && i.data.length === 12 && i.data[0] === 2 && i.data[1] === 0 && i.data[2] === 0 && i.data[3] === 0 && i.keys[0]?.pubkey === wallet && i.keys[1]?.pubkey === wsol) wrapped += u64At(i.data, 4);
      // review L-a: only coin accounts it opens for itself (owner @2)
      if (i.programId === SOL.ata && i.keys[2]?.pubkey === wallet) accounts += 1n;
    }
  } catch {
    // unreadable bytes are never covered (solPrepare's unread)
  }
  const amountIn = BigInt(inRaw) > wrapped ? BigInt(inRaw) : wrapped;
  return amountIn + BigInt(feeLamports) + accounts * RENT_REFUND_MAX;
}
/** D143 (approval-policy.ts): what a hot key's checks didn't pass, said by name; nothing is signed and nothing is asked. */
const notSigned = (cause: string, w?: { label: string }) => {
  const said = `${cause.trim().replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase())}.`;
  // rule 8 (5 Nov): a wallet's own trade names the check that failed and the wallet the money is in
  return new ProblemError(w ? securityProblems.tradeNotSigned(said, walletName(w.label)) : securityProblems.subwalletRefused(`${said.slice(0, -1)}. Nothing was signed.`));
};
/** A wallet's label as a sheet says it after "your": "SOL wallet", never "Your SOL wallet". */
const walletName = (label: string) => label.replace(/^your\s+/i, "").replace(/^./, (c) => (/^[A-Z]{2}/.test(label) ? c : c.toLowerCase())) || "wallet";
/** A site's request that failed a check goes to the sheet, its cause said first: "<Cause>, so ZeroFee asks you." */
const asksBecause = (cause: string) => `${cause.trim().replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase())}, so ZeroFee asks you.`;
/** D143: typed data a site asks for is never signed without a check ZeroFee can make, said plainly. */
export const TYPED_REFUSED = "This site asked for an approval ZeroFee won't give without a check. Nothing was signed.";
/** The core's own plain transfer for Wallet's Send (sendPlain → sendSol / sendCall → signTx): a value no bridge call can
 *  carry (its params are JSON), so no app's bytes ever pass as it. */
const OWN_SEND: unique symbol = Symbol("the core's own send");
/** A promise's outcome without throwing (so two reads can run side by side and be answered in a set order). */
function settled<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

/** Speed (Trade, the test real-money run 3 Nov): the network reads a preflight made for one Solana (BNB Chain,
 *  Robinhood Chain: 4 Nov) transaction's exact bytes are used by its tap for at most this long. Only reads: every check runs again at the tap (review, 3 Nov). */
export const PREFLIGHT_MS = 10_000;
/** At most this many preflights kept at once (the oldest goes first). */
const PREFLIGHT_MAX = 32;
/** How long a Solana wallet's last landed trade's slot (minSlot) holds every test run to state at or after it: by then
 *  every node is long past it. */
export const SOL_SLOT_MS = 90_000;
const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** A Solana transaction's network reads (solReads): what the check (solCheck) computes from, at the tap, with no read. */
type SolReads = { tx: ReturnType<typeof decodeTx>; tables: LookupTable[]; sim: Simulated; unread: boolean; watch: string[]; executable: (keys: string[]) => Promise<boolean[]> };
/** A BNB Chain or Robinhood Chain trade's network reads (tradeReads): the coins' names, the approved coins' balances, the
 *  Pons curve, the coin's deepest v3 tier. tradeFactsOf computes the decoder's verdict from them, at the tap's own time. */
type TradeReads = { infos: Map<string, { symbol: string; decimals: number } | undefined>; balances: Map<string, bigint>; ponsCurve: Awaited<ReturnType<EvmChain["ponsCurve"]>> | null; v3: number | null | undefined; hook: HookFacts | null; midDeepest: number | null };
/** An EVM transaction for this wallet, as one step after another: its number and its call (the test run's own input). */
type EvmStep = { nonce: number; call: EvmCall };
/** A BNB Chain or Robinhood Chain trade's network reads, made by a preflight (evmReads): the nonce, the two-node test run
 *  (run after exactly `seq`, the earlier transactions), the trade's reads and, for a route that chose its pools, the
 *  independent reference. What signEvm's checks compute from at the tap, with no read. */
type EvmReads = { next: number; seq: string; sim: EvmSimulated; trade: TradeReads; reference?: bigint | null };
/** An EVM transaction's call from this wallet, as its test run runs it (review M6: with its own fee fields). */
const evmCallOf = (from: string, t: ReturnType<typeof parseTx>): EvmCall => ({ from, to: t.to, value: t.value, data: t.data, gas: t.gas, maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas });
/** What an EVM preflight is kept by besides the caller and wallet: the bytes and the coin signTx is told (the decoder's). */
const evmKeyed = (txB64: string, coin: unknown): string => `${txB64}|${typeof coin === "string" ? coin : ""}`;
/** At most this many earlier steps a preflight runs a transaction after (a sale's approvals). */
const PREFLIGHT_BEFORE_MAX = 4;
/** One EVM step as text: its number and every field of its call (the test run's input, so equal text is an equal run). */
const evmStepKey = (x: EvmStep): string => [x.nonce, x.call.from, x.call.to, x.call.value, x.call.data, x.call.gas, x.call.maxFeePerGas ?? "", x.call.maxPriorityFeePerGas ?? ""].join("|").toLowerCase();

/** Decision H (product decision, 4 Nov): why the sheet asks for a Trade quote its own price checks flagged (slippage.ts NeedsApproval). */
const TRADE_ASKS = {
  unpriced: "Only Jupiter gives a price for it, so ZeroFee asks you.",
  "high-impact": "This price is far from the market price, so ZeroFee asks you.",
  "wide-slippage": "You may get over 5% less than shown, so ZeroFee asks you.",
} as const;

export class SubWallets {
  private readonly o: SubWalletOptions;
  /**
   * Preflight (Trade's speed, review, 3 Nov): the NETWORK READS of one Solana transaction (its
   * blockhash, tables, the two-node test run, the route's programs; the sale coins' market price and decimals, SOL's
   * price), made ahead of the tap. Keyed by the wallet, the caller, the site and the bytes' sha256; used by one signTx of
   * those exact bytes within PREFLIGHT_MS, then gone. Never a verdict: at the tap every check (the payout pin, the one
   * cap, B1's market price, the wSOL rule, the shared-wallet refusal, the floors) runs again on the bytes being signed, as
   * pure computation on these reads, and the tap makes no network call. Dropped for a wallet once it signs.
   * BNB Chain and Robinhood Chain (4 Nov): the nonce, the two-node test run, the trade's reads, the reference and the
   * prices the same way (evmReads), keyed by the coin too; every check of signEvm runs again on them at the tap. A sale's
   * swap is test-run after its approve (`after`): signing exactly that approve keeps it, anything else drops it.
   */
  private readonly preflights = new Map<string, { at: number; sol?: Promise<SolReads>; evm?: Promise<EvmReads>; after?: Set<string>; minSlot: number }>();
  /**
   * The test real-money run (4 Nov): a sale right after its buy landed was run on a node that hadn't seen the buy yet
   * (no coins), and refused. Each Solana trading wallet's last landed trade's slot, as Trade's landed check read it (its
   * `minSlot`): every test run of that wallet's transactions within SOL_SLOT_MS is on state at or after it
   * (SolChain.simulate minSlot). The highest wins. It can only make a node wait or count as not answering, never pass a
   * check: a wrong one refuses (nothing signed), it never signs.
   */
  private readonly solSlots = new Map<string, { slot: number; at: number }>();
  /** Market prices and decimals of the coins sales sell (B1), by chain and coin, kept 30 s (preflight warms them). */
  private readonly coinAsks = new Map<string, { at: number; ask: Promise<number | null> }>();
  /** A site wallet's coins as last read (coins()), by wallet id: kept COINS_KEPT_MS. */
  private readonly coinRows = new Map<string, { at: number; rows: import("./site-coins.ts").WalletCoinRow[] }>();
  private readonly sessions = new Map<string, Session>();
  /** The Trade session (tradeSessionStart): when it ends. D143: it gates nothing; Trade reads its end. */
  private trade: { endsAt: number } | null = null;
  /** AgentZero's pocket day (D90, D107; agent-pocket.ts, loaded on first ask): its own trades from its pocket only. */
  private pocketDay: Promise<PocketSession> | null = null;
  private pocketLive: PocketSession | null = null;
  /** Counts every Stop (pause, Stop AgentZero, the end): a day whose Face ID was still open when one came never starts. */
  private agentPocketStops = 0;
  /** EVM transactions this phone signed, by wallet, that may not have landed yet: later ones are run after them. */
  private readonly pending = new Map<string, { nonce: number; call: EvmCall; own?: true }[]>();
  /** The core's own send under way from each EVM wallet (sendCall, payPlain): its unsigned transaction, while it holds the
   *  wallet's turn, so nothing else is signed at its number meanwhile (numberTaken). */
  private readonly held = new Map<string, Uint8Array>();
  /** ZeroFee Chat's payment (subwallet.send) under way, from its ask to its answer: one at a time, so a double tap is
   *  never two sheets for the same payment, one after the other (security review 2 Nov). */
  private plainSending = false;
  /** One hidden send from a row at a time (double tap). */
  private hiddenRowSending = false;
  private link: { code: string; kind: "extension"; expiresAt: number } | null = null;
  /** The float's fee guard: at most 20 moves in 24 hours without asking, none under $2. */
  readonly floatGuard: FloatGuard;
  private readonly floatMoves: FloatMoves;
  private readonly pocketMoves: PocketMoves;
  /** Writes to the wallet list, one at a time: two creates at once must not drop one from the list. */
  private writing: Promise<unknown> = Promise.resolve();
  /** hotKeysInMemory: the words' wallets' keys made this session, by wallet id. */
  private readonly hotKeys = new Map<string, Uint8Array>();
  /** hotKeysInMemory: keys a vault kept from before (K-4) were checked against the words and deleted. */
  private swept: Promise<void> | null = null;
  /** When each site wallet last signed a sign-in with no sheet, and for which site (signMessage), listed for the hub's
   *  wallet sheet; and the times of its no-sheet sign-ins in the last hour (signInRoom). */
  private readonly signIns = new Map<string, { atMs: number; site: string; by?: "agentzero" }>();
  private readonly signInTimes = new Map<string, number[]>();
  /** QA (5 Nov): the re-run room, apart from the person's. An already-approved session (this wallet, this site,
   *  this allow-listed template, signed before) signing again with no tap of the person's: at most one per page load and
   *  SIGN_IN_RERUN_PER_HOUR an hour per site. By "<wallet>|<site>": the times, and the page loads already used. */
  private readonly approvedSignIns = new Set<string>();
  private readonly rerunTimes = new Map<string, number[]>();
  private readonly rerunLoads = new Map<string, string[]>();
  /** Room for one more no-sheet sign-in: fewer than SIGN_IN_PER_HOUR in the last hour, none in the last SIGN_IN_GAP_MS
   *  (review B, M4: a page's script can't collect them). Taking it records it.
   *  QA (5 Nov): a re-run (`rerun`: an approved session, no tap) never draws on that room, so a page that spams
   *  reconnects can't use up the person's own taps: it has its own, at most one per page load (`load`, the host's word)
   *  and SIGN_IN_RERUN_PER_HOUR an hour per site. Never uncapped: no load named is no re-run room at all. */
  private signInRoom(id: string, site: string, rerun?: { load: unknown }, by?: "agentzero"): boolean {
    const now = Date.now();
    if (rerun) {
      const key = `${id}|${site}`;
      const load = typeof rerun.load === "string" && /^[A-Za-z0-9-]{1,80}$/.test(rerun.load) ? rerun.load : null;
      const times = (this.rerunTimes.get(key) ?? []).filter((t) => now - t < 3_600_000);
      const loads = this.rerunLoads.get(key) ?? [];
      if (!load || loads.includes(load) || times.length >= SIGN_IN_RERUN_PER_HOUR) return false;
      times.push(now);
      this.rerunTimes.set(key, times);
      this.rerunLoads.set(key, [...loads, load].slice(-SIGN_IN_RERUN_PER_HOUR));
      this.signIns.set(id, { atMs: now, site, ...(by ? { by } : {}) });
      return true;
    }
    const times = (this.signInTimes.get(id) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= SIGN_IN_PER_HOUR || (times.length > 0 && now - times[times.length - 1]! < SIGN_IN_GAP_MS)) return false;
    times.push(now);
    this.signInTimes.set(id, times);
    this.signIns.set(id, { atMs: now, site, ...(by ? { by } : {}) });
    return true;
  }
  /** The sign-ins signed with no sheet, newest first (Social trading's wallet sheet: "Signed in to gmgn.ai at 7:12 PM").
   *  `by`: "agentzero" for AgentZero's own window's sign-ins with its pocket (ruling d). */
  siteSignIns(): { wallet: string; site: string; atIso: string; by?: "agentzero" }[] {
    return [...this.signIns].map(([wallet, v]) => ({ wallet, site: v.site, atIso: new Date(v.atMs).toISOString(), ...(v.by ? { by: v.by } : {}) })).sort((a, b) => b.atIso.localeCompare(a.atIso));
  }
  /** Site wallets whose Move back sheet is up (one at a time). */
  private readonly askingBack = new Set<string>();
  /** Site wallets the person is moving back right now (siteMoveBack, after its sheet): open for that move's key only. */
  private readonly movingBack = new Map<string, string>();
  /** AgentZero's pocket opened for one fill the person approved on the core's sheet (P2): its wallet and that move's key. */

  constructor(options: SubWalletOptions) {
    this.o = options;
    this.floatGuard = new FloatGuard(options.vault);
    this.floatMoves = new FloatMoves({
      vault: options.vault,
      ...(options.now ? { now: options.now } : {}),
      guard: this.floatGuard,
      relay: options.floatRelay,
      usdPrice: options.usdPrice,
      ...(options.tokenPrice ? { tokenPrice: options.tokenPrice } : {}),
      ...(options.intentsSalt ? { confidentialBalances: () => this.floatHeld() } : {}),
      ...(options.quoteKey ? { quoteKey: options.quoteKey } : {}),
      float: async () => {
        const w = (await this.stored()).find(isFloat);
        if (!w) throw new ProblemError(securityProblems.subwalletRefused("Move money to your NEAR wallet first."));
        return { address: w.address, secret: () => this.secret(w) };
      },
      wallet: async (chain, ref, filling) => {
        const w = await this.walletOf(chain, ref, filling);
        return { id: w.id, address: w.address, ...(w.oldWords ? { oldWords: true } : {}), ...(w.keyExported && (await this.older(w)) ? { exportedOlder: true } : {}) };
      },
      spendable: async (chain, ref, keep) => this.spendable(await this.walletOf(chain, ref), keep),
      pay: async (chain, ref, to, amount, feeAtMost, tried) => this.payPlain(await this.walletOf(chain, ref), to, amount, feeAtMost, tried),
      // Read before anything is asked: a fee that can't be read refuses the move plainly (nothing moved), never a bare error.
      networkFee: async (chain, ref) =>
        chain === "sol" ? SOL_PLAIN_FEE : this.plainFeeRoom(await this.walletOf(chain, ref ?? {})).catch((e) => {
          throw e instanceof ProblemError ? e : new ProblemError(securityProblems.chainUnreachable(chain));
        }),
      unpaid: async (chain, ref, depositAddress, tried) => this.unpaidIn(await this.walletOf(chain, ref), depositAddress, tried).catch(() => false),
      depositTxs: async (chain, address) => (chain === "sol" ? ((await this.o.sol.recentSignatures?.(address, ADD_HINT_TXS)) ?? []) : []),
      // Where the core's own transfer stands, as two nodes have it: any "ok" landed; both "failed" failed; both
      // without it, none (audit RM-2). Anything else can't be said.
      landed: async (chain, txId) => {
        const seen = chain === "sol" ? await this.o.sol.status?.(txId) : await this.o.evm.receipt(chain, txId);
        if (!seen || seen.length < 2) return null;
        if (seen.includes("ok")) return "ok";
        if (seen.every((x) => x === "failed")) return "failed";
        if (seen.every((x) => x === null)) return "none";
        return null;
      },
      // S21: what the Safe holds inside NEAR Intents, by intents.near itself (two nodes at one agreed block)
      ...(options.near ? { safeHeld: async (accountId: string, tokenId: string) => {
        const near = options.near!;
        const raw = await near.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: tokenId }, await near.commonBlock());
        return typeof raw === "string" && /^\d{1,40}$/.test(raw) ? BigInt(raw) : null;
      } } : {}),
      mainAccount: async () => {
        const id = this.o.mainAccount ? await this.o.mainAccount() : null;
        if (!id) throw new ProblemError(securityProblems.subwalletRefused("There's no main account to move it to yet."));
        return id;
      },
      // the NEAR coin wallet (Rhea trades): filled and emptied only through NEAR Confidential (D153/D70)
      ...(options.near ? {
        nearCoin: {
          wallet: async () => { const w = await this.nearCoinWallet(); return { id: w.id, address: w.address }; },
          nearUsd: () => this.priceSoon("near"),
          spendable: async () => (await import("./near-coin.ts")).nearSpendable(this.nearCtx()),
          pay: async (to: string, amount: bigint) => (await import("./near-coin.ts")).nearPay(this.nearCtx(), to, amount),
        },
      } : {}),
    });
    this.pocketMoves = new PocketMoves({
      vault: options.vault,
      relay: options.floatRelay,
      ...(options.quoteKey ? { quoteKey: options.quoteKey } : {}),
      pocket: async () => {
        const w = (await this.stored()).find(isPocket);
        if (!w) throw new ProblemError(securityProblems.subwalletRefused("There's no private balance."));
        return { address: w.address, secret: () => this.secret(w) };
      },
      balances: () => this.confidentialBalances("private"),
      mainAccount: async () => {
        const id = this.o.mainAccount ? await this.o.mainAccount() : null;
        if (!id) throw new ProblemError(securityProblems.subwalletRefused("There's no main account to move it to yet."));
        return id;
      },
    });
  }

  private async stored(): Promise<Stored[]> {
    if (this.o.hotKeysInMemory) await this.sweep();
    const raw = await this.o.vault.get(LIST);
    return raw ? JSON.parse(new TextDecoder().decode(raw)) : [];
  }

  private async save(list: Stored[]): Promise<void> {
    // D55: the "came back from the words" mark from before (fromRestore) is dropped on the next save; nothing reads it
    await this.o.vault.put(LIST, utf8(JSON.stringify(list.map((w) => { const { fromRestore: _, ...rest } = w as Stored & { fromRestore?: unknown }; return rest; }))));
  }

  private async find(id: unknown): Promise<Stored> {
    const w = (await this.stored()).find((x) => x.id === id);
    if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
    return w;
  }

  /**
   * A words wallet's key, made from the hot root and held in memory (hotKeysInMemory), or null when the root doesn't
   * make this wallet's address (a wallet from older words keeps its key in the vault).
   */
  private async fromRoot(w: Stored): Promise<Uint8Array | null> {
    if (!w.words || w.oldWords || w.derive !== "direct") return null;
    const had = this.hotKeys.get(w.id);
    if (had) return had.slice();
    const root = await this.o.vault.get(HOT_ROOT);
    if (!root) return null;
    // an unlisted site's own wallet is on the host kind's path (audit C1), at its host index
    const secret = hotSecret(root, w.kind === "site" && siteWallet(w.site)?.host === true ? "host" : w.kind, w.chain, w.slot ?? 0);
    root.fill(0);
    if (!secret || addressOf(w.chain, "direct", secret) !== w.address) return null;
    this.hotKeys.set(w.id, secret);
    return secret.slice();
  }

  /** hotKeysInMemory: once a session, delete the vault's copy of every key the words make again (from before K-4). */
  private sweep(): Promise<void> {
    this.swept ??= (async () => {
      const raw = await this.o.vault.get(LIST);
      const list: Stored[] = raw ? JSON.parse(new TextDecoder().decode(raw)) : [];
      for (const w of list) if (await this.fromRoot(w)) await this.o.vault.delete(seedName(w.id));
    })().catch(() => {
      this.swept = null;
    });
    return this.swept;
  }

  private async secret(w: Stored, signing?: string): Promise<Uint8Array> {
    // every signature of this wallet, by any door, comes through here: its balances may move, so no read made before now
    // is used again (preflight), but one whose test run already ran after this very EVM step (`signing`: evmStepKey)
    this.dropPreflights(w, signing);
    if (this.o.hotKeysInMemory) {
      const made = await this.fromRoot(w);
      if (made) return made;
    }
    const seed = await this.o.vault.get(seedName(w.id));
    if (!seed) throw new ProblemError(securityProblems.subwalletUnknown());
    return w.derive === "extension" ? extensionSolSecret(seed) : seed;
  }

  private public(w: Stored, slot?: number, current?: Set<string>): SubWallet {
    return {
      id: w.id, kind: w.kind, chain: w.chain, address: w.address, label: w.label,
      ...(w.site ? { site: w.site } : {}),
      ...(slot === undefined ? {} : { slot }),
      ...(w.words ? { inWords: true as const } : {}), ...(w.oldWords ? { oldWords: true as const } : {}),
      ...(w.keyExported ? { keyExported: true as const } : {}),
      ...(current && isChainWallet(w) ? { current: current.has(w.id) } : {}),
    };
  }

  async list(): Promise<SubWallet[]> {
    const list = await this.stored();
    const slots = slotsOf(list);
    const current = await this.currentIds(list);
    return list.map((w) => this.public(w, slots.get(w.id), current));
  }

  /**
   * Each chain's current wallet (D55), worked out from the list each time, never stored: with the backup words' hot root
   * on this phone, the wallet at index 0 of the chain's key path from the current words (made from the words, not from
   * replaced ones). With no root (an account from before D43's words wallets), the first-made wallet of that kind on the
   * chain that isn't from replaced words. A chain can have none yet: the first create {chain} makes it.
   */
  private async currentIds(list: Stored[]): Promise<Set<string>> {
    const root = await this.o.vault.get(HOT_ROOT);
    root?.fill(0);
    const slots = slotsOf(list);
    const out = new Set<string>();
    for (const chain of new Set(list.filter(isChainWallet).map((w) => w.chain))) {
      const own = list.filter((w) => w.chain === chain && w.kind === pathKind(chain) && !w.oldWords);
      const w = root ? own.find((x) => x.words && x.derive === "direct" && (slots.get(x.id) ?? x.slot ?? 0) === 0) : own[0];
      if (w) out.add(w.id);
    }
    return out;
  }

  /** The chain's current wallet from the core's own list, made now if it isn't yet (create's chain kind). */
  private async current(chain: SubWallet["chain"]): Promise<Stored> {
    const made = await this.create("chain", chain);
    return this.find(made.id);
  }

  /** An older chain wallet (not its chain's current one), for the sheet's words: "From your older Solana wallet". */
  private async older(w: Stored): Promise<boolean> {
    return isChainWallet(w) && !(await this.currentIds(await this.stored())).has(w.id);
  }

  /**
   * After a restore from the words (A12, H05): every Spending, Trade and site wallet the words make, back in the list.
   * - Trading's balance and the private pocket always: their money sits on NEAR Intents' ledger, which no chain read
   *   shows, and the words make the same accounts, so their ledger balances read as before.
   * - Every slot (0 to 4) on every trading chain, each network's site (Browser) wallet and the card's wallet, when its
   *   chain shows any use: its own coin, any transaction, on Solana any token account (so a wallet holding coins and
   *   0 SOL is found), on the EVM chains the known coins (RESCAN_COINS).
   * - A wallet whose chain can't be read is listed anyway: an unread wallet is never taken for an empty one.
   * Anything not listed comes back the moment it's asked for, since the words make the same key.
   * `kinds`: the kinds this account may hold (a child's has none of these). `probe`: read the chains (mainnet); without
   * it only Trading's balance and the pocket come back now, and the rest as they're asked for.
   */
  async rediscover(kinds: readonly SubWalletKind[], probe = true): Promise<SubWallet[]> {
    const root = await this.o.vault.get(HOT_ROOT);
    if (!root) return [];
    const found: SubWallet[] = [];
    const take = async (kind: SubWalletKind, chain: string, slot?: number) => {
      if (!kinds.includes(kind)) return;
      // asking again (a second look once a chain answers) gives the same wallets; the one private pocket is never made twice
      const had = kind === "private" ? (await this.list()).find(isPocket) : undefined;
      found.push(had ?? (await this.create(kind, chain, slot)));
    };
    const sol = this.o.sol;
    const used = async (kind: SubWalletKind, chain: string, slot = 0): Promise<boolean> => {
      if (!probe || !kinds.includes(kind)) return false;
      const secret = hotSecret(root, kind, chain, slot);
      if (!secret) return false;
      try {
        // the NEAR coin wallet: its implicit account exists once anything was moved to it
        if (chain === "near") {
          const near = this.o.near;
          if (!near) return false;
          return (await near.account(nearImplicit(secret), await near.commonBlock())) !== null;
        }
        if (chain === "sol") {
          if (!sol.balance) return false;
          const address = solAddress(secret);
          const [lamports, tokens, history] = await Promise.all([sol.balance(address), sol.tokenAccounts?.(address) ?? [], sol.hasHistory?.(address) ?? false]);
          return lamports > 0n || tokens.length > 0 || history;
        }
        const address = evmAddress(secret);
        const evm = this.o.evm, c = chain as EvmWalletChain;
        const [nonce, raw, ...coins] = await Promise.all([evm.nonce(c, address), evm.read(c, "eth_getBalance", [address, "latest"]), ...(RESCAN_COINS[c] ?? []).map((t) => evm.tokenBalance(c, t, address))]);
        if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(raw)) throw new Error("no balance answer");
        return nonce > 0 || BigInt(raw) > 0n || coins.some((b) => b > 0n);
      } catch {
        return true; // couldn't be read: listed anyway, never called empty
      }
    };
    await take("trade", "near");
    await take("private", "near");
    // the NEAR coin wallet (Rhea trades): from the words at its one place, found again once it was used
    if (await used("browser", "near")) await take("browser", "near");
    // One chain at a time per network (its nodes' rate limits), the networks side by side.
    const scan = async (chain: string, kind: SubWalletKind, slots: number) => {
      for (let slot = 0; slot < slots; slot++) if (await used(kind, chain, slot)) await take(kind, chain, kind === "trade" ? slot : undefined);
    };
    await Promise.all([
      ...TRADE_CHAINS.map((chain) => scan(chain, "trade", SLOTS).then(() => (chain === "sol" ? scan("sol", "browser", 1) : undefined))),
      ...BROWSER_EVM.map((chain) => scan(chain, "browser", 1)),
      scan("gnosis", "pay", 1),
      // each site's own wallet, on each of its networks, when its chain shows any use
      ...SITE_WALLETS.flatMap((s) => s.chains.map(async (chain) => {
        if (kinds.includes("site") && (await used("site", chain, s.index))) found.push(await this.create("site", chain, undefined, s.site));
      })),
    ]);
    // One wallet per chain (D55, D56): each chain's current wallet is index 0 of the words, as on the old phone; any other
    // used one found here is an older wallet, and its own coin drains back to Spending. Nothing is marked.
    return found;
  }

  /**
   * New backup words ran (recovery.renew): every wallet made from the old words now opens only with them. Each stays
   * listed, keeps working and keeps its place; places asked for from now on come from the new words.
   */
  markOldWords(): Promise<void> {
    const next = this.writing.then(async () => {
      const list = await this.stored();
      // Keys made from the words in memory only (K-4) can't be made from the new words: each goes into the vault, under
      // the unlock, before the hot root moves.
      if (this.o.hotKeysInMemory) {
        for (const w of list) {
          if (!w.words || (await this.o.vault.get(seedName(w.id)))) continue;
          const secret = await this.fromRoot(w);
          if (secret) await this.o.vault.put(seedName(w.id), secret);
        }
        this.hotKeys.clear();
      }
      await this.save(list.map(({ words, ...w }) => (words ? { ...w, oldWords: true as const } : w)));
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /**
   * Security audit 4 Nov, finding 2: once the hot root holds the new words (demo-core syncRenew), the private pocket and
   * the NEAR float are made again from them, and what the old words' ones hold goes to the new ones (sweepOldWords). No
   * lookup, fill, quote or payment reaches an old one again (isPocket, isFloat; privatePay refuses one by id). Asking
   * again is safe: a wallet already made is given back, a move already on its way is left alone.
   */
  async rotateAfterNewWords(again = false): Promise<OldWordsSweep> {
    const list = await this.stored();
    if (list.some((w) => w.kind === "private" && w.oldWords) && !list.some(isPocket)) await this.create("private", "near");
    if (list.some((w) => w.kind === "trade" && w.chain === "near" && w.oldWords) && !list.some(isFloat)) await this.create("trade", "near");
    return this.sweepOldWords(again);
  }

  /**
   * Each coin the old words' pocket or float holds in NEAR Intents, moved whole to the new one: the pocket's own way out
   * (PocketMoves: 1Click's signed quote read back by its deposit address before anything is signed, the recipient
   * exactly the new wallet as a private balance, a refund back to the old one), kept in its own record. Money moves only
   * between the person's own wallets, so no sheet, as the pocket's way home. One sweep at a time (a second caller joins
   * the one running).
   *
   * Every try counts in its own record (SWEEP_TRIES_RECORD), so a quote 1Click refuses before it gives an address counts
   * too (review of 134e5b5b, 3). A coin with a move on its way is left alone; any other is asked again after 10 minutes,
   * at most five times, then waits ("stuck") for the person's Try again (`again`), which starts its count over. A coin
   * 1Click calls too small to move is a known leftover ("left"): shown, never asked about again, until its amount changes.
   * A coin whose amount changed (more money landed) starts its count over.
   */
  sweepOldWords(again = false): Promise<OldWordsSweep> {
    const run = async (): Promise<OldWordsSweep> => {
      if (again) await this.editTries((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.left ? v : { ...v, n: 0, lastMs: 0 }])));
      return this.sweepNow();
    };
    const next = (this.sweeping ?? Promise.resolve()).catch(() => undefined).then(run);
    const mine = next.finally(() => {
      if (this.sweeping === mine) this.sweeping = null;
    });
    this.sweeping = mine;
    return mine;
  }
  private sweeping: Promise<OldWordsSweep> | null = null;

  private async sweepNow(): Promise<OldWordsSweep> {
    const list = await this.stored();
    const olds = list.filter((w) => w.oldWords && w.chain === "near" && (w.kind === "private" || w.kind === "trade"));
    const out: OldWordsSweep = { moving: 0, left: 0, coins: [] };
    if (!olds.length) return out;
    if (!this.o.floatRelay || !this.o.intentsSalt) return { ...out, left: olds.length, unread: true };
    const tries = await this.tries();
    for (const old of olds) {
      const kind = old.kind as "private" | "trade";
      const to = list.find(kind === "private" ? isPocket : isFloat) ?? (await this.create(kind, "near"));
      // The root still the old words' (made again, it is the old one): nothing to sweep into yet.
      if (to.oldWords || to.address === old.address) {
        out.left++;
        out.unread = true;
        continue;
      }
      const moves = this.oldMoves(old, to);
      let held: { tokenId: string; amount: string }[];
      let past: PocketMove[];
      try {
        past = await moves.moves();
        held = await this.heldBy(old.address, await this.secret(old));
      } catch {
        // unread: unknown, never empty (it is asked again)
        out.left++;
        out.unread = true;
        continue;
      }
      for (const coin of held) {
        if (!/^\d+$/.test(coin.amount) || BigInt(coin.amount) === 0n) continue;
        const tag = sweepTag(old.id, coin.tokenId);
        const was = tries[tag];
        const t: SweepTries = was && was.amount === coin.amount ? was : { n: 0, lastMs: 0, amount: coin.amount };
        tries[tag] = t;
        const show = (state: OldWordsCoin["state"]) => out.coins.push({ kind, tokenId: coin.tokenId, amount: coin.amount, state });
        if (past.some((m) => m.id.startsWith(`pm-${tag}-`) && m.status === "pending")) {
          out.moving++;
          show("moving");
          continue;
        }
        out.left++;
        if (t.left) {
          show("left");
          continue;
        }
        if (t.n >= SWEEP_TRIES) {
          show("stuck");
          continue;
        }
        if (Date.now() - t.lastMs < SWEEP_AGAIN_MS) {
          show("waiting");
          continue;
        }
        t.n++;
        t.lastMs = Date.now();
        await this.editTries((all) => ({ ...all, [tag]: t }));
        try {
          await moves.home(coin.tokenId, "all", `${tag}-${t.n}-${t.lastMs.toString(36)}`);
          out.left--;
          out.moving++;
          show("moving");
        } catch (e) {
          if (tooSmall(e)) {
            t.left = true;
            await this.editTries((all) => ({ ...all, [tag]: t }));
          }
          show(t.left ? "left" : t.n >= SWEEP_TRIES ? "stuck" : "waiting");
        }
      }
    }
    return out;
  }

  /**
   * What the replaced words' pocket and float still hold, and where each coin's move to the new one is. Wallet counts it
   * in Private's total and shows it with a Try again (review of 134e5b5b, 1 and 2); the renew screen says it. Reads only.
   */
  async oldWordsMoney(): Promise<OldWordsSweep> {
    const list = await this.stored();
    const olds = list.filter((w) => w.oldWords && w.chain === "near" && (w.kind === "private" || w.kind === "trade"));
    const out: OldWordsSweep = { moving: 0, left: 0, coins: [] };
    if (!olds.length) return out;
    if (!this.o.intentsSalt) return { ...out, left: olds.length, unread: true };
    const tries = await this.tries();
    for (const old of olds) {
      const kind = old.kind as "private" | "trade";
      let held: { tokenId: string; amount: string }[];
      let past: PocketMove[] = [];
      try {
        held = await this.heldBy(old.address, await this.secret(old));
        const to = list.find(kind === "private" ? isPocket : isFloat);
        if (to && this.o.floatRelay) past = await this.oldMoves(old, to).moves();
      } catch {
        out.left++;
        out.unread = true;
        continue;
      }
      for (const coin of held) {
        if (!/^\d+$/.test(coin.amount) || BigInt(coin.amount) === 0n) continue;
        const tag = sweepTag(old.id, coin.tokenId);
        const t = tries[tag]?.amount === coin.amount ? tries[tag] : undefined;
        const state: OldWordsCoin["state"] = past.some((m) => m.id.startsWith(`pm-${tag}-`) && m.status === "pending") ? "moving" : t?.left ? "left" : (t?.n ?? 0) >= SWEEP_TRIES ? "stuck" : "waiting";
        if (state === "moving") out.moving++;
        else out.left++;
        out.coins.push({ kind, tokenId: coin.tokenId, amount: coin.amount, state });
      }
    }
    return out;
  }

  /**
   * Each move of the sweep (old words' pocket or float into the new one), newest first, the open ones read again: for
   * Wallet's Activity ("Moved $X from your old wallets to Private"). `kind`: the old wallet it came from ("private": into
   * the new private balance; "trade": into the new NEAR wallet). No old wallet, or no relay: none.
   */
  async oldWordsMoves(): Promise<(PocketMove & { kind: "private" | "trade" })[]> {
    const list = await this.stored();
    const old = list.find((w) => w.oldWords && w.chain === "near" && (w.kind === "private" || w.kind === "trade"));
    const to = list.find(isPocket) ?? list.find(isFloat);
    if (!old || !to || !this.o.floatRelay) return [];
    // one record for both old wallets: any one reads it (a resend of a signed move uses that move's own signature)
    const olds = list.filter((w) => w.oldWords && w.chain === "near" && (w.kind === "private" || w.kind === "trade"));
    return (await this.oldMoves(old, to).moves()).map((m) => ({ ...m, kind: olds.find((w) => m.id.startsWith(`pm-${sweepTag(w.id, m.sent.tokenId)}-`))?.kind === "trade" ? "trade" as const : "private" as const }));
  }

  private oldMoves(old: Stored, to: { address: string }): PocketMoves {
    return new PocketMoves({
      vault: this.o.vault, relay: this.o.floatRelay, ...(this.o.quoteKey ? { quoteKey: this.o.quoteKey } : {}),
      record: "old-words-sweep", recipientType: "CONFIDENTIAL_INTENTS",
      pocket: async () => ({ address: old.address, secret: () => this.secret(old) }),
      mainAccount: async () => to.address,
      balances: async () => this.heldBy(old.address, await this.secret(old)),
    });
  }

  private async tries(): Promise<Record<string, SweepTries>> {
    const raw = await this.o.vault.get(SWEEP_TRIES_RECORD);
    try {
      const v = raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  private triesWriting: Promise<unknown> = Promise.resolve();
  private editTries(f: (t: Record<string, SweepTries>) => Record<string, SweepTries>): Promise<void> {
    const next = this.triesWriting.then(async () => this.o.vault.put(SWEEP_TRIES_RECORD, new TextEncoder().encode(JSON.stringify(f(await this.tries())))));
    this.triesWriting = next.catch(() => undefined);
    return next;
  }

  /** `slot`: a trading wallet's place on its chain, 0–4 (none: 0); asking for a slot again gives the same wallet. */
  async create(kind: unknown, chain: unknown, slot?: unknown, site?: unknown): Promise<SubWallet> {
    if (kind === "site") return this.createSite(chain, site, slot);
    // One wallet per chain (D55): kind "chain" (or none) is that chain's current wallet, index 0 of its key path.
    if (kind === "chain" || kind === undefined) {
      if (slot !== undefined) throw new ProblemError(securityProblems.requestInvalid("a chain's wallet has no slot"));
      if (chain === "near") throw new ProblemError(securityProblems.requestInvalid("NEAR holds your private balance and your NEAR wallet's cash, not a chain wallet"));
      if (chain !== "sol" && chain !== "bsc" && chain !== "hood" && !BROWSER_EVM.includes(chain as EvmWalletChain)) throw new ProblemError(securityProblems.subwalletChain());
      return this.createCurrent(chain as Exclude<SubWallet["chain"], "near">);
    }
    if (!KINDS.includes(kind as SubWalletKind)) throw new ProblemError(securityProblems.requestInvalid("kind is chain, trade, browser, extension, pay or private"));
    const browserChain = BROWSER_EVM.includes(chain as EvmWalletChain);
    if (chain !== "sol" && chain !== "bsc" && chain !== "hood" && chain !== "near" && !browserChain) throw new ProblemError(securityProblems.subwalletChain());
    // NEAR holds two wallets, one of each: the private pocket (its balance sits in NEAR Confidential Intents), only ever
    // on NEAR, and Trade's float (float.ts), the balance its trading wallets are filled from.
    // and (3 Nov, Rhea trades) the NEAR coin wallet: a public account that trades NEAR coins on Rhea at chain speed
    if (chain === "near" ? kind !== "private" && kind !== "trade" && kind !== "browser" : kind === "private") {
      throw new ProblemError(securityProblems.requestInvalid("On NEAR there are only your private balance, your NEAR wallet's cash and your NEAR coin wallet"));
    }
    const float = kind === "trade" && chain === "near";
    const nearCoins = kind === "browser" && chain === "near";
    const trading = kind === "trade" && chain !== "near";
    if (slot !== undefined && (!trading || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= SLOTS)) {
      throw new ProblemError(securityProblems.requestInvalid(`a wallet's number is 0 to ${SLOTS - 1}`));
    }
    if (kind === "private" && (await this.stored()).some(isPocket)) throw new ProblemError(securityProblems.requestInvalid("there is one Private balance"));
    // Ethereum, Base, Gnosis and Arbitrum hold the Browser wallet, and on Gnosis the card's own wallet (D29).
    const card = kind === "pay" && chain === "gnosis";
    if (browserChain && kind !== "browser" && !card) throw new ProblemError(securityProblems.requestInvalid("Ethereum, Base, Gnosis and Arbitrum hold their own chain wallet (and, on Gnosis, the card's wallet)"));
    // From the backup words when this phone has their hot root (hot-keys.ts: a restore makes the same one); on an older
    // account that hasn't had its words typed since, made on this phone as before.
    const root = await this.o.vault.get(HOT_ROOT);
    const fromWords = root ? hotSecret(root, kind as string, chain as string, trading ? ((slot as number | undefined) ?? 0) : 0) : null;
    const seed = fromWords ?? (chain === "sol" || chain === "near" ? crypto.getRandomValues(new Uint8Array(32)) : secp256k1.utils.randomSecretKey());
    const label = float ? "Your NEAR wallet's cash" : nearCoins ? NEAR_COIN_WALLET : kind === "trade" ? "Chain wallet" : kind === "private" ? "Private pocket" : card ? "Card wallet" : kind === "browser" ? "Apps wallet" : `${String(kind).replace(/^./, (c) => c.toUpperCase())} wallet`;
    // One Browser wallet per chain, one card wallet and one float: asking again gives the same one.
    return this.add(kind as SubWalletKind, seed, "direct", label, chain as SubWallet["chain"], browserChain || float || nearCoins, trading ? ((slot as number | undefined) ?? 0) : undefined, fromWords !== null);
  }

  /**
   * A site's own wallet on one of its networks (site-wallets.ts): from the backup words at the site's own place (kind
   * "site", the site's index), so a restore brings it back; on an account whose words aren't on this phone, made here.
   * One per site and network: asking again gives the same one (after new words, the new words' one).
   */
  /**
   * Audit C1 (3 Nov): the connected site's own wallet on this chain, made on first connect: a listed site's fixed wallet
   * (SITE_WALLETS), else one of its own for exactly this host (hot-keys.ts kind "host"), never a shared chain wallet.
   * `site` is { origin } of the https page that asked (on the phone, WebKit's, IsolatedCore.swift). An unlisted host's
   * wallet never signs with no sheet: every transaction it signs asks on the one-tap sheet.
   */
  async siteFor(site: unknown, chain: unknown): Promise<SubWallet> {
    const host = siteHost(site);
    if (!host) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    const listed = SITE_WALLETS.find((s) => !s.agent && s.hosts.includes(host));
    const id = listed ? listed.site : hostSite(host);
    if (!id) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    return this.createSite(chain, id, undefined);
  }

  /**
   * AgentZero's own window (ruling a, b): the wallet it signs in with is AgentZero's pocket (site-wallets.ts "agentzero",
   * its own place on the key path), never the person's SOL wallet or one of their site wallets, and only on
   * AGENT_SIGN_IN_HOSTS, on Solana. The Browser's engine only (the phone's host says which window asked).
   */
  async agentSiteFor(site: unknown, chain: unknown, app?: string): Promise<SubWallet> {
    if (app !== undefined && app !== "browser") throw new ProblemError(securityProblems.requestNotAllowed("Only the Browser asks for AgentZero's sign-in wallet."));
    const host = siteHost(site);
    if (!host) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    if (!AGENT_SIGN_IN_HOSTS.includes(host)) throw new ProblemError(securityProblems.subwalletRefused(`AgentZero signs in only to ${AGENT_SIGN_IN_HOSTS.join(" and ")}.`));
    if (chain !== "sol") throw new ProblemError(securityProblems.requestInvalid("AgentZero's wallet signs in on Solana only."));
    return this.createSite("sol", "agentzero", undefined);
  }

  private createSite(chain: unknown, site: unknown, slot: unknown): Promise<SubWallet> {
    const s = siteWallet(site);
    if (!s) throw new ProblemError(securityProblems.requestInvalid(`site is one of ${SITE_WALLETS.map((x) => x.site).join(", ")}`));
    if (slot !== undefined) throw new ProblemError(securityProblems.requestInvalid("a site's wallet has no slot"));
    if (typeof chain !== "string" || !s.chains.includes(chain) || !(chain === "sol" || chain === "bsc" || chain === "hood" || BROWSER_EVM.includes(chain as EvmWalletChain))) {
      throw new ProblemError(securityProblems.requestInvalid(`${s.name}'s wallet is on ${s.chains.join(", ")}`));
    }
    const next = this.writing.then(async () => {
      const root = await this.o.vault.get(HOT_ROOT);
      // a listed site at its fixed index; any other host on the host kind's own path (audit C1)
      const seed = root ? hotSecret(root, s.host ? "host" : "site", chain, s.index) : null;
      root?.fill(0);
      const list = await this.stored();
      const current = await this.currentIds(list);
      // No words here: the one this phone made for the site (never one of replaced words).
      if (!seed) {
        const had = list.find((w) => w.kind === "site" && w.site === s.site && w.chain === chain && !w.oldWords);
        if (had) return this.public(had, undefined, current);
      }
      const secret = seed ?? (chain === "sol" ? crypto.getRandomValues(new Uint8Array(32)) : secp256k1.utils.randomSecretKey());
      const address = addressOf(chain as SubWallet["chain"], "direct", secret);
      const had = list.find((w) => w.address === address && w.chain === chain);
      // Audit pass 2, item 1: an unlisted host's place is 31 bits of a hash, so another host can be found that lands on
      // the same key (~2^31 tries). A record with this address made for another site is never handed over: the asking
      // host gets its own record or none.
      if (had && (had.kind !== "site" || had.site !== s.site)) throw new ProblemError(securityProblems.requestInvalid(`${s.name} can't have a wallet here`));
      if (had) return this.public(had, undefined, current);
      const id = `site-${s.host ? `h${s.index.toString(36)}` : s.site}-${chain}-${address.replace(/^0x/, "").slice(0, 6)}`;
      const words = seed !== null;
      if (!(words && this.o.hotKeysInMemory)) await this.o.vault.put(seedName(id), secret);
      const w: Stored = { id, kind: "site", site: s.site, chain: chain as SubWallet["chain"], address, label: s.agent ? s.name : `${s.name} wallet`, derive: "direct", slot: s.index, ...(words ? { words: true as const } : {}) };
      await this.save([...list, w]);
      return this.public(w, undefined, current);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /**
   * The chain's current wallet, made if it isn't listed yet. From the words: matched by its ADDRESS only (index 0 of the
   * current words), never by slot, so a slot-0 wallet of replaced words or of a random key is never taken for it. No
   * words' root (an account from before D43): the current one as listed, else a new one.
   */
  private createCurrent(chain: Exclude<SubWallet["chain"], "near">): Promise<SubWallet> {
    const kind = pathKind(chain);
    const next = this.writing.then(async () => {
      const list = await this.stored();
      const root = await this.o.vault.get(HOT_ROOT);
      const seed = root ? hotSecret(root, kind, chain, 0) : null;
      root?.fill(0);
      const slots = slotsOf(list);
      const current = await this.currentIds(list);
      if (!seed) {
        const had = list.find((w) => current.has(w.id) && w.chain === chain);
        if (had) return this.public(had, slots.get(had.id), current);
      }
      const secret = seed ?? (chain === "sol" ? crypto.getRandomValues(new Uint8Array(32)) : secp256k1.utils.randomSecretKey());
      const address = addressOf(chain, "direct", secret);
      const had = list.find((w) => w.address === address && w.chain === chain);
      if (had) return this.public(had, slots.get(had.id), current);
      const id = `${kind}-${chain}-${address.replace(/^0x/, "").slice(0, 6)}`;
      const words = seed !== null;
      if (!(words && this.o.hotKeysInMemory)) await this.o.vault.put(seedName(id), secret);
      const label = kind === "trade" ? "Chain wallet" : "Apps wallet";
      const w: Stored = { id, kind, chain, address, label, derive: "direct", ...(kind === "trade" ? { slot: 0 } : {}), ...(words ? { words: true as const } : {}) };
      const after = [...list, w];
      await this.save(after);
      return this.public(w, kind === "trade" ? 0 : undefined, await this.currentIds(after));
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  private add(kind: SubWalletKind, seed: Uint8Array, derive: Stored["derive"], label: string, chain: SubWallet["chain"] = "sol", single = false, slot?: number, words = false): Promise<SubWallet> {
    const next = this.writing.then(() => this.addNow(kind, seed, derive, label, chain, single, slot, words));
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async addNow(kind: SubWalletKind, seed: Uint8Array, derive: Stored["derive"], label: string, chain: SubWallet["chain"], single: boolean, slot?: number, words = false): Promise<SubWallet> {
    const address = addressOf(chain, derive, seed);
    const list = await this.stored();
    const slots = slotsOf(list);
    // A words wallet is matched by its address (D55): a slot or a kind matched alone could return the same place's wallet
    // of replaced words. The NEAR coin wallet keeps its one place across new words; the float is made again from them (audit 2).
    const existing = words
      ? list.find((w) => (w.address === address && w.chain === chain) || (single && chain === "near" && w.kind === kind && w.chain === chain && !(kind === "trade" && w.oldWords)))
      : list.find((w) => (w.address === address && w.chain === chain) || (single && w.kind === kind && w.chain === chain) || (slot !== undefined && w.kind === kind && w.chain === chain && slots.get(w.id) === slot));
    if (existing) return this.public(existing, slots.get(existing.id), await this.currentIds(list));
    const id = `${kind}-${chain}-${address.replace(/^0x/, "").slice(0, 6)}`;
    // The secret goes in before the list names it; a words wallet's, in a browser, is made again from the root instead.
    if (!(words && this.o.hotKeysInMemory)) await this.o.vault.put(seedName(id), seed);
    const w: Stored = { id, kind, chain, address, label, derive, ...(slot === undefined ? {} : { slot }), ...(words ? { words: true as const } : {}) };
    await this.save([...list, w]);
    return this.public(w, slot, await this.currentIds([...list, w]));
  }

  /**
   * Sign only: the app broadcasts. D143 refinement (approval-policy.ts hotNeedsApproval): with no sheet only the person's
   * own flow (Trade, an app, ZeroFee's own screens) or a known site's own wallet on its own page, inside the caps, after
   * the checks and two test runs that agree (Trade's own buy: one, B36). The person's own flow that fails a check is
   * refused, named; a site's request that isn't silent, or anything over a cap, gets the one-tap approve sheet (D143: Face ID is the Safe's).
   * `coin`: the coin an EVM trade is for, when its bytes don't name it. `app`: forApps' stamp (none: ZeroFee's screens).
   * `own` (OWN_SEND): the core's own plain transfer for Wallet's Send, never reachable from the bridge.
   * `ask` (decision H, product decision, 4 Nov): Trade's own quote its price checks flagged (TRADE_ASKS' keys). It counts only in
   * Trade's own flow (no site): after every check passes it puts the one-tap sheet up instead of a silent signature, and
   * the trade isn't counted against the silent cap. It can only add a sheet, never take one away.
   */
  async signTx(id: unknown, txB64: unknown, _why: unknown, coin?: unknown, _asker?: string, site?: unknown, app?: string, _symbol?: unknown, own?: typeof OWN_SEND, minSlot?: unknown, ask?: unknown): Promise<{ signedTx: string; checkedByOne?: true } | { declined: true }> {
    const w = await this.find(id);
    if (typeof txB64 !== "string") throw new ProblemError(securityProblems.requestInvalid("tx must be base64"));
    this.noteSlot(w, minSlot, app, site);
    // The page that asked, when a site asked (D29 wallet mode); the card's wallet answers only Gnosis Pay.
    const host = site === undefined ? undefined : siteHost(site);
    if (host === null) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    if (host && w.kind === "pay" && host !== CARD_SITE) throw new ProblemError(securityProblems.subwalletRefused(`The card's wallet signs only for Gnosis Pay (${CARD_SITE}).`));
    // AgentZero's pocket is refused here for every caller, whatever `app` says (P1): its own trades go through
    // agentPocketSign, which only the core's account.agent.pocketSign reaches.
    const bound = siteBinding(w, host);
    if (bound) throw new ProblemError(securityProblems.subwalletRefused(bound));
    // The private pocket signs its own NEP-413 intents, not transactions (that comes with its payment method).
    if (w.chain === "near") throw new ProblemError(securityProblems.subwalletRefused(`Your ${w.label.toLowerCase()} can't approve this kind of request.`));
    if (w.chain !== "sol") return this.signEvm(w, w.chain, txB64, coin, own, host, app);
    if (own === OWN_SEND) {
      // the core's own transfer (solTransferTx, sendPlain): only the wallet signs and pays; nothing else is in it
      const refusal = signableReason(txB64, w.address);
      if (refusal) throw new ProblemError(securityProblems.subwalletRefused(refusal));
      return { signedTx: signSolTx(txB64, await this.secret(w)) };
    }
    // a preflight's reads of these very bytes, by this caller, from this wallet, still fresh (used once): then the tap reads
    // nothing (cachedOnly); every check below runs again on them all the same
    const pre = this.takePreflight(w, txB64, app, host, this.solSlot(w))?.sol;
    const cachedOnly = pre !== undefined;
    const ownFlow = app === "trade" && host === undefined;
    // decision H: a flag Trade's own flow names asks on the sheet; a name the core doesn't know is refused, never signed silently
    if (ownFlow && ask !== undefined && !(typeof ask === "string" && Object.hasOwn(TRADE_ASKS, ask))) throw new ProblemError(securityProblems.requestInvalid("ask is one of unpriced, high-impact, wide-slippage"));
    const asked = ownFlow && typeof ask === "string" ? TRADE_ASKS[ask as keyof typeof TRADE_ASKS] : undefined;
    // rule 9a (audit, 5 Nov): every public node down (asked twice, silently) is said plainly, by the wallet the money is in;
    // nothing is signed (fail closed)
    const down = (e: unknown): never => { throw isSolPublicDown(e) ? new ProblemError(securityProblems.solPublicDown(walletName(w.label))) : e; };
    const reads = await (pre ? pre.catch(() => this.solReads(w, txB64, ownFlow)) : this.solReads(w, txB64, ownFlow)).catch(down);
    const { decoded, notCovered, checkedByOne, sim, out, value, unread } = await this.solCheck(w, txB64, reads).catch(down);
    await this.refuseOwnLink(w, decoded.transfers.map((t) => t.to));
    // The person's own flow (no site): what fails a check is refused by name, never signed blind and never asked
    // (review, 3 Nov). A site's request goes to the sheet instead when it isn't silent.
    if (notCovered && host === undefined) throw notSigned(notCovered, w);
    // Two test runs that agree; one is enough for Trade's own buy (B36, bounded by its bytes; review M1) and, below, for
    // Trade's own sale of a coin the market prices (the crawl, 4 Nov: selling all of MOGMAS put the sheet up when one node was busy)
    const tradeOwnOne = app === "trade" && host === undefined && w.kind === "trade" && decoded.swaps.length === 1;
    const tradeOwnBuy = tradeOwnOne && decoded.swaps[0]!.side === "buy";
    const tradeOwnSale = tradeOwnOne && decoded.swaps[0]!.side === "sell";
    // re-review B1 (3 Nov): a sale is worth what the coin sold is worth at the core's own market price, never only the SOL
    // its own pool gives back (a thin pool made by the asker would make a $3,000 bag a $2 sale). No price: the sheet. One
    // that brings back under 85 % of that price is a failed check (refused in the person's own flow, asked for a site).
    const marketSale = !notCovered && (sim.agreed || (checkedByOne && (tradeOwnBuy || tradeOwnSale))) ? await this.solSaleUsd(decoded, sim, w.address, cachedOnly) : undefined;
    // one server's sale: its worth for the cap is the market's price of the coins its BYTES sell (no server's figure), and
    // the signed floor (at least 80 % of the run's SOL back, sellRefusal) bounds what lands; no market price: the sheet
    const ran = sim.agreed || (checkedByOne && (tradeOwnBuy || (tradeOwnSale && !!marketSale)));
    // decision H (product decision, 4 Nov): Trade's own direct pump.fun curve sale stays silent even when the market has no price for
    // the coin yet (a fresh launch): see curveSaleUsd for the one narrow case
    const sale = marketSale === null && ownFlow && w.kind === "trade" && sim.agreed ? await this.curveSaleUsd(decoded, sim, w.address, cachedOnly) : marketSale;
    const why = notCovered ? asksBecause(notCovered) : !ran ? "Only one server could test it, so ZeroFee asks you." : sale === null ? "Its price couldn't be read, so ZeroFee asks you." : sale?.cheap ? (host === undefined ? (() => { throw notSigned(SALE_CHEAP, w); })() : asksBecause(SALE_CHEAP)) : (asked ?? (await this.hotGate(w, host, "sol", value, sale?.usd, cachedOnly)));
    // B36-F1: a trade one server checked says so on Trade's own line ("Checked by one server.")
    if (why === null) return { signedTx: signSolTx(txB64, await this.secret(w)), ...(checkedByOne ? { checkedByOne: true as const } : {}) };
    const [named, priceUsd] = await Promise.all([this.sheetCoins([...decoded.swaps.map((x) => x.coin), ...(sim.tokens ?? []).map((t) => t.mint)].filter((m): m is string => typeof m === "string"), cachedOnly), this.priceSoon("sol", cachedOnly)]);
    // decision C: a request with no trade in it is a send; to an outside address past the cap (a coin's transfer has no
    // dollar figure here, so it counts as past), Face ID
    const solSendTo = decoded.swaps.length ? [] : [...decoded.transfers.map((t) => t.to), ...decoded.tokenMoves.filter((m) => m.kind === "transfer").map((m) => m.to)];
    const solSendUsd = decoded.tokenMoves.some((m) => m.kind === "transfer") || priceUsd === null ? null : (Number(out) / 1e9) * priceUsd;
    const sheet = SubWallets.faceIdIf((await hotSheets()).solSheet({ w, older: await this.older(w), decoded, sim, out, unread, ...(host ? { host } : {}), ...(app ? { asker: app } : {}), why, priceUsd, coin: (m) => solNamedCoin(m) ?? named.get(m) }), await this.sendOutPastCap(solSendTo, solSendUsd));
    if (!(await this.o.approve(sheet).catch(() => false))) return { declined: true };
    return { signedTx: signSolTx(txB64, await this.secret(w)) };
  }

  /**
   * D143 refinement: may a checked hot-key signature go with no sheet? Null: yes, and its dollars are counted against the
   * wallet's caps. Else the reason the sheet asks: a site that isn't on its own known wallet (a site never gets the shared
   * chain wallets silently, review H1), no price, or past a cap (review M3; the Extension: its own session's caps).
   */
  private async hotGate(w: Stored, host: string | undefined, priceOf: "sol" | EvmWalletChain, value: bigint, atLeastUsd?: number, cachedOnly = false): Promise<string | null> {
    // a site: only a LISTED site's own wallet on its own page goes with no sheet (siteBinding holds it to its hosts); an
    // unlisted host's own wallet always asks (audit C1)
    const unlisted = isSiteWallet(w) && siteWallet(w.site)?.host === true;
    if (host !== undefined && hotNeedsApproval({ siteAsked: true, ownSiteWallet: isSiteWallet(w) && !unlisted, withinCaps: true, twoServers: true })) {
      return unlisted ? `${host} isn't a site ZeroFee knows, so ZeroFee asks you.` : `${host} asked to use one of your wallets, so ZeroFee asks you.`;
    }
    if (w.kind === "extension") {
      const s = this.sessions.get(w.id);
      const live = s && Date.now() < s.endsAt ? s : null;
      if (s && !live) this.endSession(w.id, "time");
      if (!live || value > live.perTx || live.spent + value > live.total) return "It's past your Extension's limits, so ZeroFee asks you.";
      live.spent += value;
      if (live.spent >= live.total) this.endSession(w.id, "total");
      return null;
    }
    const price = await this.hotPrice(priceOf, cachedOnly);
    const decimals = priceOf === "sol" ? 9 : 18;
    const usd = price ? (Number(value) / 10 ** decimals) * price : null;
    return this.capGate(usd === null ? null : Math.max(usd, atLeastUsd ?? 0));
  }
  /**
   * Re-review B1: what a Solana sale's coins are worth at the core's own market price (marketPrice, the relay's
   * GeckoTerminal read; decimals from the mint), and whether what comes back is under 85 % of it. Undefined: no sale. Null:
   * a sale whose coin or price can't be read (the sheet asks).
   */
  private solSaleUsd(decoded: { swaps: { side: string; coin?: string; inRaw: string }[] }, sim: { lamportsBefore: bigint; lamportsAfter: bigint; tokens?: { address: string; mint: string; before: bigint; after: bigint }[] }, wallet: string, cachedOnly = false): Promise<{ usd: number; cheap: boolean } | null | undefined> {
    const { mintDecimals } = this.o.sol;
    return this.saleUsd("sol", decoded.swaps, SubWallets.solBack(sim, wallet), 9, mintDecimals ? (c) => mintDecimals.call(this.o.sol, c) : undefined, cachedOnly);
  }
  /** What a Solana sale brings back, in lamports, by its test run: the wallet's own SOL, and what lands in its OWN
   *  wrapped-SOL account (PumpSwap and some Jupiter routes pay there), the same as SOL. Never any other account, whoever's it is. */
  private static solBack(sim: { lamportsBefore: bigint; lamportsAfter: bigint; tokens?: { address: string; mint: string; before: bigint; after: bigint }[] }, wallet: string): bigint {
    const wsol = ownTokenAccount(wallet, SOL.wsol);
    const wsolIn = (sim.tokens ?? []).filter((t) => t.address === wsol && t.mint === SOL.wsol && t.after > t.before).reduce((sum, t) => sum + (t.after - t.before), 0n);
    const net = sim.lamportsAfter - sim.lamportsBefore + wsolIn;
    return net > 0n ? net : 0n;
  }
  /**
   * Decision H (product decision, 4 Nov), the one case B1's market price can't
   * cover: Trade's own sale of one coin straight into pump.fun's bonding curve when the market has no price for it yet (a
   * fresh launch). Each coin has exactly one curve (the program holds it to the coin's own address), so the thin pool B1
   * guards against can't be made: the curve's answer IS the coin's price. It is worth what two agreeing test runs say
   * comes back, at the core's own SOL price, counted against the one cap as any sale is; and only when the signed floor
   * keeps at least 80 % of that (Trade's own SALE_FLOOR), so a sandwich after signing takes at most a fifth. Anything else
   * (another venue, two swaps, an unknown program, no SOL price, a lower floor) stays null: the one-tap sheet, as before.
   */
  private async curveSaleUsd(decoded: SolDecoded, sim: { lamportsBefore: bigint; lamportsAfter: bigint; tokens?: { address: string; mint: string; before: bigint; after: bigint }[] }, wallet: string, cachedOnly: boolean): Promise<{ usd: number; cheap: boolean } | null> {
    const s = decoded.swaps[0];
    if (decoded.swaps.length !== 1 || !s || s.venue !== "pump.fun" || s.side !== "sell" || !s.coin || decoded.unknownPrograms.length || !/^\d{1,20}$/.test(s.minOutRaw)) return null;
    const back = SubWallets.solBack(sim, wallet);
    if (back <= 0n || BigInt(s.minOutRaw) * 10n < back * 8n) return null;
    const sol = await this.hotPrice("sol", cachedOnly);
    return sol ? { usd: (Number(back) / 1e9) * sol, cheap: false } : null;
  }
  /** Re-review B1 on BNB Chain and Robinhood Chain: the same rule, the coin's decimals as the chain's own token read says. */
  private evmSaleUsd(chain: EvmChainName, swaps: { side: string; coin?: string; inRaw: string }[], proceeds: bigint): Promise<{ usd: number; cheap: boolean } | null | undefined> {
    return this.saleUsd(chain, swaps, proceeds, 18, async (c) => (await this.o.evm.token(chain, c).catch(() => undefined))?.decimals ?? null);
  }
  /**
   * The one shared rule (re-review B1): what a sale's coins are worth at the core's own market price (marketPrice: the
   * relay's GeckoTerminal read; decimals from the chain), and whether what comes back (`back`, in the chain's own coin at
   * `nativeDecimals`) is under 85 % of it. Undefined: no sale. Null: a coin, decimals or price that can't be read (the
   * one-tap sheet asks).
   */
  private async saleUsd(chain: EvmChainName | "sol", swaps: { side: string; coin?: string; inRaw: string }[], back: bigint, nativeDecimals: number, decimalsOf?: (coin: string) => Promise<number | null>, cachedOnly = false): Promise<{ usd: number; cheap: boolean } | null | undefined> {
    const sells = swaps.filter((x) => x.side === "sell");
    if (!sells.length) return undefined;
    const market = this.o.marketPrice;
    if (!market || !decimalsOf || sells.some((x) => !x.coin || !/^\d{1,78}$/.test(x.inRaw))) return null;
    const [values, nativeUsd] = await Promise.all([
      Promise.all(sells.map(async (x) => {
        const coin = chain === "sol" ? x.coin! : x.coin!.toLowerCase();
        const [usd, decimals] = await Promise.all([this.coinAsk(`${chain}|${coin}`, () => market(chain, coin), cachedOnly), this.coinAsk(`dec|${chain}|${coin}`, () => decimalsOf(x.coin!), cachedOnly)]);
        return usd && usd > 0 && decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 30 ? (Number(x.inRaw) / 10 ** decimals) * usd : null;
      })),
      this.hotPrice(chain as "sol" | EvmWalletChain, cachedOnly),
    ]);
    if (values.some((v) => v === null || !Number.isFinite(v)) || !nativeUsd) return null;
    const usd = (values as number[]).reduce((a, b) => a + b, 0);
    // a sale worth under a cent can't be undersold enough to matter (and its pool's rounding would read as cheap)
    return { usd, cheap: usd >= 0.01 && (Number(back) / 10 ** nativeDecimals) * nativeUsd < usd * 0.85 };
  }
  /**
   * Audit C1 (3 Nov): the ONE rolling cap over every hot-key signature that goes with no sheet, whichever wallet signs
   * and whichever app asked (on the phone the app id is the page's own claim, so the cap carries that risk). Null: within
   * it, and counted now (one vault write, as FloatGuard). Else why the one-tap sheet asks. A record that can't be read
   * counts as a full day, never an empty one.
   */
  private capGate(usd: number | null): Promise<string | null> {
    if (usd === null || !Number.isFinite(usd) || usd < 0) return Promise.resolve("Its price couldn't be read, so ZeroFee asks you.");
    if (usd > HOT_CAP_USD.perTrade + FEE_ROOM_USD) return Promise.resolve(`It's over $${HOT_CAP_USD.perTrade}, so ZeroFee asks you.`);
    // D157 review L2: under one lock for the whole origin too (originLock), so two open panels count one day
    return this.turn(HOT_SPENT, () => originLock(HOT_SPENT, async () => {
      const now = Date.now();
      const raw = await this.o.vault.get(HOT_SPENT);
      let day: [number, number][];
      try {
        const kept = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { all?: unknown }).all : [];
        if (!Array.isArray(kept)) throw new Error("not a list");
        // a record dated ahead of now (a clock set back) still counts until a day after its date: never dropped
        day = (kept as [number, number][]).filter(([at, n]) => typeof at === "number" && typeof n === "number" && n >= 0 && now - at < DAY_MS);
      } catch {
        day = [[now, HOT_CAP_USD.perDay]];
      }
      if (day.reduce((sum, [, n]) => sum + n, 0) + usd > HOT_CAP_USD.perDay) return `It's past $${HOT_CAP_USD.perDay} in a day, so ZeroFee asks you.`;
      await this.o.vault.put(HOT_SPENT, utf8(JSON.stringify({ all: [...day, [now, Math.round(usd * 100) / 100]] })));
      return null;
    }));
  }
  /**
   * Trade's door before the tap (review, 3 Nov): will a no-sheet signature of `usd` dollars ask?
   * From the one cap (capGate), read only: nothing is counted. `asks`: over the per-tap cap, past what is left today, or
   * no figure; `leftTodayUsd`: the day's $500 less what went with no sheet in the last 24 hours; `perTapUsd`: $100.
   */
  async capCheck(usd: unknown): Promise<{ asks: boolean; leftTodayUsd: number; perTapUsd: number }> {
    const now = Date.now();
    let spent = HOT_CAP_USD.perDay;
    try {
      const raw = await this.o.vault.get(HOT_SPENT);
      const kept = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { all?: unknown }).all : [];
      if (Array.isArray(kept)) spent = (kept as [number, number][]).filter(([at, n]) => typeof at === "number" && typeof n === "number" && n >= 0 && now - at < DAY_MS).reduce((sum, [, n]) => sum + n, 0);
    } catch {
      // a record that can't be read counts as a full day (as capGate)
    }
    const leftTodayUsd = Math.max(0, Math.floor((HOT_CAP_USD.perDay - spent) * 100) / 100);
    const n = typeof usd === "number" ? usd : typeof usd === "string" && /^\d{1,9}(\.\d{1,6})?$/.test(usd) ? Number(usd) : NaN;
    const asks = !(Number.isFinite(n) && n >= 0) || n > HOT_CAP_USD.perTrade + FEE_ROOM_USD || n > leftTodayUsd;
    return { asks, leftTodayUsd, perTapUsd: HOT_CAP_USD.perTrade };
  }
  /** The coins a hot key's sheet names (a real-money run, 3 Nov): each one's own symbol and decimals as the
   *  core reads them from the chain (SolChain.mintSymbol, mintDecimals), kept for the session; never the caller's word.
   *  Only on the sheet's path (no silent trade waits on it), each read at most 1.5 s. Display only. A symbol that copies a
   *  coin ZeroFee lists (USDC on another mint) isn't said. */
  private async sheetCoins(mints: string[], cachedOnly = false): Promise<Map<string, { symbol: string; decimals: number }>> {
    const { mintSymbol, mintDecimals } = this.o.sol;
    const out = new Map<string, { symbol: string; decimals: number }>();
    if (!mintSymbol || !mintDecimals) return out;
    const taken = new Set(["SOL", "WSOL", ...Object.values(SOL_NAMED_COINS).map((c) => c.symbol.toUpperCase())]);
    await Promise.all([...new Set(mints)].filter((m) => !solNamedCoin(m) && m !== SOL.wsol).map(async (m) => {
      let kept = this.coinNames.get(m);
      // a preflighted tap reads nothing: only a name already kept is said
      if (!kept && cachedOnly) return;
      if (!kept) {
        const read = Promise.all([mintSymbol.call(this.o.sol, m), mintDecimals.call(this.o.sol, m)]).then(([symbol, decimals]) => (symbol && decimals !== null && !taken.has(symbol.toUpperCase()) ? { symbol, decimals } : null), () => null);
        kept = new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 1500);
          void read.then((v) => (clearTimeout(t), resolve(v)));
        });
        // a read that failed or ran out is asked again next sheet; one that answered is kept
        void kept.then((v) => (v ? undefined : this.coinNames.delete(m)));
        this.coinNames.set(m, kept);
      }
      const v = await kept;
      if (v) out.set(m, v);
    }));
    return out;
  }
  /** Over the one cap (capGate), a hot key's own send asks: the one-tap sheet (D143), the cause first. False: not now. */
  /**
   * Decision C (4 Nov): the person's own address, where money past the cap may still go on one tap: one of their
   * wallets here whose key was never shown (a shown key may be someone else's now, so that wallet counts as outside), or
   * their Safe's own account. EVM addresses in any letter case; every other kind exactly.
   */
  private async ownPayee(address: string): Promise<boolean> {
    const evm = /^0x[0-9a-fA-F]{40}$/.test(address);
    const same = (a: string) => (evm ? a.toLowerCase() : a);
    if ((await this.stored()).some((x) => !x.keyExported && same(x.address) === same(address))) return true;
    const main = await Promise.resolve(this.o.mainAccount?.()).catch(() => null);
    return typeof main === "string" && main === address;
  }
  /** Decision C: a send (a request with no trade in it) to any outside address, past the per-trade cap or with no
   *  dollar figure, asks Face ID. A trade, or a send only to the person's own wallets, stays one tap. */
  private async sendOutPastCap(to: (string | undefined)[], usd: number | null): Promise<boolean> {
    if (usd !== null && Number.isFinite(usd) && usd >= 0 && usd <= HOT_CAP_USD.perTrade) return false;
    for (const a of to) if (typeof a === "string" && !(await this.ownPayee(a))) return true;
    return false;
  }
  /** The same sheet asking Face ID instead of one tap (no `tap`), when `faceId`. */
  private static faceIdIf(sheet: PlainWords, faceId: boolean): PlainWords {
    if (!faceId) return sheet;
    const { tap: _tap, ...asksFaceId } = sheet;
    return asksFaceId;
  }
  /** `faceId` (decision C, 4 Nov): the sheet asks Face ID instead of one tap (no `tap`): a send to an outside
   *  address over the cap. */
  private capSheet(title: string, lines: string[], why: string, asker: string | undefined, amount?: string, faceId = false): Promise<boolean> {
    return this.o.approve({ title, lines, warnings: [{ kind: "large-amount", text: why }], effect: [], ...(amount ? { amount } : {}), ...(asker ? { asker } : {}), ...(faceId ? {} : { tap: true as const }) }).catch(() => false);
  }
  /**
   * QA's ruling (5 Nov; supersedes decision C's "under the cap stays instant" for sends out): a Send from a
   * trading wallet to an OUTSIDE address (ownPayee false: not one of the person's wallets whose key was never shown, nor
   * their Safe) asks Face ID every time, at any amount; on the web the password (decision A). The sheet says the full
   * address, what goes, what they get and the fee, before Face ID, from 1Click's signed dollars only. Never counted
   * against the no-sheet cap (it has a sheet). False: declined, nothing moves.
   */
  private outsideSheet(from: string, to: string, inUsd: string | undefined, outUsd: string | undefined, amount: string, network: string | null): Promise<boolean> {
    return this.o.approve({ title: OUTSIDE_WORDS.title(from), ...outsideLines(to, inUsd, outUsd, network), effect: [], amount, asker: "wallet" }).catch(() => false);
  }
  /** The chain's own coin in dollars at the core's own price for the caps: ETH on Ethereum, Base and Arbitrum is ETH (read
   *  as Robinhood Chain's ETH), Gnosis' xDAI is a dollar. Null: none now (the sheet asks). */
  private hotPrice(chain: "sol" | EvmWalletChain, cachedOnly = false): Promise<number | null> {
    if (chain === "gnosis") return Promise.resolve(1);
    return this.priceSoon(chain === "eth" || chain === "base" || chain === "arb" ? "hood" : chain, cachedOnly);
  }

  /** A sale coin's market price or decimals (B1), asked now or kept 30 s; a failure is no figure and is asked again next
   *  time. `cachedOnly` (a preflighted tap): only what is kept, never a new read. */
  private coinAsk(key: string, read: () => Promise<number | null>, cachedOnly: boolean): Promise<number | null> {
    const now = Date.now();
    let kept = this.coinAsks.get(key);
    const fresh = kept && now - kept.at <= 30_000 && now >= kept.at;
    if (!fresh && cachedOnly) return Promise.resolve(null);
    if (!fresh) {
      kept = { at: now, ask: Promise.resolve().then(read).then((v) => (typeof v === "number" && Number.isFinite(v) ? v : null), () => null) };
      const mine = kept;
      void mine.ask.then((v) => v === null && this.coinAsks.get(key) === mine && this.coinAsks.delete(key));
      this.coinAsks.set(key, kept);
      while (this.coinAsks.size > 256) this.coinAsks.delete(this.coinAsks.keys().next().value!);
    }
    return kept!.ask;
  }

  /**
   * Speed (Trade, the test real-money run 3 Nov): Trade's own Solana transaction's NETWORK READS, made ahead of the tap
   * (solReads: the blockhash, the tables, the two-node test run, the route's programs; for a sale, its coins' market
   * price and decimals; SOL's price), kept for one signTx of these same bytes within PREFLIGHT_MS. Only Trade's own trade
   * wallets and calls (no site). It signs nothing, checks nothing that counts and charges no cap: the tap checks it all
   * again on these reads. `ok`: the reads were made.
   */
  /** The NEAR coin wallet (Rhea trades, 3 Nov), made from the words at its one place if it isn't yet. */
  async nearCoinWallet(): Promise<SubWallet> {
    return this.create("browser", "near");
  }

  /** The NEAR coin wallet's door (near-coin.ts), loaded with its first call; it borrows only these of SubWallets. */
  private nearCtx(): import("./near-coin.ts").NearCoinCtx {
    return { o: this.o, nonces: this.nearNonces, turn: (k, run) => this.turn(k, run), wallet: () => this.nearCoinWallet(), find: (id) => this.find(id), secret: (w) => this.secret(w as Stored), priceSoon: (c) => this.priceSoon(c), capGate: (usd) => this.capGate(usd) };
  }
  /** The last nonce the NEAR coin wallet's key signed on this phone (near-coin.ts). */
  private readonly nearNonces = new Map<string, bigint>();
  /** A NEAR coin trade on Rhea (product decision, 3 Nov; amends D96): near-coin.ts nearTrade. */
  async nearTrade(ask: unknown): Promise<NearSignedAnswer> {
    if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
    return (await import("./near-coin.ts")).nearTrade(this.nearCtx(), ask);
  }
  /** A coin's (or wNEAR's) account in the NEAR coin wallet (review M2): near-coin.ts nearRegister. */
  async nearRegister(coin: unknown, poolId?: unknown): Promise<NearSignedAnswer> {
    if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
    return (await import("./near-coin.ts")).nearRegister(this.nearCtx(), coin, poolId);
  }
  /** A NEAR coin trade on the wallet's own Rhea balance, one call (the 2 s rule): near-coin.ts nearRheaSwap. */
  async nearRheaSwap(ask: unknown): Promise<NearSignedAnswer> {
    if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
    return (await import("./near-coin.ts")).nearRheaSwap(this.nearCtx(), ask);
  }
  /** "Ready NEAR for trading": the wallet's NEAR into its own account in Rhea, sent by the core: near-coin.ts nearRheaAdd. */
  async nearRheaAdd(amount: unknown): Promise<{ hashes: string[]; amount: string }> {
    if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
    return (await import("./near-coin.ts")).nearRheaAdd(this.nearCtx(), amount);
  }
  /** The NEAR coin wallet, read at a block two nodes agree on (Home's own row): near-coin.ts nearCoinBalance. */
  async nearCoinBalance(): Promise<{ id: string; address: string; label: string; nearYocto: string; wnearYocto: string; rheaYocto: string; roomYocto: string; movableYocto: string; usd: number | null; open: boolean; line?: string }> {
    return (await import("./near-coin.ts")).nearCoinBalance(this.nearCtx());
  }

  /** Spending → the NEAR coin wallet, and back (D153/D70: only through NEAR Confidential; float-moves.ts). */
  floatNearOut(amount: unknown, key: unknown, usd?: unknown): Promise<FloatMove | { declined: true }> {
    if (!NEAR_GATE.open) return Promise.reject(new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED)));
    return this.floatMoves.nearOut(amount, key, usd);
  }
  floatNearIn(amount: unknown, key: unknown, usd?: unknown): Promise<FloatMove | { declined: true }> {
    if (!NEAR_GATE.open) return Promise.reject(new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED)));
    return this.floatMoves.nearIn(amount, key, usd);
  }

  /** `coin`, `before` (BNB Chain and Robinhood Chain): the coin signTx will be told, and Trade's own earlier steps of the
   *  same trade not signed yet (a sale's approve), base64, in order: the test run runs it after them. */
  async preflight(id: unknown, txB64: unknown, app?: string, site?: unknown, minSlot?: unknown, coin?: unknown, before?: unknown): Promise<{ ok: boolean }> {
    if (typeof txB64 !== "string" || app !== "trade" || site !== undefined) return { ok: false };
    const w = await this.find(id);
    if (w.kind !== "trade") return { ok: false };
    if (w.chain !== "sol") return w.chain !== "near" && isTradeEvm(w.chain) ? this.evmPreflight(w, w.chain, txB64, coin, before) : { ok: false };
    this.noteSlot(w, minSlot, app, site);
    const key = this.preflightKey(w, txB64, app, undefined);
    // the slot these reads are held to: a tap after a later landed trade reads again (takePreflight)
    const slot = this.solSlot(w) ?? 0;
    const reads = this.solReads(w, txB64, true);   // app "trade", no site, its trading wallet: checked above
    this.preflights.set(key, { at: Date.now(), sol: reads, minSlot: slot });
    while (this.preflights.size > PREFLIGHT_MAX) this.preflights.delete(this.preflights.keys().next().value!);
    try {
      const r = await reads;
      // warm what the tap's checks read (kept 30 s): SOL's price, and a sale's coins' market price and decimals (B1)
      const decoded = decodeSolTx(txB64, r.tables);
      const { mintDecimals } = this.o.sol;
      const market = this.o.marketPrice;
      // the coins' own names, should the tap's one-tap sheet be needed (phone test, 3 Nov: a preflighted sale's sheet
      // said "an unnamed coin" for ANSEM, since the tap reads nothing new): asked now, kept for the session, never awaited
      // here (a silent trade never waits on a name)
      void this.sheetCoins([...decoded.swaps.map((x) => x.coin), ...(r.sim.tokens ?? []).map((t) => t.mint)].filter((m): m is string => typeof m === "string")).catch(() => undefined);
      // one kept so long it would be gone before the tap can use it is asked again now, as on BNB Chain and Robinhood Chain
      // (product decision, 4 Nov: a tap reads nothing new, so a figure that aged past 30 s between this preflight and the tap was "no
      // price", and the sale or buy put up the one-tap sheet: "Its price couldn't be read")
      const stale = (m: Map<string, { at: number }>, k: string) => { const x = m.get(k); if (x && Date.now() - x.at > 30_000 - PREFLIGHT_MS) m.delete(k); };
      stale(this.priceAsks, "sol");
      for (const x of decoded.swaps) if (x.side === "sell" && x.coin) for (const k of [`sol|${x.coin}`, `dec|sol|${x.coin}`]) stale(this.coinAsks, k);
      await Promise.all([
        this.priceSoon("sol"),
        ...decoded.swaps.filter((x) => x.side === "sell" && x.coin).flatMap((x) => [
          market ? this.coinAsk(`sol|${x.coin}`, () => market("sol", x.coin!), false) : Promise.resolve(null),
          mintDecimals ? this.coinAsk(`dec|sol|${x.coin}`, () => mintDecimals.call(this.o.sol, x.coin!), false) : Promise.resolve(null),
        ]),
      ]);
      return { ok: true };
    } catch {
      if (this.preflights.get(key)?.sol === reads) this.preflights.delete(key);
      return { ok: false };
    }
  }
  /**
   * Speed (4 Nov: a Robinhood Chain sale's tap was 1.2 to 3 s of reads): Trade's own BNB Chain or Robinhood Chain
   * transaction's NETWORK READS made ahead of the tap (evmReads: the nonce, the two-node test run, the trade's reads, the
   * reference; the chain's price, a sale's coins' market price and decimals), kept for one signTx of these bytes and this
   * coin within PREFLIGHT_MS. It signs nothing, checks nothing that counts and charges no cap: signEvm checks it all again.
   */
  private async evmPreflight(w: Stored, chain: EvmChainName, txB64: string, coin: unknown, before: unknown): Promise<{ ok: boolean }> {
    let steps: EvmStep[];
    try {
      if (before !== undefined && (!Array.isArray(before) || before.length > PREFLIGHT_BEFORE_MAX || before.some((b) => typeof b !== "string"))) return { ok: false };
      steps = ((before ?? []) as string[]).map((b) => {
        const ok = evmSignable(b, chain);
        if ("refusal" in ok) throw new Error(ok.refusal);
        const t = parseTx(ok.bytes);
        return { nonce: t.nonce, call: evmCallOf(w.address, t) };
      });
    } catch {
      return { ok: false };
    }
    const key = this.preflightKey(w, evmKeyed(txB64, coin), "trade", undefined);
    const reads = this.evmReads(w, chain, txB64, coin, steps);
    this.preflights.set(key, { at: Date.now(), evm: reads, after: new Set(steps.map(evmStepKey)), minSlot: 0 });
    while (this.preflights.size > PREFLIGHT_MAX) this.preflights.delete(this.preflights.keys().next().value!);
    try {
      const r = await reads;
      // warm what the tap's checks read (kept 30 s): the chain's price (the caps), a sale's coins' market price and
      // decimals (B1). One kept so long it would be gone before the tap can use it is asked again now.
      const d = this.tradeFactsOf(w, chain, txB64, coin, r.trade).d;
      const stale = (m: Map<string, { at: number }>, k: string) => { const x = m.get(k); if (x && Date.now() - x.at > 30_000 - PREFLIGHT_MS) m.delete(k); };
      stale(this.priceAsks, chain);
      for (const x of d.swaps) if (x.side === "sell" && x.coin) for (const k of [`${chain}|${x.coin.toLowerCase()}`, `dec|${chain}|${x.coin.toLowerCase()}`]) stale(this.coinAsks, k);
      await Promise.all([this.hotPrice(chain), this.evmSaleUsd(chain, d.swaps, r.sim.nativeIn ?? 0n)]);
      return { ok: true };
    } catch {
      if (this.preflights.get(key)?.evm === reads) this.preflights.delete(key);
      return { ok: false };
    }
  }
  /** The network reads signEvm's checks compute from (a preflight's): the nonce, the two-node test run after this
   *  wallet's earlier unlanded transactions and `before` (Trade's own earlier steps of this trade), the trade's reads and,
   *  for a route that chose its pools, the reference. */
  private async evmReads(w: Stored, chain: EvmChainName, txB64: string, coin: unknown, before: EvmStep[]): Promise<EvmReads> {
    const ok = evmSignable(txB64, chain);
    if ("refusal" in ok) throw new ProblemError(securityProblems.subwalletRefused(ok.refusal));
    const t = parseTx(ok.bytes);
    const evm = this.o.evm;
    const trade = this.tradeReads(w, chain, txB64, coin);
    trade.catch(() => undefined);
    // the reference (tradeRefusal): only for a route that chose its pools, read beside the test run
    const reference = trade.then((r) => {
      const s = this.tradeFactsOf(w, chain, txB64, coin, r).d.swaps[0];
      // the same reference tradeRefusal would read: the market's price only through a middle coin or a hooked pool
      const marketOnly = s?.path?.length === 3 || (s?.hooks !== undefined && !/^0x0{40}$/.test(s.hooks));
      return s && s.coin && (s.hooks !== undefined || s.executor !== undefined || s.path?.length === 3) ? { out: this.referenceOut(chain, s, r.infos.get(s.coin)?.decimals, marketOnly).catch(() => null) } : undefined;
    });
    reference.catch(() => undefined);
    const [next, head] = await Promise.all([evm.nonce(chain, w.address), evm.head ? evm.head(chain).catch(() => null) : Promise.resolve(null)]);
    const { ran, seq } = this.evmEarlier(w, t.nonce, next, before);
    const sim = await evm.simulate(chain, [...ran.map((x) => x.call), evmCallOf(w.address, t)], head);
    const ref = await reference;
    return { next, seq, sim, trade: await trade, ...(ref ? { reference: await ref.out } : {}) };
  }
  private preflightKey(w: Stored, txB64: string, app: string | undefined, host: string | undefined): string {
    return `${w.id}|${app ?? ""}|${host ?? ""}|${hexOf(sha256(utf8(txB64)))}`;
  }
  /** This signTx's preflight reads, if fresh for these exact bytes, this caller, this site and this wallet, and held to
   *  at least the wallet's last landed slot now (`minSlot`: reads from before a later landed trade are read again); taken once. */
  private takePreflight(w: Stored, txB64: string, app: string | undefined, host: string | undefined, minSlot = 0): { sol?: Promise<SolReads>; evm?: Promise<EvmReads> } | undefined {
    const key = this.preflightKey(w, txB64, app, host);
    const p = this.preflights.get(key);
    this.preflights.delete(key);
    return p && Date.now() - p.at <= PREFLIGHT_MS && Date.now() >= p.at && p.minSlot >= minSlot ? p : undefined;
  }
  /** Trade's `minSlot` (its last landed trade's slot on this wallet): a positive whole number, only from Trade's own call
   *  for its own Solana trading wallet; kept for the wallet, the highest wins (solSlots). */
  private noteSlot(w: Stored, minSlot: unknown, app: string | undefined, site: unknown): void {
    if (minSlot === undefined) return;
    if (typeof minSlot !== "number" || !Number.isSafeInteger(minSlot) || minSlot <= 0) throw new ProblemError(securityProblems.requestInvalid("minSlot is a slot number"));
    if (app !== "trade" || site !== undefined || w.chain !== "sol" || w.kind !== "trade") throw new ProblemError(securityProblems.requestInvalid("minSlot is for Trade's own Solana trades"));
    const had = this.solSlot(w);
    if (had === undefined || minSlot >= had) this.solSlots.set(w.id, { slot: minSlot, at: Date.now() });
  }
  /** The wallet's last landed trade's slot, while it holds (SOL_SLOT_MS); undefined: none. */
  private solSlot(w: Stored): number | undefined {
    const s = this.solSlots.get(w.id);
    if (s && Date.now() - s.at <= SOL_SLOT_MS && Date.now() >= s.at) return s.slot;
    if (s) this.solSlots.delete(w.id);
    return undefined;
  }
  /** A wallet that signs moves its balances: no read of it made before then is used again, but an EVM test run that ran
   *  after this very step (`signing`, evmStepKey: a sale's approve before its swap). It keeps that once. */
  private dropPreflights(w: Stored, signing?: string): void {
    for (const [k, p] of [...this.preflights]) {
      if (!k.startsWith(`${w.id}|`)) continue;
      if (signing !== undefined && p.after?.delete(signing)) continue;
      this.preflights.delete(k);
    }
  }

  /** A Solana transaction for this wallet, read and run on two nodes, and why a session can't cover it (null: it can). */
  private async solPrepare(w: Stored, txB64: string) {
    return this.solCheck(w, txB64, await this.solReads(w, txB64));
  }

  /** The network reads a Solana transaction's check needs (preflight keeps them; solCheck computes from them). */
  /** `ownFlow`: Trade's own request (app "trade", no site): its one buy from its trading wallet may be checked by one
   *  server (B36), so its test run doesn't wait for a slow second node (SolChain.simulate firstFull). */
  private async solReads(w: Stored, txB64: string, ownFlow = false): Promise<SolReads> {
    const refusal = signableReason(txB64, w.address);
    if (refusal) throw new ProblemError(securityProblems.subwalletRefused(refusal));
    const tx = decodeTx(txB64);
    // ST7 (the buy sheet in under 2 s): the blockhash check runs beside the tables and the test run, never before them
    // (three node round trips in a row were most of the wait). It is still answered first: an expired transaction is
    // refused, nothing asked and nothing signed, as before; a failed read throws as before.
    const fresh = settled(this.o.sol.blockhashValid(tx.blockhash));
    const run = settled(
      (async () => {
        // each table's entries this transaction uses (its highest index + 1): a table already checked that covers them is no read
        const tables = tx.lookups.length ? await this.o.sol.lookupTables(tx.lookups.map((l) => l.table), tx.lookups.map((l) => Math.max(-1, ...l.writable, ...l.readonly) + 1)) : [];
        const decoded = decodeSolTx(txB64, tables);
        // The test run also reads every token account it writes to, so what happens to the wallet's coins is known, not
        // only its SOL (audit SOL-1, SOL-2, SOL-3).
        let watch: string[] = [];
        let unread = false;
        try {
          const writable = [...new Set(decompile(tx, tables).instructions.flatMap((i) => i.keys.filter((k) => k.isWritable && k.pubkey !== w.address).map((k) => k.pubkey)))];
          // All of them, or the session doesn't cover it (the fix review's lead: a coin account past the ones read could
          // be emptied unseen, behind 33 of the wallet's own accounts made first).
          unread = writable.length > SOL_WATCH_MAX;
          watch = writable.slice(0, SOL_WATCH_MAX);
        } catch {
          // its accounts couldn't be read from the bytes: the test run can't watch them, so no session covers it (review ST7)
          watch = [];
          unread = true;
        }
        // review M2: a Jupiter route's executable accounts are read beside the test run (none for any other venue); the
        // answers are kept, so the check can ask them again with no read (a preflighted tap)
        const answers = new Map<string, boolean>();
        let execFailed = false;
        const reader = this.o.sol.executable;
        const ask = reader
          ? async (k: string[]) => {
            try {
              const r = await reader.call(this.o.sol, k);
              if (Array.isArray(r) && r.length === k.length) k.forEach((x, i) => typeof r[i] === "boolean" && answers.set(x, r[i] as boolean));
              else execFailed = true;
              return r;
            } catch (e) {
              execFailed = true;
              throw e;
            }
          }
          : async (k: string[]) => k.map(() => true);
        // the same test as signTx's tradeOwnBuy: one buy, Trade's own, its trading wallet, decided SIM_GRACE_MS after the first
        // full answer; Trade's own sale waits longer for a second (SIM_SALE_GRACE_MS: a fresh coin's curve sale needs two),
        // never for a busy node's every retry (the crawl, 4 Nov); anything else waits for both nodes
        const one = ownFlow && w.kind === "trade" && decoded.swaps.length === 1 ? decoded.swaps[0]!.side : undefined;
        const oneMay = one === "buy" ? { firstFull: true } : one === "sell" ? { firstFull: true, graceMs: SIM_SALE_GRACE_MS } : {};
        // what the trade pays the wallet, read from its own bytes (a buy's coin, a sale's wrapped SOL): the only coins two
        // nodes a few slots apart may differ on (coinsAgree)
        const received = [...new Set(decoded.swaps.map((x) => (x.side === "buy" ? x.coin : SOL.wsol)).filter((m): m is string => typeof m === "string"))];
        // after the wallet's last landed trade: on state at or after its slot, on every node (solSlots)
        const minSlot = this.solSlot(w);
        const [sim] = await Promise.all([this.o.sol.simulate(txB64, w.address, watch, { ...oneMay, received, ...(minSlot !== undefined ? { minSlot } : {}) }), routeProgramsRefusal(decoded, ask)]);
        // a code review (4 Nov): no node answered and one was still behind the slot: it may be one no node reaches,
        // so it is dropped; it costs this refusal (sim not ok), and the next tap reads as before (the two-node rules guard it)
        if (sim.behind && minSlot !== undefined && this.solSlot(w) === minSlot) this.solSlots.delete(w.id);
        // the answers again, as a pure lookup: what wasn't read counts as a program (refused); a failed read stays failed
        const executable = !reader ? async (k: string[]) => k.map(() => true) : execFailed ? async (): Promise<boolean[]> => { throw new Error("its programs weren't read"); } : async (k: string[]) => k.map((x) => answers.get(x) ?? true);
        return { tables, unread, watch, sim, executable };
      })(),
    );
    const valid = await fresh;
    if (!valid.ok) throw valid.error;
    if (!valid.value) throw new ProblemError(securityProblems.subwalletExpired());
    const ran = await run;
    if (!ran.ok) throw ran.error;
    return { tx, ...ran.value };
  }

  /** A Solana transaction's check, as pure computation on its reads (solReads; a preflight's, at the tap): the decode,
   *  the payout pin, the route's programs, the coins, the floors, the session shape. Nothing here reads the network. */
  private async solCheck(w: Stored, txB64: string, reads: SolReads) {
    const refusal = signableReason(txB64, w.address);
    if (refusal) throw new ProblemError(securityProblems.subwalletRefused(refusal));
    const { tx, tables, unread, sim } = reads;
    const decoded = decodeSolTx(txB64, tables);
    const routes = await routeProgramsRefusal(decoded, reads.executable);
    // Wrapped SOL the wallet already held, spent by it, is SOL leaving too (the caps count it).
    const wsol = ownTokenAccount(w.address, SOL.wsol);
    const wsolOut = (sim.tokens ?? []).filter((t) => t.address === wsol && t.after < t.before).reduce((sum, t) => sum + (t.before - t.after), 0n);
    const lamportsOut = sim.lamportsBefore > sim.lamportsAfter ? sim.lamportsBefore - sim.lamportsAfter : 0n;
    const out = lamportsOut + wsolOut;
    // What it's worth to the session's caps: what leaves (a buy), or what a sale brings back now (its proceeds).
    // a sale paid into the wallet's OWN wrapped-SOL account (PumpSwap, some Jupiter routes) is SOL back as much as a native
    // payout is (re-review, ship fix); never any other account, whoever's it is
    const wsolIn = (sim.tokens ?? []).filter((t) => t.address === wsol && t.after > t.before).reduce((sum, t) => sum + (t.after - t.before), 0n);
    const net = sim.lamportsAfter - sim.lamportsBefore + wsolIn;
    const gain = net > 0n ? net : 0n;
    const sells = decoded.swaps.filter((x) => x.side === "sell");
    const value = out > gain ? out : gain;
    // B36 (D109), D143: one server's full test run is the check (production runs one: solana.ts SOL_SIM_NODES), not a
    // disagreement; two that both answered and don't agree is a disagreement, and is never signed. The same for every
    // caller and both sides, Jupiter's routes included (review, 3 Nov: refused only when the runs can't run or disagree)
    const oneServer = sim.servers === 1;
    const rest = unread
      ? "It writes to more accounts than its test run can read"
      : !decoded.swaps.every((x) => BigInt(x.minOutRaw) > 0n)
        ? "It has no minimum you get back"
        // review M1: where it pays out, from the bytes alone (no server trusted): the wallet's own accounts, no fee for
        // anyone else; review M2: a route only through programs ZeroFee knows
        : (payoutRefusal(decoded, tx, tables, w.address) ?? routes ?? coinsRefusal(decoded.swaps, sim.tokens, wsol) ?? sellRefusal(sells, gain, BigInt(decoded.closes.length) * RENT_REFUND_MAX) ?? sessionRefusal(txB64, w.address, tables));
    const notCovered = !sim.ok ? "Solana's test run of it didn't go through" : !sim.agreed && !oneServer ? "The two Solana servers didn't agree on it" : rest;
    // what a buy one server checked is worth is never less than what its bytes can spend (review H2: one server's figures
    // aren't cross-checked): a first trade's bound reads this
    const buy = decoded.swaps.length === 1 && decoded.swaps[0]!.side === "buy" ? decoded.swaps[0]! : undefined;
    const bytesSpend = oneServer && buy ? buyBound(tx, tables, w.address, buy.inRaw, decoded.networkFeeLamports) : 0n;
    return { decoded, sim, out, value: value > bytesSpend ? value : bytesSpend, notCovered, unread, checkedByOne: oneServer && !sim.agreed, tables };
  }

  /** `own` (OWN_SEND): the core's own plain transfer for Wallet's Send, built by sendPlain, never an app's bytes. */
  private async signEvm(w: Stored, chain: EvmWalletChain, txB64: string, coin: unknown, own?: typeof OWN_SEND, host?: string, app?: string): Promise<{ signedTx: string } | { declined: true }> {
    // Speed (4 Nov): a preflight's reads of these very bytes and coin, by this caller, from this wallet, still fresh (used
    // once). Only reads: every check below runs again on them. A failed one, or a test run made after other earlier
    // transactions than this one runs after now, is no preflight: everything is read again, as before.
    const kept = own !== OWN_SEND && isTradeEvm(chain) ? this.takePreflight(w, evmKeyed(txB64, coin), app, host)?.evm : undefined;
    const reads = kept ? await kept.catch(() => undefined) : undefined;
    const pre = reads && this.evmSameRun(w, chain, txB64, reads) ? reads : undefined;
    // Speed (Trade, 3 Nov): a trade's facts (coins, balances, curve, deepest pool) are read beside the nonce and the test
    // run, not after them: one round trip instead of three in a row. A failure surfaces where it always did, never here.
    const early = own !== OWN_SEND && isTradeEvm(chain) ? (pre ? Promise.resolve(this.tradeFactsOf(w, chain, txB64, coin, pre.trade)) : this.tradeFacts(w, chain, txB64, coin)) : undefined;
    early?.catch(() => undefined);
    const prep = await this.evmPrepare(w, chain, txB64, pre);
    const { call, sim } = prep;
    if (w.kind === "trade") {
      const d = decodeEvmTx(txB64, typeof coin === "string" && /^0x[0-9a-fA-F]{40}$/.test(coin) ? { coin } : {});
      // A coin's own transfer(to, amount) or transferFrom(from, to, amount): the receiver is in the call's data.
      const data = call.data.toLowerCase();
      const coinTo = data.startsWith("0xa9059cbb") ? `0x${data.slice(34, 74)}` : data.startsWith("0x23b872dd") ? `0x${data.slice(98, 138)}` : undefined;
      await this.refuseOwnLink(w, [call.to, d.transfer?.to, coinTo, ...d.swaps.map((x) => x.recipient)]);
    }
    if (own !== OWN_SEND) {
      // D143 refinement: BNB Chain and Robinhood Chain: Trade's decoder (known routers, its floor, paid to this wallet).
      // Ethereum, Base, Arbitrum and Gnosis: what both nodes' test runs do to the wallet, and only to a router the
      // projects' own docs list (evm-checks.ts; review H2: an unlisted contract's Transfer log is never a trade). The
      // person's own flow that fails a check is refused by name; a site's request that isn't silent asks (one tap).
      const feeOk = prep.maxFee <= FEE_CAPS[chain].maxFee && prep.tip <= FEE_CAPS[chain].tip;
      const hardWhy = isTradeEvm(chain) ? await this.tradeRefusal(w, chain, txB64, coin, sim, feeOk, early, pre && "reference" in pre ? { out: pre.reference ?? null } : undefined) : await outcomeRefusal(call, sim, feeOk, chain, (t) => this.o.evm.tokenBalance(chain, t, w.address));
      // review M6: a gas limit far past what its test run used would burn at a real fee: never signed quietly
      const gasUsed = sim.gasUsed;
      const gasWhy = gasUsed !== undefined && call.gas > (gasUsed * 2n > gasUsed + 100_000n ? gasUsed * 2n : gasUsed + 100_000n) ? "It sets a network fee limit far above what its test run used" : null;
      // audit C2 (3 Nov): on Ethereum, Base, Arbitrum and Gnosis the core reads no router's call (what it pays, to whom,
      // through what), so nothing there signs with no sheet but taking an allowance back: the person's own flow is
      // refused by name, a site's own wallet asks (one tap). A test run's Transfer log is never proof of a trade.
      const unread = !isTradeEvm(chain) && !allowanceBack(call) ? "ZeroFee can't read what this call does" : null;
      const hard = hardWhy ?? gasWhy ?? unread;
      if (hard && host === undefined) throw notSigned(hard, w);
      const proceeds = sim.nativeIn ?? 0n;
      // re-review B1 on BNB Chain and Robinhood Chain: a sale is valued at the coin's market price too (saleUsd)
      const sale = !hard && sim.agreed && isTradeEvm(chain) ? await this.evmSaleUsd(chain, (await (early ?? this.tradeFacts(w, chain, txB64, coin)).catch(() => undefined))?.d.swaps ?? [], proceeds) : undefined;
      if (sale?.cheap && host === undefined) throw notSigned(SALE_CHEAP, w);
      const why = hard ? asksBecause(hard) : !sim.agreed ? "Only one network server could test it, so ZeroFee asks you." : sale === null ? "Its price couldn't be read, so ZeroFee asks you." : sale?.cheap ? asksBecause(SALE_CHEAP) : await this.hotGate(w, host, chain, prep.out > proceeds ? prep.out : proceeds, sale?.usd);
      if (why !== null) {
        const facts = isTradeEvm(chain) ? await (early ?? this.tradeFacts(w, chain, txB64, coin)).catch(() => undefined) : undefined;
        const evmPrice = await this.hotPrice(chain);
        // decision C: a plain send or a coin's transfer (no trade decoded) to an outside address past the cap, Face ID
        const plainOut = facts?.d.swaps.length ? null : evmPlain(call);
        const evmSendTo = plainOut?.kind === "send" ? [plainOut.to] : plainOut?.kind === "transfer" ? [plainOut.recipient] : [];
        const evmSendUsd = plainOut?.kind === "send" && evmPrice !== null ? (Number(prep.out) / 1e18) * evmPrice : null;
        const sheet = SubWallets.faceIdIf(await (await hotSheets()).evmSheet({ w, older: await this.older(w), chain, call, sim, out: prep.out, ...(host ? { host } : {}), ...(app ? { asker: app } : {}), why, feeOk, priceUsd: evmPrice, token: (t) => this.o.evm.token(chain, t), ...(facts ? { decoded: { d: facts.d, infos: facts.infos } } : {}) }), await this.sendOutPastCap(evmSendTo, evmSendUsd));
        if (!(await this.o.approve(sheet).catch(() => false))) return { declined: true };
      }
    }
    return { signedTx: await this.evmSign(w, prep) };
  }

  /**
   * A trading wallet never pays another of the person's trading wallets straight: on chain that links the two, which is
   * what rotating wallets is for (TRADE-FLOAT §2). That money goes through the float instead (subwallet.float.in, then
   * out). Checked before any sheet: Solana's SOL transfers; on EVM the address called, a coin transfer's receiver and a
   * swap's payee.
   */
  private async refuseOwnLink(w: Stored, to: (string | undefined)[]): Promise<void> {
    if (w.kind !== "trade") return;
    const same = (a: string) => (w.chain === "sol" ? a : a.toLowerCase());
    const others = new Set((await this.stored()).filter((x) => x.kind === "trade" && x.chain === w.chain && x.id !== w.id).map((x) => same(x.address)));
    if (to.some((a) => typeof a === "string" && others.has(same(a)))) {
      throw new ProblemError(securityProblems.subwalletRefused("Sending straight between your own wallets shows everyone they're linked. Use Move instead: it goes through Private."));
    }
  }

  /** An EVM transaction for this wallet: run on two nodes after its earlier unlanded ones; the most that can leave.
   *  `pre`: a preflight's reads (evmSameRun: its test run ran after exactly the earlier transactions this one runs after
   *  now): its nonce and test run stand for the reads; every check here runs again all the same. */
  private async evmPrepare(w: Stored, chain: EvmWalletChain, txB64: string, pre?: EvmReads) {
    const ok = evmSignable(txB64, chain);
    if ("refusal" in ok) throw new ProblemError(securityProblems.subwalletRefused(ok.refusal));
    const t = parseTx(ok.bytes);
    const evm = this.o.evm;
    // review M6: the test run carries the transaction's own fee fields, so a contract can't tell it from the real one
    const call = evmCallOf(w.address, t);
    let next: number, sim: EvmSimulated;
    const same = pre ? this.evmEarlier(w, t.nonce, pre.next) : undefined;
    if (pre && same!.seq === pre.seq) {
      next = pre.next;
      this.numberTaken(w, t.nonce, ok.bytes, call);
      sim = pre.sim;
    } else {
      // Run it after this wallet's earlier signed transactions that haven't landed (an approval before its swap).
      // Both nodes test it on one block, the lower head of the two (audit D148 L1), read beside the nonce: no wait added.
      const [n, head] = await Promise.all([evm.nonce(chain, w.address), evm.head ? evm.head(chain).catch(() => null) : Promise.resolve(null)]);
      next = n;
      const { ran } = this.evmEarlier(w, t.nonce, next);
      this.numberTaken(w, t.nonce, ok.bytes, call);
      sim = await evm.simulate(chain, [...ran.map((x) => x.call), call], head);
    }
    return { bytes: ok.bytes, nonce: t.nonce, next, call, sim, out: t.value + t.gas * t.maxFeePerGas, maxFee: t.maxFeePerGas, tip: t.maxPriorityFeePerGas };
  }

  /**
   * What an EVM transaction at `nonce` is test-run after: this wallet's earlier signed transactions that haven't landed
   * (and, for a preflight, `extra`: Trade's own earlier steps not signed yet, as a sale's approve), from `next` on, all of
   * them in order; else none. `seq`: those, as text (evmStepKey). A number under `next` was used already: refused.
   */
  private evmEarlier(w: Stored, nonce: number, next: number, extra: EvmStep[] = []): { ran: EvmStep[]; seq: string } {
    if (nonce < next) throw new ProblemError(securityProblems.subwalletRefused("This wallet already sent a payment with that number. This one can't go."));
    const by = new Map<number, EvmStep>();
    for (const x of extra) by.set(x.nonce, x);
    for (const x of this.pending.get(w.id) ?? []) by.set(x.nonce, { nonce: x.nonce, call: x.call });
    const earlier = [...by.values()].filter((x) => x.nonce >= next && x.nonce < nonce).sort((a, b) => a.nonce - b.nonce);
    const ran = earlier.length === nonce - next && earlier.every((x, i) => x.nonce === next + i) ? earlier : [];
    return { ran, seq: ran.map(evmStepKey).join("\n") };
  }

  /** Whether a preflight's test run is the one this tap would make: after exactly the same earlier transactions. */
  private evmSameRun(w: Stored, chain: EvmWalletChain, txB64: string, r: EvmReads): boolean {
    try {
      const ok = evmSignable(txB64, chain);
      return !("refusal" in ok) && this.evmEarlier(w, parseTx(ok.bytes).nonce, r.next).seq === r.seq;
    } catch {
      return false;
    }
  }

  /** Sign it, and remember it until it lands (a later one runs after it). */
  private async evmSign(w: Stored, prep: { bytes: Uint8Array; nonce: number; next: number; call: EvmCall }): Promise<string> {
    const own = this.numberTaken(w, prep.nonce, prep.bytes, prep.call);
    const signedTx = signEvmTx(prep.bytes, await this.secret(w, evmStepKey(prep)));
    this.pending.set(w.id, [...(this.pending.get(w.id) ?? []).filter((x) => x.nonce >= prep.next && x.nonce !== prep.nonce), { nonce: prep.nonce, call: prep.call, ...(own ? { own } : {}) }]);
    return signedTx;
  }

  /**
   * A number two transactions would share, refused (security review 3 Nov, M): one the core's own send holds right now
   * (`held`: read, its sheet maybe open) asked by anything else (Trade's own transactions, a session); or one a transaction
   * of the core's own already has, or the core's own send at one another's already has, unless it is the same call again.
   * Checked before the sheet and again at signing. True: this is the core's own held send.
   */
  private numberTaken(w: Stored, nonce: number, bytes: Uint8Array, call: EvmCall): boolean {
    const h = this.held.get(w.id);
    const own = !!h && h.length === bytes.length && h.every((b, i) => b === bytes[i]);
    const same = (x: EvmCall) => x.to === call.to && x.value === call.value && x.data === call.data;
    if ((h && !own && parseTx(h).nonce === nonce) || (this.pending.get(w.id) ?? []).some((x) => x.nonce === nonce && (x.own || own) && !same(x.call))) {
      throw new ProblemError(securityProblems.subwalletRefused("Another payment from this wallet took its turn first. Try again in a moment. Nothing was sent."));
    }
    return own;
  }

  /** A trade on BNB Chain or Robinhood Chain as the decoder reads it, its coins' names (two nodes), and why a session can't cover it. */
  private async tradeFacts(w: Stored, chain: EvmChainName, txB64: string, coin: unknown) {
    return this.tradeFactsOf(w, chain, txB64, coin, await this.tradeReads(w, chain, txB64, coin));
  }
  /** The decoder's verdict on these bytes, as pure computation on their reads (tradeReads; a preflight's, at the tap). */
  private tradeFactsOf(w: Stored, chain: EvmChainName, txB64: string, coin: unknown, r: TradeReads) {
    const d = decodeEvmTx(txB64, typeof coin === "string" && /^0x[0-9a-fA-F]{40}$/.test(coin) ? { coin } : {});
    return { d, infos: r.infos, refusal: evmSessionRefusal(d, w.address, chain, { balances: r.balances, ponsCurve: r.ponsCurve, v3Deepest: r.v3 ?? null, hook: r.hook, midDeepest: r.midDeepest }, Math.floor(Date.now() / 1000)) };
  }
  /** The network reads tradeFactsOf computes from. */
  private async tradeReads(w: Stored, chain: EvmChainName, txB64: string, coin: unknown): Promise<TradeReads> {
    const d = decodeEvmTx(txB64, typeof coin === "string" && /^0x[0-9a-fA-F]{40}$/.test(coin) ? { coin } : {});
    const evm = this.o.evm;
    const coins = [...new Set([d.swaps[0]?.coin, d.approve?.token, d.permit2?.token, d.needsCheck?.coin].filter((c): c is string => !!c))];
    const approved = [d.approve?.token, d.permit2?.token].filter((c): c is string => !!c);
    // A v3 swap: which of the coin's fee-tier pools is its deepest (the fix review); unread, the session doesn't cover it.
    // Read alongside the others.
    const swap = d.swaps[0];
    // gap 4: a v4 pool with hooks: the hook's code and proxy slots on two nodes at one block both have (head)
    const hooked = swap?.hooks !== undefined && !/^0x0{40}$/.test(swap.hooks);
    const mid = swap?.midFee !== undefined && swap.path?.length === 3 ? swap.path[1]! : undefined;
    const [infos, balances, ponsCurve, v3, hook, midDeepest] = await Promise.all([
      Promise.all(coins.map(async (c) => [c, await evm.token(chain, c).catch(() => undefined)] as const)).then((x) => new Map(x)),
      Promise.all(approved.map(async (c) => [c, await evm.tokenBalance(chain, c, w.address).catch(() => 0n)] as const)).then((x) => new Map(x)),
      d.needsCheck?.coin ? evm.ponsCurve(d.needsCheck.coin).catch(() => null) : Promise.resolve(null),
      swap?.fee !== undefined && swap.coin ? (evm.v3Deepest?.(chain, swap.coin).catch(() => null) ?? Promise.resolve(null)) : Promise.resolve(undefined),
      hooked && evm.hookFacts ? (evm.head?.(chain) ?? Promise.resolve(null)).catch(() => null).then((at) => evm.hookFacts!(chain, swap!.hooks!, at)).catch(() => null) : Promise.resolve(null),
      mid ? (evm.v3Deepest?.(chain, mid).catch(() => null) ?? Promise.resolve(null)) : Promise.resolve(null),
    ]);
    return { infos, balances, ponsCurve, v3, hook, midDeepest };
  }

  /**
   * What the same trade would give elsewhere, in what it gets (wei for a sale, the coin's units for a buy): through the
   * coin's deepest v3 pool (QuoterV2, two nodes, the lower), else at the market's price (the relay's, asked here, under
   * a minute old) and the native coin's (1Click's, fresh). Null when there is neither.
   */
  private async referenceOut(chain: EvmChainName, s: { side: "buy" | "sell"; coin?: string; inRaw: string }, decimals: number | undefined, marketOnly = false): Promise<bigint | null> {
    const evm = this.o.evm, coin = s.coin!.toLowerCase(), wrapped = V3_POOLS[chain].wrapped, amount = BigInt(s.inRaw);
    // review M2 (4 Nov): the coin's deepest v3 pool is the reference only when it holds REFERENCE_MIN_POOL_USD of the wrapped
    // native coin (a 1-wei pool anyone can make agrees with any price); a trade through a middle coin or a hooked pool is
    // held to the market's price only (its own route's pools are not a reference for it)
    if (!marketOnly && evm.v3DeepestHeld && evm.v3Quote) {
      const [depth, nativeUsd] = await Promise.all([evm.v3DeepestHeld(chain, coin).catch(() => null), this.o.usdPrice ? this.o.usdPrice(chain).catch(() => null) : Promise.resolve(null)]);
      if (depth && nativeUsd && nativeUsd > 0 && (Number(depth.held) / 1e18) * nativeUsd >= REFERENCE_MIN_POOL_USD) {
        return s.side === "sell" ? evm.v3Quote(chain, coin, wrapped, amount, depth.fee) : evm.v3Quote(chain, wrapped, coin, amount, depth.fee);
      }
    }
    if (decimals === undefined || !this.o.marketPrice || !this.o.usdPrice) return null;
    const [coinUsd, nativeUsd] = await Promise.all([this.o.marketPrice(chain, coin), this.o.usdPrice(chain)]);
    if (!coinUsd || !nativeUsd || !(coinUsd > 0) || !(nativeUsd > 0)) return null;
    const value = s.side === "sell" ? (Number(amount) / 10 ** decimals) * (coinUsd / nativeUsd) * 1e18 : (Number(amount) / 1e18) * (nativeUsd / coinUsd) * 10 ** decimals;
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : null;
  }

  /** A trade on BNB Chain or Robinhood Chain as the core checks it: null when it may be signed, else why not. */
  private async tradeRefusal(w: Stored, chain: EvmChainName, txB64: string, coin: unknown, sim: EvmSimulated, feeOk: boolean, early?: ReturnType<SubWallets["tradeFacts"]>, reference?: { out: bigint | null }): Promise<string | null> {
    // What the check needs, read on two nodes (started beside the test run when signEvm could).
    const { d, infos, refusal } = await (early ?? this.tradeFacts(w, chain, txB64, coin));
    if (!sim.ok) return "Its test run didn't go through";
    if (!sim.agreed) return "The two network servers didn't both test it the same way";
    if (!feeOk) return "Its network fee is higher than ZeroFee pays on this chain";
    const proceeds = sim.nativeIn ?? 0n;
    // A minimum's floor is held to the higher of the two nodes (the most it could get); the reference check and the cap
    // charged below use the lower (audit D148 L1).
    const why = refusal ?? sellRefusal(d.swaps.filter((x) => x.side === "sell"), sim.nativeInHigh ?? proceeds) ?? evmBuyRefusal(d.swaps, sim.coinsInHigh ?? sim.coinsIn) ?? evmCoinsRefusal(d.swaps, sim.coinsIn);
    if (why) return why;
    const s = d.swaps[0];
    // gap 4 (c): through a pool with hooks the two nodes' test runs agree EXACTLY (the hook's own code ran on both), not
    // only within AGREE_BPS
    if (s?.hooks !== undefined && !/^0x0{40}$/.test(s.hooks) && !exactlyAgreed(sim)) return "The two network servers didn't test it exactly the same way";
    // gap 5: a trade through a middle coin leaves none of it behind: both nodes' test runs show the wallet's balance of the
    // middle coin unchanged (read, never assumed)
    const mid = s?.path?.length === 3 ? s.path[1]!.toLowerCase() : undefined;
    const left = middleLeftRefusal(s?.path, sim);
    if (left) return left;
    // A v4 pool, or a KyberSwap route (a buy's or, since D143, a sale's), is the route's own choice: the trade must get
    // at least 85 % of an independent reference (the fix review). Read only when everything else would let it through. A
    // trade through a middle coin too, end to end (gap 5). (A preflight's reference, read ahead for these very bytes,
    // stands for the read: `reference`.)
    const priced = s && s.coin && (s.hooks !== undefined || s.executor !== undefined || mid !== undefined);
    const hookedPool = s?.hooks !== undefined && !/^0x0{40}$/.test(s.hooks);
    return priced ? referenceRefusal(s.side === "sell" ? sim.nativeIn : sim.coinsIn?.get(s.coin!.toLowerCase()), reference ? reference.out : await this.referenceOut(chain, s, infos.get(s.coin!)?.decimals, mid !== undefined || hookedPool).catch(() => null)) : null;
  }

  /** Each coin's price ask, kept 30 s (review ST7 L1: a burst of trades asks once, not once a trade). */
  /** The coins sheets named from the chain (sheetCoins), by mint, for this session. */
  private readonly coinNames = new Map<string, Promise<{ symbol: string; decimals: number } | null>>();
  private readonly priceAsks = new Map<string, { at: number; ask: Promise<number | null> }>();
  /** A coin's dollar price, asked now (or the ask of the last 30 s), or null after 1.5 s or on any failure: the sheet
   *  never waits longer for it. */
  private priceSoon(chain: SubWallet["chain"], cachedOnly = false): Promise<number | null> {
    const ask = this.o.usdPrice;
    if (!ask || !(chain === "sol" || chain === "bsc" || chain === "hood" || chain === "near")) return Promise.resolve(null);
    const now = Date.now();
    let kept = this.priceAsks.get(chain);
    // a preflighted tap reads nothing: no price kept, no price (the sheet asks)
    if (cachedOnly && (!kept || now - kept.at > 30_000 || now < kept.at)) return Promise.resolve(null);
    if (!kept || now - kept.at > 30_000 || now < kept.at) {
      // review ST7 L2: a price function that throws at once is no price, never a failed signing
      kept = { at: now, ask: Promise.resolve().then(() => ask(chain)).then((v) => (typeof v === "number" && v > 0 ? v : null), () => null) };
      this.priceAsks.set(chain, kept);
      // a failed or empty answer isn't kept: the next sheet asks again
      void kept.ask.then((v) => v === null && this.priceAsks.get(chain) === kept && this.priceAsks.delete(chain));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([kept.ask, new Promise<null>((r) => (timer = setTimeout(() => r(null), 1500)))]).finally(() => clearTimeout(timer));
  }

  /**
   * The move into the private pocket (D27; the outside study's item 2): the core asks the pinned relay for the quote
   * itself, for the pocket by the core's own list (the same coin in, recipient and refunds both the pocket, privately),
   * reads it back as 1Click signed it, and keeps it so the main key's sheet can say "Move … to Private" from it
   * (privateInFacts). Wallet then pays exactly this quote's deposit address. Nothing moves here.
   */
  /**
   * `outside` (Home's Add, V4 step 6, G7): the coin comes from another chain (BTC on Bitcoin, …), so 1Click's address is
   * that chain's own, not a NEAR one. Recipient and refund stay the pocket's own confidential balance (D37: no address of
   * anyone else's, no refund address typed). A chain that needs a memo with its address is refused: the core can't carry
   * the memo, and money sent without it would be lost. Its kept record never stands for a NEAR address the main sheet pays.
   */
  /**
   * `through` (Home's Send, D128: Hidden is how money travels, not a place): leg 1 of a Send, money that only passes
   * through the pocket on its way to the payee. It isn't held to the pocket's own cap and never counts toward any other
   * move in. The quote relay still has its own limit on one quote (apps/quotes POCKET_USD, D132): that limit is said by
   * name. Its record is marked `through`, so only a Send's own leg 2 may join it (hiddenFromRow, privatePay with
   * inDeposit), and Home's Add line never lists it.
   */
  async privateQuoteIn(tokenId: unknown, amount: unknown, outside = false, through = false, intents = false): Promise<{ depositAddress: string; amountIn: string; minAmountOut: string; deadlineIso: string; amountInUsd?: string; feeUsd?: string; etaSeconds?: number; statusTag?: string }> {
    // BNB Chain's coin is nep245 (BNB_COIN): from its own chain only, and only once BNB Chain opens (E8's shut gate)
    const bnb = outside && tokenId === BNB_COIN;
    if (typeof tokenId !== "string" || !(/^nep141:[a-z0-9_.-]{2,64}$/.test(tokenId) || bnb)) throw new ProblemError(securityProblems.requestInvalid("tokenId is a NEAR coin (nep141:…)"));
    // Home's Add from another chain: only chains whose addresses take money with no memo (review M1); any other is the Safe's
    if (outside && !(bnb ? CHAIN_COIN.bsc.open : OUTSIDE_CHAINS.test(tokenId))) throw new ProblemError(securityProblems.subwalletRefused(bnb ? "BNB Chain opens once ZeroFee has tested it with real money. Nothing moved." : "This coin can't come in through Private from its own chain yet. Nothing moved."));
    if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is the coin's smallest units, as text"));
    const pocket = (await this.stored()).find(isPocket);
    if (!pocket) throw new ProblemError(securityProblems.subwalletRefused("Set up your private balance first."));
    // Move's fill (one bridge leg, QA 5 Nov): money only passing through, paid from the Safe's own NEAR Intents
    // balance by one mt_transfer inside intents.near (INTENTS), never out of it and back (ORIGIN_CHAIN). Only `through`
    if (intents && (outside || !through)) throw new ProblemError(securityProblems.requestInvalid("intents is a Send's or Move's own fill"));
    const depositType = intents ? "INTENTS" : "ORIGIN_CHAIN";
    const relay = this.o.floatRelay;
    if (!relay || !this.o.privateStatus) throw new ProblemError(securityProblems.subwalletRefused("Private payments aren't set up on this phone yet."));
    const raw = await relay
      .quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: tokenId, depositType, destinationAsset: tokenId, amount,
        refundTo: pocket.address, refundType: "CONFIDENTIAL_INTENTS", recipient: pocket.address, recipientType: "CONFIDENTIAL_INTENTS",
        deadline: quoteDeadline(Date.now(), 10 * 60_000), confidentiality: "basic",
      })
      .catch((e: unknown) => {
        if (e instanceof ProblemError) throw e;
        // the relay's own limit on one quote, said as the relay's (never "1Click said no")
        if ((e as { code?: unknown } | null)?.code === "quotes.request.too-big") throw new ProblemError(securityProblems.subwalletRefused(`ZeroFee's price server takes up to ${/\$\d[\d,]*(\.\d+)?/.exec(String((e as Error)?.message ?? ""))?.[0] ?? POCKET_MAX_TEXT} a send. Nothing moved.`));
        throw new ProblemError(securityProblems.subwalletRefused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`));
      });
    const depositAddress = raw?.quote?.depositAddress;
    if (typeof depositAddress !== "string" || !(outside ? /^[A-Za-z0-9]{20,100}$/.test(depositAddress) && !/^[0-9a-f]{64}$/.test(depositAddress) : /^[0-9a-f]{64}$/.test(depositAddress))) throw new ProblemError(securityProblems.subwalletRefused("NEAR Intents gave no address to pay. Nothing moved."));
    const tag = typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag) ? raw.zerofeeStatusTag : undefined;
    // What counts is 1Click's own signed quote for that address, never the relay's answer above.
    const q = parseQuote(await this.o.privateStatus(depositAddress, tag), depositAddress, this.o.quoteKey);
    const usd = q?.amountInUsd ?? "";
    const ok =
      q && q.status === "PENDING_DEPOSIT" && Date.parse(q.deadline) > Date.now() && q.originAsset === tokenId && q.destinationAsset === tokenId && q.depositType === depositType &&
      q.swapType === "EXACT_INPUT" && q.recipient === pocket.address && q.recipientType === "CONFIDENTIAL_INTENTS" && q.refundTo === pocket.address && q.refundType === "CONFIDENTIAL_INTENTS" &&
      q.amountIn === amount && /^\d+$/.test(q.minAmountOut);
    if (!ok) throw new ProblemError(securityProblems.subwalletRefused("NEAR Intents priced it differently than asked. Nothing moved."));
    // the memo as 1Click SIGNED it (review H1: never the relay's unsigned answer): money sent without it could be lost
    if (outside && q!.depositMemo) throw new ProblemError(securityProblems.subwalletRefused("This coin needs a memo with its address, and a private add can't take one yet. Nothing moved."));
    // a price is still a must on a Send (1Click's signed dollars, for its sheet); only the pocket's own cap is gone from it (D128)
    if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd) || (!through && Number(usd) > POCKET_PAYMENT_MAX_USD)) throw new ProblemError(securityProblems.subwalletRefused(`A private send goes up to ${POCKET_MAX_TEXT}.`));
    // the tally, its check and its write in one turn (security review 3 Nov): no other change to the list lands between them
    // Hidden's balance read before the turn (re-review L3): the turn holds the list, never a network read
    const t0 = Date.now();
    const held = through ? 0 : await this.pocketHeldUsd();
    await this.turn("private-ins", async () => {
      const at = Date.now();
      const ins = await this.privateIns();
      // an address already paid from here is never priced again (re-review L2: the new entry would drop its mark)
      if (ins.some((k) => k.depositAddress === depositAddress && k.used)) throw new ProblemError(securityProblems.subwalletRefused("The swap service gave an address that was already paid. Nothing moved."));
      // an address on another chain counts until it can no longer be paid (review M2: a Bitcoin payment can land after 30
      // minutes); 1Click signs it for at most 4 days
      const kept = ins.filter((k) => (k.outside ? at < (k.untilMs ?? k.atMs + PRIVATE_IN_MS) : at - k.atMs <= PRIVATE_IN_MS) && k.depositAddress !== depositAddress).slice(-19);
      // The core's own tally (audit INFO-1; D27: Private holds at most $100): what the pocket holds, the moves in quoted in
      // the last 30 minutes (paid or not, so stricter), and this one. A pocket it can't read or price: no move in.
      // H-4 (M3): one 1Click said was paid or refunded before Hidden's balance above was read counts there, not here
      // a Send's leg 1 (`through`) passes through on its way out: it never counts here (D128)
      const pending = kept.reduce((sum, k) => sum + (k.through || k.endedAtMs! < t0 ? 0 : typeof k.usd === "number" ? k.usd : POCKET_PAYMENT_MAX_USD), 0);
      if (!through && held + pending + Number(usd) > POCKET_PAYMENT_MAX_USD) {
        throw new ProblemError(securityProblems.subwalletRefused(`Your private balance holds at most ${POCKET_MAX_TEXT}: it has about $${(held + pending).toFixed(2)}, so up to $${Math.max(0, POCKET_PAYMENT_MAX_USD - held - pending).toFixed(2)} more.`));
      }
      await this.o.vault.put(PRIVATE_INS, utf8(JSON.stringify([...kept, { depositAddress, ...(tag ? { tag } : {}), atMs: at, usd: Number(usd), ...(outside ? { outside: true, untilMs: Date.parse(q!.deadline) } : {}), ...(through ? { through: true } : {}) }])));
    });
    // For the sheet's one line only (never a check): 1Click's own signed estimate of the time, and its fee as the dollars
    // in less the dollars out it signed.
    const eta = Number(q!.timeEstimate);
    const fee = Number(usd) - Number(q!.amountOutUsd);
    return {
      depositAddress, amountIn: q!.amountIn, minAmountOut: q!.minAmountOut, deadlineIso: q!.deadline, amountInUsd: usd, ...(tag ? { statusTag: tag } : {}),
      ...(Number.isFinite(fee) && fee >= 0 && fee < Number(usd) ? { feeUsd: fee.toFixed(2) } : {}),
      ...(Number.isInteger(eta) && eta > 0 && eta <= 86_400 ? { etaSeconds: eta } : {}),
    };
  }

  /**
   * Home's one line for an Add from another chain (V4 step 6): the core's own outside addresses that 1Click says it has
   * seen money at and is moving into Hidden. Only 1Click's signed quote counts (the address, the pocket as recipient), and
   * the dollars and the time are its signed figures. Nothing else is returned: no address, no id beyond a short key.
   */
  /** Adds 1Click says ended (done, refunded, failed): never asked about again on this run. */
  private readonly addsEnded = new Set<string>();
  async privateAddsOnWay(): Promise<{ key: string; tokenId: string; usd: string; etaSeconds?: number }[]> {
    const pocket = (await this.stored()).find(isPocket);
    if (!pocket || !this.o.privateStatus) return [];
    const at = Date.now();
    // only Adds quoted in the last day and not yet ended (review 4: a quote 1Click signs for days, or one that finished,
    // is never asked about again and again)
    // a Send's leg 1 (`through`) is money leaving, never an Add on its way in
    const open = (await this.privateIns()).filter((k) => k.outside && !k.through && !k.endedAtMs && !this.addsEnded.has(k.depositAddress) && at - k.atMs < 86_400_000 && at < (k.untilMs ?? k.atMs + PRIVATE_IN_MS)).slice(-5);
    const out: { key: string; tokenId: string; usd: string; etaSeconds?: number }[] = [];
    for (const k of open) {
      const raw = (await this.o.privateStatus(k.depositAddress, k.tag).catch(() => null)) as { status?: unknown } | null;
      const q = raw ? parseQuote(raw, k.depositAddress, this.o.quoteKey) : null;
      if (!q || q.recipient !== pocket.address || q.recipientType !== "CONFIDENTIAL_INTENTS" || !/^\d{1,12}(\.\d{1,18})?$/.test(q.amountInUsd ?? "")) continue;
      // ended: never asked about again. H-4 (QA, M3): paid or refunded, the money is in Hidden and counts there (what it
      // holds), so its quote stops counting toward the $100 at once and comes off the list (never counted twice); unpaid, it
      // counts until its deadline, and past it it is gone already (the rule of a leg 1 never handed to a node, 7c66d7ad)
      const end = raw?.status;
      if (end === "SUCCESS" || end === "REFUNDED" || end === "FAILED") {
        this.addsEnded.add(k.depositAddress);
        // marked, never deleted (re-review: its "already paid" mark stays, and a balance read before the mark still counts it)
        if (end !== "FAILED") await this.editIns((ins) => ins.map((x) => (x.depositAddress === k.depositAddress ? { ...x, endedAtMs: Date.now() } : x)));
      }
      if (raw?.status !== "KNOWN_DEPOSIT_TX" && raw?.status !== "PROCESSING") continue;
      out.push({ key: k.depositAddress.slice(-6), tokenId: q.originAsset, usd: Number(q.amountInUsd).toFixed(2), ...(Number.isInteger(q.timeEstimate) && q.timeEstimate! > 0 && q.timeEstimate! <= 86_400 ? { etaSeconds: q.timeEstimate } : {}) });
    }
    return out;
  }

  /** The Safe's swap in place (safe-swap.ts, loaded with its first use): the core's own quote, and the sheet's check of it. */
  async safeSwapQuote(from: unknown, to: unknown, amount: unknown, atLeast: unknown) {
    return (await import("./safe-swap.ts")).safeSwapsOf(this.o).quote(from, to, amount, atLeast);
  }
  /**
   * What the core's own quote doors asked this deposit address for (QA, 5 Nov): "swap" (subwallet.safeSwapQuote),
   * "move" (subwallet.private.quoteIn paid by the Safe, subwallet.float.quoteAdd), or null. Only these doors write the
   * records it reads; no app, page or relay answer does. The Safe's signer puts a request paying one under that tag.
   */
  async intentOf(depositAddress: string): Promise<"swap" | "move" | null> {
    if ((await import("./safe-swap.ts")).safeSwapsOf(this.o).asked(depositAddress)) return "swap";
    if ((await this.privateIns()).some((x) => x.depositAddress === depositAddress && !x.outside)) return "move";
    if (await this.floatMoves.addAsked(depositAddress)) return "move";
    return null;
  }
  async safeSwapFacts(depositAddress: string): Promise<unknown | null> {
    return (await import("./safe-swap.ts")).safeSwapsOf(this.o).facts(depositAddress);
  }

  /**
   * A Move's Private leg, from the core's own record (QA's MUST, 5 Nov: a signing sheet says only what the core
   * signed or read itself, never an app's figure). The pocket's own share of a payment (privatePay `send`) is noted as
   * 1Click signed its quote; the Safe's leg 2 to the same payee in the same coin, joined to a move in (`inDeposit`), claims
   * the latest such note within PRIVATE_LEG_MS. The Safe's sheet for that move in then says Private's part from it. Kept
   * in memory only: after a restart there is no Private line (left out, never guessed).
   */
  private readonly pocketShares: { recipient: string; tokenId: string; units: string; atMs: number }[] = [];
  private readonly privateLegs = new Map<string, PrivateLegRecord>();
  private notePocketShare(q: QuoteFacts): void {
    if (!/^\d{1,40}$/.test(q.amountIn) || BigInt(q.amountIn) <= 0n) return;
    this.pocketShares.push({ recipient: q.recipient, tokenId: q.originAsset, units: q.amountIn, atMs: Date.now() });
    if (this.pocketShares.length > 8) this.pocketShares.shift();
  }
  /** The ruling (the audit and the copy review, 5 Nov): the Safe's sheet titles the Move by what it pays (the pocket's share and this payment,
   *  both as 1Click signed them) and to whom, named only when ownPayee says it is the person's own (`own`). */
  private joinPrivateLeg(inDeposit: string, q: QuoteFacts, own: boolean): void {
    const now = Date.now();
    const pay: PrivateLegRecord = { tokenId: q.originAsset, ...(/^\d{1,40}$/.test(q.amountIn) ? { payUnits: q.amountIn } : {}), recipient: q.recipient, own };
    for (let i = this.pocketShares.length - 1; i >= 0; i--) {
      const s = this.pocketShares[i]!;
      if (s.recipient !== q.recipient || s.tokenId !== q.originAsset || now - s.atMs > PRIVATE_LEG_MS) continue;
      this.pocketShares.splice(i, 1);
      this.privateLegs.set(inDeposit, { ...pay, units: s.units });
      return;
    }
    this.privateLegs.set(inDeposit, pay);
  }
  /** A Send's payout joined to its move in (privatePay with inDeposit; that move in is marked paid then, so one only). */
  private readonly sendPayouts = new Map<string, SendPayout>();
  sendPayout(depositAddress: string): SendPayout | null {
    return this.sendPayouts.get(depositAddress) ?? null;
  }
  /** The Private leg joined to this move in's address (above), for the main key's sheet; null for any other. */
  privateLeg(depositAddress: string): PrivateLegRecord | null {
    return this.privateLegs.get(depositAddress) ?? null;
  }

  /** For the main key's sheet: a move into the pocket the core quoted itself (within 30 minutes), as the relay has it; null for any other address. */
  async privateInFacts(depositAddress: string): Promise<unknown | null> {
    const k = (await this.privateIns()).find((x) => x.depositAddress === depositAddress && !x.outside);
    if (!k || !(Date.now() - k.atMs <= PRIVATE_IN_MS) || !this.o.privateStatus) return null;
    return this.o.privateStatus(depositAddress, k.tag).catch(() => null);
  }

  /**
   * What 1Click holds in Trading's balance ("trade") or the private pocket ("private"), read with that wallet's own
   * sign-in (oneclick-account.ts): its money is confidential, so no chain shows it.
   */
  async confidentialBalances(kind: "trade" | "private"): Promise<{ tokenId: string; amount: string }[]> {
    const w = (await this.stored()).find(kind === "private" ? isPocket : isFloat);
    if (!w) throw new ProblemError(securityProblems.subwalletRefused(kind === "private" ? "Set up your private balance first." : "Move money to your NEAR wallet first."));
    if (!this.o.intentsSalt) throw new ProblemError(securityProblems.subwalletRefused("This phone can't read private balances yet."));
    return this.heldBy(w.address, await this.secret(w));
  }

  private async heldBy(signerId: string, secret: Uint8Array): Promise<{ tokenId: string; amount: string }[]> {
    if (!this.o.intentsSalt) throw new ProblemError(securityProblems.subwalletRefused("This phone can't read private balances yet."));
    try {
      return await privateBalances({ signerId, secret, salt: this.o.intentsSalt, ...(this.o.oneClickFetch ? { fetch: this.o.oneClickFetch } : {}) });
    } catch (e) {
      this.o.forgetSalt?.();
      // Bug 8 (3 Nov): this read is 1Click's (the pocket's own sign-in), so it is said as 1Click, never as "NEAR is
      // down". Only the salt is read from NEAR: its failure stays NEAR's.
      if (e instanceof ProblemError) throw e;
      if (e instanceof SaltUnread) throw new ProblemError(securityProblems.nodesUnreachable());
      const status = Number(/ said (\d{3})$/.exec(String((e as Error)?.message ?? ""))?.[1]);
      throw new ProblemError(securityProblems.oneClickUnreachable(faultOf(Number.isInteger(status) ? status : null, e)));
    }
  }

  /**
   * What 1Click holds for Trading's balance (Spending's hub), where the float's count starts. Not made on this phone yet
   * (a fresh account: the first Top up makes it): it is still the one address the backup words make for it, so 1Click is
   * asked for that very address, with its own sign-in, and its answer counts (an empty float is $0 because 1Click says
   * so, and a restore reads what the old phone left there). Mainnet, 1 Nov: this threw "Make the Trading balance first"
   * instead, the count stayed unread, Spending never loaded, and so a Top up, the one thing that makes the float, was
   * refused as "still getting ready" for good. A phone with no words' root makes a float from a random key, kept in this
   * vault before its list names it: with none listed, no float of this account's exists anywhere, and it holds nothing.
   * A read that fails still throws: unknown, never $0.
   */
  private async floatHeld(): Promise<{ tokenId: string; amount: string }[]> {
    if ((await this.stored()).some(isFloat)) return this.confidentialBalances("trade");
    const root = await this.o.vault.get(HOT_ROOT);
    if (!root) return [];
    const seed = hotSecret(root, "trade", "near", 0);
    root.fill(0);
    if (!seed) throw new ProblemError(securityProblems.subwalletRefused("Move money to your NEAR wallet first."));
    try {
      return await this.heldBy(addressOf("near", "direct", seed), seed);
    } finally {
      seed.fill(0);
    }
  }

  /** What the private pocket holds now, in dollars: read with its own sign-in, each coin at 1Click's fresh price. */
  private async pocketHeldUsd(): Promise<number> {
    if (this.o.pocketUsd) return this.o.pocketUsd();
    const held = await this.confidentialBalances("private");
    let usd = 0;
    for (const t of held) {
      if (!/^\d{1,40}$/.test(t.amount) || BigInt(t.amount) === 0n) continue;
      const price = await this.o.tokenPrice?.(t.tokenId).catch(() => null);
      if (!price) throw new ProblemError(securityProblems.subwalletRefused("Your private balance didn't load, so nothing can be added yet."));
      usd += (Number(t.amount) / 10 ** price.decimals) * price.usd;
    }
    return usd;
  }

  /**
   * One at a time per key, in the order asked; a turn that fails never holds up the next. "private-ins": changes to
   * PRIVATE_INS (each reads the list after the one before it wrote). "evm:<wallet id>": the core's own sends from one EVM
   * wallet, from reading its next number to handing the transaction to the nodes (sendCall, payPlain): a second send
   * waits for the first, so two never take the same number (security review 3 Nov, L1), sheet included.
   */
  private readonly turns = new Map<string, Promise<unknown>>();
  private walletTurn<T>(w: Stored, run: () => Promise<T>): Promise<T> {
    return this.turn(`evm:${w.id}`, () => run().finally(() => this.held.delete(w.id)));
  }
  private turn<T>(key: string, run: () => Promise<T>): Promise<T> {
    const mine = (this.turns.get(key) ?? Promise.resolve()).then(run);
    const after = mine.catch(() => undefined);
    this.turns.set(key, after);
    void after.then(() => this.turns.get(key) === after && this.turns.delete(key));
    return mine;
  }

  /** The list of moves into Hidden, changed in its own turn (never fails the caller). */
  private editIns(f: (ins: Awaited<ReturnType<SubWallets["privateIns"]>>) => unknown[]): Promise<unknown> {
    return this.turn("private-ins", async () => this.o.vault.put(PRIVATE_INS, utf8(JSON.stringify(f(await this.privateIns()))))).catch(() => undefined);
  }
  private async privateIns(): Promise<{ depositAddress: string; tag?: string; atMs: number; usd?: number; outside?: true; through?: true; untilMs?: number; used?: true; endedAtMs?: number }[]> {
    const raw = await this.o.vault.get(PRIVATE_INS);
    const list = raw ? JSON.parse(new TextDecoder().decode(raw)) : [];
    return Array.isArray(list) ? list : [];
  }

  /**
   * Pay from the private pocket: sign the NEP-413 transfer 1Click prepared (generate-intent), after checking it is
   * exactly the one transfer its quote needs and showing the core's own sheet. The app submits what comes back.
   */
  /**
   * `inDeposit` (Home's Send from the Safe, E4): this payment is leg 2 of a Send whose leg 1 is the Safe's move into the
   * pocket at that address (privateQuoteIn with `through`, a NEAR address, still unpaid and in date, read back as 1Click
   * signed it). It pays only what leg 1 promises to bring, in that same coin (never the pocket's other money), so the
   * pocket's $100 doesn't apply (D128); the relay's own limit still does. Leg 1's record is marked paid with the yes, so
   * no second payment ever joins it. Its own sheet comes first; the Safe's sheet for leg 1 comes next.
   */
  /**
   * `send` (Home's Send, D128: the pocket is no longer a pot with a $100 cap): the pocket pays its own share of a Send
   * straight out, on a Send's own words; the core's $100 is gone from it (the quote relay's own limit on one quote holds).
   */
  async privatePay(id: unknown, depositAddress: unknown, intent: unknown, why: unknown, statusTag?: unknown, inDeposit?: unknown, send?: unknown, payee?: unknown): Promise<{ signedData: ReturnType<typeof signNep413> }> {
    const w = await this.find(id);
    if (w.kind !== "private") throw new ProblemError(securityProblems.subwalletRefused("Only your private balance pays this way."));
    if (w.oldWords) throw new ProblemError(securityProblems.subwalletRefused("This private balance is from your old backup words. Its money moves to your new one. Nothing was paid."));
    const payload = (intent as { payload?: Nep413Payload } | null)?.payload;
    if (typeof depositAddress !== "string" || !payload || typeof payload.message !== "string" || typeof payload.nonce !== "string" || typeof payload.recipient !== "string") {
      throw new ProblemError(securityProblems.requestInvalid("Send the payment address and the private payment the swap service prepared for it."));
    }
    // The quote is read back by its address through the pinned quote server, never taken from the app.
    if (!this.o.privateStatus) throw new ProblemError(securityProblems.subwalletRefused("Private payments aren't set up on this phone yet."));
    // The relay shows a quote's full record only with the tag it gave with that quote (so no one can look payments up
    // by address). The tag opens the record; its terms count only as 1Click signed them, never the relay's or the app's.
    const tag = typeof statusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(statusTag) ? statusTag : undefined;
    const quote = parseQuote(await this.o.privateStatus(depositAddress, tag), depositAddress, this.o.quoteKey);
    const refusal = pocketIntentRefusal(payload, quote, depositAddress, w.address, Date.now()) ?? payeeRefusal(quote!, payee);
    if (refusal) throw new ProblemError(securityProblems.subwalletRefused(refusal));
    const usd = quote!.amountInUsd ?? "";
    const t = pocketTransfer(payload);
    if (typeof inDeposit === "string" || send === true) {
      // audit C1: the pocket's own share of a Send (no leg from the Safe, whose own sheet covers a Safe's Send) counts
      // against the one cap at 1Click's signed dollars; past it, one tap
      // (no price: sendPay refuses it by name, before any sheet)
      if (typeof inDeposit !== "string" && /^\d{1,12}(\.\d{1,18})?$/.test(usd)) {
        // QA's ruling (5 Nov): a Send out to an outside address asks Face ID every time, the fee said first. Not
        // now is the person's no (security.send.declined): the Send sheet takes the job away and says nothing was sent
        // (QA's lap, 5 Nov), never "ZeroFee said no"
        if (!(await this.ownPayee(quote!.recipient))) {
          if (!(await this.outsideSheet("private balance", quote!.recipient, usd, quote!.amountOutUsd, `$${Number(usd).toFixed(2)}`, landsWords(quote!)))) throw new ProblemError(securityProblems.sendDeclined("in your private balance"));
        } else {
          const capped = await this.capGate(Number(usd));
          if (capped && !(await this.capSheet("Send from your private balance", [`About $${Number(usd || 0).toFixed(2)} leaves your private balance.`], capped, "wallet"))) throw new ProblemError(securityProblems.sendDeclined("in your private balance"));
        }
      }
      const signed = await this.sendPay(w, payload, t, usd, typeof inDeposit === "string" ? inDeposit : undefined);
      // a Move's two legs to one payee, said on the Safe's one sheet from this record (privateLeg)
      if (typeof inDeposit === "string") {
        this.joinPrivateLeg(inDeposit, quote!, await this.ownPayee(quote!.recipient));
        // a Send's payout, bound to its move in before the Safe's one sheet (QA's MUST 1): that sheet says it
        this.sendPayouts.set(inDeposit, { recipient: quote!.recipient, recipientType: quote!.recipientType, originAsset: quote!.originAsset, destinationAsset: quote!.destinationAsset, amountIn: quote!.amountIn, amountOut: quote!.amountOut ?? "", ...(quote!.amountInUsd ? { amountInUsd: String(quote!.amountInUsd) } : {}), ...(quote!.amountOutUsd ? { amountOutUsd: String(quote!.amountOutUsd) } : {}) });
      }
      else this.notePocketShare(quote!);
      return signed;
    }
    // Up to the pocket's cap a payment, by 1Click's own signed price (the relay's cap, kept here too): no price, no payment.
    if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd) || Number(usd) > POCKET_PAYMENT_MAX_USD) throw new ProblemError(securityProblems.subwalletRefused(`A private send goes up to ${POCKET_MAX_TEXT}.`));
    // D143 (approval-policy.ts): the pocket is a hot key, so no sheet: Wallet's Send (its Hold) is the act, and only
    // Wallet or ZeroFee's own screens reach this (ownKind). Everything above is checked as 1Click signed it.
    // audit C1: under the one cap at 1Click's signed dollars; past it, one tap
    const capped = await this.capGate(Number(usd));
    if (capped && !(await this.capSheet("Pay from your private balance", [`About $${Number(usd).toFixed(2)} leaves your private balance.`], capped, "wallet", undefined, !(await this.ownPayee(quote!.recipient))))) throw new ProblemError(securityProblems.subwalletRefused("You said not now. Nothing moved."));
    return { signedData: signNep413(payload, await this.secret(w)) };
  }

  /** A move in's address marked paid, in one turn with every other change to the list, only if it isn't marked already
   *  (and, for a Safe's Send, only a `through` one): it is never paid, or joined, twice. */
  private markPaid(inDeposit: string, gone: string, through = false): Promise<void> {
    return this.turn("private-ins", async () => {
      const ins = await this.privateIns();
      if (!ins.some((k) => k.depositAddress === inDeposit && k.used !== true && (!through || k.through === true))) throw new ProblemError(securityProblems.subwalletRefused(gone));
      await this.o.vault.put(PRIVATE_INS, utf8(JSON.stringify(ins.map((k) => (k.depositAddress === inDeposit ? { ...k, used: true } : k)))));
    });
  }

  /**
   * privatePay for Home's Send (D128: no pot cap; a price still a must): the pocket's own share (`send`), or leg 2 of a
   * Send from the Safe (E4, `inDeposit`: joined to its leg 1, a kept unpaid `through` NEAR address read back as 1Click
   * signed it, which is marked paid with the yes so no second payment joins it). A Send's own sheet (send-words.ts).
   */
  private async sendPay(w: Stored, payload: Nep413Payload, t: ReturnType<typeof pocketTransfer>, usd: string, inDeposit?: string): Promise<{ signedData: ReturnType<typeof signNep413> }> {
    return (await sendWords()).sendPay({
      pocket: w.address,
      keptThrough: async (dep, now) => (await this.privateIns()).find((k) => k.depositAddress === dep && k.through === true && !k.outside && k.used !== true && now - k.atMs <= PRIVATE_IN_MS) ?? null,
      readQuote: async (dep, tag) => parseQuote(await this.o.privateStatus!(dep, tag), dep, this.o.quoteKey),
      markPaid: (dep, gone) => this.markPaid(dep, gone, true),
      sign: async () => signNep413(payload, await this.secret(w)),
      refused: (why) => new ProblemError(securityProblems.subwalletRefused(why)),
    }, t, usd, inDeposit) as Promise<{ signedData: ReturnType<typeof signNep413> }>;
  }

  /**
   * V4 Send: Hidden FROM a row, under ONE Approve (review, 3 Nov). Leg 1: the row's own coin (the SOL row's SOL, ETH on
   * Robinhood's ETH: HIDDEN_ROWS), from its wallet to the
   * 1Click address this core quoted itself (privateQuoteIn, outside: recipient and refunds Hidden's own). Leg 2: Hidden's
   * payment, exactly the one transfer its quote needs (pocketIntentRefusal). One sheet names both legs; after its yes,
   * leg 2 is signed and handed back, leg 1 is signed and sent. The app submits leg 2 ONLY after 1Click says leg 1 landed in
   * Hidden; until then, and if leg 1 comes back, the money is in Hidden. Leg 2 must be covered by leg 1's own signed
   * minimum, in the same coin, or nothing is asked. One at a time.
   * `coin` (the Send review, 5 Nov): a TOKEN the wallet holds instead of its own coin, by 1Click's id, only one pinned in
   * hidden-coins.ts for this chain (its mint or contract is the core's, never the app's). Leg 1 is then that token's own
   * transfer to 1Click's address, the wallet's coin paying only the network's fee (and on Solana the new token account).
   */
  async hiddenFromRow(chain: unknown, inDeposit: unknown, outDeposit: unknown, intent: unknown, outTag?: unknown, why?: unknown, payee?: unknown, coin?: unknown): Promise<{ leg1: TxOutcome; signedData?: ReturnType<typeof signNep413> }> {
    if (this.hiddenRowSending) throw new ProblemError(securityProblems.subwalletRefused("ZeroFee is still on your last private send from a wallet: it asks for one at a time."));
    this.hiddenRowSending = true;
    try {
      return await this.hiddenFromRowNow(chain, inDeposit, outDeposit, intent, outTag, why, payee, coin);
    } finally {
      this.hiddenRowSending = false;
    }
  }

  private async hiddenFromRowNow(chain: unknown, inDeposit: unknown, outDeposit: unknown, intent: unknown, outTag: unknown, _why: unknown, payee: unknown, coin: unknown): Promise<{ leg1: TxOutcome; signedData?: ReturnType<typeof signNep413> }> {
    const row = chain === "sol" || chain === "hood" ? HIDDEN_ROWS[chain] : undefined;
    if (!row) throw new ProblemError(securityProblems.subwalletRefused("A private send goes only from your SOL wallet or your ETH (RH) wallet. Nothing moved."));
    const token: HiddenCoin | null = coin === undefined ? null : hiddenCoin(coin, chain);
    if (coin !== undefined && !token) throw new ProblemError(securityProblems.subwalletRefused("Private can't take this yet. Nothing moved."));
    const leg1Coin = token ? (coin as string) : row.coin, symbol = token ? token.symbol : row.symbol;
    const given = (intent as { payload?: Nep413Payload } | null)?.payload;
    if (typeof inDeposit !== "string" || typeof outDeposit !== "string" || !given || typeof given.message !== "string" || typeof given.nonce !== "string" || typeof given.recipient !== "string") {
      throw new ProblemError(securityProblems.requestInvalid("Send both payment addresses and the private payment the swap service prepared."));
    }
    // copied once, here: what is checked is what is signed after the sheet, whatever the caller's object does (review L)
    const payload: Nep413Payload = { message: given.message, nonce: given.nonce, recipient: given.recipient, ...(given.callbackUrl !== undefined ? { callbackUrl: given.callbackUrl } : {}) };
    const list = await this.stored();
    const pocket = list.find(isPocket);
    if (!pocket) throw new ProblemError(securityProblems.subwalletRefused("Set up your private balance first."));
    if (!this.o.privateStatus) throw new ProblemError(securityProblems.subwalletRefused("Private payments aren't set up on this phone yet."));
    const now = Date.now();
    // Leg 1: only a move into Hidden this core quoted itself, still payable, read back as 1Click signed it.
    const kept = (await this.privateIns()).find((k) => k.depositAddress === inDeposit && k.outside === true && k.used !== true && now < (k.untilMs ?? k.atMs + PRIVATE_IN_MS));
    if (!kept) throw new ProblemError(securityProblems.subwalletRefused("This private move wasn't priced here, or its price ran out. Nothing moved."));
    const q1 = parseQuote(await this.o.privateStatus(inDeposit, kept.tag), inDeposit, this.o.quoteKey);
    const leg1Ok = q1 && q1.status === "PENDING_DEPOSIT" && Date.parse(q1.deadline) > now && q1.originAsset === leg1Coin && q1.destinationAsset === leg1Coin && q1.depositType === "ORIGIN_CHAIN" &&
      q1.swapType === "EXACT_INPUT" && q1.recipient === pocket.address && q1.recipientType === "CONFIDENTIAL_INTENTS" && q1.refundTo === pocket.address && q1.refundType === "CONFIDENTIAL_INTENTS" &&
      !q1.depositMemo && /^\d{1,30}$/.test(q1.amountIn) && /^\d{1,30}$/.test(q1.minAmountOut);
    // on Robinhood Chain the address paid is an EVM one (a plain transfer to it, nothing else)
    if (!leg1Ok || (chain === "hood" && !/^0x[0-9a-fA-F]{40}$/.test(inDeposit))) throw new ProblemError(securityProblems.subwalletRefused("The price for this private move isn't the one asked for. Nothing moved."));
    // Leg 2: exactly the one transfer its own quote needs, from Hidden.
    const tag = typeof outTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(outTag) ? outTag : undefined;
    const q2 = parseQuote(await this.o.privateStatus(outDeposit, tag), outDeposit, this.o.quoteKey);
    const refusal = pocketIntentRefusal(payload, q2, outDeposit, pocket.address, now) ?? payeeRefusal(q2!, payee);
    if (refusal) throw new ProblemError(securityProblems.subwalletRefused(refusal));
    // a price is still a must (1Click's signed dollars); the pot's $100 isn't, on a Send (D128: leg 2 pays only what leg 1
    // brings, by the join below). The quote relay's own limit on one quote still holds, and says so by name.
    const usd = q2!.amountInUsd ?? "";
    if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd)) throw new ProblemError(securityProblems.subwalletRefused("The swap service gave this payment no price, so it can't go. Nothing moved."));
    const t = pocketTransfer(payload);
    // The join: leg 2 pays only what leg 1 promises to bring, in that same coin (never Hidden's other money by surprise).
    // Its payout may be any coin on any chain 1Click pays (the Home plan E3): the sheet names it and its network.
    if (t.tokenId !== q1!.destinationAsset || BigInt(t.amount) > BigInt(q1!.minAmountOut)) {
      throw new ProblemError(securityProblems.subwalletRefused("This private move may bring less than the payment needs. Nothing moved."));
    }
    // The row's current wallet, holding enough for leg 1.
    const current = await this.currentIds(list);
    const w = list.find((x) => x.chain === chain && current.has(x.id) && isChainWallet(x));
    if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
    const units = BigInt(q1!.amountIn);
    const native = BigInt((await this.balances(w.id)).find((r) => r.token === "native")?.amount ?? "0");
    const held = token ? await this.tokenHeld(w, token) : native;
    if (held < units) throw new ProblemError(securityProblems.notEnoughCoin(symbol));
    // room for the network's fee, so a short row stops here, before the sheet (review L). Solana: its fee and the account's
    // own minimum. Robinhood Chain: this transfer's own gas at today's fees (two nodes, plainEvm) and FEE_ROOM over it; the
    // transfer is later signed at no more than that room (payPlain's feeAtMost), so what was checked here is what can leave.
    // A token: the wallet's own coin pays the fee alone (Solana: and the rent of 1Click's new token account, held there).
    const room = chain === "sol" ? HIDDEN_ROW_SOL_ROOM + (token ? SOL_TOKEN_ACCOUNT_RENT : 0n) : token ? await this.hiddenRowGasRoom(w, token.address, 0n, erc20TransferData(inDeposit, units)) : await this.hiddenRowGasRoom(w, inDeposit, units);
    if ((token ? native : held) < (token ? room : units + room)) throw new ProblemError(securityProblems.notEnoughCoin(row.symbol));
    // QA's ruling (5 Nov): to an outside address, Face ID every time with the full address and the fee (what
    // leaves the wallet, leg 1's signed dollars, against what the payee gets, leg 2's); to the person's own wallet, as
    // before: audit C1's one cap at 1Click's signed dollars, past it one tap
    if (!(await this.ownPayee(q2!.recipient))) {
      // Not now: the person's no (security.send.declined), never "ZeroFee said no" (QA's lap, 5 Nov)
      if (!(await this.outsideSheet(row.row, q2!.recipient, q1!.amountInUsd ?? usd, q2!.amountOutUsd, `${fromUnitsText(units, token ? token.decimals : chain === "sol" ? 9 : 18)} ${symbol}`, landsWords(q2!)))) throw new ProblemError(securityProblems.sendDeclined(`in your ${row.row}`));
    } else {
      // QA's lap (5 Nov): the wallet's own name ("your ETH (RH) wallet", HIDDEN_ROWS), never its kind
      // ("your Chain wallet", the core's stored label for every chain wallet)
      const capped = await this.capGate(Number(usd));
      if (capped && !(await this.capSheet(`Send from your ${row.row}`, [`About $${Number(usd).toFixed(2)} leaves your ${row.row}.`], capped, "wallet"))) throw new ProblemError(securityProblems.sendDeclined(`in your ${row.row}`));
    }
    // D143 (approval-policy.ts): the row's wallet and the pocket are hot keys, so no sheet: Wallet's Send (its Hold) is
    // the act, and only Wallet reaches this (demo-core). Both legs are checked above as 1Click signed them.
    // Leg 2 signed (held by the app until leg 1 lands), then leg 1 built, signed and sent here.
    const signedData = signNep413(payload, await this.secret(pocket));
    // this quote's address is paid once (review L): marked before anything is sent, so a send that errs on this side but
    // reached a node is never followed by a second deposit into it from here
    // In one turn with every other change to the list (security review 3 Nov: a quote written meanwhile could carry the old
    // list back, without the mark), and only if it isn't marked already.
    await this.markPaid(inDeposit, "This private move wasn't priced here, or its price ran out. Nothing moved.");
    // Leg 2 is handed back only when both nodes have leg 1 done (review M): not sent, failed or unconfirmed, it is dropped
    // (nothing reached 1Click, or what did lands in Hidden by its quote: recipient and refunds Hidden's own)
    const handed = { yes: false };
    let leg1: TxOutcome;
    try {
      leg1 = chain === "sol" ? await this.hiddenRowSol(w, inDeposit, units, handed, token) : token ? await this.hiddenRowEvm(w, token.address, 0n, room, handed, erc20TransferData(inDeposit, units)) : await this.hiddenRowEvm(w, inDeposit, units, room, handed);
    } finally {
      // Leg 1 never handed to a node (its fee, its number or its blockhash refused it first): nothing can land, so its price
      // stops counting toward Hidden's $100 at once and comes off the list, which also means it is never paid from here
      // (security review 3 Nov). Handed to a node and not taken, it may still land: it counts until its deadline.
      if (!handed.yes) await this.editIns((ins) => ins.filter((k) => k.depositAddress !== inDeposit));
    }
    return leg1.status === "done" ? { leg1, signedData } : { leg1 };
  }

  /** Leg 1 on Robinhood Chain: the core's own plain transfer (payPlain: nonce after this wallet's unlanded ones, two nodes'
   *  gas, today's fees, never more than `feeAtMost`), sent and confirmed on both nodes, with no sheet of its own. */
  private async hiddenRowEvm(w: Stored, to: string, units: bigint, feeAtMost: bigint, handed: { yes: boolean }, data?: string): Promise<TxOutcome> {
    const chain = w.chain as EvmChainName;
    const network = EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME];
    let hash: string;
    try {
      hash = await this.payPlain(w, to, units, feeAtMost, async () => void (handed.yes = true), data);
    } catch (e) {
      return { status: "problem", problem: e instanceof ProblemError ? e.problem : securityProblems.subwalletNotSent(network) };
    }
    return this.confirmed(() => this.o.evm.receipt(chain, hash), hash, `${EVM_EXPLORER[chain]}${hash}`, network);
  }

  /** What the wallet can send of a pinned token (hidden-coins.ts), in its units: on Solana its associated token account
   *  for the mint only, the one leg 1's TransferChecked pays from (QA, 5 Nov: coins in any other account of the
   *  mint don't count, so a short associated account stops here, before a fee is spent); the ERC-20's balanceOf on
   *  Robinhood Chain. Not readable: the chain's own words, never "none". */
  private async tokenHeld(w: Stored, token: HiddenCoin): Promise<bigint> {
    try {
      if (w.chain === "sol") {
        if (!this.o.sol.tokenAccounts) throw new Error("no reader");
        const own = ownTokenAccount(w.address, token.address);
        return (await this.o.sol.tokenAccounts(w.address)).filter((a) => a.mint === token.address && a.account === own).reduce((t, a) => t + a.amount, 0n);
      }
      return await this.o.evm.tokenBalance(w.chain as EvmWalletChain, token.address, w.address);
    } catch {
      throw new ProblemError(securityProblems.chainUnreachable(w.chain));
    }
  }

  /** Room for Robinhood Chain's fee on leg 1, read before the sheet: never past what ZeroFee pays there (FEE_CAPS). */
  private async hiddenRowGasRoom(w: Stored, to: string, units: bigint, data?: string): Promise<bigint> {
    const chain = w.chain as EvmChainName;
    let gas: bigint, fees: { tip: bigint; maxFee: bigint };
    try {
      ({ gas, fees } = await this.plainEvm(w, to, units, data));
    } catch (e) {
      throw e instanceof ProblemError ? e : new ProblemError(securityProblems.chainUnreachable(chain));
    }
    if (fees.maxFee > FEE_CAPS[chain].maxFee || fees.tip > FEE_CAPS[chain].tip) throw new ProblemError(securityProblems.feeHigh(EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME]));
    return (gas * fees.maxFee * FEE_ROOM_PCT) / 100n;
  }

  /** Leg 1 on Solana: the row's SOL to 1Click's address, signed and sent here, confirmed on both nodes. */
  private async hiddenRowSol(w: Stored, inDeposit: string, units: bigint, handed: { yes: boolean }, token?: HiddenCoin | null): Promise<TxOutcome> {
    const { send, status, latestBlockhash } = this.o.sol;
    if (!send || !status || !latestBlockhash) throw new ProblemError(securityProblems.chainUnreachable("sol"));
    const blockhash = await latestBlockhash.call(this.o.sol).catch(() => {
      throw new ProblemError(securityProblems.chainUnreachable("sol"));
    });
    const tx = token ? solTokenSendTx(w.address, inDeposit, token.address, units, token.decimals, blockhash) : solTransferTx(w.address, inDeposit, units, blockhash);
    const signed = signSolTx(tx, await this.secret(w));
    const signature = base58(fromBase64(signed).subarray(1, 65));
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    handed.yes = true;
    if (!(await send.call(this.o.sol, signed).catch(() => false))) return { status: "problem", problem: securityProblems.subwalletNotSent("Solana") };
    return this.confirmed(() => status.call(this.o.sol, signature), signature, explorerUrl, "Solana");
  }

  /** The web Send's quotes this core asked itself (sendPrivate): their status tags, so only it reads who they pay. */
  private readonly directSends = new Map<string, string | undefined>();

  /**
   * The web wallet's Send (the HARD RULE: every money move through NEAR Confidential; QA's real path for
   * WEB_SEND_OPEN, 5 Nov): ONE confidential 1Click quote from a hot wallet straight to the payee, no pocket. 1Click's
   * confidential swaps (docs.near-intents.org, confidential-swaps: "deposits and withdrawals can't be tracked to each
   * other") take a foreign-to-foreign quote with `confidentiality: basic`. The core asks the pinned relay for it itself
   * (recipient the payee on its own chain, refunds to this same wallet on its own chain), reads it back as 1Click SIGNED
   * it, and only then shows the outside sheet (the web: the password with Approve, the sheet's 700 ms arm; the full
   * address, what they get and the fee from 1Click's signed dollars). After its yes it pays exactly that quote's address
   * with the wallet's own coin (leg 1's code, hiddenRowSol / hiddenRowEvm) and hands 1Click the transaction (a hint).
   * `chain`: "sol" | "hood"; `to`: the payee's address; `toTokenId`: the coin it pays and lands as (1Click's id: the wallet's own, or a token pinned in hidden-coins.ts for this chain, W4); `amount`: the
   * wallet's coin, decimal text. Only Wallet's own Send (demo-core); one at a time with the row's private send.
   */
  async sendPrivate(chain: unknown, to: unknown, toTokenId: unknown, amount: unknown, app: string): Promise<{ sent: TxOutcome; depositAddress: string; amountOut: string; amountOutUsd?: string; amountInUsd: string }> {
    if (app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets."));
    if (this.hiddenRowSending) throw new ProblemError(securityProblems.subwalletRefused("ZeroFee is still on your last private send from a wallet: it asks for one at a time."));
    this.hiddenRowSending = true;
    try {
      return await this.sendPrivateNow(chain, to, toTokenId, amount);
    } catch (e) {
      // rule 8 (W4, 5 Nov): a check on the route or on 1Click's quote said no. Said by name, never "This wallet can't
      // approve this" or "in that wallet": the check's own words (what failed, by who), the wallet the money is in, retry
      if (e instanceof ProblemError && e.problem.code === "security.subwallet.refused" && typeof e.problem.more === "string") {
        const row = chain === "sol" || chain === "hood" ? HIDDEN_ROWS[chain].row : "wallet";
        const cut = /^(.*?Nothing moved\.)\s*([\s\S]*)$/.exec(e.problem.more);
        throw new ProblemError(securityProblems.sendPrivateRefused(cut ? cut[1]! : e.problem.more, row, e.problem.more));
      }
      throw e;
    } finally {
      this.hiddenRowSending = false;
    }
  }

  private async sendPrivateNow(chain: unknown, to: unknown, toTokenId: unknown, amount: unknown): Promise<{ sent: TxOutcome; depositAddress: string; amountOut: string; amountOutUsd?: string; amountInUsd: string }> {
    const row = chain === "sol" || chain === "hood" ? HIDDEN_ROWS[chain] : undefined;
    if (!row) throw new ProblemError(securityProblems.subwalletRefused("A private send goes only from your SOL wallet or your ETH (RH) wallet. Nothing moved."));
    // the payee as typed: one address, no spaces, never a 64-hex account (that's a confidential balance, not a payout)
    if (typeof to !== "string" || !/^[A-Za-z0-9._:-]{2,128}$/.test(to) || /^[0-9a-f]{64}$/.test(to)) throw new ProblemError(securityProblems.requestInvalid("to is the payee's address on its own network"));
    // the same coin on the same network only (QA MUST, 5 Nov: the relay takes nothing wider): the wallet's own
    // coin, or (W4, every coin held) a token pinned for this chain in hidden-coins.ts, its mint or contract the core's own
    // (never the app's), the same table and the same leg 1 transfer as the phone's Send of a token (hiddenFromRow `coin`)
    const token: HiddenCoin | null = toTokenId === row.coin ? null : hiddenCoin(toTokenId, chain);
    if (toTokenId !== row.coin && !token) throw new ProblemError(securityProblems.requestInvalid("toTokenId is the wallet's own coin or a token it sends privately: it lands as itself"));
    const coinId = toTokenId as string, symbol = token ? token.symbol : row.symbol;
    const decimals = token ? token.decimals : chain === "sol" ? 9 : 18;
    const m = typeof amount === "string" ? /^(\d{1,30})(?:\.(\d+))?$/.exec(amount) : null;
    if (!m || (m[2]?.length ?? 0) > decimals) throw new ProblemError(securityProblems.requestInvalid("amount is the coin's decimal text"));
    const units = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
    if (units === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is more than nothing"));
    const relay = this.o.floatRelay;
    if (!relay || !this.o.privateStatus) throw new ProblemError(securityProblems.subwalletRefused("Private payments aren't set up on this phone yet."));
    const list = await this.stored();
    const current = await this.currentIds(list);
    const w = list.find((x) => x.chain === chain && current.has(x.id) && isChainWallet(x));
    if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
    // enough for the payment and its network fee, read before any price (a short wallet stops here, nothing asked). A
    // token: the token itself (tokenHeld: on Solana only its own associated account), the wallet's coin paying the fee
    // alone (and on Solana the rent of 1Click's new token account); on Robinhood Chain that fee is read again for the
    // transfer to 1Click's own address once it is known, and the transfer is signed at no more than it
    const native = BigInt((await this.balances(w.id)).find((r) => r.token === "native")?.amount ?? "0");
    const held = token ? await this.tokenHeld(w, token) : native;
    if (held < units) throw new ProblemError(securityProblems.notEnoughCoin(symbol));
    const probe = chain === "sol" ? "" : w.address;
    let room = chain === "sol" ? HIDDEN_ROW_SOL_ROOM + (token ? SOL_TOKEN_ACCOUNT_RENT : 0n) : token ? await this.hiddenRowGasRoom(w, token.address, 0n, erc20TransferData(w.address, units)) : await this.hiddenRowGasRoom(w, probe, units);
    if ((token ? native : held) < (token ? room : units + room)) throw new ProblemError(securityProblems.notEnoughCoin(row.symbol));
    const raw = await relay
      .quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: coinId, depositType: "ORIGIN_CHAIN", destinationAsset: coinId, amount: units.toString(),
        refundTo: w.address, refundType: "ORIGIN_CHAIN", recipient: to, recipientType: "DESTINATION_CHAIN",
        deadline: quoteDeadline(Date.now(), 10 * 60_000), confidentiality: "basic",
      })
      .catch((e: unknown) => {
        if (e instanceof ProblemError) throw e;
        if ((e as { code?: unknown } | null)?.code === "quotes.request.too-big") throw new ProblemError(securityProblems.subwalletRefused(`ZeroFee's price server takes up to ${/\$\d[\d,]*(\.\d+)?/.exec(String((e as Error)?.message ?? ""))?.[0] ?? POCKET_MAX_TEXT} a send. Nothing moved.`));
        throw new ProblemError(securityProblems.subwalletRefused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`));
      });
    const depositAddress = raw?.quote?.depositAddress;
    const shape = chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/;
    if (typeof depositAddress !== "string" || !shape.test(depositAddress)) throw new ProblemError(securityProblems.subwalletRefused("NEAR Intents gave no address to pay. Nothing moved."));
    const tag = typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag) ? raw.zerofeeStatusTag : undefined;
    // What counts is 1Click's own signed quote for that address, never the relay's answer above.
    const q = parseQuote(await this.o.privateStatus(depositAddress, tag), depositAddress, this.o.quoteKey);
    const sameAddress = (a: string, b: string) => (chain === "hood" ? a.toLowerCase() === b.toLowerCase() : a === b);
    const ok =
      q && q.status === "PENDING_DEPOSIT" && Date.parse(q.deadline) > Date.now() && q.originAsset === coinId && q.destinationAsset === coinId && q.depositType === "ORIGIN_CHAIN" &&
      q.swapType === "EXACT_INPUT" && q.recipient === to && q.recipientType === "DESTINATION_CHAIN" && sameAddress(q.refundTo, w.address) && q.refundType === "ORIGIN_CHAIN" &&
      q.confidentiality === "basic" && !q.depositMemo && q.amountIn === units.toString() && /^\d{1,30}$/.test(q.amountOut ?? "") && BigInt(q.amountOut ?? "0") > 0n;
    if (!ok) throw new ProblemError(securityProblems.subwalletRefused("NEAR Intents priced it differently than asked. Nothing moved."));
    const usd = q!.amountInUsd ?? "";
    const out = q!.amountOut ?? "0";
    if (!/^\d{1,12}(\.\d{1,18})?$/.test(usd)) throw new ProblemError(securityProblems.subwalletRefused("The swap service gave this payment no price, so it can't go. Nothing moved."));
    // a token on Robinhood Chain: its fee read again for the transfer to this very address, before the sheet
    if (token && chain === "hood") {
      room = await this.hiddenRowGasRoom(w, token.address, 0n, erc20TransferData(depositAddress, units));
      if (native < room) throw new ProblemError(securityProblems.notEnoughCoin(row.symbol));
    }
    // to an outside address: its sheet every time (the web: the password with Approve); to one's own wallet: the one cap
    if (!(await this.ownPayee(to))) {
      if (!(await this.outsideSheet(row.row, to, usd, q!.amountOutUsd, `${fromUnitsText(units, decimals)} ${symbol}`, landsWords(q!)))) return { sent: { status: "declined" }, depositAddress, amountOut: out, amountInUsd: usd };
    } else {
      const capped = await this.capGate(Number(usd));
      if (capped && !(await this.capSheet(`Send from your ${w.label}`, [`About $${Number(usd).toFixed(2)} leaves the wallet.`], capped, "wallet"))) return { sent: { status: "declined" }, depositAddress, amountOut: out, amountInUsd: usd };
    }
    this.directSends.set(depositAddress, tag);
    const handed = { yes: false };
    const sent = chain === "sol" ? await this.hiddenRowSol(w, depositAddress, units, handed, token) : token ? await this.hiddenRowEvm(w, token.address, 0n, room, handed, erc20TransferData(depositAddress, units)) : await this.hiddenRowEvm(w, depositAddress, units, room, handed);
    // the transaction handed to 1Click so it needn't find it (a hint; 1Click still checks the chain)
    if (sent.status === "done" && sent.txHash) void relay.submitDeposit?.(depositAddress, sent.txHash, tag)?.catch(() => undefined);
    return { sent, depositAddress, amountOut: out, ...(q!.amountOutUsd ? { amountOutUsd: q!.amountOutUsd } : {}), amountInUsd: usd };
  }

  /**
   * The web Send's tokens (W4, every coin held): what the SOL and ETH (RH) wallets hold of each token the core sends
   * privately (hidden-coins.ts), read on the core's own nodes the way the Send itself reads it (tokenHeld: Solana's one
   * getTokenAccountsByOwner, only the mint's own associated account counted; one balanceOf per pinned ERC-20 on
   * Robinhood Chain). Display only: the Send reads the coin again before any price. A wallet whose read fails gives none.
   */
  async sendCoins(): Promise<{ chain: "sol" | "hood"; address: string; symbol: string; amount: string }[]> {
    const list = await this.stored();
    const current = await this.currentIds(list);
    const pinned = Object.values(HIDDEN_COINS);
    const of = async (chain: "sol" | "hood") => {
      const w = list.find((x) => x.chain === chain && current.has(x.id) && isChainWallet(x));
      const mine = pinned.filter((c) => c.chain === chain);
      if (!w || !mine.length) return [];
      try {
        if (chain === "sol") {
          if (!this.o.sol.tokenAccounts) return [];
          const accounts = await this.o.sol.tokenAccounts(w.address);
          return mine.map((c) => ({ c, units: accounts.filter((a) => a.mint === c.address && a.account === ownTokenAccount(w.address, c.address)).reduce((t, a) => t + a.amount, 0n) }));
        }
        return await Promise.all(mine.map(async (c) => ({ c, units: await this.o.evm.tokenBalance(chain, c.address, w.address) })));
      } catch {
        return [];
      }
    };
    const rows = (await Promise.all([of("sol"), of("hood")])).flat();
    return rows.filter((r) => r.units > 0n).map(({ c, units }) => ({ chain: c.chain, address: c.address, symbol: c.symbol, amount: fromUnitsText(units, c.decimals) }));
  }

  /** How a web Send this core quoted is going, by 1Click's own status (its kept tag): "PENDING_DEPOSIT", "PROCESSING",
   *  "SUCCESS", "REFUNDED", "FAILED"… An address it never quoted: refused. */
  async sendPrivateStatus(depositAddress: unknown): Promise<{ status: string }> {
    if (typeof depositAddress !== "string" || !this.directSends.has(depositAddress) || !this.o.privateStatus) throw new ProblemError(securityProblems.requestInvalid("depositAddress is a web Send's own"));
    const raw = (await this.o.privateStatus(depositAddress, this.directSends.get(depositAddress))) as { status?: unknown } | null;
    const status = typeof raw?.status === "string" && /^[A-Z_]{2,32}$/.test(raw.status) ? raw.status : "UNKNOWN";
    return { status };
  }

  /**
   * A site's call (D29 wallet mode, `subwallet.sign` with `call`): the core picks the nonce, fees and gas on its own two
   * nodes, checks it as signTx does (no sheet, D143), signs, sends to both nodes, and confirms on both. Never a contract
   * creation. `own`: sendPlain's own transfer (OWN_SEND).
   */
  async sendCall(id: unknown, call: unknown, why: unknown, site: unknown, asker?: string, app?: string, own?: typeof OWN_SEND): Promise<TxOutcome> {
    const w = await this.find(id);
    if (!isChainWallet(w) && w.kind !== "pay" && !isSiteWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("Only your chain wallets, a site's own wallet and the card's wallet send for a site."));
    // audit C1: a site never uses a shared chain wallet; refused before any node is asked
    if (site !== undefined && isChainWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("This site can use only its own wallet."));
    if (w.chain === "sol" || w.chain === "near") throw new ProblemError(securityProblems.requestInvalid("call is for an EVM wallet"));
    const chain = w.chain;
    const c = (call ?? {}) as { to?: unknown; value?: unknown; data?: unknown; gas?: unknown };
    const whole = (v: unknown, what: string, max: bigint): bigint | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v !== "string" || !/^(\d{1,78}|0x[0-9a-fA-F]{1,64})$/.test(v) || BigInt(v) > max) throw new ProblemError(securityProblems.requestInvalid(`${what} is a whole number, as text`));
      return BigInt(v);
    };
    if (typeof c.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(c.to)) throw new ProblemError(securityProblems.requestInvalid("call.to is the address it goes to (a contract creation isn't sent)"));
    const data = c.data ?? "0x";
    if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2}){0,131072}$/.test(data)) throw new ProblemError(securityProblems.requestInvalid("call.data is hex bytes, at most 128 KB"));
    const value = whole(c.value, "call.value", (1n << 256n) - 1n) ?? 0n;
    const askedGas = whole(c.gas, "call.gas", 30_000_000n);
    const to = c.to.toLowerCase();
    const evm = this.o.evm;

    // this wallet's turn, from its next number to the nodes (L1): a send already under way finishes first
    const sent: TxOutcome | { hash: string; explorerUrl: string } = await this.walletTurn(w, async () => {
      let nonce: number;
      let fees: { tip: bigint; maxFee: bigint };
      try {
        [{ nonce }, fees] = await Promise.all([this.evmNonce(w, chain), evm.fees(chain)]);
      } catch (e) {
        throw e instanceof ProblemError ? e : new ProblemError(securityProblems.chainUnreachable(w.chain));
      }
      let gas: bigint;
      try {
        // review M6: the site's own gas is never taken (a run can't show what a high limit burns at a real fee): the
        // nodes' estimate, a fifth over; `askedGas` is still read so a malformed one is refused
        void askedGas;
        gas = ((await evm.estimateGas(chain, { from: w.address, to, value, data })) * 6n) / 5n;
      } catch {
        throw new ProblemError(securityProblems.subwalletRefused("Both network servers' test runs refused it, so it can't go."));
      }
      if (gas < 21_000n) gas = 21_000n;
      const tx = unsignedEvmTx({ chainId: EVM_CHAIN_ID[chain], nonce, tip: fees.tip, fee: fees.maxFee, gas, to, value, data });
      this.held.set(w.id, fromBase64(tx));
      const signed = await this.signTx(w.id, tx, why, undefined, asker, site, app, undefined, own);
      if ("declined" in signed) return { status: "declined" } as const;
      const hash = toHex(keccak_256(fromBase64(signed.signedTx)));
      const explorerUrl = `${EVM_EXPLORER[chain]}${hash}`;
      if (!(await evm.send(chain, signed.signedTx).catch(() => false))) {
        this.pending.set(w.id, (this.pending.get(w.id) ?? []).filter((x) => x.nonce !== nonce));
        return { status: "problem", problem: securityProblems.subwalletNotSent(EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME]) } as const;
      }
      return { hash, explorerUrl };
    });
    if (!("hash" in sent)) return sent;
    const out = await this.confirmed(() => evm.receipt(chain, sent.hash), sent.hash, sent.explorerUrl, EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME]);
    // a site wallet's coin list knows what its own transactions bought (site-coins.ts): never in the way of the answer
    if (isSiteWallet(w) && out.status === "done") void this.noteCoins(w, sent.hash).catch(() => undefined);
    return out;
  }

  /** A Solana transaction a site asks for, sent and confirmed by the core: checked as signTx does (no sheet, D143), then
   *  both nodes. `own`: sendPlain's own transfer (OWN_SEND). */
  async sendSol(id: unknown, txB64: unknown, why: unknown, site: unknown, asker?: string, app?: string, own?: typeof OWN_SEND): Promise<TxOutcome> {
    const w = await this.find(id);
    if (w.chain !== "sol") throw new ProblemError(securityProblems.requestInvalid("an EVM wallet sends { call }; tx is for a Solana wallet"));
    if (!isChainWallet(w) && w.kind !== "extension" && !isSiteWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("Only your Solana wallet, a site's own wallet and the extension's wallet send for a site."));
    // audit C1: a site never uses a shared chain wallet
    if (site !== undefined && isChainWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("This site can use only its own wallet."));
    const { send, status } = this.o.sol;
    if (!send || !status) throw new ProblemError(securityProblems.chainUnreachable("sol"));
    const signed = await this.signTx(w.id, txB64, why, undefined, asker, site, app, undefined, own);
    if ("declined" in signed) return { status: "declined" };
    // The wallet is the only signer (signableReason), so its signature is the first, and names the transaction.
    const signature = base58(fromBase64(signed.signedTx).subarray(1, 65));
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    if (!(await send.call(this.o.sol, signed.signedTx).catch(() => false))) return { status: "problem", problem: securityProblems.subwalletNotSent("Solana") };
    return this.confirmed(() => status.call(this.o.sol, signature), signature, explorerUrl, "Solana");
  }

  /**
   * Wallet's own Send from a chain wallet (subwallet.send): a plain transfer from that chain's current wallet of its own
   * coin, or on an EVM chain of a coin ZeroFee lists there (`token`, KNOWN_COINS). `amount` is the coin's decimal text
   * ("0.25"). Built here, never by the app; then sent and confirmed as a site's is. D143: no sheet, the person's Hold to
   * send in Wallet is the act, so only Wallet's own call sends this way (a hot key pays an outside address only then).
   * Not enough in the wallet: security.balance.low-coin before anything is signed.
   */
  async sendPlain(chain: unknown, to: unknown, amount: unknown, token: unknown, asker: string, app: string, outsideGate?: () => Promise<void>): Promise<TxOutcome> {
    if (app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets."));
    if (this.plainSending) throw new ProblemError(securityProblems.subwalletRefused("ZeroFee is still on your last plain payment: it asks for one at a time."));
    this.plainSending = true;
    try {
      return await this.sendPlainNow(chain, to, amount, token, asker, app, outsideGate);
    } finally {
      this.plainSending = false;
    }
  }

  private async sendPlainNow(chain: unknown, to: unknown, amount: unknown, token: unknown, asker: string, app: string, outsideGate?: () => Promise<void>): Promise<TxOutcome> {
    const evmChain = chain === "bsc" || chain === "hood" || BROWSER_EVM.includes(chain as EvmWalletChain);
    if (chain !== "sol" && !evmChain) throw new ProblemError(securityProblems.subwalletChain());
    if (typeof to !== "string" || !(chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to) : /^0x[0-9a-fA-F]{40}$/.test(to))) throw new ProblemError(securityProblems.requestInvalid("to is an address on that network"));
    // Mixed capitals that aren't the address's EIP-55 checksum: a typo or a changed character, never lower-cased past.
    if (chain !== "sol" && !checksumOk(to)) throw new ProblemError(securityProblems.requestInvalid("to's capital letters don't match its checksum: it may have a typo"));
    const coin = token === undefined ? undefined : chain === "sol" ? null : (KNOWN_COINS[chain as EvmWalletChain] ?? []).find((c) => typeof token === "string" && c.token === token.toLowerCase()) ?? null;
    if (coin === null) throw new ProblemError(securityProblems.requestInvalid(chain === "sol" ? "from the Solana wallet, only SOL goes" : "token is a coin ZeroFee lists on that network"));
    const decimals = coin ? coin.decimals : chain === "sol" ? 9 : 18;
    const m = typeof amount === "string" ? /^(\d{1,30})(?:\.(\d+))?$/.exec(amount) : null;
    if (!m || (m[2]?.length ?? 0) > decimals) throw new ProblemError(securityProblems.requestInvalid("amount is the coin's decimal text"));
    const units = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
    if (units === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is more than nothing"));
    const list = await this.stored();
    const current = await this.currentIds(list);
    const w = list.find((x) => x.chain === chain && current.has(x.id));
    if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
    const held = (await this.balances(w.id)).find((r) => r.token === (coin ? coin.token : "native"));
    const symbol = coin ? coin.symbol : chain === "sol" ? "SOL" : NATIVE[chain as EvmWalletChain];
    if (!held || BigInt(held.amount) < units) throw new ProblemError(securityProblems.notEnoughCoin(symbol));
    const outside = !(await this.ownPayee(to));
    // Decision A (5 Nov): the web wallet asks its password on EVERY send to an address that isn't one of the
    // person's own, whatever the amount; a wrong or missing one throws here, before the cap counts it or anything is
    // signed. Its own wallets stay as they were. `outsideGate` is the web door's check (DemoCore), absent on the phone.
    if (outside && outsideGate) await outsideGate();
    // audit C1: Wallet's Hold is a control in the page (on the phone its app id is the page's own claim): a send counts
    // against the one cap like every no-sheet signature, and past it asks, one tap
    const price = coin ? COIN_USD[coin.symbol] ?? null : await this.hotPrice(chain as "sol" | EvmWalletChain);
    const usd = price === null ? null : (Number(units) / 10 ** decimals) * price;
    // QA's ruling (5 Nov): a send to an outside address asks every time, at any amount, never counted against
    // the no-sheet cap: on the web its password, once (decision A's outsideGate above, which already ran and threw on a
    // wrong or missing one: no second ask); on the phone Face ID on the sheet. To the person's own wallet, the one cap
    // and past it one tap (decision C).
    if (outside) {
      if (!outsideGate && !(await this.o.approve({ title: OUTSIDE_WORDS.title(chain === "sol" ? "SOL wallet" : chain === "hood" ? "ETH (RH) wallet" : w.label), ...outsideLines(to, undefined, undefined, CHAIN_WORDS[chain as string] ?? null), effect: [], amount: usd === null ? `${amount} ${symbol}` : `$${usd.toFixed(2)} (${amount} ${symbol})`, asker: app }).catch(() => false))) return { status: "declined" };
    } else {
      const capped = await this.capGate(usd);
      if (capped && !(await this.capSheet(`Send ${amount} ${symbol}`, [`To ${to}`, `From your ${w.label}`], capped, app, usd === null ? undefined : `$${usd.toFixed(2)} (${amount} ${symbol})`))) return { status: "declined" };
    }
    if (chain === "sol") {
      const { latestBlockhash } = this.o.sol;
      if (!latestBlockhash) throw new ProblemError(securityProblems.chainUnreachable("sol"));
      // The nodes not agreeing on a blockhash is theirs to say, never "to is another address" (mainnet 2 Nov).
      const blockhash = await latestBlockhash.call(this.o.sol).catch(() => {
        throw new ProblemError(securityProblems.chainUnreachable("sol"));
      });
      let tx: string;
      try {
        tx = solTransferTx(w.address, to, units, blockhash);
      } catch {
        throw new ProblemError(securityProblems.requestInvalid("to is another address"));
      }
      return this.sendSol(w.id, tx, undefined, undefined, asker, app, OWN_SEND);
    }
    const call = coin
      ? { to: coin.token, data: `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${units.toString(16).padStart(64, "0")}` }
      : { to, value: units.toString() };
    return this.sendCall(w.id, call, undefined, undefined, asker, app, OWN_SEND);
  }

  /** Done only when both nodes have it, ok; failed when both say so; nodes that disagree say so; else "not yet". */
  private async confirmed(seenNow: () => Promise<("ok" | "failed" | null)[]>, txHash: string, explorerUrl: string, network?: string): Promise<TxOutcome> {
    const { everyMs, forMs } = this.o.confirm ?? { everyMs: 2000, forMs: 90_000 };
    for (let waited = 0; waited <= forMs; waited += everyMs) {
      const seen = await seenNow().catch((): ("ok" | "failed" | null)[] => [null, null]);
      if (seen.includes("ok") && seen.includes("failed")) return { status: "problem", problem: securityProblems.nodesDisagree() };
      if (seen.length === 2 && seen.every((x) => x === "ok")) return { status: "done", txHash, explorerUrl };
      if (seen.length === 2 && seen.every((x) => x === "failed")) return { status: "problem", problem: securityProblems.subwalletSendFailed(explorerUrl, network) };
      await sleep(everyMs);
    }
    return { status: "problem", problem: securityProblems.subwalletUnconfirmed(explorerUrl, network) };
  }

  /** What a separate wallet holds, for showing (D29 Browser's Wallet tab): the chain's own coin and the coins ZeroFee
   *  lists on that chain (KNOWN_COINS), in smallest units, from one node or the other. Display only: it decides nothing. */
  async balances(id: unknown): Promise<{ token: string; symbol: string; decimals: number; amount: string }[]> {
    const w = await this.find(id);
    if (w.chain === "near") throw new ProblemError(securityProblems.requestInvalid(w.kind === "trade" ? "your NEAR wallet's balance isn't read here" : "the Private balance is read through Wallet's ledger"));
    try {
      if (w.chain === "sol") {
        if (!this.o.sol.balance) throw new Error("no reader");
        return [{ token: "native", symbol: "SOL", decimals: 9, amount: (await this.o.sol.balance(w.address)).toString() }];
      }
      const chain = w.chain;
      const word = (raw: unknown) => (typeof raw === "string" && /^0x[0-9a-fA-F]{0,64}$/.test(raw) ? BigInt(raw === "0x" ? 0 : raw).toString() : "0");
      const own = async () => ({ token: "native", symbol: NATIVE[chain], decimals: 18, amount: word(await this.o.evm.read(chain, "eth_getBalance", [w.address, "latest"])) });
      const coin = async (c: { token: string; symbol: string; decimals: number }) => ({ ...c, amount: word(await this.o.evm.read(chain, "eth_call", [{ to: c.token, data: `0x70a08231${w.address.slice(2).padStart(64, "0")}` }, "latest"])) });
      return await Promise.all([own(), ...(KNOWN_COINS[chain] ?? []).map(coin)]);
    } catch {
      throw new ProblemError(securityProblems.chainUnreachable(w.chain));
    }
  }

  /**
   * A site's own wallet's coins (product decision, 3 Nov: pump.fun's and GMGN's wallet pages): its network's coin and every coin it
   * holds, named from the chain and priced (site-coins.ts). Display only: one node or the other, kept 15 s so a page that
   * asks again (rest.ts's scheduler) doesn't ask the nodes again. A site's wallets only.
   */
  async coins(id: unknown, fresh = false): Promise<import("./site-coins.ts").WalletCoinRow[]> {
    const w = await this.find(id);
    if (!isSiteWallet(w)) throw new ProblemError(securityProblems.requestInvalid("coins are listed for a site's own wallet"));
    // `fresh`: the wallet's figure just changed (a move landed: test, MUST 9), so its kept rows are older than it
    const kept = this.coinRows.get(w.id);
    if (!fresh && kept && Date.now() - kept.at < COINS_KEPT_MS && Date.now() >= kept.at) return kept.rows;
    const { walletCoins } = await import("./site-coins.ts");
    try {
      const rows = await walletCoins({
        sol: this.o.sol,
        evm: this.o.evm,
        nativeUsd: (c) => this.hotPrice(c as "sol" | EvmWalletChain),
        ...(this.o.marketPrices ? { prices: this.o.marketPrices } : {}),
        listed: (c) => KNOWN_COINS[c as EvmWalletChain] ?? [],
        noted: (wid) => this.notedCoins(wid),
      }, w);
      this.coinRows.set(w.id, { at: Date.now(), rows });
      return rows;
    } catch {
      throw new ProblemError(securityProblems.chainUnreachable(w.chain));
    }
  }

  /** The coins a site wallet's own EVM transactions brought in (their receipts' Transfer logs), kept for its coin list. */
  private async notedCoins(id: string): Promise<string[]> {
    const raw = await this.o.vault.get(`${COINS_NOTED}${id}`);
    const list: unknown = raw ? JSON.parse(new TextDecoder().decode(raw)) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string" && /^0x[0-9a-f]{40}$/.test(t)) : [];
  }
  /** After a site wallet's EVM transaction landed: the coins its receipt brought in are kept (one node, display only). */
  private async noteCoins(w: Stored, hash: string): Promise<void> {
    const { coinsIn, COINS_MAX } = await import("./site-coins.ts");
    const got = coinsIn(await this.o.evm.read(w.chain as EvmWalletChain, "eth_getTransactionReceipt", [hash]), w.address);
    if (!got.length) return;
    const had = await this.notedCoins(w.id);
    const next = [...new Set([...got, ...had])].slice(0, COINS_MAX);
    if (next.length === had.length && next.every((t) => had.includes(t))) return;
    await this.o.vault.put(`${COINS_NOTED}${w.id}`, utf8(JSON.stringify(next)));
    this.coinRows.delete(w.id);
  }

  /** A read a site asks of its wallet's chain (D29 C.4): only reads, from one node or the other. Reads decide nothing. */
  async siteRead(id: unknown, method: unknown, params: unknown): Promise<{ result: unknown }> {
    const w = await this.find(id);
    if (!isChainWallet(w) && w.kind !== "pay" && !isSiteWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("Only your chain wallets, a site's own wallet and the card's wallet read for a site."));
    if (w.chain === "sol" || w.chain === "near") throw new ProblemError(securityProblems.requestInvalid("reads are for an EVM wallet"));
    if (typeof method !== "string" || !SITE_READS.has(method)) throw new ProblemError(securityProblems.requestNotAllowed(`A site can only read ${[...SITE_READS].join(", ")}.`));
    const list = params ?? [];
    if (!Array.isArray(list) || JSON.stringify(list).length > 65_536) throw new ProblemError(securityProblems.requestInvalid("params is a list, at most 64 KB"));
    try {
      return { result: await this.o.evm.read(w.chain, method, list) };
    } catch {
      throw new ProblemError(securityProblems.chainUnreachable(w.chain));
    }
  }

  /** AgentZero's own window's sign-in (ruling a–c): its pocket only (never a chain wallet, a site's own wallet or one of
   *  replaced words), on AGENT_SIGN_IN_HOSTS only, asked by the Browser's engine only. signMessage alone calls this:
   *  signTx, sign and signTypedData keep refusing the pocket for every caller (siteBinding). */
  private async agentSignInWallet(id: unknown, site: unknown, app?: string): Promise<{ w: Stored; host: string }> {
    const w = await this.find(id);
    if (app !== "browser") throw notSigned("Only AgentZero's own window signs in with AgentZero's wallet");
    if (!isSiteWallet(w) || !isAgentPocket(w.site) || w.chain !== "sol" || w.oldWords) throw notSigned("AgentZero's window signs in only with AgentZero's own wallet.");
    const host = siteHost(site);
    if (!host) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    if (!AGENT_SIGN_IN_HOSTS.includes(host)) throw notSigned(`AgentZero signs in only to ${AGENT_SIGN_IN_HOSTS.join(" and ")}`);
    return { w, host };
  }

  /** The wallet a site may ask, and the site's host, or a refusal. The card's wallet answers only Gnosis Pay (D29 F2). */
  private async siteWallet(id: unknown, site: unknown, asker?: string): Promise<{ w: Stored; host: string }> {
    const w = await this.find(id);
    if (!isChainWallet(w) && w.kind !== "pay" && !isSiteWallet(w)) throw new ProblemError(securityProblems.subwalletRefused("Only your chain wallets, a site's own wallet and the card's wallet sign for a site."));
    const host = siteHost(site);
    if (!host) throw new ProblemError(securityProblems.requestInvalid("site is { origin } of the https page that asked"));
    if (w.kind === "pay" && host !== CARD_SITE) throw new ProblemError(securityProblems.subwalletRefused(`The card's wallet signs only for Gnosis Pay (${CARD_SITE}).`));
    const bound = siteBinding(w, host);
    if (bound) throw new ProblemError(securityProblems.subwalletRefused(bound));
    return { w, host };
  }

  /**
   * A message a site asks the Browser wallet or the card's wallet to sign (D29 wallet mode): `message` is the bytes,
   * base64; `site` is { origin } of the page that asked, as the phone read it. EVM: personal_sign (EIP-191, the core
   * adds the prefix). Solana: plain words only (bytes that aren't words could be a transaction). A sign-in (EIP-4361,
   * or Sign In With Solana) must be for that site, this wallet and (EVM) its chain.
   * D143 (approval-policy.ts): a hot key never asks. It signs only a PLAIN sign-in (plainSignInRefusal, or the site's own
   * where it has one: siteSignInRefusal), for that site and this wallet, asked through Browser's engine (the site's own
   * window), inside the room (SIGN_IN_PER_HOUR, SIGN_IN_GAP_MS). It moves nothing. Anything else is refused, named.
   */
  /**
   * `agent` (the phone's host's word, from the window that asked: IsolatedCore stamps it): AgentZero's own window. Then
   * only AgentZero's pocket signs, only a sign-in, only on AGENT_SIGN_IN_HOSTS (ruling a–c); without it the pocket is
   * refused here as everywhere (siteBinding). `tap`: the person touched that window just before (the host's word);
   * `load`: the page load that asked (the host's word), for the re-run room (signInRoom).
   */
  async signMessage(id: unknown, message: unknown, site: unknown, asker?: string, app?: string, agent?: unknown, tap?: unknown, load?: unknown): Promise<{ signature: string; signedIn?: true }> {
    const { w, host } = agent === true ? await this.agentSignInWallet(id, site, app) : await this.siteWallet(id, site, asker);
    const refuse = (why: string): never => {
      throw notSigned(why);
    };
    let bytes: Uint8Array;
    try {
      if (typeof message !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(message)) throw new Error();
      bytes = fromBase64(message);
    } catch {
      throw new ProblemError(securityProblems.requestInvalid("message is the bytes, base64"));
    }
    if (bytes.length === 0 || bytes.length > 16_384) throw new ProblemError(securityProblems.requestInvalid("message is 1 byte to 16 KB"));
    const text = readableText(bytes);
    if (w.chain === "sol" && text === null) refuse("A Solana wallet only signs messages in plain words. This one could be a payment");
    if (w.chain === "near") refuse("Your private balance doesn't sign for a site");
    if (text === null) refuse(`ZeroFee can't read what ${host} asked to sign`);
    let signIn: SignIn | null = null;
    try {
      signIn = readSignIn(text!, w.chain === "sol" ? "Solana" : "Ethereum");
    } catch (e) {
      refuse((e as Error).message);
    }
    if (signIn) {
      const refusal = signInRefusal(signIn, host, w.address, Date.now());
      if (refusal) refuse(refusal);
      if (w.chain !== "sol" && w.chain !== "near" && signIn.chainId !== undefined && signIn.chainId !== String(EVM_CHAIN_ID[w.chain])) refuse("This sign-in is for another network, not this wallet's");
    }
    // Social trading (product decision, 2 Nov), every wallet a site may ask since D143: a PLAIN sign-in for its own site (the standard
    // shape, this site, this wallet, fresh, a one-time number, no word about money), or the site's own where it doesn't
    // use the standard (ST4: pump.fun's, exactly); only Browser's engine, never ZeroFee's own screens or another app
    // (review B, L1); at most SIGN_IN_PER_HOUR an hour, never two within SIGN_IN_GAP_MS (review B, M4).
    const plainWhy = signIn ? plainSignInRefusal(text!, signIn, Date.now(), w.chain === "sol" ? "Solana" : "Ethereum") : isSiteWallet(w) && siteWallet(w.site)?.host !== true ? siteSignInRefusal(text!, host, Date.now()) : `${host} asked to sign words that aren't a sign-in`;
    // QA (rule 8): text outside the allow-list; the Browser's engine shows it on its own sheet, by the site's
    // name, from this cause (engine.ts signInProblem, step-trace.ts signInWhy's allow-list words), never silently
    if (plainWhy) refuse(plainWhy);
    // review L3: Browser's engine by its raw app id (forApps' stamp); a display name ("Browser") is Apps' too
    if (app !== undefined ? app !== "browser" : asker !== "Browser") refuse("Only a site's own window signs you in");
    // QA: the template this sign-in matched (the standard's, or the site's own); a session already approved on
    // it, asked again with no tap of the person's, is a re-run: its own room, never the person's
    const approved = `${w.id}|${host}|${signIn ? "standard" : "site"}`;
    // only where the host can tell (the phone says tap true or false; a caller with no such word, the web, keeps the one room)
    const rerun = tap === false && this.approvedSignIns.has(approved);
    if (!this.signInRoom(w.id, host, rerun ? { load } : undefined, isAgentPocket(w.site) ? "agentzero" : undefined)) refuse(`${host} asked to sign you in again too soon. Try again in a minute`);
    this.approvedSignIns.add(approved);
    const secret = await this.secret(w);
    // signedIn: a plain sign-in signed with no sheet (D75's "AgentZero signed you in." says so; review ST1 M1)
    return { signature: base64(w.chain === "sol" ? ed25519.sign(bytes, secret) : evmSignature(eip191Hash(bytes), secret)), signedIn: true as const };
  }

  /** eth_signTypedData_v4 (EIP-712) for the Browser wallet or the card's wallet. D143 (approval-policy.ts): a hot key never
   *  asks, and typed data (an allowance, a Safe transaction, an order) is never a trade the core checks: always refused,
   *  named, after the same reading (its chain, its shape) so the reason is the true one. */
  async signTypedData(id: unknown, typedData: unknown, site: unknown, asker?: string): Promise<{ signature: string }> {
    const { w } = await this.siteWallet(id, site, asker);
    if (w.chain === "sol" || w.chain === "near") throw new ProblemError(securityProblems.requestInvalid("typed data is for an EVM wallet"));
    const chain = w.chain;
    let t: TypedData;
    try {
      t = readTypedData(typedData);
      eip712Hash(t);
    } catch (e) {
      throw new ProblemError(securityProblems.subwalletRefused(e instanceof SyntaxError ? "This typed data isn't JSON." : (e as Error).message));
    }
    const chainId = t.domain.chainId;
    if (chainId !== undefined && !(/^(\d{1,20}|0x[0-9a-fA-F]{1,16})$/.test(String(chainId)) && BigInt(String(chainId)) === BigInt(EVM_CHAIN_ID[chain]))) {
      throw new ProblemError(securityProblems.subwalletRefused("It is for another network, not this wallet's."));
    }
    // review, 3 Nov: said plainly to the site's person; typed data (a permit, an order) is the classic silent drain
    throw new ProblemError(securityProblems.subwalletRefused(TYPED_REFUSED));
  }

  /**
   * The Extension's session on its own wallet (D143, approval-policy.ts: no sheet; a hot key never asks). Kept for the
   * Extension's own calls: it starts at once and says when it ends; what its trades sign is the core's checks, never the
   * session. `why`: at most 80 characters, no control or direction-changing characters. `firstTx` (optional): the first
   * trade's own unsigned transaction, checked as any trade is and no bigger than `perTx`, signed and returned as
   * `signedTx`; one that isn't such a trade is refused (security.subwallet.refused) and nothing starts.
   */
  async sessionStart(id: unknown, perTx: unknown, total: unknown, minutes: unknown, why?: unknown, _asker?: string, firstTx?: unknown, coin?: unknown, app?: string): Promise<{ endsAtIso: string; signedTx?: string }> {
    const w = await this.find(id);
    // One wallet per chain (D55): a chain wallet is shared by Trade, the apps, the sites and Chat, so a wallet's own session
    // is the Extension's only; Trade's go through the Trade session (tradeSessionStart).
    if (w.kind !== "extension") {
      throw new ProblemError(securityProblems.subwalletRefused(w.chain === "near" ? (w.kind === "trade" ? "Trades pay from your chain wallets, never from your NEAR wallet's cash. So fast trading can't start here." : "Your private balance has no fast trading.") : `Your ${w.label.toLowerCase()}'s trades already go without asking.`));
    }
    if (why !== undefined && (typeof why !== "string" || why.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(why))) {
      throw new ProblemError(securityProblems.requestInvalid("why is plain text, at most 80 characters"));
    }
    // The Extension's wallet is on Solana.
    if (w.chain !== "sol") throw new ProblemError(securityProblems.subwalletRefused(`Your ${w.label.toLowerCase()} has no fast trading.`));
    const p = units(perTx, "perTx");
    const t = units(total, "total");
    const m = Number(minutes);
    // The caps in dollars at the core's own price: an app's wrong price can't turn "$50 a trade" into much more.
    const price = this.o.usdPrice ? await this.o.usdPrice(w.chain).catch(() => null) : undefined;
    if (price === null) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    const usd = (n: bigint) => (price ? (Number(n) / 10 ** NATIVE_DECIMALS[w.chain]) * price : 0);
    if (price && (usd(p) > SESSION_MAX_USD.perTx || usd(t) > SESSION_MAX_USD.total)) {
      throw new ProblemError(securityProblems.requestNotAllowed(`Fast trading covers at most $${SESSION_MAX_USD.perTx} a trade and $${SESSION_MAX_USD.total} in all.`));
    }
    if (!Number.isInteger(m) || m < 1 || m > MAX_SESSION_MINUTES || p === 0n || t < p) {
      throw new ProblemError(securityProblems.requestInvalid(`minutes is 1 to ${MAX_SESSION_MINUTES}; perTx above 0 and no more than total`));
    }
    if (firstTx !== undefined && typeof firstTx !== "string") throw new ProblemError(securityProblems.requestInvalid("firstTx must be base64"));
    const first = typeof firstTx === "string" ? await this.firstTrade(w, "sol", firstTx, coin, p) : null;
    const signedTx = first ? await first.sign() : undefined;
    const endsAt = Date.now() + m * 60_000;
    this.sessions.set(w.id, { app, perTx: p, total: t, spent: first?.out ?? 0n, endsAt });
    if (first && first.out >= t) this.endSession(w.id, "total");
    return { endsAtIso: new Date(endsAt).toISOString(), ...(signedTx ? { signedTx } : {}) };
  }

  /** A session's first trade: refused unless it is a trade the core's checks pass (D143) and no bigger than `perTx`. */
  private async firstTrade(w: Stored, chain: "sol" | EvmChainName, txB64: string, coin: unknown, perTx: bigint): Promise<{ out: bigint; sign: () => Promise<string> }> {
    const refuse = (why: string): never => {
      throw notSigned(why);
    };
    if (chain === "sol") {
      // a buy one server checked is worth at least its bytes' spend (solPrepare)
      const { decoded, value, notCovered } = await this.solPrepare(w, txB64);
      if (notCovered) refuse(notCovered);
      if (decoded.swaps.length !== 1) refuse("It isn't one trade");
      if (value > perTx) refuse("It is bigger than one trade here may be");
      return { out: value, sign: async () => signSolTx(txB64, await this.secret(w)) };
    }
    const prep = await this.evmPrepare(w, chain, txB64);
    const { d } = await this.tradeFacts(w, chain, txB64, coin);
    const proceeds = prep.sim.nativeIn ?? 0n;
    const value = prep.out > proceeds ? prep.out : proceeds;
    const notCovered = await this.tradeRefusal(w, chain, txB64, coin, prep.sim, prep.maxFee <= FEE_CAPS[chain].maxFee && prep.tip <= FEE_CAPS[chain].tip);
    if (notCovered) refuse(notCovered);
    if (d.swaps.length !== 1) refuse("It isn't one trade");
    if (value > perTx) refuse("It is bigger than one trade here may be");
    return { out: value, sign: () => this.evmSign(w, prep) };
  }

  /**
   * The wallet a move of Spending's reaches (D55), always from the core's own list: by `id`, one of this account's chain
   * wallets on that chain (never another chain's, the card's or the Extension's); by a legacy `slot` from a journal
   * written before D55, the trading wallet at 0–4 or, at SITE_SLOT, the old apps wallet on Solana; with neither, the
   * chain's current wallet.
   */
  private async walletOf(chain: TradeChain, ref: WalletRef, filling = false): Promise<Stored> {
    if (ref.id !== undefined) {
      const w = (await this.stored()).find((x) => x.id === ref.id);
      if (!w || w.chain !== chain || !(isChainWallet(w) || isSiteWallet(w))) throw new ProblemError(securityProblems.subwalletUnknown());
      // A site's wallet is only ever filled here (Make ready), never one of replaced words. Nothing of Spending's takes
      // from it: what it holds leaves only for its own site, on the sheet, by the person's own Move back (its own sheet,
      // siteMoveBack, which opens this wallet for that one move while it runs), or by the person's own export (security
      // review of Job 3, High: a move out of it would be a payment no sheet and no site asked for).
      if (isSiteWallet(w) && !(filling ? !w.oldWords : ref.back !== undefined && this.movingBack.get(w.id) === ref.back)) throw new ProblemError(securityProblems.subwalletUnknown());
      // AgentZero's pocket (D90) is never filled by a move nobody approved (P1's review: any app's Make ready or a Trade
      // move-out could otherwise raise AgentZero's budget): its own fill, behind the person's Approve, comes with P2.
      // P2: only the one fill the person approved, by that move's own key, while it runs.
      if (filling && isAgentPocket(w.site)) throw new ProblemError(securityProblems.subwalletRefused("AgentZero's pocket is never filled. Its money moves to your SOL wallet."));
      return w;
    }
    // TODO(9 Nov 2026, D55 + 7 days): drop the legacy slots once no journal of Trade's still names one.
    if (ref.slot !== undefined) {
      if (ref.slot !== SITE_SLOT) return this.tradeWallet(chain, ref.slot, filling);
      const found = (await this.stored()).filter((x) => x.kind === "browser" && x.chain === chain);
      const w = (filling ? found.find((x) => !x.oldWords) : undefined) ?? found[0];
      if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
      return w;
    }
    return this.current(chain);
  }

  /**
   * The trading wallet at that slot, from this phone's own list. After new words a slot can hold two (D55: slot 0 of the
   * new words is made beside the old words' one): `filling` (money going in) takes the one that isn't the old words'
   * (security review 2 Nov); a move out takes the first, as before, so the old one can still be emptied.
   */
  private async tradeWallet(chain: TradeChain, slot: number, filling = false): Promise<Stored> {
    const list = await this.stored();
    const slots = slotsOf(list);
    const found = list.filter((x) => x.kind === "trade" && x.chain === chain && slots.get(x.id) === slot);
    const w = (filling ? found.find((x) => !x.oldWords) : undefined) ?? found[0];
    if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
    return w;
  }

  /**
   * The number for a new transaction this core builds from an EVM wallet (sendCall, payPlain), and the count that has
   * landed (the lower "latest" of two nodes, for evmSign). After every transaction already waiting: this core's own
   * unlanded ones (kept in memory), and the nodes' own count of waiting ones (the higher "pending" of the two, as Trade's
   * engine sees it): after a restart, when the memory is empty, a transaction the person approved that hasn't landed is
   * never replaced (security review 3 Nov). But never numbered PAST either (its re-review, M): a node holding one this core
   * didn't make, or saying more than is true, would leave a gap that holds the new one back, and a move ended "didn't go"
   * could still land later. So a wallet with a transaction waiting that this core doesn't know of sends nothing until it
   * lands, said plainly; and both nodes must answer.
   */
  private async evmNonce(w: Stored, chain: EvmWalletChain): Promise<{ nonce: number; landed: number }> {
    const evm = this.o.evm;
    const [landed, seen] = await Promise.all([evm.nonce(chain, w.address), evm.account ? evm.account(chain, w.address) : undefined]);
    if (seen && (seen.length !== 2 || seen.some((a) => a === null))) throw new Error("both nodes must say what is waiting");
    let nonce = landed;
    for (const x of this.pending.get(w.id) ?? []) if (x.nonce >= nonce) nonce = x.nonce + 1;
    if ((seen ?? []).some((a) => a!.pending > nonce)) throw new ProblemError(securityProblems.subwalletRefused(`A payment from this wallet is still waiting on ${CHAIN_WORDS[chain] ?? chain}. Once it lands, try again. Nothing was sent.`));
    return { nonce, landed };
  }

  /**
   * A plain transfer's gas on an EVM chain: two nodes' estimate (the higher), a fifth more, never under 21,000 (mainnet 2
   * Nov: Robinhood Chain's nodes want 23,237 to 23,331 for one while its L1 price is on, and refused 21,000 every time);
   * past PLAIN_GAS_MAX something is wrong, and nothing is signed. With today's fees (two nodes, the higher of each).
   */
  private async plainEvm(w: Stored, to: string, value: bigint, data = "0x"): Promise<{ gas: bigint; fees: { tip: bigint; maxFee: bigint } }> {
    const chain = w.chain as EvmChainName;
    const [estimate, fees] = await Promise.all([this.o.evm.estimateGas(chain, { from: w.address, to: to.toLowerCase(), value, data }), this.o.evm.fees(chain)]);
    const gas = (estimate * 6n) / 5n > PLAIN_GAS_MIN ? (estimate * 6n) / 5n : PLAIN_GAS_MIN;
    if (gas > PLAIN_GAS_MAX) throw new ProblemError(securityProblems.subwalletRefused(`A plain send on ${CHAIN_WORDS[chain] ?? chain} would cost far more in fees than it should. So it wasn't sent.`));
    return { gas, fees };
  }

  /** What an EVM move in keeps back for its network fee: the most it can cost now (plainEvm), and FEE_ROOM over that, so
   *  a fee that rises a little before the transfer is signed neither leaves "all" short nor refuses the move again and again. */
  private async plainFeeRoom(w: Stored): Promise<bigint> {
    const { gas, fees } = await this.plainEvm(w, w.address, 0n);
    return (gas * fees.maxFee * FEE_ROOM_PCT) / 100n;
  }

  /** What a trading wallet can send of its own coin, its network fee kept back (Solana: 5,000 lamports; EVM: plainFeeRoom),
   *  or `keep` when the caller already read the fee it will hold the transfer to (a move in's "all"). */
  private async spendable(w: Stored, keep?: bigint): Promise<bigint> {
    try {
      if (w.chain === "sol") {
        if (!this.o.sol.balance) throw new Error("no reader");
        const left = (await this.o.sol.balance(w.address)) - (keep ?? SOL_PLAIN_FEE);
        return left > 0n ? left : 0n;
      }
      const chain = w.chain as EvmChainName;
      const [raw, fee] = await Promise.all([this.o.evm.read(chain, "eth_getBalance", [w.address, "latest"]), keep ?? this.plainFeeRoom(w)]);
      const balance = typeof raw === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(raw) ? BigInt(raw) : 0n;
      const left = balance - fee;
      return left > 0n ? left : 0n;
    } catch (e) {
      if (e instanceof ProblemError) throw e; // the fee refused (FEE_CAPS) says so
      throw new ProblemError(securityProblems.chainUnreachable(w.chain));
    }
  }

  /**
   * The core's own plain transfer from a trading wallet (the float's moves in): exactly `amount` of its coin to `to`,
   * nothing else, built here and never taken from an app. The transaction's id once a node took it; thrown, in words
   * (the nodes' own when they refused it), if it wasn't sent. `tried` hears what the signed transfer depends on (its
   * blockhash, its nonce) before it is sent, so a move can later prove it never landed; it may refuse, and nothing is sent.
   */
  private async payPlain(w: Stored, to: string, amount: bigint, feeAtMost?: bigint, tried?: (t: PayTry) => Promise<void>, data = "0x"): Promise<string> {
    if (w.chain === "sol") {
      if (data !== "0x") throw new Error("a Solana transfer carries no call data");
      const { latestBlockhash, send } = this.o.sol;
      if (!latestBlockhash || !send) throw new Error("this phone has no Solana node to send with");
      const blockhash = await latestBlockhash.call(this.o.sol);
      const signed = signSolTx(solTransferTx(w.address, to, amount, blockhash), await this.secret(w));
      const tx = base58(fromBase64(signed).subarray(1, 65));
      await tried?.({ blockhash, tx });
      if (!(await send.call(this.o.sol, signed))) throw new Error("neither Solana node took it");
      return tx;
    }
    const chain = w.chain as EvmChainName;
    const evm = this.o.evm;
    // this wallet's turn, from its next number to the nodes (L1)
    return this.walletTurn(w, async () => {
      let [{ nonce, landed }, { gas, fees }] = await Promise.all([this.evmNonce(w, chain), this.plainEvm(w, to, amount, data)]);
      // Never a higher fee than the move was checked with (float-moves.ts in: 2% and $0.50, audit NF-16). Over it, the fee
      // is read once more (a passing spike); still over, the move says so and nothing is sent.
      if (feeAtMost !== undefined && gas * fees.maxFee > feeAtMost) {
        fees = await evm.fees(chain);
        if (gas * fees.maxFee > feeAtMost) throw new ProblemError(securityProblems.feeHigh(EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME]));
      }
      const call: EvmCall = { from: w.address, to: to.toLowerCase(), value: amount, data, gas };
      const bytes = fromBase64(unsignedEvmTx({ chainId: EVM_CHAIN_ID[chain], nonce, tip: fees.tip, fee: fees.maxFee, gas, to: call.to, value: amount, data }));
      this.held.set(w.id, bytes);
      // `next` is the count that has landed, never this nonce: the wallet's earlier unlanded transactions stay remembered
      // (security review 3 Nov: with `next: nonce` they were forgotten, and a later send could take one's number)
      const signed = await this.evmSign(w, { bytes, nonce, next: landed, call });
      const tx = toHex(keccak_256(fromBase64(signed)));
      try {
        await tried?.({ nonce, tx });
        if (!(await evm.send(chain, signed))) throw new Error("neither node took it");
        return tx;
      } catch (e) {
        this.pending.set(w.id, (this.pending.get(w.id) ?? []).filter((x) => x.nonce !== nonce));
        throw e;
      }
    });
  }

  /**
   * A move in that no node took (float-moves.ts): true only when it provably never landed and never will, so it can end
   * with the money in the wallet and be asked again. Solana: its blockhash has expired on both nodes (none kept: the
   * transfer was never signed with one this core kept, made before 2 Nov's fix or stopped before it signed; any blockhash
   * it could have had lived about a minute, and this is asked 20 minutes on), and the deposit address has no transaction
   * and nothing in it on both nodes. EVM: on both nodes the wallet has nothing waiting (pending = latest) and, when its
   * nonce was kept, hasn't sent one since (latest at most that nonce), and the deposit address holds nothing. Anything a node
   * doesn't answer is "can't say": false.
   */
  private async unpaidIn(w: Stored, depositAddress: string, tried?: PayTry): Promise<boolean> {
    if (w.chain === "sol") {
      const { blockhashExpired, unused } = this.o.sol;
      if (!unused) return false;
      if (tried?.blockhash !== undefined && !(blockhashExpired && (await blockhashExpired.call(this.o.sol, tried.blockhash)))) return false;
      return unused.call(this.o.sol, depositAddress);
    }
    const chain = w.chain as EvmChainName;
    const { account } = this.o.evm;
    if (!account) return false;
    const [mine, theirs] = await Promise.all([account.call(this.o.evm, chain, w.address), account.call(this.o.evm, chain, depositAddress)]);
    if (mine.length !== 2 || theirs.length !== 2) return false;
    // its own number still the next on both nodes (re-review M): a retry takes that number, so the transfer that wasn't
    // taken can never land after it; a count below it is a gap this core can't vouch for, and stays open
    const still = mine.every((a) => a !== null && a.pending === a.latest && (tried?.nonce === undefined || a.latest === tried.nonce));
    return still && theirs.every((a) => a !== null && a.balance === 0n);
  }

  /** The float's moves (float-moves.ts): out to a trading wallet, in from one, home to the main balance, and where each one is. */
  /** `to` / `from`: the chain wallet's id (D55); none, the chain's current wallet. `slot`: legacy, a journal's from before. */
  floatOut(chain: unknown, slot: unknown, amount: unknown, key: unknown, to?: unknown): Promise<FloatMove | { declined: true }> {
    return this.floatMoves.out(chain as TradeChain, slot, amount, key, to);
  }
  floatIn(chain: unknown, slot: unknown, amount: unknown, key: unknown, from?: unknown): Promise<FloatMove | { declined: true }> {
    return this.floatMoves.in(chain, slot, amount, key, from);
  }
  /** D119 landing 3: Trading ↔ the person's own Perps account on Hyperliquid (float-moves.ts toPerps / fromPerps). Only
   *  the core's perps service calls these, with its own address and its own pay. */
  floatToPerps(amount: string, key: string, recipient: string): Promise<FloatMove | { declined: true }> {
    return this.floatMoves.toPerps(amount, key, recipient);
  }
  floatFromPerps(amount: string, key: string, pay: (depositAddress: string, amountIn: string) => Promise<void>): Promise<FloatMove | { declined: true }> {
    return this.floatMoves.fromPerps(amount, key, pay);
  }

  /**
   * Social Trading's Move back (product decision, 2 Nov): a site's own wallet → the Safe, privately, started by the person's own tap
   * in Wallet's money sheet (demo-core: Wallet or ZeroFee's own screens only), then two confidential legs: the wallet's
   * SOL into Spending's confidential balance as USDC (a refund comes back there too), and on home to the Safe once it
   * settles. D143 (approval-policy.ts): a hot key never asks, and money only goes home. Job 3's High stays: nothing else
   * takes from a site's wallet. Only this call opens the wallet for this one move, and only while it runs. `amount`: "all" (what the wallet can send, its network fee kept back) or the
   * coin's smallest units. `key`: the move's own id (asking again answers with the same move).
   */
  /** One site wallet's move back, checked (the single sheet's and the batched sheet's same checks): its wallet, site,
   *  chain, amount and key, a repeat of its key (the move it made), nothing already starting, and its SOL. */
  private async backLeg(id: unknown, amount: unknown, key: unknown): Promise<{ had: FloatMove } | { w: Stored; site: NonNullable<ReturnType<typeof siteWallet>>; units: bigint; key: string }> {
    const w = (await this.stored()).find((x) => x.id === id);
    if (!w || !isSiteWallet(w)) throw new ProblemError(securityProblems.subwalletUnknown());
    const site = siteWallet(w.site);
    if (!site) throw new ProblemError(securityProblems.subwalletRefused("This wallet's site isn't one ZeroFee knows."));
    if (w.chain !== "sol") throw new ProblemError(securityProblems.subwalletRefused(`Move back works for your ${site.name} wallet on Solana. This one is on ${CHAIN_WORDS[w.chain] ?? w.chain}.`));
    if (amount !== "all" && (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n)) throw new ProblemError(securityProblems.requestInvalid('amount is SOL in lamports, as text, or "all"'));
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,58}$/.test(key)) throw new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 58 letters, digits, - or _"));
    // asked again with the same key: the same move, and no second sheet
    const had = (await this.floatMoves.moveBacks()).find((m) => m.back.id === `fm-${key}`);
    if (had) return { had: had.back };
    if (this.movingBack.has(w.id) || this.askingBack.has(w.id)) throw new ProblemError(securityProblems.subwalletRefused(`A move back from your ${site.name} wallet is already starting.`));
    // reserved at once, with no wait between the check and the mark (review M1): the caller releases it in its finally
    this.askingBack.add(w.id);
    try {
      const units = amount === "all" ? await this.spendable(w, SOL_PLAIN_FEE) : BigInt(amount);
      if (units <= 0n) throw new ProblemError(securityProblems.subwalletRefused(`Your ${site.name} wallet has nothing to move back.`));
      return { w, site, units, key };
    } catch (e) {
      this.askingBack.delete(w.id);
      throw e;
    }
  }

  async siteMoveBack(id: unknown, amount: unknown, key: unknown): Promise<FloatMove | { declined: true }> {
    // D143: no sheet (a hot key, and money only goes home); the move in prices itself (float-moves.ts in)
    const leg = await this.backLeg(id, amount, key);
    if ("had" in leg) return leg.had;
    const { w, site, units } = leg;
    try {
      // opened only now, and only for this move's own key (review A, M1)
      this.movingBack.set(w.id, leg.key);
      try {
        return await this.floatMoves.in("sol", undefined, units.toString(), key, w.id, { site: site.site });
      } finally {
        this.movingBack.delete(w.id);
      }
    } finally {
      this.askingBack.delete(w.id);
    }
  }

  /**
   * Move's take-out of every site wallet at once (FLOW-V4): each leg runs exactly as one site's Move back does (its own
   * key, the wallet opened for that move only, two confidential legs, a refund back in Spending). Each leg is checked as
   * siteMoveBack checks it, all before any leg goes; a leg that fails is answered with its Problem while the others go.
   * D143 (approval-policy.ts): no sheet, a hot key never asks, and money only goes home.
   */
  async siteMoveBackAll(raw: unknown): Promise<{ id: string; move?: FloatMove; problem?: Problem }[]> {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) throw new ProblemError(securityProblems.requestInvalid("legs: 1 to 8 site wallets, each { id, amount, key }"));
    const ids = new Set<string>();
    const legs: { w: Stored; site: NonNullable<ReturnType<typeof siteWallet>>; units: bigint; key: string }[] = [];
    try {
      for (const l of raw as { id?: unknown; amount?: unknown; key?: unknown }[]) {
        if (ids.has(String(l?.id))) throw new ProblemError(securityProblems.subwalletUnknown());
        ids.add(String(l?.id));
        const leg = await this.backLeg(l?.id, l?.amount, l?.key);      // reserves its wallet (askingBack) at once
        if ("had" in leg) throw new ProblemError(securityProblems.subwalletRefused("That move back already started."));
        legs.push(leg);
      }
      const out: { id: string; move?: FloatMove; problem?: Problem }[] = [];
      for (const l of legs) {
        // opened only now, and only for this leg's own key (review A, M1)
        this.movingBack.set(l.w.id, l.key);
        try {
          const m = await this.floatMoves.in("sol", undefined, l.units.toString(), l.key, l.w.id, { site: l.site.site });
          out.push({ id: l.w.id, ...("declined" in m ? { problem: securityProblems.subwalletRefused(`${l.site.name}'s move back didn't start.`) } : { move: m }) });
        } catch (e) {
          out.push({ id: l.w.id, problem: e instanceof ProblemError ? e.problem : securityProblems.subwalletRefused(`${l.site.name}'s move back didn't go. Its money is still in your ${l.site.name} wallet.`) });
        } finally {
          this.movingBack.delete(l.w.id);
        }
      }
      return out;
    } finally {
      for (const l of legs) this.askingBack.delete(l.w.id);
    }
  }

  /** Social Trading's Move backs, newest first, each with its home leg (for the hub's line and Activity). */
  siteMoveBacks() {
    return this.floatMoves.moveBacks();
  }
  /** `parked`: a parked remainder's Put away (spending.putAway {parked}): USDC under $2 may go home too. */
  floatHome(amount: unknown, key: unknown, parked?: unknown): Promise<FloatMove | { declined: true }> {
    return this.floatMoves.home(amount, key, parked === true);
  }
  /** The private pocket's way out: one coin home to the main balance (pocket-moves.ts). */
  privateHome(tokenId: unknown, amount: unknown, key: unknown): Promise<PocketMove> {
    return this.pocketMoves.home(tokenId, amount, key);
  }
  privateMove(id: unknown): Promise<PocketMove> {
    return this.pocketMoves.move(id);
  }
  privateMoves(): Promise<PocketMove[]> {
    return this.pocketMoves.moves();
  }
  floatQuoteAdd(amount: unknown, tokenId?: unknown, job?: unknown) {
    return this.floatMoves.quoteAdd(amount, tokenId, job);
  }
  /**
   * Home's Add and Request (E1, E2; D127): a one-time confidential address on the coin's own chain, its money into the
   * float, then on to the chain's wallet or the Safe (float-add.ts addOutside). A fresh account's float is made from the
   * backup words here, as a Top up makes it: it is still the one address the words make for it. `setup`: set-up's first
   * money, the private way (fund-start.ts), the core's own call only (account.fund.start): never from the bridge.
   */
  async addQuote(chain: unknown, to: unknown, key: unknown, usd?: unknown, setup?: { address: string; usd: number }): Promise<AddAddress> {
    if (!(await this.stored()).some(isFloat)) await this.create("trade", "near");
    return setup ? this.floatMoves.addSetup(chain, key, setup.address, setup.usd) : this.floatMoves.addOutside(chain, to, key, usd);
  }
  /** Home's line for each Add (and the job's next turn: a landed Add goes on from here, after a restart too). */
  addsOnWay(): Promise<AddOnWayFacts[]> {
    return this.floatMoves.addsOnWay();
  }
  /** The phone's push saw money reach a one-time address (float-add.ts addSeen). */
  addSeen(address: unknown): Promise<boolean> {
    return this.floatMoves.addSeen(address);
  }
  /** The one-time addresses still open, for the phone's push (float-add.ts addWatch). */
  addWatch(): Promise<AddWatch[]> {
    return this.floatMoves.addWatch();
  }
  /** subwallet.received: every Add that ended, kept for good; and the coins the float's moves to or from the Safe touched. */
  addsReceived(): Promise<Received[]> {
    return this.floatMoves.addsReceived();
  }
  safeTouched(sinceMs: number): Promise<string[]> {
    return this.floatMoves.safeTouched(sinceMs);
  }
  setupFacts(key: string, everyMs?: number) {
    return this.floatMoves.setupFacts(key, everyMs);
  }
  /** ST3: what a site's Add would cost (display only, site-add-cost.ts, which checks the app and the wallet). */
  swapCost(p: Record<string, unknown>) {
    return this.floatMoves.swapCost(p);
  }

  siteAddCost(p: Record<string, unknown>) {
    return this.floatMoves.siteAddCost(p, () => this.stored());
  }
  floatAddFacts(depositAddress: string): Promise<unknown | null> {
    return this.floatMoves.addFacts(depositAddress);
  }
  floatMove(id: unknown): Promise<FloatMove> {
    return this.floatMoves.move(id).then((m) => this.byOf(m));
  }
  /** F5: the keys of the float moves AgentZero's act door started (agent-pocket.ts actWallets), on this run; only that
   *  door adds to it, so only those records say AgentZero. After a restart they read as nobody's, never as AgentZero's. */
  private readonly agentKeys = new Set<string>();
  markAgentMove(key: unknown): void {
    if (typeof key === "string") this.agentKeys.add(`fm-${key}`);
  }
  private byOf(m: FloatMove): FloatMove {
    // a Take out of all is one move per coin, keyed <key>-<chain>: each is the door's too
    for (const k of this.agentKeys) if (m.id === k || (m.id.startsWith(`${k}-`) && /^(sol|hood|bsc|near)$/.test(m.id.slice(k.length + 1)))) return { ...m, by: "agentzero" };
    return m;
  }

  /**
   * A NEAR coin bought or sold inside Spending (TN2, D74): see FloatMoves.swap. The person's yes is the Trade session
   * when it is open, Trade asked, and the swap fits its caps (counted in dollars: what it's worth at 1Click's own price);
   * otherwise the core's own sheet in S1's words. A site, Browser, the apps and Chat can never ask for one.
   */
  floatSwapQuote(side: unknown, coin: unknown, amount: unknown) {
    return this.floatMoves.swapQuote(side, coin, amount);
  }
  /** `session` (Trade's own call only): with no Trade session open, the swap starts one too, and the answer carries its
   *  end. D143 (approval-policy.ts): the NEAR wallet is a hot key, so no sheet: FloatMoves.swap's own checks (1Click's
   *  signed quote, the core's floor, the coin named by 1Click's own list) are the gate. A site, Browser, the apps and
   *  Chat never reach it (demo-core tradeOnly). */
  async floatSwap(side: unknown, coin: unknown, amount: unknown, atLeast: unknown, key: unknown, by: Caller, session?: unknown): Promise<FloatMove & { sessionEndsAtIso?: string }> {
    let started: string | undefined;
    const s = session as { perTxUsd?: unknown; totalUsd?: unknown; minutes?: unknown } | undefined;
    const m = await this.floatMoves.swap(side, coin, amount, atLeast, key, async () => {
      if (s && by.app === "trade" && by.site === undefined && !(this.trade && Date.now() < this.trade.endsAt)) {
        const r = await this.tradeSessionStart(s.perTxUsd, s.totalUsd, s.minutes, undefined, "Trade").catch(() => null);
        if (r) started = r.endsAtIso;
      }
      return true;
    });
    if ("declined" in m) throw new ProblemError(securityProblems.subwalletRefused("Your NEAR wallet's swap didn't start. Nothing moved."));
    return started ? { ...m, sessionEndsAtIso: started } : m;
  }

  /** AgentZero's swap inside Spending under a job's scope (agent-act.ts, D117): `cover` counts it at the core's own price
   *  or throws why not; a swap only a sheet may cover asks the person. */
  agentSwap(side: unknown, coin: unknown, amount: unknown, atLeast: unknown, key: unknown, cover: (usd: number) => boolean) {
    return this.floatMoves.swap(side, coin, amount, atLeast, key, async ({ usd, words, sheetOnly }) => (!sheetOnly && cover(usd)) || this.o.approve({ ...words, asker: "agent" }).catch(() => false));
  }

  floatBalance() {
    return this.floatMoves.balance();
  }
  floatAddStatus(depositAddress: unknown, job?: unknown) {
    return this.floatMoves.addStatus(depositAddress, job);
  }
  floatMoveList(): Promise<FloatMove[]> {
    return this.floatMoves.moves().then((ms) => ms.map((m) => this.byOf(m)));
  }

  /** The float's fee guard, for Trade's planner: it plans no more moves than go without asking. */
  /** Spending's own address in NEAR Intents (its private balance), or null before Spending exists. Read only: AgentZero's
   *  top-up (D89) pays a 1Click quote into it, never this address itself. */
  async floatAddress(): Promise<string | null> {
    return (await this.stored()).find(isFloat)?.address ?? null;
  }

  async floatLimits(withPrices = false): Promise<{ movesLeftToday: number; perDay: number; minUsd: number; open: TradeChain[]; prices?: Partial<Record<TradeChain, number | null>> }> {
    // `open`: the chains whose moves are open (each opens after its own test): Trade plans no share for the rest.
    const open = (Object.keys(CHAIN_COIN) as TradeChain[]).filter((c) => CHAIN_COIN[c].open);
    // `prices` (asked for, read only): the core's own price of each open chain's coin, the one its moves are held to, so a
    // sheet can refuse before the Approve when its own price is too far from it (UI's AgentZero walk, 3 Nov); null: unread
    const prices = withPrices ? Object.fromEntries(await Promise.all(open.map(async (c) => [c, (await this.o.usdPrice?.(c).catch(() => null)) ?? null] as const))) : undefined;
    return { movesLeftToday: await this.floatGuard.left(), perDay: FLOAT_MOVES_PER_DAY, minUsd: FLOAT_MIN_USD, open, ...(prices ? { prices } : {}) };
  }

  endSession(id: string, reason: "time" | "total" | "locked" | "ended"): void {
    if (id === TRADE_SESSION) {
      if (this.trade) (this.trade = null), this.o.emit("subwallet.session.ended", { id, reason });
      return;
    }
    if (this.sessions.delete(id)) this.o.emit("subwallet.session.ended", { id, reason });
  }

  /** End every session, e.g. when the phone locks. */
  endAll(reason: "locked" | "ended"): void {
    for (const id of [...this.sessions.keys()]) this.endSession(id, reason);
    this.endSession(TRADE_SESSION, reason);
  }

  /** The pocket's day, loaded on first ask, lent only the pocket's own wallet, its checks and its key. */
  private pocket(): Promise<PocketSession> {
    return (this.pocketDay ??= import("./agent-pocket.ts").then(
      (k) =>
        (this.pocketLive = new k.PocketSession(k.agentLegHost({
          // D117: AgentZero's day trades from the SOL row's own wallet (the one Trade uses), never a separate one.
          pocketId: () => this.current("sol").then((w) => w.id),
          wallet: (id) => this.find(id),
          prepare: (w, tx) => this.solPrepare(w as Stored, tx),
          ownLink: (w, to) => this.refuseOwnLink(w as Stored, to),
          priceNow: () => this.priceSoon("sol"),
          dayPrice: async () => (this.o.usdPrice ? this.o.usdPrice("sol") : null),
          secret: (w) => this.secret(w as Stored),
          // D146 (review M5): AgentZero's sheets say they are AgentZero's, so they show only while it's on screen
          approve: (words) => this.o.approve({ ...words, asker: "agent" }),
          ended: (reason, line) => this.o.emit("subwallet.session.ended", { id: "agentzero-pocket", reason, ...(line ? { line } : {}) }),
          stops: () => this.agentPocketStops,
          feeRoomUsd: FEE_ROOM_USD,
        }, this.agentKit()))),
      (e: unknown) => {
        this.pocketDay = null;
        throw e;
      },
    ));
  }

  /** AgentZero's pocket day (D107): one Face ID, then its own trades from its pocket go without a sheet for up to 24 h. */
  agentPocketStart(perTxUsd: unknown, totalUsd: unknown, minutes: unknown, stops = this.agentPocketStops, watch?: import("./agent-pocket.ts").PocketWatch): Promise<{ endsAtIso: string } | { declined: true }> {
    return this.pocket().then((d) => d.start(perTxUsd, totalUsd, minutes, stops, watch));
  }

  /** AgentZero's own trade from its pocket, no sheet; only the core's account.agent.pocketSign calls it. */
  agentPocketSign(txB64: unknown, charge?: (valueUsd: number, decoded: { swaps: { side: string; coin?: string }[] }) => void): Promise<{ signedTx: string }> {
    return this.pocket().then((d) => d.sign(txB64, charge));
  }

  /** AgentZero's own wallet (agent-wallet.ts walletDo, loaded on first ask): what its doors are lent, nothing more. */
  agentKit(): RawKit {
    return { o: this.o, float: this.floatMoves, Moves: PocketMoves };
  }

  /** The SOL row's own wallet (D117): what AgentZero's day trades from; made now if it isn't yet (no money moves). */
  async agentSolRow(): Promise<{ id: string; address: string }> {
    const w = await this.current("sol");
    return { id: w.id, address: w.address };
  }

  /**
   * D117: an AgentZero pocket made before the SOL row took its place moves to the SOL row, on the core's own sheet, all of
   * it but the fee. Nothing else ever signs from the pocket (P1), and nothing ever fills it.
   */
  async agentPocketEmpty(): Promise<TxOutcome | { declined: true }> {
    const id = await this.agentPocketId();
    if (!id) throw new ProblemError(securityProblems.subwalletRefused("There's no AgentZero pocket to move."));
    const pocket = await this.find(id);
    const row = await this.current("sol");
    // its steps load with it (agent-pocket.ts pocketEmpty): never in Home's first load
    return (await import("./agent-pocket.ts")).pocketEmpty({ from: pocket.address, to: row.address, sol: this.o.sol, approve: (w) => this.o.approve({ ...w, asker: "agent" }), secret: () => this.secret(pocket), confirmed: (seen, sig, url) => this.confirmed(seen, sig, url, "Solana") });
  }

  /** Ends AgentZero's pocket day at once (Stop AgentZero, pause, the job's end). */
  endAgentPocket(reason: string): void {
    this.agentPocketStops++;
    this.pocketLive?.end(reason);
  }

  /** How many Stops so far: read before anything a day's start waits on, and passed to agentPocketStart. */
  agentPocketStopCount(): number {
    return this.agentPocketStops;
  }

  /** AgentZero's pocket's id, for its own trades (the core's agent methods). */
  async agentPocketId(): Promise<string | null> {
    return (await this.stored()).find((x) => isSiteWallet(x) && isAgentPocket(x.site) && x.chain === "sol" && !x.oldWords)?.id ?? null;
  }

  /**
   * The Trade session (TRADE-FLOAT §0.4). D143 (approval-policy.ts): no sheet and no Face ID; a hot key never asks. It
   * starts at once and says when it ends (Trade's own call only, demo-core tradeOnly); what Trade's trades sign is the
   * core's checks (signTx), never the session. The caps are still read as dollars at the core's own price (an app's
   * price never sizes them) and bound the first trade. `id` + `firstTx`: the first trade, from that chain wallet,
   * checked as any trade is, signed and returned as `signedTx`.
   */
  async tradeSessionStart(perTxUsd: unknown, totalUsd: unknown, minutes: unknown, why?: unknown, _asker?: string, id?: unknown, firstTx?: unknown, coin?: unknown): Promise<{ endsAtIso: string; signedTx?: string }> {
    if (why !== undefined && (typeof why !== "string" || why.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(why))) {
      throw new ProblemError(securityProblems.requestInvalid("why is plain text, at most 80 characters"));
    }
    const m = Number(minutes);
    if (typeof perTxUsd !== "number" || typeof totalUsd !== "number" || !(perTxUsd > 0) || !(totalUsd >= perTxUsd) || !Number.isInteger(m) || m < 1 || m > MAX_SESSION_MINUTES) {
      throw new ProblemError(securityProblems.requestInvalid(`perTxUsd and totalUsd are dollars (perTxUsd above 0, no more than totalUsd); minutes is 1 to ${MAX_SESSION_MINUTES}`));
    }
    if (perTxUsd > SESSION_MAX_USD.perTx || totalUsd > SESSION_MAX_USD.total) {
      throw new ProblemError(securityProblems.requestNotAllowed(`Fast trading covers at most $${SESSION_MAX_USD.perTx} a trade and $${SESSION_MAX_USD.total} in all.`));
    }
    let signedTx: string | undefined;
    if (firstTx !== undefined) {
      const w = await this.find(id);
      if (w.kind !== "trade" || w.chain === "near") throw new ProblemError(securityProblems.subwalletRefused("The first trade must come from one of your chain wallets."));
      if (typeof firstTx !== "string") throw new ProblemError(securityProblems.requestInvalid("firstTx must be base64"));
      const chain = w.chain as (typeof TRADE_CHAINS)[number];
      // the first trade's bound is dollars at the core's own price for its chain, read now
      const px = this.o.usdPrice ? await this.o.usdPrice(chain).catch(() => null) : null;
      if (!px || !(px > 0)) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
      const perTx = BigInt(Math.floor(((perTxUsd + FEE_ROOM_USD) / px) * 1e9)) * 10n ** BigInt(NATIVE_DECIMALS[chain] - 9);
      const first = await this.firstTrade(w, chain, firstTx, coin, perTx);
      // counted against the wallet's caps as any no-sheet trade is (review M3); past them it isn't the first trade
      const capped = await this.hotGate(w, undefined, chain, first.out);
      if (capped) throw new ProblemError(securityProblems.subwalletRefused(capped));
      signedTx = await first.sign();
    }
    const endsAt = Date.now() + m * 60_000;
    // A new Trade session replaces the one before.
    this.trade = { endsAt };
    return { endsAtIso: new Date(endsAt).toISOString(), ...(signedTx ? { signedTx } : {}) };
  }

  /**
   * Show the key once, after the sheet, for moving the wallet elsewhere (EVM: the private key as hex; Solana: the
   * 64-byte keypair, base58). With the device's own screen for it (showSecret: the phone), the key shows there and the
   * caller hears only { shown }.
   */
  async export(id: unknown): Promise<{ secretKey: string } | { shown: boolean } | { declined: true }> {
    const w = await this.find(id);
    const card = w.kind === "pay";
    const ok = await this.o
      .approve({
        title: `Show the secret key of your ${w.label.toLowerCase()}`,
        lines: [
          card ? "Anyone who sees it controls this wallet, and with it your Gnosis Pay card's account." : isChainWallet(w) ? "Anyone who sees it can spend everything in this wallet. That includes what ZeroFee adds later, up to your limit. ZeroFee keeps using this wallet." : "Anyone who sees it can take everything in this wallet.",
          "It's a standard key. Your Safe's key is stronger. Future computers can't break it.",
          "Only do this to move the wallet into another app you trust.",
        ],
        warnings: [{ kind: "key-change", text: "This shows a secret key on screen." }],
        effect: [],
      })
      .catch(() => false);
    if (!ok) return { declined: true };
    const secretKey = await this.keyText(w);
    if (this.o.showSecret) return { shown: await this.o.showSecret({ label: w.label, secretKey }).catch(() => false) };
    return { secretKey };
  }

  /**
   * The web wallet (product decision, 4 Nov, web-wallet.ts): a wallet's key for "Export private key", after the person typed
   * their password again (checked by the caller, the core's web door). No sheet: the password is the check there.
   */
  async exportChecked(id: unknown): Promise<{ secretKey: string }> {
    return { secretKey: await this.keyText(await this.find(id)) };
  }

  /** A wallet's key as its chain writes it (EVM: hex; Solana: the 64-byte keypair, base58; NEAR: ed25519:base58), marked
   *  exported first: an app killed while the key is on screen still leaves "Key exported" in Details (D56). */
  private async keyText(w: Stored): Promise<string> {
    await this.markExported(w.id);
    const secret = await this.secret(w);
    return w.chain === "near"
      ? `ed25519:${base58(new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]))}`
      : w.chain !== "sol"
        ? toHex(secret)
        : base58(new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]));
  }

  /** A wallet whose key was shown, kept in the list (one write at a time, as every write to it). */
  private markExported(id: string): Promise<void> {
    const next = this.writing.then(async () => {
      const list = await this.stored();
      await this.save(list.map((x) => (x.id === id ? { ...x, keyExported: true as const } : x)));
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** The phone makes the one-time code; the person types it into the extension's panel (never shown on the laptop). */
  linkStart(kind: unknown): { code: string; expiresAtIso: string } {
    if (kind !== "extension") throw new ProblemError(securityProblems.requestInvalid("only the extension links this way"));
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const code = Array.from(bytes, (b) => CROCKFORD[b & 31]).join("");
    this.link = { code, kind, expiresAt: Date.now() + LINK_TTL_MS };
    return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAtIso: new Date(this.link.expiresAt).toISOString() };
  }

  /** The link's key: the host's scrypt when it has one (the phone, natively), else @noble/hashes'; the same bytes. */
  private async linkKey(code: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
    const o = { N: 2 ** 17, r: 8, p: 1, dkLen: 32 };
    if (this.o.scrypt) {
      const key = await this.o.scrypt(code, salt, o).catch(() => null);
      if (key instanceof Uint8Array && key.length === o.dkLen) return key;
    }
    return scrypt(code, salt, o);
  }

  /** Open the extension's QR with the code this phone made. Single use: right or wrong, the code is then gone. */
  async import(kind: unknown, sealed: unknown): Promise<SubWallet[]> {
    const link = this.link;
    this.link = null;
    if (kind !== "extension" || !link || Date.now() > link.expiresAt) throw new ProblemError(securityProblems.linkExpired());
    let seed: Uint8Array;
    try {
      const box = JSON.parse(new TextDecoder().decode(fromBase64(String(sealed))));
      if (box?.v !== 1) throw new Error("version");
      const key = await this.linkKey(utf8(link.code), fromBase64(box.salt));
      // AES-GCM in plain JS (@noble/ciphers), never crypto.subtle: the phone's core runs in JavaScriptCore alone, which has
      // no WebCrypto (2 Nov: there the import's TypeError fell into this catch, and every right code read as "wrong").
      seed = gcm(key, fromBase64(box.iv), LINK_AD).decrypt(fromBase64(box.ct));
      if (seed.length !== 32) throw new Error("length");
    } catch {
      throw new ProblemError(securityProblems.linkWrong());
    }
    const address = solAddress(extensionSolSecret(seed));
    const ok = await this.o
      .approve({
        title: "Link the wallet in your laptop's ZeroFee panel",
        lines: [`Its address: ${short(address)}`, "This phone keeps its key too, and lets you move money into it and back.", "Approve only if you yourself typed this phone's code into your laptop."],
        warnings: [{ kind: "key-change", text: "Your laptop also holds this wallet's key." }],
        effect: [],
      })
      .catch(() => false);
    if (!ok) throw new ProblemError(securityProblems.linkDeclined());
    await this.add("extension", seed, "extension", "Extension wallet");
    return this.list();
  }
}
