// UX walk 2 Nov (a real account, which came to an iPhone without its backup words): posting in Chat
// asked him to type all 24 words ("ZeroFee Chat makes your name from your backup words. Check your words in Security
// once"). Chat names carry no money, so an account with no words on this device gets names made here, once; an account
// with its words keeps names from them (a restore brings them back). Nothing is ever asked just to post.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { chatSeed, placeKey, publicKeyHex } from "./nostr.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const ready = (vault: MemoryVault) => vault.put("state", new TextEncoder().encode(JSON.stringify({ accountId: "zf-0123456789.near", stage: "ready", recoveryIn: true })));
const PLACE = "w4rqnz";

test("an account here without its words: Chat posts with a name made on this device, the same name every time", async () => {
  const vault = new MemoryVault();
  await ready(vault);
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  const a = ok(await core.call<{ pubkey: string }>("nostr.publicKey", { geohash: PLACE, app: "chat" })).pubkey;
  assert.match(a, /^[0-9a-f]{64}$/);
  const signed = ok(await core.call<{ pubkey: string; sig: string }>("nostr.sign", { geohash: PLACE, app: "chat", kind: 20000, content: "hello" }));
  assert.equal(signed.pubkey, a, "the post is signed with that name");
  const again = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  assert.equal(ok(await again.call<{ pubkey: string }>("nostr.publicKey", { geohash: PLACE, app: "chat" })).pubkey, a, "kept: never a new name");
  // the words come later (a check in Security): the name made here stays, so it doesn't change under the person
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(7)));
  assert.equal(ok(await again.call<{ pubkey: string }>("nostr.publicKey", { geohash: PLACE, app: "chat" })).pubkey, a);
});

test("with the backup words here: names come from the words (a restore brings them back), nothing made on the device", async () => {
  const vault = new MemoryVault();
  await ready(vault);
  const words = new Uint8Array(32).fill(9);
  await vault.put(HOT_ROOT, hotRoot(words));
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  const want = publicKeyHex(placeKey(chatSeed(hotRoot(words)), PLACE));
  assert.equal(ok(await core.call<{ pubkey: string }>("nostr.publicKey", { geohash: PLACE, app: "chat" })).pubkey, want);
  assert.equal(await vault.get("chat-device-seed"), null);
});

test("controls: only Chat gets a name, and with no account here nothing is made", async () => {
  const vault = new MemoryVault();
  await ready(vault);
  const core = new DemoCore({ chain: new FakeChain(), vault, policyWasm: async () => rulesWasm });
  const r = await core.call("nostr.publicKey", { geohash: PLACE, app: "wallet" });
  assert.ok("problem" in r && r.problem.code === "security.method.unknown");
  const empty = new MemoryVault();
  const none = await new DemoCore({ chain: new FakeChain(), vault: empty, policyWasm: async () => rulesWasm }).call("nostr.publicKey", { geohash: PLACE, app: "chat" });
  assert.ok("problem" in none, "no account: refused");
  assert.equal(await empty.get("chat-device-seed"), null);
});
