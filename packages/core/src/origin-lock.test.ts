// D157 review L2: two ZeroFee side panels are two cores on one vault. The one rolling cap's day is read, then written:
// under the origin's Web Lock both panels' signatures count; without it, one write is lost (twice the cap could go).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { originLock } from "./origin-lock.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));
/** One panel adding a signature to the shared day: read, wait (the vault's own await), write. */
const add = (store: Map<string, number[]>, usd: number) => async () => {
  const day = store.get("hot-spent") ?? [];
  await tick();
  store.set("hot-spent", [...day, usd]);
};

test("two panels counting at once, under the origin's lock: both count (the browser's own Web Locks)", async () => {
  const store = new Map<string, number[]>();
  assert.ok((globalThis as { navigator?: { locks?: unknown } }).navigator?.locks, "this runtime has Web Locks");
  await Promise.all([originLock("hot-spent", add(store, 90)), originLock("hot-spent", add(store, 90))]);
  assert.deepEqual(store.get("hot-spent"), [90, 90]);
});

test("control: without a lock (none passed and none in the runtime), one of the two writes is lost", async () => {
  const store = new Map<string, number[]>();
  const none = { request: <T>(_n: string, cb: () => Promise<T>) => cb() };
  await Promise.all([originLock("hot-spent", add(store, 90), none), originLock("hot-spent", add(store, 90), none)]);
  assert.deepEqual(store.get("hot-spent"), [90]);
});

test("the one rolling cap's read-then-write runs under the origin's lock", () => {
  const src = readFileSync(new URL("./subwallets.ts", import.meta.url), "utf8");
  assert.match(src, /return this\.turn\(HOT_SPENT, \(\) => originLock\(HOT_SPENT, async \(\) => \{\n\s+const now = Date\.now\(\);\n\s+const raw = await this\.o\.vault\.get\(HOT_SPENT\);/);
});
