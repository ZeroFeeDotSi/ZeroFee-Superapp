// D157: the extension's approval window. The app's page hands the window one WebAuthn request and checks the answer
// itself; the window runs only the shapes passkey.ts and verify.ts make; answers come only from our own window.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { credentialFromWire, credentialToWire, fromOurWindow, fromWire, readAnswer, readAsk, settle, toWire, wireRequestAllowed } from "./extension.ts";
import { pageRpId, passkeyUserVerified } from "../unlock/verify.ts";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXT}`;
const bytes = (n: number, v = 1) => new Uint8Array(n).fill(v);
const getReq = (over: Record<string, unknown> = {}) => ({ challenge: bytes(32), allowCredentials: [{ type: "public-key", id: bytes(16, 3), transports: ["hybrid"] }], userVerification: "required", timeout: 120_000, hints: ["hybrid"], ...over });
const createReq = (over: Record<string, unknown> = {}) => ({
  rp: { name: "ZeroFee" }, user: { id: bytes(16), name: "ZeroFee", displayName: "ZeroFee" }, challenge: bytes(32),
  pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
  timeout: 120_000, hints: ["hybrid"], extensions: { prf: { eval: { first: bytes(32, 9) } } }, ...over,
});

test("the wire carries buffers as base64url and gives them back byte for byte", () => {
  const v = { a: bytes(5, 250), b: [new Uint8Array([1, 2, 3]).buffer, "x"], c: { d: 1, e: true, f: null } };
  const w = toWire(v);
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w);
  const back = fromWire(w) as { a: Uint8Array; b: [Uint8Array, string] };
  assert.deepEqual([...back.a], [...v.a]);
  assert.deepEqual([...back.b[0]], [1, 2, 3]);
});

test("D157: the window runs the app's own requests (unlock, fresh check, make the key)", () => {
  assert.equal(wireRequestAllowed("get", toWire(getReq())), true);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ extensions: { prf: { eval: { first: bytes(32) } } } }))), true);
  assert.equal(wireRequestAllowed("create", toWire(createReq())), true);
});

test("D157: the window refuses anything else: another RP ID, no user verification, mediation, attestation, other extensions, a short challenge", () => {
  assert.equal(wireRequestAllowed("get", toWire(getReq({ rpId: "zerofee.si" }))), false);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ userVerification: "preferred" }))), false);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ challenge: bytes(16) }))), false);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ allowCredentials: [] }))), false);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ hints: ["client-device"] }))), false);
  assert.equal(wireRequestAllowed("get", toWire(getReq({ extensions: { largeBlob: { read: true } } }))), false);
  assert.equal(wireRequestAllowed("create", toWire(createReq({ rp: { name: "ZeroFee", id: "zerofee.si" } }))), false);
  assert.equal(wireRequestAllowed("create", toWire(createReq({ attestation: "direct" }))), false);
  assert.equal(wireRequestAllowed("create", toWire(createReq({ authenticatorSelection: { residentKey: "required", userVerification: "discouraged" } }))), false);
  assert.equal(readAsk({ kind: "get", publicKey: toWire(getReq({ rpId: "x" })) }), null);
  assert.equal(readAsk({ kind: "sign", publicKey: toWire(getReq()) }), null);
  assert.equal(readAsk({ kind: "create", publicKey: toWire(createReq()), words: { title: "Send", lines: [], warnings: [], effect: [] } }), null); // a sheet is always a get
  assert.ok(readAsk({ kind: "get", publicKey: toWire(getReq()), words: { title: "Send 1 NEAR", lines: [], warnings: [], effect: [] } })); // control
});

/** What an iPhone answers over hybrid in the window, for `rp`, to `challenge`. */
function phoneAnswer(challenge: Uint8Array, rp = ORIGIN, flags = 0x05) {
  const auth = new Uint8Array(37);
  auth.set(createHash("sha256").update(rp).digest());
  auth[32] = flags;
  const client = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(challenge).toString("base64url"), origin: ORIGIN }));
  return {
    id: "AwMD", rawId: bytes(16, 3).buffer, type: "public-key", authenticatorAttachment: "cross-platform",
    response: { clientDataJSON: client.buffer, authenticatorData: auth.buffer, signature: bytes(70).buffer, userHandle: null },
    getClientExtensionResults: () => ({ prf: { results: { first: bytes(32, 7) } } }),
  };
}

test("D157: the iPhone's answer crosses the wire and passes the app's own check (verify.ts) for the extension's origin", async () => {
  const creds = { get: async (o?: CredentialRequestOptions) => settle(readAnswer(JSON.parse(JSON.stringify({ credential: credentialToWire(phoneAnswer(o!.publicKey!.challenge as Uint8Array)) })))) };
  assert.equal(await passkeyUserVerified(bytes(16, 3), creds, pageRpId({ protocol: "chrome-extension:", hostname: EXT, origin: ORIGIN })), true);
  // the PRF output comes through for the unlock
  const c = credentialFromWire(credentialToWire(phoneAnswer(bytes(32))));
  assert.deepEqual([...new Uint8Array((c as unknown as { getClientExtensionResults: () => { prf: { results: { first: ArrayBuffer } } } }).getClientExtensionResults().prf.results.first)], [...bytes(32, 7)]);
});

test("D157: a window can't approve what the page didn't ask: another challenge, no UV, another RP; a no and a cancel are not yes", async () => {
  const rp = pageRpId({ protocol: "chrome-extension:", hostname: EXT, origin: ORIGIN });
  const via = (make: (ch: Uint8Array) => ReturnType<typeof phoneAnswer>) => ({ get: async (o?: CredentialRequestOptions) => settle({ credential: credentialToWire(make(o!.publicKey!.challenge as Uint8Array)) }) });
  assert.equal(await passkeyUserVerified(bytes(16, 3), via(() => phoneAnswer(bytes(32, 4))), rp), false);
  assert.equal(await passkeyUserVerified(bytes(16, 3), via((ch) => phoneAnswer(ch, ORIGIN, 0x01)), rp), false);
  assert.equal(await passkeyUserVerified(bytes(16, 3), via((ch) => phoneAnswer(ch, "superapp.zerofee.si")), rp), false);
  assert.equal(await passkeyUserVerified(bytes(16, 3), { get: async () => settle({ declined: true }) }, rp), false);
  assert.equal(await passkeyUserVerified(bytes(16, 3), { get: async () => settle(readAnswer({ error: { name: "NotAllowedError", message: "closed" } })) }, rp), false);
  assert.throws(() => settle(readAnswer("junk")), (e: unknown) => e instanceof DOMException && e.name === "NotAllowedError");
});

test("D157: answers count only from our own approval window, for that ask, in the window opened for it", () => {
  const s = { id: "rt", url: `${ORIGIN}/approve.html#abc`, tab: { windowId: 7 } };
  assert.equal(fromOurWindow(s, "rt", ORIGIN, "abc", 7), true);
  assert.equal(fromOurWindow({ ...s, id: "other" }, "rt", ORIGIN, "abc", 7), false); // another extension
  assert.equal(fromOurWindow({ ...s, url: "https://axiom.trade/approve.html#abc" }, "rt", ORIGIN, "abc", 7), false); // a content script's page
  assert.equal(fromOurWindow({ ...s, url: `${ORIGIN}/panel.html#abc` }, "rt", ORIGIN, "abc", 7), false);
  assert.equal(fromOurWindow({ ...s, url: `${ORIGIN}/approve.html#xyz` }, "rt", ORIGIN, "abc", 7), false); // another ask
  assert.equal(fromOurWindow({ ...s, tab: { windowId: 8 } }, "rt", ORIGIN, "abc", 7), false); // another window
  assert.equal(fromOurWindow(s, "rt", ORIGIN, "abc", undefined), false); // before its window is known
});

test("D157: the window sheet says no without the iPhone's passkey on this browser, and without a window to ask", async () => {
  const { windowSheet } = await import("./extension.ts");
  const words = { title: "Send 1 NEAR", lines: [], warnings: [], effect: [] };
  assert.equal(await windowSheet(words, async () => ({ method: "passcode" })), false);
  assert.equal(await windowSheet(words, async () => null), false);
  assert.equal(await windowSheet(words, async () => { throw new Error("locked"); }), false);
  // a passkey record, but no extension window here (no chrome.windows): still no
  assert.equal(await windowSheet(words, async () => ({ method: "passkey", credentialId: bytes(16, 3) })), false);
});
