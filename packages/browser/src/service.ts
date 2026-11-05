// The Browser wallet as a running service: the shell starts it once, at launch, on forApps(bridge, "browser"), so it
// answers a wallet-mode page whichever app opened it (the Browser, or Pay's robot on a Browser-wallet recipe).
//
// The host (UI's builder) talks to it with device.* calls, which forApps stamps app:"browser", so no other app can answer
// for it or ask its sheet:
// - event  device.wallet.request { id, method, params, origin, mainFrame, wallet } → engine.handle → device.wallet.reply;
//   `wallet` says which engine the host routed the window to ("browser", or "pay" for the card's window), and this
//   service answers only its own;
// - device.wallet.askConnect { host, name, known, lookAlike } → { allow }: the host's native connect sheet;
// - device.wallet.emit { host, event, data }: events back to that page.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { createWalletEngine, type WalletEngine, type WalletRequest } from "./engine/engine.ts";
import { lookAlike, siteRules, type RecipeSites } from "./sites.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { noteAgentZeroStep } from "@zerofee/shell-api/agentzero-steps.ts";

export interface BrowserWalletOptions {
  recipes?: readonly RecipeSites[];
  /** A child's phone: the wallet answers no site. */
  child?: boolean;
  /** A core Problem from a signature, for the shell's Problem screen. */
  problem?: (problem: Problem, host: string) => void;
  /** AgentZero's own window signed in (ruling d); default: agentSignInRow. */
  agentSignedIn?: (host: string, name: string) => void;
}

/** AgentZero's sign-in, in Activity as AgentZero's ("AgentZero signed in to GMGN", its time under it) and in its
 *  receipts. The task is written on AgentZero's own facade: the centre groups it under AgentZero. */
export function agentSignInRow(host: string, name: string, now = Date.now()): void {
  const title = `AgentZero signed in to ${name}`;
  taskStore().forApp("agent").publish({ id: `signin:${host}:${now}`, title, steps: [{ label: `Signed in to ${name}`, state: "done", at: now }], state: "done", endedAt: now, startedAt: now, where: "AgentZero's wallet. No money moved." });
  noteAgentZeroStep({ site: name, line: title, state: "done", atIso: new Date(now).toISOString() });
}

export function startBrowserWallet(bridge: Bridge, options: BrowserWalletOptions = {}): { engine: WalletEngine; stop: () => void } {
  const engine = createWalletEngine({
    bridge,
    site: siteRules(options),
    emit: (host, event, data) => void bridge.call("device.wallet.emit", { host, event, data }),
    problem: options.problem,
    // ruling d: each of AgentZero's own sign-ins is a row in Activity, as AgentZero's (words: the copy session, the copy review), and one of
    // its receipts. Display only: what signed was the core's to decide.
    agentSignedIn: options.agentSignedIn ?? ((host, name) => agentSignInRow(host, name)),
    askConnect: async (host, rule) => {
      // `own`: the site has its own wallet (core site-wallets.ts), so the sheet names that wallet, never the shared one
      const r = await bridge.call<{ allow: boolean }>("device.wallet.askConnect", { host, name: rule.name, known: rule.known, lookAlike: lookAlike(host), ...(rule.wallet ? { own: true } : {}) });
      return "ok" in r && r.ok.allow === true;
    },
  });
  const stop = bridge.on<WalletRequest & { wallet?: string }>("device.wallet.request", async (req) => {
    if ((req.wallet ?? "browser") !== "browser") return;
    await bridge.call("device.wallet.reply", await engine.handle(req));
  });
  // After "Get new words" has run, the chains' current wallets are the new words' ones: never the cached old ones.
  const offRenewed = bridge.on("recovery.renewed", () => engine.forgetWallets());
  return { engine, stop: () => { stop(); offRenewed(); } };
}

/** The Browser app's Sites list: who can see the address, and one-tap disconnect (the page is told at once). It reads
 *  the same per-host connections the running service keeps, and never connects anything itself. */
export function browserSites(bridge: Bridge): Pick<WalletEngine, "connections" | "disconnect"> {
  const { connections, disconnect } = createWalletEngine({
    bridge,
    site: () => null,
    emit: (host, event, data) => void bridge.call("device.wallet.emit", { host, event, data }),
    askConnect: async () => false,
  });
  return { connections, disconnect };
}
