// Release 10 (Agent's own key with a daily limit) is OFFERED only (D57): its pin is the built file, a new account still
// gets release 9, and the core knows release 10's hashes, its phone methods and Agent's one method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { toBase58 } from "@fastnear/utils";
import { ACCOUNT_POLICY, OFFERED_RELEASES, RELEASE_10, hasAgent, hasModules, isAccountPolicy, policyVersion } from "./known-contracts.ts";

const file = (f: string) => readFileSync(new URL(`../../../contracts/account-policy/release/${f}`, import.meta.url));
const sha = (b: Buffer) => createHash("sha256").update(b).digest();

test("release 10's pin is the built file, by sha256, code hash and size, and SHA256SUMS-10 says the same", () => {
  const r10 = file("account_policy-10.wasm"), short = file("account_policy-10-short-waits.wasm");
  assert.equal(sha(r10).toString("hex"), RELEASE_10.sha256Hex);
  assert.equal(toBase58(new Uint8Array(sha(r10))), RELEASE_10.codeHashBase58);
  assert.equal(r10.length, RELEASE_10.bytes);
  assert.equal(sha(short).toString("hex"), RELEASE_10.shortWaits.sha256Hex);
  assert.equal(toBase58(new Uint8Array(sha(short))), RELEASE_10.shortWaits.codeHashBase58);
  assert.equal(file("SHA256SUMS-10").toString().trim(), `${RELEASE_10.sha256Hex}  account_policy-10.wasm\n${RELEASE_10.shortWaits.sha256Hex}  account_policy-10-short-waits.wasm`);
});

test("the 4 Nov audit: the pre-audit build is kept in previous/, and is unknown code everywhere (never ZeroFee's)", async () => {
  const { knownReleaseBySha, offeredUpdate } = await import("./known-contracts.ts");
  const before = file("previous/account_policy-10-before-audit.wasm");
  assert.equal(sha(before).toString("hex"), "b2381beef4da065a90081e1f5eaafe4293f9a3940207e4383d7caba417118119");
  assert.equal(toBase58(new Uint8Array(sha(before))), RELEASE_10.beforeAudit[0]);
  assert.equal(toBase58(new Uint8Array(sha(file("previous/account_policy-10-before-audit-short-waits.wasm")))), RELEASE_10.beforeAudit[1]);
  assert.notEqual(RELEASE_10.sha256Hex, sha(before).toString("hex"), "the pin is the fixed build");
  for (const h of RELEASE_10.beforeAudit) {
    assert.equal(isAccountPolicy(h), false, `${h}: not an account contract of ZeroFee's`);
    assert.equal(policyVersion(h), 0, `${h}: no release number`);
    assert.equal(hasAgent(h), false, `${h}: no Agent`);
    assert.equal(hasModules(h), false, `${h}: no Legacy or Kids paths`);
    assert.equal(ACCOUNT_POLICY.versions[h], undefined, `${h}: not in the versions Activity reads`);
  }
  assert.ok(isAccountPolicy(RELEASE_10.codeHashBase58) && policyVersion(RELEASE_10.codeHashBase58) === 10, "control: the fixed build is release 10");
  assert.ok(isAccountPolicy(RELEASE_10.shortWaits.codeHashBase58, "testnet"), "control: its short-waits build is known (on testnet: never on mainnet, fcd0a8fb)");
  assert.equal(knownReleaseBySha(sha(before).toString("hex")), null, "the sheet calls the pre-audit build unknown code");
  assert.equal(offeredUpdate(9)?.sha256Hex, RELEASE_10.sha256Hex, "a release-9 account is offered only the fixed build");
});

test("the 4 Nov proofing, round 1: the build before it is kept in previous/, and is unknown code everywhere too", async () => {
  const { knownReleaseBySha } = await import("./known-contracts.ts");
  const before = file("previous/account_policy-10-before-r1.wasm");
  assert.equal(sha(before).toString("hex"), "530846317e97b9d0aeda70e8363b96bf1f99f583086d46a38c0b558f564c6858");
  assert.equal(toBase58(new Uint8Array(sha(before))), RELEASE_10.beforeAudit[2]);
  assert.equal(toBase58(new Uint8Array(sha(file("previous/account_policy-10-before-r1-short-waits.wasm")))), RELEASE_10.beforeAudit[3]);
  assert.notEqual(RELEASE_10.sha256Hex, sha(before).toString("hex"), "the pin is round 1's build");
  for (const h of RELEASE_10.beforeAudit.slice(2)) {
    assert.equal(isAccountPolicy(h), false, `${h}: not an account contract of ZeroFee's`);
    assert.equal(isAccountPolicy(h, "testnet"), false, `${h}: not on testnet either`);
    assert.equal(policyVersion(h, "testnet"), 0, `${h}: no release number`);
    assert.equal(hasAgent(h, "testnet"), false, `${h}: no Agent`);
  }
  assert.equal(knownReleaseBySha(sha(before).toString("hex")), null, "the sheet calls it unknown code");
});

test("offered, never the default: a new account still gets release 9, and release 9's files are untouched", () => {
  assert.equal(policyVersion(ACCOUNT_POLICY.codeHashBase58), 9);
  assert.equal(sha(file("account_policy.wasm")).toString("hex"), ACCOUNT_POLICY.sha256Hex);
  assert.deepEqual(OFFERED_RELEASES.map((r) => r.version), [10]);
  assert.notEqual(RELEASE_10.codeHashBase58, ACCOUNT_POLICY.codeHashBase58);
});

test("the core knows release 10: its accounts, Agent on them, no Legacy or Kids paths, and the key method lists", () => {
  for (const h of [RELEASE_10.codeHashBase58, RELEASE_10.shortWaits.codeHashBase58]) {
    assert.equal(policyVersion(h, "testnet"), 10);
    assert.ok(isAccountPolicy(h, "testnet"));
    assert.ok(hasAgent(h, "testnet"));
    assert.ok(!hasModules(h, false, "testnet"), "release 10 has no Legacy: the v3/v4 module paths stay off");
  }
  assert.ok(!hasAgent(ACCOUNT_POLICY.codeHashBase58), "release 9 has no Agent");
  assert.deepEqual([...RELEASE_10.agentMethods], ["agent_pay"]);
  assert.deepEqual([...RELEASE_10.deviceMethods], [...ACCOUNT_POLICY.deviceMethods, "agent_set", "agent_set_budget", "agent_revoke", "agent_renew_key"]);
  // The contract's own list, word for word (src/lib.rs DEVICE_METHODS with `agent`).
  const lib = readFileSync(new URL("../../../contracts/account-policy/src/lib.rs", import.meta.url), "utf8");
  assert.ok(lib.includes(`pub const DEVICE_METHODS: &str = "${RELEASE_10.deviceMethods.join(",")}";`));
  assert.ok(lib.includes("pub const RELEASE_VERSION: u32 = 10;"));
});

test("the 4 Nov proofing, round 2: round 1's build is kept in previous/, and is unknown code everywhere too", async () => {
  const { knownReleaseBySha } = await import("./known-contracts.ts");
  const before = file("previous/account_policy-10-before-r2.wasm");
  assert.equal(sha(before).toString("hex"), "5fb691b1eb9d44e3c37ffafe8d602e7c35ce9c8c97b1fc115423fcd38bbc98aa");
  assert.equal(toBase58(new Uint8Array(sha(before))), RELEASE_10.beforeAudit[4]);
  assert.equal(toBase58(new Uint8Array(sha(file("previous/account_policy-10-before-r2-short-waits.wasm")))), RELEASE_10.beforeAudit[5]);
  assert.notEqual(RELEASE_10.sha256Hex, sha(before).toString("hex"), "the pin is round 2's build");
  for (const h of RELEASE_10.beforeAudit.slice(4)) {
    assert.equal(isAccountPolicy(h), false, `${h}: not an account contract of ZeroFee's`);
    assert.equal(isAccountPolicy(h, "testnet"), false, `${h}: not on testnet either`);
    assert.equal(policyVersion(h, "testnet"), 0, `${h}: no release number`);
    assert.equal(hasAgent(h, "testnet"), false, `${h}: no Agent`);
  }
  assert.equal(knownReleaseBySha(sha(before).toString("hex")), null, "the sheet calls it unknown code");
});

test("round 2 (the laptop veto): release 10's words key has a third method, end_dispute, and the wasm exports it", () => {
  assert.deepEqual([...RELEASE_10.recoveryKeyMethods], ["start_recovery", "finish_recovery", "end_dispute"]);
  const wasm = file("account_policy-10.wasm").toString("latin1");
  for (const m of [...RELEASE_10.recoveryKeyMethods, "dispute_until", "backup_key", "second_device_yes_from"]) assert.ok(wasm.includes(m), m);
});

test("round 4 (B4, the quote-priced sale): round 2's build is kept in previous/, unknown code everywhere, and this build is 10_004", async () => {
  const { knownReleaseBySha } = await import("./known-contracts.ts");
  const before = file("previous/account_policy-10-before-r4.wasm");
  assert.equal(sha(before).toString("hex"), "f070cd45603b86e552e2da2287effa2ff8411f48f0ec3bfb008d0ec5e146f6d6");
  assert.equal(toBase58(new Uint8Array(sha(before))), RELEASE_10.beforeAudit[6]);
  assert.equal(toBase58(new Uint8Array(sha(file("previous/account_policy-10-before-r4-short-waits.wasm")))), RELEASE_10.beforeAudit[7]);
  assert.notEqual(RELEASE_10.sha256Hex, sha(before).toString("hex"), "the pin is round 4's build");
  for (const h of RELEASE_10.beforeAudit.slice(6)) {
    assert.equal(isAccountPolicy(h), false, `${h}: not an account contract of ZeroFee's`);
    assert.equal(isAccountPolicy(h, "testnet"), false, `${h}: not on testnet either`);
    assert.equal(policyVersion(h, "testnet"), 0, `${h}: no release number`);
    assert.equal(hasAgent(h, "testnet"), false, `${h}: no Agent`);
  }
  assert.equal(knownReleaseBySha(sha(before).toString("hex")), null, "the sheet calls it unknown code");
  const lib = readFileSync(new URL("../../../contracts/account-policy/src/lib.rs", import.meta.url), "utf8");
  assert.ok(lib.includes("pub const RELEASE_BUILD: u32 = 10_005;"), "every earlier build's accounts (10, 10_002, 10_003, 10_004) take this build (G3)");
  // execute and level_for take the quote: the names are in the wasm's own JSON reading of their arguments
  const wasm = file("account_policy-10.wasm").toString("latin1");
  for (const m of ["signed", "signature", "amountInUsd", "depositAddress"]) assert.ok(wasm.includes(m), m);
});
