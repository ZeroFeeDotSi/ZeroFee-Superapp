// The web unlock's steps (audit K-1), apart from the screens so they can be tested without a browser: what this device
// holds, locking it the first time (and moving vaults from before the unlock under it), opening it, and clearing it
// when the passkey or passcode is lost (the 24 words bring everything back).
import { BrowserVault, IdbStore, MemoryStore, vaultKind, type VaultStore } from "@zerofee/core/vault";
import { originLock } from "@zerofee/core/origin-lock";
import { WrongSecretError, afterWrongPasscode, passcodeWaitMs, setUpPasscode, setUpPasskey, unlock, type PasskeyRecord, type UnlockRecord, type UnlockSession } from "@zerofee/core/unlock";

/** A passcode try before its wait is over (re-audit K2-3): nothing was tried. `waitMs`: how long is left. */
export class TooSoonError extends Error {
  readonly waitMs: number;
  constructor(waitMs: number) {
    super("wait before trying again");
    this.name = "TooSoonError";
    this.waitMs = waitMs;
  }
}

/**
 * A lock made in another tab of this browser while this one still showed set-up (QA): nothing is written, so the
 * other tab's root (and every vault sealed under it) stays the one that opens.
 */
export class AlreadyLockedError extends Error {
  constructor() {
    super("this browser was locked in another tab");
    this.name = "AlreadyLockedError";
  }
}

/** One read-then-write of the sealed root at a time, in every tab of this origin (originLock): set-up, a passcode try and
 *  the web wallet's password check (web-password.ts) all take it. */
// Not re-entrant (originLock): nothing that runs inside a RECORD_LOCK section may call passwordOk or openWithPasscode,
// which take this lock themselves, or it waits on itself forever (review, QA).
export const RECORD_LOCK = "unlock-record";

/** Where the sealed root lives: its own database, apart from every vault. */
export const UNLOCK_DB = "zerofee-unlock";
const RECORD = "record";

/**
 * Every ZeroFee vault in a browser (testnet and mainnet): the app's, the apps' secrets, the laptop's and the
 * guardian's. The unlock covers each one.
 */
export const isVaultName = (name: string) => /^(mainnet:)?zerofee-(demo-vault|mainnet-vault|device-secrets|laptop|laptop-mainnet|guardian)$/.test(name);

export type VaultSummary = { name: string; kind: "empty" | "legacy" | "sealed" };

/** What the unlock reads and writes on this device. */
export interface UnlockDevice {
  readRecord(): Promise<UnlockRecord | null>;
  writeRecord(record: UnlockRecord): Promise<void>;
  vaults(): Promise<VaultSummary[]>;
  /** A vault's store, for moving it under the unlock. */
  store(name: string): VaultStore;
  /** Delete every vault and the sealed root. */
  clear(): Promise<void>;
}

/** This browser: IndexedDB. */
export function browserDevice(): UnlockDevice {
  const unlockStore = new IdbStore(UNLOCK_DB);
  const stores = new Map<string, IdbStore>();
  const store = (name: string) => {
    let s = stores.get(name);
    if (!s) stores.set(name, (s = new IdbStore(name)));
    return s;
  };
  return {
    readRecord: async () => ((await unlockStore.get(RECORD)) as UnlockRecord | undefined) ?? null,
    writeRecord: (record) => unlockStore.write([[RECORD, record]]),
    async vaults() {
      const all = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      const names = all.map((d) => d.name ?? "").filter(isVaultName);
      return Promise.all(names.map(async (name) => ({ name, kind: await vaultKind(store(name)) })));
    },
    store,
    async clear() {
      const names = [UNLOCK_DB, ...(await this.vaults()).map((v) => v.name)];
      unlockStore.close();
      for (const s of stores.values()) s.close();
      await Promise.all(
        names.map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
              // Another tab holds it open: it goes once that tab closes; this page reloads either way.
              req.onblocked = () => resolve();
            }),
        ),
      );
    },
  };
}

/** Tests: the same, in memory. */
export function memoryDevice(vaults: Record<string, MemoryStore> = {}): UnlockDevice & { stores: Record<string, MemoryStore>; record: UnlockRecord | null } {
  const dev = {
    stores: vaults,
    record: null as UnlockRecord | null,
    readRecord: async () => dev.record,
    writeRecord: async (r: UnlockRecord) => {
      dev.record = r;
    },
    vaults: async () => Promise.all(Object.entries(dev.stores).map(async ([name, s]) => ({ name, kind: await vaultKind(s) }))),
    store: (name: string) => (dev.stores[name] ??= new MemoryStore()),
    clear: async () => {
      dev.record = null;
      for (const k of Object.keys(dev.stores)) delete dev.stores[k];
    },
  };
  return dev;
}

export type Start =
  /** Locked: open it with this record's passkey or passcode. */
  | { k: "locked"; record: UnlockRecord }
  /** Nothing locked yet. `legacy`: vaults from before the unlock wait to move under it. `passkey`: PRF can be offered. */
  | { k: "setup"; legacy: boolean; passkey: boolean }
  /** Vaults sealed under an unlock this device no longer has: only the words bring the bank back. */
  | { k: "lost" };

export async function start(device: UnlockDevice, passkeyAvailable: () => Promise<boolean>): Promise<Start> {
  const record = await device.readRecord();
  if (record) return { k: "locked", record };
  const vaults = await device.vaults();
  if (vaults.some((v) => v.kind === "sealed")) return { k: "lost" };
  return { k: "setup", legacy: vaults.some((v) => v.kind === "legacy"), passkey: await passkeyAvailable() };
}

/** Once open: every vault from before the unlock moves under it now (not only when next read), so none stays readable. */
async function moveLegacy(device: UnlockDevice, session: UnlockSession): Promise<void> {
  for (const v of await device.vaults()) if (v.kind === "legacy") await new BrowserVault(v.name, { session, store: device.store(v.name) }).get("__moved");
}

async function keep(device: UnlockDevice, session: UnlockSession, record: UnlockRecord): Promise<void> {
  try {
    // Read again under the origin's lock (QA): a tab opened before another made the lock never writes over it.
    await originLock(RECORD_LOCK, async () => {
      if (await device.readRecord()) throw new AlreadyLockedError();
      await device.writeRecord(record);
    });
  } catch (e) {
    // Not kept: nothing may be written under a root no one could open again.
    session.lock();
    throw e;
  }
  await moveLegacy(device, session);
}

/** Lock with a new passkey. "no-prf": this passkey or browser can't seal with it; the person chooses a passcode. */
export async function lockWithPasskey(device: UnlockDevice, session: UnlockSession, create: () => Promise<{ credentialId: Uint8Array; prfSalt: Uint8Array; prf: Uint8Array } | null>): Promise<"done" | "no-prf"> {
  const made = await create();
  if (!made) return "no-prf";
  await keep(device, session, await setUpPasskey(session, made));
  return "done";
}

/** `refuse`: the rule a new one must pass (the web wallet's password: passwordRefusal, 12 at least). */
export async function lockWithPasscode(device: UnlockDevice, session: UnlockSession, passcode: string, refuse?: (passcode: string) => string | null): Promise<void> {
  await keep(device, session, await setUpPasscode(session, passcode, refuse));
}

export async function openWithPasskey(device: UnlockDevice, session: UnlockSession, record: PasskeyRecord, prf: (credentialId: Uint8Array, prfSalt: Uint8Array) => Promise<Uint8Array>): Promise<void> {
  const next = await unlock(session, record, { prf: await prf(record.credentialId, record.prfSalt) });
  if (next) await device.writeRecord(next);
  await moveLegacy(device, session);
}

/**
 * A wrong passcode throws WrongSecretError, opens nothing, and is counted in the record (the next try waits longer); a
 * try while one waits throws TooSoonError and tries nothing. The record is read fresh each time, under the origin's lock,
 * so another tab's wrong tries count too. A right one clears the count, and seals a record from weaker settings again.
 */
export async function openWithPasscode(device: UnlockDevice, session: UnlockSession, passcode: string, now: () => number = Date.now): Promise<void> {
  // One try at a time across every tab (QA): N tabs never get N tries per wait, and no count is lost.
  await originLock(RECORD_LOCK, () => tryPasscode(device, session, passcode, now));
  await moveLegacy(device, session);
}

async function tryPasscode(device: UnlockDevice, session: UnlockSession, passcode: string, now: () => number): Promise<void> {
  const record = await device.readRecord();
  if (!record || record.method !== "passcode") throw new WrongSecretError();
  const wait = passcodeWaitMs(record, now());
  if (wait > 0) throw new TooSoonError(wait);
  let next: UnlockRecord | null;
  try {
    next = await unlock(session, record, { passcode });
  } catch (e) {
    if (e instanceof WrongSecretError) await device.writeRecord(afterWrongPasscode(record, now()));
    throw e;
  }
  if (next) await device.writeRecord(next);
}
