// Audit K-1: the browser vault opens only with the person's passkey (PRF) or passcode; at rest it is ciphertext only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserVault, LEGACY_WRAP_KEY, MemoryStore, VaultLockedError, vaultKind } from "./vault.ts";
import { HIDDEN_LOCK_MS, IDLE_LOCK_MS, IdleLock, UnlockSession, WrongSecretError, afterWrongPasscode, passcodeRefusal, passcodeWaitMs, setUpPasscode, setUpPasskey, unlock, type PasscodeRecord } from "./unlock.ts";
import { argon2idAsync } from "@noble/hashes/argon2.js";

const bytes = (...n: number[]) => new Uint8Array(n);
const prfOut = () => new Uint8Array(32).fill(7);

/** Every byte string anywhere in a stored value (Uint8Array, ArrayBuffer, nested objects). */
function blobs(value: unknown, out: Uint8Array[] = []): Uint8Array[] {
  if (value instanceof Uint8Array) out.push(value);
  else if (value instanceof ArrayBuffer) out.push(new Uint8Array(value));
  else if (value && typeof value === "object" && !(value instanceof CryptoKey)) for (const v of Object.values(value)) blobs(v, out);
  return out;
}
const contains = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const storeHolds = (store: MemoryStore, secret: Uint8Array) => [...store.items.values()].some((v) => blobs(v).some((b) => contains(b, secret)));

test("passcode: a vault's items round-trip under the unlock, and the store holds ciphertext only", async () => {
  const session = new UnlockSession();
  const record = await setUpPasscode(session, "maple river 42");
  assert.equal(record.method, "passcode");
  assert.equal(record.kdf.name, "argon2id");
  assert.ok(record.kdf.m >= 65_536 && record.kdf.t >= 3, "Argon2id at 64 MiB and 3 passes at least (K2-1)");
  const store = new MemoryStore();
  const vault = new BrowserVault("zerofee-mainnet-vault", { session, store });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  await vault.put("device-seed", secret);
  assert.deepEqual(await vault.get("device-seed"), secret);
  assert.equal(storeHolds(store, secret), false, "the seed is never in the store in the clear");
  assert.equal(store.items.has(LEGACY_WRAP_KEY), false, "no key sits next to the items");
  assert.ok([...store.items.values()].every((v) => blobs(v).every((b) => !(b.length === 32 && b.every((x, i) => x === secret[i])))));

  // Locked: nothing reads or writes. Unlocked again with the passcode: the same items.
  session.lock();
  await assert.rejects(vault.get("device-seed"), VaultLockedError);
  await assert.rejects(vault.put("x", bytes(1)), VaultLockedError);
  await assert.rejects(vault.delete("device-seed"), VaultLockedError);
  await unlock(session, record, { passcode: "maple river 42" });
  assert.deepEqual(await vault.get("device-seed"), secret);
});

test("a wrong passcode opens nothing, and says so; the right one still works after", async () => {
  const session = new UnlockSession();
  const record = await setUpPasscode(session, "correct horse");
  session.lock();
  await assert.rejects(unlock(session, record, { passcode: "correct hors" }), WrongSecretError);
  assert.equal(session.unlocked, false);
  await assert.rejects(unlock(session, record, { prf: prfOut() }), WrongSecretError, "a passcode record isn't opened by a passkey");
  await unlock(session, record, { passcode: "correct horse" });
  assert.equal(session.unlocked, true);
  await assert.rejects(setUpPasscode(new UnlockSession(), "abc123"), /at least 8/);
});

test("passkey: the PRF output seals the root; another output (another passkey) opens nothing", async () => {
  const session = new UnlockSession();
  const record = await setUpPasskey(session, { credentialId: bytes(1, 2, 3), prfSalt: new Uint8Array(32).fill(9), prf: prfOut() });
  assert.equal(record.method, "passkey");
  assert.deepEqual(record.credentialId, bytes(1, 2, 3));
  const store = new MemoryStore();
  const vault = new BrowserVault("zerofee-laptop-mainnet", { session, store });
  await vault.put("k", bytes(4, 5, 6));
  session.lock();
  await assert.rejects(unlock(session, record, { prf: new Uint8Array(32).fill(8) }), WrongSecretError);
  await assert.rejects(unlock(session, record, { passcode: "anything" }), WrongSecretError);
  await unlock(session, record, { prf: prfOut() });
  assert.deepEqual(await vault.get("k"), bytes(4, 5, 6));
});

test("each vault name has its own key: an item copied into another vault doesn't open there", async () => {
  const session = new UnlockSession();
  await setUpPasscode(session, "maple river 42");
  const a = new MemoryStore();
  const b = new MemoryStore();
  await new BrowserVault("zerofee-laptop", { session, store: a }).put("seed", bytes(1));
  b.items.set("item:seed", a.items.get("item:seed"));
  await assert.rejects(new BrowserVault("zerofee-guardian", { session, store: b }).get("seed"));
});

test("migration: a vault from before the unlock moves under it on first open, every item, and its old key is gone", async () => {
  // The old format: a non-extractable AES-GCM key in the same store, each item { iv, data } with its name as AD.
  const store = new MemoryStore();
  const old = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  store.items.set(LEGACY_WRAP_KEY, old);
  const items: Record<string, Uint8Array> = { "device-seed": crypto.getRandomValues(new Uint8Array(32)), state: new TextEncoder().encode('{"stage":"ready"}'), "hot-root": crypto.getRandomValues(new Uint8Array(64)) };
  for (const [name, plain] of Object.entries(items)) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) }, old, plain);
    store.items.set(`item:${name}`, { iv, data });
  }
  assert.equal(await vaultKind(store), "legacy");

  const session = new UnlockSession();
  const vault = new BrowserVault("zerofee-mainnet-vault", { session, store });
  await assert.rejects(vault.get("device-seed"), VaultLockedError, "locked: not even an old vault is read");
  assert.equal(store.items.has(LEGACY_WRAP_KEY), true, "nothing moved while locked");

  const record = await setUpPasscode(session, "maple river 42");
  for (const [name, plain] of Object.entries(items)) assert.deepEqual(await vault.get(name), plain);
  assert.equal(store.items.has(LEGACY_WRAP_KEY), false, "the old key is deleted");
  assert.equal(await vaultKind(store), "sealed");
  for (const v of store.items.values()) assert.equal((v as { v?: number }).v, 2);

  // After a reload (a new session and vault object), the passcode opens the moved items.
  const next = new UnlockSession();
  await unlock(next, record, { passcode: "maple river 42" });
  const again = new BrowserVault("zerofee-mainnet-vault", { session: next, store });
  assert.deepEqual(await again.get("device-seed"), items["device-seed"]);
});

test("migration that can't read an old item changes nothing", async () => {
  const store = new MemoryStore();
  store.items.set(LEGACY_WRAP_KEY, await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
  store.items.set("item:state", { iv: new Uint8Array(12), data: new Uint8Array(40) });
  const session = new UnlockSession();
  await setUpPasscode(session, "maple river 42");
  await assert.rejects(new BrowserVault("zerofee-demo-vault", { session, store }).get("state"));
  assert.equal(store.items.has(LEGACY_WRAP_KEY), true);
  assert.equal((store.items.get("item:state") as { v?: number }).v, undefined);
});

test("idle lock: 15 minutes without a touch, or 5 minutes out of sight; a late touch locks rather than counts", () => {
  assert.equal(IDLE_LOCK_MS, 15 * 60_000);
  assert.equal(HIDDEN_LOCK_MS, 5 * 60_000);
  const t0 = 1_000_000;
  const idle = new IdleLock(t0);
  assert.equal(idle.due(t0 + IDLE_LOCK_MS - 1), false);
  assert.equal(idle.activity(t0 + 10 * 60_000), false, "a touch at 10 minutes counts");
  assert.equal(idle.due(t0 + 24 * 60_000), false, "and restarts the 15 minutes");
  assert.equal(idle.due(t0 + 25 * 60_000), true);
  assert.equal(new IdleLock(t0).activity(t0 + IDLE_LOCK_MS), true, "a touch after 15 idle minutes locks");

  const hide = new IdleLock(t0);
  hide.hidden(t0 + 60_000);
  assert.equal(hide.due(t0 + 60_000 + HIDDEN_LOCK_MS - 1), false);
  assert.equal(hide.visible(t0 + 60_000 + 4 * 60_000), false, "back within 5 minutes: still open");
  hide.hidden(t0 + 10 * 60_000);
  assert.equal(hide.due(t0 + 10 * 60_000 + HIDDEN_LOCK_MS), true, "hidden 5 minutes: locks");
  assert.equal(hide.visible(t0 + 10 * 60_000 + HIDDEN_LOCK_MS + 1), true, "coming back after that locks");

  const session = new UnlockSession();
  let locked = 0;
  session.onLocked(() => locked++);
  session.lock();
  assert.equal(locked, 0, "locking a locked session does nothing");
});

test("passcodes: 8 characters at least, never only digits, a run, a repeat or a common one; four words pass", () => {
  for (const weak of ["kite42", "1234567", "12345678", "20261029", "9876 5432", "abcdefgh", "hgfedcba", "aaaaaaaa", "abababab", "abcabcabc", "Password", "qwertyuiop", "1q2w3e4r"]) {
    assert.ok(passcodeRefusal(weak), `${weak} is refused`);
  }
  assert.match(passcodeRefusal("1234567")!, /at least 8/);
  assert.match(passcodeRefusal("20261029")!, /Not only numbers/);
  assert.match(passcodeRefusal("abcdefgh")!, /run or a repeat/);
  for (const ok of ["maple river 42", "orbit lemon fossil tide", "Kq7#vR2m", "correct horse"]) assert.equal(passcodeRefusal(ok), null, ok);
});

test("wrong passcodes wait longer each time: none for two, then 30 s, 1 min, 5 min, 15 min, then an hour", () => {
  let r = { method: "passcode", kdf: { name: "argon2id", t: 3, m: 65_536, p: 1, salt: new Uint8Array(16) }, v: 1, iv: new Uint8Array(12), sealed: new Uint8Array(48) } as PasscodeRecord;
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) {
    r = afterWrongPasscode(r, 1_000);
    waits.push(passcodeWaitMs(r, 1_000));
  }
  assert.deepEqual(waits, [0, 0, 30_000, 60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
  assert.equal(r.failed, 8);
  assert.equal(passcodeWaitMs(r, 1_000 + 3_600_000), 0, "over once the time has passed");
});

test("a right passcode clears the count; a record from the first release's weaker settings opens and is sealed again at 64 MiB", async () => {
  const session = new UnlockSession();
  const record = await setUpPasscode(session, "maple river 42");
  session.lock();
  const counted = afterWrongPasscode(afterWrongPasscode(afterWrongPasscode(record, 0), 0), 0);
  const cleared = await unlock(session, counted, { passcode: "maple river 42" });
  assert.ok(cleared && cleared.method === "passcode" && !cleared.failed && !cleared.waitUntil);
  assert.equal(await unlock(new UnlockSession(), record, { passcode: "maple river 42" }), null, "nothing to change");

  // As sealed before K2-1: Argon2id 19 MiB, 2 passes (the same seal as unlock.ts's, rebuilt here).
  const enc = new TextEncoder();
  const root = crypto.getRandomValues(new Uint8Array(32));
  const kdf = { name: "argon2id" as const, t: 2, m: 19_456, p: 1, salt: crypto.getRandomValues(new Uint8Array(16)) };
  const stretched = await argon2idAsync(enc.encode("246810"), kdf.salt, { t: 2, m: 19_456, p: 1, dkLen: 32 });
  const base = await crypto.subtle.importKey("raw", stretched, "HKDF", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("zerofee/unlock/v1/passcode") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("zerofee/unlock/v1/passcode") }, kek, root));
  const old: PasscodeRecord = { v: 1, method: "passcode", kdf, iv, sealed };
  const s1 = new UnlockSession();
  const upgraded = (await unlock(s1, old, { passcode: "246810" })) as PasscodeRecord;
  assert.ok(upgraded && upgraded.kdf.m === 65_536 && upgraded.kdf.t === 3);
  const s2 = new UnlockSession();
  await unlock(s2, upgraded, { passcode: "246810" });
  const store = new MemoryStore();
  await new BrowserVault("v", { session: s1, store }).put("x", new Uint8Array([1]));
  assert.deepEqual(await new BrowserVault("v", { session: s2, store }).get("x"), new Uint8Array([1]), "the same root, sealed again");
});
