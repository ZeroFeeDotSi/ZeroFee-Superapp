// Touch ID in the panel (Security's ruling, 26 Oct): WebAuthn's PRF extension on the platform authenticator, with user
// verification, and the extension's own origin as the relying party. The panel only asks the authenticator; the worker's
// vault seals and opens. No PRF in this browser or on this authenticator means no Touch ID, and the passcode stays.
import { base64 } from "@zerofee/trade/sol/bytes.ts";

/** navigator.credentials, or a stand-in in tests. */
export interface Creds {
  create(o: CredentialCreationOptions): Promise<Credential | null>;
  get(o: CredentialRequestOptions): Promise<Credential | null>;
}
type Prf = { enabled?: boolean; results?: { first?: BufferSource } };

/** No PRF here: Touch ID can't seal the wallet in this browser. */
export class NoPrf extends Error {}

const b64url = (b: Uint8Array) => base64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const bytesOf = (b: BufferSource) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).slice();
const prfOf = (c: Credential | null): Prf | undefined => ((c as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: Prf } | undefined)?.prf;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Whether to offer Touch ID at all: a user-verifying platform authenticator, and PRF unless the browser says no. */
export async function touchOffered(P: typeof PublicKeyCredential | undefined = globalThis.PublicKeyCredential): Promise<boolean> {
  if (!P?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  if (!(await P.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false))) return false;
  const caps = await (P as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.().catch(() => undefined);
  return caps ? caps["extension:prf"] !== false : true;
}

/** The PRF output for this credential and salt; Touch ID asks the person. Throws on a cancel, or NoPrf. */
export async function prfFor(creds: Creds, credId: string, salt: Uint8Array): Promise<Uint8Array> {
  const c = await creds.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: "public-key", id: fromB64url(credId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  const first = prfOf(c)?.results?.first;
  if (!first) throw new NoPrf();
  return bytesOf(first);
}

/**
 * Makes this wallet's one credential (any earlier one excluded) and its PRF output for a new random salt. Throws on a
 * cancel, or NoPrf when the authenticator has no PRF.
 */
export async function enrol(creds: Creds, sol: string, exclude: string[] = []): Promise<{ credId: string; salt: Uint8Array; prf: Uint8Array }> {
  const salt = random(32);
  const c = await creds.create({
    publicKey: {
      rp: { name: "ZeroFee panel" },
      user: { id: random(16), name: `Trading wallet ${sol.slice(0, 4)}…${sol.slice(-4)}`, displayName: "ZeroFee trading wallet" },
      challenge: random(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      excludeCredentials: exclude.map((id) => ({ type: "public-key" as const, id: fromB64url(id) })),
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!c) throw new NoPrf();
  const credId = b64url(new Uint8Array((c as PublicKeyCredential).rawId));
  const r = prfOf(c);
  if (!r?.enabled && !r?.results?.first) throw new NoPrf();
  // some authenticators answer the PRF only when asked again, after the credential exists
  const prf = r.results?.first ? bytesOf(r.results.first) : await prfFor(creds, credId, salt);
  return { credId, salt, prf };
}
