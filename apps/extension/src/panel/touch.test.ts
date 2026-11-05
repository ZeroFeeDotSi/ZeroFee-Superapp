import { test } from "node:test";
import assert from "node:assert/strict";
import { enrol, NoPrf, prfFor, touchOffered, type Creds } from "./touch.ts";

/** A fake platform authenticator: one credential, and an HMAC-like PRF per salt; `prf: false` has none. */
function fakeAuthenticator(o: { prf?: boolean; prfOnCreate?: boolean; cancel?: boolean } = {}) {
  const rawId = new Uint8Array(20).fill(5);
  const out = (salt: Uint8Array) => new Uint8Array(32).map((_, i) => (salt[i]! ^ 0x5a) & 0xff);
  const seen: { create?: CredentialCreationOptions; get?: CredentialRequestOptions } = {};
  const cred = (prf: unknown) => ({ rawId: rawId.buffer, getClientExtensionResults: () => (o.prf === false ? {} : { prf }) }) as unknown as Credential;
  const creds: Creds = {
    async create(opts) {
      seen.create = opts;
      if (o.cancel) throw Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" });
      const first = (opts.publicKey!.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first;
      return cred(o.prfOnCreate === false ? { enabled: true } : { enabled: true, results: { first: out(first).buffer } });
    },
    async get(opts) {
      seen.get = opts;
      if (o.cancel) throw Object.assign(new Error("not allowed"), { name: "NotAllowedError" });
      const first = (opts.publicKey!.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first;
      return cred({ results: { first: out(first).buffer } });
    },
  };
  return { creds, seen, out };
}
const SOL = "61mKCjtjjyngrdVDYJNTc3LDAqYmamrvT8y9yvPyuDxt";

test("turning Touch ID on: one platform credential with user verification, and the PRF output for a new 32-byte salt", async () => {
  const a = fakeAuthenticator();
  const r = await enrol(a.creds, SOL);
  assert.equal(r.salt.length, 32);
  assert.deepEqual(r.prf, a.out(r.salt));
  const pk = a.seen.create!.publicKey!;
  assert.equal(pk.authenticatorSelection?.authenticatorAttachment, "platform");
  assert.equal(pk.authenticatorSelection?.userVerification, "required");
  assert.equal(pk.rp.id, undefined, "the relying party is the extension's own origin");
  assert.ok(r.credId.length >= 16 && !/[+/=]/.test(r.credId));
});

test("an authenticator that answers the PRF only afterwards is asked once more; the same salt gives the same output", async () => {
  const a = fakeAuthenticator({ prfOnCreate: false });
  const r = await enrol(a.creds, SOL);
  assert.deepEqual(r.prf, a.out(r.salt));
  assert.deepEqual(await prfFor(a.creds, r.credId, r.salt), r.prf);
  assert.equal(a.seen.get!.publicKey!.userVerification, "required");
});

test("no PRF means no Touch ID; a cancel is a plain failure (the panel goes to the passcode)", async () => {
  await assert.rejects(enrol(fakeAuthenticator({ prf: false }).creds, SOL), NoPrf);
  await assert.rejects(prfFor(fakeAuthenticator({ prf: false }).creds, "AbCdEfGhIjKlMnOp", new Uint8Array(32)), NoPrf);
  await assert.rejects(prfFor(fakeAuthenticator({ cancel: true }).creds, "AbCdEfGhIjKlMnOp", new Uint8Array(32)), { name: "NotAllowedError" });
});

test("Touch ID is offered only with a user-verifying platform authenticator, and not where PRF is said to be missing", async () => {
  const P = (uv: boolean, caps?: Record<string, boolean>) => ({ isUserVerifyingPlatformAuthenticatorAvailable: async () => uv, ...(caps ? { getClientCapabilities: async () => caps } : {}) }) as unknown as typeof PublicKeyCredential;
  assert.equal(await touchOffered(undefined), false);
  assert.equal(await touchOffered(P(false)), false);
  assert.equal(await touchOffered(P(true)), true);
  assert.equal(await touchOffered(P(true, { "extension:prf": false })), false);
  assert.equal(await touchOffered(P(true, { "extension:prf": true })), true);
});
