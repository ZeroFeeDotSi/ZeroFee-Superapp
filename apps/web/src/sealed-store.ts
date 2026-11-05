// device.store on the web, sealed (audit M4, 3 Nov): every app's values (AgentZero's chats and payees, the account's
// figures, deposit addresses, a site wallet's dollars) were plain localStorage, readable by anything that steals a browser
// profile. They live in the device vault now, encrypted with the person's passkey or passcode (BrowserVault), as one
// item read once after the unlock into memory: a get is a map read, a set changes the map and writes it sealed again
// (writes made meanwhile share the next one). Values kept plain before move in on that first read, then leave
// localStorage. Locked (no unlock yet): nothing is read or kept.

/** The vault item that holds every app's values. */
export const STORE_ITEM = "device-store.v1";

export interface SealedStoreDeps {
  /** The device vault (its key from the unlock); throws while locked. */
  vault: { get(name: string): Promise<Uint8Array | null>; put(name: string, bytes: Uint8Array): Promise<void> };
  /** Where values were kept before (localStorage). */
  local: Pick<Storage, "getItem" | "removeItem" | "key" | "length">;
  /** A localStorage key that is a device.store slot ("zf.<app>.<key>", "mainnet:" first on mainnet). */
  isSlot: (key: string) => boolean;
}

export interface SealedStore {
  get(slot: string): Promise<string | null>;
  set(slot: string, value: string | null): Promise<void>;
}

export function sealedStore(d: SealedStoreDeps): SealedStore {
  let map: Map<string, string> | null = null;
  let opening: Promise<Map<string, string>> | null = null;
  const seal = (m: Map<string, string>) => d.vault.put(STORE_ITEM, new TextEncoder().encode(JSON.stringify(Object.fromEntries(m))));

  /** The values, read once after the unlock (and the plain ones from before moved in: written sealed first, then removed). */
  const open = (): Promise<Map<string, string>> =>
    (opening ??= (async () => {
      const raw = await d.vault.get(STORE_ITEM);
      const kept: unknown = raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
      const m = new Map<string, string>(kept && typeof kept === "object" ? Object.entries(kept as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string") : []);
      const plain: string[] = [];
      for (let i = 0; i < d.local.length; i++) {
        const k = d.local.key(i);
        if (k && d.isSlot(k)) plain.push(k);
      }
      if (plain.length) {
        for (const k of plain) if (!m.has(k)) m.set(k, d.local.getItem(k) ?? "");
        await seal(m);
        for (const k of plain) d.local.removeItem(k);
      }
      map = m;
      return m;
    })().catch((e) => {
      opening = null;
      throw e;
    }));

  // One write at a time; every change made while one is under way goes in the one after it (shared by all of them).
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const write = (): Promise<void> => {
    if (queued) return queued;
    if (!running) return (running = seal(map!).finally(() => (running = null)));
    return (queued = running.catch(() => undefined).then(() => {
      queued = null;
      return write();
    }));
  };

  return {
    async get(slot) {
      return (map ?? (await open())).get(slot) ?? null;
    },
    async set(slot, value) {
      const m = map ?? (await open());
      if (value === null) m.delete(slot);
      else m.set(slot, value);
      await write();
    },
  };
}
