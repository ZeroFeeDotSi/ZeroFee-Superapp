// Audits K-2 and K-4: in a browser the backup words' seed is never at rest outside the unlock (and the new account's
// words never at rest at all), and the words' hot wallets keep no key in the vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { wordsToSeed } from "./recovery-words.ts";
import { hotRoot, hotSecret } from "./hot-keys.ts";
import { hostIndex } from "./site-hosts.ts";
import { evmAddress } from "./evm.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { BrowserVault, MemoryStore, VaultLockedError } from "./vault.ts";
import { UnlockSession, setUpPasscode } from "./unlock.ts";
import { ACCOUNT_POLICY } from "./known-contracts.ts";

/** Every byte string anywhere in a stored value, and whether one holds `secret` (a scan of what IndexedDB would hold). */
function blobs(value: unknown, out: Uint8Array[] = []): Uint8Array[] {
  if (value instanceof Uint8Array) out.push(value);
  else if (value instanceof ArrayBuffer) out.push(new Uint8Array(value));
  else if (value && typeof value === "object" && !(value instanceof CryptoKey)) for (const v of Object.values(value)) blobs(v, out);
  return out;
}
const within = (v: Uint8Array, secret: Uint8Array) => v.length >= secret.length && v.some((_, i) => secret.every((b, j) => v[i + j] === b));
const storeHolds = (store: MemoryStore, secret: Uint8Array) => [...store.items.values()].some((v) => blobs(v).some((b) => within(b, secret)));

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

async function browser(name = "zerofee-mainnet-vault") {
  const session = new UnlockSession();
  await setUpPasscode(session, "maple river 42");
  const store = new MemoryStore();
  return { session, store, vault: new BrowserVault(name, { session, store }) };
}
function newCore(chain: FakeChain, vault: BrowserVault, secretsInMemory = true) {
  return new DemoCore({ chain, vault, policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, secretsInMemory });
}
function sheet(core: Bridge) {
  let n = 0;
  core.on<{ id: string }>("approval.needed", ({ id }) => {
    n++;
    void core.call("approval.answer", { id, approve: true });
  });
  return () => n;
}
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
/** Every item the vault holds, decrypted (the unlock is open in these tests). */
async function plainItems(store: MemoryStore, vault: BrowserVault): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const k of store.items.keys()) if (k.startsWith("item:")) out.set(k.slice(5), (await vault.get(k.slice(5)))!);
  return out;
}
const recoveryKeys = (chain: FakeChain, accountId: string) =>
  [...chain.accounts.get(accountId)!.keys.values()].filter((k) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.recoveryKeyMethods.join()).length;
const holds = (items: Map<string, Uint8Array>, secret: Uint8Array) => [...items.values()].some((v) => within(v, secret));

test("set-up: the words' seed is never written anywhere, not even under the unlock, until the words are checked", async () => {
  const chain = new FakeChain();
  const { store, vault } = await browser();
  const core = newCore(chain, vault);
  const sheets = sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  assert.equal(recoveryKeys(chain, accountId), 0, "no backup key on chain for words no one has seen");
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  const seed = wordsToSeed(words);
  assert.equal(storeHolds(store, seed), false, "not in IndexedDB in the clear");
  assert.equal(store.items.has("item:pending-words"), false, "no pending-words item at all");
  assert.equal(holds(await plainItems(store, vault), seed), false, "nor inside any item under the unlock");
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  assert.equal(sheets(), 1, "the words' key goes on chain behind the sheet, at once");
  assert.equal(recoveryKeys(chain, accountId), 1);
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  assert.deepEqual(ok(await core.call<{ matches: boolean }>("recovery.check", { words })), { matches: true });
  assert.equal(storeHolds(store, seed), false);
  assert.equal(holds(await plainItems(store, vault), seed), false);
  assert.deepEqual(await vault.get("hot-root"), hotRoot(seed), "the hot wallets come from the words on paper");
  core.close();
});

test("set-up: a page closed before the words were checked leaves no key nobody wrote down; the words just change", async () => {
  const chain = new FakeChain();
  const { vault } = await browser();
  const first = newCore(chain, vault);
  const { accountId } = ok(await first.call<{ accountId: string }>("account.create"));
  const unseen = ok(await first.call<{ words: string[] }>("recovery.words")).words;
  first.close();
  const again = newCore(chain, vault);
  sheet(again);
  const { words } = ok(await again.call<{ words: string[] }>("recovery.words"));
  assert.notDeepEqual(words, unseen);
  ok(await again.call("recovery.confirm", { positions: [3, 4, 5], words: [words[2], words[3], words[4]] }));
  assert.equal(recoveryKeys(chain, accountId), 1);
  assert.deepEqual(ok(await again.call<{ matches: boolean }>("recovery.check", { words })), { matches: true });
  again.close();
});

test("set-up in a browser (J2: no Check later): the words' key goes on chain only once three are checked (one sheet)", async () => {
  const chain = new FakeChain();
  const { vault } = await browser();
  const core = newCore(chain, vault);
  const sheets = sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  assert.ok("problem" in (await core.call("recovery.later")), "no skipping the check");
  assert.equal(recoveryKeys(chain, accountId), 0, "nothing on chain before the check");
  ok(await core.call("recovery.confirm", { positions: [4, 11, 23], words: [words[3], words[10], words[22]] }));
  assert.equal(sheets(), 1);
  assert.equal(recoveryKeys(chain, accountId), 1);
  const state = ok(await core.call<{ stage: string; checkDue?: boolean }>("account.state"));
  assert.equal(state.stage, "ready");
  assert.deepEqual(ok(await core.call<{ matches: boolean }>("recovery.check", { words })), { matches: true });
  core.close();
});

test("restore: once it starts, the words' seed is in the vault under the unlock only, never in the clear; locked, unreadable", async () => {
  const chain = new FakeChain();
  const old = await browser();
  const phone = newCore(chain, old.vault);
  sheet(phone);
  ok(await phone.call("account.create"));
  const { words } = ok(await phone.call<{ words: string[] }>("recovery.words"));
  ok(await phone.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  phone.close();

  const fresh = await browser();
  const laptop = newCore(chain, fresh.vault);
  sheet(laptop);
  ok(await laptop.call("recovery.start", { words }));
  const seed = wordsToSeed(words);
  assert.equal(storeHolds(fresh.store, seed), false, "IndexedDB holds no words seed in the clear");
  assert.equal(storeHolds(fresh.store, hotRoot(seed)), false, "nor the hot root");
  assert.deepEqual(await fresh.vault.get("recovery-seed"), seed, "what the restore needs is there, under the unlock");
  fresh.session.lock();
  await assert.rejects(fresh.vault.get("recovery-seed"), VaultLockedError);
  laptop.close();
});

test("hot wallets from the words keep no key in the vault; each is made again to sign; an older vault's copies are deleted", async () => {
  const chain = new FakeChain();
  const { store, vault } = await browser();
  // Made before K-4: the same account, its wallets' keys kept in the vault.
  const before = newCore(chain, vault, false);
  ok(await before.call("account.create"));
  const { words } = ok(await before.call<{ words: string[] }>("recovery.words"));
  ok(await before.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const browserEth = ok(await before.call<{ id: string; address: string }>("subwallet.create", { kind: "browser", chain: "eth" }));
  assert.ok(store.items.has(`item:subwallet-seed:${browserEth.id}`), "before: the key was kept");
  before.close();

  const core = newCore(chain, vault);
  const sheets = sheet(core);
  const list = ok(await core.call<{ id: string }[]>("subwallet.list"));
  assert.ok(list.some((w) => w.id === browserEth.id));
  assert.equal(store.items.has(`item:subwallet-seed:${browserEth.id}`), false, "the old copy is deleted once the words make the same key");
  const float = ok(await core.call<{ id: string; address: string }>("subwallet.create", { kind: "trade", chain: "near" }));
  assert.equal(store.items.has(`item:subwallet-seed:${float.id}`), false, "a new one is never written");
  assert.equal([...store.items.keys()].filter((k) => k.startsWith("item:subwallet-seed:")).length, 0);

  // It still signs, with the key the words make.
  const secret = hotSecret(hotRoot(wordsToSeed(words)), "browser", "eth", 0)!;
  assert.equal(evmAddress(secret), browserEth.address);
  // D143, audit C1: what a hot key still signs for a site is a plain sign-in, from the site's own wallet (made from the
  // words on first connect, never kept in the vault), through Browser (the site's own window), no sheet
  const site = ok(await core.call<{ id: string; address: string }>("subwallet.site.forHost", { chain: "eth", site: { origin: "https://app.example" }, app: "browser" }));
  assert.equal(site.address, evmAddress(hotSecret(hotRoot(wordsToSeed(words)), "host", "eth", hostIndex("app.example"))!));
  assert.equal(store.items.has(`item:subwallet-seed:${site.id}`), false, "the site's own wallet keeps no key in the vault");
  const signIn = `app.example wants you to sign in with your Ethereum account:\n${site.address}\n\nURI: https://app.example\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: ${new Date().toISOString()}`;
  const asked = sheets();
  const signed = await core.call<{ signature: string }>("subwallet.signMessage", { id: site.id, message: btoa(signIn), site: { origin: "https://app.example" }, app: "browser" });
  assert.ok("ok" in signed && "signature" in signed.ok, JSON.stringify(signed));
  assert.equal(sheets(), asked, "no sheet");
  core.close();
});
