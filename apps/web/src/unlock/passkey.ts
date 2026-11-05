// The passkey half of the web unlock (unlock.ts in the core): a passkey made on the person's iPhone (product decision, 3 Nov: "it
// needs to lead to ONE option", the iPhone), with the WebAuthn PRF extension. The browser shows its QR code, the iPhone
// scans it and approves with Face ID (WebAuthn's hybrid transport: authenticatorAttachment "cross-platform", hints
// ["hybrid"]), and the passkey is made and kept on the iPhone. The PRF output for a salt kept on this device is what seals
// the vault's root; the passkey itself never leaves the iPhone. Where PRF isn't there, the person chooses a passcode.
//
// PRF over hybrid (checked 3 Nov, Apple's developer forums, user and Apple-engineer reports, not Apple's documentation):
// Chrome returns it; Safari's cross-device flow returned none before 18.2; and the same passkey's output over hybrid has
// been reported to differ from its output on the iPhone itself, and between iOS 18.0-18.3 and 18.4+. So the vault is
// sealed with the output of an UNLOCK-shaped read (passkeyPrf, the same hybrid path every later unlock takes), never the
// value the passkey's creation may return. If the iPhone's output ever changes anyway, this browser's vault doesn't
// open ("Lost your iPhone?": the money stays in the Safe; the account comes back on this browser from its 24 words).

/** WebAuthn's PRF extension, typed here so an older DOM lib doesn't decide what compiles. */
type PrfOutputs = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } } };

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const bytesOf = (b: ArrayBuffer | ArrayBufferView): Uint8Array => (b instanceof ArrayBuffer ? new Uint8Array(b.slice(0)) : new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));

// The words and the name live on their own (passkey-words.ts), so a build with no passkey (the public site's web
// wallet: passkey-none.ts, vite.config.ts) shows the same words without shipping WebAuthn.
export { passkeyName, IPHONE_KEY, IPHONE_UNLOCKS, IPHONE_LOCKED, NO_IPHONE_HERE, PASSCODE_CANT_SEND, NO_IPHONE_KEY, keyOnHere, type KeyOn } from "./passkey-words.ts";
import { keyOnHere, type KeyOn } from "./passkey-words.ts";
import { createRequest, prfRequest } from "./passkey-requests.ts";

export { IPHONE_HINTS, IPHONE_SELECTION } from "./passkey-requests.ts";
/** Can this browser ask the person's iPhone for a passkey with PRF? No when it says it can't do PRF or reach a phone
 *  (hybrid); a browser that doesn't say is tried, and a passkey without PRF falls back to a passcode (createPasskey). */
export async function passkeyAvailable(on: KeyOn = keyOnHere()): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === "undefined" || !navigator.credentials) return false;
    const pkc = PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>>; isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> };
    const caps = await pkc.getClientCapabilities?.().catch(() => undefined);
    if (caps && caps["extension:prf"] === false) return false;
    // the laptop: its own Touch ID / Windows Hello passkey, or nothing (never the phone instead)
    if (on === "laptop") return (await pkc.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false)) === true;
    if (caps && caps.hybridTransport === false) return false;
    return true;
  } catch {
    return false;
  }
}

/** The person stopped the passkey prompt, or it timed out: nothing was made or read. */
export const isCancelled = (e: unknown) => e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");

/** Ask the iPhone's passkey for its PRF output for `prfSalt` (the QR code, Face ID). Throws when it gives none. */
export async function passkeyPrf(credentialId: Uint8Array, prfSalt: Uint8Array, on: KeyOn = keyOnHere()): Promise<Uint8Array> {
  const got = (await navigator.credentials.get({ publicKey: prfRequest(on, credentialId, prfSalt, random(32)) })) as PublicKeyCredential | null;
  const first = (got?.getClientExtensionResults() as PrfOutputs | undefined)?.prf?.results?.first;
  if (!first) throw new Error("this passkey gave no PRF output");
  return bytesOf(first);
}

/**
 * Make a passkey on the person's iPhone (the QR code, Face ID) with PRF, then read its output for a new salt the way every
 * unlock will (passkeyPrf: a second Face ID; the browser usually reaches the phone directly the second time). Null: the
 * passkey can't do PRF (the person then chooses a passcode). Throws when the person stops it (isCancelled).
 */
export async function createPasskey(on: KeyOn = keyOnHere()): Promise<{ credentialId: Uint8Array; prfSalt: Uint8Array; prf: Uint8Array } | null> {
  const prfSalt = random(32);
  const made = (await navigator.credentials.create({ publicKey: createRequest(on, prfSalt, random(32), random(16)) })) as PublicKeyCredential | null;
  if (!made) return null;
  // the laptop page: a passkey the browser made anywhere but on this laptop (a phone, a security key) never seals it
  if (on === "laptop" && (made as { authenticatorAttachment?: string | null }).authenticatorAttachment !== "platform") return null;
  const prf = (made.getClientExtensionResults() as PrfOutputs).prf;
  if (!prf?.enabled && !prf?.results?.first) return null;
  const credentialId = new Uint8Array(made.rawId.slice(0));
  // Sealed with an unlock-shaped read, never the creation's own output: over hybrid the two have been reported to differ
  // (see the top of this file), and a vault sealed with a value no unlock gives back would never open.
  const out = await passkeyPrf(credentialId, prfSalt, on).catch((e) => (isCancelled(e) ? Promise.reject(e) : null));
  return out ? { credentialId, prfSalt, prf: out } : null;
}
