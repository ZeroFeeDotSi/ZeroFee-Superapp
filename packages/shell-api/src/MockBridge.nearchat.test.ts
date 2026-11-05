// J3 part 2 on the sample demo: a sample account's Chat name is checked only the sample way (its key derived from its
// name, in this mock alone), a real-looking name is never taken on that rule, and a name the demo can't read is "can't
// say", never "exists".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { NostrEvent } from "@zerofee/core/nostr";
import { readNameEvent } from "@zerofee/core/chat-near";
import { base58 } from "@zerofee/core/sol/bytes";
import { createMockBridge, sampleAccountSecret } from "./MockBridge.ts";

const ok = <T>(r: { ok: T } | { problem: { code: string } }): T => {
  if ("problem" in r) throw new Error(r.problem.code);
  return r.ok;
};

test("a sample name: the demo's own note checks the sample way; another key, or the same rule for a real name, never", async () => {
  const bridge = createMockBridge({ latencyMs: 0, accountId: "zf-sample424201.testnet" });
  const bound = ok(await bridge.call<{ event: NostrEvent }>("nostr.bind", { app: "chat", room: true }));
  const record = readNameEvent(bound.event)!.record!;
  assert.equal(record.account, "zf-sample424201.testnet");
  assert.equal(ok(await bridge.call<{ onAccount: boolean }>("ledger.accountKey", { accountId: record.account, publicKey: record.publicKey })).onAccount, true);
  const other = `ed25519:${base58(ed25519.getPublicKey(new Uint8Array(32).fill(1)))}`;
  assert.equal(ok(await bridge.call<{ onAccount: boolean }>("ledger.accountKey", { accountId: record.account, publicKey: other })).onAccount, false, "another key: no");
  const realLooking = `ed25519:${base58(ed25519.getPublicKey(sampleAccountSecret("alice.near")))}`;
  assert.equal(ok(await bridge.call<{ onAccount: boolean }>("ledger.accountKey", { accountId: "alice.near", publicKey: realLooking })).onAccount, false, "the sample rule never vouches for a real name");
});

test("posting in a NEAR room needs the name first, on the demo as in the core", async () => {
  const bridge = createMockBridge({ latencyMs: 0 });
  const early = await bridge.call("nostr.sign", { app: "chat", room: "near:a.near", kind: 9, content: "hi" });
  assert.equal("problem" in early ? early.problem.code : "ok", "security.request.not-allowed");
  ok(await bridge.call("nostr.bind", { app: "chat", room: true }));
  assert.equal(ok(await bridge.call<NostrEvent>("nostr.sign", { app: "chat", room: "near:a.near", kind: 9, content: "hi" })).kind, 9);
});

test("a name on a network the demo doesn't read is 'can't say', never 'exists'", async () => {
  const bridge = createMockBridge({ latencyMs: 0, nearReads: () => undefined });
  const r = await bridge.call("ledger.recipientInfo", { accountId: "someone.testnet" });
  assert.ok("problem" in r, "can't say");
  const sample = ok(await bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: "zf-sample424202.testnet" }));
  assert.equal(sample.exists, true, "control: a sample name exists on the demo");
});

test("the demo's own account asks no network for its DAOs (its own data: none), and Chat reads them only while it is on screen (control: a real name is read on NEAR)", async () => {
  // a reader that counts every ask: the demo's RpcChain would send each to test.rpc.fastnear.com / testnet-rpc.intea.rs
  const asked: string[] = [];
  const counting = (net: "mainnet" | "testnet") => new Proxy({ network: net } as Record<string, unknown>, {
    get: (t, k) => (k === "network" ? t.network : typeof k === "string" ? (...a: unknown[]) => (asked.push(`${net} ${k}`), k === "commonBlock" ? Promise.resolve({ hash: "h", height: 1 }) : Promise.resolve(null)) : undefined),
  }) as never;
  const bridge = createMockBridge({ latencyMs: 0, accountId: "zf-sample424203.testnet", nearReads: counting });
  assert.deepEqual(ok(await bridge.call<{ daos: unknown[] }>("ledger.daosOf", { accountId: "zf-sample424203.testnet", opened: [] })).daos, []);
  assert.deepEqual(asked, [], "no read of sputnik-v2.testnet or any node for the demo's own account");
  await bridge.call("ledger.daosOf", { accountId: "someone.testnet", opened: [] });
  assert.ok(asked.some((a) => a.startsWith("testnet ")), "control: a real name's DAOs are read on NEAR");
  // Chat, mounted beside Trade as a neighbour, asks nothing until it is the app on screen (AppContext.active)
  const chat = readFileSync(new URL("../../chat/src/app/ChatApp.tsx", import.meta.url), "utf8");
  assert.match(chat, /if \(!me \|\| opened === null \|\| !shell\.active\) return;\n\s+let live = true;\n\s+void bridge\.call<\{ daos: Dao\[\] \}>\("ledger\.daosOf"/);
  assert.match(chat, /\}, \[bridge, me, opened\?\.join\(" "\), shell\.active\]\);/);
  assert.equal((chat.match(/"ledger\.daosOf"/g) ?? []).length, 1, "the only DAO read Chat makes");
});
