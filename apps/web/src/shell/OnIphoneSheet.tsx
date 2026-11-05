// The web wallet's "On iPhone" page (bug report, 5 Nov late): one full-screen sheet (D135, Close in its corner) for a
// place that lives only on the iPhone (Quantum-safe, Protection, Devices, Settings' Passwords). Its title, one line on
// what it does there, and two links, the top note's own: Laptop approval and Get the code. No toggle and no state: this
// browser has none of it, so nothing here claims any.
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ON_IPHONE_LINKS, type OnIphonePage } from "@zerofee/shell-api/web-account-words.ts";
import "./on-iphone.css";

// The top note's own addresses (top-note-words.ts, pinned equal in web-account-rows.test.ts), kept here, not imported: the
// top note's module is in no chunk of the phone's build (speed-budget.test.ts), and this page's chunk is built there too.
/** The laptop's own site (mode.ts SECOND_DEVICE_SITE). */
export const LAPTOP_URL = "https://laptop.zerofee.si";
/** Where "Get the code" goes while the build names no code address (VITE_CODE_URL unset): the self-host guide. */
export const CODE_FALLBACK = "https://zerofee.si/docs/self-host";
/** The build's VITE_CODE_URL when it is an https address, else the fallback (never empty or dead). */
export const codeLink = (codeUrl: string | undefined): string => {
  const url = (codeUrl ?? "").trim();
  return /^https:\/\/[^\s/]+/.test(url) ? url : CODE_FALLBACK;
};

/** `codeUrl`: the build's VITE_CODE_URL (codeLink falls back to the self-host guide while it is unset). */
export function OnIphoneSheet({ page, codeUrl, onClose }: { page: OnIphonePage; codeUrl: string | undefined; onClose: () => void }) {
  return (
    <Sheet title={page.title} onClose={onClose}>
      <div className="oni" data-testid="on-iphone">
        <p className="zf-body oni__line">{page.line}</p>
        <div className="oni__links">
          <a className="oni__link" href={LAPTOP_URL} target="_blank" rel="noopener noreferrer">{ON_IPHONE_LINKS.laptop}</a>
          <a className="oni__link" href={codeLink(codeUrl)} target="_blank" rel="noopener noreferrer">{ON_IPHONE_LINKS.code}</a>
        </div>
      </div>
    </Sheet>
  );
}
