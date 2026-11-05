// The public site's stand-in for passkey.ts (vite.config.ts swaps it in for VITE_ZEROFEE_PUBLIC=1). The public site is
// the Sim and the web wallet (product decision, 4 Nov): the web wallet locks with a password only, never a passkey, and
// deploy-app.sh refuses WebAuthn ("PublicKeyCredential", "navigator.credentials") in that build. Same names, same words;
// no passkey is ever available, so nothing here can make or read one.
export { passkeyName, IPHONE_KEY, IPHONE_UNLOCKS, IPHONE_LOCKED, NO_IPHONE_HERE, PASSCODE_CANT_SEND, NO_IPHONE_KEY, keyOnHere } from "./passkey-words.ts";

export const IPHONE_HINTS = ["hybrid"] as const;
export const IPHONE_SELECTION = { authenticatorAttachment: "cross-platform", residentKey: "required", requireResidentKey: true, userVerification: "required" } as const;
export const passkeyAvailable = async (): Promise<boolean> => false;
export const isCancelled = (e: unknown) => e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
export async function passkeyPrf(_credentialId: Uint8Array, _prfSalt: Uint8Array): Promise<Uint8Array> {
  throw new Error("no passkey in this build");
}
export async function createPasskey(): Promise<{ credentialId: Uint8Array; prfSalt: Uint8Array; prf: Uint8Array } | null> {
  return null;
}
