// Row 16 (4 Nov): Add money's fresh address stays the same until the person taps Change wallet and says yes;
// never a new one on reopen or reload. The key lives in Home's sealed store. Each with a control.
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

test("row 16: Change wallet gives a new address only after its yes, kept at once (reload shows the new one); a no keeps the old (control: done is said, never swapped by itself)", async () => {
  const dev = deviceStore();
  const page = addCards(() => undefined);
  await page.seal(dev.bridge);
  const old = cardKey(page.store(), "safe-sol");
  const next = changeCardKey(page.store(), "safe-sol");
  assert.notEqual(next, old);
  await flush();
  const reload = addCards(() => undefined);
  await reload.seal(dev.bridge);
  assert.equal(cardKey(reload.store(), "safe-sol"), next, "a reload after the yes: the new one");
  // the sheet: the hook never makes a key by itself; only the yes does
  const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  const hook = sheet.slice(sheet.indexOf("function useOneTimeAddress("), sheet.indexOf("function ChangeSure("));
  assert.equal((hook.match(/setKey\(/g) ?? []).length, 1, "one place sets a new key: change()");
  assert.match(hook, /const change = \(\) => \{[\s\S]*?setKey\(o\.slot \? changeCardKey\(store\(\), o\.slot\) : addKey\(row\.chain, to\)\);/);
  assert.match(hook, /if \(r\.problem\.code === ADD_USED\) return setDone\(true\);/, "used or ran out: said, not swapped");
  assert.match(hook, /const ended = \(\) => swapDue\(a\.untilIso, Date\.now\(\)\)\.due && setDone\(true\);/, "its end: said, not swapped");
  assert.match(hook, /retry: \(\) => setTries\(\(n\) => n \+ 1\)/, "a retry asks the same key again");
  assert.doesNotMatch(hook, /renew/, "control: the old self-swap is gone");
  // every Change wallet goes through "Are you sure?": its yes runs change, its no only closes
  for (const m of sheet.matchAll(/<ChangeSure onYes=\{\(\) => \{ setSure\(false\); ([a-zA-Z]+)\(\); \}\} onNo=\{\(\) => setSure\(false\)\} \/>/g)) assert.match(m[1]!, /^(change|onChange)$/);
  assert.equal((sheet.match(/<ChangeSure /g) ?? []).length, 3, "the row, the coin page and the QR sheet");
  assert.doesNotMatch(sheet, /onClick=\{change\}|onChange=\{change\}/, "control: never a change without the sure-check");
  // Add waits for the sealed copy before it picks a key; Home reads it at boot
  assert.match(sheet, /return <AddList \{\.\.\.p\} ready=\{ready\} \/>;/, "rule 2: the sheet's frame at once, never a wait screen");
  assert.match(sheet, /const line = \(r: AddRow, to: AddTo\) => !ready \? <RowWaits /, "rows show their frame; only the address waits");
  assert.doesNotMatch(sheet, /data-testid="add-reading"/, "control: the old wait screen is gone");
  assert.match(readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8"), /m\.sealAddCards\(bridge\)/);
});
