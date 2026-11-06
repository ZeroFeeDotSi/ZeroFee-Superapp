// The keep job's reading under AgentZero's sandbox (AGENTZERO-WALLET.md L8, review, 3 Nov). Its words say "Keep $50
// in your SOL wallet", so with AgentZero's own wallet on it reads THAT wallet: the chosen network's own cash in Spending's
// status (spending.status networks[].cashUsd), never Spending's total, which counts the NEAR wallet's dollars too. It
// tops up from AgentZero's own wallet into that wallet only; that route isn't built (keepRuns), so a keep job isn't
// offered there, and one saved before stops with one plain receipt.
import { AGENT_PRIVATE_ROUTE, AGENTZERO_WALLET } from "@zerofee/core/agent-route";

export type KeepWallet = "sol" | "hood" | "bsc";
/** Spending's status, as much of it as the reading needs. */
export interface KeepStatus {
  totalUsd: string;
  networks?: { network: string; cashUsd: string; closed?: true }[];
}

/**
 * AgentZero's own wallet → a person's wallet, the keep job's top-up route with that wallet on: BLOCKED, not built.
 * Fix path: a confidential move built as Home's hidden-row is (the wallet's coin into NEAR's private balance by 1Click,
 * then out to the person's own address), its cap in the core, proven with real money; then this goes true. Not a lock
 * on a working route: nothing behind it exists yet.
 * The offer reads both this and AGENT_PRIVATE_ROUTE (keepRuns, jobs.ts jobOffered), so neither flag alone offers a Keep
 * that can't fill. Its relay's copy: apps/quotes/agentzero-chat.mjs KEEP_JOB_OFFERED (a test holds them equal).
 */
export const KEEP_FROM_AGENT_OPEN = false;
/**
 * Can a keep job fill its wallet, end to end, on a real account? (Gates grade, 5 Nov, MUST 4: a job a person can make
 * that always fails.) It needs BOTH switches: AGENT_PRIVATE_ROUTE (route A, proven on mainnet) and, with AgentZero's
 * own wallet on (AGENTZERO_WALLET, since 3 Nov), KEEP_FROM_AGENT_OPEN. Today both are false, so no. Every offer asks
 * this (D116 drop, don't degrade): the job list and its sheet (jobs.ts jobOffered), AgentZero's chat tool (chat/tools.ts,
 * chat/turn.ts). One saved before stops once with KEEP_FROM_AGENT_OFF's receipt (engine.ts).
 */
export const keepRuns = (walletOn: boolean = AGENTZERO_WALLET, route: boolean = AGENT_PRIVATE_ROUTE, fromAgent: boolean = KEEP_FROM_AGENT_OPEN): boolean => route && (!walletOn || fromAgent);
export const KEEP_FROM_AGENT_OFF = (wallet: KeepWallet) => `AgentZero can't fill ${KEEP_NAME[wallet]} from its own wallet yet. Nothing moved.`;
const KEEP_NAME: Record<KeepWallet, string> = { sol: "your SOL wallet", hood: "your ETH (RH) wallet", bsc: "your BNB wallet" };

/**
 * What a keep job reads, in dollars: with AgentZero's own wallet on, the job's own wallet's cash (null when that network
 * isn't in the status or is closed: no reading, never $0); off, Spending's total as before.
 */
export function keepReading(s: KeepStatus, wallet: KeepWallet | undefined, on: boolean = AGENTZERO_WALLET): number | null {
  if (!on) return Number(s.totalUsd) || 0;
  const n = s.networks?.find((x) => x.network === (wallet ?? "sol"));
  if (!n || n.closed) return null;
  const cash = Number(n.cashUsd);
  return Number.isFinite(cash) && cash >= 0 ? cash : null;
}
