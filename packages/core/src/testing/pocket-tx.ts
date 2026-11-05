// Tests only. AgentZero's pocket trades (D107): pump.fun buys and sales, a plain send, and a stand-in Solana node whose
// test run says what each built transaction does to the wallet's SOL (as the test recorded when it built it).
import { base58, base64, cat, fromBase58, u64le } from "../sol/bytes.ts";
import { SOL, ownTokenAccount } from "../solana.ts";
import type { SolChain } from "../solana.ts";
import { fairCoins } from "./sol-coins.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
export const SOL_USD = 150;
const lamportsOf = (usd: number) => BigInt(Math.round((usd * 1e9) / SOL_USD));
const u32 = (n: number) => new Uint8Array([n, 0, 0, 0]);
/** What each built tx does to the wallet's SOL in its test run: + leaves, − comes back (before the 5,000 fee). */
const effect = new Map<string, bigint>();

function legacyTx(keys: string[], ixs: { program: string; accounts: string[]; data: Uint8Array }[], readonlyUnsigned: number): string {
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, readonlyUnsigned], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}

/** The coin the pocket's buys buy (a stand-in mint): its sales name their own. */
export const POCKET_COIN = base58(new Uint8Array(32).fill(0x77));
const stand = (n: number) => base58(new Uint8Array(32).fill(n));
/**
 * pump.fun's buy_exact_quote_in_v3 / sell_v3 as Trade builds them (packages/trade/src/sol/pumpfun.ts curveSwapIx, 17
 * accounts), so the core's payout check (sol/decode.ts payoutRefusal) reads where it pays: global @0, mint @1, the quote
 * mint (wSOL) @2, the coin's token program @3, Token @4, the curve @5 and its two accounts @6 @7, the user @8, the user's
 * own coin account @9, its own wSOL account @10, then the volume account, fee config, buyback, System, event authority
 * and pump.fun itself (the stand-ins are fixed addresses).
 */
function pumpStep(payer: string, coin: string, data: Uint8Array) {
  return {
    program: PUMP,
    accounts: [stand(0x61), coin, SOL.wsol, SOL.token, SOL.token, stand(0x62), stand(0x63), stand(0x64), payer, ownTokenAccount(payer, coin), ownTokenAccount(payer, SOL.wsol), stand(0x65), stand(0x66), stand(0x67), SOL.system, stand(0x68), PUMP],
    data,
  };
}
/** A legacy transaction, `payer` the only signer; every program read-only, every other account writable. */
function txOf(payer: string, ixs: { program: string; accounts: string[]; data: Uint8Array }[]): string {
  const programs = [...new Set(ixs.map((i) => i.program))];
  const keys = [payer, ...new Set(ixs.flatMap((i) => i.accounts).filter((k) => k !== payer && !programs.includes(k))), ...programs];
  return legacyTx(keys, ixs, programs.length);
}

/** A pump.fun buy of `usd` dollars of SOL (at $150) by `payer`, wrapped into its own wSOL account; `floor` 0: no minimum. */
export function buy(payer: string, usd: number, floor = 1000n): string {
  const lamports = lamportsOf(usd);
  const wsol = ownTokenAccount(payer, SOL.wsol);
  const tx = txOf(payer, [
    { program: SOL.system, accounts: [payer, wsol], data: cat(u32(2), u64le(lamports)) },
    { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) },
    pumpStep(payer, POCKET_COIN, cat(Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]), u64le(lamports), u64le(floor), [0])),
  ]);
  effect.set(tx, lamports);
  return tx;
}

/** A pump.fun sale of `coin` by `payer` that brings back `usd` dollars of SOL, its floor `floorPct` % of that (90). */
export function sell(payer: string, coin: string, usd: number, floorPct = 90n): string {
  const back = lamportsOf(usd);
  const tx = txOf(payer, [pumpStep(payer, coin, cat(Uint8Array.from([0x1c, 0x92, 0xde, 0x77, 0x26, 0xc4, 0x69, 0xd5]), u64le(1_000_000n), u64le((back * floorPct) / 100n)))]);
  effect.set(tx, -back);
  return tx;
}

/** `usd` dollars of SOL sent from `payer` to `to`: no trade at all. */
export function send(payer: string, to: string, usd: number): string {
  const tx = legacyTx([payer, to, SOL.system], [{ program: SOL.system, accounts: [payer, to], data: cat(u32(2), u64le(lamportsOf(usd))) }], 1);
  effect.set(tx, lamportsOf(usd));
  return tx;
}

/** Both nodes agree; the wallet's SOL (`balance`, default 10 SOL) moves by what the tx was built to do, less the 5,000-lamport fee. */
export function pocketNode(balance: () => bigint = () => 10_000_000_000n): SolChain {
  return {
    blockhashValid: async () => true,
    lookupTables: async () => [],
    simulate: async (tx: string) => {
      const before = balance();
      return { ok: true, agreed: true, lamportsBefore: before, lamportsAfter: before - (effect.get(tx) ?? 0n) - 5_000n, tokens: fairCoins(tx) };
    },
  } as unknown as SolChain;
}
