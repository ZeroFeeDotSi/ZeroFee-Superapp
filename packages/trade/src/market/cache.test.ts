// The stale-while-revalidate cache (ported from the earlier module's cache.test.ts): the screen paints from the cache at once.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_STALE_MS, createStore } from "./cache.ts";

const memStorage = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };

describe("store.swr", () => {
  it("fresh = no load; stale = the old answer AT ONCE plus one background refresh; missing = waits", async () => {
    let t = 0;
    const s = createStore(() => t, null);
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await s.swr("k", 1000, 10_000, load), 1);
    t = 500; assert.equal(await s.swr("k", 1000, 10_000, load), 1); assert.equal(loads, 1);
    t = 2000;
    assert.equal(await s.swr("k", 1000, 10_000, load), 1);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(loads, 2);
    assert.equal(await s.swr("k", 1000, 10_000, load), 2);
  });
  it("one refresh per key at a time", async () => {
    let t = 0; const s = createStore(() => t, null);
    let loads = 0; let release!: () => void;
    const slow = () => new Promise<number>((r) => { loads++; release = () => r(loads); });
    await s.swr("k", 1, 99, async () => 0);
    t = 10;
    await Promise.all([s.swr("k", 1, 99, slow), s.swr("k", 1, 99, slow), s.swr("k", 1, 99, slow)]);
    assert.equal(loads, 1);
    release();
  });
  it("a failing network serves the old answer (up to 24 h), and throws only when there is nothing", async () => {
    let t = 0; const s = createStore(() => t, null);
    await s.swr("k", 1, 2, async () => "v");
    t = 1000;
    assert.equal(await s.swr("k", 1, 2, async () => { throw new Error("down"); }), "v");
    t = MAX_STALE_MS + 10;
    await assert.rejects(s.swr("k", 1, 2, async () => { throw new Error("down"); }), /down/);
    await assert.rejects(createStore(() => 0, null).swr("none", 1, 2, async () => { throw new Error("down"); }), /down/);
  });
  it("survives a reload through the given storage; a broken or full storage is never fatal", async () => {
    const ls = memStorage(); let t = 0;
    await createStore(() => t, ls).swr("k", 1000, 10_000, async () => ({ a: 1 }));
    assert.deepEqual(await createStore(() => 100, ls).swr("k", 1000, 10_000, async () => ({ a: 2 })), { a: 1 });
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => {}, key: () => null, length: 0 };
    assert.equal(await createStore(() => 0, broken as never).swr("k", 1, 2, async () => 7), 7);
    assert.equal(createStore(() => MAX_STALE_MS + 1, ls).get("k"), undefined);
  });
});
