// The web wallet's backup-words practice (product decision, 5 Nov): the password first, then the 24 typed words compared inside the
// core; only { matches } goes back, and only a match is recorded (checkedAt). showWords records shownAt. The later
// "Forget this browser" needs both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { seedToWords } from "./recovery-words.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { WEB_WORDS_CHECKED, WEB_WORDS_SHOWN } from "./web-wallet.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const PASSWORD = "correct horse battery";
const WORDS = seedToWords(new Uint8Array(32).map((_, i) => i + 1));
const OTHER = seedToWords(new Uint8Array(32).fill(7));

async function made(o: { waitMs?: () => number } = {}) {
  const vault = new MemoryVault();
  const tries: string[] = [];
  let clock = 1_000;
  const core = new DemoCore({
    chain: new FakeChain(), vault, policyWasm: async () => rulesWasm, secretsInMemory: true,
    webWallet: {
      passwordOk: async (p) => {
        const w = o.waitMs?.() ?? 0;
        if (w > 0) return { waitMs: w };
        tries.push(p);
        return p === PASSWORD;
      },
      now: () => clock,
    },
  });
  ok(await core.call("account.web.import", { words: WORDS }));
  return { core, vault, tries, tick: (ms: number) => { clock += ms; } };
}
const read = (core: DemoCore) => core.call<{ shownAt: number | null; checkedAt: number | null }>("account.web.wordsChecked", {});

test("checkWords: the right 24 words answer { matches: true } and record checkedAt; nothing else comes back", async () => {
  const { core, vault } = await made();
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: null }, "a new wallet: never shown, never checked");
  const r = await core.call("account.web.checkWords", { password: PASSWORD, words: WORDS.map((w) => ` ${w.toUpperCase()} `) });
  assert.deepEqual(ok(r), { matches: true }, "typed case and spaces don't matter");
  for (const w of WORDS) assert.ok(!JSON.stringify(r).includes(w), "the answer never holds a word");
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: 1_000 });
  assert.equal(new TextDecoder().decode((await vault.get(WEB_WORDS_CHECKED))!), "1000", "kept in the vault beside the words");
});

test("checkWords: words that don't match answer false and record nothing; one word swapped is a no too", async () => {
  const { core, vault } = await made();
  const swapped = [...WORDS];
  [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
  for (const words of [OTHER, swapped, [...WORDS.slice(0, 23), OTHER[0]!]]) {
    const r = await core.call("account.web.checkWords", { password: PASSWORD, words });
    assert.deepEqual(ok(r), { matches: false });
    for (const w of WORDS) assert.ok(!JSON.stringify(r).includes(w), "a no never holds the kept words");
  }
  assert.equal(await vault.get(WEB_WORDS_CHECKED), null);
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: null });
});

test("checkWords: a wrong or missing password is refused like showWords (counted), the words never compared, nothing recorded", async () => {
  const { core, vault, tries } = await made();
  assert.equal(code(await core.call("account.web.checkWords", { password: "wrong password", words: WORDS })), "security.web.password");
  assert.equal(code(await core.call("account.web.checkWords", { words: WORDS })), "security.web.password");
  assert.equal(code(await core.call("account.web.checkWords", { password: "wrong password" })), "security.web.password", "the password step alone too");
  assert.deepEqual(tries, ["wrong password", "wrong password"], "each typed password went to the lock's own counted check");
  assert.equal(await vault.get(WEB_WORDS_CHECKED), null);
  // an app (a site's page) never reaches it, password or not
  assert.equal(code(await core.call("account.web.checkWords", { password: PASSWORD, words: WORDS, app: "browser" })), "security.request.not-allowed");
  assert.equal(code(await core.call("account.web.wordsChecked", { app: "agent" })), "security.request.not-allowed");
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: null });
});

test("checkWords: during a wrong-password wait every try gets the wait, the right password and words too; nothing checked", async () => {
  let waitMs = 30_000;
  const { core, tries } = await made({ waitMs: () => waitMs });
  assert.equal(code(await core.call("account.web.checkWords", { password: PASSWORD, words: WORDS })), "security.web.wait");
  assert.equal(code(await core.call("account.web.checkWords", { password: PASSWORD })), "security.web.wait");
  assert.deepEqual(tries, []);
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: null });
  waitMs = 0;
  assert.deepEqual(ok(await core.call("account.web.checkWords", { password: PASSWORD, words: WORDS })), { matches: true });
});

test("checkWords: the password step alone answers { ready: true } and records nothing; a bad word list is refused", async () => {
  const { core } = await made();
  assert.deepEqual(ok(await core.call("account.web.checkWords", { password: PASSWORD })), { ready: true });
  for (const words of [WORDS.slice(0, 23), [...WORDS.slice(0, 23), 5], "abandon", null]) {
    assert.equal(code(await core.call("account.web.checkWords", { password: PASSWORD, words })), "security.request.invalid", JSON.stringify(words)?.slice(0, 20));
  }
  assert.deepEqual(ok(await read(core)), { shownAt: null, checkedAt: null });
});

test("showWords records shownAt (a refused one doesn't); a later check keeps it and adds checkedAt", async () => {
  const { core, vault, tick } = await made();
  assert.equal(code(await core.call("account.web.showWords", { password: "nope nope" })), "security.web.password");
  assert.equal(await vault.get(WEB_WORDS_SHOWN), null);
  tick(500);
  ok(await core.call("account.web.showWords", { password: PASSWORD }));
  assert.deepEqual(ok(await read(core)), { shownAt: 1_500, checkedAt: null });
  tick(500);
  ok(await core.call("account.web.checkWords", { password: PASSWORD, words: OTHER }));
  assert.deepEqual(ok(await read(core)), { shownAt: 1_500, checkedAt: null }, "a no changes neither");
  ok(await core.call("account.web.checkWords", { password: PASSWORD, words: WORDS }));
  assert.deepEqual(ok(await read(core)), { shownAt: 1_500, checkedAt: 2_000 });
});

test("control: without webWallet (the phone, the Sim) there is no checkWords or wordsChecked", async () => {
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => rulesWasm });
  for (const m of ["account.web.checkWords", "account.web.wordsChecked"]) {
    assert.equal(code(await core.call(m, { password: PASSWORD, words: WORDS })), "security.method.unknown", m);
  }
});
