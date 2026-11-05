// Audit 3 Nov, H1 (fix #3): every Add, Send and Move could be linked on chain by amount and time: "X in at T" lined up
// with "≈X out at T+1 s". Random waits stay rejected (D133, D137). Instead, round the INFLOW, never the payout: leg 1
// brings the amount rounded UP to a grid, the payee gets exactly what was asked, and the rest stays in the person's own
// private balance (shown there). Nothing lands short, so this is no trim, and no wait: 0 ms.
//
// The grid: the smallest number with two significant figures, in the coin's own units, at or above the amount plus
// INFLOW_GAP. The gap keeps every inflow at least 3 % over what goes out, the most 1Click's own price and fees move a
// payment (MAX_OVER), so an explorer can't pair them by amount however close the amount sat under a grid line. Fee check
// (1Click's own quotes, recorded): moving the same coin into the private balance costs nothing more for a bigger amount
// (1.000000 in, 1.000000 out); a leg that changes the coin costs its share (about 0.2 %) of the extra, under a cent for
// most sends, and that extra is the person's, kept in the private balance.

/** The least an inflow sits over what goes out (3 %, the core's own price room). */
export const INFLOW_GAP_BPS = 300n;

/**
 * `units` (the coin's smallest units) rounded up to the inflow grid; `upTo` (what the source can send): when the grid
 * would take more than that, exactly `units` (the old way, said by the caller). Never less than `units`.
 */
export function inflowUp(units: bigint, upTo?: bigint): bigint {
  if (units <= 0n) return units;
  const floor = units + (units * INFLOW_GAP_BPS + 9_999n) / 10_000n;
  const digits = floor.toString().length;
  const step = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  const up = ((floor + step - 1n) / step) * step;
  return upTo !== undefined && up > upTo ? units : up;
}

/** The grid amount at or under `units` (two figures); 0 for nothing. */
export function gridDown(units: bigint): bigint {
  if (units <= 0n) return 0n;
  const digits = units.toString().length;
  const step = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  return (units / step) * step;
}

/**
 * Privacy audit (4 Nov, review of fix/audit-privacy): a Max Send (all the source holds, `upTo`; `fromPocket` of it paid
 * straight from the private balance, no inflow) used to go exactly, off the grid. Paying the payee all of a grid inflow
 * less fees left ~99 % out of what went in, which an explorer still pairs. So Max is a Send like any other: leg 1 brings
 * the grid amount at or under what the source holds (`inflow`; the dust under it stays in the source), the payment is
 * the most that keeps the grid's gap under it (`asked`, at least INFLOW_GAP_BPS less), and the rest stays in the
 * person's private balance. The gap holds for the TOTAL the payee gets (review: a pocket part on top of `asked` put the
 * payout back at ~99 % of the inflow, paired): `pays` = `pocketPays` + `asked` is the most at least INFLOW_GAP_BPS under
 * the inflow. The pocket pays first, up to that; what no longer fits stays in the private balance. A pocket that alone
 * fills it: no inflow at all (`inflow` 0, `asked` 0), so nothing public to pair with; the WHOLE pocket share is paid and
 * the Safe's part stays in the Safe. Null: nothing to round.
 */
export function maxSend(upTo: bigint, fromPocket = 0n): { inflow: bigint; asked: bigint; pocketPays: bigint; pays: bigint } | null {
  const grid = gridDown(upTo - fromPocket);
  if (grid <= 0n) return null;
  const over = (x: bigint) => x + (x * INFLOW_GAP_BPS + 9_999n) / 10_000n;
  let most = (grid * 10_000n) / (10_000n + INFLOW_GAP_BPS);
  while (most > 0n && over(most) > grid) most--;
  while (over(most + 1n) <= grid) most++;
  if (most <= 0n) return null;
  if (fromPocket >= most) return { inflow: 0n, asked: 0n, pocketPays: fromPocket, pays: fromPocket };
  return { inflow: grid, asked: most - fromPocket, pocketPays: fromPocket, pays: most };
}

/** What of a leg that brought `brought` (its signed minimum) pays a payment of `asked` out of `gridded` sent: the asked
 *  share, rounded down (the rest stays in the private balance). */
export function askedShare(brought: bigint, asked: bigint, gridded: bigint): bigint {
  if (gridded <= 0n || asked >= gridded) return brought;
  return (brought * asked) / gridded;
}

/**
 * THE rule for what the Safe sends for a Move on to a wallet (spending.topUp, and every sheet that says it before the
 * tap): `usd` rounded up to the inflow grid when the Safe's dollar coin covers it (`coversUsd`), the room under the cap
 * holds it (`roomUsd`) and the Face ID band takes it (`bandUsd`, null: no band read, so none applied, as the core); else
 * exactly `usd`. Privacy audit (4 Nov): the rest STAYS in the NEAR wallet's private balance. It used to come back to the
 * Safe in the same job, a public step on intents.near, so "what left the Safe less what came back" was exactly what the
 * wallet got and the rounding hid nothing. With no move home there is no $2 floor (a move home's least) to clear: the
 * grid is always at least 3 % over (INFLOW_GAP_BPS), which also covers the legs' own fee room (the engine's
 * OUT_FEE_ROOM), so any Move the Safe can cover is rounded, and what the legs' fees leave of the rest is the person's,
 * counted in Spending.
 */
export function gridAddUsd(usd: number, o: { coversUsd: number; roomUsd: number; bandUsd: number | null }): number {
  if (!(usd > 0)) return usd;
  const g = Number(inflowUp(BigInt(Math.round(usd * 100)))) / 100;
  const fits = g <= o.coversUsd + 0.004 && g <= o.roomUsd + 0.004 && (o.bandUsd === null || g <= o.bandUsd + 0.004);
  return fits ? g : usd;
}

/** The rest's words, the same on every sheet and the Approve: it stays hidden, never a public step back to the Safe. */
export const REST_STAYS_LINE = "The rest stays in Private.";
/** The line saved rows (before 5 Nov) still carry; read as the same thing, never written. */
export const REST_STAYS_OLD = "The rest stays in Private.";
