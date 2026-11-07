// Row 16 (4 Nov): Add money's address stays the same on reopen and reload; since the owner's Bugs: (6 Nov) it is
// renewed only when the core says it can take no more (no Change wallet). The key lives in Home's sealed store. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addCards, SEALED_ADD_CARDS } from "./add-keep.ts";
import { cardKey, changeCardKey, keepCardKey } from "./add-coins.ts";

/** Wallet's device.store as the core keeps it (sealed on the phone): survives a reload; `down` refuses every call. */
const deviceStore = (o: { down?: boolean } = {}) => {
  const kept = new Map<string, string>();
  const bridge = { call: async (m: string, p: { key: string; value?: string }) => {
    if (o.down) return { problem: { code: "device.store.locked" } };
    if (m === "device.store.get") return { ok: { value: kept.get(p.key) ?? null } };
    if (m === "device.store.set") return (kept.set(p.key, p.value!), { ok: {} });
    return { problem: { code: "x" } };
  } } as never;
  return { kept, bridge };
};
const plainStore = () => {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test("row 16: reload and reopen show the same address: the key is in Home's sealed store and comes back after a reload (control: a fresh phone with nothing kept gets a new one)", async () => {
  const dev = deviceStore();
  const page1 = addCards(() => undefined);
  assert.equal(await page1.seal(dev.bridge), true);
  const key = cardKey(page1.store(), "sol");
  keepCardKey(page1.store(), "sol", key, Date.now() + 86_400_000, "Fvphc0nyBXPtytRGGOFz9PsNyJSTDItVA9nxE9lKuag1");
  assert.equal(cardKey(page1.store(), "sol"), key, "reopen: the same");
  await flush();
  assert.ok(dev.kept.get(SEALED_ADD_CARDS)?.includes(key), "written to the sealed store");
  assert.ok(!dev.kept.get(SEALED_ADD_CARDS)?.includes("Fvphc0ny"), "never the address itself");
  // reload: a new page, the same device.store
  const page2 = addCards(() => undefined);
  await page2.seal(dev.bridge);
  assert.equal(cardKey(page2.store(), "sol"), key, "reload: the same address");
  // control: a phone with nothing kept
  const other = addCards(() => undefined);
  await other.seal(deviceStore().bridge);
  assert.notEqual(cardKey(other.store(), "sol"), key);
});

test("row 16: the old plain copy joins the sealed store once and is erased (control: a store that won't answer keeps the plain copy, so Add still shows the same address)", async () => {
  const plain = plainStore();
  keepCardKey(plain.s, "hood", "add-hood-wallet-0123456789abcdef01", Date.now() + 1000);
  const dev = deviceStore();
  const page = addCards(() => plain.s);
  await page.seal(dev.bridge);
  assert.equal(cardKey(page.store(), "hood"), "add-hood-wallet-0123456789abcdef01", "kept across the move");
  assert.equal(plain.m.size, 0, "the plain copy is erased");
  await flush();
  assert.ok(dev.kept.get(SEALED_ADD_CARDS)?.includes("add-hood-wallet-0123456789abcdef01"));
  const locked = plainStore();
  keepCardKey(locked.s, "sol", "add-sol-wallet-0123456789abcdef0123", Date.now() + 1000);
  const off = addCards(() => locked.s);
  assert.equal(await off.seal(deviceStore({ down: true }).bridge), false);
  assert.equal(cardKey(off.store(), "sol"), "add-sol-wallet-0123456789abcdef0123", "control: the plain copy, same address");
  assert.equal(locked.m.size, 1, "control: nothing erased");
});

test("row 16 + owner's Bugs: (6 Nov): the kept key stays on every open and reload; only the core's word that its address can take no more renews it, kept at once (reload shows the new one); a failed ask asks the same key again (control: no Change wallet)", async () => {
  const dev = deviceStore();
  const page = addCards(() => undefined);
  await page.seal(dev.bridge);
  const old = cardKey(page.store(), "safe-sol");
  assert.equal(cardKey(page.store(), "safe-sol"), old, "reopen: the same key");
  const next = changeCardKey(page.store(), "safe-sol");
  assert.notEqual(next, old);
  await flush();
  const reload = addCards(() => undefined);
  await reload.seal(dev.bridge);
  assert.equal(cardKey(reload.store(), "safe-sol"), next, "a reload after a renewal: the new one");
  // the sheet: one place sets a new key, renew(), and it runs only on addStep's renew or the address's own end
  const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  const hook = sheet.slice(sheet.indexOf("function useOneTimeAddress("), sheet.indexOf("function useCopiedFades("));
  assert.equal((hook.match(/setKey\(/g) ?? []).length, 1, "one place sets a new key: renew()");
  assert.match(hook, /const renew = \(\) => \{[\s\S]*?setKey\(o\.slot \? changeCardKey\(store\(\), o\.slot\) : addKey\(row\.chain, to\)\);/);
  assert.equal((hook.match(/renew\(\)/g) ?? []).length, 4, "renew runs on the first answer's renew, the recheck's renew, the address's end, and a QR tap after a renewed key was refused only");
  assert.match(hook, /if \("renew" in step\) return renew\(\);/, "the core's ADD_USED: a new one");
  assert.match(hook, /const ended = \(\) => \{ if \(live && swapDue\(a\.untilIso, Date\.now\(\)\)\.due\) \{ live = false; renew\(\); \} \};/, "its end: a new one");
  assert.match(hook, /retry: \(\) => \(usedAgain\.current \? \(\(usedAgain\.current = false\), renew\(\)\) : setTries\(\(n\) => n \+ 1\)\)/, "a retry asks the same key again, unless the core refused that renewed key");
  assert.doesNotMatch(sheet, /ChangeSure|onChange|add-change/, "no Change wallet left");
  // Add waits for the sealed copy before it picks a key; Home reads it at boot
  assert.match(sheet, /return <AddList \{\.\.\.p\} ready=\{ready\} \/>;/, "rule 2: the sheet's frame at once, never a wait screen");
  assert.match(sheet, /const line = \(r: AddRow, to: AddTo\) => !ready \? <RowWaits /, "rows show their frame; only the address waits");
  assert.doesNotMatch(sheet, /data-testid="add-reading"/, "control: the old wait screen is gone");
  assert.match(readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8"), /m\.sealAddCards\(bridge\)/);
});
