// A confidential wallet's own balances, read from 1Click (always show where the money is; after a restore the
// phone's own count is gone). 1Click answers /v0/account/balances to a user session, which /v0/auth/authenticate gives
// for the wallet's own NEP-413 signature: no partner key, so the core asks 1Click directly and the relay isn't involved.
//
// What the core signs for it, and nothing else (docs.near-intents.org, authenticate-user-with-signed-data): recipient
// "intents.near", message {"deadline", "intents": [], "signer_id"} with an EMPTY list of intents, so it can't move
// anything even if it were replayed; signer_id the wallet's own implicit account; a deadline 2 minutes out; and NEAR
// Intents' versioned nonce (near/intents defuse docs): magic 5628f6c6, version 0, the contract's current salt (4 bytes),
// that deadline in nanoseconds (u64, little-endian), then 15 bytes whose first 8 are the sign-in's START time in
// nanoseconds (i64, little-endian) and the last 7 random: 1Click's own SDK (@defuse-protocol/intents-sdk 0.93.0,
// VersionedNonceBuilder.createTimestampedNonceBytes) builds it so, and 1Click refuses a start time more than 5 minutes
// off with 401 "timestamp validation failed" (audit F-1: 15 fully random bytes were refused for every deadline; the
// timestamped nonce got 201 and a session from a throwaway key, 29 Oct 2026). 1Click sees this phone's address asking
// for that wallet's balances, as it sees its quotes.
import { type Nep413Payload, signNep413 } from "./private-pocket.ts";
import { base64 } from "./sol/bytes.ts";
import { readJson } from "./net.ts";

export const ONE_CLICK_ACCOUNT = "https://1click.chaindefuser.com/v0";
const MAGIC = [0x56, 0x28, 0xf6, 0xc6];
/** How long a sign-in signature lives: 1Click refuses a time more than 5 minutes off. */
const SIGN_IN_MS = 2 * 60_000;

/** NEAR Intents' versioned nonce (version 0): magic, version, salt, deadline in nanoseconds (little-endian), random. */
export function versionedNonce(saltHex: string, deadlineMs: number, random: Uint8Array = crypto.getRandomValues(new Uint8Array(15))): Uint8Array {
  if (!/^[0-9a-f]{8}$/.test(saltHex)) throw new Error("the salt is 4 bytes, as hex");
  if (random.length !== 15) throw new Error("15 random bytes");
  const out = new Uint8Array(32);
  out.set(MAGIC, 0);
  out[4] = 0;
  out.set(saltHex.match(/../g)!.map((h) => parseInt(h, 16)), 5);
  new DataView(out.buffer).setBigUint64(9, BigInt(Math.floor(deadlineMs)) * 1_000_000n, true);
  out.set(random, 17);
  return out;
}

/** The nonce's 15 "random" bytes for a sign-in: its start time in nanoseconds (i64, little-endian), then 7 random bytes. */
export function timestampedRandom(startMs: number, rest: Uint8Array = crypto.getRandomValues(new Uint8Array(7))): Uint8Array {
  if (rest.length !== 7) throw new Error("7 random bytes");
  const out = new Uint8Array(15);
  new DataView(out.buffer).setBigInt64(0, BigInt(Math.floor(startMs)) * 1_000_000n, true);
  out.set(rest, 8);
  return out;
}

/** The sign-in message: an empty list of intents for intents.near, from `signerId`, signed at `startMs`, until `deadlineMs`. */
export function signInPayload(signerId: string, saltHex: string, deadlineMs: number, startMs: number = Date.now(), random: Uint8Array = timestampedRandom(startMs)): Nep413Payload {
  const deadline = new Date(deadlineMs).toISOString();
  return { message: JSON.stringify({ deadline, intents: [], signer_id: signerId }), nonce: base64(versionedNonce(saltHex, deadlineMs, random)), recipient: "intents.near" };
}

/**
 * The wallet's confidential balances, as 1Click has them: sign in with the wallet's own key (the one shape above), then
 * read. Only plain token ids and whole amounts are kept; anything else in the answer is dropped.
 */
/** NEAR Intents' salt, read from NEAR, gave no usable answer: a NEAR read, never 1Click's (bug 8). */
export class SaltUnread extends Error {}

/** `strict`: a row it can't read (no coin id, or an amount that isn't units) fails the whole read, never left out (a plan
 *  that sizes the Safe's fill from it: the audit's SHOULD, 7 Nov). Default: such a row is left out, as before. */
export async function privateBalances(o: { signerId: string; secret: Uint8Array; salt: () => Promise<string | null>; fetch?: typeof fetch; now?: () => number; strict?: boolean }): Promise<{ tokenId: string; amount: string }[]> {
  const get = o.fetch ?? fetch;
  const salt = await o.salt();
  if (!salt) throw new SaltUnread("salt unread");
  const now = (o.now ?? Date.now)();
  const signedData = signNep413(signInPayload(o.signerId, salt, now + SIGN_IN_MS, now), o.secret);
  const auth = await get(`${ONE_CLICK_ACCOUNT}/auth/authenticate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedData }), signal: AbortSignal.timeout(15_000) });
  if (!auth.ok) throw new Error(`NEAR Intents' sign-in said ${auth.status}`);
  const token = ((await readJson(auth)) as { accessToken?: unknown })?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("NEAR Intents gave no session");
  const res = await get(`${ONE_CLICK_ACCOUNT}/account/balances`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`NEAR Intents' balances said ${res.status}`);
  const list = ((await readJson(res)) as { balances?: unknown })?.balances;
  if (!Array.isArray(list)) throw new Error("NEAR Intents' balances can't be read");
  const read = list.filter((b): b is { tokenId: string; available: string } => typeof b?.tokenId === "string" && /^nep(141|245):[A-Za-z0-9._:-]{2,200}$/.test(b.tokenId) && typeof b?.available === "string" && /^\d{1,40}$/.test(b.available));
  if (o.strict && read.length !== list.length) throw new Error("NEAR Intents' balances can't be read");
  return read
    .filter((b) => BigInt(b.available) > 0n)
    .map((b) => ({ tokenId: b.tokenId, amount: b.available }));
}
