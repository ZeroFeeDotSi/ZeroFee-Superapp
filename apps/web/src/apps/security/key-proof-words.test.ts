import { test } from "node:test";
import assert from "node:assert/strict";
import type { KeyProof } from "@zerofee/core/demo-core";
import { isProblem, keyProofWords, nodeName } from "./key-proof-words.ts";

const nodes = [{ node: "rpc.mainnet.fastnear.com", found: true }, { node: "near.drpc.org", found: true }];

test("the chip key: made inside this iPhone's chip on its date, a tick, and How we know names both reads", () => {
  const w = keyProofWords({ kind: "secure-chip", fingerprint: "91bshR…cLuH", chipFingerprint: "91bshR…cLuH", chipHeld: true, madeAtIso: "2026-11-01T05:00:00Z", nodes, matches: true });
  assert.ok(!isProblem(w));
  assert.equal(w.where, "Your key was made inside this iPhone's chip on 1 Nov 2026.");
  assert.equal(w.match, "It matches the key on your account.");
  assert.match(w.how[0]!, /chip holds your key\. Its key: 91bshR…cLuH/);
  assert.equal(w.how[1], "Your account's key, read from FastNear: 91bshR…cLuH ✓");
  assert.equal(w.how[2], "Your account's key, read from dRPC: 91bshR…cLuH ✓");
});

test("a browser key says where it truly is, encrypted in this browser, and never says chip", () => {
  const w = keyProofWords({ kind: "development", fingerprint: "AbCdEf…1234", nodes, matches: true });
  assert.ok(!isProblem(w));
  assert.equal(w.where, "Your key is kept in this browser, encrypted.");
  assert.doesNotMatch(JSON.stringify(w), /chip/i);
});

test("no match is a plain Problem with where the money is and one next step: never a tick", () => {
  const off = keyProofWords({ kind: "secure-chip", fingerprint: "a", chipFingerprint: "a", chipHeld: true, nodes: [nodes[0]!, { ...nodes[1]!, found: false }], matches: false });
  assert.ok(isProblem(off));
  assert.equal(off.code, "security.key.not-on-account");
  assert.equal(off.money.state, "safe");
  assert.equal(off.next.label, "Check again");
  const unread = keyProofWords({ kind: "secure-chip", fingerprint: "a", chipHeld: false, nodes, matches: false });
  assert.ok(isProblem(unread) && unread.code === "security.key.chip-unread");
  for (const p of [off, unread]) assert.doesNotMatch(JSON.stringify(p), /✓|\(\d+\)|error/i);
});

test("the demo says its key is a sample key", () => {
  const w = keyProofWords({ kind: "development", fingerprint: "a", nodes, matches: true, sample: true } as KeyProof);
  assert.ok(!isProblem(w));
  assert.match(w.where, /sample key/);
});

test("nodes are named as a person would", () => {
  assert.equal(nodeName("rpc.testnet.near.org"), "NEAR");
  assert.equal(nodeName("test.rpc.fastnear.com"), "FastNear");
});
