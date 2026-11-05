// Audit M4 and M5 (3 Nov): on the web, every app's device.store values are sealed in the device vault (encrypted with
// the person's passkey or passcode), read once after the unlock, never plain in localStorage; and "Clear and start
// again" takes mainnet's keys too. Each with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserVault, MemoryStore } from "@zerofee/core/vault";
import { UnlockSession, setUpPasscode } from "@zerofee/core/unlock";
import { STORE_ITEM, sealedStore } from "./sealed-store.ts";
import { clearedOnStartAgain } from "./unlock/clear-keys.ts";

/** localStorage, as a Map. */
function local(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const APPS = new Set(["wallet", "agent", "browser"]);
const isSlot = (mainnet: boolean) => (k: string) => { const m = /^(mainnet:)?zf\.([a-z0-9-]+)\./.exec(k); return !!m && !!m[1] === mainnet && APPS.has(m[2]!); };
async function vault() {
  const session = new UnlockSession();
  await setUpPasscode(session, "maple river 42");
  const store = new MemoryStore();
  return { session, store, vault: new BrowserVault("mainnet:zerofee-device-secrets", { session, store }) };
}
/** Does any stored byte string hold this text (a scan of what IndexedDB would hold)? */
const holds = (store: MemoryStore, text: string) => JSON.stringify([...store.items.values()], (_, v) => (v instanceof Uint8Array || v instanceof ArrayBuffer ? Buffer.from(v as Uint8Array).toString("latin1") : v)).includes(text);

test("M4: device.store's values are sealed in the vault, never plain: kept ones move in on the first read and leave localStorage; other keys and the other network stay (controls)", async () => {
  const { store, vault: v } = await vault();
  const ls = local({
    "mainnet:zf.agent.chats": "payee: kim.near, $40",
    "mainnet:zf.wallet.home-cache.v1": "{\"total\":\"1234.56\"}",
    "zf.agent.chats": "testnet's own",
    "zf.theme": "dark",
    "mainnet:zf.hub.v1": "not an app's store",
  });
  const s = sealedStore({ vault: v, local: ls, isSlot: isSlot(true) });
  assert.equal(await s.get("mainnet:zf.agent.chats"), "payee: kim.near, $40", "read back from the vault");
  assert.equal(await s.get("mainnet:zf.wallet.home-cache.v1"), "{\"total\":\"1234.56\"}", "Home's sealed copy keeps working");
  assert.deepEqual([...ls.m.keys()].sort(), ["mainnet:zf.hub.v1", "zf.agent.chats", "zf.theme"], "moved out of localStorage; the rest stays");
  assert.ok(store.items.size > 0 && !holds(store, "kim.near") && !holds(store, "1234.56"), "sealed: not one value readable in the stored bytes");
  await s.set("mainnet:zf.browser.history", "https://pump.fun");
  await s.set("mainnet:zf.agent.chats", null);
  assert.ok(!holds(store, "pump.fun"), "a new value is sealed too");
  // a fresh page (a reload after the unlock): every value from the vault alone
  const again = sealedStore({ vault: v, local: local(), isSlot: isSlot(true) });
  assert.equal(await again.get("mainnet:zf.browser.history"), "https://pump.fun");
  assert.equal(await again.get("mainnet:zf.agent.chats"), null, "a value taken away stays away");
  // control: the scan would see a plain value
  const plain = new MemoryStore();
  await plain.write([["x", new TextEncoder().encode("kim.near")]]);
  assert.ok(holds(plain, "kim.near"), "control: a plain value is caught");
});

test("M4: locked, nothing is read or kept (control: open, it is)", async () => {
  const { session, vault: v } = await vault();
  session.lock();
  const ls = local({ "mainnet:zf.agent.chats": "x" });
  const s = sealedStore({ vault: v, local: ls, isSlot: isSlot(true) });
  await assert.rejects(s.get("mainnet:zf.agent.chats"));
  await assert.rejects(s.set("mainnet:zf.agent.chats", "y"));
  assert.equal(ls.getItem("mainnet:zf.agent.chats"), "x", "nothing moved while locked");
  assert.equal(STORE_ITEM, "device-store.v1");
});

test("M4: many sets at once share writes, and the last value of each wins (control: each read back)", async () => {
  const { vault: v } = await vault();
  let puts = 0;
  const counted = { get: (n: string) => v.get(n), put: (n: string, b: Uint8Array) => (puts++, v.put(n, b)) };
  const s = sealedStore({ vault: counted, local: local(), isSlot: isSlot(true) });
  await s.get("mainnet:zf.wallet.a");
  await Promise.all(Array.from({ length: 20 }, (_, i) => s.set(`mainnet:zf.wallet.k${i % 5}`, String(i))));
  assert.ok(puts <= 3, `20 sets, ${puts} writes`);
  const again = sealedStore({ vault: v, local: local(), isSlot: isSlot(true) });
  for (let k = 0; k < 5; k++) assert.equal(await again.get(`mainnet:zf.wallet.k${k}`), String(15 + k));
});

test("M5: Clear and start again takes mainnet's keys, Trade's caches and AgentZero's tasks; only the theme stays (control: the old rule missed mainnet)", () => {
  const keys = ["mainnet:zf.agent.chats", "mainnet:zf.wallet.home-cache.v1", "zf.account", "zerofee.app.terms", "zerofee-trade-logos:v1", "agentzero.tasks.v1", "zf.theme", "someone-else"];
  assert.deepEqual(keys.filter(clearedOnStartAgain), ["mainnet:zf.agent.chats", "mainnet:zf.wallet.home-cache.v1", "zf.account", "zerofee.app.terms", "zerofee-trade-logos:v1", "agentzero.tasks.v1"]);
  const old = (k: string) => /^(zf|zerofee)\./.test(k) && k !== "zf.theme";
  assert.ok(!old("mainnet:zf.agent.chats"), "control: the old rule left mainnet's keys behind");
});
