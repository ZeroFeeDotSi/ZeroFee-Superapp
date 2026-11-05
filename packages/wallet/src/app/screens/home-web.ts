// The web wallet's own Home parts (product decision, 4 Nov: superapp.zerofee.si, no Safe), loaded by Home on the web only,
// after its first paint (Home's JS budget, speed-budget.test.ts: the phone's first load never carries them).

/** The web wallet's wallets-read lines and its link (the Copywriter, 4 Nov: what didn't load, never who). */
export const WEB_READ_WORDS = {
  none: "Your wallets didn't load. Your money is still in them.",
  asOf: (time: string) => `These are from ${time}. New ones didn't load.`,
  retry: "Try again",
} as const;

/** The web wallet's big number from its wallets' figures (QA, 4 Nov: 0.05 SOL read, its price 429'd, Home said
 *  "Empty $0.00" for 19 min). `usd` null: not read; `unpriced`: its coin read (`amount`, "0.05 SOL") but not its price.
 *  - every wallet priced: their total;
 *  - one wallet unpriced and the rest under a cent: its amount is the number ("0.05 SOL");
 *  - else the priced part as the number (when a cent or more), the amounts on the line under it ("and 0.05 SOL": the Copywriter, never "+");
 *  - nothing to say yet: the kept total (none with an amount on screen: it may be from before that money came), else
 *    null (the skeleton). Never "$0.00" over money that was read. `sum` adds dollar strings. */
export function webHero(rows: readonly { usd: string | null; amount: string | null; unpriced?: boolean | undefined }[], lastTotal: string | null, sum: (xs: (string | null)[]) => string): { usd: string | null; amount: string | null; line: string | null } {
  const bare = rows.filter((r) => r.unpriced && r.amount && r.usd === null);
  const rest = rows.filter((r) => !bare.includes(r));
  if (!bare.length) return rest.every((r) => r.usd !== null) ? { usd: sum(rest.map((r) => r.usd)), amount: null, line: null } : { usd: lastTotal, amount: null, line: null };
  const priced = rest.every((r) => r.usd !== null) ? sum(rest.map((r) => r.usd)) : null;
  if (bare.length === 1 && priced !== null && !(Number(priced) >= 0.01)) return { usd: null, amount: bare[0]!.amount, line: null };
  return { usd: priced !== null && Number(priced) >= 0.01 ? priced : null, amount: null, line: `and ${bare.map((r) => r.amount).join(" and ")}` };
}
