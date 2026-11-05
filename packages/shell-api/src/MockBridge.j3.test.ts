// J3 part 1 on the judges' demo (AUDIT-2026-11-02 D5): the mock answers Chat's request for NEAR on NEAR as Wallet's
// ledger does (C1: "near on near" refused it), its Problems name coins and networks in words, each demo browser is its
// own account so one person can pay another's request, and a reload keeps the person the same person in Chat (C2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { readDmContent } from "@zerofee/core/bitchat-dm";
import { coinWords, createMockBridge, mockReceives, SAMPLE_ACCOUNT_ID } from "./MockBridge.ts";

const ids = /nep\d{3}:|\.omft\.near|\bnear on near\b|[a-z]+ on [a-z]+$/;

test("C1: Request for NEAR on NEAR gets the account's own NEAR address; the token is Wallet's own name for it, 'near'", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const r = await mock.call<{ address: string; chain: string; token: string }>("ledger.depositAddress", { chain: "near", token: "near" });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.address, SAMPLE_ACCOUNT_ID);
  assert.equal(r.ok.chain, "near");
  // Controls: an asset id and no token still work; "near" on another network and a bare symbol are refused.
  assert.ok("ok" in (await mock.call("ledger.depositAddress", { chain: "near", token: "nep141:wrap.near" })));
  assert.ok("ok" in (await mock.call("ledger.depositAddress", { chain: "sol" })));
  assert.equal(mockReceives("near", "near"), true);
  assert.equal(mockReceives("sol", "near"), false);
  assert.equal(mockReceives("sol", "SOL"), false);
});

test("C1: a coin the demo can't take is named in words, never an id", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  for (const [chain, token, words] of [["sol", "SOL", "SOL on Solana"], ["base", "near", "NEAR on Base"], ["near", 42, "That coin on NEAR"]] as const) {
    const r = await mock.call("ledger.depositAddress", { chain, token });
    assert.ok("problem" in r, `${chain} ${token}`);
    assert.equal(r.problem.more, words);
    assert.doesNotMatch(`${r.problem.whatHappened} ${r.problem.more}`, ids);
  }
  assert.equal(coinWords("nep141:wrap.near"), "NEAR");
  assert.equal(coinWords("nep141:some-new-token.near"), "That coin");
});

test("C1: each demo browser is its own account (accountId), so one person can pay the other's request", async () => {
  const ava = createMockBridge({ latencyMs: 0, accountId: "zf-sample123456.testnet" });
  const ben = createMockBridge({ latencyMs: 0, accountId: "zf-sample654321.testnet" });
  const a = await ava.call<{ address: string }>("ledger.depositAddress", { chain: "near", token: "near" });
  const state = await ben.call<{ account: { accountId: string } }>("account.state");
  assert.ok("ok" in a && "ok" in state);
  assert.equal(a.ok.address, "zf-sample123456.testnet");
  assert.equal(state.ok.account.accountId, "zf-sample654321.testnet");
  assert.notEqual(a.ok.address, state.ok.account.accountId, "Ava's address isn't Ben's own account");
  const plain = await createMockBridge({ latencyMs: 0 }).call<{ account: { accountId: string } }>("account.state");
  assert.ok("ok" in plain && plain.ok.account.accountId === SAMPLE_ACCOUNT_ID, "control: without it, the one sample name");
});

test("C2: after a reload the demo person keeps their Chat key, so their own posts are still theirs", async () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  const keyOf = async (m: ReturnType<typeof createMockBridge>) => {
    const r = await forApps(m, "chat").call<{ pubkey: string }>("nostr.publicKey", { geohash: "u0qj" });
    assert.ok("ok" in r);
    return r.ok.pubkey;
  };
  const before = createMockBridge({ latencyMs: 0, persist: { storage } });
  const key = await keyOf(before);
  before.flush();
  const after = createMockBridge({ latencyMs: 0, persist: { storage } });
  assert.equal(await keyOf(after), key, "the same person after the reload");
  assert.notEqual(await keyOf(createMockBridge({ latencyMs: 0 })), key, "control: another demo is another person");
});

test("C4: Send again seals the same message with its id kept; any other id is refused", async () => {
  const alice = forApps(createMockBridge({ latencyMs: 0 }), "chat");
  const bob = forApps(createMockBridge({ latencyMs: 0 }), "chat");
  const b = ((await bob.call<{ pubkey: string }>("nostr.publicKey", { geohash: "u0qj" })) as { ok: { pubkey: string } }).ok.pubkey;
  const first = await alice.call<{ event: unknown; messageId: string }>("nostr.seal", { geohash: "u0qj", to: b, kind: "message", text: "hi" });
  assert.ok("ok" in first);
  const again = await alice.call<{ event: unknown; messageId: string }>("nostr.seal", { geohash: "u0qj", to: b, kind: "message", text: "hi", messageId: first.ok.messageId });
  assert.ok("ok" in again);
  assert.equal(again.ok.messageId, first.ok.messageId);
  const opened = await bob.call<{ content: string }>("nostr.open", { geohash: "u0qj", event: again.ok.event });
  assert.ok("ok" in opened && opened.ok);
  assert.deepEqual(await readDmContent(opened.ok.content), { kind: "message", messageId: first.ok.messageId, text: "hi" });
  for (const bad of ["has space", "", 7]) {
    const r = await alice.call("nostr.seal", { geohash: "u0qj", to: b, kind: "message", text: "hi", messageId: bad });
    assert.ok("problem" in r && r.problem.code === "security.request.invalid", String(bad));
  }
});
