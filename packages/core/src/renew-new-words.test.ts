// QA sd-security (a), (b) (QA, 4 Nov): "Get new words" must never show the account's own words as new, and the
// words change only with the person's strong check (Face ID on the phone, the passkey on the web), held here in the core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { ACCOUNT_POLICY } from "./known-contracts.ts";
import { SoftwareKey } from "./device-key.ts";
import { wordsToSeed } from "./recovery-words.ts";
import { SHOW_NEW_WORDS } from "./show-new-words.ts";

const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};

async function ready(stepUp: () => Promise<boolean>) {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const core = new DemoCore({ chain, vault, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, protection: HOLD_ABOVE_5_NEAR, userVerified: async () => true, safeStepUp: stepUp });
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    shown.push(words);
    void core.call("approval.answer", { id, approve: true });
  });
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const recoveryKeys = () => [...chain.accounts.get(accountId)!.keys.entries()].filter(([, k]) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.recoveryKeyMethods.join()).map(([pk]) => String(pk)).sort();
  return { chain, vault, core, shown, accountId, words, recoveryKeys };
}
const three = (w: string[]) => ({ positions: [2, 7, 19], words: [w[1], w[6], w[18]] });

test("new words are never the account's own words; asked twice before the check, the same new set (control)", async () => {
  const { core, words } = await ready(async () => true);
  try {
    const fresh = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
    assert.equal(fresh.length, 24);
    assert.notDeepEqual(fresh, words, "new words differ from the old ones");
    assert.ok(fresh.filter((w, i) => w === words[i]).length < 6, "not the old set with a word or two changed");
    assert.deepEqual(ok(await core.call<{ words: string[] }>("recovery.renew")).words, fresh, "control: asked again, the same new words");
  } finally {
    core.close();
  }
});

test("without the strong check, nothing changes: no change asked, the old words still the backup key; with it, the change waits (control)", async () => {
  // the words were shown with the check; the change's own check fails
  let checks = 0;
  const no = await ready(async () => checks++ === 0);
  try {
    const before = no.recoveryKeys();
    const fresh = ok(await no.core.call<{ words: string[] }>("recovery.renew")).words;
    const r = await no.core.call<TxOutcome>("recovery.renewConfirm", three(fresh));
    const refused = "problem" in r ? r.problem.code : r.ok.status === "problem" ? r.ok.problem.code : r.ok.status;
    assert.notEqual(refused, "waiting");
    assert.notEqual(refused, "done");
    assert.equal(no.shown.at(-1)!.title, "Replace your backup words", "the sheet asked");
    assert.deepEqual(ok(await no.core.call<unknown[]>("account.waiting")), [], "no change waits");
    assert.deepEqual(no.recoveryKeys(), before, "the backup key is the old words' one");
  } finally {
    no.core.close();
  }
  const yes = await ready(async () => true);
  try {
    const fresh = ok(await yes.core.call<{ words: string[] }>("recovery.renew")).words;
    assert.equal(ok(await yes.core.call<TxOutcome>("recovery.renewConfirm", three(fresh))).status, "waiting", "control: with the check, the change is asked");
    assert.equal(ok(await yes.core.call<unknown[]>("account.waiting")).length, 1);
  } finally {
    yes.core.close();
  }
});

test("a change that ran with no mark kept (an old crash): its words are never shown again as new, and the hot wallets move to them", async () => {
  const { chain, vault, core, recoveryKeys } = await ready(async () => true);
  try {
    const before = recoveryKeys();
    const ran = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
    assert.equal(ok(await core.call<TxOutcome>("recovery.renewConfirm", three(ran))).status, "waiting");
    let renewed = 0;
    core.on("recovery.renewed", () => renewed++);
    chain.skewSeconds = 121;
    const realNow = Date.now;
    Date.now = () => realNow() + 121_000;
    try {
      const held = ok(await core.call<{ id: string }[]>("account.waiting"));
      // the mark lost, as a crash between the change and its mark left it before this fix
      await vault.delete("renew-asked-ms");
      assert.equal(ok(await core.call<TxOutcome>("account.waiting.run", { id: held[0]!.id })).status, "done");
      assert.notDeepEqual(recoveryKeys(), before, "the change ran: the account's backup key is now those words'");
      const next = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
      assert.notDeepEqual(next, ran, "the words already in are not shown as new");
      assert.equal(renewed, 1, "the change is followed: the hot wallets move to the words that are in");
    } finally {
      Date.now = realNow;
    }
  } finally {
    core.close();
  }
});

test("QA's SHOULD: kept new words whose key is on NEAR, but not as the account's backup key: not marked, nothing moves, not shown again (control: as the backup key, followed)", async () => {
  for (const asBackup of [false, true]) {
    const { chain, vault, core, accountId } = await ready(async () => true);
    try {
      const sol = ok(await core.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol", slot: 0 }));
      const shown = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
      const key = SoftwareKey.fromSeed(wordsToSeed(shown), "recovery-words");
      const permission = asBackup
        ? { kind: "function-call" as const, receiverId: accountId, methods: [...ACCOUNT_POLICY.recoveryKeyMethods], allowanceYocto: null }
        : { kind: "function-call" as const, receiverId: accountId, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: null };
      chain.accounts.get(accountId)!.keys.set(key.publicKey, { nonce: 0n, permission });
      key.destroy();
      let renewed = 0;
      core.on("recovery.renewed", () => renewed++);
      const next = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
      assert.notDeepEqual(next, shown, "never shown again as new");
      const old = ok(await core.call<{ id: string; oldWords?: true }[]>("subwallet.list")).find((w) => w.id === sol.id)!;
      if (asBackup) {
        assert.equal(renewed, 1, "control: as the backup key, the change is followed");
        assert.equal(old.oldWords, true, "control: the hot wallets moved");
      } else {
        assert.equal(renewed, 0, "nothing marked");
        assert.equal(old.oldWords, undefined, "nothing moved: the hot wallets are the old words' still");
        assert.ok(await vault.get("renew-words-aside"), "the words kept aside, not lost");
      }
    } finally {
      core.close();
    }
  }
});

test("QA's real lap (k-trade3): no strong check, no new words leave the core; with it, they do (control)", async () => {
  const no = await ready(async () => false);
  try {
    const r = await no.core.call<{ words?: string[] }>("recovery.renew");
    assert.ok("problem" in r, "refused");
    assert.ok(!JSON.stringify(r).match(/"words":\[/), "no words in the answer, so none on the page");
    assert.equal(no.shown.at(-1)!.title, SHOW_NEW_WORDS.title, "the check was asked before any word");
    assert.deepEqual(ok(await no.core.call<unknown[]>("account.waiting")), [], "nothing changed");
  } finally {
    no.core.close();
  }
  const yes = await ready(async () => true);
  try {
    const before = yes.shown.length;
    const fresh = ok(await yes.core.call<{ words: string[] }>("recovery.renew")).words;
    assert.equal(fresh.length, 24, "control: with the check, the words come");
    assert.equal(yes.shown[before]!.title, SHOW_NEW_WORDS.title, "the check came first");
    // asked again after a no: the same set, never a second one
    let n = 0;
    const again = await ready(async () => n++ > 0);
    try {
      assert.ok("problem" in (await again.core.call("recovery.renew")));
      const second = ok(await again.core.call<{ words: string[] }>("recovery.renew")).words;
      assert.equal(second.length, 24);
    } finally {
      again.core.close();
    }
  } finally {
    yes.core.close();
  }
});
