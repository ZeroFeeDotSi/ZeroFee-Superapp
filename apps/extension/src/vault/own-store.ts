// Where the sealed seed sits at rest (audit L26): the extension's own IndexedDB, which only this extension's pages and
// worker can open. chrome.storage.local, where it sat before, is readable by the extension's content scripts too. The
// first start after this change moves it once (copied, read back, then the old copy deleted); if it can't, the old place
// keeps it and the move is tried again at the next start, so a wallet is never lost or hidden.
import type { Store } from "./vault.ts";

const KV = "kv";

/** A Store over this extension's own IndexedDB (one object store of key → value, values as structured clones). */
export function idbStore(factory: IDBFactory, name = "zerofee-vault"): Store {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((ok, no) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => void r.result.createObjectStore(KV);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await open();
    return new Promise<T>((ok, no) => {
      const tx = d.transaction(KV, mode);
      const req = f(tx.objectStore(KV));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = tx.onabort = () => no(tx.error ?? req.error);
    });
  };
  return {
    get: <T>(k: string) => run("readonly", (s) => s.get(k)) as Promise<T | undefined>,
    set: async (k, v) => void (await run("readwrite", (s) => s.put(v, k))),
    remove: async (k) => void (await run("readwrite", (s) => s.delete(k))),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The one-time move: each of `keys` held in `from` and not yet in `to` is copied, read back, and only then deleted from
 * `from`. Answers the store the vault should use: `to` once the vault is there; `from` only while `from` still holds the
 * vault (`keys[0]`) and the move failed, so it is tried again at the next start. A vault is never made anew over one the
 * old place still holds.
 */
export async function moveToOwnStore(from: Store, to: Store, keys: readonly string[]): Promise<Store> {
  try {
    for (const k of keys) {
      const old = await from.get(k);
      if (old === undefined) continue;
      if ((await to.get(k)) === undefined) {
        await to.set(k, old);
        if (!same(await to.get(k), old)) {
          await to.remove(k).catch(() => undefined);
          throw new Error("not kept");
        }
      }
    }
  } catch {
    const held = await from.get(keys[0]!).catch(() => undefined);
    return held === undefined ? to : from;
  }
  // the old copies go only once the own store holds every one
  for (const k of keys) await from.remove(k).catch(() => undefined);
  return to;
}

/** A Store whose every call waits for `p` (the move above) first: the vault is made before the move ends. */
export const laterStore = (p: Promise<Store>): Store => ({
  get: async <T>(k: string) => (await p).get<T>(k),
  set: async (k, v) => (await p).set(k, v),
  remove: async (k) => (await p).remove(k),
});
