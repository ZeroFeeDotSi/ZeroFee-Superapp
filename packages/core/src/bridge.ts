// The bridge every app uses to reach the trusted core (owned by S1).
//
// On the iPhone, the app UI runs in a web view and the trusted core runs in a separate, isolated JavaScript context owned
// by the native layer. The bridge carries JSON between them, so nothing in the UI can reach a key, build signed bytes or
// draw the approval sheet. In the web demo, the same interface is backed by an in-page demo core (clearly labelled demo,
// testnet or dust only). Methods and events are listed in docs/interfaces.md.
import type { Problem } from "./problem.ts";
import type { Requester } from "./signer.ts";

export type BridgeResult<T> = { ok: T } | { problem: Problem };

export interface Bridge {
  /** Never throws for an expected failure: those come back as `{ problem }`, which the app shows as its screen. */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>>;
  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T = unknown>(event: string, handler: (payload: T) => void): () => void;
}

/** Core methods every app may call (exact names). The rest of the core belongs to ZeroFee's own screens: protection,
 *  recovery, keys, running or cancelling a held request, and the approval sheet. */
const EVERY_APP = ["account.state", "account.id", "account.activity", "account.protection.get", "account.waiting", "account.waiting.status", "account.nearPrice", "tx.describe", "tx.request", "card.check", "card.balance"];
/** AgentZero's balance, read only (Home's row and the one total): Wallet, Trade and Pay may ask it, nothing else of account.agent.*. */
const AZ_BALANCE = "account.agent.balance";
/** Families one app may call besides (a name ending in "." is a family). */
const APP_EXTRA: Partial<Record<Requester, string[]>> = {
  // and a swap's dry price (D74's swapQuote: read only, no address, nothing payable), for AgentZero's quote_dry
  agent: ["account.agent.", "subwallet.float.swapQuote"],
  // and perps on Hyperliquid's test network (D119), Trade's only
  // (and AgentZero's balance, read only: Trade's and Pay's totals are Home's, BalanceTotal.ts)
  trade: ["subwallet.", "perps.", AZ_BALANCE],
  extension: ["subwallet."],
  browser: ["subwallet."],
  // The apps in Apps: the chain wallets they share with Trade, Browser and Chat (the core's KINDS_OF, D55).
  social: ["subwallet."],
  pay: ["subwallet.", AZ_BALANCE],
  // Wallet: its private pocket only (kind "private"); and AgentZero's balance, read only, for Home's row and total
  // (QA 5 Nov: AgentZero's money was counted nowhere on Home). Never the rest of account.agent.*.
  wallet: ["subwallet.", AZ_BALANCE],
  // ZeroFee Chat (D55): its name in a place, its signed messages and its private messages (nostr.publicKey,
  // nostr.sign, nostr.seal, nostr.open). No other app's, and nothing of subwallet.* (D143: a chain wallet's Send is
  // Wallet's own Hold only; Chat pays from the private balance).
  chat: ["nostr."],
};

/** May this app call this method? Services (ledger.*, device.*) answer for themselves; core methods are allowlisted. */
export function appMayCall(app: Requester, method: string): boolean {
  if (!CORE_NAMES.includes(method.split(".")[0])) return true;
  return [...EVERY_APP, ...(APP_EXTRA[app] ?? [])].some((m) => (m.endsWith(".") ? method.startsWith(m) : method === m));
}

/**
 * The bridge as one app sees it. The shell keeps the full bridge for its own screens and its approval sheet, and hands
 * each app `forApps(bridge, appId)`:
 * - only the core methods that app needs (`appMayCall`); never `approval.*`;
 * - its id stamped on every `tx.*` request (an app can't pose as another app, or as ZeroFee, in the hint under the
 *   approval words), on every `device.*` and `subwallet.*` call (its own storage and its own kind of wallet only), and
 *   as `caller` on every service call (a service signs as the app that asked, never as itself).
 */
export function forApps(bridge: Bridge, app: Exclude<Requester, "security">): Bridge {
  // One wrapper per (bridge, app), so a screen that calls forApps while it renders gets the same object every time:
  // a fresh one each render re-ran every hook keyed on it, and Settings re-read the sites list for ever (grade 01c, P1).
  let mine = made.get(bridge);
  if (!mine) made.set(bridge, (mine = new Map()));
  let wrapped = mine.get(app);
  if (!wrapped) mine.set(app, (wrapped = wrap(bridge, app)));
  return wrapped;
}
const made = new WeakMap<Bridge, Map<string, Bridge>>();

function wrap(bridge: Bridge, app: Exclude<Requester, "security">): Bridge {
  if ((app as string) === SHELL_APP || !app) throw new Error("an app's bridge is never ZeroFee's own screens");
  // Audit pass 2, item 2: every core call an app makes carries its id (the core refuses a call that names no one), so
  // nothing an app sends can reach the core as ZeroFee's own screens; and whatever `app` or `shell` it puts in its
  // params, its own id is what arrives.
  const stamp = (method: string, params?: Record<string, unknown>) => {
    if (method.startsWith("device.") || method.startsWith("subwallet.") || method.startsWith("nostr.") || method.startsWith("perps.")) return { ...params, app };
    if (!CORE_NAMES.includes(method.split(".")[0])) return { ...params, caller: app };
    const request = params?.request;
    if (!method.startsWith("tx.") || !request || typeof request !== "object") return { ...params, app };
    return { ...params, app, request: { ...(request as object), from: app } };
  };
  return {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (!appMayCall(app, method)) {
        return Promise.resolve({
          problem: {
            code: "security.bridge.not-allowed",
            whatHappened: method === "account.agent.spend" ? "Only AgentZero can make its payments." : method.startsWith("approval") ? "Only ZeroFee's own approval screen can answer that." : "Only ZeroFee's own screens can do that.",
            money: { state: "not-involved" },
            next: { kind: "nothing", label: "Go back" },
            more: method,
          },
        });
      }
      return bridge.call<T>(method, stamp(method, params));
    },
    on<T>(event: string, handler: (payload: T) => void): () => void {
      return event === "approval" || event.startsWith("approval.") ? () => {} : bridge.on<T>(event, handler);
    },
  };
}

/**
 * Audit pass 2, item 2: the id ZeroFee's own screens stamp on their core calls. The core never takes a call that names
 * no one (no `app`, or an empty one) as theirs: only this id, which only the shell's own bridge stamps (`asShell`, in
 * front of the core in apps/web/src/core.ts) and which `forApps` never lets an app send.
 */
export const SHELL_APP = "shell";

/**
 * The shell's own bridge to the core: every call that names no app is stamped as ZeroFee's own screens. It sits in
 * front of the core only (an app's calls reach it through `forApps`, already stamped with that app's id).
 */
export function asShell(core: Bridge): Bridge {
  return {
    call<T>(method: string, params?: Record<string, unknown>) {
      return core.call<T>(method, params?.app === undefined ? { ...params, app: SHELL_APP } : params);
    },
    on: (event, handler) => core.on(event, handler),
  };
}

/** Method families only the trusted core answers. */
export const CORE_NAMES = ["account", "recovery", "tx", "approval", "subwallet", "card", "alerts", "secondDevice", "nostr", "perps", "site2fa", "sitemail"];

/**
 * One bridge in front of several answerers. A method goes to the service registered for its first word
 * (`ledger.balances` → services.ledger), anything else to the trusted core. Services are app code that runs outside the
 * trusted core: they reach signatures only through `tx.request` on the core, like any app.
 */
export function routeBridge(core: Bridge, services: Record<string, Bridge>): Bridge {
  for (const name of Object.keys(services)) {
    if (CORE_NAMES.includes(name)) throw new Error(`"${name}" belongs to the trusted core; a service can't answer it`);
  }
  const pick = (name: string) => services[name.split(".")[0]] ?? core;
  return {
    call<T>(method: string, params?: Record<string, unknown>) {
      return pick(method).call<T>(method, params);
    },
    on<T>(event: string, handler: (payload: T) => void) {
      return pick(event).on<T>(event, handler);
    },
  };
}
