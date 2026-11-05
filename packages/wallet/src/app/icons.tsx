// Wallet's own hairline icons, drawn like @zerofee/design/icons.tsx: 24-unit box, the 1.25 px line, no fills.
const P = (d: string, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d={d} />
  </svg>
);

/** The ZeroFee mark's shape: a circle with one stroke through it. */
export const TrayBalance = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="zf-hl" cx="12" cy="12" r="8" />
    <path className="zf-hl" d="M7.5 16.5 16.5 7.5" />
  </svg>
);
export const TrayConvert = () => P("M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5");
export const Right = () => P("m9.5 6 6 6-6 6", 16);
export const Down = () => P("m7 10 5 5 5-5", 16);
export const Search = () => P("M10.5 16a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM14.5 14.5l4.5 4.5", 18);
export const SmallCheck = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path className="zf-hl" style={{ strokeWidth: 1.6 }} d="m2.5 6.2 2.3 2.3 4.7-5" />
  </svg>
);
export const Bang = () => P("M12 7v6M12 16.5v.5", 14);
/** Private (D27): an eye, closed by one stroke, in a hairline ring the size of a coin's logo. */
export const PrivateMark = ({ size = 30 }: { size?: number }) => (
  <span className="wl-private-mark" style={{ width: size, height: size }} aria-hidden="true">
    <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
      <path className="zf-hl" d="M3 12s3.3-5.5 9-5.5S21 12 21 12s-3.3 5.5-9 5.5S3 12 3 12Z" />
      <circle className="zf-hl" cx="12" cy="12" r="2.5" />
      <path className="zf-hl" d="M4.5 19.5 19.5 4.5" />
    </svg>
  </span>
);


// Home's four actions (design review §1): Add, Send, Swap, Move, one glyph each on a round button.
export const ActAdd = () => P("M12 5v14M5 12h14");
export const ActSend = () => P("M12 19V5M6 11l6-6 6 6");
export const ActSwap = () => P("M5 9h13l-3.5-3.5M19 15H6l3.5 3.5");
export const ActMove = () => P("M8 4v15l-3-3M16 20V5l3 3");
/** The wallet bar's All (four tiles) and Safe (a shield), at the chains' logo size. */
export const TabAll = () => P("M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z", 16);
export const TabSafe = () => P("M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2L12 3.5Z", 16);
