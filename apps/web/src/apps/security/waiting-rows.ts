// Security's "Waiting for you" list, one row for each different thing (UX walk 2 Nov: the test two saved protection
// changes, the same rules in dollars, read as two identical "Change your protection · Finish" rows). Changes whose row
// says exactly the same thing, in the same state, are one row: the newest, the one to finish. Payments are never merged
// (two identical payments are two payments), and nothing is dropped from the account: the other stays listed on
// the account and comes back here if the newest is cancelled.

export interface WaitingRowLike {
  id: string | number;
  title: string;
  lines: string[];
  details?: unknown;
  ready: boolean;
  change?: boolean;
  needsSecondDevice?: boolean;
  secondDeviceSaidYes?: boolean;
  warning?: string;
}

// What the person reads (the title, the dollar lines, the state), never the coin-by-coin details behind them: the
// a test account's two saves differ only there (0.00915 and 0.00916 ETH, priced a few minutes apart) and read the same.
const sameness = (w: WaitingRowLike) => JSON.stringify([w.title, w.lines, w.ready, w.needsSecondDevice === true, w.secondDeviceSaidYes === true, w.warning ?? null]);
const newer = (a: WaitingRowLike, b: WaitingRowLike) => (/^\d+$/.test(String(a.id)) && /^\d+$/.test(String(b.id)) ? BigInt(a.id) > BigInt(b.id) : String(a.id) > String(b.id));

/** One row per different change (the newest of each), payments all kept, in the list's own order. */
export function oneRowEach<T extends WaitingRowLike>(items: readonly T[]): T[] {
  const keep = new Map<string, T>();
  for (const w of items) {
    if (!w.change) continue;
    const k = sameness(w);
    const had = keep.get(k);
    if (!had || newer(w, had)) keep.set(k, w);
  }
  return items.filter((w) => !w.change || keep.get(sameness(w)) === w);
}
