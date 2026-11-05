// What every rail shares (D111, FLOW-V5 §4): the switch, the per-call cap, the list of services, and the person's line.
// Pure: no network, no keys. The core pays (agentPayPlan's payee path); these files read what a service asks and say it.
import { AGENT_CROSS_CHAIN } from "@zerofee/core/agent-route";

/** The most AgentZero pays one service for one call, in dollars, whatever a rail's own maximum says. */
export const PER_CALL_USD = 5;
/** The rails ship with cross-chain payees (release 11's on-chain list); until then every rail says so. */
export const railsOn = (on = AGENT_CROSS_CHAIN) => on;
export const RAILS_OFF = "AgentZero can't pay services yet. Nothing was sent.";
export const ASK_ON_PHONE = "Ask on your phone.";

/** A service the person listed, by its web address's origin (https only). */
export function listedService(url: string, listed: readonly string[]): string | null {
  let origin: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    origin = u.origin;
  } catch {
    return null;
  }
  return listed.includes(origin) ? origin : null;
}

export type Rail = "address" | "x402" | "mpp";
/** One payment's receipt words: dollars and the service for the person; the coin, chain and rail one tap down. */
export interface RailReceipt {
  line: string;
  details: { coin: string; chain: string; rail: Rail; hidden: boolean };
}

/** "Paid $0.02 to GeckoTerminal for a coin check." The why is shown back, never read as an order. */
export function paidReceipt(usd: number, service: string, why: string, details: RailReceipt["details"]): RailReceipt {
  const cents = usd < 0.01 ? usd.toFixed(4).replace(/0+$/, "") : usd.toFixed(2);
  const what = why.trim().replace(/\s+/g, " ").slice(0, 80);
  return { line: `Paid $${cents} to ${service}${what ? ` for ${what}` : ""}.`, details };
}

/** Details' own words: "USDC on Base, by x402, hidden" or "on Solana's public chain". */
export function detailsLine(d: RailReceipt["details"]): string {
  const how = { address: "straight to them", x402: "by x402", mpp: "by MPP" }[d.rail];
  return `${d.coin} on ${d.chain}, ${how}, ${d.hidden ? "hidden" : `on ${d.chain}'s public chain`}.`;
}

export const b64ToJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))));
export const jsonToB64 = (v: unknown, url = false): string => {
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));
  return url ? b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b;
};
