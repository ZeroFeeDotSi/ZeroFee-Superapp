// Solana v0 transactions, built here instead of with @solana/web3.js. The account order is the one web3.js's
// compileToV0Message makes (the fee payer first, then writable signers, read-only signers, writable and read-only
// accounts, each in first-seen order), so the bytes equal what the old engine built. Address lookup tables are drained
// the way web3.js drains them: per table, its writable then read-only accounts that aren't signers or programs.
// The swaps built here fit without tables; an aggregator's route uses them, and decodeTx / decompile read it back.
import { cat, fromBase64, u32le, u64le, base64 } from "./bytes.ts";
import { ataOf, key, PROGRAM } from "./keys.ts";
import type { AccountMeta, Instruction, LookupTable } from "./wire.ts";
export { decodeTx, decompile, lookupTableAddresses, type AccountMeta, type DecodedTx, type Instruction, type LookupTable } from "./wire.ts";


export const W = (pubkey: string): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
export const R = (pubkey: string): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
export const WS = (pubkey: string): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });
export const S = (pubkey: string): AccountMeta => ({ pubkey, isSigner: true, isWritable: false });
export const ix = (programId: string, keys: AccountMeta[], data: ArrayLike<number>): Instruction => ({ programId, keys, data: Uint8Array.from(data) });

/** Solana's compact-u16 length prefix. */
function shortvec(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if (n === 0) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}

/** The v0 message bytes: `payer` pays the fee and signs. Accounts found in `tables` are looked up instead of listed. */
export function compileV0(payer: string, recentBlockhash: string, instructions: Instruction[], tables: LookupTable[] = []): Uint8Array {
  const metas = new Map<string, { signer: boolean; writable: boolean; invoked: boolean }>();
  const meta = (k: string) => metas.get(k) ?? metas.set(k, { signer: false, writable: false, invoked: false }).get(k)!;
  Object.assign(meta(payer), { signer: true, writable: true });
  for (const i of instructions) {
    meta(i.programId).invoked = true;
    for (const a of i.keys) { const m = meta(a.pubkey); m.signer ||= a.isSigner; m.writable ||= a.isWritable; }
  }
  const lookups: { table: string; writable: number[]; readonly: number[] }[] = [];
  const fromTables = { writable: [] as string[], readonly: [] as string[] };
  for (const t of tables) {
    const drain = (writable: boolean) => {
      const idx: number[] = [], keys: string[] = [];
      for (const [k, m] of [...metas]) {
        if (m.signer || m.invoked || m.writable !== writable) continue;
        const at = t.addresses.indexOf(k);
        if (at < 0) continue;
        if (at > 255) throw new Error("lookup table index too large");
        idx.push(at); keys.push(k); metas.delete(k);
      }
      return { idx, keys };
    };
    const w = drain(true), r = drain(false);
    if (!w.idx.length && !r.idx.length) continue;
    lookups.push({ table: t.key, writable: w.idx, readonly: r.idx });
    fromTables.writable.push(...w.keys); fromTables.readonly.push(...r.keys);
  }
  const all = [...metas.entries()];
  const group = (signer: boolean, writable: boolean) => all.filter(([, m]) => m.signer === signer && m.writable === writable).map(([k]) => k);
  const ws = group(true, true), rs = group(true, false), w = group(false, true), r = group(false, false);
  if (ws[0] !== payer) throw new Error("the fee payer must be the first writable signer");
  const keys = [...ws, ...rs, ...w, ...r];
  if (keys.length > 256) throw new Error("too many accounts for one transaction");
  const index = new Map([...keys, ...fromTables.writable, ...fromTables.readonly].map((k, i) => [k, i]));
  const ixBytes = instructions.map((i) => cat([index.get(i.programId)!], shortvec(i.keys.length), i.keys.map((a) => index.get(a.pubkey)!), shortvec(i.data.length), i.data));
  return cat(
    [0x80, ws.length + rs.length, rs.length, r.length],
    shortvec(keys.length), ...keys.map(key),
    key(recentBlockhash),
    shortvec(instructions.length), ...ixBytes,
    shortvec(lookups.length), ...lookups.map((l) => cat(key(l.table), shortvec(l.writable.length), l.writable, shortvec(l.readonly.length), l.readonly)),
  );
}

/** A transaction ready to sign: every signature slot zero, as web3.js serialises one nobody has signed yet. */
export function unsignedTx(message: Uint8Array): Uint8Array {
  const signers = message[1]!;
  return cat(shortvec(signers), new Uint8Array(64 * signers), message);
}

/** The largest transaction a Solana node accepts, signatures included. */
export const MAX_TX_BYTES = 1232;
export function buildTx(payer: string, recentBlockhash: string, instructions: Instruction[], tables: LookupTable[] = []): string {
  const tx = unsignedTx(compileV0(payer, recentBlockhash, instructions, tables));
  if (tx.length > MAX_TX_BYTES) throw new Error(`transaction too large (${tx.length} bytes)`);
  return base64(tx);
}

/** The message bytes of a serialised transaction (signatures skipped). */
export function messageOf(txB64: string): Uint8Array {
  const b = fromBase64(txB64);
  let n = 0, shift = 0, i = 0;
  for (;;) { const x = b[i++]!; n |= (x & 0x7f) << shift; if (!(x & 0x80)) break; shift += 7; }
  return b.subarray(i + 64 * n);
}

// The instructions every swap needs: compute budget, the token accounts, wrapping SOL.
export const computeLimit = (units: number): Instruction => ix(PROGRAM.computeBudget, [], cat([2], u32le(units)));
export const computePrice = (microLamports: bigint): Instruction => ix(PROGRAM.computeBudget, [], cat([3], u64le(microLamports)));
export const transfer = (from: string, to: string, lamports: bigint): Instruction => ix(PROGRAM.system, [WS(from), W(to)], cat(u32le(2), u64le(lamports)));
/** Creates the associated token account unless it exists (idempotent: never fails on a race). */
export const createAtaIdempotent = (payer: string, owner: string, mint: string, program: string): Instruction =>
  ix(PROGRAM.ata, [WS(payer), W(ataOf(owner, mint, program)), R(owner), R(mint), R(PROGRAM.system), R(program)], [1]);
/** SOL into the wallet's wrapped-SOL account, then SyncNative so the token balance shows it. */
export const wrapSol = (owner: string, wsolAta: string, lamports: bigint): Instruction[] => [transfer(owner, wsolAta, lamports), ix(PROGRAM.token, [W(wsolAta)], [17])];
export const closeAccount = (account: string, owner: string, program: string = PROGRAM.token): Instruction => ix(program, [W(account), W(owner), S(owner)], [9]);
/** Token-2022 HarvestWithheldTokensToMint: moves the transfer fees withheld in `account` to the mint, so the account can be closed. */
export const harvestWithheld = (mint: string, account: string): Instruction => ix(PROGRAM.token2022, [W(mint), W(account)], [26, 4]);
