// The passkey requests, whole and pure (passkey.ts sends them; the tests read exactly what the browser gets). Its own
// file, so the public build's stand-in (passkey-none.ts) needs none of it.
import type { KeyOn } from "./passkey-words.ts";

type PrfInputs = { prf: { eval: { first: BufferSource } } };

/** WebAuthn's request hints (Level 3; Chrome reads them): "hybrid" goes straight to the QR code for a phone. */
export const IPHONE_HINTS = ["hybrid"] as const;
/** What a new passkey is asked to be: on another device (the iPhone, over hybrid), found by itself, Face ID required. */
export const IPHONE_SELECTION = { authenticatorAttachment: "cross-platform", residentKey: "required", requireResidentKey: true, userVerification: "required" } as const;
/** The laptop page (product decision, 5 Nov: it never asks "what chip"): this laptop's own passkey only, "platform" (Touch ID,
 *  Windows Hello), so the browser shows only its own prompt: no phone, no QR code, no security key. "client-device"
 *  (WebAuthn L3 hints, where read) says the same; every read names the "internal" transport only. */
export const LAPTOP_SELECTION = { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" } as const;
export const LAPTOP_HINTS = ["client-device"] as const;
/** Each one's hints and the transports a read may use. */
export const ASK: Record<KeyOn, { selection: typeof IPHONE_SELECTION | typeof LAPTOP_SELECTION; hints: readonly string[]; transports: AuthenticatorTransport[] }> = {
  iphone: { selection: IPHONE_SELECTION, hints: IPHONE_HINTS, transports: ["hybrid"] },
  laptop: { selection: LAPTOP_SELECTION, hints: LAPTOP_HINTS, transports: ["internal"] },
};

/**
 * The create request, whole (pure, so the tests read exactly what the browser gets). No rp.id: the browser takes the
 * page's own host (zerofee.si or superapp.zerofee.si, whichever serves the laptop page), the RP ID verify.ts checks
 * (pageRpId), so a passkey made on one host never answers on another.
 */
export function createRequest(on: KeyOn, prfSalt: Uint8Array, challenge: Uint8Array, userId: Uint8Array): PublicKeyCredentialCreationOptions {
  const extensions: PrfInputs = { prf: { eval: { first: prfSalt as BufferSource } } };
  return {
    rp: { name: "ZeroFee" },
    user: { id: userId as BufferSource, name: "ZeroFee", displayName: "ZeroFee" },
    challenge: challenge as BufferSource,
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: { ...ASK[on].selection },
    timeout: 120_000,
    hints: [...ASK[on].hints],
    extensions: extensions as AuthenticationExtensionsClientInputs,
  } as PublicKeyCredentialCreationOptions;
}
/** The PRF read's request, whole: the same passkey, by the same transport only. */
export function prfRequest(on: KeyOn, credentialId: Uint8Array, prfSalt: Uint8Array, challenge: Uint8Array): PublicKeyCredentialRequestOptions {
  const extensions: PrfInputs = { prf: { eval: { first: prfSalt as BufferSource } } };
  return {
    challenge: challenge as BufferSource,
    allowCredentials: [{ type: "public-key", id: credentialId as BufferSource, transports: [...ASK[on].transports] }],
    userVerification: "required",
    timeout: 120_000,
    hints: [...ASK[on].hints],
    extensions: extensions as AuthenticationExtensionsClientInputs,
  } as PublicKeyCredentialRequestOptions;
}

