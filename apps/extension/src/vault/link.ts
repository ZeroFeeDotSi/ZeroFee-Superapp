// The link code: how the trading key reaches the phone, once, never readable on the way. The phone's trusted core makes a
// one-time code (subwallet.linkStart: 10 characters, about 50 bits) and shows it; the person types it into the panel; the
// vault seals the seed under it with scrypt at full cost and the panel shows only the QR. The phone scans it and opens it
// with the code it holds (subwallet.import), then seals the seed under its chip. The code never appears on the laptop,
// so a photo or recording of the laptop's screen is useless, and guessing the code is out of reach.
//
// The exact format, agreed with Security: QR text = base64(JSON { v: 1, salt, iv, ct }), each field base64. key =
// scrypt(utf8(code), salt, N=2^17, r=8, p=1, 32 bytes); AES-256-GCM with iv (12 bytes) and additional data
// utf8("zerofee-extension/link/v1"); the plaintext is the 32-byte seed. The code is read as readCode() reads it.
import { base64, fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { KDF, PURPOSE, seal, unseal, type KdfParams } from "./seal.ts";

/** Crockford's base32: no I, L, O or U, so nothing is misread when it's typed. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;
export interface LinkPayload { v: 1; salt: string; iv: string; ct: string }

/** What was typed, as a code. Case, spaces and dashes don't matter; O reads as 0, I and L as 1. Null if it can't be one. */
export function readCode(typed: string): string | null {
  const c = typed.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return c.length === CODE_LENGTH && [...c].every((x) => CODE_ALPHABET.includes(x)) ? c : null;
}

/** The QR text: the seed sealed under the code the phone showed (as typed; null if it can't be a code). */
export async function sealForLink(seed: Uint8Array, typed: string, k: KdfParams = KDF): Promise<string | null> {
  const code = readCode(typed);
  if (!code) return null;
  const s = await seal(seed, code, k, PURPOSE.link);
  const payload: LinkPayload = { v: 1, salt: s.salt, iv: s.iv, ct: s.ct };
  return base64(new TextEncoder().encode(JSON.stringify(payload)));
}

/** The phone's side, as the reference (the trusted core does this there). The seed, or null. */
export async function openLink(qr: string, typed: string, k: KdfParams = KDF): Promise<Uint8Array | null> {
  const code = readCode(typed);
  if (!code) return null;
  let p: LinkPayload;
  try { p = JSON.parse(new TextDecoder().decode(fromBase64(qr))) as LinkPayload; } catch { return null; }
  if (p?.v !== 1 || typeof p.salt !== "string" || typeof p.iv !== "string" || typeof p.ct !== "string") return null;
  return unseal({ v: 1, kdf: "scrypt", N: k.N, r: k.r, p: k.p, salt: p.salt, iv: p.iv, ct: p.ct }, code, PURPOSE.link);
}
