// Audit L26: the sealed wallet lives in the extension's own IndexedDB, moved once out of chrome.storage.local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { idbStore, laterStore, moveToOwnStore } from "./own-store.ts";
import { AT_REST, createVault, type Store } from "./vault.ts";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "a long passcode 1";

const memory = (o: { failSet?: boolean; failGet?: boolean } = {}): Store & { m: Map<string, unknown> } => {
  const m = new Map<string, unknown>();
  return {
    m,
    async get<T>(k: string) { if (o.failGet) throw new Error("no store"); const v = m.get(k); return v === undefined ? undefined : (structuredClone(v) as T); },
    async set(k: string, v: unknown) { if (o.failSet) throw new Error("no room"); m.set(k, structuredClone(v)); },
    async remove(k: string) { m.delete(k); },
  };
};

/** The few IndexedDB calls idbStore makes, over a Map, with the same event order (request, then the transaction). */
function fakeIdb(): IDBFactory & { opened: string[] } {
  const dbs = new Map<string, Map<string, unknown>>();
  const opened: string[] = [];
  const later = (f: () => void) => setTimeout(f, 0);
  const factory = {
    opened,
    open(name: string) {
      opened.push(name);
      const r: any = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const data = dbs.get(name)!;
        r.result = {
          createObjectStore: () => ({}),
          transaction: () => {
            const tx: any = {};
            tx.objectStore = () => {
              const req = (f: () => unknown) => { const q: any = {}; later(() => { q.result = f(); later(() => tx.oncomplete?.()); }); return q; };
              return { get: (k: string) => req(() => structuredClone(data.get(k))), put: (v: unknown, k: string) => req(() => void data.set(k, structuredClone(v))), delete: (k: string) => req(() => void data.delete(k)) };
            };
            return tx;
          },
        };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return factory as unknown as IDBFactory & { opened: string[] };
}

test("idbStore keeps, reads back and deletes values in the extension's own database", async () => {
  const idb = fakeIdb();
  const s = idbStore(idb);
  assert.equal(await s.get("vault"), undefined);
  await s.set("vault", { v: 1, sol: "abc", perTradeUsd: 50 });
  assert.deepEqual(await s.get("vault"), { v: 1, sol: "abc", perTradeUsd: 50 });
  await s.remove("vault");
  assert.equal(await s.get("vault"), undefined);
  assert.deepEqual(idb.opened, ["zerofee-vault"], "opened once");
});

test("the one-time move: the sealed wallet goes to the own store, the old copy is deleted, and the same passcode opens the same wallet", async () => {
  const local = memory(), own = memory(), session = memory();
  const before = createVault({ local, session, kdf: FAST, spend: async () => 0n, solUsd: async () => 150 });
  const made = await before.create(PASS);
  assert.ok("ok" in made);
  await before.unlock("wrong wrong wrong");
  assert.ok(local.m.has("vault") && local.m.has("vault.tries"));
  const sealed = structuredClone(local.m.get("vault"));
  const used = await moveToOwnStore(local, own, AT_REST);
  assert.equal(used, own);
  assert.equal(local.m.size, 0, "nothing of the vault is left in chrome.storage.local");
  assert.deepEqual(own.m.get("vault"), sealed);
  assert.deepEqual(own.m.get("vault.tries"), { n: 1, until: (own.m.get("vault.tries") as { until: number }).until });
  const after = createVault({ local: laterStore(Promise.resolve(used)), session: memory(), kdf: FAST, spend: async () => 0n, solUsd: async () => 150 });
  assert.deepEqual(await after.unlock(PASS), { ok: { sol: made.ok.sol } });
  // a second start moves nothing and keeps the own store
  assert.equal(await moveToOwnStore(local, own, AT_REST), own);
  assert.deepEqual(own.m.get("vault"), sealed);
});

test("a move that fails keeps the old copy and uses it (tried again next start); with nothing in the old place, the own store is used, never a fresh wallet over a hidden one", async () => {
  const local = memory(), full = memory({ failSet: true });
  local.m.set("vault", { v: 1, sol: "abc" });
  assert.equal(await moveToOwnStore(local, full, AT_REST), local);
  assert.ok(local.m.has("vault"), "the old copy stays");
  // the own store unreadable, and the vault already moved (the old place empty): the own store, whose failure the vault says
  const gone = memory({ failGet: true });
  assert.equal(await moveToOwnStore(memory(), gone, AT_REST), gone);
  const v = createVault({ local: laterStore(moveToOwnStore(memory(), gone, AT_REST)), session: memory(), kdf: FAST, spend: async () => 0n, solUsd: async () => 150 });
  await assert.rejects(v.create(PASS), /no store/, "no wallet is made when the own store can't be read");
  // control: a fresh install, nothing anywhere, uses the own store
  const own = memory();
  assert.equal(await moveToOwnStore(memory(), own, AT_REST), own);
});

test("a copy that doesn't read back the same is undone and the old copy kept", async () => {
  const local = memory();
  local.m.set("vault", { v: 1, sol: "abc" });
  const own = memory();
  const liar: Store = { ...own, get: async <T>(k: string) => (own.m.has(k) ? ({ v: 1, sol: "other" } as T) : undefined) };
  assert.equal(await moveToOwnStore(local, liar, AT_REST), local);
  assert.ok(local.m.has("vault"));
  assert.equal(own.m.has("vault"), false, "the bad copy is removed");
});
