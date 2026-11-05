// NEAR coins: which engine trades a coin (product decision, 3 Nov). Every buy is a Rhea swap from the NEAR coin wallet at chain speed
// (rhea.ts); a coin Rhea doesn't trade is refused there, never bought through 1Click (product decision, 5 Nov: the chain's own
// protocols only, no third-party swap layer). A sale goes from wherever the coin is: the NEAR coin wallet's coins sell on
// Rhea; a coin an older build bought inside Spending (1Click, D96) can still go back out the way it came. Holdings are both.
import type { Amount, ChainEngine, Prepared, Side } from "../types.ts";
import { createNearRpc, NEAR_RPC_HOSTS, type NearRpc } from "../market/near.ts";
import { relayBase } from "../market/relay.ts";
import { createNearDoors } from "./doors.ts";
import { saySwitched } from "./switched.ts";
import { createNearEngine, type NearEngineDeps } from "./engine.ts";
import { createRheaEngine, type RheaEngine } from "./rhea.ts";

/** NEAR's engines as the runtime loads them, with their first NEAR coin (never in Home's first load): Rhea from the NEAR
 *  coin wallet (its first node, and another for the FINAL check), 1Click inside Spending, this route between them. */
export function nearEngines(d: NearEngineDeps, relay: string | undefined = buildRelay()): ChainEngine {
  // NEAR's price as the core holds it (account.nearPrice: its one checked snapshot), never a figure of the app's own
  const nearUsd = async () => { const p = await d.call<{ usd?: number }>("account.nearPrice", {}); if (!(typeof p?.usd === "number" && p.usd > 0)) throw new Error("no NEAR price"); return p.usd; };
  const rhea = createRheaEngine({ call: d.call, ...(d.meta ? { meta: d.meta } : {}), ...(d.pools ? { pools: d.pools } : {}), nearUsd, ...nearTradeNodes(relay, undefined, saySwitched) });
  return createNearRoute(rhea, createNearEngine(d));
}

/** The build's relay (VITE_ZEROFEE_RELAY), read where a bundler set it; nothing under node. */
const buildRelay = (): string | undefined => (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_RELAY;

/**
 * The NEAR trade's two nodes (rules 3 and 9): with a relay, its two PAID doors (doors.ts: door 1 FastNEAR's, door 2 the
 * second operator's, silent failover inside 2 s, the same signed bytes on a send); never a free node on the normal path,
 * only as the last resort when ZeroFee's relay itself fails (doors.ts).
 * A build with no relay at all (a self-hosted copy) has no paid door, so it reads the keyless nodes as before.
 * near-fast and every other NEAR trade caller take their rpc/rpc2 from here.
 */
export function nearTradeNodes(relay: string | undefined = buildRelay(), f?: typeof fetch, onSwitch?: (line: string | null) => void): { rpc: NearRpc; rpc2: NearRpc } {
  if (relayBase(relay)) return createNearDoors({ relay: relay!, ...(f ? { fetch: f } : {}), ...(onSwitch ? { onSwitch } : {}) });
  const hosts = [...NEAR_RPC_HOSTS];
  return { rpc: createNearRpc(f, hosts), rpc2: createNearRpc(f, [...hosts].reverse()) };
}

export function createNearRoute(rhea: RheaEngine, oneClick: ChainEngine): ChainEngine {
  const isRhea = (p: Prepared) => p.key.startsWith("rhea|") || p.key.startsWith("rheaf|");
  async function pick(side: Side, coin: string): Promise<ChainEngine> {
    // a buy: Rhea, always (no pool there: Rhea's own refusal, named)
    if (side === "buy") return rhea;
    // a sale: Rhea when the NEAR coin wallet holds it, else Spending's own (an older build's 1Click buy, D96)
    return (await rhea.heldOf(coin).catch(() => 0n)) > 0n ? rhea : oneClick;
  }
  return {
    chain: "near",
    owner: oneClick.owner,
    async prepare(side: Side, coin: string, amount: Amount) {
      return (await pick(side, coin)).prepare(side, coin, amount);
    },
    settle(p, key, onMove, session) {
      return isRhea(p) ? rhea.settle!(p, key, onMove) : oneClick.settle!(p, key, onMove, session);
    },
    followMove: (id, symbol) => oneClick.followMove!(id, symbol),
    async holdings(coins?: string[]) {
      const [a, b] = await Promise.all([oneClick.holdings(coins), rhea.holdings(coins ?? []).catch(() => ({ native: "0", coins: [] }))]);
      const sum = new Map(a.coins.map((c) => [c.coin, { ...c }]));
      for (const c of b.coins) {
        const had = sum.get(c.coin);
        if (had) had.raw = (BigInt(had.raw) + BigInt(c.raw)).toString();
        else sum.set(c.coin, { ...c });
      }
      // Spending's cash (USDC) stays the chain's "native": the NEAR coin wallet's NEAR is said on its own
      return { native: a.native, coins: [...sum.values()] };
    },
    send: oneClick.send, txHash: oneClick.txHash, status: oneClick.status, fill: oneClick.fill,
    poolChanged: (coin) => rhea.poolChanged(coin),
  };
}
