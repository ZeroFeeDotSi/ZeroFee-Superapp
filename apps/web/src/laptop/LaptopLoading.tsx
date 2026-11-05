// While the laptop's key loads: the mark and the page's heading, never a bare spinner and no "…ing" line (product decision, 5 Nov:
// "shows nothing"; the design reviewer's words). A load NEAR never answers ends at LOAD_DEADLINE_MS (laptop-load.ts).
// Its own module, free of the core, so a test can render it without a browser.
import { Mark } from "@zerofee/design/Mark.tsx";
import { LAPTOP_START } from "../unlock/laptop-lock-words.ts";

export function Loading() {
  return (
    <div className="lp lp-center">
      <Mark size={96} mode="loading" />
      <h1 className="zf-title" style={{ marginTop: 28, maxWidth: 420 }}>{LAPTOP_START.what}</h1>
    </div>
  );
}
