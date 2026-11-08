// AgentZero on the web (W7, product decision, 5 Nov): its own
// mailbox registered at its first open (core mailbox.ts account.agent.mailSetUp). Which tools the chat offers on the web
// is packages/agent chat/tools.ts webTools: a tool that can't work here is left out, never offered and refused.
import type { Bridge } from "@zerofee/core/bridge";


/**
 * AgentZero's mailbox, registered once when AgentZero first opens (the core keeps its name, so the next open asks no
 * one). Answers the address, or null when the mail host didn't answer: then read_mail stays out of the chat until a
 * later open registers it. Never throws.
 */
export async function registerMailbox(bridge: Bridge): Promise<string | null> {
  const r = await bridge.call<{ address: string }>("account.agent.mailSetUp", {}).catch(() => null);
  return r && "ok" in r && typeof r.ok?.address === "string" ? r.ok.address : null;
}
