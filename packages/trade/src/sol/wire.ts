// Reading Solana transactions back: legacy and v0, lookup tables resolved, every instruction with its accounts. No
// dependencies and no I/O (only ./bytes.ts), so the security layer can vendor it with the decoder (decode.ts).
import { base58, fromBase64, pkAt } from "./bytes.ts";

export interface AccountMeta { pubkey: string; isSigner: boolean; isWritable: boolean }
export interface Instruction { programId: string; keys: AccountMeta[]; data: Uint8Array }

/** An address lookup table: its address and the addresses it holds, in order. */
export interface LookupTable { key: string; addresses: string[] }
/** The addresses an address-lookup-table account holds (its 56-byte header, then 32 bytes each). */
export function lookupTableAddresses(data: Uint8Array): string[] {
  const out: string[] = [];
  for (let o = 56; o + 32 <= data.length; o += 32) out.push(pkAt(data, o));
  return out;
}

export interface DecodedTx {
  signatures: Uint8Array[];
  version: "legacy" | 0;
  /** numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts */
  header: [number, number, number];
  staticKeys: string[];
  blockhash: string;
  instructions: { programIdIndex: number; accounts: number[]; data: Uint8Array }[];
  lookups: { table: string; writable: number[]; readonly: number[] }[];
  /** The message bytes (what is signed). */
  message: Uint8Array;
}
/** Reads a serialised transaction (legacy or v0). Throws on anything malformed. */
export function decodeTx(txB64: string): DecodedTx {
  const b = fromBase64(txB64);
  let o = 0;
  const byte = () => { if (o >= b.length) throw new Error("transaction too short"); return b[o++]!; };
  const len = () => { let n = 0, s = 0; for (;;) { const x = byte(); n |= (x & 0x7f) << s; if (!(x & 0x80)) return n; s += 7; } };
  const take = (n: number) => { if (o + n > b.length) throw new Error("transaction too short"); const x = b.subarray(o, o + n); o += n; return x; };
  const signatures = Array.from({ length: len() }, () => take(64));
  const msgStart = o;
  const first = b[o]!;
  const version = first & 0x80 ? (first & 0x7f) : "legacy";
  if (version !== "legacy" && version !== 0) throw new Error(`transaction version ${version}`);
  if (version === 0) o++;
  const header: [number, number, number] = [byte(), byte(), byte()];
  const staticKeys = Array.from({ length: len() }, () => base58(take(32)));
  const blockhash = base58(take(32));
  const instructions = Array.from({ length: len() }, () => ({ programIdIndex: byte(), accounts: Array.from(take(len())), data: take(len()).slice() }));
  const lookups = version === 0 ? Array.from({ length: len() }, () => ({ table: base58(take(32)), writable: Array.from(take(len())), readonly: Array.from(take(len())) })) : [];
  if (o !== b.length) throw new Error("trailing bytes after the transaction");
  return { signatures, version, header, staticKeys, blockhash, instructions, lookups, message: b.subarray(msgStart) };
}

/** The instructions of a decoded transaction with every account resolved (lookups through `tables`), as web3.js's TransactionMessage.decompile gives them. */
export function decompile(tx: DecodedTx, tables: LookupTable[] = []): { payer: string; blockhash: string; instructions: Instruction[] } {
  const [sigs, roSigned, roUnsigned] = tx.header;
  const writableSigned = sigs - roSigned, writableUnsigned = tx.staticKeys.length - sigs - roUnsigned;
  if (writableSigned <= 0 || writableUnsigned < 0) throw new Error("the message header is invalid");
  const writableLooked: string[] = [], readonlyLooked: string[] = [];
  for (const l of tx.lookups) {
    const t = tables.find((x) => x.key === l.table);
    if (!t) throw new Error(`lookup table ${l.table} not given`);
    const at = (i: number) => { const a = t.addresses[i]; if (!a) throw new Error(`lookup table ${l.table} has no index ${i}`); return a; };
    writableLooked.push(...l.writable.map(at)); readonlyLooked.push(...l.readonly.map(at));
  }
  const all = [...tx.staticKeys, ...writableLooked, ...readonlyLooked];
  const keyAt = (i: number) => { const k = all[i]; if (k === undefined) throw new Error(`no account at index ${i}`); return k; };
  const instructions = tx.instructions.map((ci) => ({
    programId: keyAt(ci.programIdIndex),
    keys: ci.accounts.map((i) => {
      const isSigner = i < sigs;
      const isWritable = isSigner ? i < writableSigned : i < tx.staticKeys.length ? i - sigs < writableUnsigned : i - tx.staticKeys.length < writableLooked.length;
      return { pubkey: keyAt(i), isSigner, isWritable };
    }),
    data: ci.data,
  }));
  return { payer: keyAt(0), blockhash: tx.blockhash, instructions };
}
