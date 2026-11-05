// Audit IOS-1 (independent core + iOS audit of 18ad8d6; its PoC flipped): an approval that doesn't touch the account key
// (a separate wallet's, the isolated core's own sheets, device.confirm) was plain Face ID, so a face someone who knows
// the passcode enrolled approved too. Now it signs a fresh challenge with a Secure Enclave key under
// `.biometryCurrentSet`: a face enrolled since approves nothing. Swift has no test target here, so this reads the source;
// the proof on a phone is the product's checklist (enrol an alternate appearance, then an approval must fail).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chip = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/ChipKey.swift", import.meta.url)), "utf8");
const isolated = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/IsolatedCore.swift", import.meta.url)), "utf8");
const bridge = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/Bridge.swift", import.meta.url)), "utf8");
const pass = chip.slice(chip.indexOf("final class ApprovalPass"), chip.indexOf("enum Base58"));

test("approvals sign with a chip key bound to the faces enrolled when it was made; nothing else approves on a phone", () => {
  assert.match(pass, /\[\.privateKeyUsage, \.biometryCurrentSet\]/, "the approval key's own access control");
  assert.match(pass, /SecureEnclave\.P256\.Signing\.PrivateKey\(dataRepresentation: handle, authenticationContext: context\)/);
  assert.match(pass, /isValidSignature\(try key\.signature\(for: challenge\), for: challenge\)/, "the chip signs: a changed set throws");
  assert.match(pass, /guard SecureEnclave\.isAvailable else \{ return false \}/, "no chip on a phone: no approval");
  // Plain Face ID only on a simulator, which has no chip.
  const plain = [...pass.matchAll(/evaluatePolicy\(/g)].map((m) => m.index!);
  const simOnly = pass.indexOf("#if targetEnvironment(simulator)");
  const simEnd = pass.indexOf("#endif", simOnly);
  assert.ok(plain.length === 1 && plain[0]! > simOnly && plain[0]! < simEnd, "evaluatePolicy only inside the simulator branch");
  // A new account key brings a new approval key (bound to the faces enrolled then).
  assert.match(chip, /try\? ApprovalPass\.resetKey\(\)/);
  // Every approval that isn't the account key's goes through it.
  assert.match(isolated, /ApprovalPass\.shared\.confirm\(\)/);
  assert.match(bridge, /ApprovalPass\.shared\.confirm\(\)/);
});
