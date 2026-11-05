// Audit (core integrity, finding 4): the recovery-only contract (contracts/recovery-policy) gives the phone a full-access
// key, and its recovery leaves the old phone's key on the account. ZeroFee never installs it any more: set-up refuses its
// build on every network, nothing is sent. Accounts that already run it are still read, and every place that names it
// says it is old.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { RECOVERY_POLICY, isRecoveryPolicy, ownAccountCall } from "./known-contracts.ts";
import { activityItem } from "./activity.ts";

const legacy = new Uint8Array(readFileSync(new URL("../../../contracts/recovery-policy/release/recovery_policy.wasm", import.meta.url)));
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");

test("set-up refuses the recovery-only contract on every network: no account, nothing sent", async () => {
  for (const network of ["testnet", "mainnet"] as const) {
    const chain = new FakeChain(network);
    const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => legacy, ...(network === "testnet" ? { createAccount: async (id: string, pk: string) => chain.fund(id, pk) } : {}), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, ...(network === "mainnet" ? { intentsSalt: null } : {}) });
    try {
      assert.equal(code(await core.call("account.create", network === "testnet" ? {} : { fund: "self" })), "security.build.mismatch", network);
      assert.equal(chain.accounts.size, 0, `${network}: no account`);
      assert.equal(chain.sent.length, 0, `${network}: nothing sent`);
    } finally {
      core.close();
    }
  }
});

test("an account already on it is still recognised, and named as old wherever it is described", () => {
  assert.ok(isRecoveryPolicy(RECOVERY_POLICY.codeHashBase58), "control: still read");
  const turnOn = ownAccountCall("new", { delay_seconds: "86400" })!;
  assert.match(turnOn.title, /old/i, turnOn.title);
  assert.ok(turnOn.warnings?.some((w) => /old/i.test(w.text)), "a warning that says it's old");
  const deploy = activityItem({ hash: "h", atIso: new Date(0).toISOString(), signerId: "a.testnet", signerKey: "ed25519:x", receiverId: "a.testnet", actions: [{ kind: "deploy", codeSha256Hex: RECOVERY_POLICY.sha256Hex } as never], ok: true }, [], "", "testnet").title;
  assert.match(deploy, /old/i, deploy);
});

test("no tool sets an account up on the old recovery-only contract (it would be refused: security.build.mismatch)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../../../tools/", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === "node_modules") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") || p.endsWith(".mjs")) files.push(p);
    }
  };
  walk(root);
  // A tool that loads recovery_policy.wasm AND builds a DemoCore hands it to set-up as policyWasm.
  const bad = files.filter((f) => {
    const s = readFileSync(f, "utf8");
    return s.includes("recovery_policy.wasm") && s.includes("new DemoCore(");
  });
  assert.deepEqual(bad.map((f) => f.slice(root.length)), []);
});
