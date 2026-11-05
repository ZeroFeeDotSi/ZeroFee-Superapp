// Recent on the Browser's start page (UI concept v3.1, 5 Nov; product decision, 3 Nov: recent pages beside pump.fun and GMGN): one
// grouped card of rows, the signed-in sites with their wallet's dollars first, then the pages opened lately (recent.ts).
// A site's row opens its own app; a page's row opens it the way the address bar does (on the phone, right where it was
// left, Places.swift).
import { PRESET_LOGO } from "../app/chains.tsx";
import { presetForHost } from "../presets.ts";
import { Mark, initialOf } from "./Favourites.tsx";
import type { RecentRow } from "./recent.ts";

export const RECENT = { head: "Recent" } as const;

export function Recent({ rows, onOpen, onSite }: { rows: RecentRow[]; onOpen: (url: string) => void; onSite: (site: string) => void }) {
  if (!rows.length) return null;
  return (
    <section className="sh-recent" aria-label={RECENT.head}>
      <div className="sh-favs-head">
        <span className="zf-label">{RECENT.head}</span>
      </div>
      <ul className="zf-group sh-group">
        {rows.map((r) => {
          const logo = PRESET_LOGO[presetForHost(r.host)?.id ?? ""];
          return (
            <li key={r.key}>
              <button className="zf-row sh-recent-row" onClick={() => ("site" in r.open ? onSite(r.open.site) : onOpen(r.open.url))} data-testid="browser-recent">
                <span className="sh-recent-logo" aria-hidden="true"><Mark logo={logo} letter={initialOf(r.name)} size={40} /></span>
                <span>
                  <span className="t">{r.name}</span>
                  <span className="d">{r.line}</span>
                </span>
                <span className="v" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
