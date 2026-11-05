// The release the app pins (known-contracts.ts) is the file in contracts/account-policy/release/, and it has only what
// the app shows (product decision, 28 Oct): no Agent, Legacy or Kids method is exported, and the phone's key is given exactly
// the release's own device methods.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { toBase58 } from "@fastnear/utils";
import { ACCOUNT_POLICY, hasModules, policyVersion } from "./known-contracts.ts";

const wasm = readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url));
const sums = readFileSync(new URL("../../../contracts/account-policy/release/SHA256SUMS", import.meta.url), "utf8");
const shortWasm = readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url));

test("the pinned release is the built file, by sha256 and code hash, and it is release 9 without modules", () => {
  const sha = createHash("sha256").update(wasm).digest();
  assert.equal(sha.toString("hex"), ACCOUNT_POLICY.sha256Hex);
  assert.equal(sums.trim(), `${ACCOUNT_POLICY.sha256Hex}  account_policy.wasm\n${ACCOUNT_POLICY.shortWaits.sha256Hex}  account_policy-short-waits.wasm`);
  // The short-waits build (a minute's least delay, for the sandbox and testnet) is the same source: known apart, never the pin.
  const shortSha = createHash("sha256").update(shortWasm).digest();
  assert.equal(shortSha.toString("hex"), ACCOUNT_POLICY.shortWaits.sha256Hex);
  assert.equal(toBase58(new Uint8Array(shortSha)), ACCOUNT_POLICY.shortWaits.codeHashBase58);
  assert.notEqual(ACCOUNT_POLICY.shortWaits.sha256Hex, ACCOUNT_POLICY.sha256Hex);
  assert.equal(policyVersion(ACCOUNT_POLICY.shortWaits.codeHashBase58, "testnet"), 9, "off mainnet only (audit, core integrity 3)");
  assert.deepEqual(ACCOUNT_POLICY.recoveryDelayChoices, [172_800, 259_200, 604_800, 1_209_600, 2_592_000], "D49: 48 hours at least, then 3, 7, 14 and 30 days");
  assert.equal(ACCOUNT_POLICY.defaultRecoveryDelaySeconds, 172_800);
  assert.equal(toBase58(new Uint8Array(sha)), ACCOUNT_POLICY.codeHashBase58);
  assert.equal(policyVersion(ACCOUNT_POLICY.codeHashBase58), 9);
  // Releases 8 and 7 stay known (an account on either upgrades to 9).
  assert.equal(policyVersion("37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg"), 8);
  assert.equal(policyVersion("DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6", "testnet"), 8, "its short-waits build, off mainnet");
  assert.equal(hasModules("37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg"), false);
  assert.equal(policyVersion("5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V"), 7);
  assert.equal(hasModules("5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V"), false);
  assert.equal(hasModules(ACCOUNT_POLICY.codeHashBase58), false);
  assert.equal(hasModules(ACCOUNT_POLICY.codeHashBase58, true), false);
  assert.equal(hasModules("3NFQ7DrAoPLJ8iwfMvwz2koeFLkNJ65nHS4DxA61y5Kv", true), true, "v4 accounts keep theirs");
});

test("the release exports exactly the account contract's own methods: nothing of Agent, Legacy or Kids", () => {
  const exported = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).filter((e) => e.kind === "function").map((e) => e.name).sort();
  assert.deepEqual(exported, [
    "add_second_device", "allowed_releases", "approve", "approve_recovery", "cancel", "cancel_recovery", "contract_source_metadata", "decline", "delay_seconds", "execute",
    "execute_many", "fallback_seconds", "finish_recovery", "frozen_until", "level_for", "level_for_many", "new", "on_group_done", "on_recovery_key", "on_second_device_key", "pending", "protection",
    "recovery_status", "refill_recovery_key", "refuse_recovery", "release_version", "remove_key", "run", "second_device_ages", "second_device_count", "second_devices_of_age",
    "set_protection", "set_recovery_key", "spent_today", "start_recovery", "upgrade", "upgrade_check", "waiting_requests",
  ]);
  // Every method the phone's key may call exists in the release (and nothing else is given to it).
  for (const m of [...ACCOUNT_POLICY.deviceMethods, ...ACCOUNT_POLICY.secondDeviceMethods, ...ACCOUNT_POLICY.recoveryKeyMethods]) assert.ok(exported.includes(m), m);
  const shortExported = WebAssembly.Module.exports(new WebAssembly.Module(shortWasm)).filter((e) => e.kind === "function").map((e) => e.name).sort();
  assert.deepEqual(shortExported, exported, "the short-waits build exports the same methods");
});
