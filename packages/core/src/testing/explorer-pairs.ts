// The explorer the inflow grid is graded against (audit H1, fix #3), shared by the core's and Wallet's tests.

/** An outflow pairs with an inflow seen at most 10 s before it whose amount, less 1Click's usual 0.2 % to 3 %, is the
 *  outflow's (amounts in the same coin's units). Answers how many outflows it pairs. */
export function pairs(inflows: { amount: number; at: number }[], outflows: { amount: number; at: number }[]): number {
  let n = 0;
  for (const o of outflows) if (inflows.some((i) => o.at - i.at >= 0 && o.at - i.at <= 10 && o.amount <= i.amount * 0.998 && o.amount >= i.amount * 0.97)) n++;
  return n;
}
