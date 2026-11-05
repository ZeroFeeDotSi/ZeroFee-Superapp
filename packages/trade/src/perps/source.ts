// D119 perps: where the Perps tab reads and trades. On a real account, the core's perps.* (the build's Hyperliquid
// network, the trading key in the core; landing 3: money in and out through Trading); in the sample demo (?demo), sample.ts (testnet-shaped data, no network). The screen
// never knows which: both answer the same shapes, and a refusal is the core's own Problem.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

export interface PerpsPosition { coin: string; side: "long" | "short"; size: string; valueUsd: number; entryPx: number; pnlUsd: number; pnlPct: number; liqPx: number | null; leverage: number; marginUsd: number }
/** `testNetwork`: Hyperliquid's test network (test money, no money in or out); `spotUsd`: arrived, not yet in trading. */
export interface PerpsState { on: boolean; untilMs?: number; offPending?: true; balanceUsd: number | null; freeUsd: number | null; spotUsd?: number | null; testNetwork?: boolean; positions: PerpsPosition[] }
export interface PerpsMarket { coin: string; price: number; maxLeverage: number }
export interface OrderAsk { coin: string; side: "long" | "short"; usd: number; leverage: number; kind: "market" | "limit"; limitPx?: number; tp?: number; sl?: number }

export interface PerpsSource {
  state(): Promise<PerpsState>;
  markets(): Promise<PerpsMarket[]>;
  setup(): Promise<PerpsState>;
  order(ask: OrderAsk): Promise<{ filled: boolean; line: string }>;
  close(coin: string): Promise<{ line: string }>;
  closeAll(): Promise<{ line: string }>;
  off(): Promise<PerpsState>;
  /** Landing 3 (mainnet only; the core refuses on the test network): Trading → Perps, what arrived → trading, Perps → Trading. */
  fund(usd: number, key: string): Promise<unknown>;
  useArrived(): Promise<PerpsState>;
  takeOut(usd: number, key: string): Promise<unknown>;
}

/** A refusal from the source: the Problem to show as it is. */
export class PerpsProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.code);
    this.problem = problem;
  }
}

/** The core's perps.* through Trade's own bridge (forApps stamps app "trade"; the core refuses any other app). */
export function bridgeSource(bridge: Bridge): PerpsSource {
  const call = async <T>(method: string, p: Record<string, unknown> = {}): Promise<T> => {
    const r = await bridge.call<T>(method, p);
    if ("problem" in r) throw new PerpsProblem(r.problem);
    return r.ok;
  };
  return {
    state: () => call("perps.state"),
    markets: () => call("perps.markets"),
    setup: () => call("perps.setup"),
    order: (ask) => call("perps.order", { ...ask }),
    close: (coin) => call("perps.close", { coin }),
    closeAll: () => call("perps.closeAll"),
    off: () => call("perps.off"),
    fund: (usd, key) => call("perps.fund", { usd, key }),
    useArrived: () => call("perps.useArrived"),
    takeOut: (usd, key) => call("perps.takeOut", { usd, key }),
  };
}
