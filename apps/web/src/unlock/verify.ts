// D103 (QA, 3 Nov): on the web, a sheet that hands out a copy of AgentZero's key (pairing a computer) or loosens
// AgentZero needs the person checked by this browser's own passkey: a FRESH WebAuthn assertion with user verification
// (Face ID, Touch ID, Windows Hello). "required" in the request is only a request, so the answer is read from the
// authenticator's own signed flags: user present (bit 0) and user verified (bit 2). No passkey on this browser (a
// passcode unlock), a cancelled prompt, or an assertion without both flags: false, and the core refuses ("Pair from
// your iPhone."). There is no weaker check.

import { keyOnHere, type KeyOn } from "./passkey-words.ts";

type Credentials = Pick<CredentialsContainer, "get">;

const UP = 0x01;
const UV = 0x04;

/** Did the authenticator say the user was present AND verified? `authenticatorData` byte 32 holds its flags. */
export function verifiedFlags(authenticatorData: ArrayBuffer | ArrayBufferView): boolean {
  const bytes = authenticatorData instanceof ArrayBuffer ? new Uint8Array(authenticatorData) : new Uint8Array(authenticatorData.buffer, authenticatorData.byteOffset, authenticatorData.byteLength);
  if (bytes.length < 37) return false; // rpIdHash (32) + flags (1) + signCount (4)
  const flags = bytes[32]!;
  return (flags & UP) === UP && (flags & UV) === UV;
}

/**
 * The RP ID this page's passkeys are signed for: what `rpIdHash` is the SHA-256 of. On a website, its host (as before).
 * In the ZeroFee Chrome extension's own page (D157), Chrome signs for the extension's WHOLE origin,
 * "chrome-extension://<id>", not its bare id (chromium chrome_web_authentication_delegate.cc MaybeGetRelyingPartyIdOverride:
 * "we use the whole origin to avoid collisions with the RP ID space for HTTPS origins"; seen in a probe, 3 Nov). Any other
 * scheme: no RP ID (the check then refuses). Nothing is loosened for the web: an https page still checks its own host.
 */
export function pageRpId(loc: Pick<Location, "protocol" | "hostname" | "origin"> | undefined = globalThis.location): string | undefined {
  if (!loc) return undefined;
  if (loc.protocol === "https:" || loc.protocol === "http:") return loc.hostname || undefined;
  if (loc.protocol === "chrome-extension:" && /^[a-p]{32}$/.test(loc.hostname) && loc.origin === `chrome-extension://${loc.hostname}`) return loc.origin;
  return undefined;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const view = (b: ArrayBuffer | ArrayBufferView) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));

/** The answer is to THIS ask: clientDataJSON says webauthn.get with our challenge, and the signed data names our site
 *  (rpIdHash = SHA-256 of pageRpId(): the host, or an extension's whole origin), so a captured real assertion can't be replayed (security review, Low). */
async function answersThisAsk(r: AuthenticatorAssertionResponse, challenge: Uint8Array, host: string | undefined, origin: string | undefined): Promise<boolean> {
  try {
    const client = JSON.parse(new TextDecoder().decode(view(r.clientDataJSON))) as { type?: unknown; challenge?: unknown; origin?: unknown };
    if (client.type !== "webauthn.get" || client.challenge !== b64url(challenge)) return false;
    // D157 review M1: the answer was made by THIS page's origin (in the extension it crosses a message hop from its own
    // approval window, same origin), never by another page that got the same RP
    if (origin !== undefined && client.origin !== origin) return false;
    if (!host) return false;
    const want = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host)));
    return sameBytes(view(r.authenticatorData).subarray(0, 32), want);
  } catch {
    return false;
  }
}

/** A fresh assertion from this browser's unlock passkey, user verification required and checked in its flags. */
/**
 * A fresh assertion from this browser's unlock passkey, user verification required and checked in its flags.
 * `bind` (D157 review M4): what is being approved (the sheet's words): the challenge is then SHA-256(32 random bytes ||
 * bind), so each yes the iPhone signs is for that one sheet. `origin`: the page's own (clientDataJSON must name it).
 */
export async function passkeyUserVerified(credentialId: Uint8Array, creds: Credentials | undefined = globalThis.navigator?.credentials, host: string | undefined = pageRpId(), opts: { bind?: Uint8Array; origin?: string; on?: KeyOn } = {}): Promise<boolean> {
  if (!creds) return false;
  const laptop = (opts.on ?? keyOnHere()) === "laptop";
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const challenge = opts.bind ? new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...nonce, ...opts.bind]))) : nonce;
    const got = (await creds.get({
      publicKey: {
        challenge,
        // the unlock passkey (passkey.ts): the person's iPhone over hybrid (the QR code or the linked phone); on the
        // laptop page the laptop's own (Touch ID, Windows Hello), "internal" only: the same one that locked this page
        allowCredentials: [{ type: "public-key", id: credentialId as BufferSource, transports: laptop ? ["internal"] : ["hybrid"] }],
        userVerification: "required",
        timeout: 120_000,
        hints: laptop ? ["client-device"] : ["hybrid"],
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
    if (!got?.rawId || !sameBytes(new Uint8Array(got.rawId), credentialId)) return false;
    const r = got.response as AuthenticatorAssertionResponse;
    return verifiedFlags(r.authenticatorData) && (await answersThisAsk(r, challenge, host, opts.origin ?? globalThis.location?.origin));
  } catch {
    return false; // cancelled, timed out, or refused: not verified
  }
}

/** The web core's `userVerified` (D103): this browser's unlock passkey, freshly; a passcode unlock can't verify. */
export function webUserVerified(readRecord: () => Promise<{ method: string; credentialId?: Uint8Array } | null>, creds?: Credentials, host?: string): (reason: string) => Promise<boolean> {
  return async () => {
    const record = await readRecord().catch(() => null);
    if (record?.method !== "passkey" || !record.credentialId) return false;
    return passkeyUserVerified(record.credentialId, creds, host ?? pageRpId());
  };
}
