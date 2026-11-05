// Add money's address keys, kept in Home's sealed store (row 16, 4 Nov: the fresh address shown STAYS the same
// until the person taps Change wallet and says yes; never a new one on reopen or reload). The card keys (add-coins.ts
// cardKey: the same key gives the same address from the core) leave plain localStorage for Wallet's own device.store,
// sealed to the chip on the phone, as Home's job rows did (shell-api job-start.ts sealJobs). Never sent anywhere.
import type { Bridge } from "@zerofee/core/bridge";

/** Home's device.store key for Add's card keys. */
export const SEALED_ADD_CARDS = "add-cards.v1";
/** The old plain copy (add-coins.ts CARD_KEYS): joined once, then erased. */
const PLAIN_ADD_CARDS = "zf.addcard.v1";

type Store = Pick<Storage, "getItem" | "setItem">;
type Plain = Pick<Storage, "getItem" | "removeItem" | "setItem">;

/** One sealed copy: `store()` is the sealed one once `seal` has read it, else the plain one (so Add always works). */
export function addCards(plainOf: () => Plain | undefined = () => (typeof localStorage === "undefined" ? undefined : localStorage)) {
  let text: string | null = null;
  let sealedStore: Store | null = null;
  let sealing: Promise<boolean> | null = null;
  const seal = (bridge: Bridge): Promise<boolean> => {
    if (sealedStore) return Promise.resolve(true);
    sealing ??= (async () => {
      const r = await bridge.call<{ value: string | null }>("device.store.get", { key: SEALED_ADD_CARDS }).catch(() => null);
      // a store that won't answer: the plain copy stays, and the next open asks again
      if (!r || !("ok" in r)) return (sealing = null), false;
      const plain = plainOf();
      text = typeof r.ok?.value === "string" ? r.ok.value : null;
      try { text ??= plain?.getItem(PLAIN_ADD_CARDS) ?? null; } catch { /* no plain copy */ }
      // one writer: the newest text only, one write at a time (an older write never lands after a newer one)
      let next: string | null = null, busy = false;
      const go = async () => {
        busy = true;
        while (next !== null) { const value = next; next = null; await bridge.call("device.store.set", { key: SEALED_ADD_CARDS, value }).catch(() => undefined); }
        busy = false;
      };
      sealedStore = { getItem: () => text, setItem: (_k, v) => { text = v; next = v; if (!busy) void go(); } };
      // what the plain copy held is now sealed: written there once, then the plain copy is erased
      if (text !== null) sealedStore.setItem(SEALED_ADD_CARDS, text);
      try { plain?.removeItem(PLAIN_ADD_CARDS); } catch { /* nothing more to erase */ }
      return true;
    })();
    return sealing;
  };
  return { seal, store: (): Store | undefined => sealedStore ?? plainOf(), sealed: () => sealedStore !== null };
}

const shared = addCards();
/** Home's Add card keys: the sealed store once read, else plain localStorage. */
export const addCardStore = shared.store;
/** Read Home's sealed copy (Home calls it at boot, beside the job rows; Add waits for it before it picks a key). */
export const sealAddCards = shared.seal;
export const addCardsSealed = shared.sealed;
