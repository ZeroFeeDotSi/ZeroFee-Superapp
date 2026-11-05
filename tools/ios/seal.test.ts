// The separate wallets' secrets sealed to the phone's chip (Seal.swift, IsolatedCore.swift's KeychainCoreVault): every
// secret the core keeps in its vault is on the sealed list, and the vault seals and opens exactly those. Swift has no
// test target here, so these read the source; the seal itself runs only on a phone with a Secure Enclave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const seal = read("apps/ios/ZeroFee/Seal.swift");
const vault = read("apps/ios/ZeroFee/IsolatedCore.swift");
const core = read("packages/core/src/demo-core.ts");
const hot = read("packages/core/src/hot-keys.ts");
const subwallets = read("packages/core/src/subwallets.ts");
// AgentZero's door (its key's name with it) loads only when AgentZero asks: agent-door.ts, not demo-core.ts
const door = read("packages/core/src/agent-door.ts");

test("every secret the core keeps in its vault is sealed", () => {
  const wanted = /static func wanted\(_ name: String\) -> Bool \{([\s\S]*?)\n  \}/.exec(seal)?.[1] ?? "";
  const listed = /\[("[^"]+"(?:, "[^"]+")*)\]\.contains\(name\)/.exec(wanted);
  assert.ok(listed, "Seal.wanted's list");
  const names = [...listed![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const prefixes = [...wanted.matchAll(/name\.hasPrefix\("([^"]+)"\)/g)].map((m) => m[1]);
  const constant = (src: string, name: string) => new RegExp(`const ${name} = "([^"]+)"`).exec(src)?.[1];
  // The words and what they make; a self-funded account's set-up key (audit IOS-3).
  for (const [src, name] of [[hot, "HOT_ROOT"], [core, "RECOVERY_SEED"], [core, "PENDING_WORDS"], [core, "RENEW_WORDS"], [core, "SETUP_KEY"]] as const) {
    assert.ok(names.includes(constant(src, name)!), `${name} (${constant(src, name)}) is sealed`);
  }
  const prefix = /const seedName = \(id: string\) => `([^$]+)\$\{id\}`/.exec(subwallets)?.[1];
  assert.ok(prefixes.includes(prefix!), "every separate wallet's seed");
  assert.ok(constant(door, "AGENT_SEED") && prefixes.includes(constant(door, "AGENT_SEED")!), "Agent's key (audit IOS-3)");
  const space = /const at = \(name: string\) => `([^$]+)\$\{space\}/.exec(core)?.[1];
  assert.ok(space && prefixes.includes(space), "this phone's keys as someone's second device (audit IOS-4)");
});

test("the vault seals and opens exactly those, and a plain copy from before is sealed and removed when read", () => {
  assert.match(vault, /func get[\s\S]*?guard Seal\.wanted\(name\), Seal\.available else[\s\S]*?Seal\.open\(sealed, name: name\)[\s\S]*?try put\(name, plain\)/);
  assert.match(vault, /func put[\s\S]*?Seal\.seal\(data, name: name\)[\s\S]*?Keychain\.delete\(Keychain\.coreVault, name\)/);
  assert.match(vault, /func delete[\s\S]*?if Seal\.wanted\(name\) \{ try Keychain\.delete\(Keychain\.coreVault, name \+ Seal\.suffix\) \}/);
});

test("the chip's key: this device only, never out of the chip, no Face ID (fast trades stay fast); each item's name bound in", () => {
  assert.match(seal, /SecAccessControlCreateWithFlags\(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, \[\.privateKeyUsage\], &error\)/);
  assert.match(seal, /SecureEnclave\.P256\.KeyAgreement\.PrivateKey\(accessControl: access\)/);
  assert.match(seal, /sharedInfo: Data\("zerofee-seal-v1:\\\(name\)"\.utf8\)/);
});
