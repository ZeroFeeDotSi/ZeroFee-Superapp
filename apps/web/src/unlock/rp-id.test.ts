// D157: the fresh check (verify.ts) in the ZeroFee Chrome extension's own page. Chrome signs an extension page's passkeys
// for its whole origin, "chrome-extension://<id>" (seen in a probe on Chrome 156, 3 Nov: rpIdHash = SHA-256 of the
// origin, never of the bare id), so the check reads pageRpId(); a website keeps its own host, nothing loosened.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { pageRpId, passkeyUserVerified } from "./verify.ts";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const ext = { protocol: "chrome-extension:", hostname: EXT, origin: `chrome-extension://${EXT}` };
const id = new Uint8Array([9, 8, 7, 6]);
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
/** An authenticator that signs for `rp` (rpIdHash = SHA-256 of it), UP and UV set, to the asked challenge. */
const signsFor = (rp: string) => ({
  get: async (o?: CredentialRequestOptions) => {
    const ch = o!.publicKey!.challenge as Uint8Array;
    const data = new Uint8Array(37);
    data.set(createHash("sha256").update(rp).digest());
    data[32] = 0x05;
    const client = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: b64url(ch), origin: ext.origin }));
    return { rawId: id.buffer.slice(0), response: { authenticatorData: data.buffer, clientDataJSON: client.buffer } } as unknown as Credential;
  },
});

test("D157: an extension page's RP ID is its whole origin; a website's is its host, as before", () => {
  assert.equal(pageRpId(ext), `chrome-extension://${EXT}`);
  assert.equal(pageRpId({ protocol: "https:", hostname: "superapp.zerofee.si", origin: "https://superapp.zerofee.si" }), "superapp.zerofee.si");
  assert.equal(pageRpId({ protocol: "http:", hostname: "localhost", origin: "http://localhost:5180" }), "localhost");
});

test("D157: anything else has no RP ID, so the check refuses (a malformed extension id, another scheme, no page)", () => {
  assert.equal(pageRpId({ protocol: "chrome-extension:", hostname: "not-an-id", origin: "chrome-extension://not-an-id" }), undefined);
  assert.equal(pageRpId({ protocol: "chrome-extension:", hostname: EXT, origin: "https://evil.example" }), undefined);
  assert.equal(pageRpId({ protocol: "zerofee-app:", hostname: "app", origin: "null" }), undefined);
  assert.equal(pageRpId(undefined), undefined);
});

test("D157: in the extension, an assertion signed for its origin passes; one signed for the bare id or a website is refused", async () => {
  assert.equal(await passkeyUserVerified(id, signsFor(ext.origin), pageRpId(ext)), true);
  assert.equal(await passkeyUserVerified(id, signsFor(EXT), pageRpId(ext)), false);
  assert.equal(await passkeyUserVerified(id, signsFor("superapp.zerofee.si"), pageRpId(ext)), false);
  // control: the website's own check is unchanged (its host, never an extension origin)
  assert.equal(await passkeyUserVerified(id, signsFor("superapp.zerofee.si"), "superapp.zerofee.si"), true);
  assert.equal(await passkeyUserVerified(id, signsFor(ext.origin), "superapp.zerofee.si"), false);
});
