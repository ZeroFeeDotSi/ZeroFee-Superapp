// Solana addresses: the programs the engine talks to, program-derived addresses (PDAs) and the wallet's token accounts.
//
// A PDA is the first sha256(seeds, bump, program, "ProgramDerivedAddress") from bump 255 down that is NOT a point on the
// ed25519 curve, so no private key can exist for it. The curve check is the same strict decoding @solana/web3.js uses.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, cat, fromBase58, utf8 } from "./bytes.ts";

export const PROGRAM = {
  pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpFees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
} as const;
export const WSOL = "So11111111111111111111111111111111111111112";
export const DEFAULT_KEY = "11111111111111111111111111111111";

/** The 32 bytes of an address. Throws on anything else. */
export function key(address: string): Uint8Array {
  const b = fromBase58(address);
  if (b.length !== 32) throw new Error(`not a Solana address: ${address}`);
  return b;
}

export function onCurve(b: Uint8Array): boolean {
  try { ed25519.Point.fromBytes(b); return true; } catch { return false; }
}

const MARKER = utf8("ProgramDerivedAddress");
export function pda(seeds: Uint8Array[], program: string): string {
  if (seeds.length > 15 || seeds.some((s) => s.length > 32)) throw new Error("PDA seeds too long");
  const p = key(program);
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(cat(...seeds, [bump], p, MARKER));
    if (!onCurve(h)) return base58(h);
  }
  throw new Error("no PDA found");
}

export const ataOf = (owner: string, mint: string, program: string): string => pda([key(owner), key(program), key(mint)], PROGRAM.ata);
export const eventAuthority = (program: string): string => pda([utf8("__event_authority")], program);
export const userVolumeAccumulator = (program: string, user: string): string => pda([utf8("user_volume_accumulator"), key(user)], program);
export const feeConfigOf = (seed: Uint8Array): string => pda([utf8("fee_config"), seed], PROGRAM.pumpFees);
export const ammGlobalConfig = (): string => pda([utf8("global_config")], PROGRAM.pumpAmm);
export const pumpGlobal = (): string => pda([utf8("global")], PROGRAM.pump);
export const bondingCurveOf = (mint: string): string => pda([utf8("bonding-curve"), key(mint)], PROGRAM.pump);

/** A graduated pump.fun coin's canonical PumpSwap pool: ["pool", index u16 = 0, the mint's pool-authority PDA of the pump program, base mint, wSOL]. */
export function canonicalPumpSwapPool(mint: string): string {
  const creator = pda([utf8("pool-authority"), key(mint)], PROGRAM.pump);
  return pda([utf8("pool"), Uint8Array.of(0, 0), key(creator), key(mint), key(WSOL)], PROGRAM.pumpAmm);
}

/** Raydium CP-Swap: AmmConfig ["amm_config", index u16 big-endian]; pool ["pool", config, token0, token1] with token0 < token1 by bytes. */
export const cpmmConfigAddress = (index: number): string => pda([utf8("amm_config"), Uint8Array.of(index >> 8, index & 255)], PROGRAM.cpmm);
export function cpmmPoolAddress(config: string, mintA: string, mintB: string): string {
  const [a, b] = [key(mintA), key(mintB)];
  let swap = false;
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) { swap = a[i]! > b[i]!; break; }
  return pda([utf8("pool"), key(config), swap ? b : a, swap ? a : b], PROGRAM.cpmm);
}
export const cpmmAuthority = (): string => pda([utf8("vault_and_lp_mint_auth_seed")], PROGRAM.cpmm);

export const shortAddr = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;
