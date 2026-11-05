// Audit CORE-01 (independent core + iOS audit of 18ad8d6; its PoC, kept here and FIXED). On the phone the backup words
// show and are checked on ZeroFee's own screen. recovery.confirm and recovery.renewConfirm took {positions, words} from
// their caller and the refusal named the wrong position: a page that never saw the words had a per-position oracle while
// the seed was in memory (and a declined backup or renew left it there).
// Fixed: with the native screen, both are refused from a caller (the core, and the phone's own list of what the page may
// call); the native check's refusal names no position; a declined backup leaves memory, a declined renew is forgotten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoCore } from "./demo-core.ts";
import type { BridgeResult } from "./bridge.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const field = (r: BridgeResult<unknown>) => ("problem" in r ? (r.problem.next as { field?: string }).field ?? r.problem.code : "ok");

test("CORE-01: on the phone, recovery.confirm is refused to a caller, so a page learns nothing about the words", async () => {
  const chain = new FakeChain();
  let shownWords: string[] = [];
  // The native words screen (Swift). Here the person opens it and cancels (returns null), as demo-core.ts:1496 allows.
  const core = new DemoCore({
    chain,
    vault: new MemoryVault(),
    policyWasm: async () => rulesWasm,
    createAccount: async (id, pk) => chain.fund(id, pk),
    prices: async () => ({ near: 4 }),
    protection: [{ up_to: null, level: "FaceId" }],
    watchIntervalMs: 60_000,
    showWords: async (words) => ((shownWords = [...words]), null), // person cancels the native screen
    typeWords: async () => null,
  });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));

  await core.call("account.create");
  // The person opens the backup screen and cancels: backupDeclined, but backupSeed stays set (demo-core.ts:1495-1497).
  const opened = await core.call("recovery.backup", {});
  assert.equal("problem" in opened ? opened.problem.code : "ok", "security.backup.declined");
  assert.equal(shownWords.length, 24, "the native screen was the only place the words appeared");

  // recovery.words is correctly refused to the page on the phone...
  assert.equal(field(await core.call("recovery.words")), "security.request.not-allowed");

  // SECURE PROPERTY (fails on 18ad8d6): a caller that never saw the words must learn nothing from recovery.confirm.
  // Today the page reaches confirm and the refusal names the first wrong position, so these two guesses -- wrong at
  // position 1 vs wrong only at position 2 -- come back naming different positions (a per-position oracle). The fix is
  // to refuse confirm/renewConfirm from the page while a native words screen is set, or to stop naming the position.
  const wrongAt1 = field(await core.call("recovery.confirm", { positions: [1, 2, 3], words: ["zoo", shownWords[1], shownWords[2]] }));
  const wrongAt2 = field(await core.call("recovery.confirm", { positions: [1, 2, 3], words: [shownWords[0], "zoo", shownWords[2]] }));

  // On the phone, confirm from the page should be refused like recovery.words is -- not answered with a position.
  assert.equal(wrongAt1, "security.request.not-allowed", "confirm from the page should be refused on the phone, but it answered: " + wrongAt1);
  assert.equal(wrongAt1, wrongAt2, "the page must not learn which position its guess was wrong at");
});

test("CORE-01: new words on the phone: renewConfirm refused to a caller, a declined renew forgets them, a wrong word isn't named", async () => {
  const chain = new FakeChain();
  let shown: string[] = [];
  let answer: "cancel" | "wrong" = "cancel";
  const core = new DemoCore({
    chain,
    vault: new MemoryVault(),
    policyWasm: async () => rulesWasm,
    createAccount: async (id, pk) => chain.fund(id, pk),
    prices: async () => ({ near: 4 }),
    protection: [{ up_to: null, level: { Wait: { seconds: "120" } } }],
    watchIntervalMs: 60_000,
    // The native screen: the first time it checks the set-up words; then, for new words, as `answer` says.
    showWords: async (words, _kid, renew) => {
      shown = [...words];
      if (!renew) return { positions: [1, 2, 3], words: words.slice(0, 3) };
      return answer === "cancel" ? null : { positions: [1, 2, 3], words: ["zoo", words[1]!, words[2]!] };
    },
    typeWords: async () => null,
  });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  await core.call("account.create");
  assert.ok("ok" in (await core.call("recovery.backup", {})));

  assert.equal(field(await core.call("recovery.renew")), "security.words.renew-declined");
  const first = shown;
  assert.equal(field(await core.call("recovery.renewConfirm", { positions: [1, 2, 3], words: first.slice(0, 3) })), "security.request.not-allowed", "never from a caller");
  assert.equal(field(await core.call("recovery.renew")), "security.words.renew-declined");
  assert.notDeepEqual(shown, first, "declined new words are forgotten: the next ask makes new ones");

  answer = "wrong";
  const wrong = await core.call("recovery.renew");
  assert.ok("problem" in wrong && wrong.problem.code === "security.words.wrong");
  assert.equal((wrong as any).problem.next.kind, "retry", "which word was wrong isn't said");
  assert.doesNotMatch((wrong as any).problem.whatHappened, /\d/);
});

