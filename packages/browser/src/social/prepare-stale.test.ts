// the audit's MUST on A2-3 (8 Nov): Home's reads started early go stale when the page makes the sites' wallets, on the REAL
// core (whose subwallet.create announces nothing Home hears), not only on the Sim's MockBridge event. Control: no wallet
// made, Home takes its early reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps, type BridgeResult } from "@zerofee/core/bridge";
import { DemoCore } from "@zerofee/core/demo-core";
import type { SolChain } from "@zerofee/core/solana";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { MemoryVault } from "@zerofee/core/vault";
import { kickEarly, takeHomeReads } from "@zerofee/wallet/app/home-keep.ts";
import { prepareSites } from "./prepare.ts";

const wasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

async function readyCore() {
  const chain = new FakeChain();
  const sol: SolChain = { blockhashValid: async () => true, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n, tokens: [] }), lookupTables: async () => [] };
  const core = new DemoCore({ chain, vault: new MemoryVault(), sol, nativeUsd: async () => 150, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  let settingUp = true;
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: settingUp }));
  const ok = <T,>(r: BridgeResult<T>): T => { if ("problem" in r) assert.fail(r.problem.whatHappened); return r.ok; };
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  settingUp = false;
  return core;
}

/** Home's bridge: counts its spending.status asks (one per round of Home's reads). */
function homeBridge() {
  let asked = 0;
  const b = { call: async (m: string) => { if (m === "spending.status") asked += 1; return { problem: { code: "mock.unknown" } }; }, on: () => () => {} };
  return { b: b as never, asked: () => asked };
}

test("the sites' wallets made through the real core: Home's early reads are dropped and read afresh (control: nothing made, they're kept)", async () => {
  const core = await readyCore();
  const home = homeBridge();
  kickEarly(home.b, 1_000);
  const early = home.asked();
  const made = await prepareSites(forApps(core, "social"));
  assert.ok(made.length > 0, "pump.fun's and GMGN's wallets made by the core");
  takeHomeReads(home.b, 2_000);
  assert.equal(home.asked(), early + 1, "Home asks again: its early reads didn't list the new wallets");

  const still = homeBridge();
  kickEarly(still.b, 1_000);
  const before = still.asked();
  takeHomeReads(still.b, 2_000);
  assert.equal(still.asked(), before, "control: nothing made since, Home takes its early reads");
  const refused = homeBridge();
  kickEarly(refused.b, 1_000);
  const was = refused.asked();
  const none = await prepareSites({ call: async () => ({ problem: { code: "security.request.not-allowed" } }), on: () => () => {} } as never);
  takeHomeReads(refused.b, 2_000);
  assert.deepEqual([none, refused.asked()], [[], was], "control: a refused make marks nothing");
});
