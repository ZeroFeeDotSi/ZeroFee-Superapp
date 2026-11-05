// The crawl (4 Nov): a fresh coin's trade read "Buy $1.00 of X" on its task and $1.15 on its Activity row. The task's
// title stays what was asked; its detail says the rest once the second node's check has read the chain's figure (the
// coin, the fee, the coin account's deposit, pump.fun's one-time account): "Landed in 0.90 s · Plus $0.15 for Solana"
// (the Copywriter, 4 Nov). A sale's says its figure in all, as before.
import { usd } from "./format.ts";
import { tradeUsd } from "../trade-usd.ts";

/** The task's detail once landed. `rec.costs` absent: the chain's figure isn't read yet, only the time. */
export function landedDetail(time: string, rec: { kind: string; amountUsd: number; costs?: unknown; quote?: { payUsd: number } }, chain: string): string {
  if (!rec.costs) return `Landed in ${time}`;
  if (rec.kind !== "buy") return `Landed in ${time} · ${usd(tradeUsd(rec as Parameters<typeof tradeUsd>[0]))}`;
  const extra = Math.round((rec.amountUsd - (rec.quote?.payUsd ?? rec.amountUsd)) * 100) / 100;
  return extra >= 0.01 ? `Landed in ${time} · Plus ${usd(extra)} for ${chain}` : `Landed in ${time}`;
}

/** `then` once the record has its chain figure (the service tells every change: `on`), or never after `giveUpMs`. */
export function whenCosted(on: (f: () => void) => () => void, rec: { costs?: unknown }, then: () => void, giveUpMs = 60_000): void {
  if (rec.costs) return then();
  let stop: (() => void) | undefined;
  const t = setTimeout(() => stop?.(), giveUpMs);
  stop = on(() => { if (!rec.costs) return; clearTimeout(t); stop?.(); then(); });
}
