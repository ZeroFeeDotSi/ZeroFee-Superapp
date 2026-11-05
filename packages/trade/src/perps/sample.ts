// D119 perps in the sample demo (?demo): Hyperliquid's testnet shapes with sample numbers, in memory, no network. It
// follows the core's rules where the person can see them (the most leverage, the $10 least, TP/SL on the right side),
// so the walk meets the same refusals a real account would, worded the same way.
import type { Problem } from "@zerofee/core/problem";
import { PerpsProblem, type OrderAsk, type PerpsMarket, type PerpsPosition, type PerpsSource, type PerpsState } from "./source.ts";
import { usd } from "./words.ts";

const WHERE = { state: "safe", where: "on Hyperliquid (test money)" } as const;
const no = (whatHappened: string, code = "perps.order.refused"): never => {
  const p: Problem = { code, whatHappened, money: WHERE, next: { kind: "fix-input", label: "Change it", field: "amount" } };
  throw new PerpsProblem(p);
};

export const SAMPLE_MARKETS: PerpsMarket[] = [
  { coin: "BTC", price: 68_250, maxLeverage: 40 },
  { coin: "ETH", price: 3_412.5, maxLeverage: 25 },
  { coin: "SOL", price: 162.35, maxLeverage: 20 },
  { coin: "HYPE", price: 31.204, maxLeverage: 10 },
  { coin: "DOGE", price: 0.16412, maxLeverage: 10 },
];

/** A position as Hyperliquid reports it, from its entry, its size and today's price (liquidation roughly where the
 *  margin runs out). */
function position(coin: string, side: "long" | "short", size: number, entryPx: number, leverage: number): PerpsPosition {
  const px = SAMPLE_MARKETS.find((m) => m.coin === coin)!.price;
  const margin = (size * entryPx) / leverage;
  const pnlUsd = (side === "long" ? 1 : -1) * size * (px - entryPx);
  const liqPx = side === "long" ? entryPx * (1 - 0.9 / leverage) : entryPx * (1 + 0.9 / leverage);
  return { coin, side, size: String(size), valueUsd: size * px, entryPx, pnlUsd, pnlPct: (pnlUsd / margin) * 100, liqPx: leverage > 1 ? liqPx : null, leverage, marginUsd: margin };
}

export function sampleSource(): PerpsSource {
  let on = true;
  const cash = { usd: 1_000 };
  let open: PerpsPosition[] = [position("ETH", "long", 0.1, 3_380, 3)];
  const state = async (): Promise<PerpsState> => {
    const used = open.reduce((n, p) => n + p.marginUsd, 0);
    const value = cash.usd + open.reduce((n, p) => n + p.pnlUsd, 0);
    return { on, ...(on ? { untilMs: Date.now() + 30 * 86_400_000 } : {}), balanceUsd: value, freeUsd: Math.max(0, value - used), testNetwork: true, positions: open };
  };
  return {
    state,
    markets: async () => SAMPLE_MARKETS,
    setup: async () => ((on = true), state()),
    off: async () => ((on = false), state()),
    // the sample is test money: nothing moves in or out (the tab shows no Put money in on the test network)
    fund: async () => { throw new PerpsProblem({ code: "perps.money.test-network", whatHappened: "Test money comes from Hyperliquid's own test faucet, never from Trading.", money: WHERE, next: { kind: "nothing", label: "Go back" } }); },
    useArrived: async () => state(),
    takeOut: async () => { throw new PerpsProblem({ code: "perps.money.test-network", whatHappened: "Test money comes from Hyperliquid's own test faucet, never from Trading.", money: WHERE, next: { kind: "nothing", label: "Go back" } }); },
    async order(ask: OrderAsk) {
      if (!on) no("Perps on Hyperliquid aren't turned on on this phone.", "perps.off");
      const m = SAMPLE_MARKETS.find((x) => x.coin === ask.coin) ?? no("Hyperliquid doesn't list that market.");
      if (!(Number.isInteger(ask.leverage) && ask.leverage >= 1 && ask.leverage <= m.maxLeverage)) no(`${m.coin} goes up to ${m.maxLeverage}× on Hyperliquid.`);
      const ref = ask.kind === "limit" ? ask.limitPx ?? 0 : m.price;
      if (!(ask.usd * ask.leverage >= 10)) no("Hyperliquid's smallest trade is $10 (with leverage). Use a little more.");
      const isLong = ask.side === "long";
      if (ask.tp !== undefined && (ask.tp > ref) !== isLong) no(`Take profit must be ${isLong ? "above" : "below"} ${usd(ref)}.`);
      if (ask.sl !== undefined && (ask.sl < ref) !== isLong) no(`Stop loss must be ${isLong ? "below" : "above"} ${usd(ref)}.`);
      const free = (await state()).freeUsd ?? 0;
      if (ask.usd > free) no(`You have ${usd(free)} free on Hyperliquid. Use less.`);
      const side = isLong ? "Long" : "Short";
      if (ask.kind === "limit" && ref !== m.price) return { filled: false, line: `${side} ${m.coin} waits at ${usd(ref)}.` };
      open = [...open.filter((p) => p.coin !== m.coin), position(m.coin, ask.side, Number(((ask.usd * ask.leverage) / m.price).toPrecision(4)), m.price, ask.leverage)];
      return { filled: true, line: `${side} ${m.coin} opened: ${usd(ask.usd * ask.leverage)} at ${ask.leverage}×.` };
    },
    async close(coin: string) {
      const p = open.find((x) => x.coin === coin);
      if (!p) no(`You have no open ${coin} trade on Hyperliquid.`, "perps.position.none");
      open = open.filter((x) => x.coin !== coin);
      cash.usd += p!.pnlUsd;
      return { line: `${coin} closed. ${p!.pnlUsd >= 0 ? `Made about ${usd(p!.pnlUsd)}` : `Lost about ${usd(-p!.pnlUsd)}`}.` };
    },
    async closeAll() {
      const n = open.length;
      cash.usd += open.reduce((s, p) => s + p.pnlUsd, 0);
      open = [];
      return { line: n === 0 ? "Nothing was open." : n === 1 ? "Your trade is closed." : `All ${n} trades are closed.` };
    },
  };
}
