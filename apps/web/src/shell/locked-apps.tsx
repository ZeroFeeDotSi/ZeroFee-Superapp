// A locked app's "Coming soon" sheet (D141, product decision, 3 Nov): the shared Sheet (D135) with the app's icon, its name, one
// line on what it will do and "Coming soon" (a spaced-capital label: no full stop). Its corner Close is its one way out.
// Never the app: no Earn, Perps or Predict code is here. Loaded after the first paint (or on the first tap of a locked
// tile), so none of it is in Home's first load. The tiles themselves are locked-tiles.tsx.
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { LOCKED_APPS } from "./locked-tiles.tsx";
import "./soon-sheet.css";

export { LOCKED_APPS };

/** What each locked app will do, in a five-year-old's words. */
export const SOON_LINES: Readonly<Record<string, string>> = {
  earn: "Earn on your NEAR.",
  perps: "Confidential perps. Trade with leverage, in private.",
  predict: "Trade on what happens next.",
};

export function SoonSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const app = LOCKED_APPS.find((a) => a.id === id);
  if (!app) return null;
  return (
    <Sheet onClose={onClose}>
      <div className="soon">
        <span className="soon__icon">{app.glyph()}</span>
        <h2 className="zf-title soon__name">{app.label}</h2>
        <p className="zf-body soon__line">{SOON_LINES[id]}</p>
        <p className="zf-label soon__when">Coming soon</p>
      </div>
    </Sheet>
  );
}
