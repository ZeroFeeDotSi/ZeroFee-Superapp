// A-12, explain before act (master plan Part 3 row 12): before any AgentZero job or act scope is approved, its sheet
// first says what AgentZero would do, step by step, the most it can cost, and what it never touches:
//   "Here's what I'd do:" · "1. Watch the wallet you picked." · … · "3 steps, $20 most." · "Never takes from your Safe."
// The dollars are the core's: a step given in dollars is the job's own limit; a step given in a coin is priced by the
// core's own price function, never by a model. A step that can't be priced says so ("I can't tell the cost of step 2.")
// and the sheet has no Approve. Pure: shared by the core's act scope sheet and AgentZero's job sheets (which import it
// from the core, as the core can't import the agent package).

/** One step: its words, and the most it can cost, in dollars or as a coin amount the core prices. */
export type DryStep =
  | { words: string; usd: number }
  | { words: string; coin: string; amount: number };

export interface DryRun {
  /** The sheet's first lines, in order. */
  lines: string[];
  /** The most it can cost in all, in dollars; null when a step couldn't be priced. */
  mostUsd: number | null;
  /** False when a step couldn't be priced: the sheet shows no Approve. */
  canApprove: boolean;
}

export const DRY_HEAD = "Here's what I'd do:";
const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/**
 * The dry run for these steps. `price(coin)`: the core's dollar price for one unit of a coin, or null. `never`: what the
 * job never touches, one line each ("Never takes from your Safe."). A step's cost must be a finite number of dollars, 0 or more.
 */
export function dryRun(steps: readonly DryStep[], o: { price?: (coin: string) => number | null; never?: readonly string[]; per?: string; /** the sheet says its own limit: no "N steps, $X most" line */ noTotal?: true } = {}): DryRun {
  const lines = [DRY_HEAD, ...steps.map((s, i) => `${i + 1}. ${s.words}`)];
  let most = 0;
  let unpriced: number | null = null;
  steps.forEach((s, i) => {
    if (unpriced !== null) return;
    const usd = "usd" in s ? s.usd : (() => {
      const p = o.price ? o.price(s.coin) : null;
      return p !== null && Number.isFinite(p) && p >= 0 && Number.isFinite(s.amount) && s.amount >= 0 ? p * s.amount : Number.NaN;
    })();
    if (!(Number.isFinite(usd) && usd >= 0)) unpriced = i + 1;
    else most += usd;
  });
  if (unpriced !== null) {
    lines.push(`I can't tell the cost of step ${unpriced}.`);
    return { lines: [...lines, ...(o.never ?? [])], mostUsd: null, canApprove: false };
  }
  // Cents, rounded up: never say less than the most it can cost.
  const cents = Math.ceil(Math.round(most * 1e6) / 1e4) / 100;
  if (!o.noTotal) lines.push(`${steps.length} ${steps.length === 1 ? "step" : "steps"}, ${cents === 0 ? "no money moves" : `${dollars(cents)} most${o.per ? ` ${o.per}` : ""}`}.`);
  return { lines: [...lines, ...(o.never ?? [])], mostUsd: cents, canApprove: true };
}
