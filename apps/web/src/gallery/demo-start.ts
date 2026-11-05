// Where the public web demo opens (product decision, 30 Oct): a first-time visitor always at the very beginning, Welcome, the
// same start the iPhone app has, then set-up (the wait, the 24 words, the check), then Home. A visitor who already set
// up an account in this browser opens on Home. Nothing else is ever a default: a recovery, a waiting move or any other
// mid-flow screen shows only after the visitor starts it. Pure, so it is tested without a browser (demo-start.test.ts).

/** The one thing kept: that set-up was finished here, and with which recovery wait. */
export const DEMO_SETUP_KEY = "zf.demo.setup";
/** The set-up waits on offer (D49: 48 hours, 3, 7, 14, 30 days), and 24 hours kept by a visitor who chose it before:
 *  anything else kept is ignored. */
const WAITS = new Set([86_400, 172_800, 259_200, 604_800, 1_209_600, 2_592_000]);

export type DemoStart = { at: "welcome" } | { at: "home"; delaySeconds: number };

/** A store as the browser's localStorage is: any call may throw (blocked storage, a private window). */
export interface Kept { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

const browserStore = (): Kept | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Where this visitor starts. Anything unreadable, missing or unknown is a first visit. */
export function demoStart(store: Kept | null = browserStore()): DemoStart {
  try {
    const raw = store?.getItem(DEMO_SETUP_KEY);
    const seconds = raw ? Number(JSON.parse(raw)?.delaySeconds) : NaN;
    return WAITS.has(seconds) ? { at: "home", delaySeconds: seconds } : { at: "welcome" };
  } catch {
    return { at: "welcome" };
  }
}

/** Set-up finished: kept so the next visit opens on Home. A store that refuses only means the next visit starts over. */
export function keepDemoSetup(delaySeconds: number, store: Kept | null = browserStore()): void {
  try {
    store?.setItem(DEMO_SETUP_KEY, JSON.stringify({ delaySeconds }));
  } catch {
    // blocked storage: nothing kept, the next visit starts at Welcome
  }
}

/** Start over: forget it, so the next screen is Welcome. */
export function forgetDemoSetup(store: Kept | null = browserStore()): void {
  try {
    store?.removeItem(DEMO_SETUP_KEY);
  } catch {
    // nothing kept to forget
  }
}

/** This browser's own sample account name on `?demo` (this computer only, never the public build): made once, kept. */
export const DEMO_ACCOUNT_KEY = "zf.demo.account";
const OWN_ID = /^zf-sample\d{6}\.testnet$/;

/** The sample account name this browser uses, `zf-sample123456.testnet`: the kept one, or a new one kept for next time
 *  (two browsers are two people: J3 C1, one pays the other's Chat request). A store that refuses gives a new one each load. */
export function demoAccountId(store: Kept | null = browserStore(), random: () => number = Math.random): string {
  try {
    const kept = store?.getItem(DEMO_ACCOUNT_KEY);
    if (kept && OWN_ID.test(kept)) return kept;
  } catch {
    // blocked storage: a new name, not kept
  }
  const id = `zf-sample${String(Math.floor(random() * 1e6)).padStart(6, "0")}.testnet`;
  try {
    store?.setItem(DEMO_ACCOUNT_KEY, id);
  } catch {
    // not kept: the next load makes another
  }
  return id;
}

/** The sample account as the visitor left it (MockBridge's own snapshot: sends, held payments, waiting changes, balances,
 *  Trade's records) and the sample trading wallets' coins, so a reload carries on where it was (grade 30 Oct, item 7). */
export const DEMO_STATE_KEY = "zf.demo.state";
export const DEMO_WALLETS_KEY = "zf.demo.wallets";

/** What keeps the session: a storage that never throws (a blocked one keeps nothing, and the demo still runs), and
 *  `forget`, which Start over calls: it drops what was kept AND stops any later save (the page's own last save, on its
 *  way out, would otherwise put it back). */
export interface DemoKeep { storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }; forget(): void }

/** `fresh`: a first visit (no set-up kept): anything left over from an earlier session is dropped first, so a new
 *  account never opens on someone else's sends. */
export function demoKeep(store: Kept | null = browserStore(), fresh = demoStart(store).at === "welcome"): DemoKeep {
  let stopped = false;
  const drop = () => {
    for (const k of [DEMO_STATE_KEY, DEMO_WALLETS_KEY]) {
      try {
        store?.removeItem(k);
      } catch {
        // blocked storage: nothing was kept
      }
    }
  };
  if (fresh) drop();
  return {
    storage: {
      getItem(key) {
        try {
          return store?.getItem(key) ?? null;
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        if (stopped) return;
        try {
          store?.setItem(key, value);
        } catch {
          // full or blocked: this session just won't survive a reload
        }
      },
    },
    forget() {
      stopped = true;
      drop();
    },
  };
}
