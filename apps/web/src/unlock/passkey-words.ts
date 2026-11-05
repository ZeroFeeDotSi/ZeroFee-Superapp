// The web unlock's passkey words and name (moved out of passkey.ts, which re-exports them): plain text, no WebAuthn,
// so the public build's stand-in (passkey-none.ts) shows the same lines.

/**
 * The name the unlock goes by on the web: "your passkey", always. A browser never says which method its passkey uses
 * (Face ID, a fingerprint, a PIN, a security key), and guessing it from the user agent claimed Face ID to an iPhone
 * browser whose passkey may be anything (the user robot's walk, 29 Oct). The phone's own prompt names its method.
 */
export function passkeyName(_ua?: string): string {
  return "your iPhone";
}

/** The web key's words (product decision, 3 Nov; Copywriter): one option, the iPhone. D20 holds: never "chip" on the web (the keys
 *  are in this browser, encrypted; the iPhone's passkey unlocks them). */
export const IPHONE_KEY = "Your iPhone is your key. Scan the code with your iPhone, then approve with Face ID.";
export const IPHONE_UNLOCKS = "Your keys stay in this browser, locked. Your iPhone unlocks them.";
export const IPHONE_LOCKED = "Your keys are in this browser, locked. Your iPhone unlocks them.";
/** Real money in a browser that can't use the iPhone (product decision, 3 Nov: one option; no passcode on mainnet). */
export const NO_IPHONE_HERE = "This browser can't use your iPhone as a key. Open ZeroFee in Chrome or Safari, then scan with your iPhone.";
/** A browser locked with a passcode before (D143): it opens, but money leaves the Safe only with the iPhone. */
export const PASSCODE_CANT_SEND = "Money leaves your Safe only with your iPhone, so this browser can't send it.";
export const NO_IPHONE_KEY = "This browser can't use your iPhone as a key. Choose a long passcode: four words work well.";

/**
 * Whose passkey locks this page (product decision, 5 Nov): the laptop page (mode "laptop": the second-device build, and /laptop in
 * the real app) locks with the laptop's OWN passkey (Touch ID, Windows Hello: WebAuthn's "platform" authenticator),
 * never the iPhone and never a "which device" choice; every other page with the person's iPhone (hybrid).
 */
export type KeyOn = "iphone" | "laptop";
export const keyOnHere = (doc: { documentElement?: { dataset?: Record<string, string | undefined> } } | undefined = (globalThis as { document?: Document }).document): KeyOn =>
  doc?.documentElement?.dataset?.mode === "laptop" ? "laptop" : "iphone";
