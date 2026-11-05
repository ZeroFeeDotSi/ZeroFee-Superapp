// Turning approvals back on after Face ID changed (audit IOS-1b, recovery.rearm): only with this account's 24 words,
// typed on the phone's own screen; five wrong tries lock it for 15 minutes; `thenRecover` starts the account key's move
// to this phone with the same words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoCore } from "./demo-core.ts";
import type { BridgeResult } from "./bridge.ts";
import { seedToWords } from "./recovery-words.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");

async function phone() {
  const chain = new FakeChain();
  let words: string[] = [];
  let typed: string[] | null = null;
  const face = { changed: true, resets: 0 };
  const core = new DemoCore({
    chain,
    vault: new MemoryVault(),
    policyWasm: async () => rulesWasm,
    createAccount: async (id, pk) => chain.fund(id, pk),
    prices: async () => ({ near: 4 }),
    protection: [{ up_to: null, level: "FaceId" }],
    watchIntervalMs: 60_000,
    indexRetryMs: 1,
    showWords: async (w) => ((words = [...w]), { positions: [1, 2, 3], words: w.slice(0, 3) }),
    typeWords: async () => typed,
    approvalKey: { changed: async () => face.changed, reset: async () => void face.resets++ },
  });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  await core.call("account.create");
  assert.equal(code(await core.call("recovery.backup", {})), "ok");
  return { core, chain, face, words: () => words, type: (w: string[] | null) => (typed = w) };
}

test("approvals come back only with this account's words; nothing to do while Face ID is as it was", async () => {
  const p = await phone();
  p.face.changed = false;
  assert.equal(code(await p.core.call("recovery.rearm")), "security.faceid.unchanged");
  p.face.changed = true;
  p.type(seedToWords(crypto.getRandomValues(new Uint8Array(32)))); // real words, someone else's
  assert.equal(code(await p.core.call("recovery.rearm")), "security.words.wrong");
  p.type(null);
  assert.equal(code(await p.core.call("recovery.rearm")), "security.words.stopped");
  assert.equal(p.face.resets, 0);
  p.type(p.words());
  const ok = await p.core.call<{ rearmed: true }>("recovery.rearm");
  assert.deepEqual("ok" in ok && ok.ok, { rearmed: true });
  assert.equal(p.face.resets, 1, "a new approval key");
  p.type(null);
  assert.equal(code(await p.core.call("recovery.rearm", { words: p.words() })), "security.words.stopped", "a caller's words are never used: only the screen's");
});

test("five wrong tries lock it for 15 minutes, even for the right words", async () => {
  const p = await phone();
  p.type(seedToWords(crypto.getRandomValues(new Uint8Array(32))));
  for (let i = 0; i < 5; i++) assert.equal(code(await p.core.call("recovery.rearm")), "security.words.wrong", `try ${i + 1}`);
  p.type(p.words());
  const locked = await p.core.call("recovery.rearm");
  assert.equal(code(locked), "security.rearm.locked");
  assert.equal(p.face.resets, 0);
  const realNow = Date.now;
  Date.now = () => realNow() + 15 * 60_000 + 1;
  try {
    assert.equal(code(await p.core.call("recovery.rearm")), "ok", "after the wait");
  } finally {
    Date.now = realNow;
  }
});

test("thenRecover: the same words also start moving the account key to this phone; it forgets its account meanwhile", async () => {
  const p = await phone();
  p.type(p.words());
  const r = await p.core.call<{ rearmed: true; readyAtIso: string }>("recovery.rearm", { thenRecover: true });
  assert.ok("ok" in r && r.ok.rearmed && Date.parse(r.ok.readyAtIso) > Date.now(), JSON.stringify(r));
  assert.equal(p.face.resets, 1);
  const state = await p.core.call<{ stage: string }>("account.state");
  assert.equal("ok" in state && state.ok.stage, "recovering");
});
