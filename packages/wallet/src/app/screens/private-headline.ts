// Private's headline while a way home is out (QA 20, 8 Nov). Pure: Private.tsx draws it; private-headline.test.ts holds the table.
/** The page's headline while a way home is out (QA 20, 8 Nov: the headline stays the true figure, "$X on its way to your
 *  Safe" under it): the line shows at the tap, but the rows are re-read only once the core answered, so until then the
 *  figure still held what is leaving ("$33.86" over "$33.86 on its way", counted twice). While `away` is set: what Private
 *  held at the tap (`at`) less what is leaving, never above the live read (a re-read that shows less wins); the live read
 *  alone once nothing is on its way. Dollars, to the cent. Pure. */
export function headlineUsd(live: number, away: { usd: string; at?: number } | null): number {
  if (!away || away.at === undefined) return live;
  const leaving = Number(away.usd.replace(/[$,]/g, ""));
  if (!Number.isFinite(leaving) || leaving <= 0) return live;
  return Math.min(live, Math.max(0, Math.round((away.at - leaving) * 100) / 100));
}
