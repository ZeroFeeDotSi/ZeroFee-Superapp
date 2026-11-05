// What the trading wallet agrees to sign. The engine and the panel build transactions from network data, so the vault
// reads every transaction itself before signing and refuses anything outside these rules:
//   - this wallet is the only signer, and it pays the fee;
//   - every top-level instruction goes to a venue Trade's engine builds for, or to the few plumbing programs a swap needs;
//   - SOL leaves the wallet only into its own wrapped-SOL account, or, when the person brings money back, to home;
//   - token accounts are closed only back to this wallet, and no authority or allowance is ever handed to anyone;
//   - the priority fee stays under a cap.
// The venues themselves enforce each swap's minimum out; how much a trade may spend is checked by simulation (vault.ts).
import { CURVE } from "@zerofee/trade/sol/curves.ts";
import { JUP_PROGRAM } from "@zerofee/trade/sol/jupiter.ts";
import { ataOf, PROGRAM, WSOL } from "@zerofee/trade/sol/keys.ts";
import { decodeTx, type DecodedTx } from "@zerofee/trade/sol/tx.ts";

/** The venues, by program. A new one is added here only when Trade's engine builds for it. */
export const VENUES: Record<string, string> = {
  [PROGRAM.pump]: "pump.fun",
  [PROGRAM.pumpAmm]: "PumpSwap",
  [PROGRAM.cpmm]: "Raydium CP-Swap",
  [CURVE.launchlab]: "Raydium LaunchLab",
  [CURVE.dbc]: "Meteora DBC",
  [CURVE.damm2]: "Meteora DAMM v2",
  [JUP_PROGRAM]: "Jupiter",
};
/** The most a transaction may pay in priority fee: 0.01 SOL. Trade's engine stays far below (at most 500k lamports). */
export const MAX_PRIORITY_LAMPORTS = 10_000_000n;
const DEFAULT_UNITS_PER_IX = 200_000n, MAX_UNITS = 1_400_000n;

export type Purpose = { kind: "trade" } | { kind: "withdraw"; to: string };
export type Verdict = { ok: true } | { ok: false; why: string };

const u32 = (d: Uint8Array, at: number) => (d.length >= at + 4 ? new DataView(d.buffer, d.byteOffset + at, 4).getUint32(0, true) : -1);
const u64 = (d: Uint8Array, at: number) => (d.length >= at + 8 ? new DataView(d.buffer, d.byteOffset + at, 8).getBigUint64(0, true) : -1n);

export function checkSolTx(txB64: string, owner: string, purpose: Purpose): Verdict {
  let tx: DecodedTx;
  try { tx = decodeTx(txB64); } catch { return { ok: false, why: "the transaction can't be read" }; }
  if (tx.header[0] !== 1 || tx.staticKeys[0] !== owner) return { ok: false, why: "this wallet must be the only signer and pay the fee" };
  if (purpose.kind === "withdraw" && tx.lookups.length) return { ok: false, why: "a transfer home needs no lookup tables" };

  const wsol = ataOf(owner, WSOL, PROGRAM.token);
  let units: bigint | undefined, price = 0n, work = 0n, home = false;
  for (const ix of tx.instructions) {
    const program = tx.staticKeys[ix.programIdIndex];
    const acct = (i: number) => { const k = ix.accounts[i]; return k === undefined ? undefined : tx.staticKeys[k]; };
    const d = ix.data;
    if (program === undefined) return { ok: false, why: "a program comes from a lookup table" };
    if (program === PROGRAM.computeBudget) {
      if (d[0] === 2 && d.length === 5) units = BigInt(u32(d, 1));
      else if (d[0] === 3 && d.length === 9) price = u64(d, 1);
      else if (!((d[0] === 1 || d[0] === 4) && d.length === 5)) return { ok: false, why: "an unknown compute-budget instruction" };
      continue;
    }
    work++;
    if (VENUES[program]) {
      if (purpose.kind === "withdraw") return { ok: false, why: "a transfer home trades nothing" };
      continue;
    }
    if (program === PROGRAM.system) {
      if (u32(d, 0) !== 2 || d.length !== 12 || acct(0) !== owner) return { ok: false, why: "the only system instruction allowed is a transfer from this wallet" };
      const to = acct(1);
      if (purpose.kind === "trade" && to === wsol) continue;
      if (purpose.kind === "withdraw" && to === purpose.to) { home = true; continue; }
      return { ok: false, why: "SOL would leave this wallet for someone else" };
    }
    if (program === PROGRAM.token || program === PROGRAM.token2022) {
      if (d[0] === 17 && d.length === 1) continue;                                                  // sync native
      if (d[0] === 9 && d.length === 1 && acct(1) === owner && acct(2) === owner) continue;           // close, back to this wallet
      if (program === PROGRAM.token2022 && d.length === 2 && d[0] === 26 && d[1] === 4) continue;   // harvest withheld fees to the mint
      return { ok: false, why: "a token instruction that could move or hand over coins" };
    }
    if (program === PROGRAM.ata) {
      if ((d.length === 0 || ((d[0] === 0 || d[0] === 1) && d.length === 1)) && acct(0) === owner && acct(2) === owner) continue;
      return { ok: false, why: "a token account for someone else" };
    }
    return { ok: false, why: `a program that isn't on the list (${program})` };
  }
  if (purpose.kind === "withdraw" && !home) return { ok: false, why: "a transfer home must send to home" };
  const budget = units ?? (work * DEFAULT_UNITS_PER_IX > MAX_UNITS ? MAX_UNITS : work * DEFAULT_UNITS_PER_IX);
  if ((budget * price + 999_999n) / 1_000_000n > MAX_PRIORITY_LAMPORTS) return { ok: false, why: "the priority fee is over the cap" };
  return { ok: true };
}
