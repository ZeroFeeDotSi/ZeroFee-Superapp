// Which page the address asks for, and whether it runs on mainnet. Pure, so it can be tested without a browser.
//
//   /                 the real app (testnet)          /?mainnet          the real app on NEAR mainnet (real money, dust only)
//   /laptop, /?laptop the laptop as second signer     /laptop?mainnet    the same, on mainnet
//   /?demo, /?screens sample data: never on mainnet. `?mainnet` with either is refused, so a sample balance can't pass for a real one.
//
// D54: the real app's second device is its `/laptop` page (the same build; vercel.json serves index.html there); the
// public address the phone names is the product pick, SECOND_DEVICE_SITE (laptop.zerofee.si, its own origin). A browser is never its own account's second device:
// each page refuses a browser holding the other's key (K-8), and a pairing checks again (guardPairing).
//
// The PUBLIC build (VITE_ZEROFEE_PUBLIC=1, apps/web/deploy-app.sh) is the release people use, in two modes (WebMode):
// Sim (sample money, the demo page; a first visit, and `/?demo`) and Real (mainnet, no switch to testnet). The laptop
// page and the developers' pages and switches (`?screens`, `?all`, `?anycoin`) don't exist there: they read as the app.
//
// The SECOND-DEVICE build (VITE_ZEROFEE_TARGET=second-device): the laptop page alone, on mainnet, whatever the address
// says. Retired by D54 (its address was rejected: device.zerofee.si): no site serves it, its deploy and promote
// scripts are gone, and the phone never names it.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

export type Page = "app" | "laptop" | "demo" | "screens";
export type Mode = { page: Page; mainnet: boolean } | { refused: string };

export const MAINNET_REFUSAL = "Mainnet runs only the real app.";

/** Is this the public release build? Set at build time only (never by the address). */
export const PUBLIC_BUILD: boolean = import.meta.env?.VITE_ZEROFEE_PUBLIC === "1";
/** Is this the second-device build (the laptop page's own site)? Set at build time only (never by the address). */
export const SECOND_DEVICE_BUILD: boolean = import.meta.env?.VITE_ZEROFEE_TARGET === "second-device";
/**
 * D157: the ZeroFee Chrome extension's build (VITE_ZEROFEE_TARGET=extension, apps/extension/vite.app.config.ts): the app in
 * the extension's own page, Real only (mainnet), whatever the address says. Sim stays the website: no Sim | Real switch,
 * no sample link. Row 35 (product decision, 3 Nov): never a Sim, in any extension build: the old load check's sample build is gone
 * (apps/extension/vite.app.config.ts refuses VITE_ZEROFEE_EXTENSION_CHECK, and its no-Sim gate fails a build holding any
 * Sim module).
 */
export const EXTENSION_BUILD: boolean = import.meta.env?.VITE_ZEROFEE_TARGET === "extension";
/**
 * The second device's one fixed public address (H13). QA's ruling under product decision, 5 Nov (on
 * QA's MUST): its OWN origin, laptop.zerofee.si, not zerofee.si/laptop (that origin is the website's: any
 * script there, or a service worker at its /, could read or control the laptop's vault) and not superapp.zerofee.si
 * (the Sim). Its own Vercel project serves the laptop build alone (VITE_ZEROFEE_TARGET=second-device; build-laptop-site.sh)
 * with a strict CSP (laptopCsp, hosting.ts). Its WebAuthn RP ID is the host, "laptop.zerofee.si" (no rp.id is sent).
 * laptop-words.ts names it on mainnet (LAPTOP_SITE) only once check-laptop-site.sh passes.
 */
/** A self-hosted build names its own laptop page's host with VITE_SECOND_DEVICE_SITE (a bare host name); else ours. */
export const secondDeviceSite = (raw: string | undefined): string => {
  const v = raw?.trim().toLowerCase() ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : "laptop.zerofee.si";
};
export const SECOND_DEVICE_SITE = secondDeviceSite(import.meta.env?.VITE_SECOND_DEVICE_SITE);
/** The laptop page's path in the real app's build (D54). */
export const LAPTOP_PATH = "/laptop";
const isLaptopPath = (path: string) => path.replace(/\/+$/, "") === LAPTOP_PATH;

/**
 * The public build's two modes (product decision, 3 Nov): SIM, the whole app on sample money (the demo page: the MockBridge
 * and the sample data, no core, no key, nothing real touched), and REAL, the person's own account on mainnet. The choice
 * is kept in this browser (WEB_MODE_KEY); a first visit is Sim. Switching reloads the page (switchWebMode), so nothing
 * in memory crosses, and Sim's storage is its own (sim-storage.ts).
 */
export type WebMode = "sim" | "real" | "web";
export const WEB_MODE_KEY = "zf.web.mode";
export const FIRST_WEB_MODE: WebMode = "sim";
type Kv = Pick<Storage, "getItem" | "setItem">;
const browserKv = (): Kv | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
/**
 * This tab's own mode (a web test, 4 Nov: a Sim tab reloaded into another tab's web wallet and its lock, since
 * the kept choice is one per browser). sessionStorage is the tab's own and outlives its reloads: a reload stays in the
 * mode the tab was in; a new tab starts from the browser's kept choice. Its key is shared by Sim and Real (sim-storage).
 */
const tabKv = (): Kv | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const known = (v: string | null | undefined): WebMode | null => (v === "real" || v === "sim" || v === "web" ? v : null);
/** This tab's mode if it has one, else the browser's kept choice; anything missing, unreadable or unknown is a first
 *  visit (Sim). */
export function savedWebMode(store: Kv | null = browserKv(), tab: Kv | null = store === null || store === browserKv() ? tabKv() : null): WebMode {
  let own: WebMode | null = null;
  try {
    own = known(tab?.getItem(WEB_MODE_KEY));
  } catch {
    own = null;
  }
  if (own) return own;
  try {
    return known(store?.getItem(WEB_MODE_KEY)) ?? FIRST_WEB_MODE;
  } catch {
    return FIRST_WEB_MODE;
  }
}
/** Keep the choice, for this browser and this tab. A store that refuses keeps nothing (the next load is Sim, the safe side). */
export function keepWebMode(mode: WebMode, store: Kv | null = browserKv(), tab: Kv | null = store === null || store === browserKv() ? tabKv() : null): void {
  for (const kv of [store, tab]) {
    try {
      kv?.setItem(WEB_MODE_KEY, mode);
    } catch {
      // blocked storage: the next load starts in Sim
    }
  }
}
/** The page's mode, kept as this tab's own as it loads: another tab's switch never changes what a reload here opens. */
export function pinTabMode(mode: WebMode, tab: Kv | null = tabKv()): void {
  try {
    tab?.setItem(WEB_MODE_KEY, mode);
  } catch {
    // blocked storage: a reload reads the browser's choice
  }
}

export function parseMode(search: string, publicBuild = PUBLIC_BUILD, secondDeviceBuild = SECOND_DEVICE_BUILD, path = "/", webMode: WebMode = publicBuild ? savedWebMode() : FIRST_WEB_MODE, extensionBuild = EXTENSION_BUILD): Mode {
  const q = new URLSearchParams(search);
  if (isLaptopPath(path)) q.set("laptop", "");
  // The second device's own site: the laptop page, on mainnet, and nothing else (no demo, no app, no testnet switch).
  if (secondDeviceBuild) return { page: "laptop", mainnet: true };
  // D157, row 35: the extension is the real app on mainnet, and nothing else, whatever the address or a kept choice says.
  if (extensionBuild) return { page: "app", mainnet: true };
  if (publicBuild) {
    // D157 (product decision, 3 Nov): the public site is the Sim, and real money is the iPhone app and the extension.
    // Product decision, 4 Nov: the WEB WALLET, the public site's real mode like a normal wallet: the hot wallets from the
    // 24 words, kept in this browser under a password, NO Safe (no account contract, passkey, Secure Enclave, recovery
    // wait or second device). Chosen only by the kept choice "web" (switchWebMode), never by the address.
    return webMode === "web" ? { page: "app", mainnet: true } : { page: "demo", mainnet: false };
  }
  const mainnet = q.has("mainnet");
  if (mainnet && (q.has("demo") || q.has("screens"))) return { refused: MAINNET_REFUSAL };
  const page: Page = q.has("laptop") ? "laptop" : q.has("demo") ? "demo" : q.has("screens") ? "screens" : "app";
  return { page, mainnet };
}

/**
 * `ANY_COIN_START`: the funding screen's "Or send any coin" link. Off in the real app until the dust proof says 1Click
 * pays native NEAR (D13: it works or it isn't offered). On in the sample pages (`?demo`, `?screens`), and in the real
 * app only by hand with `?anycoin`, and never on mainnet (audit W-2/H-4: an unproven route can't be switched on where
 * the money is real). A parameter that merely contains the word is not the switch.
 */
export function anyCoinOn(search: string, publicBuild = PUBLIC_BUILD, secondDeviceBuild = SECOND_DEVICE_BUILD, webMode: WebMode = publicBuild ? savedWebMode() : FIRST_WEB_MODE): boolean {
  const q = new URLSearchParams(search);
  if (secondDeviceBuild || EXTENSION_BUILD) return false;
  if (publicBuild) return true; // D157: the Sim only
  void webMode;
  if (q.has("mainnet")) return false;
  return q.has("anycoin") || q.has("demo") || q.has("screens");
}

/** The vault that holds this page's account key, by network (core.ts: mainnet's own name, testnet BrowserVault's default). */
export const appVaultName = (mainnet: boolean) => (mainnet ? VAULT_NAMES.app : "zerofee-demo-vault");
/**
 * Audit K-8: the laptop is a SECOND device only if its key lives somewhere else. A browser whose origin already holds
 * the account's key (the app vault) can't be its own second device: same origin, same page code, one compromise takes
 * both. `names` is indexedDB.databases()'s list; null (the browser can't list them) refuses too, fail closed.
 */
export function laptopRefusedHere(names: readonly string[] | null, mainnet: boolean): boolean {
  return names === null || names.includes(appVaultName(mainnet));
}
/** The vault that holds this page's laptop (second-device) key, by network (laptop/Laptop.tsx). */
export const laptopVaultName = (mainnet: boolean) => (mainnet ? VAULT_NAMES.laptop : "zerofee-laptop");
/**
 * K-8, the app's side: a browser that holds a laptop (second-device) key can't also hold the account it guards. Refused
 * only when a laptop vault is seen: where the browser can't list its vaults, the laptop page already refuses to make one,
 * so the two can't meet through our pages.
 */
export function appRefusedHere(names: readonly string[] | null, mainnet: boolean): boolean {
  return names !== null && names.includes(laptopVaultName(mainnet));
}
export const APP_SAME_BROWSER =
  "This browser is already a second device. Use another one, or your phone.";
export const LAPTOP_SAME_BROWSER =
  "This browser holds your account. Open this page on another computer.";
export const PAIR_SAME_BROWSER =
  "That code is from this same browser, so nothing was added. Use another computer.";

/**
 * D54: the laptop page shares the app's address, so two tabs opened at once could each pass their K-8 check before
 * either key exists. The pairing itself checks again: while this browser holds a laptop key for this network, the app
 * here pairs nothing (any kind), with one plain line. `names` lists the browser's vaults (null: can't tell, and then
 * the laptop page made no key here).
 */
export function guardPairing(bridge: Bridge, names: () => Promise<readonly string[] | null>, mainnet: boolean): Bridge {
  return {
    call: async <T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> => {
      if (method === "account.secondDevice.pair" && appRefusedHere(await names().catch(() => null), mainnet)) {
        return { problem: { code: "shell.pair.same-browser", whatHappened: PAIR_SAME_BROWSER, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } };
      }
      return bridge.call<T>(method, params);
    },
    on: bridge.on.bind(bridge),
  };
}

/** This page's mode, read once from the address. */
export const MODE: Mode = parseMode(typeof location === "undefined" ? "" : location.search, PUBLIC_BUILD, SECOND_DEVICE_BUILD, typeof location === "undefined" ? "/" : location.pathname);
/** True on a mainnet page (never true when the address was refused). */
export const MAINNET = "page" in MODE && MODE.mainnet;
/** True on a sample-money page (Sim in the public build, `?demo` elsewhere): never true on mainnet. */
export const SIM = "page" in MODE && MODE.page === "demo";
/** The Sim | Real switch: since D157 the public site was the Sim only. Product decision, 4 Nov: the public site's Real is
 *  the web wallet ("web": hot wallets, no Safe), so the switch is back there (never in the extension, D157). */
export const WEB_MODES = PUBLIC_BUILD && !EXTENSION_BUILD;
/** Welcome's "see it with sample money" link (`/?demo`): never in the extension (D157: Sim stays the website). */
export const SAMPLE_LINK = !EXTENSION_BUILD;
/** Welcome's one link to the other mode (Copywriter, 3 Nov). */
export const TO_SIM = "Try it with pretend money first";
export const TO_REAL = "Use real money instead";
/** Switch modes: kept, then the page starts again at `/` (no `?demo`), so nothing of the other mode stays in memory. */
export function switchWebMode(mode: WebMode): void {
  keepWebMode(mode);
  location.replace("/");
}
/** Welcome's link to the other mode, in the public build only. */
export const otherMode = (sim: boolean = SIM): { label: string; go: () => void } | undefined =>
  WEB_MODES ? (sim ? { label: TO_REAL, go: () => switchWebMode("web") } : { label: TO_SIM, go: () => switchWebMode("sim") }) : undefined;
/**
 * A browser serves `/` and `/?mainnet` from one origin, so they would share localStorage and IndexedDB. App-facing
 * device keys and the device-secrets vault therefore carry `mainnet:` on mainnet only (testnet names are unchanged, so
 * nothing already kept moves). The theme stays shared. On the phone one build runs one network, so nothing changes.
 */
export const networkPrefix = (mainnet: boolean) => (mainnet ? "mainnet:" : "");
/** The localStorage key for an app's device.store value (and Security's own local activity). */
export const storeSlot = (app: string, key: string, mainnet: boolean = MAINNET) => `${networkPrefix(mainnet)}zf.${app}.${key}`;
/** The browser vault that holds the apps' device.secret values. */
export const secretsVaultName = (mainnet: boolean = MAINNET) => `${networkPrefix(mainnet)}zerofee-device-secrets`;
/** True when the funding screen offers "Or send any coin". */
export const ANY_COIN_START = anyCoinOn(typeof location === "undefined" ? "" : location.search);
/** Mainnet keys and testnet keys never share a vault. (The testnet app keeps BrowserVault's default name.) */
export const VAULT_NAMES = { app: "zerofee-mainnet-vault", laptop: "zerofee-laptop-mainnet" } as const;

/**
 * The web wallet (product decision, 4 Nov): the public build in its "web" mode. The three hot wallets (SOL, ETH (RH),
 * NEAR) from the 24 words, the words and keys sealed in this browser under a password, and no Safe: nothing that needs
 * the account contract or the phone's Secure Enclave is shown (Move, Private, Safe, AgentZero's wallet, Devices,
 * Protection). Everything that asks "is there a Safe here?" reads this one flag.
 */
export const WEB_WALLET: boolean = PUBLIC_BUILD && savedWebMode() === "web";
