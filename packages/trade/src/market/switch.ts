// One Market, decided once: the live one (GeckoTerminal) or ?demo's recorded one (recorded.ts), whichever `pick` resolves
// to. Every call waits for that answer (the shell's own wallet list, a local call), then goes to the market picked.
import type { Market } from "./types.ts";

export function createSwitchMarket(pick: Promise<Market>): Market {
  const m = pick;
  const via = <K extends keyof Market>(k: K) => (async (...a: unknown[]) => ((await m)[k] as (...x: unknown[]) => unknown)(...a)) as unknown as Market[K];
  let picked: Market | undefined;
  void m.then((x) => { picked = x; }, () => undefined);
  return {
    search: via("search"), trending: via("trending"), coin: via("coin"), candles: via("candles"),
    nativeUsd: via("nativeUsd"), checkedUsd: via("checkedUsd"), sizingUsd: via("sizingUsd"), meta: via("meta"),
    trades: async (c, a, min) => (await m).trades?.(c, a, min) ?? [], checks: async (c, a) => (await m).checks?.(c, a),
    // the recorded market has no New list (an empty one) and no batch prices (none: the list keeps its own)
    fresh: async (c, o) => (await m).fresh?.(c, o) ?? [], prices: async (c, a) => (await m).prices?.(c, a) ?? {},
    livePrice(chain, address, onPrice, onState) {
      if (picked) return picked.livePrice(chain, address, onPrice, onState);
      let off: (() => void) | undefined, gone = false;
      void m.then((x) => { if (!gone) off = x.livePrice(chain, address, onPrice, onState); }, () => undefined);
      return () => { gone = true; off?.(); };
    },
    liveTrades(chain, address, onTrade, onDrop) {
      if (picked) return picked.liveTrades?.(chain, address, onTrade, onDrop) ?? (() => {});
      let off: (() => void) | undefined, gone = false;
      void m.then((x) => { if (!gone) off = x.liveTrades?.(chain, address, onTrade, onDrop); }, () => undefined);
      return () => { gone = true; off?.(); };
    },
    stats: () => picked?.stats() ?? { calls: 0, hits: 0, stale: 0, errors: 0, lowSkipped: 0 },
    // until the pick is known, nothing is claimed live either way (the coin page reads this as it draws)
    get recorded() { return picked?.recorded === true; },
  };
}
