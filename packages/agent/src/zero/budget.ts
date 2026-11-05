// AgentZero's budget on the account contract (release 10), from its wallet and the pay list. The security design
// review (2 Nov, H1 and H2) shaped it:
// - USDC only. One coin, so "$20 in 24 hours" is $20 in 24 hours on chain. The old Agent budget gave NEAR the same limit too, which
//   made it $40, and NEAR's part grew with NEAR's price.
// - Listed people only. The "any address" cap (`convert_per_day`) is 0, so AgentZero's key can pay only the people on
//   the pay list, whatever this device's code says. With no list, it can pay no one: turning AgentZero on is safe alone.
// - Adding a person loosens the budget, so the account holds it for its safety wait (D59); removing one is at once.
// - D89/D91: a payment goes privately, into a 1Click quote's fresh deposit address, which no list can hold. So while a
//   money job runs, and only once the private route is open (AGENT_PRIVATE_ROUTE), the "any address" cap is that day's
//   its wallet; the core (the signer) still pays only a quote it made itself for a listed person or for Spending. A job
//   stopping takes it back to 0 at once (a tighter budget runs at once).
import { USDC_ID } from "../agent-pay.ts";

const DAY_MS = 86_400_000;
/** Payments one day the contract allows AgentZero's key. */
export const SPENDS_PER_DAY = 12;

export interface ZeroBudget {
  coins: { coin: string; per_day: string; per_month: string; convert_per_day: string }[];
  recipients: string[];
  ends_at_ns: string;
  max_spends_per_day: number;
}

/**
 * The budget for `pocketUsd` one day, paying only `people` (NEAR names, lower case, sorted, no repeats). `endsAtNs`: the
 * current budget's end, kept on a change so a lower limit or a shorter list only tightens and runs at once (a later end
 * would loosen it, and wait).
 */
export function zeroBudget(pocketUsd: number, people: readonly string[], nowMs: number, endsAtNs?: string, opts: { anyAddress?: boolean } = {}): ZeroBudget {
  if (!(pocketUsd > 0) || pocketUsd > 1000) throw new Error("AgentZero's wallet cap must be above $0 and at most $1,000");
  const perDay = BigInt(Math.round(pocketUsd * 100)) * 10_000n;
  return {
    coins: [{ coin: USDC_ID, per_day: perDay.toString(), per_month: (30n * perDay).toString(), convert_per_day: opts.anyAddress ? perDay.toString() : "0" }],
    recipients: [...new Set(people.map((p) => p.trim().toLowerCase()).filter(Boolean))].sort(),
    ends_at_ns: endsAtNs && /^\d{1,20}$/.test(endsAtNs) && BigInt(endsAtNs) > BigInt(nowMs) * 1_000_000n ? endsAtNs : (BigInt(nowMs + 365 * DAY_MS) * 1_000_000n).toString(),
    max_spends_per_day: SPENDS_PER_DAY,
  };
}
