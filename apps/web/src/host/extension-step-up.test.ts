// D143 in the ZeroFee Chrome extension (D157; review B2 follow-up). The Safe's signatures go through the extension's
// sheet (windowSheet): the words in the extension's own window, and Approve there is the person's iPhone, its answer
// checked here by verify.ts (UP + UV, the page's own challenge bound to those words, the extension's RP and origin).
// A yes without that signs nothing. The guardian's yes (SecondDeviceCore) takes the same check as its stepUp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DemoCore } from "../../../../packages/core/src/demo-core.ts";
import { SecondDeviceCore } from "../../../../packages/core/src/second-device.ts";
import { FakeChain } from "../../../../packages/core/src/testing/fake-chain.ts";
import { MemoryVault } from "../../../../packages/core/src/vault.ts";
import { SoftwareKey } from "../../../../packages/core/src/device-key.ts";
import type { BridgeResult } from "../../../../packages/core/src/bridge.ts";
import type { PlainWords } from "../../../../packages/core/src/signer.ts";
import { fromWire, credentialFromWire, credentialToWire, windowSheet, type Answer, type Ask } from "./extension.ts";
import { webUserVerified } from "../unlock/verify.ts";

const EXT = "hfnbcflhfpceemgoglhbonngemobhffd";
const ORIGIN = `chrome-extension://${EXT}`;
Object.defineProperty(globalThis, "location", { value: { protocol: "chrome-extension:", hostname: EXT, origin: ORIGIN }, configurable: true });

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const credentialId = new Uint8Array(16).fill(3);
const record = async () => ({ method: "passkey", credentialId });
const ok = <T>(r: BridgeResult<T>): T => { if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`); return r.ok; };

type Mode = "iphone" | "declined" | "no-uv" | "other-challenge" | "other-origin";
/** The extension's window, as the person and their iPhone answer it. */
function window(modeOf: () => Mode) {
  const shown: (PlainWords | undefined)[] = [];
  const ask = async (a: Ask): Promise<Answer> => {
    shown.push(a.words);
    const mode = modeOf();
    if (mode === "declined") return { declined: true };
    const ch = mode === "other-challenge" ? new Uint8Array(32).fill(1) : (fromWire(a.publicKey) as { challenge: Uint8Array }).challenge;
    const auth = new Uint8Array(37);
    auth.set(createHash("sha256").update(ORIGIN).digest());
    auth[32] = mode === "no-uv" ? 0x01 : 0x05;
    const client = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(ch).toString("base64url"), origin: mode === "other-origin" ? "https://evil.example" : ORIGIN }));
    return { credential: credentialToWire({ id: "x", rawId: credentialId.slice().buffer, type: "public-key", response: { clientDataJSON: client.buffer, authenticatorData: auth.buffer, signature: new Uint8Array(70).buffer }, getClientExtensionResults: () => ({}) }) };
  };
  return { shown, ask };
}

const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
const pay = { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1000000000000000000000000" }], why: "", from: "wallet" } };

async function ready() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  let mode: Mode = "iphone"; // set-up passes; each test sets what the payment's window says
  let stepUps = 0;
  const w = window(() => mode);
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 20, indexRetryMs: 1, userVerified: async () => true,
    // the extension's wiring (core.ts): the sheet is the window; safeStepUp stays set, as on the web
    sheet: (words) => windowSheet(words, record, w.ask), safeStepUp: async () => (stepUps++, true) });
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  w.shown.length = 0;
  return { core, shown: w.shown, set: (m: Mode) => (mode = m), stepUps: () => stepUps };
}
const status = (r: BridgeResult<{ status: string }>) => ("ok" in r ? r.ok.status : r.problem.code);

test("D157: a Safe payment in the extension goes only with the iPhone's yes in the window; the words were shown there, once", async () => {
  const t = await ready();
  t.set("iphone");
  assert.equal(status(await t.core.call<{ status: string }>("tx.request", pay)), "done");
  assert.equal(t.shown.length, 1, "one window, one iPhone check");
  assert.match(t.shown[0]!.title, /Send/);
  assert.equal(t.stepUps(), 0, "never asked twice: the window's check is the fresh check");
});

test("D157: a no, an answer without user verification, to another challenge (another sheet's) or from another origin signs nothing", async () => {
  for (const mode of ["declined", "no-uv", "other-challenge", "other-origin"] as const) {
    const t = await ready();
    t.set(mode);
    const got = status(await t.core.call<{ status: string }>("tx.request", pay));
    assert.notEqual(got, "done", `${mode} signed`);
  }
});

test("D157: a passcode-locked browser can't say yes in the extension (no iPhone passkey on record)", async () => {
  const w = window(() => "iphone");
  assert.equal(await windowSheet({ title: "Send 1 NEAR", lines: [], warnings: [], effect: [] }, async () => ({ method: "passcode" }), w.ask), false);
  assert.equal(w.shown.length, 0, "no window opens");
  assert.equal(await windowSheet({ title: "Send 1 NEAR", lines: [], warnings: [], effect: [] }, record, w.ask), true); // control
});

test("D157: the guardian's yes in the extension needs the same fresh check (stepUp = webCheck); control: with it, the yes stands", async () => {
  const words = { title: "Say yes to: Send 900 USDC", lines: [], warnings: [], effect: [] } as unknown as PlainWords;
  const make = (mode: Mode) => {
    const w = window(() => mode);
    const creds = { get: (o?: CredentialRequestOptions) => w.ask({ kind: "get", publicKey: JSON.parse(JSON.stringify({ challenge: { $b: Buffer.from(o!.publicKey!.challenge as Uint8Array).toString("base64url") } })) }).then((a) => ("credential" in a ? credentialFromWire(a.credential) : null)) };
    const d = new SecondDeviceCore({ chain: new FakeChain(), vault: new MemoryVault(), stepUp: webUserVerified(record, creds as never) });
    d.on<{ id: string }>("approval.needed", ({ id }) => void d.call("approval.answer", { id, approve: true }));
    return (d as unknown as { approveOnSheet: (w: PlainWords) => Promise<boolean> }).approveOnSheet(words);
  };
  await assert.rejects(make("no-uv"), (e: { problem?: { code: string } }) => e.problem?.code === "security.safe.not-verified");
  await assert.rejects(make("declined"), (e: { problem?: { code: string } }) => e.problem?.code === "security.safe.not-verified");
  assert.equal(await make("iphone"), true);
});

test("D157: the extension's wiring in core.ts: the window sheet, and safeStepUp, userVerified and the guardian's stepUp all the same webCheck", () => {
  const core = readFileSync(new URL("../core.ts", import.meta.url), "utf8");
  assert.match(core, /const webCheck = \(reason: string\) => import\("\.\/unlock\/verify\.ts"\)\.then\(\(m\) => m\.webUserVerified\(\(\) => browserDevice\(\)\.readRecord\(\)\)\(reason\)\);/);
  assert.match(core, /\.\.\.\(host \|\| WEB_WALLET \? \{\} : \{ userVerified: webCheck \}\)/);
  assert.match(core, /\.\.\.\(host \|\| WEB_WALLET \? \{\} : \{ safeStepUp: webCheck \}\)/);
  assert.match(core, /\.\.\.\(EXTENSION_BUILD && !host \? \{ sheet: \(words: PlainWords\) => import\("\.\/host\/extension\.ts"\)\.then\(\(m\) => m\.windowSheet\(words, \(\) => browserDevice\(\)\.readRecord\(\)\)\) \} : \{\}\)/);
  assert.match(core, /new SecondDeviceCore\(\{[^\n]*\.\.\.\(host \? \{\} : \{ stepUp: webCheck \}\)/);
});
