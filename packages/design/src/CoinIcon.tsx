// A coin or chain logo, always as <img src> (never inline SVG, so nothing inside a logo can run): the app's own image if
// it has one (a memecoin's), else the bundled logo for a trusted `icon` key from the ledger's coin list (./logos.ts),
// else a calm monogram in a hairline circle. The monogram also holds the slot while an image loads and if it fails
// (coin-icon.ts), so a slot is never empty and never a broken image. One box, the same size, whatever it shows.
import { useEffect, useState } from "react";
import { DARK_RING, logoMountsImg, logoShows, logoStart, logoStep, type LogoState } from "./coin-icon.ts";
import { logoDark, logoOnDisc, logoUrl } from "./logos.ts";

/** Logos already loaded on this page: shown at once from then on, with no monogram in between. */
const loaded = new Set<string>();

export function CoinIcon({ symbol, icon, src, size = 32 }: { symbol: string; icon?: string; src?: string; size?: number }) {
  const url = src ?? logoUrl(icon);
  const [state, setState] = useState<LogoState>(() => logoStart(url, !!url && loaded.has(url)));
  useEffect(() => { setState((s) => logoStep(s, { kind: "url", url, known: !!url && loaded.has(url) })); }, [url]);
  const now = state.url === url ? state : logoStart(url, !!url && loaded.has(url));   // a new url this render: start over
  const image = logoShows(now) === "image";
  return (
    <span aria-hidden="true" style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-grid", placeItems: "center" }}>
      {!image && (
        <span style={{ width: size, height: size, boxSizing: "border-box", borderRadius: "50%", border: "1px solid var(--line)", display: "inline-grid", placeItems: "center", font: `500 ${Math.round(size * 0.36)}px var(--font)`, color: "var(--ink)", letterSpacing: "-.02em" }}>
          {(symbol.trim() || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      {url && logoMountsImg(now) && (() => {
        const img = (box: number, round: boolean) => (
          <img src={url} alt="" width={box} height={box} style={{ ...(round ? { position: "absolute", inset: 0, borderRadius: "50%", ...(!src && logoDark(icon) ? { boxShadow: DARK_RING } : {}) } : { objectFit: "contain" }), opacity: image ? 1 : 0 }}
            onLoad={() => { loaded.add(url); setState((s) => logoStep(s, { kind: "load", url })); }}
            onError={() => setState((s) => logoStep(s, { kind: "error", url }))} />
        );
        // A bare brand mark: whole, on a white disc with the hairline, never cropped (logos.ts).
        if (!src && logoOnDisc(icon)) {
          return (
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", boxSizing: "border-box", background: image ? "#fff" : "transparent", border: image ? "1px solid var(--line)" : "none", display: "grid", placeItems: "center" }}>
              {img(Math.round(size * 0.58), false)}
            </span>
          );
        }
        return img(size, true);
      })()}
    </span>
  );
}
