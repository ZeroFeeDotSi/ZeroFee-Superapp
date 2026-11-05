// Where a core keeps its keys and its small state between visits.
//
// On the phone there is no vault like this: the core's vault is the Keychain and the account's key lives in the secure
// chip. These vaults are for a browser, and for tests.
//
// BrowserVault (audit K-1): every item is encrypted with an AES-GCM key derived from the unlock's root (unlock.ts),
// which is in memory only while the person has unlocked with their passkey or passcode. At rest, IndexedDB holds
// ciphertext only, and no key that decrypts it. Locked, every read and write is refused (VaultLockedError).
//
// Vaults made before the unlock existed kept their own key ("__wrap-key", non-extractable, but in the same store, so
// anyone with the browser profile could use it). The first time such a vault is opened after an unlock, every item is
// re-encrypted under the unlock and the old key deleted, in one transaction: all of it moves, or none.
import { VaultLockedError, vaultSession, type UnlockSession } from "./unlock.ts";

export { VaultLockedError };

export interface Vault {
  /** The storage this vault reads and writes, the same for every copy of it (another window's, a restarted core's): RM-4's
   *  key lock is held per scope (move-key.ts). None (a vault in memory): the lock is this object's alone. */
  readonly lockScope?: string;
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** Several items in one write, all or none (the web wallet's root and words: web-wallet.ts). Not every vault has it. */
  putAll?(items: [string, Uint8Array][]): Promise<void>;
  delete(name: string): Promise<void>;
}

export class MemoryVault implements Vault {
  private readonly items = new Map<string, Uint8Array>();
  async get(name: string) {
    const v = this.items.get(name);
    return v ? v.slice() : null;
  }
  async put(name: string, bytes: Uint8Array) {
    this.items.set(name, bytes.slice());
  }
  async putAll(items: [string, Uint8Array][]) {
    for (const [name, bytes] of items) this.items.set(name, bytes.slice());
  }
  async delete(name: string) {
    this.items.get(name)?.fill(0);
    this.items.delete(name);
  }
}

/** A vault's raw store: IndexedDB in a browser, a Map in tests. */
export interface VaultStore {
  get(key: string): Promise<unknown>;
  keys(): Promise<string[]>;
  /** One atomic write: every put and every delete, or none of them. */
  write(puts: [string, unknown][], deletes?: string[]): Promise<void>;
}

const STORE = "items";

/** An IndexedDB database with one object store, "items" (the layout every ZeroFee vault has always had). */
export class IdbStore implements VaultStore {
  private db: Promise<IDBDatabase> | null = null;
  readonly dbName: string;
  constructor(dbName: string) {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async read<T>(work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = work(db.transaction(STORE, "readonly").objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  get(key: string): Promise<unknown> {
    return this.read((s) => s.get(key));
  }

  async keys(): Promise<string[]> {
    return (await this.read((s) => s.getAllKeys())).map(String);
  }

  async write(puts: [string, unknown][], deletes: string[] = []): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      for (const [k, v] of puts) s.put(v, k);
      for (const k of deletes) s.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("the vault's write was stopped"));
    });
  }

  close(): void {
    void this.db?.then((d) => d.close());
    this.db = null;
  }
}

/** Tests: a store in memory, holding exactly what IndexedDB would (so a test can scan it for secrets). */
export class MemoryStore implements VaultStore {
  readonly items = new Map<string, unknown>();
  async get(key: string) {
    return this.items.get(key);
  }
  async keys() {
    return [...this.items.keys()];
  }
  async write(puts: [string, unknown][], deletes: string[] = []) {
    for (const [k, v] of puts) this.items.set(k, v);
    for (const k of deletes) this.items.delete(k);
  }
}

/** The key a vault made before the unlock kept next to its items. */
export const LEGACY_WRAP_KEY = "__wrap-key";
const ITEM = "item:";
const enc = new TextEncoder();
/** v2 items are bound to their vault and their name, so one can't be swapped for another. */
const itemAd = (db: string, name: string) => enc.encode(`zerofee/vault/v2/${db}/${name}`);

type Item = { v?: 2; iv: Uint8Array; data: ArrayBuffer | Uint8Array };

async function sealItem(key: CryptoKey, db: string, name: string, bytes: Uint8Array): Promise<Item> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: itemAd(db, name) }, key, bytes as BufferSource));
  return { v: 2, iv, data };
}

/**
 * Move a vault made before the unlock under it: decrypt each item with the old key, encrypt it with `key`, and in one
 * write put them all and delete the old key. Returns how many items moved (0: nothing to move). An item that won't
 * decrypt stops it with nothing changed.
 */
export async function migrateLegacy(store: VaultStore, dbName: string, key: CryptoKey): Promise<number> {
  const old = (await store.get(LEGACY_WRAP_KEY)) as CryptoKey | undefined;
  if (!old) return 0;
  const puts: [string, unknown][] = [];
  for (const k of await store.keys()) {
    if (!k.startsWith(ITEM)) continue;
    const item = (await store.get(k)) as Item | undefined;
    if (!item || item.v === 2) continue;
    const name = k.slice(ITEM.length);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(item.iv), additionalData: enc.encode(name) }, old, item.data as BufferSource));
    try {
      puts.push([k, await sealItem(key, dbName, name, plain)]);
    } finally {
      plain.fill(0);
    }
  }
  await store.write(puts, [LEGACY_WRAP_KEY]);
  return puts.length;
}

/** What a vault's store holds: nothing, items from before the unlock (with their old key), or items under an unlock. */
export async function vaultKind(store: VaultStore): Promise<"empty" | "legacy" | "sealed"> {
  const keys = await store.keys();
  if (keys.includes(LEGACY_WRAP_KEY)) return "legacy";
  return keys.some((k) => k.startsWith(ITEM)) ? "sealed" : "empty";
}

export class BrowserVault implements Vault {
  readonly dbName: string;
  private readonly session: UnlockSession;
  private readonly store: VaultStore;
  private ready: { generation: number; key: Promise<CryptoKey> } | null = null;

  get lockScope(): string { return `idb:${this.dbName}`; }

  constructor(dbName = "zerofee-demo-vault", options: { session?: UnlockSession; store?: VaultStore } = {}) {
    this.dbName = dbName;
    this.session = options.session ?? vaultSession;
    this.store = options.store ?? new IdbStore(dbName);
  }

  /** This vault's key from the open session, after moving any items from before the unlock under it. */
  private key(): Promise<CryptoKey> {
    if (!this.session.unlocked) return Promise.reject(new VaultLockedError());
    const generation = this.session.generation;
    if (this.ready?.generation !== generation) {
      const key = (async () => {
        const k = await this.session.vaultKey(this.dbName);
        await migrateLegacy(this.store, this.dbName, k);
        return k;
      })();
      this.ready = { generation, key };
      key.catch(() => {
        if (this.ready?.key === key) this.ready = null;
      });
    }
    return this.ready.key;
  }

  async get(name: string): Promise<Uint8Array | null> {
    const key = await this.key();
    const item = (await this.store.get(`${ITEM}${name}`)) as Item | undefined;
    if (!item) return null;
    if (item.v !== 2) throw new Error("this vault item is from before the unlock and didn't move");
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(item.iv), additionalData: itemAd(this.dbName, name) }, key, item.data as BufferSource));
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    const key = await this.key();
    await this.store.write([[`${ITEM}${name}`, await sealItem(key, this.dbName, name, bytes)]]);
  }

  /** Every item sealed first, then one IndexedDB transaction: all of them are kept, or none. */
  async putAll(items: [string, Uint8Array][]): Promise<void> {
    const key = await this.key();
    const sealed = await Promise.all(items.map(async ([name, bytes]) => [`${ITEM}${name}`, await sealItem(key, this.dbName, name, bytes)] as [string, unknown]));
    await this.store.write(sealed);
  }

  async delete(name: string): Promise<void> {
    await this.key();
    await this.store.write([], [`${ITEM}${name}`]);
  }
}
