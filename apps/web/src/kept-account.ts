// The open account as last seen on this device (its id and public keys only: no secret), so the next unlock opens Home
// at once from it and the figures kept here (D134), while the core's own read runs behind (account.state: two NEAR nodes,
// four round trips in a row, 1.4 s measured with no added latency). Kept every time Home shows an account, not only when
// that read answers: set-up's end and a restore open Home without it, so their next unlock waited for the read, behind
// "Reading your money from NEAR…" (unlock speed, 5 Nov).
// In a browser it lives in the sealed device.store (Wallet's, the vault the unlock opens), never plain localStorage: a
// locked browser shows no account id (QA, 5 Nov). A plain copy from before moves in on the first read after the
// unlock, then leaves localStorage. The phone has no web lock: its WebView's storage keeps it as before.
import type { Bridge } from "@zerofee/core/bridge";
import type { AccountInfo } from "@zerofee/core/signer";

/** The plain key (the phone's, and a browser's before 5 Nov: moved into the sealed store on the first read). */
export const ACCOUNT_KEPT = "zf.account";
/** Wallet's device.store key for it (sealed in the vault). */
export const SEALED_KEY = "account.kept";
/** How long Home's first render waits for the figures kept on this device (local: a few ms) before showing without them. */
export const PRIME_WAIT_MS = 150;
/** How long the first route waits for the kept account itself (the sealed store's first open) before reading the core's. */
export const KEPT_WAIT_MS = 1000;

type Local = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** The sealed store's one value, or none (the phone). Reads null while locked or when nothing is kept. */
export interface Sealed {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}
const local = (): Local | null => (typeof localStorage === "undefined" ? null : localStorage);

/** Wallet's sealed device.store, as the shell's own (Home is Wallet's). A refusal (locked) throws, so nothing is moved. */
export function sealedKept(wallet: Bridge): Sealed {
  return {
    async get() {
      const r = await wallet.call<{ value: string | null }>("device.store.get", { key: SEALED_KEY });
      if ("problem" in r) throw new Error(r.problem.code);
      return r.ok.value ?? null;
    },
    async set(value) {
      const r = await wallet.call("device.store.set", { key: SEALED_KEY, value });
      if ("problem" in r) throw new Error(r.problem.code);
    },
  };
}

const parse = (v: string | null): AccountInfo | null => {
  try {
    const a = JSON.parse(v ?? "null") as AccountInfo | null;
    return a && typeof a.accountId === "string" && Array.isArray(a.keys) ? a : null;
  } catch {
    return null;
  }
};

/** What was last written to the sealed store on this page: Home showing the same account again writes nothing. */
let written: string | null = null;

export async function keepAccount(a: AccountInfo, sealed: Sealed | null, store: Local | null = local()): Promise<void> {
  const v = JSON.stringify(a);
  try {
    if (!sealed) return void store?.setItem(ACCOUNT_KEPT, v);
    if (written === v) return;
    await sealed.set(v);
    written = v;
    store?.removeItem(ACCOUNT_KEPT);
  } catch {
    /* storage blocked or locked: the next launch reads it again */
  }
}

/** The kept account, null when none (or the store can't be read). A plain copy moves into the sealed store first. */
export async function keptAccount(sealed: Sealed | null, store: Local | null = local()): Promise<AccountInfo | null> {
  let plain: string | null = null;
  try {
    plain = store?.getItem(ACCOUNT_KEPT) ?? null;
  } catch {
    plain = null;
  }
  if (!sealed) return parse(plain);
  try {
    let v = await sealed.get();
    if (plain !== null) {
      if (v === null && parse(plain)) await sealed.set((v = plain));
      store?.removeItem(ACCOUNT_KEPT);
    }
    written = v;
    return parse(v);
  } catch {
    return null;
  }
}

/** The kept account, or null once `ms` passed without it (a slow first open of the sealed store): the core's read then. */
export function keptWithin(read: Promise<AccountInfo | null>, ms = KEPT_WAIT_MS): Promise<AccountInfo | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([read, new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(timer));
}

/** The account a screen shows as open, to keep: Home's, however it got there (the core's read, set-up's end, a restore). */
export const accountShown = (view: { k: string; account?: AccountInfo }): AccountInfo | null => (view.k === "home" && view.account ? view.account : null);

/**
 * Home from what this device kept: the figures' copy (waited on `waitMs` at most), then Home. False when no account is
 * kept: the caller waits for the core's read. Reads nothing that needs a key beyond the unlock already done; signs nothing.
 */
export async function openFromKept(kept: AccountInfo | null, prime: () => Promise<unknown>, show: (a: AccountInfo) => void, waitMs = PRIME_WAIT_MS): Promise<boolean> {
  if (!kept) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([prime().catch(() => undefined), new Promise((r) => (timer = setTimeout(r, waitMs)))]).finally(() => clearTimeout(timer));
  show(kept);
  return true;
}
