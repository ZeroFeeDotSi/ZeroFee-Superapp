// Which coin an address means: the mint itself, or a pool of one of the venues the engine trades (a coin page may name
// its pool). One account read; decoded with the same layouts the engine prices with. The pump.fun bonding curve doesn't
// store its mint, so a curve address answers undefined (the caller can ask market data).
import { readStruct } from "./codec.ts";
import { CURVE } from "./curves.ts";
import { PROGRAM, WSOL } from "./keys.ts";
import { AMM_LAYOUT, CPMM_DISC, CPMM_LAYOUT, DISC } from "./layouts.ts";
import { fromBase64, hex8, pkAt } from "./bytes.ts";
import type { SolRpc } from "./rpc.ts";

export interface Resolved { mint: string; pool?: string; venue?: "pumpswap" | "cpmm" | "dbc" | "damm2" | "launchlab" }

/** Reads `address` once and says which coin it is; undefined when it is neither a mint nor a pool the engine knows. */
export async function resolveSolCoin(rpc: SolRpc, address: string): Promise<Resolved | undefined> {
  const r = await rpc.call("getMultipleAccounts", [[address], { encoding: "base64", commitment: "confirmed" }]);
  const v = r?.value?.[0];
  if (!v) return undefined;
  return resolveAccount(address, { owner: String(v.owner), data: fromBase64(v.data[0]) });
}

/** The same, on an account already read (pure). */
export function resolveAccount(address: string, row: { owner: string; data: Uint8Array }): Resolved | undefined {
  const { owner, data } = row;
  const notSol = (a: string, b: string) => (a === WSOL ? b : b === WSOL ? a : undefined);
  const is = (disc: readonly number[]) => data.length >= 8 && disc.every((x, i) => data[i] === x);
  // Anchor discriminators are sha256("account:<Name>")[0..8]: PumpSwap's and DAMM v2's "Pool" share one, as do CP-Swap's
  // and LaunchLab's "PoolState", so the owner program decides which layout it is
  if ((owner === PROGRAM.token || owner === PROGRAM.token2022) && data.length >= 82 && (data.length === 82 || data[165] === 1)) return { mint: address };
  if (owner === PROGRAM.pumpAmm && is(DISC.Pool)) {
    const p = readStruct(AMM_LAYOUT, "Pool", data);
    const mint = notSol(p.base_mint, p.quote_mint);
    return mint ? { mint, pool: address, venue: "pumpswap" } : undefined;
  }
  if (owner === PROGRAM.cpmm && is(CPMM_DISC.PoolState)) {
    const p = readStruct(CPMM_LAYOUT, "PoolState", data);
    const mint = notSol(p.token_0_mint, p.token_1_mint);
    return mint ? { mint, pool: address, venue: "cpmm" } : undefined;
  }
  if (owner === CURVE.dbc && data.length >= 310 && hex8(data) === "d5e005d16245775c") return { mint: pkAt(data, 136), pool: address, venue: "dbc" };            // VirtualPool.base_mint
  if (owner === CURVE.launchlab && data.length >= 366 && is(CPMM_DISC.PoolState)) return { mint: pkAt(data, 205), pool: address, venue: "launchlab" };   // PoolState.base_mint
  if (owner === CURVE.damm2 && data.length >= 700 && is(DISC.Pool)) {
    const mint = notSol(pkAt(data, 168), pkAt(data, 200));                                                                                                  // token A, token B
    return mint ? { mint, pool: address, venue: "damm2" } : undefined;
  }
  return undefined;
}
