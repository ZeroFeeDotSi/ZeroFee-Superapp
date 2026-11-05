// Pay's own hairline icons, drawn like @zerofee/design/icons.tsx: 24-unit box, the 1.25 px line, no fills.
const P = (d: string, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d={d} />
  </svg>
);

export const TrayScan = () => P("M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10");
export const TraySend = () => P("M7 17 17 7M9 7h8v8");
export const TrayReceive = () => P("M17 7 7 17M15 17H7V9");
export const TrayCash = () => P("M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4");
export const TrayCard = () => P("M3.5 6.5h17v11h-17zM3.5 10h17");
export const Outward = () => P("M7 17 17 7M9 7h8v8", 18);
export const CameraOff = () => P("M4 8h3l1.5-2h7L17 8h3v10H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 3l18 18", 32);
export const Share = () => P("M12 4v11M8 8l4-4 4 4M5 13v6h14v-6", 18);
export const Tick = () => (
  <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
    <circle className="zf-hl" cx="48" cy="48" r="46" />
    <path className="zf-hl" style={{ strokeWidth: 1.6 }} d="m32 49 11 11 22-24" />
  </svg>
);
export const CardMark = () => (
  <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true">
    <circle className="zf-hl" cx="12" cy="11" r="10" />
    <circle className="zf-hl" cx="22" cy="11" r="10" />
  </svg>
);
