// the audit (5 Nov, MUST): a full-access key of any kind on an account with rules bypasses the contract entirely. The guard
// names it red, in the same words as Security's Quantum-safe card, never as just another new key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChainKey } from "./chain.ts";
import { BYPASS_LINE, guardNews } from "./guard-dog.ts";

const ACCOUNT = "zf-a.testnet";
const full = (handle: string): ChainKey => ({ handle, nonce: 1n, permission: { kind: "full" } });
const phone: ChainKey = { handle: "ml-dsa-65-hash:Phone", nonce: 1n, permission: { kind: "function-call", receiverId: ACCOUNT, methods: ["execute"], allowanceYocto: null } } as ChainKey;
const base = { accountId: ACCOUNT, held: [], mine: { keys: [], held: [] }, agentPerDayUsd: null, when: (s: string) => s };

test("a full-access key on a rules account: red, \"This key can bypass your Safe's rules.\", even on the learning round and even if mine", () => {
  assert.equal(BYPASS_LINE, "This key can bypass your Safe's rules.");
  for (const k of [full("ed25519:Left"), full("ml-dsa-65-hash:PqFull")]) {
    for (const seen of [{}, { keys: [phone.handle] }]) {
      const n = guardNews({ ...base, keys: [phone, k], seen, rules: true, mine: { keys: [k.handle], held: [] } });
      assert.equal(n.alerts.length, 1, `${k.handle}: one alert`);
      assert.equal(n.alerts[0]!.red, true);
      assert.match(n.alerts[0]!.body, /^This key can bypass your Safe's rules\. /);
      // told once
      assert.deepEqual(guardNews({ ...base, keys: [phone, k], seen: n.seen, rules: true }).alerts, []);
    }
  }
});

test("control: no rules, a full-access key is the old news (and nothing on the learning round); a function-call key is never red", () => {
  const k = full("ed25519:Left");
  assert.deepEqual(guardNews({ ...base, keys: [phone, k], seen: {}, rules: false }).alerts, []);
  const n = guardNews({ ...base, keys: [phone, k], seen: { keys: [phone.handle] }, rules: false });
  assert.equal(n.alerts[0]!.red, undefined);
  assert.match(n.alerts[0]!.body, /^A new key that can do anything was added/);
  const fc: ChainKey = { handle: "ed25519:Fc", nonce: 1n, permission: { kind: "function-call", receiverId: "x.near", methods: [], allowanceYocto: null } } as ChainKey;
  assert.equal(guardNews({ ...base, keys: [phone, fc], seen: { keys: [phone.handle] }, rules: true }).alerts[0]!.red, undefined);
});

test("the phone and the second device both tell the guard whether the rules are on", () => {
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /phoneGuard\(\{ chain: this\.chain, vault: this\.vault, accountId: s\.accountId, held, seen, when, rules \}\)/);
  const dog = readFileSync(new URL("./guard-dog.ts", import.meta.url), "utf8");
  assert.match(dog, /const rules = isAccountPolicy\(codeOf\(acct\), o\.chain\.network\);/);
});
