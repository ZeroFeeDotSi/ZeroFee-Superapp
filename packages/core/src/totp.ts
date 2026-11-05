// One-time codes for a site's own two-factor sign-in (bug report, 4 Nov: pump.fun and GMGN need two-factor). This is the
// arithmetic only: RFC 4226 (HOTP) and RFC 6238 (TOTP), and the otpauth:// link a site shows as a QR code when the person
// turns on "Google Authenticator". Where the secret is kept, and which page may receive a code, is site-2fa.ts's job.
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";

/** A site's authenticator entry, read from its otpauth:// link. The secret is raw bytes, never shown again. */
export interface OtpEntry {
  secret: Uint8Array;
  algorithm: OtpAlgorithm;
  digits: 6 | 7 | 8;
  period: number;
  issuer: string;
  account: string;
}

const HASH = { SHA1: sha1, SHA256: sha256, SHA512: sha512 } as const;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, as authenticator links write secrets: case, spaces and "=" padding are ignored; any other letter refuses. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (clean.length === 0) throw new Error("empty secret");
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4226: the code for one counter value. */
export function hotp(secret: Uint8Array, counter: number, digits: 6 | 7 | 8 = 6, algorithm: OtpAlgorithm = "SHA1"): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("bad counter");
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = hmac(HASH[algorithm], secret, msg);
  const at = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[at]! & 0x7f) << 24) | (mac[at + 1]! << 16) | (mac[at + 2]! << 8) | mac[at + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** RFC 6238: the code at a moment (ms since 1970), and how many seconds it has left. */
export function totp(entry: Pick<OtpEntry, "secret" | "algorithm" | "digits" | "period">, nowMs: number): { code: string; secondsLeft: number } {
  const t = Math.floor(nowMs / 1000);
  return { code: hotp(entry.secret, Math.floor(t / entry.period), entry.digits, entry.algorithm), secondsLeft: entry.period - (t % entry.period) };
}

/**
 * Reads the otpauth://totp/… link a site shows when two-factor is turned on. Refuses anything else: HOTP links (a
 * counter the phone and site can lose step on), a missing or short secret (under 80 bits, RFC 4226's floor), an
 * unknown algorithm, digits other than 6-8, a period outside 15-120 s.
 */
export function parseOtpAuth(link: string): OtpEntry {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error("not a link");
  }
  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") throw new Error("not a TOTP link");
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const [labelIssuer, labelAccount] = label.includes(":") ? [label.slice(0, label.indexOf(":")), label.slice(label.indexOf(":") + 1)] : ["", label];
  const q = url.searchParams;
  const secret = base32Decode(q.get("secret") ?? "");
  if (secret.length < 10) throw new Error("secret too short");
  const algorithm = (q.get("algorithm") ?? "SHA1").toUpperCase();
  if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") throw new Error("unknown algorithm");
  const digits = Number(q.get("digits") ?? 6);
  if (digits !== 6 && digits !== 7 && digits !== 8) throw new Error("bad digits");
  const period = Number(q.get("period") ?? 30);
  if (!Number.isInteger(period) || period < 15 || period > 120) throw new Error("bad period");
  return { secret, algorithm, digits, period, issuer: (q.get("issuer") ?? labelIssuer).trim(), account: labelAccount.trim() };
}
