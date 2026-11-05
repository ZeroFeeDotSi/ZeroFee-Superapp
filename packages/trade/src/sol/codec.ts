// Reading accounts: a small Borsh reader driven by the generated layouts, plus the SPL mint and token-account fields and
// the Token-2022 extensions that decide whether a coin can be priced here. Pure functions, tested on captured accounts.
import { pkAt, u16At, u64At } from "./bytes.ts";
import type { Spec, Ty } from "./layouts.ts";
import type { IssuerHold } from "../errors.ts";

export type Struct = Record<string, any>;

/** Reads a struct of the layout. u8..u32 come back as numbers, wider integers as bigint, pubkeys as base58. `off` skips the 8-byte discriminator. */
export function readStruct(layout: Spec, name: string, b: Uint8Array, off = 8): Struct {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rd = (t: Ty): any => {
    if (typeof t === "string") {
      switch (t) {
        case "u8": return b[off++];
        case "bool": return b[off++] !== 0;
        case "u16": { const x = v.getUint16(off, true); off += 2; return x; }
        case "u32": { const x = v.getUint32(off, true); off += 4; return x; }
        case "u64": { const x = v.getBigUint64(off, true); off += 8; return x; }
        case "i64": { const x = v.getBigInt64(off, true); off += 8; return x; }
        case "u128": { const x = v.getBigUint64(off, true) | (v.getBigUint64(off + 8, true) << 64n); off += 16; return x; }
        case "i128": { const x = v.getBigUint64(off, true) | (BigInt.asIntN(64, v.getBigUint64(off + 8, true)) << 64n); off += 16; return x; }
        case "pubkey": { const x = pkAt(b, off); off += 32; return x; }
      }
      throw new Error(`layout type ${t}`);
    }
    if ("vec" in t) { const n = v.getUint32(off, true); off += 4; return Array.from({ length: n }, () => rd(t.vec)); }
    if ("array" in t) return Array.from({ length: t.array[1] }, () => rd(t.array[0]));
    if ("option" in t) { const some = b[off++]; return some ? rd(t.option) : null; }
    return Object.fromEntries(layout[t.struct]!.map(([k, ty]) => [k, rd(ty)]));
  };
  return Object.fromEntries(layout[name]!.map(([k, ty]) => [k, rd(ty)]));
}

/** SPL mint: supply u64 @36, decimals u8 @44. SPL token account: mint @0, owner @32, amount u64 @64. */
export const mintSupply = (b: Uint8Array): bigint => u64At(b, 36);
export const mintDecimals = (b: Uint8Array): number => b[44]!;
export const tokenAmount = (b: Uint8Array): bigint => u64At(b, 64);
/** SPL mint: freeze_authority is a COption<Pubkey> at @46 (u32 tag, 1 = set). Its issuer can then freeze any holder's account, which stops a sell. */
export const mintFreezable = (b: Uint8Array): boolean => b.length >= 50 && b[46] === 1 && b[47] === 0 && b[48] === 0 && b[49] === 0;

/**
 * Token-2022 mint extensions: after the 82-byte mint, padding to 165, the account-type byte (1 = mint), then TLV entries
 * (type u16, length u16, value) from 166. Returns the types present and the transfer fee in bps: the larger of the older
 * and newer fee, since the newer one applies from its epoch. TransferFeeConfig = 2 authorities (64), withheld u64 (8),
 * then two fees {epoch u64, max u64, bps u16}, so the bps sit at +88 and +106.
 */
export const EXT = { transferFeeConfig: 1, nonTransferable: 9, permanentDelegate: 12, transferHook: 14, pausable: 26 } as const;

/**
 * Token-2022 powers that let a coin's issuer take or stop what a buyer holds, so it isn't bought on any path: a permanent
 * delegate (moves or burns anyone's coins), a pause switch (stops every transfer), a transfer hook (the issuer's own program
 * runs on every transfer and can refuse a sell). 12 and 14 read off PYUSD's mint (slot 461240322, 25 Oct 2026); 26 is
 * spl-token-2022's ExtensionType order, which that mint's eight types confirm. New pump.fun coins carry only 18 and 19.
 */
export function issuerHold(ext: MintExtensions): IssuerHold | undefined {
  const { types } = ext;
  if (types.has(EXT.permanentDelegate)) return "delegated";
  if (types.has(EXT.pausable)) return "pausable";
  // a hook slot with no program and no authority to set one can never run (coverage audit, 4 Nov: KOI, a Meteora DBC coin,
  // carries it empty; FUNCAT's names its program FUNrSeDa…, which runs on every transfer)
  if (types.has(EXT.transferHook) && ext.transferHookLive !== false) return "hooked";
  // a transfer fee its issuer can raise (towards 100 %, two epochs on) could trap a sell; one above 1 % is paid again on it
  if (ext.transferFeeAuthority) return "fee-raisable";
  if (ext.transferFeeBps > MAX_TRANSFER_FEE_BPS) return "fee-high";
  return undefined;
}
/** The most a coin may take on each transfer and still be bought (it's paid again on the sell). */
export const MAX_TRANSFER_FEE_BPS = 100;
export const ISSUER_WORDS: Record<IssuerHold, string> = {
  delegated: "Its maker can take it from any wallet",
  pausable: "Its maker can pause it and stop you selling",
  hooked: "Its maker runs its own code on every transfer. It could stop you selling.",
  "fee-raisable": "Its maker can raise its fee and take most of a sale",
  "fee-high": "It takes over 1% on every transfer, and again when you sell",
};
export interface MintExtensions {
  types: Set<number>;
  transferFeeBps: number;
  /** TransferFeeConfig's own authority is set (its first 32 bytes aren't zero): it can raise the fee, from two epochs on. */
  transferFeeAuthority: boolean;
  /** TransferHook (authority 32 bytes, then program id 32): false only when it is present and BOTH are zero (no program
   *  runs, and nobody can set one). Unread or absent: undefined, which counts as live wherever a hook is present. */
  transferHookLive?: boolean;
}
export function mintExtensions(b: Uint8Array): MintExtensions {
  const types = new Set<number>();
  let transferFeeBps = 0, transferFeeAuthority = false;
  let transferHookLive: boolean | undefined;
  if (b.length <= 166 || b[165] !== 1) return { types, transferFeeBps, transferFeeAuthority };
  for (let o = 166; o + 4 <= b.length;) {
    const type = u16At(b, o), len = u16At(b, o + 2);
    if (type === 0 && len === 0) break;                                           // the uninitialised tail
    types.add(type);
    if (type === EXT.transferFeeConfig && len >= 108 && o + 4 + 108 <= b.length) {
      transferFeeBps = Math.max(u16At(b, o + 4 + 88), u16At(b, o + 4 + 106));
      transferFeeAuthority = b.subarray(o + 4, o + 4 + 32).some((x) => x !== 0);
    }
    if (type === EXT.transferHook) transferHookLive = len >= 64 && o + 4 + 64 <= b.length ? b.subarray(o + 4, o + 4 + 64).some((x) => x !== 0) : true;
    o += 4 + len;
  }
  return { types, transferFeeBps, transferFeeAuthority, ...(transferHookLive !== undefined ? { transferHookLive } : {}) };
}
