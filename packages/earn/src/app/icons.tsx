// Earn's tray icons, in the design system's hairline style (24 px, 1.25 px strokes, .zf-hl).
import type { ReactNode } from "react";

const Icon = ({ d, extra }: { d: string; extra?: ReactNode }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d={d} />
    {extra}
  </svg>
);

/** A line rising from the floor: what's earning. */
export const TrayEarning = () => <Icon d="M4 19.5h16M6 16c3.2 0 4.6-2.2 6-5.2S15.4 5 18.5 5" extra={<circle className="zf-hl" cx="18.5" cy="5" r="1.4" />} />;
/** Down into the floor: put NEAR in. */
export const TrayStake = () => <Icon d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />;
/** Lines of a list: what moved. */
export const TrayHistory = () => <Icon d="M5 7h14M5 12h14M5 17h9" />;
