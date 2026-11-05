// The NEAR coin wallet's trade, read and built by the core (near-trade.ts has the shapes and the checks). Every figure
// it is held to is read at one final block two nodes agree on (Chain.commonBlock): the pool's two coins and kind, the
// pool's own answer for the amount (get_return), the wallet's key and nonce, its wNEAR and its accounts. Nothing here
// signs: SubWallets signs what this returns, after its caps (D143) and, past them, the one-tap sheet.
import { toBase58 } from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Block, Chain } from "./chain.ts";
import { txHashOf } from "./chain.ts";
import { NEAR_FAIR_SHARE, NEAR_POOL_DEPTH, NEAR_SLIPPAGE_MAX_BPS, NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR, nearRegisterTx, nearTradeBytesRefusal, nearTradeTx, sheetSymbol, type NearTradeAsk } from "./near-trade.ts";
import { RHEA_COIN_ROOM_YOCTO, RHEA_ROOM_YOCTO, rheaBytesRefusal, rheaDepositTx, rheaRoomBackTx, rheaRoomTx, rheaSwapTx, rheaWithdrawTx, type RheaRule } from "./near-rhea.ts";
import { sameTransaction, serialize, signedBase64, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";

/** What the app can do about a refusal: open the coin's (or wNEAR's) account, or the wallet's room in Rhea (near-rhea.ts). */
export type NearRefusedCode = "near.coin.unregistered" | "near.wnear.unregistered" | "near.rhea.unregistered" | "near.rhea.room";
/** Why a NEAR trade isn't built, said plainly; `code` when the app can act on it (register the coin first). */
export class NearTradeRefused extends Error {
  readonly code?: NearRefusedCode;
  constructor(message: string, code?: NearRefusedCode) { super(message); if (code) this.code = code; }
}

export interface NearBuilt {
  tx: UnsignedTx;
  /** What it is worth to the caps, in dollars at the core's own market prices (review H1): the larger of what goes in and
   *  what comes back. Null: a price couldn't be read (the one-tap sheet asks). */
  usd: number | null;
  /** The coin as its own contract names it (ft_metadata at the agreed block), for the sheet; and its places. */
  symbol: string;
  decimals: number;
  /** The wallet's balance of the coin that comes back, at the agreed build block (two nodes): the M3 fallback's before. */
  beforeOut?: string;
  /** What it is worth to the caps, in yoctoNEAR: a buy's NEAR in, a sale's wNEAR out at the pool's own answer. */
  valueYocto: bigint;
  /** The pool's own answer at the block (the coin's units for a buy, yocto wNEAR for a sale). */
  poolOut: bigint;
  block: Block;
}

const YOCTO = 10n ** 24n;
export const nearPublicKey = (secret: Uint8Array) => `ed25519:${toBase58(ed25519.getPublicKey(secret))}`;
const big = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);

/** The nonce and the block a transaction from this wallet's key is built on; a key that isn't full access is refused. */
async function keyAt(chain: Chain, wallet: string, publicKey: string, block: Block): Promise<bigint> {
  const key = await chain.accessKey(wallet, publicKey, block);
  if (!key) throw new NearTradeRefused("The NEAR coin wallet has no NEAR yet. Move some in first.");
  if (key.permission.kind !== "full") throw new NearTradeRefused("This wallet's key can't sign a trade.");
  return key.nonce + 1n;
}

/** The core's own dollar prices a NEAR trade is held to (review H1): NEAR's, and the coin's from a source the app doesn't
 *  control (1Click's token list, else the relay's market read); null when it can't be read. */
export interface NearPrices {
  /** NEAR's price, or its read still on its way (speed, 5 Nov: read beside the block and the views, never before them). */
  near: number | null | Promise<number | null>;
  coin: (coin: string) => Promise<number | null>;
}

/** The checks every NEAR coin trade is held to, whichever shape it takes (near-trade.ts's or near-rhea.ts's), from reads at
 *  the one agreed block: the pool, its own answer, the coin's own name and places, and the core's own prices. */
function poolChecks(a: NearTradeAsk, r: { pool: unknown; ret: unknown; meta: unknown; coinUsd: number | null; nearUsd: number | null }): { out: bigint; usd: number | null; symbol: string; decimals: number } {
  const { pool, ret, meta, coinUsd, nearUsd } = r;
  // the pool is a plain two-coin pool of exactly this coin and wNEAR (a stable or rated pool prices differently)
  const p = pool as { pool_kind?: unknown; token_account_ids?: unknown; amounts?: unknown } | null;
  const ids = Array.isArray(p?.token_account_ids) ? (p!.token_account_ids as unknown[]) : [];
  if (p?.pool_kind !== "SIMPLE_POOL" || ids.length !== 2 || !ids.includes(a.coin) || !ids.includes(WNEAR)) throw new NearTradeRefused("That pool doesn't trade this coin for NEAR.");
  const out = big(ret);
  if (out === null || out <= 0n) throw new NearTradeRefused("Rhea's pool can't price it right now.");
  // the coin's own places and name, from its contract at this block (never the app's word)
  const m = meta as { decimals?: unknown; symbol?: unknown } | null;
  const decimals = typeof m?.decimals === "number" && Number.isInteger(m.decimals) && m.decimals >= 0 && m.decimals <= 36 ? m.decimals : null;
  if (decimals === null) throw new NearTradeRefused("This coin doesn't say what it is.");
  const symbol = sheetSymbol(m?.symbol, a.coin);
  // review H1: the pool's NEAR is deep against the trade (a dust pool made to drain a wallet is never traded in)
  const amounts = Array.isArray(p?.amounts) ? (p!.amounts as unknown[]) : [];
  const poolNear = big(amounts[ids.indexOf(WNEAR)]);
  const nearMoved = a.side === "buy" ? BigInt(a.amountIn) : out;
  if (poolNear === null || poolNear < nearMoved * NEAR_POOL_DEPTH) throw new NearTradeRefused("That pool is too thin for this trade.");
  // review H1: valued at the core's own market prices, never the pool's own answer alone; under 85 % back is refused
  const coinUnits = (raw: bigint) => Number(raw) / 10 ** decimals;
  const nearUnits = (raw: bigint) => Number(raw / 10n ** 18n) / 1e6;
  let usd: number | null = null;
  if (nearUsd && coinUsd && coinUsd > 0) {
    const inUsd = a.side === "buy" ? nearUnits(BigInt(a.amountIn)) * nearUsd : coinUnits(BigInt(a.amountIn)) * coinUsd;
    const outUsd = a.side === "buy" ? coinUnits(out) * coinUsd : nearUnits(out) * nearUsd;
    if (inUsd >= 0.01 && outUsd < inUsd * NEAR_FAIR_SHARE) throw new NearTradeRefused(a.side === "sell" ? "It brings back much less than the coin is worth." : "It gets much less of the coin than it pays for.");
    usd = Math.max(inUsd, outUsd);
  }
  // the least is real: under the pool's own answer, never more than 5 % under it (a sale with a token least is refused)
  const min = BigInt(a.minOut);
  if (min > out) throw new NearTradeRefused("The price moved. Nothing was signed. Try again.");
  if (min * 10_000n < out * BigInt(10_000 - NEAR_SLIPPAGE_MAX_BPS)) throw new NearTradeRefused("It could get back over 5% less than the pool gives now.");
  return { out, usd, symbol, decimals };
}

/** A NEAR coin trade, built from the ask at one agreed block, or refused by name. */
export async function buildNearTrade(chain: Chain, wallet: string, publicKey: string, a: NearTradeAsk, prices: NearPrices): Promise<NearBuilt> {
  const block = await chain.commonBlock();
  const [tokenIn, tokenOut] = a.side === "buy" ? [WNEAR, a.coin] : [a.coin, WNEAR];
  const view = (contract: string, method: string, args: Record<string, unknown>) => chain.view(contract, method, args, block);
  const [pool, ret, nonce, wnear, wnearReg, outReg, held, meta, coinUsd, outHeld, nearUsd] = await Promise.all([
    view(REF_EXCHANGE_ID, "get_pool", { pool_id: a.poolId }),
    view(REF_EXCHANGE_ID, "get_return", { pool_id: a.poolId, token_in: tokenIn, amount_in: a.amountIn, token_out: tokenOut }),
    keyAt(chain, wallet, publicKey, block),
    a.side === "buy" ? view(WNEAR, "ft_balance_of", { account_id: wallet }) : Promise.resolve("0"),
    view(WNEAR, "storage_balance_of", { account_id: wallet }),
    a.side === "buy" ? view(a.coin, "storage_balance_of", { account_id: wallet }) : Promise.resolve(null),
    a.side === "sell" ? view(a.coin, "ft_balance_of", { account_id: wallet }) : Promise.resolve(null),
    view(a.coin, "ft_metadata", {}),
    prices.coin(a.coin).catch(() => null),
    view(tokenOut, "ft_balance_of", { account_id: wallet }),
    Promise.resolve(prices.near).catch(() => null),
  ]);
  const { out, usd, symbol, decimals } = poolChecks(a, { pool, ret, meta, coinUsd, nearUsd });
  const amount = BigInt(a.amountIn);
  let wrapYocto = 0n, registerWnearYocto: bigint | undefined;
  if (a.side === "buy") {
    // the coin comes back to the wallet's own account on the coin: none yet and Rhea would keep it (lost and found)
    if (outReg === null) throw new NearTradeRefused("This coin needs its account in your wallet first.", "near.coin.unregistered");
    const w = big(wnear) ?? 0n;
    wrapYocto = amount > w ? amount - w : 0n;
    if (wnearReg === null) registerWnearYocto = 1_250_000_000_000_000_000_000n;   // wrap.near's own storage bound
  } else {
    const h = big(held) ?? 0n;
    if (h < amount) throw new NearTradeRefused("The wallet doesn't hold that much of it.");
    // the sale's wNEAR comes back to the wallet's own wNEAR account: none yet and Rhea would keep it
    if (wnearReg === null) throw new NearTradeRefused("Your wallet needs its NEAR account first.", "near.wnear.unregistered");
  }
  const built = nearTradeTx(a, { wrapYocto, wallet, ...(registerWnearYocto !== undefined ? { registerWnearYocto } : {}) });
  const tx: UnsignedTx = { signerId: wallet, publicKey, nonce, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions };
  const valueYocto = (a.side === "buy" ? amount : out) + (registerWnearYocto ?? 0n);
  const regUsd = registerWnearYocto !== undefined && nearUsd ? (Number(registerWnearYocto / 10n ** 18n) / 1e6) * nearUsd : 0;
  return { tx, valueYocto, poolOut: out, block, usd: usd === null ? null : usd + regUsd, symbol, decimals, beforeOut: (big(outHeld) ?? 0n).toString() };
}

/**
 * A coin's (or wNEAR's) account for the wallet: its own storage bound, read at an agreed block, at most 0.00125 NEAR.
 * Review M2: only a coin Rhea trades against NEAR in a plain pool (`poolId`, checked at the same block); wNEAR's own needs
 * no pool. (At most once a day per coin: SubWallets keeps the count.)
 */
export async function buildNearRegister(chain: Chain, wallet: string, publicKey: string, coin: string, poolId: number | undefined, nearUsd: number | null): Promise<NearBuilt> {
  const block = await chain.commonBlock();
  if (coin !== WNEAR && !(typeof poolId === "number" && Number.isInteger(poolId) && poolId >= 0)) throw new NearTradeRefused("A coin's account opens only for a coin Rhea trades.");
  const [bounds, reg, nonce, pool, meta] = await Promise.all([
    chain.view(coin, "storage_balance_bounds", {}, block),
    chain.view(coin, "storage_balance_of", { account_id: wallet }, block),
    keyAt(chain, wallet, publicKey, block),
    coin === WNEAR ? Promise.resolve(null) : chain.view(REF_EXCHANGE_ID, "get_pool", { pool_id: poolId }, block),
    chain.view(coin, "ft_metadata", {}, block),
  ]);
  if (coin !== WNEAR) {
    const p = pool as { pool_kind?: unknown; token_account_ids?: unknown } | null;
    const ids = Array.isArray(p?.token_account_ids) ? (p!.token_account_ids as unknown[]) : [];
    if (p?.pool_kind !== "SIMPLE_POOL" || ids.length !== 2 || !ids.includes(coin) || !ids.includes(WNEAR)) throw new NearTradeRefused("A coin's account opens only for a coin Rhea trades.");
  }
  if (reg !== null) throw new NearTradeRefused("This coin's account is already in your wallet.");
  const least = big((bounds as { min?: unknown } | null)?.min);
  if (least === null || least <= 0n || least > NEAR_STORAGE_MAX_YOCTO) throw new NearTradeRefused("This coin asks too much to hold it.");
  const built = nearRegisterTx(coin, wallet, least);
  const symbol = sheetSymbol((meta as { symbol?: unknown } | null)?.symbol, coin);
  return { tx: { signerId: wallet, publicKey, nonce, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions }, valueYocto: least, poolOut: 0n, block, usd: nearUsd ? (Number(least / 10n ** 18n) / 1e6) * nearUsd : null, symbol, decimals: 0 };
}

/** The built transaction's bytes decoded again and held to the rules, then signed. Throws NearTradeRefused otherwise. */
export function signNearBuilt(b: NearBuilt, wallet: string, secret: Uint8Array, rule: NearTradeAsk | { register: string } | RheaRule): { signedTx: string; hash: string } {
  const bytes = serialize(b.tx);
  const d = decodeTransaction(bytes);
  if (!sameTransaction(d, b.tx)) throw new NearTradeRefused("ZeroFee can't read every part of it.");
  const why = "rhea" in rule ? rheaBytesRefusal(d, wallet, rule) : nearTradeBytesRefusal(d, wallet, "register" in rule ? { register: rule.register, maxYocto: NEAR_STORAGE_MAX_YOCTO } : rule);
  if (why) throw new NearTradeRefused(why);
  if (nearPublicKey(secret) !== b.tx.publicKey) throw new NearTradeRefused("This wallet's key doesn't match it.");
  const hash = txHashOf(bytes);
  const signature = ed25519.sign(sha256(bytes), secret);
  return { signedTx: signedBase64(b.tx, signature), hash };
}

// ── Rhea's internal balances (near-rhea.ts): one call per trade ────────────────────────────────────────────────────────

/** The wallet's own account in Rhea, as Ref gives it at the block: its coins (token -> smallest units) and its room. */
export interface RheaAccount {
  /** False: the wallet has no account in Rhea yet (never readied). */
  open: boolean;
  deposits: Record<string, bigint>;
  /** Ref's storage paid for the account, less what it uses. */
  roomYocto: bigint;
}

/** Ref's get_deposits and get_user_storage_state for the wallet, read at the block (two nodes, chain.view). */
export async function rheaAccountAt(chain: Chain, wallet: string, block: Block): Promise<RheaAccount> {
  const [deps, state] = await Promise.all([
    chain.view(REF_EXCHANGE_ID, "get_deposits", { account_id: wallet }, block),
    chain.view(REF_EXCHANGE_ID, "get_user_storage_state", { account_id: wallet }, block),
  ]);
  return rheaAccountOf(deps, state);
}
export function rheaAccountOf(deps: unknown, state: unknown): RheaAccount {
  const deposits: Record<string, bigint> = {};
  if (deps && typeof deps === "object" && !Array.isArray(deps)) for (const [k, v] of Object.entries(deps as Record<string, unknown>)) { const n = big(v); if (n !== null) deposits[k] = n; }
  const st = state as { deposit?: unknown; usage?: unknown } | null;
  const dep = big(st?.deposit), use = big(st?.usage);
  return { open: dep !== null && use !== null, deposits, roomYocto: dep !== null && use !== null && dep > use ? dep - use : 0n };
}

/**
 * A NEAR coin trade on the wallet's Rhea balance (near-rhea.ts swap): the same pool, price and least checks as
 * buildNearTrade at one agreed block, then the wallet's own Rhea account holds the coin going in, and room for the coin
 * coming out (Ref refuses a swap with no room, E11). `beforeOut`: the coin out's Rhea balance at the block.
 */
export async function buildRheaSwap(chain: Chain, wallet: string, publicKey: string, a: NearTradeAsk, prices: NearPrices): Promise<NearBuilt> {
  const block = await chain.commonBlock();
  const [tokenIn, tokenOut] = a.side === "buy" ? [WNEAR, a.coin] : [a.coin, WNEAR];
  const view = (contract: string, method: string, args: Record<string, unknown>) => chain.view(contract, method, args, block);
  const [pool, ret, nonce, acct, meta, coinUsd, nearUsd] = await Promise.all([
    view(REF_EXCHANGE_ID, "get_pool", { pool_id: a.poolId }),
    view(REF_EXCHANGE_ID, "get_return", { pool_id: a.poolId, token_in: tokenIn, amount_in: a.amountIn, token_out: tokenOut }),
    keyAt(chain, wallet, publicKey, block),
    rheaAccountAt(chain, wallet, block),
    view(a.coin, "ft_metadata", {}),
    prices.coin(a.coin).catch(() => null),
    Promise.resolve(prices.near).catch(() => null),
  ]);
  const { out, usd, symbol, decimals } = poolChecks(a, { pool, ret, meta, coinUsd, nearUsd });
  if (!acct.open) throw new NearTradeRefused("Your NEAR isn't ready for trading yet.", "near.rhea.unregistered");
  if ((acct.deposits[tokenIn] ?? 0n) < BigInt(a.amountIn)) throw new NearTradeRefused(a.side === "buy" ? "Your NEAR ready for trading is less than this buy." : "The wallet doesn't hold that much of it.");
  if (acct.deposits[tokenOut] === undefined && acct.roomYocto < RHEA_COIN_ROOM_YOCTO) throw new NearTradeRefused("Your wallet needs more room in Rhea for this coin.", "near.rhea.room");
  const built = rheaSwapTx(a);
  const tx: UnsignedTx = { signerId: wallet, publicKey, nonce, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions };
  return { tx, valueYocto: a.side === "buy" ? BigInt(a.amountIn) : out, poolOut: out, block, usd, symbol, decimals, beforeOut: (acct.deposits[tokenOut] ?? 0n).toString() };
}

/** NEAR the NEAR coin wallet always keeps out of Rhea for its own gas (as near-coin.ts NEAR_GAS_KEEP). */
const RHEA_GAS_KEEP = 50_000_000_000_000_000_000_000n;

/**
 * "Ready NEAR for trading" (one tap): the wallet's room in Rhea when it has none or too little left (RHEA_ROOM_YOCTO,
 * once), then its NEAR (`amount` yocto, or "all" it can move past its storage and the gas it keeps) into its own Rhea
 * account. Each built at one agreed block, in order (the room's nonce first); none when there is nothing to do.
 */
export async function buildRheaAdd(chain: Chain, wallet: string, publicKey: string, amount: bigint | "all"): Promise<{ room?: NearBuilt; deposit?: NearBuilt; amount: bigint }> {
  const block = await chain.commonBlock();
  const [acc, nonce, wnear, wnearReg, acct] = await Promise.all([
    chain.account(wallet, block),
    keyAt(chain, wallet, publicKey, block),
    chain.view(WNEAR, "ft_balance_of", { account_id: wallet }, block),
    chain.view(WNEAR, "storage_balance_of", { account_id: wallet }, block),
    rheaAccountAt(chain, wallet, block),
  ]);
  if (!acc) throw new NearTradeRefused("The NEAR coin wallet has no NEAR yet. Move some in first.");
  const needRoom = !acct.open || acct.roomYocto < 3n * RHEA_COIN_ROOM_YOCTO;
  const roomYocto = needRoom ? RHEA_ROOM_YOCTO : 0n;
  const registerWnearYocto = wnearReg === null ? NEAR_STORAGE_MAX_YOCTO : undefined;
  const held = big(wnear) ?? 0n;
  // what it may move: its NEAR past its storage, the gas it keeps, the room and wNEAR's account, the 1 yocto; and its wNEAR
  const locked = acc.storageBytes * 10n ** 19n + RHEA_GAS_KEEP + roomYocto + (registerWnearYocto ?? 0n) + 1n;
  const free = acc.balanceYocto > locked ? acc.balanceYocto - locked : 0n;
  const can = free + held;
  const units = amount === "all" ? can : amount;
  if (units > can) throw new NearTradeRefused("Your NEAR coin wallet doesn't have that much to move.");
  const at = (n: bigint, built: { receiverId: string; actions: UnsignedTx["actions"] }, valueYocto: bigint): NearBuilt =>
    ({ tx: { signerId: wallet, publicKey, nonce: n, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions }, valueYocto, poolOut: 0n, block, usd: null, symbol: "NEAR", decimals: 24 });
  const room = needRoom ? at(nonce, rheaRoomTx(wallet), RHEA_ROOM_YOCTO) : undefined;
  const wrapYocto = units > held ? units - held : 0n;
  const deposit = units > 0n ? at(room ? nonce + 1n : nonce, rheaDepositTx(units, { wrapYocto, wallet, ...(registerWnearYocto !== undefined ? { registerWnearYocto } : {}) }), units) : undefined;
  return { ...(room ? { room } : {}), ...(deposit ? { deposit } : {}), amount: units };
}

/** The wallet's wNEAR out of its Rhea account (Put away's first step when its NEAR is there), at most what it holds. */
export async function buildRheaWithdraw(chain: Chain, wallet: string, publicKey: string, amount: bigint): Promise<NearBuilt> {
  const block = await chain.commonBlock();
  const [nonce, wnearReg, acct] = await Promise.all([
    keyAt(chain, wallet, publicKey, block),
    chain.view(WNEAR, "storage_balance_of", { account_id: wallet }, block),
    rheaAccountAt(chain, wallet, block),
  ]);
  // Ref sends it to the wallet's own wNEAR account: none and Ref would keep it
  if (wnearReg === null) throw new NearTradeRefused("Your wallet needs its NEAR account first.", "near.wnear.unregistered");
  if (amount <= 0n || (acct.deposits[WNEAR] ?? 0n) < amount) throw new NearTradeRefused("Your NEAR in Rhea is less than that.");
  const built = rheaWithdrawTx(amount);
  return { tx: { signerId: wallet, publicKey, nonce, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions }, valueYocto: amount, poolOut: 0n, block, usd: null, symbol: "NEAR", decimals: 24 };
}

/** The wallet's room in Rhea, its unused part, back to the wallet (Put away's last Rhea step, once its NEAR is all out). */
export async function buildRheaRoomBack(chain: Chain, wallet: string, publicKey: string): Promise<{ b: NearBuilt; amount: bigint } | null> {
  const block = await chain.commonBlock();
  const [nonce, acct] = await Promise.all([keyAt(chain, wallet, publicKey, block), rheaAccountAt(chain, wallet, block)]);
  if (!acct.open || acct.roomYocto <= 0n) return null;
  const amount = acct.roomYocto > RHEA_ROOM_YOCTO ? RHEA_ROOM_YOCTO : acct.roomYocto;
  const built = rheaRoomBackTx(amount);
  return { amount, b: { tx: { signerId: wallet, publicKey, nonce, receiverId: built.receiverId, blockHash: block.hash, actions: built.actions }, valueYocto: 0n, poolOut: 0n, block, usd: null, symbol: "NEAR", decimals: 24 } };
}

export const yoctoToNear = (y: bigint) => Number(y) / Number(YOCTO);
