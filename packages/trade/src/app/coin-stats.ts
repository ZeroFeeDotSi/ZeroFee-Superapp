// The coin page's numbers under the chart (test, 4 Nov, "Pump": "—" for seconds on a coin the list had just shown). The
// page's own answer when it has one; until then, or when it came from the chain alone, the row that was tapped (the list
// read the coin's deepest pool, the page's pool too). Display only.
import type { CoinDetail, CoinRow } from "../market/types.ts";

export interface StatFigures { mcap?: number; liquidityUsd?: number; volume24hUsd?: number; createdAt?: number }

/** `px`: the price on screen; the total worth moves with it. */
export function statFigures(d: CoinDetail | undefined, seed: Pick<CoinRow, "priceUsd" | "marketCapUsd" | "liquidityUsd" | "volume24hUsd" | "createdAt">, px?: number): StatFigures {
  const own = d?.marketCapUsd !== undefined;
  const cap = own ? d!.marketCapUsd : seed.marketCapUsd, at = own ? d!.priceUsd : seed.priceUsd;
  const mcap = cap !== undefined && at && px !== undefined ? cap * (px / at) : cap;
  const out: StatFigures = {};
  if (mcap !== undefined && Number.isFinite(mcap)) out.mcap = mcap;
  const liq = d?.liquidityUsd ?? seed.liquidityUsd; if (liq !== undefined) out.liquidityUsd = liq;
  const vol = d?.volume24hUsd ?? seed.volume24hUsd; if (vol !== undefined) out.volume24hUsd = vol;
  const born = d?.createdAt ?? seed.createdAt; if (born !== undefined) out.createdAt = born;
  return out;
}
