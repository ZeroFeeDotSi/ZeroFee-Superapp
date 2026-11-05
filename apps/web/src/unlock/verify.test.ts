import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { passkeyUserVerified, verifiedFlags, webUserVerified } from "./verify.ts";

const HOST = "superapp.zerofee.si";
const id = new Uint8Array([1, 2, 3, 4]);
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
/** authenticatorData: rpIdHash (32) + flags (1) + counter (4). */
const authData = (flags: number, host = HOST) => { const b = new Uint8Array(37); b.set(createHash("sha256").update(host).digest()); b[32] = flags; return b.buffer; };
type Answer = { flags?: number; rawId?: Uint8Array | null; throws?: string; type?: string; challenge?: string; host?: string; offsetView?: boolean };
/** A fake credentials container that answers like an authenticator would (or as told), recording what it was asked. */
const creds = (a: Answer) => {
  const asked: CredentialRequestOptions[] = [];
  return {
    asked,
    get: async (o?: CredentialRequestOptions) => {
      asked.push(o!);
      if (a.throws) throw new DOMException("stopped", a.throws);
      const ch = o!.publicKey!.challenge as Uint8Array;
      const client = new TextEncoder().encode(JSON.stringify({ type: a.type ?? "webauthn.get", challenge: a.challenge ?? b64url(ch), origin: `https://${HOST}` }));
      let data: ArrayBuffer | Uint8Array = authData(a.flags ?? 0x05, a.host);
      if (a.offsetView) { const pad = new Uint8Array(45); pad.set(new Uint8Array(data), 8); data = pad.subarray(8); }
      return { rawId: a.rawId === null ? undefined : (a.rawId ?? id).buffer.slice(0), response: { authenticatorData: data, clientDataJSON: client.buffer } } as unknown as Credential;
    },
  };
};
const ok = (a: Answer) => passkeyUserVerified(id, creds(a), HOST);

test("D103: a fresh assertion with user present AND verified, to our challenge and our site, is accepted; asked with UV required", async () => {
  const c = creds({});
  assert.equal(await passkeyUserVerified(id, c, HOST), true);
  assert.equal(c.asked[0]!.publicKey!.userVerification, "required");
});

test("D103: an assertion WITHOUT user verification (UP only) is refused: the request's 'required' is not trusted", async () => {
  assert.equal(await ok({ flags: 0x01 }), false);
  assert.equal(await ok({ flags: 0x05 }), true); // control: the same answer with UV set
});

test("D103: a replayed answer (another challenge), a create-type answer, or one signed for another site is refused", async () => {
  assert.equal(await ok({ challenge: b64url(new Uint8Array(32)) }), false);
  assert.equal(await ok({ type: "webauthn.create" }), false);
  assert.equal(await ok({ host: "evil.example" }), false);
  assert.equal(await passkeyUserVerified(id, creds({}), undefined), false);
});

test("D103: UV without presence, short data, another or missing credential id, a cancelled prompt, no API: refused", async () => {
  assert.equal(await ok({ flags: 0x04 }), false);
  assert.equal(verifiedFlags(new Uint8Array(20)), false);
  assert.equal(await ok({ rawId: new Uint8Array([9, 9, 9, 9]) }), false);
  assert.equal(await ok({ rawId: null }), false);
  assert.equal(await ok({ throws: "NotAllowedError" }), false);
  assert.equal(await passkeyUserVerified(id, undefined, HOST), false);
});

test("D103: authenticatorData handed as a view with a byte offset is read at the right place", async () => {
  assert.equal(await ok({ offsetView: true }), true);
  assert.equal(await ok({ offsetView: true, flags: 0x01 }), false);
});

test("D103: every check is a fresh assertion with its own challenge (never a cached answer)", async () => {
  const c = creds({});
  await passkeyUserVerified(id, c, HOST);
  await passkeyUserVerified(id, c, HOST);
  assert.equal(c.asked.length, 2);
  assert.notDeepEqual(c.asked[0]!.publicKey!.challenge, c.asked[1]!.publicKey!.challenge);
});

test("D103: a passcode unlock, no record, or a record that can't be read can't verify: false, and no prompt shows", async () => {
  const c = creds({});
  assert.equal(await webUserVerified(async () => ({ method: "passcode" }), c, HOST)("Use AgentZero on a computer"), false);
  assert.equal(await webUserVerified(async () => null, c, HOST)("x"), false);
  assert.equal(await webUserVerified(() => Promise.reject(new Error("store")), c, HOST)("x"), false);
  assert.equal(c.asked.length, 0);
  assert.equal(await webUserVerified(async () => ({ method: "passkey", credentialId: id }), c, HOST)("x"), true);
});
