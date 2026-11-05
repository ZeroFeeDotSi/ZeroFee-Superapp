// The web unlock's steps (audit K-1) and Approve's own-tap rule (audit K-6), without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserVault, LEGACY_WRAP_KEY, MemoryStore } from "@zerofee/core/vault";
import { UnlockSession, WrongSecretError } from "@zerofee/core/unlock";
import type { Bridge } from "@zerofee/core/bridge";
import { TooSoonError, isVaultName, lockWithPasscode, lockWithPasskey, memoryDevice, openWithPasscode, openWithPasskey, start } from "./device.ts";
import { NO_TAP, markTap, requireActivation, takeTap } from "./activation.ts";
import { secretsVaultName, VAULT_NAMES } from "../mode.ts";
import { GUARDIAN_VAULT } from "../guardian.ts";

const yes = async () => true;
const no = async () => false;

/** A vault as the web made it before the unlock: its own key in the same store. */
async function legacyStore(items: Record<string, Uint8Array>): Promise<MemoryStore> {
  const store = new MemoryStore();
  const old = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  store.items.set(LEGACY_WRAP_KEY, old);
  for (const [name, plain] of Object.entries(items)) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    store.items.set(`item:${name}`, { iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) }, old, plain) });
  }
  return store;
}

test("every vault the web keeps is one the unlock covers: the app's (both networks), the apps' secrets, the laptop's, the guardian's", () => {
  for (const name of ["zerofee-demo-vault", VAULT_NAMES.app, secretsVaultName(false), secretsVaultName(true), "zerofee-laptop", VAULT_NAMES.laptop, GUARDIAN_VAULT]) assert.ok(isVaultName(name), name);
  assert.equal(isVaultName("zerofee-unlock"), false, "the sealed root is not a vault");
  assert.equal(isVaultName("someone-else"), false);
});

test("first open: a passkey is offered where PRF is there; where it isn't, a passcode, and the vault opens with it", async () => {
  const dev = memoryDevice();
  assert.deepEqual(await start(dev, yes), { k: "setup", legacy: false, passkey: true });
  assert.deepEqual(await start(dev, no), { k: "setup", legacy: false, passkey: false }, "no PRF: straight to a passcode");

  // The passkey was made, but the authenticator has no PRF: nothing is locked, and the screen moves to a passcode.
  const session = new UnlockSession();
  assert.equal(await lockWithPasskey(dev, session, async () => null), "no-prf");
  assert.equal(dev.record, null);
  assert.equal(session.unlocked, false);

  await lockWithPasscode(dev, session, "maple river 42");
  assert.equal(dev.record?.method, "passcode");
  const vault = new BrowserVault("zerofee-mainnet-vault", { session, store: dev.store("zerofee-mainnet-vault") });
  await vault.put("state", new Uint8Array([1]));
  assert.equal((await start(dev, yes)).k, "locked", "next visit: locked");
});

test("locked: a wrong passcode opens nothing; the right one does; a passkey opens with its PRF output only", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "maple river 42");
  const session = new UnlockSession();
  await assert.rejects(openWithPasscode(dev, session, "wrong river 42"), WrongSecretError);
  assert.equal(session.unlocked, false);
  await openWithPasscode(dev, session, "maple river 42");
  assert.equal(session.unlocked, true);

  const pk = memoryDevice();
  const prf = () => new Uint8Array(32).fill(3);
  assert.equal(await lockWithPasskey(pk, new UnlockSession(), async () => ({ credentialId: new Uint8Array([9]), prfSalt: new Uint8Array(32), prf: prf() })), "done");
  const record = pk.record!;
  assert.equal(record.method, "passkey");
  const s2 = new UnlockSession();
  await assert.rejects(openWithPasskey(pk, s2, record as never, async () => new Uint8Array(32).fill(4)), WrongSecretError);
  let asked: Uint8Array | null = null;
  await openWithPasskey(pk, s2, record as never, async (id) => ((asked = id), prf()));
  assert.deepEqual(asked, new Uint8Array([9]), "the passkey asked for is this device's own");
  assert.equal(s2.unlocked, true);
});

test("migration: vaults from before the unlock ask once to set it, then every one moves under it at once", async () => {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const dev = memoryDevice({
    "zerofee-mainnet-vault": await legacyStore({ "device-seed": seed }),
    "mainnet:zerofee-device-secrets": await legacyStore({ "agent.key": new Uint8Array([5]) }),
    "zerofee-guardian": await legacyStore({ "second-device-seed": new Uint8Array([6]) }),
  });
  assert.deepEqual(await start(dev, yes), { k: "setup", legacy: true, passkey: true });
  const session = new UnlockSession();
  await lockWithPasscode(dev, session, "maple river 42");
  for (const [name, store] of Object.entries(dev.stores)) assert.equal(store.items.has(LEGACY_WRAP_KEY), false, `${name} moved`);
  assert.equal((await start(dev, yes)).k, "locked");
  const after = new UnlockSession();
  await openWithPasscode(dev, after, "maple river 42");
  assert.deepEqual(await new BrowserVault("zerofee-mainnet-vault", { session: after, store: dev.store("zerofee-mainnet-vault") }).get("device-seed"), seed);
});

test("vaults sealed under an unlock this browser no longer has: only the words bring the bank back", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "maple river 42");
  dev.record = null;
  // A vault written under that unlock is still here.
  const s = new UnlockSession();
  const d2 = memoryDevice();
  await lockWithPasscode(d2, s, "maple river 42");
  await new BrowserVault("zerofee-mainnet-vault", { session: s, store: d2.store("zerofee-mainnet-vault") }).put("state", new Uint8Array([1]));
  d2.record = null;
  assert.deepEqual(await start(d2, yes), { k: "lost" });
  await d2.clear();
  assert.equal((await start(d2, yes)).k, "setup", "cleared: a fresh start, then I already have one");
});

test("Approve without a person's own tap is refused and answered no; with one it goes; No always goes", async () => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const core: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: { ok: true } as T };
    },
    on: () => () => {},
  };
  let acting = false;
  const bridge = requireActivation(core, () => acting);
  markTap("a1");
  assert.deepEqual(await bridge.call("approval.answer", { id: "a1", approve: true }), { problem: NO_TAP });
  assert.deepEqual(calls.pop(), { method: "approval.answer", params: { id: "a1", approve: false } }, "no one acting: a yes becomes a no, so nothing waits on it");
  acting = true;
  assert.ok("problem" in (await bridge.call("approval.answer", { id: "a0", approve: true })), "a gesture elsewhere (or a script's el.click()) isn't a tap on this Approve");
  markTap("other");
  assert.ok("problem" in (await bridge.call("approval.answer", { id: "a0b", approve: true })), "a tap on another sheet doesn't count");
  markTap("a2");
  assert.ok("ok" in (await bridge.call("approval.answer", { id: "a2", approve: true })));
  assert.deepEqual(calls.pop(), { method: "approval.answer", params: { id: "a2", approve: true } });
  acting = false;
  assert.ok("ok" in (await bridge.call("approval.answer", { id: "a3", approve: false })));
  assert.ok("ok" in (await bridge.call("account.state")), "other calls pass");
  // Node has no navigator.userActivation: the default says no.
  markTap("a4");
  assert.ok("problem" in (await requireActivation(core).call("approval.answer", { id: "a4", approve: true })));
  // A tap counts once, and only for 2 seconds.
  markTap("t1", 1_000);
  assert.equal(takeTap("t1", 3_500), false);
  markTap("t2", 1_000);
  assert.equal(takeTap("t2", 2_000), true);
  assert.equal(takeTap("t2", 2_000), false);
});

test("wrong passcodes are counted in the record and wait longer each time; a try while one waits tries nothing", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "maple river 42");
  let now = 1_000_000;
  const clock = () => now;
  const session = new UnlockSession();
  await assert.rejects(openWithPasscode(dev, session, "wrong river 1", clock), WrongSecretError);
  await assert.rejects(openWithPasscode(dev, session, "wrong river 2", clock), WrongSecretError);
  await assert.rejects(openWithPasscode(dev, session, "wrong river 3", clock), WrongSecretError);
  assert.equal(dev.record?.method === "passcode" && dev.record.failed, 3);
  // Waiting: even the right one isn't tried.
  await assert.rejects(openWithPasscode(dev, session, "maple river 42", clock), (e) => e instanceof TooSoonError && e.waitMs === 30_000);
  assert.equal(session.unlocked, false);
  now += 30_000;
  await openWithPasscode(dev, session, "maple river 42", clock);
  assert.equal(session.unlocked, true);
  assert.equal(dev.record?.method === "passcode" && dev.record.failed, undefined, "cleared");
});
