// The public build's stand-ins (vite.config.ts aliases them in only when VITE_ZEROFEE_PUBLIC=1): modules no page of that
// build shows (publicApps never lists them), so the old Agent screen (and the Anthropic SDK), Earn's screens, the old
// Browser page and the Extension app are left out of the bundle entirely. Each keeps the real module's id, name and line.
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import type { Bridge } from "@zerofee/core/bridge";

const soon = (id: AppModule["id"], name: string, line: string): AppModule => ({ id, name, line, Root: () => null });

export const extensionApp = soon("extension", "Extension", "Trade from Chrome on your laptop");
export const earnApp = soon("earn", "Earn", "NEAR that earns");
export const agentApp = soon("agent", "AgentZero", "Its own wallet, one job, a receipt for each move.");
export const browserApp = soon("browser", "Browser", "fomo, pump.fun and more");

/** Agent's robot isn't in the release: every call is refused, plainly. */
export function agentRobotService(_bridge: Bridge): Bridge {
  return {
    call: async () => ({ problem: { code: "shell.app.hidden", whatHappened: "That part of ZeroFee isn't in this build yet.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } }),
    on: () => () => {},
  };
}

/** Pay's cards aren't in the release: Send (which reuses Pay's engine) sees none and never asks the core about one
 *  (audit leftover: partners/cards.ts shipped, and cardCheckLive made a bridge call every time Send opened). */
export const CARDS: never[] = [];
export const cardCheckLive = async (_bridge: Bridge): Promise<boolean> => false;

/** Pay's partner recipes aren't in the release (the phone's partner windows use them; the public web has none). */
export const RECIPES: never[] = [];
