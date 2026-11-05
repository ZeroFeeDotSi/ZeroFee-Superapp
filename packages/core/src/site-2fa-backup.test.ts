// A site's two-factor backup with the 24 words (decision G): sealed in the core under keys from the hot root, kept
// by the relay's sealed keep (apps/quotes/keep.mjs) as ciphertext, and found again from the same words only. Hermetic:
// the relay in process with its memory store, reached through a fetch that never leaves this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRelay } from "../../../apps/quotes/relay.mjs";
import { memoryCounter } from "../../../apps/quotes/guards.mjs";
import { memoryKeep } from "../../../apps/quotes/keep.mjs";
import { backUpCode, forgetCode, keepKeys, openKept, readKeep, restoreCode, sealKept, type KeptCode } from "./site-2fa-backup.ts";
import { DemoCore } from "./demo-core.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { seedToWords, wordsToSeed } from "./recovery-words.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const BASE = "https://relay.example";
const entry = (secretHex = "3132333435363738393031323334353637383930"): KeptCode => ({ secretHex, algorithm: "SHA1", digits: 6, period: 30, issuer: "GMGN", account: "me", addedAt: 1 });

function relayWorld() {
  const store = memoryKeep();
  const seen: string[] = [];
  const relay = createRelay({ key: "k", secret: "s", origins: [], counter: memoryCounter(), keepStore: store });
  const fetchFn = async (url: string, init: RequestInit) => {
    seen.push(String(init.body));
    return relay(new Request(url, init), "10.0.0.1");
  };
  return { fetchFn, seen, store };
}

const rootOf = (seed = randomBytes(32)) => hotRoot(new Uint8Array(seed));

test("the same words find the same keep on a new phone: backed up, then restored with keys made again from the words", async () => {
  const w = relayWorld();
  const seed = randomBytes(32);
  const first = keepKeys(rootOf(seed));
  await backUpCode(BASE, first, "gmgn", entry(), w.fetchFn);
  const again = keepKeys(rootOf(seed));
  assert.equal(again.id, first.id);
  assert.deepEqual(await restoreCode(BASE, again, "gmgn", w.fetchFn), entry());
  assert.equal(await restoreCode(BASE, again, "pump.fun", w.fetchFn), null, "no entry for a site never backed up");
});

test("the relay sees ciphertext only: no secret, no site name, no issuer in anything it was sent", async () => {
  const w = relayWorld();
  const keys = keepKeys(rootOf());
  await backUpCode(BASE, keys, "gmgn", entry(), w.fetchFn);
  const all = w.seen.join("\n");
  for (const leak of ["3132333435", "gmgn", "GMGN", "SHA1", "\"me\""]) assert.ok(!all.includes(leak), `the relay was sent ${leak}`);
});

test("other words can't read it: another account's keys name another keep, and can't open this one's", async () => {
  const w = relayWorld();
  const mine = keepKeys(rootOf());
  const theirs = keepKeys(rootOf());
  await backUpCode(BASE, mine, "gmgn", entry(), w.fetchFn);
  assert.notEqual(theirs.id, mine.id);
  assert.equal(await readKeep(BASE, theirs, w.fetchFn), null);
  const sealed = sealKept(mine, { v: 1, sites: {} });
  assert.throws(() => openKept(theirs, sealed));
  assert.throws(() => openKept({ ...mine, id: theirs.id }, sealed), "the id is in the seal's AAD");
});

test("a request not signed by the keep's own key is refused (403), read or write", async () => {
  const w = relayWorld();
  const keys = keepKeys(rootOf());
  const other = keepKeys(rootOf());
  const t = Date.now();
  const res = await w.fetchFn(`${BASE}/v0/keep/${keys.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "get", t, sig: "00".repeat(64) }) });
  assert.equal(res.status, 403);
  // signed by another key for this id: refused
  await assert.rejects(readKeep(BASE, { ...other, id: keys.id }, w.fetchFn), /403/);
  await assert.rejects(backUpCode(BASE, { ...other, id: keys.id }, "gmgn", entry(), w.fetchFn), /403/);
});

test("a late or early proof is refused: a minute either way", async () => {
  const w = relayWorld();
  const keys = keepKeys(rootOf());
  await assert.rejects(readKeep(BASE, keys, w.fetchFn, () => Date.now() - 61_000), /400/);
  await assert.rejects(readKeep(BASE, keys, w.fetchFn, () => Date.now() + 61_000), /400/);
});

test("forget takes one site out and keeps the others", async () => {
  const w = relayWorld();
  const keys = keepKeys(rootOf());
  await backUpCode(BASE, keys, "gmgn", entry(), w.fetchFn);
  await backUpCode(BASE, keys, "pump.fun", entry("ab".repeat(20)), w.fetchFn);
  await forgetCode(BASE, keys, "gmgn", w.fetchFn);
  assert.equal(await restoreCode(BASE, keys, "gmgn", w.fetchFn), null);
  assert.equal((await restoreCode(BASE, keys, "pump.fun", w.fetchFn))?.secretHex, "ab".repeat(20));
});

test("only the two-factor sites' entries, with a plain secret and the RFC's settings", async () => {
  const w = relayWorld();
  const keys = keepKeys(rootOf());
  await assert.rejects(backUpCode(BASE, keys, "evil.example", entry(), w.fetchFn), /unknown site/);
  await assert.rejects(backUpCode(BASE, keys, "gmgn", { ...entry(), secretHex: "zz" }, w.fetchFn), /secret/);
  await assert.rejects(backUpCode(BASE, keys, "gmgn", { ...entry(), digits: 9 as 6 }, w.fetchFn), /length/);
});

/** A phone's core: the hot root of these words at rest, the relay in process, and the host's hooks as given. */
function phoneCore(w: ReturnType<typeof relayWorld>, words: string[], hooks: { changed?: boolean; stepUp?: boolean | null; typed?: string[] | null } = {}) {
  const vault = new MemoryVault();
  const asked = { stepUp: 0, typed: 0 };
  const core = new DemoCore({
    chain: new FakeChain(), vault, privateQuotes: BASE, siteCodes: true, prices: async () => ({ near: 4 }),
    approvalKey: { changed: async () => hooks.changed === true, reset: async () => undefined },
    ...(hooks.stepUp === null ? {} : { codesStepUp: async () => (asked.stepUp++, hooks.stepUp === true) }),
    typeWords: async (purpose) => (assert.equal(purpose, "codes"), asked.typed++, hooks.typed ?? null),
  });
  return { core, vault, asked, ready: vault.put(HOT_ROOT, hotRoot(wordsToSeed(words))) };
}

async function withRelayFetch<T>(w: ReturnType<typeof relayWorld>, run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => w.fetchFn(String(url), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const wordsA = seedToWords(new Uint8Array(randomBytes(32)));
const wordsB = seedToWords(new Uint8Array(randomBytes(32)));

test("the core answers site2fa.* only on the phone (siteCodes) and only with no app asking", async () => {
  const w = relayWorld();
  await withRelayFetch(w, async () => {
    const vault = new MemoryVault();
    await vault.put(HOT_ROOT, rootOf());
    const web = new DemoCore({ chain: new FakeChain(), vault, privateQuotes: BASE, prices: async () => ({ near: 4 }) });
    assert.ok("problem" in (await web.call("site2fa.backup", { site: "gmgn", entry: entry() })), "the web build's core has no site codes");
    const p = phoneCore(w, wordsA, { stepUp: true });
    await p.ready;
    for (const who of [{ app: "browser" }, { app: "trade" }, { caller: "browser" }]) {
      assert.ok("problem" in (await p.core.call("site2fa.restore", { sites: ["gmgn"], ...who })), `${JSON.stringify(who)} was answered`);
    }
    assert.deepEqual(await p.core.call("site2fa.backup", { site: "gmgn", entry: entry() }), { ok: { backedUp: true } });
    assert.deepEqual(await p.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: entry() } } });
    assert.deepEqual(await p.core.call("site2fa.forget", { site: "gmgn" }), { ok: { forgotten: true } });
    const empty = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), privateQuotes: BASE, siteCodes: true, prices: async () => ({ near: 4 }) });
    const noRoot = await empty.call("site2fa.backup", { site: "gmgn", entry: entry() });
    assert.ok("problem" in noRoot && noRoot.problem.code === "site2fa.no-words" && /24 words/.test(noRoot.problem.whatHappened), "no words' key here: said so");
  });
});

test("review MUST 1: the chip key refused (faces changed) and no words typed: nothing comes back", async () => {
  const w = relayWorld();
  await withRelayFetch(w, async () => {
    const setUp = phoneCore(w, wordsA, { stepUp: true });
    await setUp.ready;
    await setUp.core.call("site2fa.backup", { site: "gmgn", entry: entry() });
    const p = phoneCore(w, wordsA, { changed: true, stepUp: true, typed: null });
    await p.ready;
    assert.deepEqual(await p.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: null }, declined: true } });
    assert.equal(p.asked.stepUp, 0, "a Face ID with a refused key never counts");
    assert.equal(p.asked.typed, 1, "the words were asked for");
    const other = phoneCore(w, wordsA, { changed: true, typed: wordsB });
    await other.ready;
    assert.deepEqual(await other.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: null }, declined: true } }, "another account's words");
    const right = phoneCore(w, wordsA, { changed: true, typed: wordsA });
    await right.ready;
    assert.deepEqual(await right.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: entry() } } }, "this account's words");
  });
});

test("review MUST 1: with today's faces, a fresh Face ID with the account's key, or nothing", async () => {
  const w = relayWorld();
  await withRelayFetch(w, async () => {
    const setUp = phoneCore(w, wordsA, { stepUp: true });
    await setUp.ready;
    await setUp.core.call("site2fa.backup", { site: "gmgn", entry: entry() });
    const no = phoneCore(w, wordsA, { stepUp: false });
    await no.ready;
    assert.deepEqual(await no.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: null }, declined: true } });
    assert.equal(no.asked.typed, 0, "a no to Face ID never falls back to anything");
    const yes = phoneCore(w, wordsA, { stepUp: true });
    await yes.ready;
    assert.deepEqual(await yes.core.call("site2fa.restore", { sites: ["gmgn", "pump.fun"] }), { ok: { entries: { gmgn: entry(), "pump.fun": null } } });
    const noHook = phoneCore(w, wordsA, { stepUp: null, typed: null });
    await noHook.ready;
    assert.deepEqual(await noHook.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: null }, declined: true } }, "no step-up: the words or nothing");
  });
});

test("review MUST 1: nothing kept for these words: nothing asked (no Face ID, no words)", async () => {
  const w = relayWorld();
  await withRelayFetch(w, async () => {
    const p = phoneCore(w, wordsA, { stepUp: true, typed: wordsA });
    await p.ready;
    assert.deepEqual(await p.core.call("site2fa.restore", { sites: ["gmgn"] }), { ok: { entries: { gmgn: null } } });
    assert.deepEqual(p.asked, { stepUp: 0, typed: 0 });
  });
});

test("a backup that doesn't answer says so, and says the code is still on the phone", async () => {
  const p = phoneCore(relayWorld(), wordsA, { stepUp: true });
  await p.ready;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 502 })) as typeof fetch;
  try {
    const r = await p.core.call("site2fa.backup", { site: "gmgn", entry: entry() });
    assert.ok("problem" in r && r.problem.code === "site2fa.unreachable" && /still on this phone/.test(r.problem.whatHappened));
  } finally {
    globalThis.fetch = realFetch;
  }
});
