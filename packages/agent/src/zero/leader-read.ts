// ST-C: the leader card's reads, loaded only when the card shows (one lazy import, so Trade's Solana nodes and market
// data never join any first load). Trade's own Solana node list (the copy job's watch uses it too) less publicnode, which
// keeps about 24 hours of history and answers older questions with a short list and no error (memory, 28 Sep); and Trade's
// SOL price. No other host. One node per call (review M5), one node list shared by every card this run (review H1).
import { createSolRpc, SOL_NODES } from "@zerofee/trade/sol/rpc.ts";
import { createMarket } from "@zerofee/trade/market/index.ts";
import type { RpcCall } from "./copy-watch.ts";
import { readCard, type Card } from "./leader-card.ts";

export const HISTORY_NODES = SOL_NODES.filter((n) => !n.includes("publicnode"));
export const REFUSAL = /^HTTP (429|403|5\d\d)$|^timed out$|fetch|network|load failed/i;
let rpc: ReturnType<typeof createSolRpc> | undefined;
/** One node per call. A refusal or no answer throws (the card backs off); an error the node gives as its answer is
 *  null (a transaction not read, review M4), never retried as a refusal. */
export function historyCall(r: Pick<ReturnType<typeof createSolRpc>, "askNodes">): RpcCall {
  return async (method, params) => {
    const [a] = await r.askNodes(method, params, 1);
    if (!a) throw new Error("no node");
    if (a.ok) return a.value;
    // refused, timed out, or the network (Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError…"): back off
    if (REFUSAL.test(a.error)) throw new Error(a.error);
    return null;
  };
}

/** The card and SOL's price today (undefined when it can't be read: the card then says SOL, never a made-up dollar). */
export async function readLeader(wallet: string, stopped?: () => boolean): Promise<{ card: Card; solUsd: number | undefined }> {
  rpc ??= createSolRpc({ nodes: HISTORY_NODES });
  const market = createMarket();
  const [card, solUsd] = await Promise.all([
    readCard({ rpc: historyCall(rpc), wallet, ...(stopped ? { stopped } : {}) }),
    market.nativeUsd("sol").then((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined), () => undefined),
  ]);
  return { card, solUsd };
}
