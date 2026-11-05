// The Browser's tray and row icons, in the design system's hairline style (24 px, 1.25 px strokes, .zf-hl).
import type { ReactNode } from "react";

const Icon = ({ children, size = 24 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

/** A globe: any site. */
export const TrayBrowse = () => (
  <Icon>
    <circle className="zf-hl" cx="12" cy="12" r="8" />
    <path className="zf-hl" d="M4 12h16M12 4c2.4 2.3 3.6 5 3.6 8s-1.2 5.7-3.6 8c-2.4-2.3-3.6-5-3.6-8S9.6 6.3 12 4Z" />
  </Icon>
);
/** Two links: sites joined to your wallet. */
export const TraySites = () => (
  <Icon>
    <path className="zf-hl" d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </Icon>
);
/** A small wallet. */
export const TrayWallet = () => (
  <Icon>
    <path className="zf-hl" d="M4.5 7.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h9" />
    <path className="zf-hl" d="M15.5 13.5h4" />
  </Icon>
);
/** Four corners: scan a code. */
export const Scan = () => (
  <Icon size={22}>
    <path className="zf-hl" d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3M8 12h8" />
  </Icon>
);
/** A site with no mark of its own (one the person typed). */
export const SiteMark = () => (
  <Icon size={20}>
    <circle className="zf-hl" cx="12" cy="12" r="8" />
    <path className="zf-hl" d="M4 12h16M12 4c2.4 2.3 3.6 5 3.6 8s-1.2 5.7-3.6 8c-2.4-2.3-3.6-5-3.6-8S9.6 6.3 12 4Z" />
  </Icon>
);
