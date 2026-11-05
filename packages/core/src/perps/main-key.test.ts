// D119 + D111 (review, 3 Nov): the Hyperliquid account is a DEDICATED key from the words (service.ts PERPS_PATH,
// m/44'/60'/86'/0/0), never a row's key: a row's address is public on its chain and reusing it would link the perps
// account to it. Its address must never equal any wallet the words make (control: the check finds the Robinhood row's
// own key among them, so it can fail).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { evmAddress } from "../evm.ts";
import { HOT_ROOT, bip32Secp256k1, hotPath, hotRoot, hotSecret } from "../hot-keys.ts";
import { PERPS_PATH, perpsMainKey } from "./service.ts";
import { solAddress } from "../solana.ts";
import { SubWallets } from "../subwallets.ts";
import { MemoryVault } from "../vault.ts";
import type { EvmChain } from "../evm.ts";
import type { SolChain } from "../sol/chain.ts";

const EVM = ["bsc", "hood", "eth", "base", "gnosis", "arb"];
const KINDS = ["trade", "browser", "pay", "site"];

/** Every address the words make for a wallet of any kind, chain and slot (the rows, Trade's slots, Apps, sites, card). */
function everyWalletAddress(root: Uint8Array): Set<string> {
  const out = new Set<string>();
  for (const kind of KINDS) for (let slot = 0; slot < 16; slot++) {
    for (const chain of EVM) { const k = hotSecret(root, kind, chain, slot); if (k) out.add(evmAddress(k)); }
    const s = hotSecret(root, kind, "sol", slot);
    if (s) out.add(solAddress(s));
  }
  return out;
}

test("the perps key has its own path, whose account index no wallet uses (control: the rows' indices are found)", () => {
  assert.deepEqual(PERPS_PATH.map((s) => `${s.index}${s.hardened ? "'" : ""}`).join("/"), "44'/60'/86'/0/0");
  const used = new Set<number>();
  for (const kind of KINDS) for (const chain of EVM) used.add(hotPath(kind, chain)!.steps[2]!.index);
  assert.ok(used.has(1), "control: the Robinhood row's index (trade, hood) is in the set");
  assert.ok(!used.has(PERPS_PATH[2].index), "86 is no wallet's");
});

test("review L9: no wallet kind and EVM chain can grow into the perps account index (16·kind + chain stays under 86)", () => {
  const src = readFileSync(new URL("../hot-keys.ts", import.meta.url), "utf8");
  const max = (name: string) => {
    const body = new RegExp(`const ${name}: Record<string, number> = \\{([^}]*)\\}`).exec(src)?.[1] ?? "";
    return Math.max(...[...body.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1])));
  };
  const kinds = max("KIND_INDEX"), chains = max("EVM_INDEX");
  assert.ok(kinds >= 4 && chains >= 5, "control: the tables are read (site 4, arb 5)");
  assert.ok(16 * kinds + chains < PERPS_PATH[2].index, `16·${kinds} + ${chains} reaches the perps account ${PERPS_PATH[2].index}: move one of them`);
  assert.ok(chains < 16, "a chain index under 16 keeps kinds apart");
});

test("the perps address is never a wallet's address, for many words (control: a row's key IS found by the same check)", () => {
  for (let i = 0; i < 4; i++) {
    const root = hotRoot(randomBytes(32));
    const all = everyWalletAddress(root);
    const perps = evmAddress(bip32Secp256k1(root, PERPS_PATH));
    assert.ok(!all.has(perps), "the perps account links to no row");
    assert.ok(all.has(evmAddress(hotSecret(root, "trade", "hood")!)), "control: the Robinhood row's own address is in the set");
  }
});

test("the core's perps account (perpsMainKey) is the dedicated key, never a row's, never listed; no words, no perps account", async () => {
  const vault = new MemoryVault();
  const root = hotRoot(randomBytes(32));
  await vault.put(HOT_ROOT, root);
  const w = new SubWallets({ vault, sol: {} as SolChain, evm: {} as EvmChain, usdPrice: async () => 1, approve: async () => false, emit: () => {} });
  const rows = await Promise.all(["hood", "bsc"].map((c) => w.create("chain", c)));
  const key = perpsMainKey(vault);
  const perps = await key.mainAddress();
  assert.equal(perps, evmAddress(bip32Secp256k1(root, PERPS_PATH)));
  assert.equal(rows[0]!.address, evmAddress(hotSecret(root, "trade", "hood")!), "control: the row is the words' Robinhood key");
  assert.ok(!rows.some((r) => r.address === perps), "never a row's address");
  assert.ok(!(await w.list()).some((x) => x.address === perps), "never listed");
  let seen: Uint8Array | null = null;
  assert.equal(await key.withMainKey((secret, a) => ((seen = secret), a)), perps);
  assert.ok(seen && (seen as Uint8Array).every((b) => b === 0), "the key is zeroed after use");
  await assert.rejects(perpsMainKey(new MemoryVault()).mainAddress(), (e: any) => e.problem?.code === "perps.words.missing" && /Hyperliquid/.test(e.problem.whatHappened) && e.problem.money.where === "on Hyperliquid (test money)");
});
