// Agent's tray icons, on the shared 1.25 px hairline (zf-hl).
import type { ReactNode } from "react";

const svg = (children: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

/** Ask: a speech bubble. */
export const TrayAsk = () => svg(<path className="zf-hl" d="M5 5.5h14v10H10l-4 3.5v-3.5H5z" />);

/** Rules: a list with a tick. */
export const TrayRules = () => svg(<><path className="zf-hl" d="M9 7h10M9 12h10M9 17h10" /><path className="zf-hl" d="m4 7.2 1 1 1.6-1.9M4 12.2l1 1 1.6-1.9M4 17.2l1 1 1.6-1.9" /></>);

/** Send: an arrow up, in an outlined ring. */
export const Send = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M12 18V6m-5 5 5-5 5 5" /></svg>
);

export const Open = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M14 5h5v5M19 5l-8 8M9 6H5v13h13v-4" /></svg>
);
