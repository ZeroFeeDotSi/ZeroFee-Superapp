// The web key is the person's iPhone (product decision, 3 Nov): the passkey is asked of another
// device over WebAuthn's hybrid transport (the browser's QR code, Face ID on the iPhone), found by itself, user
// verification required; every read asks the same way; and the vault is sealed with an unlock-shaped read's PRF output,
// never the creation's (over hybrid the two have been reported to differ).
import { test } from "node:test";
import assert from "node:assert/strict";
import { IPHONE_KEY, createPasskey, passkeyAvailable, passkeyName, passkeyPrf } from "./passkey.ts";
import { passkeyUserVerified } from "./verify.ts";

type Opts = { publicKey: Record<string, any> };
function fakeBrowser(o: { createFirst?: number; getFirst?: number; caps?: Record<string, boolean> } = {}) {
  const asked: { kind: "create" | "get"; publicKey: Record<string, any> }[] = [];
  const out = (first: number | undefined) => ({ prf: { enabled: true, ...(first !== undefined ? { results: { first: new Uint8Array(32).fill(first).buffer } } : {}) } });
  const credentials = {
    create: async (opts: Opts) => { asked.push({ kind: "create", publicKey: opts.publicKey }); return { rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => out(o.createFirst) }; },
    get: async (opts: Opts) => { asked.push({ kind: "get", publicKey: opts.publicKey }); return { rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => out(o.getFirst) }; },
  };
  Object.defineProperty(globalThis, "navigator", { value: { credentials }, configurable: true });
  Object.defineProperty(globalThis, "PublicKeyCredential", { value: { getClientCapabilities: o.caps ? async () => o.caps : undefined }, configurable: true });
  return asked;
}

test("a new key is asked of the iPhone: cross-platform over hybrid, found by itself, Face ID required", async () => {
  const asked = fakeBrowser({ createFirst: 7, getFirst: 9 });
  const made = await createPasskey();
  assert.ok(made);
  const create = asked.find((a) => a.kind === "create")!.publicKey;
  assert.deepEqual(create.hints, ["hybrid"]);
  assert.equal(create.authenticatorSelection.authenticatorAttachment, "cross-platform", "never this computer's own (platform) passkey");
  assert.equal(create.authenticatorSelection.residentKey, "required");
  assert.equal(create.authenticatorSelection.userVerification, "required");
  assert.ok(create.extensions.prf, "PRF asked");
  // sealed with the unlock-shaped read (9), not the creation's own output (7); control: the creation did give one
  assert.deepEqual([...made.prf], new Array(32).fill(9));
  assert.notDeepEqual([...made.prf], new Array(32).fill(7));
  const get = asked.find((a) => a.kind === "get")!.publicKey;
  assert.deepEqual(get.hints, ["hybrid"]);
  assert.deepEqual(get.allowCredentials[0].transports, ["hybrid"]);
  assert.equal(get.userVerification, "required");
});

test("every unlock asks the iPhone the same way; a passkey without PRF falls back (null), never a weaker seal", async () => {
  const asked = fakeBrowser({ getFirst: 4 });
  const prf = await passkeyPrf(new Uint8Array([1, 2, 3]), new Uint8Array(32));
  assert.deepEqual([...prf], new Array(32).fill(4));
  assert.deepEqual(asked[0]!.publicKey.hints, ["hybrid"]);
  fakeBrowser({ createFirst: 5 }); // the read gives no PRF
  assert.equal(await createPasskey(), null);
});

test("available unless the browser says it can't do PRF or reach a phone; no WebAuthn at all is no", async () => {
  fakeBrowser({ caps: { "extension:prf": true, hybridTransport: true } });
  assert.equal(await passkeyAvailable(), true);
  fakeBrowser({ caps: { hybridTransport: false } });
  assert.equal(await passkeyAvailable(), false);
  fakeBrowser({ caps: { "extension:prf": false, hybridTransport: true } });
  assert.equal(await passkeyAvailable(), false);
  fakeBrowser({});
  assert.equal(await passkeyAvailable(), true, "a browser that doesn't say is tried (no PRF then means a passcode)");
  Object.defineProperty(globalThis, "PublicKeyCredential", { value: undefined, configurable: true });
  assert.equal(await passkeyAvailable(), false);
});

test("AgentZero's fresh check (verify.ts) asks the same iPhone over hybrid; the words name the iPhone, never a chip (D20)", async () => {
  const seen: Record<string, any>[] = [];
  await passkeyUserVerified(new Uint8Array([1]), { get: async (o: any) => { seen.push(o.publicKey); return null; } } as never, "example.test");
  assert.deepEqual(seen[0]!.hints, ["hybrid"]);
  assert.deepEqual(seen[0]!.allowCredentials[0].transports, ["hybrid"]);
  assert.equal(passkeyName(), "your iPhone");
  assert.equal(IPHONE_KEY, "Your iPhone is your key. Scan the code with your iPhone, then approve with Face ID.");
  assert.doesNotMatch(IPHONE_KEY, /chip/i);
});
