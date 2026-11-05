// Filling AgentZero's own wallet from the person's NEAR wallet (AGENTZERO-WALLET.md §2, D143). Under D143 a fill between
// the person's own wallets signs with no Face ID, so the core starts one only with a one-time ticket for that amount
// (agent-wallet.ts walletTicket/walletFill), and this is the only code that asks for one: on the person's own trusted tap
// on AgentZero's wallet screen, on the element marked data-agentzero-fill="<the amount>". No chat tool, job, routine or
// act reaches it (a test reads every file of AgentZero's for the core's wallet door).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { runJob, type JobEnd } from "@zerofee/shell-api/job-run.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { trustedTap, type TapCheck } from "./engine.ts";

/** The person's tap on AgentZero's Add money button, marked with the amount it fills (USDC's smallest units). */
export const fillTap: TapCheck = trustedTap("data-agentzero-fill");
export const FILL_TAP_LINE = "Tap Add money on AgentZero's wallet to fill it.";

/**
 * Fill AgentZero's wallet with `amount` (USDC's smallest units, as text) from the person's NEAR wallet, on their tap:
 * the tap is checked first (a real, trusted, fresh tap on that amount's button, used once); then a ticket for exactly
 * that amount, spent at once by the fill. `key` makes asking again safe.
 */
export async function fillOnTap(bridge: Bridge, tap: unknown, amount: string, key: string, check: TapCheck = fillTap): Promise<BridgeResult<unknown>> {
  if (!check(tap, amount)) return { problem: { code: "agentzero.fill.tap", whatHappened: FILL_TAP_LINE, money: { state: "safe", where: "in your NEAR wallet" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<unknown>;
  const t = await bridge.call<{ ticket: string }>("account.agent.wallet", { do: "ticket", amount });
  if (!("ok" in t)) return t;
  return bridge.call("account.agent.wallet", { do: "fill", from: "near", amount, key, ticket: t.ok.ticket });
}

/**
 * The fill as a job (test; the review, 5 Nov): the funding page's Add on a real account, where AgentZero's own
 * wallet is on and the core refuses the Safe-key doors (agent-door.ts SAFE_KEY_DOORS). Made at the tap (rule 2: its row on
 * Home and in Activity, "Job created." with the time left; the NEAR wallet is a hot key, no Face ID), then fillOnTap.
 */
export function fillJob(o: { bridge: Bridge; tasks: Tasks | undefined; usd: number; tap: unknown; key: string; made: () => void; check?: TapCheck }): Promise<JobEnd<{ declined?: true }>> {
  return runJob<{ declined?: true }>({
    tasks: o.tasks, title: `Add $${o.usd.toFixed(2)} to AgentZero's wallet`, usd: `$${o.usd.toFixed(2)}`, etaSec: LEG_SEC.nearToSafe, safe: false, money: ["agent", "row:near"],
    call: async () => (await fillOnTap(o.bridge, o.tap, String(Math.round(o.usd * 1e6)), o.key, o.check)) as never,
    declined: (r) => "ok" in r && r.ok?.declined === true,
    made: o.made,
  });
}
