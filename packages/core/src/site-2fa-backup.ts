// A site's two-factor secrets, backed up WITH the 24 words (product decision, 4 Nov, decision G: losing the phone must not lock
// anyone out of a site's money). On the phone each secret lives sealed under Face ID in the chip (SiteCodes.swift);
// this is its copy for a new phone: sealed here under a key from the words, kept by the relay (apps/quotes/keep.mjs),
// which holds ciphertext only. Restoring the words on a new phone finds and opens it; nothing else can.
//
// THE DERIVATION (from the hot root: BIP-39's seed from the 24 words with ZeroFee's hot passphrase, hot-keys.ts, so
// it is on every device that made or restored the account and never needs the words typed again):
//   sign key = HKDF-SHA256(ikm = root, salt = "zerofee-keep-v1", info = "zerofee-keep-sign", 32) → Ed25519 seed;
//              its public key (hex) is the keep's id on the relay.
//   box key  = HKDF-SHA256(ikm = root, salt = "zerofee-keep-v1", info = "zerofee-keep-box",  32) → XChaCha20 key.
// The infos keep both apart from each other, from the mailbox's keys (mail-keys.ts) and from every wallet key.
//
// THE SEAL: 0x01 ‖ nonce (24, random) ‖ XChaCha20-Poly1305(box key, nonce, JSON, aad = "zerofee-keep-v1:" ‖ id),
// base64url. One keep per account holding every site, so the relay can't tell which sites, or how many.
//
// What this costs, said plainly (the product choice): whoever has the words can make these codes too. Their copy is
// read only by the phone's own host (SiteCodes.swift through the isolated core), never by a page or an app.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { b64url, fromB64url } from "./mail-keys.ts";
import { TWO_FACTOR_SITES } from "./site-2fa.ts";
import type { OtpAlgorithm } from "./totp.ts";

const SALT = "zerofee-keep-v1";
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** One site's backed-up entry: the secret as hex, never base32 (the phone converts what was pasted). */
export interface KeptCode { secretHex: string; algorithm: OtpAlgorithm; digits: 6 | 7 | 8; period: number; issuer: string; account: string; addedAt: number }
interface Kept { v: 1; sites: Record<string, KeptCode> }

export interface KeepKeys { id: string; signSecret: Uint8Array; box: Uint8Array }

/** The keep's keys from the hot root (64 bytes). The caller zeroes the root; `forget` zeroes these. */
export function keepKeys(root: Uint8Array): KeepKeys & { forget(): void } {
  const signSecret = hkdf(sha256, root, enc.encode(SALT), enc.encode("zerofee-keep-sign"), 32);
  const box = hkdf(sha256, root, enc.encode(SALT), enc.encode("zerofee-keep-box"), 32);
  const id = hex(ed25519.getPublicKey(signSecret));
  return { id, signSecret, box, forget: () => (signSecret.fill(0), box.fill(0)) };
}

/** What the relay checks the signature against (keep.mjs keepMessage: the same bytes). */
export function keepMessage(op: "put" | "get", id: string, t: number, sealed = ""): Uint8Array {
  const digest = op === "put" ? hex(sha256(enc.encode(sealed))) : "";
  return enc.encode(`zerofee-keep-${op}:${id}:${digest}:${t}`);
}

const aad = (id: string) => enc.encode(`${SALT}:${id}`);

export function sealKept(keys: KeepKeys, kept: Kept): string {
  const nonce = randomBytes(24);
  const body = xchacha20poly1305(keys.box, nonce, aad(keys.id)).encrypt(enc.encode(JSON.stringify(kept)));
  const out = new Uint8Array(1 + 24 + body.length);
  out[0] = 1;
  out.set(nonce, 1);
  out.set(body, 25);
  return b64url(out);
}

/** Opens a keep sealed for these keys; throws on anything else (another account's, altered, or not a keep). */
export function openKept(keys: KeepKeys, sealed: string): Kept {
  const raw = fromB64url(sealed);
  if (!raw || raw.length < 1 + 24 + 16 || raw[0] !== 1) throw new Error("not a keep");
  const plain = xchacha20poly1305(keys.box, raw.subarray(1, 25), aad(keys.id)).decrypt(raw.subarray(25));
  const kept = JSON.parse(dec.decode(plain)) as Kept;
  plain.fill(0);
  if (kept?.v !== 1 || typeof kept.sites !== "object" || kept.sites === null) throw new Error("not a keep");
  return kept;
}

/** A code entry is only ever one of the two-factor sites', with a plain secret and the RFC's own settings. */
export function checkedCode(site: string, e: unknown): KeptCode {
  if (!(site in TWO_FACTOR_SITES)) throw new Error("unknown site");
  const c = e as Partial<KeptCode> | null;
  if (!c || typeof c.secretHex !== "string" || !/^(?:[0-9a-f]{2}){10,64}$/.test(c.secretHex)) throw new Error("not a code's secret");
  if (c.algorithm !== "SHA1" && c.algorithm !== "SHA256" && c.algorithm !== "SHA512") throw new Error("not a code's algorithm");
  if (c.digits !== 6 && c.digits !== 7 && c.digits !== 8) throw new Error("not a code's length");
  if (!Number.isInteger(c.period) || (c.period as number) < 15 || (c.period as number) > 120) throw new Error("not a code's period");
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : "");
  return { secretHex: c.secretHex, algorithm: c.algorithm, digits: c.digits, period: c.period as number, issuer: text(c.issuer), account: text(c.account), addedAt: Number.isFinite(c.addedAt) ? Number(c.addedAt) : 0 };
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The relay's sealed keep for these keys, unopened (null when there is none yet). Throws when the relay didn't answer. */
async function fetchSealed(relay: string, keys: KeepKeys, fetchFn: Fetch, now: () => number): Promise<string | null> {
  const t = now();
  const sig = hex(ed25519.sign(keepMessage("get", keys.id, t), keys.signSecret));
  const res = await fetchFn(`${relay.replace(/\/$/, "")}/v0/keep/${keys.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "get", t, sig }), signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`keep read ${res.status}`);
  const body = (await res.json()) as { sealed?: unknown };
  if (typeof body?.sealed !== "string") throw new Error("keep read unreadable");
  return body.sealed;
}

/** Whether the relay keeps anything for these keys: nothing opened (site2fa.restore asks the person only then). */
export async function keepExists(relay: string, keys: KeepKeys, fetchFn: Fetch = fetch, now = Date.now): Promise<boolean> {
  return (await fetchSealed(relay, keys, fetchFn, now)) !== null;
}

/** The relay's keep for these keys, opened (null when there is none yet). Throws when the relay didn't answer. */
export async function readKeep(relay: string, keys: KeepKeys, fetchFn: Fetch = fetch, now = Date.now): Promise<Kept | null> {
  const sealed = await fetchSealed(relay, keys, fetchFn, now);
  return sealed === null ? null : openKept(keys, sealed);
}

export async function writeKeep(relay: string, keys: KeepKeys, kept: Kept, fetchFn: Fetch = fetch, now = Date.now): Promise<void> {
  const sealed = sealKept(keys, kept);
  const t = now();
  const sig = hex(ed25519.sign(keepMessage("put", keys.id, t, sealed), keys.signSecret));
  const res = await fetchFn(`${relay.replace(/\/$/, "")}/v0/keep/${keys.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "put", t, sig, sealed }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`keep write ${res.status}`);
}

/** Adds or replaces one site's entry in the keep (read, change, write: the relay keeps one per account). */
export async function backUpCode(relay: string, keys: KeepKeys, site: string, entry: KeptCode, fetchFn: Fetch = fetch, now = Date.now): Promise<void> {
  const kept = (await readKeep(relay, keys, fetchFn, now)) ?? { v: 1, sites: {} };
  kept.sites[site] = checkedCode(site, entry);
  await writeKeep(relay, keys, kept, fetchFn, now);
}

export async function forgetCode(relay: string, keys: KeepKeys, site: string, fetchFn: Fetch = fetch, now = Date.now): Promise<void> {
  const kept = await readKeep(relay, keys, fetchFn, now);
  if (!kept || !(site in kept.sites)) return;
  delete kept.sites[site];
  await writeKeep(relay, keys, kept, fetchFn, now);
}

/** Several sites' entries from one read of the keep (null for each the words keep none for). */
export async function restoreCodes(relay: string, keys: KeepKeys, sites: readonly string[], fetchFn: Fetch = fetch, now = Date.now): Promise<Record<string, KeptCode | null>> {
  for (const site of sites) if (!(site in TWO_FACTOR_SITES)) throw new Error("unknown site");
  const kept = await readKeep(relay, keys, fetchFn, now);
  return Object.fromEntries(sites.map((site) => [site, kept?.sites[site] ? checkedCode(site, kept.sites[site]) : null]));
}

/** One site's entry from the keep, or null when the words keep none for it. */
export async function restoreCode(relay: string, keys: KeepKeys, site: string, fetchFn: Fetch = fetch, now = Date.now): Promise<KeptCode | null> {
  if (!(site in TWO_FACTOR_SITES)) throw new Error("unknown site");
  const kept = await readKeep(relay, keys, fetchFn, now);
  const e = kept?.sites[site];
  return e ? checkedCode(site, e) : null;
}
