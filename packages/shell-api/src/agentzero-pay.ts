// AgentZero pays a Chat request (AZ2 job 3, "Pay my list in Chat"). Chat's request chip asks here; AgentZero's engine
// (packages/agent zero/engine.ts, on the agent app's own bridge) answers. A module of the shell's, like
// agentzero-steps.ts: one JS realm runs every app's screens, and the Agent tab isn't drawn while Chat is.
//
// The shell sets the payer once at start-up (apps/web core.ts, lazily so Home's first load doesn't carry it). Chat:
//   const p = agentZeroPayer();
//   const offer = p ? await p.offer({ requestId, to, usd }) : null;   // the chip's words ("Pay $5 · AgentZero"), or why not
//   <button data-agentzero-pay={requestId} onClick={(e) => p.payRequest({ requestId, to, usd }, e.nativeEvent)}>
//   The chip must carry data-agentzero-pay="<request id>", and the click event itself is passed: AgentZero pays only on
//   a real, trusted tap on that very chip, under 2 s old, used once (security review M2).
// Only a request whose coin is USDC on NEAR, to a NEAR name, is offered (requestUsd() in the engine reads the amount).
// Nothing here moves money: the engine asks the core, which signs with AgentZero's own key, held on chain to its pocket
// money and the account's pay list.

/** `warn`: AgentZero's check on who gets paid ("First time paying kim.near."): show it on the chip, before the tap. */
export type AgentZeroOffer = { ok: true; line: string; warn?: string } | { ok: false; line: string };
export type AgentZeroPaid =
  | { kind: "paid"; line: string; txHash?: string }
  | { kind: "already"; line: string; txHash?: string }
  /** Sent, but not confirmed: never offer Pay again; show the line ("Check Activity"). */
  | { kind: "unknown"; line: string }
  | { kind: "not-here"; line: string }
  | { kind: "refused"; line: string };

export interface AgentZeroPayer {
  offer(ask: { requestId?: string; to: string; usd: number }): Promise<AgentZeroOffer>;
  /** `tap`: the click's native event (React: e.nativeEvent) on the element marked data-agentzero-pay="<requestId>". */
  payRequest(ask: { requestId: string; to: string; usd: number }, tap: Event | unknown): Promise<AgentZeroPaid>;
}

let payer: AgentZeroPayer | null = null;

export function setAgentZeroPayer(p: AgentZeroPayer | null): void {
  payer = p;
}

/** The payer, or null when the shell didn't set one (Chat then offers its plain Send only). */
export const agentZeroPayer = (): AgentZeroPayer | null => payer;

/**
 * A payer whose code loads on first use (Home's first load stays lean). A load that fails says so and is tried again on
 * the next ask; it never pays.
 */
export function lazyAgentZeroPayer(load: () => Promise<AgentZeroPayer>): AgentZeroPayer {
  let p: Promise<AgentZeroPayer> | null = null;
  const get = () => (p ??= load().catch((e: unknown) => {
    p = null;
    throw e;
  }));
  const unloaded = "AgentZero didn't load. Try again.";
  return {
    offer: (ask) => get().then((x) => x.offer(ask), () => ({ ok: false as const, line: unloaded })),
    payRequest: (ask, tap) => get().then((x) => x.payRequest(ask, tap), () => ({ kind: "not-here" as const, line: unloaded })),
  };
}
