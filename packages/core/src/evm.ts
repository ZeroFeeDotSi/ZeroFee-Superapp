// BNB Chain and Robinhood Chain for the separate wallets (S1.6b): keys, signing, what a fast-trade session may cover,
// and the network read on two nodes.
//
// The words come from Trade's decoder (vendored in ./evm/). The decisions here don't trust it alone: a session covers a
// transaction only if it is one of the few shapes a trade needs, aimed at the allowlist, paying back to this wallet,
// with a floor, and both nodes ran it (together with this wallet's signed transactions that haven't landed yet)
// without a revert. Anything else (a send, an unlimited approval, an unknown contract) goes to the approval sheet.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hedged } from "./hedge.ts";
import { HEALTH, scored } from "./node-health.ts";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { KNOWN_SPENDERS, PONS_LAUNCHER, unlimitedAllowance } from "./evm/decode.ts";
import { PROXY_SLOTS, V4_HOOKS, hookCodeRefusal } from "./evm/v4-hooks.ts";
import { isMiddleCoin } from "./evm/middle-coins.ts";
import type { EvmChainName, EvmDecoded } from "./evm/decode.ts";
import { fromBase64, fromHex, parseTx, rlpDecode, toHex } from "./evm/wire.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { Rlp } from "./evm/wire.ts";
import { readJson } from "./net.ts";
import { onCopy } from "./fork.ts";
import { HOOD_DOOR } from "./hood-door.ts";

export type { EvmChainName } from "./evm/decode.ts";

/** Every EVM chain a separate wallet lives on: Trade's two, and the Browser wallet's four (D29). */
export type EvmWalletChain = EvmChainName | "eth" | "base" | "gnosis" | "arb";
/** The Browser wallet's chains: no fast sessions there, and only the shapes every chain shares are read (evmPlain). */
export const BROWSER_EVM: readonly EvmWalletChain[] = ["eth", "base", "gnosis", "arb"];
export const isTradeEvm = (chain: EvmWalletChain): chain is EvmChainName => chain === "bsc" || chain === "hood";

export const EVM_CHAIN_ID: Record<EvmWalletChain, number> = { bsc: 56, hood: 4663, eth: 1, base: 8453, gnosis: 100, arb: 42161 };
export const NATIVE: Record<EvmWalletChain, string> = { bsc: "BNB", hood: "ETH", eth: "ETH", base: "ETH", gnosis: "xDAI", arb: "ETH" };
export const EVM_CHAIN_NAME: Record<EvmWalletChain, string> = { bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis Chain", arb: "Arbitrum" };
const UR: Record<EvmChainName, string> = { hood: "0x8876789976decbfcbbbe364623c63652db8c0904", bsc: "0x8b844f885672f333bc0042cb669255f93a4c1e6b" };
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/** The longest Permit2 allowance a session may sign (Trade uses 30 minutes). */
const PERMIT2_MAX_SEC = 3600;

export const evmAddress = (secret: Uint8Array) => toHex(keccak_256(secp256k1.getPublicKey(secret, false).subarray(1)).subarray(12));

/** An 0x address in its EIP-55 form (capitals from the Keccak hash of the lower-case hex), as explorers and wallets
 *  print it, so the sheet's payee reads character for character like the address the person was given. */
export function checksumAddress(address: string): string {
  const body = address.slice(2).toLowerCase();
  const hash = toHex(keccak_256(new TextEncoder().encode(body))).slice(2);
  return `0x${[...body].map((c, i) => (/[a-f]/.test(c) && parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}
/** A 40-hex 0x address whose capitals, if it has any mix of them, are its EIP-55 checksum (all lower or all upper case
 *  carries none). A mixed case that doesn't match is a typo or a changed character: refused, never lower-cased past. */
export function checksumOk(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  return body === body.toLowerCase() || body === body.toUpperCase() || checksumAddress(address) === address;
}

export const evmNative = (wei: bigint, chain: EvmWalletChain) => {
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${wei / 10n ** 18n}${frac ? `.${frac}` : ""} ${NATIVE[chain]}`;
};

function rlpEncode(x: Rlp): Uint8Array {
  const header = (len: number, base: number) => {
    if (len < 56) return [base + len];
    const l: number[] = [];
    for (let n = len; n > 0; n = Math.floor(n / 256)) l.unshift(n % 256);
    return [base + 55 + l.length, ...l];
  };
  if (x instanceof Uint8Array) return x.length === 1 && x[0] < 0x80 ? x : new Uint8Array([...header(x.length, 0x80), ...x]);
  const body = x.map(rlpEncode);
  const size = body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array([...header(size, 0xc0), ...new Uint8Array(size)]);
  let at = out.length - size;
  for (const b of body) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const bigBytes = (n: bigint) => (n === 0n ? new Uint8Array(0) : fromHex(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0")));

/** The unsigned transaction's bytes, if this wallet may sign it at all; otherwise why not. */
export function evmSignable(txB64: string, chain: EvmWalletChain): { bytes: Uint8Array } | { refusal: string } {
  let bytes: Uint8Array;
  let t;
  try {
    bytes = fromBase64(txB64);
    t = parseTx(bytes);
  } catch {
    return { refusal: "ZeroFee can't read this request." };
  }
  if (t.signature) return { refusal: "It is already signed." };
  // The signature is only good on this wallet's chain: a transaction for another chain would spend the same address there.
  if (t.chainId !== EVM_CHAIN_ID[chain]) return { refusal: `It is for chain ${t.chainId}, not this wallet's chain.` };
  const fields = rlpDecode(bytes.subarray(1)) as Rlp[];
  if (!Array.isArray(fields[8]) || fields[8].length !== 0) return { refusal: "It carries an access list a trade doesn't need." };
  // Re-encoding must give the same bytes: what the network hashes is what was read.
  const again = rlpEncode(fields);
  if (again.length !== bytes.length - 1 || again.some((b, i) => b !== bytes[i + 1])) return { refusal: "This request isn't in the standard form." };
  return { bytes };
}

/** Sign an EIP-1559 transaction: the signature over keccak256 of its bytes, appended as yParity, r, s. */
export function signEvmTx(unsigned: Uint8Array, secret: Uint8Array): string {
  const fields = rlpDecode(unsigned.subarray(1)) as Rlp[];
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), secret, { prehash: false, format: "recovered" }), "recovered");
  const signed = new Uint8Array([2, ...rlpEncode([...fields, bigBytes(BigInt(sig.recovery!)), bigBytes(sig.r), bigBytes(sig.s)])]);
  let s = "";
  for (const b of signed) s += String.fromCharCode(b);
  return btoa(s);
}

/** "No limit" on the sheet: the decoder's own rule (audit W-8), 2^128 or more (Permit2's maximum, 2^160 - 1, included). */
export const unlimited = (raw: string) => unlimitedAllowance(raw);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/**
 * KyberSwap's own executor, per chain, the only one a session covers (audit EVM-1: the route names its executor, and an
 * executor the route chose can take the coins and pay back 1 wei). The same address on both chains, with on-chain
 * evidence: it is the callTarget of KyberSwap router 0x6131…37b5's swap() in the recent transactions 0xed400afa…ffcd0
 * (BNB Chain) and 0x4cf8b52a…b5a (Robinhood Chain), each read on two nodes (Trade, checked by Security, 28 Oct), and in
 * Trade's recorded /route/build answers; and both chains hold a 13,529-byte contract there (eth_getCode, two nodes each,
 * re-checked 28 Oct for the fix review's RK-INFO). Re-checked 29 Oct (re-audit): KyberSwap's own live /route/build names
 * it as the swap's executor on both chains (router 0x6131…37b5); each chain's two nodes agree on its code (BNB Chain
 * sha256 3f9120d7…, Robinhood Chain 1418cef6…: the same size, not the same bytes, as a deploy's built-in addresses
 * differ per chain). Even the right executor runs the route it's given, so a
 * KyberSwap SALE (valued by its own route's test run) still asks; a buy is bounded by what it spends.
 */
const KYBER_EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
export const KYBER_EXECUTORS: Record<EvmChainName, ReadonlySet<string>> = { bsc: new Set([KYBER_EXECUTOR]), hood: new Set([KYBER_EXECUTOR]) };

/** A v4 pool's hook, read on two nodes (RpcEvmChain.hookFacts). */
export interface HookFacts { codehash: string; proxied: boolean; codeRefusal: string | null }

/** What the session needs checked on the network before it may cover a transaction. */
export interface EvmFacts {
  /** The wallet's balance of each coin the transaction approves, read on two nodes (the lower). */
  balances: Map<string, bigint>;
  /** The coin's Pons curve, as the launcher names it on two nodes: on the curve and paid in ETH. Null if not. */
  ponsCurve: string | null;
  /** For a v3 swap: the fee tier of the coin's deepest v3 pool (EvmChain.v3Deepest); null or absent when unread. */
  v3Deepest?: number | null;
  /** For a v4 swap through a pool with hooks: the hook as two nodes have it (EvmChain.hookFacts); null or absent when
   *  unread or the nodes differ. */
  hook?: HookFacts | null;
  /** For a two-hop swap (gap 5): the middle coin's deepest v3 tier against the wrapped native coin; null or absent unread. */
  midDeepest?: number | null;
}

/** Is this a trade the core signs with no sheet (D143, approval-policy.ts)? Null if yes; otherwise why not, and nothing
 *  is signed. */
export function evmSessionRefusal(d: EvmDecoded, wallet: string, chain: EvmChainName, facts: EvmFacts, nowSec: number): string | null {
  if (d.chain !== chain) return "It is for another chain.";
  if (d.transfer) return "It sends coins out of the wallet.";
  if (d.unknownTarget) return "It goes to an app ZeroFee doesn't know.";
  if (d.needsCheck && (!d.needsCheck.coin || d.needsCheck.launcher !== PONS_LAUNCHER || facts.ponsCurve !== d.needsCheck.curve)) return "Pons doesn't confirm this is the coin's own market.";
  if (d.approve) {
    const known = KNOWN_SPENDERS[chain][d.approve.spender] || (d.needsCheck && facts.ponsCurve === d.approve.spender);
    if (!known) return "It lets an app ZeroFee doesn't know spend a coin.";
    if (unlimited(d.approve.amount) || BigInt(d.approve.amount) > (facts.balances.get(d.approve.token) ?? 0n)) return "It allows more than this wallet holds.";
  }
  if (d.permit2) {
    if (d.to !== PERMIT2 || d.permit2.spender !== UR[chain]) return "It gives spending permission in a way a trade doesn't need.";
    if (unlimited(d.permit2.amount) || BigInt(d.permit2.amount) > (facts.balances.get(d.permit2.token) ?? 0n)) return "It allows more than this wallet holds.";
    if (d.permit2.expiry > nowSec + PERMIT2_MAX_SEC) return "Its spending permission lasts longer than a trade needs.";
  }
  if (d.swaps.length > 1) return "It makes more than one swap.";
  const s = d.swaps[0];
  if (s) {
    if (BigInt(s.minOutRaw) === 0n) return "It has no minimum you get back.";
    // Paid to this wallet itself; never to address(2) (audit EVM-2: only a v3 sale's inner hop uses it, and the decoder
    // reports that sale's real payee instead).
    if (s.recipient && s.recipient.toLowerCase() !== wallet.toLowerCase()) return "It pays out to someone else.";
    // The price is the market's, not a route's own (audit EVM-1): the direct pool only, a v4 pool without hooks, and a
    // KyberSwap executor ZeroFee knows. Anything else: the sheet.
    // Gap 5 (the review's ruling 4 Nov): one middle coin, only one pinned in middle-coins.ts; its middle balance and the
    // reference band are checked after the test run (subwallets.ts tradeRefusal)
    if (s.path && s.path.length !== 2 && !(s.path.length === 3 && isMiddleCoin(chain, s.path[1]!))) return "It goes through another coin first.";
    // review L4: its v3 hop is on the middle coin's deepest tier against the wrapped native coin (two nodes), as a single
    // v3 trade is held to the coin's own deepest tier
    if (s.midFee !== undefined && facts.midDeepest !== s.midFee) return "It doesn't trade on the middle coin's deepest pool.";
    // A pool with hooks (gap 4, the review's ruling 4 Nov): only a launchpad's hook pinned in v4-hooks.ts, whose code
    // two nodes have as the pinned codehash, with no proxy slot set and no way to change what it runs. The test run, the
    // floor, the coins and the reference band are checked after it (subwallets.ts tradeRefusal), the caps as any trade.
    if (s.hooks !== undefined && s.hooks !== ZERO_ADDRESS) {
      const h = s.hooks.toLowerCase();
      const pinned = Object.hasOwn(V4_HOOKS[chain], h) ? V4_HOOKS[chain][h] : undefined;
      if (!pinned) return "It uses a pool with hooks ZeroFee doesn't know.";
      if (!facts.hook) return "Its pool's hooks couldn't be checked on two network servers.";
      if (facts.hook.codehash !== pinned.codehash) return "Its pool's hooks aren't the code ZeroFee checked.";
      if (facts.hook.proxied || facts.hook.codeRefusal) return "Its pool's hooks can be changed.";
    }
    // The pool is the coin's deepest, not one a route picked (the fix review: anyone can make a thin pool at a fee tier
    // nobody used, and price a session's trade there). v3: the tier whose pool holds the most of the wrapped native coin,
    // read on two nodes. A v4 pool, or a KyberSwap buy's route: priced against a reference after the test run
    // (referenceRefusal, subwallets.ts).
    if (s.fee !== undefined && facts.v3Deepest !== s.fee) return "It doesn't trade on the coin's deepest pool.";
    if (s.executor !== undefined && !KYBER_EXECUTORS[chain].has(s.executor)) return "It goes through an app ZeroFee doesn't know.";
    // D143 (review, 3 Nov): a KyberSwap sale goes the checked way a buy does: its own executor, paid to this wallet,
    // a floor, only the coin it sells leaving, and at least 85 % of an independent reference (subwallets.ts tradeRefusal)
  }
  if (!s && !d.approve && !d.permit2) return "It isn't a trade.";
  return null;
}

/** One transaction as a node runs it from the wallet. */
export interface EvmCall {
  from: string;
  to: string;
  value: bigint;
  data: string;
  gas: bigint;
  /** The transaction's own fees per gas (wei). Given, the test run is priced (audit D148 L1c): a coin that taxes only
   *  when tx.gasprice > 0 shows its tax there, as it will on chain. */
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface EvmSimulated {
  /** Both nodes ran every call without a revert. */
  ok: boolean;
  /** Both nodes answered AND said the same (sameSimulation): the same outcome, the same coins, amounts within
   *  AGREE_BPS of each other. Two answers alone are not an agreement (audit D148 L1). */
  agreed: boolean;
  /** The wallet's native balance (the lower of the two nodes). */
  balance: bigint;
  /**
   * What the last call brings into the wallet in the chain's own coin, less what it sends out (gas aside), from both
   * nodes' traced transfers (the lower): a sell's proceeds at today's price. Absent or 0: nothing comes back.
   */
  nativeIn?: bigint;
  /** The higher of the two nodes' nativeIn: for a minimum's floor only (a minimum must sit near the most it could get). */
  nativeInHigh?: bigint;
  /**
   * The coins the last call brings into the wallet, less what it sends out, by coin contract (lowercase), from both
   * nodes' traced Transfer logs (the lower): what a buy really gets (audit EVM-3). Absent: not read.
   */
  coinsIn?: Map<string, bigint>;
  /** The higher of the two nodes' coinsIn, by coin: for a minimum's floor only. */
  coinsInHigh?: Map<string, bigint>;
  /** The gas the last call used in the run, the higher of the two nodes' answers (review M6: a limit far past it is a
   *  failed check). Absent: a node didn't say. */
  gasUsed?: bigint;
}

/** eth_simulateV1's traced native transfers: an ERC-20 Transfer log from this pseudo-address (measured on BNB Chain and
 *  Robinhood Chain's four nodes, 28 Oct). */
const NATIVE_TRANSFER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The wallet's net native gain from one simulated call's logs. */
/** Coins (ERC-20 Transfer logs, any contract but the native pseudo-address) into the wallet less out of it, by coin. */
/** Two nodes' amounts count as the same within this many basis points. Both run the calls on the same block (simulate's
 *  pinned head), where honest nodes match exactly, so none: any gap is a disagreement and the trade isn't covered. */
export const AGREE_BPS = 0n;
const near = (a: bigint, b: bigint): boolean => {
  const hi = a > b ? a : b, lo = a > b ? b : a;
  return hi === 0n ? true : (hi - lo) * 10_000n <= hi * AGREE_BPS;
};
/**
 * Do two nodes' test runs of the same calls say the same thing (audit D148 L1: "agreed" meant only that both answered)?
 * The same outcome (both ran or both reverted), the same coins moving in or out of the wallet, and each amount, and the
 * native coin in, within AGREE_BPS. The balance isn't compared: it is the wallet's before the calls, and the lower is used.
 */
export function sameSimulation(a: { ok: boolean; nativeIn: bigint; coins: Map<string, bigint> }, b: { ok: boolean; nativeIn: bigint; coins: Map<string, bigint> }): boolean {
  if (a.ok !== b.ok) return false;
  if (!near(a.nativeIn, b.nativeIn)) return false;
  const keys = new Set([...a.coins.keys(), ...b.coins.keys()]);
  for (const k of keys) {
    const x = a.coins.get(k), y = b.coins.get(k);
    if (x === undefined || y === undefined) return false;
    if ((x < 0n) !== (y < 0n)) return false;
    if (!near(x < 0n ? -x : x, y < 0n ? -y : y)) return false;
  }
  return true;
}

export function coinGains(logs: unknown, wallet: string): Map<string, bigint> {
  const me = wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const net = new Map<string, bigint>();
  for (const l of Array.isArray(logs) ? logs : []) {
    const topics = (l as { topics?: unknown }).topics;
    const coin = String((l as { address?: unknown }).address).toLowerCase();
    if (coin === NATIVE_TRANSFER || !Array.isArray(topics) || topics.length !== 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    const amount = /^0x[0-9a-fA-F]{1,64}$/.test(String((l as { data?: unknown }).data)) ? BigInt(String((l as { data: string }).data)) : 0n;
    if (String(topics[2]).toLowerCase().endsWith(me)) net.set(coin, (net.get(coin) ?? 0n) + amount);
    if (String(topics[1]).toLowerCase().endsWith(me)) net.set(coin, (net.get(coin) ?? 0n) - amount);
  }
  return net;
}

export function nativeGain(logs: unknown, wallet: string): bigint {
  const me = wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let net = 0n;
  for (const l of Array.isArray(logs) ? logs : []) {
    const topics = (l as { topics?: unknown }).topics;
    if (String((l as { address?: unknown }).address).toLowerCase() !== NATIVE_TRANSFER || !Array.isArray(topics) || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    const amount = /^0x[0-9a-fA-F]{1,64}$/.test(String((l as { data?: unknown }).data)) ? BigInt(String((l as { data: string }).data)) : 0n;
    if (String(topics[2]).toLowerCase().endsWith(me)) net += amount;
    if (String(topics[1]).toLowerCase().endsWith(me)) net -= amount;
  }
  return net > 0n ? net : 0n;
}

/**
 * The v3 factories and fee tiers Trade's engine trades on, and each chain's wrapped native coin; the factory and the
 * wrapped coin read from each chain's v3 router (factory(), WETH9()) on two nodes, 28 Oct: PancakeSwap v3 on BNB Chain,
 * Uniswap v3 on Robinhood Chain.
 */
export const V3_POOLS: Record<EvmChainName, { factory: string; fees: number[]; wrapped: string; quoter: string }> = {
  bsc: { factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865", fees: [100, 500, 2500, 10000], wrapped: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", quoter: "0xb048bbc1ee6b733fffcfb9e9cef7375518e25997" },
  hood: { factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa", fees: [100, 500, 3000, 10000], wrapped: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" },
};
// (Each quoter is QuoterV2 for that factory: its factory() read on two nodes, 28 Oct.)

/** A session trade whose pools its route chose (a v4 pool, a KyberSwap buy) gets at least this share of an independent
 *  reference, or asks (the fix review; Trade: a thin pool's own impact and fee fit inside, a theft worth doing doesn't). */
export const REFERENCE_FLOOR_PCT = 85n;
/** Review M2 (4 Nov): a v3 pool is a coin's price reference only when it holds at least this many dollars of the wrapped
 *  native coin (a 1-wei pool made by anyone would otherwise "agree" with any price); else the market's price, else the sheet. */
export const REFERENCE_MIN_POOL_USD = 50_000;

/** A trade that gets `got` against a reference that would give `reference` (same units): why it isn't signed, or null. */
export function referenceRefusal(got: bigint | undefined, reference: bigint | null): string | null {
  if (reference === null || reference <= 0n) return "There's no market price to check it against.";
  if (got === undefined || got * 100n < reference * REFERENCE_FLOOR_PCT) return "It gets less than the market would give.";
  return null;
}

export interface EvmChain {
  /** Run these calls in order in one block, on two nodes. The last is the one being signed; the others are this
   *  wallet's signed transactions that may not have landed yet. */
  simulate(chain: EvmWalletChain, calls: EvmCall[], block?: bigint | null): Promise<EvmSimulated>;
  /** The lower of the two nodes' latest block numbers, the block both run a test on; null unless both answer. */
  head?(chain: EvmWalletChain): Promise<bigint | null>;
  /** The wallet's count of sent transactions (the next nonce), on two nodes (the lower). */
  nonce(chain: EvmWalletChain, wallet: string): Promise<number>;
  /** A coin's balance for the wallet, on two nodes (the lower). */
  tokenBalance(chain: EvmWalletChain, token: string, wallet: string): Promise<bigint>;
  /** A coin's symbol and decimals, read from the coin on two nodes. */
  token(chain: EvmWalletChain, token: string): Promise<{ symbol: string; decimals: number } | undefined>;
  /** The coin's Pons curve, as the launcher names it on two nodes, if it is still on the curve and paid in ETH. */
  ponsCurve(coin: string): Promise<string | null>;
  /** Fees for a transaction now, on two nodes (the higher of each): EIP-1559's tip and most per gas (twice the base fee plus the tip). */
  fees(chain: EvmWalletChain): Promise<{ tip: bigint; maxFee: bigint }>;
  /** The gas a call needs, on two nodes (the higher). Throws if neither can run it. */
  estimateGas(chain: EvmWalletChain, call: Omit<EvmCall, "gas">): Promise<bigint>;
  /** Send a signed transaction to both nodes; true if either took it (the hash is the transaction's own). Neither: false,
   *  or (RpcEvmChain) thrown with the nodes' own words, so the caller can say why. */
  send(chain: EvmWalletChain, signedB64: string): Promise<boolean>;
  /** An address as each of the two nodes has it now: its count of sent transactions (latest and pending) and its balance;
   *  null for a node that didn't answer. The core's proof that a move in was never paid (float-moves.ts). */
  account?(chain: EvmWalletChain, address: string): Promise<({ latest: number; pending: number; balance: bigint } | null)[]>;
  /** A sent transaction's receipt as each of the two nodes has it: "ok", "failed", null (the node answered: no receipt)
   *  or "unread" (the node didn't answer: never an absence, the audit's MUST 7 Nov). */
  receipt(chain: EvmWalletChain, hash: string): Promise<("ok" | "failed" | null | "unread")[]>;
  /** One read for a site (D29 wallet mode): one node, the other if it fails. Reads decide nothing. */
  read(chain: EvmWalletChain, method: string, params: unknown[]): Promise<unknown>;
  /** The fee tier of the coin's deepest v3 pool against the wrapped native coin (the most of it held), on two nodes;
   *  null when it has none. */
  v3Deepest?(chain: EvmChainName, coin: string): Promise<number | null>;
  /** What `amountIn` of `tokenIn` brings in `tokenOut` through that chain's v3 pool at `fee` (QuoterV2), on two nodes, the lower. */
  v3Quote?(chain: EvmChainName, tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): Promise<bigint>;
  /** A v4 pool's hook as two nodes have it at `block`: its code's keccak256 (the same on both), whether an EIP-1967 slot
   *  is set, and why its code could change (hookCodeRefusal); null when either node didn't answer or they differ. */
  hookFacts?(chain: EvmChainName, hook: string, block?: bigint | null): Promise<HookFacts | null>;
  /** The coin's deepest v3 tier against the wrapped native coin AND how much of that coin its pool holds (the lower of two
   *  nodes): a pool counts as a price reference only when it is deep enough (review M2). Null: no such pool. */
  v3DeepestHeld?(chain: EvmChainName, coin: string): Promise<{ fee: number; held: bigint } | null>;
}

/** The coins a Browser wallet's balance shows besides the chain's own (D29), each read from the coin on two nodes on
 *  26 Oct (symbol and decimals). Display only: a coin that isn't here still moves, it just isn't listed. */
export const KNOWN_COINS: Partial<Record<EvmWalletChain, readonly { token: string; symbol: string; decimals: number }[]>> = {
  eth: [{ token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 }, { token: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 }],
  base: [{ token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 }],
  arb: [{ token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", decimals: 6 }],
  gnosis: [{ token: "0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430", symbol: "EURe", decimals: 18 }, { token: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", symbol: "USDC.e", decimals: 6 }],
};

/** Where a person follows a transaction, by chain. */
export const EVM_EXPLORER: Record<EvmWalletChain, string> = {
  bsc: "https://bscscan.com/tx/",
  hood: "https://explorer.chain.robinhood.com/tx/",
  eth: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  gnosis: "https://gnosisscan.io/tx/",
  arb: "https://arbiscan.io/tx/",
};

/** Robinhood's first node (dRPC since a web test): on mainnet the relay's door (hood-proxy.ts) is asked in its slot first, the node after. */
const HOOD_SLOT = "https://robinhood.drpc.org";
/**
 * Two free nodes per chain, run by different operators, that answer eth_simulateV1 (BNB and Robinhood measured by Trade,
 * 25 Oct; Ethereum, Base, Gnosis and Arbitrum by S1, 26 Oct). Robinhood: dRPC and publicnode (a web test, 4 Nov: the chain's
 * own rpc.mainnet.chain.robinhood.com timed out at 8 s three times per Home load while dRPC answered in 50–150 ms; both
 * answered eth_getBalance, eth_simulateV1, eth_gasPrice and eth_feeHistory that day); its own node is a screen's spare. Arbitrum's publicnode refuses every eth_getTransactionReceipt ("Archive requests require a personal token", even
 * for the latest block's), so a send there could never be confirmed on two nodes and every one ended "problem" though it
 * went (mainnet, 2 Nov); drpc answers each read the core asks (every chain's two
 * nodes checked the same day: node tools/mainnet/evm-nodes-check.ts).
 */
export const EVM_NODES: Record<EvmWalletChain, string[]> = {
  bsc: onCopy("bsc", ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"]),
  hood: onCopy("hood", ["https://robinhood.drpc.org", "https://robinhood-rpc.publicnode.com"]),
  // (the mainnet copy has no Ethereum, Base, Gnosis or Arbitrum: no node there, fork.ts onCopy)
  eth: onCopy(null, ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]),
  base: onCopy(null, ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]),
  gnosis: onCopy(null, ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"]),
  arb: onCopy(null, ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"]),
};

/** More free operators for a screen's reads only (read(), data stream 3 Nov): each answered eth_getBalance and eth_call
 *  from a browser origin on 3 Nov (CORS open) and is in the phone's CSP. Never one of the two a money read compares. */
export const EVM_READ_SPARES: Partial<Record<EvmWalletChain, string[]>> = {
  bsc: onCopy("bsc", ["https://rpc-bsc.48.club", "https://bsc-dataseed1.defibit.io"]),
  hood: onCopy("hood", ["https://rpc.mainnet.chain.robinhood.com"]),
};

const word = (v: string) => v.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const hexQ = (n: bigint) => `0x${n.toString(16)}`;

const GWEI = 1_000_000_000n;
/**
 * The most the core pays per gas on each chain (audit NF-16): above it a node is lying or the network is in a storm, and
 * nothing is signed. Today's fees are far below (BNB Chain about 0.1 gwei, the rollups about 0.01).
 */
export const FEE_CAPS: Record<EvmWalletChain, { tip: bigint; maxFee: bigint }> = {
  bsc: { tip: 3n * GWEI, maxFee: 10n * GWEI },
  hood: { tip: GWEI / 2n, maxFee: 2n * GWEI },
  eth: { tip: 5n * GWEI, maxFee: 200n * GWEI },
  base: { tip: GWEI / 2n, maxFee: 5n * GWEI },
  arb: { tip: GWEI / 2n, maxFee: 5n * GWEI },
  gnosis: { tip: 5n * GWEI, maxFee: 50n * GWEI },
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
/** A node's refusal in its own words (its JSON-RPC error's message when there is one), short. */
const words = (e: unknown): string => {
  const m = String((e as Error)?.message ?? e);
  try {
    const j = JSON.parse(m);
    if (typeof j?.message === "string") return j.message.slice(0, 160);
  } catch {}
  return m.slice(0, 160);
};
/** Two nodes' answers: the higher when they agree within 2×, else the lower (one node alone can't raise it). */
const agreed = (xs: bigint[]) => {
  const [lo, hi] = xs.length === 2 && xs[0]! > xs[1]! ? [xs[1]!, xs[0]!] : [xs[0]!, xs[xs.length - 1]!];
  return hi > lo * 2n ? lo : hi;
};

/** A node answered with a JSON-RPC error (it was reached and said no), as against no answer at all. */
class NodeRefused extends Error {}

/** A node that didn't answer a receipt read (receipt): kept apart from its answer "no receipt" (null). */
const UNREAD = Symbol("unread");

export class RpcEvmChain implements EvmChain {
  private readonly nodes: Record<EvmWalletChain, string[]>;
  constructor(nodes = EVM_NODES) {
    this.nodes = nodes;
  }

  /** One call in one node's slot. Robinhood's own node's slot asks ZeroFee's relay first (hood-door.ts, hood-proxy.ts
   *  hoodNodes: Alchemy, its key on the relay only), and that node after when the relay fails, answers 429 or 503: money
   *  still compares that slot with dRPC, two operators. A node's JSON-RPC error is its answer, never a reason to ask on. */
  private async rpc(url: string, method: string, params: unknown[]): Promise<any> {
    const order = url === HOOD_SLOT && HOOD_DOOR.order ? HOOD_DOOR.order([url], method) : [url];
    for (let i = 0; ; i++) {
      const u = order[i]!;
      try {
        // scored (node-health.ts): each node's time and its 429s, 5xx and refusals rank the next display read
        const body: any = await scored(u, method, () => (HOOD_DOOR.fetch ?? fetch)(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000) }), (res) => readJson(res));
        if (body?.error) throw new NodeRefused(JSON.stringify(body.error).slice(0, 200));
        return body.result;
      } catch (e) {
        if (e instanceof NodeRefused || i >= order.length - 1) throw e;
      }
    }
  }

  private both<T>(chain: EvmWalletChain, ask: (url: string) => Promise<T>): Promise<(T | null)[]> {
    return Promise.all(this.nodes[chain].slice(0, 2).map((u) => ask(u).catch(() => null)));
  }

  private async lower(chain: EvmWalletChain, ask: (url: string) => Promise<unknown>): Promise<bigint> {
    const got = (await this.both(chain, ask)).map((v) => (typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) ? BigInt(v === "0x" ? 0 : v) : null));
    if (got.some((v) => v === null)) throw new Error("a node didn't answer");
    return (got as bigint[]).reduce((m, v) => (v < m ? v : m));
  }

  async head(chain: EvmWalletChain): Promise<bigint | null> {
    const got = (await this.both(chain, (u) => this.rpc(u, "eth_blockNumber", []))).map((v) => (typeof v === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(v) ? BigInt(v) : null));
    if (got.length !== 2 || got.some((v) => v === null)) return null;
    return (got as bigint[]).reduce((m, v) => (v < m ? v : m));
  }

  /**
   * The calls on both nodes at one block (block: head(), read beside the nonce, so no wait is added; absent, "latest", where
   * nodes a block apart rarely match and the trade asks). Priced (audit D148 L1c): each call's tip is set to its own fee
   * cap, so whatever base fee a node gives the run's block, tx.gasprice = min(cap, base + cap) = the cap, the most it can
   * pay, never 0 (the tx's own tip can be 0); a coin that taxes only when gasprice > 0 shows it. A node that refuses the priced run with an error (its fee fields, or a wallet short of gas at the cap) runs it unpriced
   * (one more call to that node only; not checked against a live node);
   * if just one does, the two answers differ on such a coin and the trade isn't covered; if both do, it is the old run, which
   * the session's caps and the reference-price check bound.
   */
  async simulate(chain: EvmWalletChain, calls: EvmCall[], block?: bigint | null): Promise<EvmSimulated> {
    const wallet = calls[calls.length - 1].from;
    const at = typeof block === "bigint" ? hexQ(block) : "latest";
    const run = (u: string, priced: boolean) => this.rpc(u, "eth_simulateV1", [{
      blockStateCalls: [{ calls: calls.map((c) => ({ from: c.from, to: c.to, value: hexQ(c.value), data: c.data, gas: hexQ(c.gas), ...(priced && c.maxFeePerGas !== undefined ? { maxFeePerGas: hexQ(c.maxFeePerGas), maxPriorityFeePerGas: hexQ(c.maxFeePerGas) } : {}) })) }],
      traceTransfers: true,
      validation: false,
    }, at]);
    const priced = calls.some((c) => c.maxFeePerGas !== undefined);
    const answers = await this.both(chain, async (u) => {
      const [balance, sim] = await Promise.all([
        this.rpc(u, "eth_getBalance", [wallet, at]),
        run(u, priced).catch((e: unknown) => { if (priced && e instanceof NodeRefused) return run(u, false); throw e; }),
      ]);
      const results = sim?.[0]?.calls;
      const ok = Array.isArray(results) && results.length === calls.length && results.every((r: any) => r?.status === "0x1");
      const last = results?.[results.length - 1]?.logs;
      const used = results?.[results.length - 1]?.gasUsed;
      return { balance: BigInt(balance), ok, nativeIn: ok ? nativeGain(last, wallet) : 0n, coins: ok ? coinGains(last, wallet) : new Map<string, bigint>(), gasUsed: typeof used === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(used) ? BigInt(used) : undefined };
    });
    const got = answers.filter((a): a is NonNullable<typeof a> => !!a);
    if (got.length === 0) return { ok: false, agreed: false, balance: 0n, nativeIn: 0n };
    const lower = (pick: (a: (typeof got)[number]) => bigint) => got.reduce((m, a) => (pick(a) < m ? pick(a) : m), pick(got[0]));
    const higher = (pick: (a: (typeof got)[number]) => bigint) => got.reduce((m, a) => (pick(a) > m ? pick(a) : m), pick(got[0]));
    // Each coin either node saw (never the first node's list alone: audit D148 L1), at the lower of the two answers (a coin
    // one node didn't see counts 0 there); the higher kept apart for a minimum's floor.
    const seen = [...new Set(got.flatMap((a) => [...a.coins.keys()]))];
    const coinsIn = new Map(seen.map((c) => [c, lower((a) => a.coins.get(c) ?? 0n)]));
    const coinsInHigh = new Map(seen.map((c) => [c, higher((a) => a.coins.get(c) ?? 0n)]));
    const gasUsed = got.every((a) => a.gasUsed !== undefined) ? higher((a) => a.gasUsed!) : undefined;
    return { ok: got.every((a) => a.ok), agreed: got.length === 2 && sameSimulation(got[0], got[1]), balance: lower((a) => a.balance), nativeIn: lower((a) => a.nativeIn), nativeInHigh: higher((a) => a.nativeIn), coinsIn, coinsInHigh, ...(gasUsed !== undefined ? { gasUsed } : {}) };
  }

  async nonce(chain: EvmWalletChain, wallet: string): Promise<number> {
    return Number(await this.lower(chain, (u) => this.rpc(u, "eth_getTransactionCount", [wallet, "latest"])));
  }

  async tokenBalance(chain: EvmWalletChain, token: string, wallet: string): Promise<bigint> {
    return this.lower(chain, (u) => this.rpc(u, "eth_call", [{ to: token, data: `0x70a08231${word(wallet)}` }, "latest"]));
  }

  async token(chain: EvmWalletChain, token: string): Promise<{ symbol: string; decimals: number } | undefined> {
    const read = async (u: string) => {
      const [dec, sym] = await Promise.all([this.rpc(u, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"]), this.rpc(u, "eth_call", [{ to: token, data: "0x95d89b41" }, "latest"])]);
      const decimals = Number(BigInt(dec));
      // symbol() is an ABI string: offset, length, bytes.
      const b = fromHex(sym);
      const len = b.length >= 64 ? Number(BigInt(toHex(b.subarray(32, 64)))) : 0;
      const symbol = new TextDecoder().decode(b.subarray(64, 64 + Math.min(len, 32))).replace(/[^\p{L}\p{N}.$_-]/gu, "").slice(0, 16);
      return symbol && Number.isInteger(decimals) && decimals <= 36 ? `${symbol}|${decimals}` : null;
    };
    const [a, b] = await this.both(chain, read);
    if (!a || a !== b) return undefined;
    const [symbol, decimals] = a.split("|");
    return { symbol, decimals: Number(decimals) };
  }

  /**
   * Today's tip and most-per-gas (audit NF-16). Two nodes' answers that disagree by more than 2× give the lower, so one
   * node alone can't raise what the core pays; the tip is capped per chain (FEE_CAPS), and a fee above the chain's cap is
   * refused (security.fee.high), not paid.
   */
  async fees(chain: EvmWalletChain): Promise<{ tip: bigint; maxFee: bigint }> {
    const answers = await this.both(chain, async (u) => {
      const [block, tip] = await Promise.all([this.rpc(u, "eth_getBlockByNumber", ["latest", false]), this.rpc(u, "eth_maxPriorityFeePerGas", [])]);
      return { base: BigInt(block?.baseFeePerGas ?? "0x0"), tip: BigInt(tip) };
    });
    const got = answers.filter((a): a is NonNullable<typeof a> => !!a);
    if (got.length === 0) throw new Error("no node answered");
    const cap = FEE_CAPS[chain];
    const base = agreed(got.map((a) => a.base));
    const tip = min(agreed(got.map((a) => a.tip)), cap.tip);
    const maxFee = base * 2n + tip;
    if (maxFee > cap.maxFee) throw new ProblemError(securityProblems.feeHigh(EVM_CHAIN_NAME[chain as keyof typeof EVM_CHAIN_NAME]));
    return { tip, maxFee };
  }

  /** Gas for a call: two nodes' estimates must agree within 2× (audit NF-16), else nothing is signed. */
  async estimateGas(chain: EvmWalletChain, call: Omit<EvmCall, "gas">): Promise<bigint> {
    const said: string[] = [];
    const ask = (u: string) => this.rpc(u, "eth_estimateGas", [{ from: call.from, to: call.to, value: hexQ(call.value), data: call.data }]).catch((e: unknown) => (said.push(words(e)), null));
    const got = (await this.both(chain, ask)).filter((v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(v)).map((v) => BigInt(v));
    if (got.length === 0) throw new Error(`neither node could run it${said.length ? `: ${said.join(" / ")}` : ""}`);
    const [lo, hi] = got.length === 2 && got[0]! > got[1]! ? [got[1]!, got[0]!] : [got[0]!, got[got.length - 1]!];
    if (hi > lo * 2n) throw new ProblemError(securityProblems.nodesDisagree());
    return hi;
  }

  async send(chain: EvmWalletChain, signedB64: string): Promise<boolean> {
    const raw = toHex(fromBase64(signedB64));
    const said: string[] = [];
    const answers = await this.both(chain, (u) => this.rpc(u, "eth_sendRawTransaction", [raw]).catch((e: unknown) => (said.push(words(e)), null)));
    if (answers.some((a) => typeof a === "string")) return true;
    // Neither took it: their own words, for the move's record (mainnet 2 Nov: "gas required exceeds allowance (21000)").
    throw new Error(`neither node took it${said.length ? `: ${said.join(" / ")}` : ""}`);
  }

  async account(chain: EvmWalletChain, address: string): Promise<({ latest: number; pending: number; balance: bigint } | null)[]> {
    const n = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? BigInt(v) : null);
    return this.both(chain, async (u) => {
      const got = await Promise.all([this.rpc(u, "eth_getTransactionCount", [address, "latest"]), this.rpc(u, "eth_getTransactionCount", [address, "pending"]), this.rpc(u, "eth_getBalance", [address, "latest"])]);
      const [latest, pending, balance] = got.map(n);
      return latest === null || pending === null || balance === null ? null : { latest: Number(latest), pending: Number(pending), balance };
    });
  }

  async receipt(chain: EvmWalletChain, hash: string): Promise<("ok" | "failed" | null | "unread")[]> {
    // a node that failed is "unread" (both() gives null for it), never "no receipt" (the audit's MUST, 7 Nov)
    const answers = (await this.both(chain, async (u) => ({ r: await this.rpc(u, "eth_getTransactionReceipt", [hash]) }))).map((x) => (x === null ? UNREAD : x.r));
    // A receipt counts only for the hash asked, in a block (security review, 2 Nov): any other object is "not yet".
    const ours = (a: any) => a && typeof a.status === "string" && typeof a.transactionHash === "string" && a.transactionHash.toLowerCase() === hash.toLowerCase() && typeof a.blockHash === "string";
    return answers.map((a) => (a === UNREAD ? "unread" : ours(a) ? (a.status === "0x1" ? "ok" : "failed") : null));
  }

  async read(chain: EvmWalletChain, method: string, params: unknown[]): Promise<unknown> {
    // D134, D10: the second node is asked when the first fails or is slow (hedge.ts), never after its 8 s timeout
    // a screen's read (data stream, 3 Nov): the healthiest node first, more free operators after (never in a money pair)
    const nodes = this.nodes === EVM_NODES ? [...new Set([...this.nodes[chain], ...(EVM_READ_SPARES[chain] ?? [])])] : this.nodes[chain];
    return hedged(HEALTH.serving(nodes, method), (u) => this.rpc(u, method, params));
  }

  /** Each coin's deepest v3 tier, kept 5 minutes: being the deepest takes more of the wrapped coin than the others hold,
   *  which a few minutes don't change for a thin pool (and a read costs two rounds to two nodes, ~1 s). */
  private readonly deepest = new Map<string, { fee: number | null; held: bigint; at: number }>();

  async v3Deepest(chain: EvmChainName, coin: string): Promise<number | null> {
    return (await this.v3DeepestHeld(chain, coin))?.fee ?? null;
  }

  async v3DeepestHeld(chain: EvmChainName, coin: string): Promise<{ fee: number; held: bigint } | null> {
    const key = `${chain}:${coin.toLowerCase()}`;
    let kept = this.deepest.get(key);
    if (!kept || Date.now() - kept.at >= 5 * 60_000) {
      const d = await this.v3DeepestNow(chain, coin);
      kept = { fee: d?.fee ?? null, held: d?.held ?? 0n, at: Date.now() };
      this.deepest.set(key, kept);
    }
    return kept.fee === null ? null : { fee: kept.fee, held: kept.held };
  }

  async hookFacts(chain: EvmChainName, hook: string, block?: bigint | null): Promise<HookFacts | null> {
    const at = typeof block === "bigint" ? `0x${block.toString(16)}` : "latest";
    const read = async (u: string): Promise<HookFacts | null> => {
      const [code, ...slots] = await Promise.all([this.rpc(u, "eth_getCode", [hook, at]), ...PROXY_SLOTS.map((s) => this.rpc(u, "eth_getStorageAt", [hook, s, at]))]);
      if (typeof code !== "string" || !/^0x[0-9a-fA-F]*$/.test(code) || slots.some((v) => typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v))) return null;
      const bytes = fromHex(code);
      return { codehash: toHex(keccak_256(bytes)), proxied: slots.some((v: string) => /[1-9a-fA-F]/.test(v.slice(2))), codeRefusal: hookCodeRefusal(bytes) };
    };
    const [a, b] = await this.both(chain, read);
    // both nodes, the same code and the same slots, or no answer (a node that lies about a hook can only make it refused)
    if (!a || !b || a.codehash !== b.codehash || a.proxied !== b.proxied) return null;
    return a;
  }

  async v3Quote(chain: EvmChainName, tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): Promise<bigint> {
    const { quoter } = V3_POOLS[chain];
    const data = `0xc6a5026a${word(tokenIn)}${word(tokenOut)}${word(`0x${amountIn.toString(16)}`)}${word(`0x${fee.toString(16)}`)}${word("0x0")}`;
    return this.lower(chain, async (u) => {
      const r = await this.rpc(u, "eth_call", [{ to: quoter, data }, "latest"]);
      return typeof r === "string" && r.length >= 66 ? r.slice(0, 66) : null;
    });
  }

  private async v3DeepestNow(chain: EvmChainName, coin: string): Promise<{ fee: number; held: bigint } | null> {
    const { factory, fees, wrapped } = V3_POOLS[chain];
    const pools = await Promise.all(
      fees.map(async (fee) => {
        const [a, b] = await this.both(chain, (u) => this.rpc(u, "eth_call", [{ to: factory, data: `0x1698ee82${word(coin)}${word(wrapped)}${word(`0x${fee.toString(16)}`)}` }, "latest"]));
        if (typeof a !== "string" || a !== b) throw new Error("the nodes disagree about a pool");
        const pool = `0x${a.slice(-40)}`.toLowerCase();
        return { fee, pool, held: /^0x0{40}$/.test(pool) ? 0n : await this.tokenBalance(chain, wrapped, pool) };
      }),
    );
    const deepest = pools.reduce((best, p) => (p.held > best.held ? p : best), { fee: -1, pool: "", held: 0n });
    return deepest.held > 0n ? { fee: deepest.fee, held: deepest.held } : null;
  }

  async ponsCurve(coin: string): Promise<string | null> {
    const read = async (u: string) => {
      const w = (await this.rpc(u, "eth_call", [{ to: PONS_LAUNCHER, data: `0x3cf28b5a${word(coin)}` }, "latest"])) as string;
      const words = w.slice(2).match(/.{64}/g) ?? [];
      const addr = (x: string | undefined) => `0x${(x ?? "").slice(24)}`;
      if (words.length < 5 || addr(words[0]) !== coin.toLowerCase() || BigInt(`0x${words[4]}`) !== 0n) return "none";
      const curve = addr(words[1]);
      if (/^0x0{40}$/.test(curve)) return "none";
      const graduated = (await this.rpc(u, "eth_call", [{ to: curve, data: "0xe7c2b772" }, "latest"])) as string;
      return BigInt(graduated.slice(0, 66)) === 0n ? curve : "none";
    };
    const [a, b] = await this.both("hood", read);
    return a && a === b && a !== "none" ? a : null;
  }
}

/** What a Browser wallet's transaction does (D29: any site may ask), read from its bytes. Only the shapes every chain
 *  shares are read: a send, a coin's transfer or approve, an approval of a whole collection. Anything else is a contract
 *  call that ZeroFee can't read, and the sheet says so. */
export type EvmPlain =
  | { kind: "send"; to: string; value: bigint }
  | { kind: "transfer"; token: string; recipient: string; amount: bigint; value: bigint }
  | { kind: "approve"; token: string; spender: string; amount: bigint; value: bigint }
  | { kind: "approveAll"; collection: string; operator: string; value: bigint }
  | { kind: "call"; to: string; selector: string; value: bigint };

export function evmPlain(t: { to: string; value: bigint; data: string }): EvmPlain {
  const to = t.to.toLowerCase(), data = t.data.replace(/^0x/, "").toLowerCase();
  if (!data) return { kind: "send", to, value: t.value };
  const sel = data.slice(0, 8), args = data.slice(8).match(/.{64}/g) ?? [];
  // An ABI address: 12 zero bytes, then 20.
  const address = (w: string) => (/^0{24}/.test(w) ? `0x${w.slice(24)}` : null);
  if (data.length === 8 + 128) {
    const a = address(args[0] ?? ""), n = BigInt(`0x${args[1] ?? "0"}`);
    if (a && sel === "a9059cbb") return { kind: "transfer", token: to, recipient: a, amount: n, value: t.value };
    if (a && sel === "095ea7b3") return { kind: "approve", token: to, spender: a, amount: n, value: t.value };
    if (a && sel === "a22cb465" && n === 1n) return { kind: "approveAll", collection: to, operator: a, value: t.value };
  }
  return { kind: "call", to, selector: sel.length === 8 ? `0x${sel}` : "", value: t.value };
}

/** An unsigned EIP-1559 transaction, base64, as Trade's engine writes it (for tests and tools). */
export function unsignedEvmTx(t: { chainId: number; nonce: number; tip: bigint; fee: bigint; gas: bigint; to: string; value: bigint; data: string }): string {
  const fields: Rlp[] = [bigBytes(BigInt(t.chainId)), bigBytes(BigInt(t.nonce)), bigBytes(t.tip), bigBytes(t.fee), bigBytes(t.gas), fromHex(t.to), bigBytes(t.value), fromHex(t.data), []];
  let s = "";
  for (const b of [2, ...rlpEncode(fields)]) s += String.fromCharCode(b);
  return btoa(s);
}
