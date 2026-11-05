// Job 1's real-account hands and watch (P3/P4), loaded by the engine through ONE lazy import, so Trade's Solana engine,
// its nodes and market data never join Home's first load.
import type { Bridge } from "@zerofee/core/bridge";
import { createSolChain } from "@zerofee/trade/sol/chain.ts";
import { createSolRpc } from "@zerofee/trade/sol/rpc.ts";
import { createMarket } from "@zerofee/trade/market/index.ts";
import { copyWatch } from "./copy-watch.ts";
import type { LeaderWatch, PocketHands } from "./engine.ts";
import type { Job } from "./jobs.ts";
import { pocketTrader } from "./pocket-trade.ts";

/** AgentZero's hands: Trade's Solana engine on the pocket's address; the core signs inside the approved day. */
export async function realHands(bridge: Bridge): Promise<PocketHands> {
  const rpc = createSolRpc(), market = createMarket();
  return pocketTrader({ bridge, chain: async (owner) => createSolChain({ rpc, owner, solUsd: () => market.nativeUsd("sol"), meta: (m) => market.meta("sol", m) }) });
}

/** A copy job's watch on the copied wallet, on Trade's own Solana nodes. */
export async function realWatch(job: Job): Promise<LeaderWatch | null> {
  if (job.kind !== "copy") return null;
  const rpc = createSolRpc();
  return copyWatch({ rpc: (m, p) => rpc.call(m, p), leader: job.leader, jobId: job.id });
}
