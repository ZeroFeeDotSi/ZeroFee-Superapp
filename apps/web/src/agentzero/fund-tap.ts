// The first run's amount tap (a mainnet test, 4 Nov). Setting AgentZero's
// wallet up reads and writes NEAR first, which can take a while on mainnet, and a refusal used to land in a line the
// first run never draws. Now the tap answers at once (the tapped amount says "Opening…") and ends in exactly one of: the
// fill sheet, a plain line right above the amounts, or quietly nothing (the person said no on the sheet).
import type { Done } from "./use-agent-wallet.ts";

export const OPENING = "Opening…";
export const FAILED_LINE = "That didn't go through. Nothing moved.";
/** Longer than a slow mainnet read; past it the person gets a line, never a button that seems dead. */
export const SLOW_MS = 45_000;
export const SLOW_LINE = "AgentZero's wallet is taking longer than usual. Nothing moved. Try again in a moment.";

/** Refusals another tap can't change (the core of this build has no AgentZero wallet, e.g. testnet): the amounts go and
 *  only the line stays (robot walk 4 Nov: "$20 changed nothing"; drop, don't degrade). */
export const FINAL_CODES: ReadonlySet<string> = new Set(["security.method.unknown"]);

/** The tap's outcome: a line to show (role=alert; final: no amount can do better), or none (the sheet opened, or the
 *  person declined). */
export async function fundTap(go: () => Promise<Done>, ms = SLOW_MS): Promise<{ line: string; final: boolean } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<{ line: string }>((res) => { timer = setTimeout(() => res({ line: SLOW_LINE }), ms); });
  try {
    const r = await Promise.race([go().catch((): Done => ({ line: FAILED_LINE })), slow]);
    return "line" in r ? { line: r.line || FAILED_LINE, final: "code" in r && !!r.code && FINAL_CODES.has(r.code) } : null;
  } finally {
    clearTimeout(timer);
  }
}
