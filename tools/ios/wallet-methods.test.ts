// The phone's wallet-mode handler (PartnerWallet.swift) answers only the methods it lists, by name. Those names must be
// the ones provider.js posts: the App Store review (30 Oct) found the Swift list naming Solana's methods "solana_connect"
// while the provider posts the Wallet Standard's "solana:connect", so every Solana request on the iPhone was refused
// (fail closed, but no App Store app could connect). Swift has no test target here, so this reads the Swift source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const wallet = read("apps/ios/ZeroFee/PartnerWallet.swift");
const rules = read("apps/ios/ZeroFee/HostRules.swift");
const provider = read("packages/browser/src/provider/provider.js");
const engine = read("packages/browser/src/engine/engine.ts");

/** The string literals of a Swift `static let <name>: Set<String> = [ ... ]`. */
function swiftSet(src: string, name: string): Set<string> {
  const m = new RegExp(`static let ${name}: Set<String> = \\[([\\s\\S]*?)\\n?\\s*\\]`).exec(src);
  assert.ok(m, `static let ${name} not found`);
  return new Set([...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
}

const allowed = swiftSet(wallet, "allowed");
const signs = swiftSet(rules, "signs");
const solanaCalls = [...provider.matchAll(/call\("(solana:[A-Za-z]+)"/g)].map((m) => m[1]!);

test("every Solana method provider.js posts is one the phone's handler answers, by the same name", () => {
  assert.ok(solanaCalls.length >= 5, `found only ${solanaCalls.join(", ")}`);
  for (const m of solanaCalls) assert.ok(allowed.has(m), `${m} is posted by provider.js but PartnerWallet.allowed doesn't list it`);
});

test("every Solana name the phone lists is one provider.js posts and the engine answers (no dead names)", () => {
  for (const m of allowed) {
    if (!m.startsWith("solana")) continue;
    assert.ok(solanaCalls.includes(m), `${m} is in PartnerWallet.allowed but provider.js never posts it`);
    assert.ok(engine.includes(`case "${m}":`), `${m} is in PartnerWallet.allowed but the engine has no case for it`);
  }
});

test("the methods that sign are one list (WalletGate.signs), all answered, Solana's three among them", () => {
  assert.match(wallet, /static let needsConnection: Set<String> = WalletGate\.signs/);
  for (const m of signs) assert.ok(allowed.has(m), `${m} signs but isn't allowed`);
  for (const m of ["solana:signMessage", "solana:signTransaction", "solana:signAndSendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]) assert.ok(signs.has(m), `${m} missing from WalletGate.signs`);
  assert.doesNotMatch(wallet + rules, /"solana_/, "no underscore Solana names are left");
});

test("connecting on Solana is a connect for the host's gate", () => {
  assert.ok(swiftSet(wallet, "connects").has("solana:connect"));
});
