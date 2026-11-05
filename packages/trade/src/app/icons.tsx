// Trade's own hairline icons, drawn like @zerofee/design/icons.tsx: 24-unit box, the 1.25 px line, no fills.
const P = (d: string, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d={d} />
  </svg>
);

export const TrayDiscover = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle className="zf-hl" cx="12" cy="12" r="8" /><path className="zf-hl" d="m14.8 9.2-1.6 4-4 1.6 1.6-4z" /></svg>
);
/** Settings: two sliders (V1's settings mark). */
export const Gear = () => P("M4 8h10M18 8h2M4 16h3M11 16h9M16 6v4M9 14v4");
/** Home: a house, the tray's first item (V1). */
export const TrayHome = () => P("M4 11.5 12 5l8 6.5M6.5 10v9h11v-9M10 19v-5h4v5");
/** Perps: one line up, one line down (long and short). */
export const TrayPerps = () => P("M5 15.5 10 10.5l3 3 6-6M15 7.5h4v4M5 19h14");
export const TrayPositions = () => P("M4 18.5h16M6.5 15.5v-4M11 15.5v-7.5M15.5 15.5v-5.5M20 15.5V5");
export const Search = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle className="zf-hl" cx="8" cy="8" r="5.5" /><path className="zf-hl" d="m12.2 12.2 3.8 3.8" /></svg>
);
export const Forward = () => P("m10 7 5 5-5 5", 16);
/** The chart's two looks: candles, and the line. */
export const CandlesIcon = () => P("M7 4v16M5.5 8h3v7h-3zM17 4v16M15.5 6h3v9h-3z", 20);
export const LineIcon = () => P("M3.5 16.5 9 10.5l4 3.5 7.5-8", 20);
