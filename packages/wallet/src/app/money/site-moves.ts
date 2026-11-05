// Social trading's Take out, after its sheet (SiteMoney.tsx followMoveBack): where each Move back ended, in one line.
// Pure, so node tests it. Only what the core read from 1Click's status is said, never a guess.

export interface MoveBackRead { back: { id: string; status: string }; home?: { status: string; settled?: { amountOut?: string }; expected: { amount: string } } }

/** A Move back's end, in one line, or null while it is still on its way. */
export function moveBackLine(m: MoveBackRead, name: string): { text: string; state: "went" | "quiet" } | null {
  if (m.home?.status === "done") return { text: `$${(Number(m.home.settled?.amountOut ?? m.home.expected.amount) / 1e6).toFixed(2)} from your ${name} wallet is in your Safe.`, state: "went" };
  if (m.back.status === "refunded" || m.home?.status === "refunded" || m.home?.status === "failed") return { text: "The swap service sent it back to your NEAR wallet. Your money is safe there.", state: "quiet" };
  if (m.back.status === "failed") return { text: `It didn't go. Your money is still in your ${name} wallet.`, state: "quiet" };
  return null;
}

/**
 * Several Move backs of one Take out (ST13's sweep), in one closing line once every one has ended: all in the Safe →
 * their dollars together ("$12.10 from your GMGN wallets is in your Safe."); otherwise what reached the Safe and, for
 * each wallet whose leg didn't, where its money is ("Your GMGN BNB wallet's money went back to Spending. It's safe
 * there."). `networks`: each leg's network name, in the same order ("Solana", "BNB"). Null while any is on its way.
 */
export function movesBackLine(ms: readonly (MoveBackRead | undefined)[], name: string, networks: readonly string[] = []): { text: string; state: "went" | "quiet" } | null {
  if (ms.length === 1) return ms[0] ? moveBackLine(ms[0], name) : null;
  const ends = ms.map((m) => (m ? moveBackLine(m, name) : null));
  if (ends.some((e) => e === null)) return null;
  const home = ms.filter((_, i) => ends[i]!.state === "went");
  const sum = home.reduce((n, m) => n + Number(m!.home!.settled?.amountOut ?? m!.home!.expected.amount) / 1e6, 0);
  if (home.length === ms.length) return { text: `$${sum.toFixed(2)} from your ${name} wallets is in your Safe.`, state: "went" };
  const said = ms.flatMap((m, i) => {
    if (ends[i]!.state === "went") return [];
    const whose = `Your ${name}${networks[i] ? ` ${networks[i]}` : ""} wallet's money`;
    return [m!.back.status === "failed" ? `${whose} didn't go. It's still in that wallet.` : `${whose} went back to your NEAR wallet. It's safe there.`];
  });
  return { text: [...(home.length ? [`$${sum.toFixed(2)} is in your Safe.`] : []), ...said].join(" "), state: "quiet" };
}

/** What a Solana wallet keeps when only part of it leaves: the rent-free minimum (890,880 lamports) and a plain fee
 *  (5,000), rounded up. Less than this left behind, and the move is the whole of it ("all": the core keeps the fee). */
export const SOL_KEEP = 905_000n;

/**
 * Take out's amount for the core (subwallet.site.moveBack): "all" at the most (or when what would stay is under the
 * Solana keep), else the share of the wallet's own coin the dollars picked are, in lamports, rounded down. `units` and
 * `maxUsd` are one read of the wallet (spending.wallets: units with cashUsd); with no units, only "all" can be said.
 */
export function backAmount(pickUsd: number, maxUsd: number, units: string | undefined): string {
  if (!(pickUsd < maxUsd) || !units || !/^\d{1,30}$/.test(units) || !(maxUsd > 0)) return "all";
  const all = BigInt(units);
  const part = (all * BigInt(Math.round(pickUsd * 100))) / BigInt(Math.round(maxUsd * 100));
  return part <= 0n || all - part < SOL_KEEP ? "all" : part.toString();
}

/** The least that reaches the Safe from a Take out of `usd` (a $0.50 network allowance, the swap service's 3 %, then a
 *  2 % floor), said on the sheet before the tap: the core's own move back has no sheet (D143). */
/** One wallet's Take out: what the person picked; else the dollars the button that opened the sheet named ("Move $14.85
 *  back to Safe", crawl F5: it opened at $10.00); else `start`, or the whole when that's less. Never under `least` or over
 *  the whole. */
export const backPicked = (total: number, pick: number | null, asked: number | undefined, start: number, least: number): number =>
  Math.min(total, Math.max(least, pick ?? (asked !== undefined && Number.isFinite(asked) && asked > 0 ? asked : Math.min(start, total))));
export const backLeast = (usd: number): number => Math.max(0, ((usd - 0.5) / 1.03) * 0.98);
