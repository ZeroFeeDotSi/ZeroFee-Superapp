// Wallet's total for another app to show (the user-robot walk, 26 Oct: "three different totals for my money"). Pay shows
// the same figure as Wallet's Balance: the same reads through the app's own bridge (the ledger's balances, Earn's
// validators, Private, Spending), the same sum (balanceTotal), read again when the balances move. Null until every part has
// answered, so the number never changes by itself.
//
//   const total = useBalanceTotal(bridge, shell.active);   →  "5643.15", or null while reading
//
// `active`: read again each time the app comes on screen (a trade in Trade moves the total without telling the ledger).
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";

/** The same total, read once: null when the balances can't be read (the Sim's AgentZero sample answer, sim-chat.ts).
 *  The wallets' part is Home's own (home-cache.ts viewOf: tradingUsd, with every site wallet and NEAR coin): QA
 *  (5 Nov) "What's my balance?" said $5,460.55 beside Home's $5,510.55, the $50 in pump.fun's and GMGN's wallets left out. */
export async function readBalanceTotal(bridge: Bridge): Promise<string | null> {
  return (await readBalanceParts(bridge))?.usd ?? null;
}

/** The same total and whether a part is still missing (`partial`: Spending's wallets not read yet),
 *  so a screen waits for the whole figure (QA 5 Nov: the Sim's set-up said $5,288.01, the Safe alone, while
 *  Home opened on $5,510.55). Null when the balances can't be read. Its reads and sum (balance-parts.ts, with AgentZero's
 *  own wallet as Home's row: QA 5 Nov) load on the first ask, never in Home's first load. */
export const readBalanceParts = (bridge: Bridge): Promise<{ usd: string; partial: boolean } | null> => import("./balance-parts.ts").then((m) => m.readBalanceParts(bridge));

/** While a part is missing, read again this often, at most PARTIAL_READS times; then the figure as it is. */
export const PARTIAL_READ_MS = 1_000;
export const PARTIAL_READS = 20;

export function useBalanceTotal(bridge: Bridge, active = true): string | null {
  const [total, setTotal] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => bridge.on("ledger.balancesChanged", () => setTick((t) => t + 1)), [bridge]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (n: number) => void readBalanceParts(bridge).then((t) => {
      if (!live || t === null) return;
      // a figure missing the wallets is never shown as the total: read again until it is whole (or after 20 s, as it is)
      if (t.partial && n < PARTIAL_READS) timer = setTimeout(() => read(n + 1), PARTIAL_READ_MS);
      else setTotal(t.usd);
    });
    read(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, tick, active]);
  return total;
}
