// Audit (core integrity, finding 5): the Extension's fast-trading session holds its caps in dollars at the core's own
// price. A price of $0 (or one that isn't a number) used to skip the caps altogether: any perTx and total started. A
// price that isn't above zero is now no price, and no price starts no session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "./bridge.ts";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { readFileSync } from "node:fs";

const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));

const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");

async function extensionSession(price: number | null) {
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), nativeUsd: async () => price, watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 604_800 });
  try {
    const yes = core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
    void yes;
    assert.equal(code(await core.call("account.create")), "ok");
    const { words } = (await core.call<{ words: string[] }>("recovery.words") as { ok: { words: string[] } }).ok;
    assert.equal(code(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] })), "ok");
    // the Extension's wallet, as pairing makes it
    const ext = await (core as any).subwallets.add("extension", crypto.getRandomValues(new Uint8Array(32)), "extension", "Extension wallet");
    // 1,000 SOL a trade and in all: far past the caps at any real price
    return code(await forApps(core, "extension").call("subwallet.session.start", { id: ext.id, perTx: "1000000000000", total: "1000000000000", minutes: 15 }));
  } finally {
    core.close();
  }
}

test("a $0 price, or one that isn't a number, starts no Extension session: it fails closed, never skips the caps", async () => {
  for (const price of [0, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    assert.equal(await extensionSession(price), "security.partner.unreachable", String(price));
  }
});

test("controls: no price is refused as before, and a real price holds the caps", async () => {
  assert.equal(await extensionSession(null), "security.partner.unreachable");
  assert.equal(await extensionSession(150), "security.request.not-allowed", "1,000 SOL at $150 is past the caps");
});
