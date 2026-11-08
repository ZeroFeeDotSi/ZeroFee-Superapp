// The web demo's connection to the trusted core (S1's DemoCore, testnet, software key) and the host's device methods.
//
// The shell keeps the full bridge: only its approval sheet may hear `approval.needed` and answer `approval.answer`.
// Every app gets `appBridge(id)`, which hides approvals and stamps the app's id on its requests (see core/bridge.ts).
import { RpcChain } from "@zerofee/core/chain";
import { BrowserVault } from "@zerofee/core/vault";
import { deviceSecrets } from "@zerofee/core/device-secrets";
import { asShell, forApps, routeBridge, type Bridge, type BridgeResult } from "@zerofee/core/bridge";
import { withReadDeadline } from "@zerofee/core/read-deadline";
import type { PlainWords, Requester } from "@zerofee/core/signer";
import { createLedgerService, ownMovements } from "@zerofee/wallet/ledger.ts";
import { createEarnReader } from "@zerofee/earn/reader.ts";
import { createTradeReader } from "@zerofee/trade/reader.ts";
import { hostSpending } from "@zerofee/trade/spending-host.ts";
import { APP_IDS } from "./apps.ts";
import { EXTENSION_BUILD, MAINNET, SIM, VAULT_NAMES, WEB_WALLET, guardPairing, secretsVaultName, storeSlot } from "./mode.ts";
import { relayBase } from "@zerofee/core/relay";
import { FORK } from "@zerofee/core/fork";
import { GUARDIAN_VAULT, createGuardian } from "./guardian.ts";
import { BETA_CAP_USD, readVault, withVaultGate } from "./vault-gate.ts";
import { requireActivation } from "./unlock/activation.ts";
import { takeWindowYes } from "./host/window-yes.ts";
import { beforeSuspend, iosDevice, iosHost } from "./host/ios.ts";
import { HostVault, hostDeviceKeys } from "./host/vault.ts";
import { coreIsIsolated, isolatedCore } from "./host/core.ts";
import { laterBridge } from "./host/later-bridge.ts";
import { partnerService } from "./host/partner.ts";
import { startBrowserWallet } from "@zerofee/browser/service";
import { RECIPES } from "@zerofee/pay/partners/recipes";
import type { Problem } from "@zerofee/core/problem";
import { CLIPBOARD_UNAVAILABLE } from "./host/clipboard.ts";
import { NOTIFY_UNAVAILABLE } from "./host/notify.ts";
import policyUrl from "../../../contracts/account-policy/release/account_policy.wasm?url";
// Off mainnet, the same release built with `short-waits` (a minute's least recovery delay instead of a day), so a testnet
// demo can finish a move to a new phone; the mainnet build never loads it (the core refuses it there too).
import shortWaitsPolicyUrl from "../../../contracts/account-policy/release/account_policy-short-waits.wasm?url";
import { sharingFetch } from "./host/shared-get.ts";
import { browserDevice } from "./unlock/device.ts";
import { flightBridge } from "./shell/flight-tap.ts";

// 1Click's public token list is read once for the page and shared by every caller for a few seconds (host/shared-get.ts).
globalThis.fetch = sharingFetch(globalThis.fetch.bind(globalThis));

/** A storage key an app may use: 1–64 of a-z 0-9 . _ -, the same rule as device.secret names. */
const KEY_RE = /^[a-z0-9._-]{1,64}$/;

/**
 * The host's per-app device methods (docs/interfaces.md, "Device methods"). Storage is keyed by the stamped app id,
 * which must be one of the registered apps (`apps`): the shell's own keys (zf.security.*, zf.theme, the terms) are
 * never an app's, and a key must be a plain name, so no app can reach past its own slot.
 */
function deviceService(apps: ReadonlySet<string>): Bridge {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((h) => h(payload));
  let awaitingReturn: string | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && awaitingReturn) {
      // Only the app that opened the page hears it: `app` is matched by appBridge below, then dropped.
      emit("device.returned", { url: location.href, app: awaitingReturn });
      awaitingReturn = null;
    }
  });
  // Each app's own secrets (e.g. Agent's API key), kept on this device, encrypted with the person's passkey or passcode.
  // forApps stamps `app`, so an app only ever reaches its own. In the web demo say "kept on this device, encrypted",
  // never "sealed by the chip": only the phone's Keychain makes that true.
  const vault = new BrowserVault(secretsVaultName());
  const secrets = deviceSecrets(vault);
  // Every app's device.store values, sealed in that same vault (audit M4): read once after the unlock, never plain in
  // localStorage. Its code loads with the first value asked for, never in the first load.
  const slotOf = /^(mainnet:)?zf\.([a-z0-9-]+)\./;
  const isSlot = (k: string) => { const m = slotOf.exec(k); return !!m && !!m[1] === MAINNET && apps.has(m[2]!); };
  let sealed: Promise<import("./sealed-store.ts").SealedStore> | null = null;
  const values = () => (sealed ??= import("./sealed-store.ts").then((m) => m.sealedStore({ vault, local: localStorage, isSlot })));
  const ok = <T>(value: T): BridgeResult<T> => ({ ok: value });
  const refuse = (what: string): BridgeResult<never> => ({
    problem: { code: "shell.device.refused", whatHappened: what, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } },
  });
  return {
    async call<T>(method: string, p: Record<string, unknown> = {}) {
      const app = String(p.app ?? "");
      if (!app) return refuse("This request didn't say which app it came from.");
      if (!apps.has(app)) return refuse("ZeroFee doesn't know that app.");
      if (method.startsWith("device.secret.")) return secrets.call<T>(method, p);
      // Reminders are the phone's (UNUserNotificationCenter). A web page can't promise one will arrive, so say so.
      // The clipboard read is the phone's too (UIPasteboard); a browser says so and the app falls back to its own Paste.
      if (method === "device.clipboard.read") return { problem: CLIPBOARD_UNAVAILABLE };
      // A tap the person feels: the phone's (UIFeedbackGenerator). A browser has none, so it does nothing, quietly.
      if (method === "device.haptic") return ["success", "tap", "warning"].includes(String(p.kind)) ? (ok({ ok: true }) as BridgeResult<T>) : refuse("That isn't a buzz ZeroFee knows. Use success, tap or warning.");
      if (method === "device.notify.schedule" || method === "device.notify.cancel") return { problem: NOTIFY_UNAVAILABLE };
      if (method === "device.store.get" || method === "device.store.set") {
        const key = String(p.key ?? "");
        if (!KEY_RE.test(key)) return refuse("ZeroFee can't save under that name. Use 1 to 64 of a–z, 0–9, dots and dashes.");
        const slot = storeSlot(app, key);
        try {
          const store = await values();
          if (method === "device.store.get") return ok({ value: await store.get(slot) }) as BridgeResult<T>;
          await store.set(slot, p.value === null ? null : String(p.value));
          return ok({ ok: true }) as BridgeResult<T>;
        } catch {
          // locked (before the unlock) or a browser that won't keep it: nothing read, nothing kept
          return refuse("This browser won't let ZeroFee keep that here.");
        }
      }
      if (method === "device.openUrl") {
        // A partner's page (a sign-up, an ID check) as a browser sheet: the system's own browser with its real address
        // bar, never a frame ZeroFee draws a domain strip over (a framed page can move and the strip can't follow it).
        // On the phone this is SFSafariViewController; in the web demo, a card-sized popup, or a tab when popups are
        // blocked. The app never sees inside it; `device.returned` fires when the person comes back.
        const url = String(p.url ?? "");
        if (!url.startsWith("https://")) return refuse("ZeroFee opens https pages only.");
        const mode = p.mode === "external" ? "external" : "sheet";
        const w = innerWidth, h = innerHeight;
        // Opened WITHOUT `noopener` in the features (with it, window.open returns null by spec, so a page that opened
        // fine read as blocked). The link to this page is cut the moment it opens instead: the new window's `opener`
        // is set to null before the partner's page can run, so it can never reach back into ZeroFee. A null here is
        // then a real pop-up block.
        const features = mode === "sheet" ? `popup,width=${Math.min(430, w)},height=${Math.min(860, h)},left=${Math.max(0, Math.round((screen.width - 430) / 2))},top=${Math.max(0, Math.round((screen.height - 860) / 2))}` : "";
        const opened = window.open(url, "_blank", features);
        if (!opened) return refuse("This browser blocked the page from opening. Allow pop-ups for ZeroFee, then try again.");
        try {
          opened.opener = null;
        } catch {
          // Already cut (a browser that refuses the write has no opener to cut).
        }
        awaitingReturn = app;
        return ok({ ok: true }) as BridgeResult<T>;
      }
      return refuse("ZeroFee doesn't know that request.");
    },
    on<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(handler as (payload: unknown) => void);
    },
  };
}

/** The ZeroFee iPhone app (apps/ios), when this page runs inside it; null in a browser. */
const host = iosHost();

// `/?mainnet`: the same app on NEAR mainnet. There is no sponsor and no faucet there (so no `createAccount` option: the
// core refuses it on mainnet): the person sends NEAR to the account's own address (stage "needs-funding"). In a browser
// its keys live in a vault of their own, so testnet and mainnet keys never mix. On the phone the core's vault is the
// Keychain (this device only); a phone build runs one network, set at build time (ZF_START_QUERY).
// On the phone the core normally runs in Swift's own context (S1.6 phase 2), apart from this page: the page then only
// asks it. If the phone says "page" (ZF_ISOLATED_CORE = NO, or its script didn't load), the core runs here as before.
/** In a browser, the fresh check that the person is there: this browser's unlock passkey (the person's iPhone), with user
 *  verification read from its signed flags (unlock/verify.ts, D103). A passcode unlock can't pass it. Loads when asked. */
// (In the public build verify.ts is verify-none.ts, vite.config.ts: the web wallet has no passkey; its sheets take the password.)
const webCheck = (reason: string) => import("./unlock/verify.ts").then((m) => m.webUserVerified(() => browserDevice().readRecord())(reason));
/** The quote relay (Private, D27), set at build time: VITE_ZEROFEE_RELAY. Unset: Private says it isn't set up. */
const RELAY = relayBase(import.meta.env.VITE_ZEROFEE_RELAY);
// D139: the Safe's own NEAR reads may go through the relay's FastNEAR proxy (its paid plan; the key is on the relay only,
// never in this app). Only the Safe's: near-proxy.ts safeOnly. On the phone, and in a browser too (product decision, 3 Nov: the
// laptop's balances didn't show while FastNEAR's free node answered 429 and near.org took 3 s; the relay takes the app's
// own web origins, ALLOWED_ORIGINS). Its code loads after the first screen (never in Home's first load); until then every
// read goes straight to the nodes.
// Never on the mainnet copy (VITE_FORK=1): the relay's proxy reads real mainnet, and the copy's NEAR is this Mac's.
if (MAINNET && RELAY && !FORK) void import("@zerofee/core/near-proxy").then((m) => m.setNearProxy(`${RELAY}/v0/near`), () => undefined);
// Finding 3: Solana's display reads (the core's and Trade's) go to the relay's Helius first, the free nodes after
// (sol-proxy.ts); Robinhood Chain's reads and sends (the core's and Trade's) to the relay's Alchemy first, its free nodes
// after on a failure, a 429 or a 503 (hood-proxy.ts). One load for both (relay-doors.ts: Home's speed budget); never on
// the mainnet copy, whose Solana and Robinhood Chain are this Mac's.
if (MAINNET && RELAY && !FORK) void import("@zerofee/core/relay-doors").then((m) => m.setRelayDoors(RELAY), () => undefined);
// The page's own core loads only where it runs (D134): the phone's first load never carries it.
const theCore: Bridge = coreIsIsolated(host)
  ? isolatedCore(host)
  : laterBridge(() => Promise.all([import("@zerofee/core/demo-core"), import("@zerofee/core/mail-service")]).then(([{ DemoCore }, { MAIL_SERVICE }]) => new DemoCore({
      chain: new RpcChain(MAINNET ? "mainnet" : "testnet"),
      // ZeroFee's mail host (mail-service.ts): AgentZero's mailbox and the person's sign-in mailbox
      mail: MAIL_SERVICE,
      vault: host ? new HostVault(host) : new BrowserVault(MAINNET ? VAULT_NAMES.app : undefined),
      // a call that names no app is never the shell's here (asShell stamps the shell's own; audit pass 2, item 2)
      unstampedIsShell: false,
      // On the phone the account's key is made and used in the Secure Enclave (Face ID); in a browser the core keeps its own.
      ...(host ? { deviceKeys: hostDeviceKeys(host) } : {}),
      policyWasm: () => fetch(MAINNET ? policyUrl : shortWaitsPolicyUrl).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      ...(RELAY ? { privateQuotes: RELAY } : {}),
      // In a browser (audits K-2, K-4): new backup words live in memory only until checked, and the words' hot wallets
      // keep no key in the vault. On the phone the Keychain keeps them, as before.
      ...(host ? {} : { secretsInMemory: true }),
      // D103: in a browser, giving AgentZero more needs a passkey assertion that verified the person (UP and UV); a
      // passcode unlock can't. On the phone the core's own sheet is Face ID, so it is never set there.
      // Its code loads only when it's asked (Home's first load).
      ...(host || WEB_WALLET ? {} : { userVerified: webCheck }),
      // D143 (product decision, 3 Nov, P0): in a browser every signature of the Safe's key needs, after Approve, the same fresh
      // check (the person's iPhone, Face ID). Enforced in the core, so the shell can't skip it. Not on the phone: its
      // sheet is Face ID.
      // (never in the web wallet: its sheet asks for the password itself, the core's answerWeb; it has no passkey)
      ...(host || WEB_WALLET ? {} : { safeStepUp: webCheck }),
      // D157: in the ZeroFee Chrome extension, every approval is the extension's own full-screen window: the words, and
      // Approve there is the person's iPhone (the fresh check, read here by verify.ts). Never the side panel, never a page.
      ...(EXTENSION_BUILD && !host ? { sheet: (words: PlainWords) => import("./host/extension.ts").then((m) => m.windowSheet(words, () => browserDevice().readRecord())) } : {}),
      // Fees and protection limits in dollars on the sheet (D8).
      sheetPrices: true,
      // The web wallet (product decision, 4 Nov): no Safe; the words and their three wallets only (core web-wallet.ts). The
      // words and a key are shown again only with this browser's password, checked the lock's way (web-password.ts).
      ...(WEB_WALLET && !host ? { webWallet: { passwordOk: (password: string) => import("./unlock/web-password.ts").then((m) => m.passwordOk(browserDevice(), password)) } } : {}),
    })));
/** The browser's IndexedDB names (its vaults), or null when it can't list them. */
const vaultNames = async (): Promise<string[] | null> => (await indexedDB.databases()).map((d) => d.name ?? "").filter(Boolean);
/** D54: in a browser, a pairing is refused while this browser holds a laptop key (it can't be its own second device). */
// Audit pass 2, item 2: the core takes a call as ZeroFee's own screens only when it says so (SHELL_APP); asShell stamps
// it here, on every call that names no app. An app's calls come through forApps, which always stamps that app's id.
const core: Bridge = asShell(host ? theCore : guardPairing(theCore, vaultNames, MAINNET));

/** One device service, shared by the shell and the ledger, so each app's storage stays in one place. */
const device = host ? iosDevice(host, APP_IDS) : deviceService(APP_IDS);
/** The core and the device, without the ledger: what the ledger itself calls, so it can never reach itself. */
const base = routeBridge(core, { device });
/**
 * Wallet's ledger on NEAR Intents (mainnet only; a testnet account gets the Problem ledger.account.testnet). It signs
 * as the app that asked, forApps(base, caller), so the sheet's hint names that app; its own storage is Wallet's.
 */
const ledger = createLedgerService({ bridgeFor: (caller) => forApps(base, caller), chain: new RpcChain("mainnet"), ...(MAINNET ? {} : { testChain: new RpcChain("testnet") }), ...(RELAY ? { privateQuotes: RELAY } : {}) });
/** Earn, read-only (earn.positions and nothing else), so Wallet's one balance can count staked NEAR. It reads as Earn. */
const earn = createEarnReader(forApps(base, "earn"));
/** Trade, read-only (trade.holdings and nothing else): Positions' own total, so Wallet's one balance can show "In trading". */
const trade = createTradeReader(forApps(base, "trade"));
/** The network a second device run on this phone (the guardian's) uses: the same as the app's. */
const secondDeviceChain = new RpcChain(MAINNET ? "mainnet" : "testnet");
/**
 * With the phone's isolated core, a second device runs there (audit IOS-4: its key never sits in a vault this page can
 * read, and its sheet is the native one); the page only asks, naming whose it is. Otherwise it runs here, as before.
 */
const secondDeviceIn = (space: string, here: () => Bridge): Bridge =>
  coreIsIsolated(host) ? { call: (method, params = {}) => core.call(method, { ...params, space }), on: () => () => {} } : here();
/** Being someone's guardian (guardian.ts): this phone as the second device of a trusted person's account, same network. */
const guardian = createGuardian(() => secondDeviceIn("guardian", () => laterBridge(() => import("@zerofee/core/second-device").then(({ SecondDeviceCore }) => new SecondDeviceCore({ chain: secondDeviceChain, vault: host ? new HostVault(host, GUARDIAN_VAULT) : new BrowserVault(GUARDIAN_VAULT), ...(host ? {} : { stepUp: webCheck }) })))));
/** The full bridge, for the shell only (onboarding, recovery, the approval sheet). */
/** The Sign-up Robot's host methods (partner.*): Swift's robot mode on the phone (PartnerRobot.swift), none in a browser. */
const partner = partnerService(host);
/**
 * Agent's `agent.robot.next` (D29/D22): AgentZero's browser (caller "browser") thinks on the chat's own paid relay path
 * (robot/service.ts, audit 14 E1: the chat's sign-up token and AgentZero's wallet, no key); Pay's run (caller "pay") on
 * Agent's own Claude key. Made on first use, since it reads through the shell bridge it is part of.
 */
// Its code (and the Anthropic SDK's) loads on that first use, never in the app's first load (speed, 2 Nov).
let agentRobot: Promise<Bridge> | null = null;
const agent: Bridge = {
  call: <T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> =>
    (agentRobot ??= import("@zerofee/agent/robot/service").then((m) => m.agentRobotService(forApps(shellBridge, "agent"), { relayBase: RELAY ?? null })))
      .then((robot) => robot.call<T>(method, params))
      .catch(() => {
        agentRobot = null;
        return { problem: { code: "shell.agent.unloaded", whatHappened: "AgentZero didn't load. Try again.", money: { state: "not-involved" }, next: { kind: "retry", label: "Try again" } } };
      }),
  on: () => () => {},
};
/**
 * Spending (D52): the one engine behind Trade and the sites, on the Trade app's own bridge (one planner, one journal). It
 * reads and asks as Trade, through the core, the device and the ledger. The shell starts it once the account is home.
 */
export const spending = hostSpending(() => appBridge("trade"), () => forApps(routeBridge(core, { device, ledger }), "trade"));
beforeSuspend(() => spending.settle());
// Settings → Status (rule 9b): read-only checks of every service, only while Settings or its Status sheet is open (the
// row and the sheet ask; nothing here asks by itself), kept 30 s. The checks' code, and NEAR's "switched to its public
// servers" flag (trade near/switched.ts, the trade sheet's own), load with the first look, never in Home's first load.
// On the mainnet copy (VITE_FORK=1) it never asks the relay's doors (the copy's own reads don't use them).
// Phase 2: the person's own server per chain (own-servers.ts), kept only through device.store (sealed in the vault here,
// the Keychain on the phone) under Trade's slot, read into the doors once after the unlock (App.tsx startHome asks
// status.own.get); on the phone a Test of a host outside its approved list says it can't be reached (own-reach.ts).
const ownStore = {
  async get(key: string): Promise<string | null> {
    const r = await device.call<{ value: string | null }>("device.store.get", { app: "trade", key });
    if (!("ok" in r)) throw new Error("locked");
    return r.ok.value;
  },
  async set(key: string, value: string | null): Promise<void> {
    const r = await device.call("device.store.set", { app: "trade", key, value });
    if (!("ok" in r)) throw new Error("not kept");
  },
};
// On the phone the core runs apart from this page (Swift's own context), so each own server is handed to it too
// (core own-core.ts, ZeroFee's own screens only): its Solana checks and Robinhood Chain reads use it as Trade's doors do.
const ownIntoCore = (chain: string, address: string | null) => core.call("subwallet.own.set", { chain, address });
// …and the core says which it couldn't reach, so Status never says "Using your server" while the core is on ZeroFee's
const coreMissed = () => core.call<{ missed: ("near" | "solana" | "hood")[] }>("subwallet.own.state").then((r) => ("ok" in r && Array.isArray(r.ok?.missed) ? r.ok.missed : []));
const status = laterBridge(() => Promise.all([import("@zerofee/core/status-probe"), import("@zerofee/trade/near/switched.ts"), import("@zerofee/core/hood-proxy"), host ? import("./own-reach.ts") : null]).then(([m, s, h, r]) => m.statusService({ relay: FORK ? null : RELAY ?? null, nearSwitched: s.isSwitched, store: ownStore, apply: (c) => { if (c === "hood") h.setOwnHood(); }, ...(r ? { reach: r.phoneReaches } : {}), ...(coreIsIsolated(host) ? { core: ownIntoCore, coreMissed } : {}) })));
// Every read a screen waits on answers within 10 s, else "the network is slow" with Try again (grade 1 Nov b, N2): no
// screen waits for ever. Sends, signatures and anything that waits for the person have no deadline.
const routed: Bridge = withReadDeadline(guardian.withApprovals(routeBridge(core, { device, ledger, earn, trade, spending, guardian: guardian.service, partner, agent, status })));
// More than $5,000 in the vault needs a second device: Add money and Receive ask for one first (vault-gate.ts).
// In a browser, Approve counts only with a person's own tap (audit K-6): a script's yes is answered no. On the phone the
// sheet's Approve passes Face ID first.
// During the beta, Add money and Receive stop at the beta cap (BETA_CAP_USD, vault-gate.ts), said plainly.
const gated = withVaultGate(routed, () => readVault(routed), BETA_CAP_USD);
// D157: in the extension (Real), every sheet's yes is the extension's own window (the person's tap there and their iPhone,
// checked here): the gate takes a yes only for an approval that window said yes to (window-yes.ts).
const shellOwn: Bridge = host ? gated : EXTENSION_BUILD && !SIM ? requireActivation(gated, () => true, takeWindowYes) : requireActivation(gated);
// The test flight recorder (shell/flight.ts, product decision, 4 Nov) notes each call's method, ms and outcome, never its params
// or result; only in the test builds (VITE_TEST_TRACE=1, never the public one): otherwise read inline and dropped.
export const shellBridge: Bridge = import.meta.env.VITE_TEST_TRACE === "1" && import.meta.env.VITE_ZEROFEE_PUBLIC !== "1" && !!import.meta.env.VITE_TEST_TRACE_KEY && !!import.meta.env.VITE_TEST_TRACE_ID ? flightBridge(shellOwn) : shellOwn;

/** Where the Browser wallet's own Problems go (the shell sets it once it can show one). */
let browserWalletProblem: (p: Problem, host: string) => void = () => {};
export const onBrowserWalletProblem = (show: (p: Problem, host: string) => void) => {
  browserWalletProblem = show;
};
// Browser's wallet engine, started once at launch on the phone (not when the Browser app opens): it answers the partner
// window's `device.wallet.request` (wallet "browser") with `device.wallet.reply`, as Browser (forApps stamps the app).
if (host) startBrowserWallet(forApps(shellBridge, "browser"), { recipes: RECIPES, problem: (p, h) => browserWalletProblem(p, h) });

/**
 * What an app inside the shell gets: no approvals, its own id stamped on every request, its own movements' updates,
 * and `device.returned` only when it was this app that opened the page (the event names the opener; it's matched here
 * and the name dropped).
 */
const APP_BRIDGES = new Map<string, Bridge>();
/** One bridge per app for the life of the page (Spending's engine and the Trade app must share Trade's). */
export const appBridge = (app: Exclude<Requester, "security">): Bridge => {
  const had = APP_BRIDGES.get(app);
  if (had) return had;
  const own = ownMovements(forApps(shellBridge, app), app);
  const made: Bridge = {
    call: own.call,
    on<T>(event: string, handler: (payload: T) => void) {
      if (event !== "device.returned") return own.on<T>(event, handler);
      return own.on<{ url: string; app: string }>(event, (p) => {
        if (p.app === app) handler({ url: p.url } as T);
      });
    },
  };
  APP_BRIDGES.set(app, made);
  return made;
};

// AgentZero pays a Chat request (AZ2 job 3): the shell's payer, from its own chunk (agentzero-start.ts), asked for as
// this module loads and set when that chunk arrives; the engine itself loads on first use. If the chunk fails, no payer:
// Chat's chips stay the plain Send (Private only, D85).
void import("./agentzero-start.ts").then((m) => m.startAgentZeroPayer(appBridge("agent")), () => undefined);
