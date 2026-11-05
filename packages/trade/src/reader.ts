// Trade, read-only, for the shell: it answers trade.holdings and trade.positions and nothing else, so Wallet's one total
// can show "In trading" and Home V4 can list each chain's held coins under its row, as the very figures Trade shows: the Trading total (TRADE-FLOAT.md) = the Trading balance (the float) + every trading
// wallet's own coin + every coin held + money on its way between them (an Add counts from the moment main lets it go).
// The shell gives it the Trade app's bridge, forApps(base, "trade"). It can't sign, move or write anything: its bridge passes
// only reads. Once the Trade app has opened, the reader asks the app's own runtime (its float knows the moves on their
// way); before that, one of its own, on the read-only bridge (nothing is moving then: the planner runs only in the app).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { securityProblems } from "@zerofee/core/security-problems";
import { coinAmount as amountOf } from "./float-core.ts";
import { appRuntime, createTradeRuntime, type TradeRuntime } from "./runtime.ts";
import { holdingsUsd } from "./service.ts";
import { tradeProblems } from "./trade-problems.ts";
import type { ChainId } from "./types.ts";

/** One coin held on a chain, for Home V4's sub-rows: `amount` as the coin ("1250.5"), `usd` when it has a price. */
export interface HeldCoin { chain: ChainId; address: string; symbol: string; amount: string; usd?: string }

// subwallet.balances: a read too (?demo: the sample wallets hold their opening money in the core's own balances)
const READS = new Set(["subwallet.list", "device.store.get", "subwallet.float.balance", "subwallet.balances"]);

export function createTradeReader(tradeBridge: Bridge, runtimeFor: (b: Bridge) => TradeRuntime = createTradeRuntime): Bridge {
  const unknown = <T>(method: string): Promise<BridgeResult<T>> => Promise.resolve({ problem: securityProblems.methodUnknown(method) });
  const readOnly: Bridge = {
    call: <T>(method: string, params?: Record<string, unknown>) => (READS.has(method) ? tradeBridge.call<T>(method, params) : unknown<T>(method)),
    on: () => () => {},
  };
  let own: TradeRuntime | undefined;
  /** Home V4's sub-rows (FLOW-V4 §1.3): every coin held on each chain, as Trade's Positions has it. A read; it signs,
   *  moves and writes nothing. A coin with no price is its amount alone (usd absent), never $0. */
  const positions = async <T,>(): Promise<BridgeResult<T>> => {
    try {
      const { svc } = appRuntime() ?? (own ??= runtimeFor(readOnly));
      const held = (await svc.positions()).filter((p) => /^\d+$/.test(p.raw) && BigInt(p.raw) > 0n);
      const rows: HeldCoin[] = held.map((p) => ({ chain: p.chain, address: p.coin, symbol: p.symbol, amount: amountOf(BigInt(p.raw), p.decimals), ...(typeof p.valueUsd === "number" && Number.isFinite(p.valueUsd) ? { usd: p.valueUsd.toFixed(2) } : {}) }));
      return { ok: rows as T };
    } catch {
      return { problem: tradeProblems.marketBusy() };
    }
  };
  return {
    async call<T>(method: string): Promise<BridgeResult<T>> {
      if (method === "trade.positions") return positions<T>();
      if (method !== "trade.holdings") return unknown<T>(method);
      const app = appRuntime();
      try {
        // a Trading balance that couldn't be read is no figure at all, never $0 added in (audit MKT-3): Wallet then shows no
        // "In trading" row rather than a total short by the whole reserve
        if (app) {
          await app.float.refresh();
          const s = app.float.snapshot();
          if (!s.loaded) return { problem: tradeProblems.marketBusy() };
          return { ok: { usd: s.totalUsd.toFixed(2) } as T };
        }
        const { svc } = (own ??= runtimeFor(readOnly));
        const [wallets, positions, float] = await Promise.all([
          svc.wallets(), svc.positions(),
          readOnly.call<{ usd: number }>("subwallet.float.balance", {}).then((r) => { if (!("ok" in r)) throw new Error("your NEAR wallet's balance couldn't be read"); return r.ok.usd; }),
        ]);
        return { ok: { usd: (holdingsUsd(wallets, positions) + float).toFixed(2) } as T };
      } catch {
        return { problem: tradeProblems.marketBusy() };                       // Wallet then shows no "In trading" row
      }
    },
    on: () => () => {},
  };
}
