import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const NEAR = 10n ** 24n;

function setup(answer = true) {
  const chain = new FakeChain();
  const key = SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async (w) => (shown.push(w), answer) });
  return { chain, key, signer, shown };
}

const send = (yocto: string, receiverId = "bob.testnet"): TxRequest => ({ receiverId, actions: [{ kind: "transfer", yocto }], why: "pay Bob back", from: "wallet" });

test("describe shows words decoded from the bytes; the app's own words are only a hint", async () => {
  const { signer, chain } = setup();
  const words = await signer.describe({ ...send(String(NEAR)), why: "Send 0.01 NEAR to mallory" });
  assert.equal(words.title, "Send 1 NEAR to bob.testnet");
  assert.equal(words.hint, "Wallet says: Send 0.01 NEAR to mallory");
  assert.equal(chain.sent.length, 0);
});

test("grade 02f: a receiver the account's own record lists a send to is never 'first time'; one it doesn't is, said plainly", async () => {
  const chain = new FakeChain();
  const key = SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  let reads = 0;
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async () => true, pastRecipients: async () => (reads++, ["bob.testnet"]) });
  const warned = async (to: string) => (await signer.describe(send(String(NEAR), to))).warnings.filter((w) => w.kind === "first-time-recipient").map((w) => w.text);
  assert.deepEqual(await warned("bob.testnet"), [], "sent to from another device, or before a restore");
  assert.deepEqual(await warned("carol.testnet"), ["You haven't sent to carol.testnet before."], "control: the record has no send to carol");
  assert.equal(reads, 1, "the record is read once");
  // Unreadable record: the device's own list, and its words say so.
  const blind = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async () => true, pastRecipients: async () => { throw new Error("index down"); } });
  assert.deepEqual((await blind.describe(send(String(NEAR), "bob.testnet"))).warnings.filter((w) => w.kind === "first-time-recipient").map((w) => w.text), ["You haven't sent to bob.testnet from this device before."]);
});

test("approved: signed with the post-quantum key, sent, and the chain received exactly what was asked", async () => {
  const { signer, chain, shown } = setup();
  const outcome = await signer.request(send(String(2n * NEAR)));
  assert.equal(outcome.status, "done");
  assert.equal(shown.length, 1);
  assert.equal(chain.sent.length, 1);
  assert.deepEqual(chain.sent[0].actions, [{ kind: "transfer", yocto: 2n * NEAR }]);
  assert.equal(chain.sent[0].publicKey.type, "ml-dsa-65");
  assert.equal(chain.accounts.get("bob.testnet")!.balance, 12n * NEAR);
});

test("declined: nothing is signed or sent", async () => {
  const { signer, chain } = setup(false);
  assert.deepEqual(await signer.request(send("1")), { status: "declined" });
  assert.equal(chain.sent.length, 0);
});

test("two nodes that disagree stop everything before the person is even asked", async () => {
  const { signer, chain, shown } = setup();
  chain.disagree = true;
  const outcome = await signer.request(send("1"));
  assert.equal(outcome.status === "problem" && outcome.problem.code, "security.nodes.disagree");
  assert.equal(shown.length, 0);
});

test("apps can't change the account's own rules, register keys elsewhere, or switch off how intents.near knows the account", async () => {
  const { signer, shown } = setup();
  const own = await signer.request({ receiverId: "alice.testnet", actions: [{ kind: "call", method: "cancel_recovery", args: {}, depositYocto: "0", gas: "30000000000000" }], why: "", from: "agent" });
  assert.equal(own.status === "problem" && own.problem.code, "security.request.not-allowed");
  const intents = await signer.request({ receiverId: "intents.near", actions: [{ kind: "call", method: "add_public_key", args: { public_key: "ed25519:x" }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "trade" });
  assert.equal(intents.status === "problem" && intents.problem.code, "security.request.not-allowed");
  for (const method of ["remove_public_key", "disable_auth_by_predecessor_id"]) {
    const out = await signer.request({ receiverId: "intents.near", actions: [{ kind: "call", method, args: {}, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet" });
    assert.equal(out.status === "problem" && out.problem.code, "security.request.not-allowed", method);
  }
  const bad = await signer.request(send("1.5"));
  assert.equal(bad.status === "problem" && bad.problem.code, "security.request.invalid");
  assert.equal(shown.length, 0);
});

test("requests run one at a time, so two at once never reuse a nonce", async () => {
  const { signer, chain } = setup();
  const [a, b] = await Promise.all([signer.request(send("1")), signer.request(send("2"))]);
  assert.equal(a.status, "done");
  assert.equal(b.status, "done");
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n, 2n]);
});

test("account() names each key by its role", async () => {
  const { signer, key } = setup();
  const info = await signer.account();
  assert.equal(info.accountId, "alice.testnet");
  assert.deepEqual(info.keys, [{ handle: key.publicKeyHandle, role: "device", kind: "development", current: true, access: "full" }]);
  assert.equal(info.recovery, null);
});

/** A stand-in for the phone's chip key (S1.6): no bare-hash signing; it signs sha256(bytes) on its own sheet. */
function sheetKey(answer: "sign" | "not-now" | "forge" = "sign") {
  const inner = SoftwareKey.generate();
  const seen: { id: string; words: PlainWords; bytes: Uint8Array }[] = [];
  const key = {
    publicKey: inner.publicKey,
    signHash: async (): Promise<Uint8Array> => assert.fail("a key with its own sheet is never asked for a bare hash"),
    signOnSheet: async (r: { id: string; words: PlainWords; bytes: Uint8Array }) => {
      seen.push(r);
      if (answer === "not-now") return null;
      const hash = sha256(r.bytes);
      if (answer === "forge") hash[0] ^= 1;
      return inner.signHash(hash);
    },
  };
  return { key, seen };
}

test("a key with its own sheet gets the exact bytes and the words shown, the shell's sheet is told it's a preview, and the signature is over those bytes", async () => {
  const chain = new FakeChain();
  const { key, seen } = sheetKey();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const nexts: unknown[] = [];
  // The shell's sheet changes the words (as cancel/run do) and says what it showed.
  const signer = new DevSigner({
    accountId: "alice.testnet",
    chain,
    key,
    approve: async (w, next) => {
      nexts.push(next?.native);
      next?.shown({ ...w, title: `Shown: ${w.title}` }, "sheet-7");
      return true;
    },
  });
  const outcome = await signer.request(send(String(NEAR)));
  assert.equal(outcome.status, "done");
  assert.deepEqual(nexts, [true]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, "sheet-7");
  assert.equal(seen[0].words.title, "Shown: Send 1 NEAR to bob.testnet", "the key's sheet shows the words the shell showed");
  assert.deepEqual((seen[0] as any).summary, { receiver: "bob.testnet", actions: [{ kind: "transfer", deposit: String(NEAR) }] }, "the native sheet is handed the receiver and amount to check against the bytes");
  assert.equal(chain.sent.length, 1);
  assert.deepEqual(chain.sent[0].actions, [{ kind: "transfer", yocto: NEAR }]);
});

test("a key with its own sheet: Not now there is declined, and a signature that isn't over the bytes is never sent", async () => {
  for (const [answer, status] of [["not-now", "declined"], ["forge", "problem"]] as const) {
    const chain = new FakeChain();
    const { key } = sheetKey(answer);
    chain.fund("alice.testnet", key.publicKey);
    chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
    const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async () => true });
    const outcome = await signer.request(send("1"));
    assert.equal(outcome.status, status, answer);
    if (outcome.status === "problem") assert.equal(outcome.problem.code, "security.sign.invalid");
    assert.equal(chain.sent.length, 0, answer);
  }
});

test("the shell's No stops it before the key's own sheet is ever opened", async () => {
  const chain = new FakeChain();
  const { key, seen } = sheetKey();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async () => false });
  assert.deepEqual(await signer.request(send("1")), { status: "declined" });
  assert.equal(seen.length, 0);
});

test("a key without its own sheet: the shell's sheet isn't told it's a preview", async () => {
  const chain = new FakeChain();
  const key = SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const nexts: unknown[] = [];
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async (_w, next) => (nexts.push(next), true) });
  assert.equal((await signer.request(send("1"))).status, "done");
  assert.deepEqual(nexts, [undefined]);
});

test("account() reports the key this device signs with as a chip key when the key says so, and other phones as development", async () => {
  const { chain, key } = setup();
  const chip = { kind: "secure-chip" as const, publicKey: key.publicKey, signHash: (h: Uint8Array) => key.signHash(h) };
  const info = await new DevSigner({ accountId: "alice.testnet", chain, key: chip, approve: async () => true }).account();
  assert.equal(info.keys.find((k) => k.current)?.kind, "secure-chip");
  // a key list entry that isn't this device's is never called a chip key
  const elsewhere = await new DevSigner({ accountId: "alice.testnet", chain, key: { ...chip, publicKey: SoftwareKey.generate().publicKey }, approve: async () => true }).account();
  assert.deepEqual(elsewhere.keys.map((k) => [k.kind, k.current ?? false]), [["development", false]]);
});

test("the contract's 24-hour payment cap reads as security.payments.many, with when to try again; any other refusal stays send.failed", async () => {
  const { signer, chain } = setup();
  chain.send = async () => ({ status: "failed", value: null, failure: "Smart contract panicked: too many payments in the last 24 hours: try again tomorrow" });
  const before = Date.now();
  const many = await signer.request(send("1"));
  assert.ok(many.status === "problem" && many.problem.code === "security.payments.many");
  const next = many.problem.next as { kind: string; untilIso: string; label: string };
  assert.equal(next.kind, "wait");
  assert.ok(Date.parse(next.untilIso) >= before + 86_400_000 && Date.parse(next.untilIso) <= Date.now() + 86_400_000);
  assert.match(next.label, /^Try again after \d{1,2}:\d\d (AM|PM) tomorrow$/);
  assert.deepEqual(many.problem.money, { state: "safe", where: "in your Safe" });
  chain.send = async () => ({ status: "failed", value: null, failure: "Smart contract panicked: this request is still waiting" });
  const other = await signer.request(send("1"));
  assert.ok(other.status === "problem" && other.problem.code === "security.send.failed");
});
