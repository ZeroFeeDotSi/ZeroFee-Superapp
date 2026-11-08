// Every app inside ZeroFee, in swipe order after Security. One line per app: when an app's session is ready, it
// replaces its placeholder line with its own module, e.g.
//   import { walletApp } from "@zerofee/wallet/app.tsx";   …   ["wallet", walletApp],
//
// The id is assigned HERE, by the registry, never taken from the module: the id is what the core stamps on the app's
// requests and what its storage and its spending rights hang on (Agent's spend is Agent's only), so a module can't
// claim another app's id. A module that calls itself something else, or an id used twice, stops the app at startup.
//
// Speed (2 Nov): Wallet, the app the shell opens on, is in the first load; every other app's code loads the first time
// it is shown (a neighbour of the app on screen, or opened), so the first screen waits for none of them. Its name and
// line are here for the dots and the switcher, and apps.test.ts checks them against the module's own.
import { lazy, useState, type ComponentType } from "react";
import { jsx } from "react/jsx-runtime";
import type { AppId, AppModule } from "@zerofee/shell-api/app-module.ts";
import { walletApp } from "@zerofee/wallet/app/WalletApp.tsx";
import { APP_STORE_NAME } from "@zerofee/core/app-store";
import { reloadForChunk } from "@zerofee/shell-api/chunk-reload.ts";

/** D122: the AgentZero tab is the chat on the phone build (VITE_AGENTZERO_CHAT=1, set by apps/ios/build-web.sh) and in
 *  the public build (product decision, 3 Nov: AgentZero is live there; the public site is the sample-money demo, so its chat is
 *  the sample one, and AgentZeroChatApp.tsx leaves the real chat, its relay turn and every key path out of that build);
 *  elsewhere only with ?azchat. The build-time flags are read inline so a build without the chat drops its code. */
const AZ_CHAT = import.meta.env?.VITE_ZEROFEE_PUBLIC === "1" || import.meta.env?.VITE_AGENTZERO_CHAT === "1" || (typeof location !== "undefined" && new URLSearchParams(location.search).has("azchat"));

/**
 * A component whose code loads later (speed, D145, AgentZero's speed worker 3 Nov): once its code is here (preloaded with
 * the neighbours) it is drawn directly, never through React.lazy, whose reveal React holds 300 ms; code not here yet still
 * goes through lazy (and Suspense, and the app's error boundary). Each mount picks one way and keeps it, so it is never
 * mounted twice.
 */
export function readyLazy<P extends object>(load: () => Promise<ComponentType<P>>): { Root: ComponentType<P>; preload: () => Promise<unknown> } {
  let loading: Promise<ComponentType<P>> | null = null;
  let here: ComponentType<P> | null = null;
  // React keeps a failed lazy as failed: a load that failed (offline, audit 12 C1) gets a fresh one, so the boundary's
  // remount asks for the code again
  const fresh = () => lazy(() => loaded().then((c) => ({ default: c })));
  const loaded = () => (loading ??= load().then((c) => (here = c), (e: unknown) => { loading = null; Later = fresh(); reloadForChunk(e); throw e; }));
  let Later = fresh();
  const Root = (p: P) => {
    const [now] = useState(() => here);
    return jsx((now ?? Later) as ComponentType<P>, p);
  };
  return { Root, preload: () => loaded().catch(() => undefined) };
}

/** An app whose module loads when it is first rendered (readyLazy). A module that calls itself another id stops it there. */
export function lazyApp(id: AppId, name: string, line: string, load: () => Promise<AppModule>): AppModule {
  const { Root, preload } = readyLazy(() => load().then((m) => {
    if (m.id !== id) throw new Error(`apps.ts: the module registered as "${id}" calls itself "${String(m.id)}"`);
    return m.Root;
  }));
  return { id, name, line, Root, preload: () => void preload() };
}

const REGISTRY: [AppId, AppModule][] = [
  ["wallet", walletApp],
  ["trade", lazyApp("trade", "Trade", "Buy and sell coins", () => import("@zerofee/trade/app/TradeApp.tsx").then((m) => m.tradeApp))],
  ["chat", lazyApp("chat", "ZeroFee Chat", "Chat with anyone on BitChat nearby", () => import("@zerofee/chat/app/ChatApp.tsx").then((m) => m.chatApp))],
  ["social", lazyApp("social", APP_STORE_NAME, "Your trading sites, each with its own wallet", () => import("@zerofee/browser/social/SocialApp.tsx").then((m) => m.socialApp))],
  ["extension", lazyApp("extension", "Extension", "Trade from Chrome on your laptop", () => import("@zerofee/extension-app/app/ExtensionApp.tsx").then((m) => m.extensionApp))],
  ["browser", lazyApp("browser", "Browser", "fomo, pump.fun and more", () => import("@zerofee/browser/app/BrowserApp.tsx").then((m) => m.browserApp))],
  // D122: the AgentZero tab as a chat (the phone build, the public demo, or ?azchat)
  ["agent", AZ_CHAT ? lazyApp("agent", "AgentZero", "Ask AgentZero for a job or a payment.", () => import("./agentzero/AgentZeroChatApp.tsx").then((m) => m.agentZeroChatApp)) : lazyApp("agent", "AgentZero", "Its own wallet, one job, a receipt for each move.", () => import("@zerofee/agent/app/AgentApp.tsx").then((m) => m.agentApp))],
  ["earn", lazyApp("earn", "Earn", "NEAR that earns", () => import("@zerofee/earn/app/EarnApp.tsx").then((m) => m.earnApp))],
];

/** The registered modules, each under the registry's id. Throws on a duplicate or a module that claims another id. */
export function registerApps(registry: readonly (readonly [AppId, AppModule])[]): AppModule[] {
  const seen = new Set<string>();
  return registry.map(([id, module]) => {
    if (seen.has(id)) throw new Error(`apps.ts: the app id "${id}" is registered twice`);
    seen.add(id);
    if (module.id !== id) throw new Error(`apps.ts: the module registered as "${id}" calls itself "${String(module.id)}"`);
    return { ...module, id };
  });
}

export const APPS: AppModule[] = registerApps(REGISTRY);
/** The ids an app may be, for everything keyed by app (the device service's storage). */
export const APP_IDS: ReadonlySet<string> = new Set(APPS.map((m) => m.id));
