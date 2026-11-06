// The job sheet's card ends above its button (copy review, 6 Nov: "Stop it any time." was cut under Start at 390).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./agent.css", import.meta.url), "utf8");

test("the job sheet is a scroll box and a floor, as Send: its card ends above the button whatever it holds; AgentZero's styles still leave the Sheet alone (D135) (control: the other sheets keep their sticky floor)", () => {
  const sheet = app.slice(app.indexOf("function JobSheet("), app.indexOf("function ComputerSheet("));
  assert.match(sheet, /<Sheet title=\{s\.title\} onClose=\{onClose\}>\n[^\n]*\n\s*<div className="ag-sheet-column">\n\s*<div className="ag-sheet-scroll">/);
  assert.match(sheet, /<\/div>\n\s*<div className="ag-sheet-floor">\n\s*\{isRunning && running/);
  assert.match(sheet, /<\/div>\n\s*<\/div>\n\s*<\/Sheet>/);
  assert.match(css, /\.ag-sheet-column \{[^}]*height: 100%;[^}]*display: flex;[^}]*flex-direction: column;/);
  assert.match(css, /\.ag-sheet-scroll \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*padding-bottom: 20px;/);
  assert.match(css, /\.ag-sheet-scroll \+ \.ag-sheet-floor:has\(> \.zf-btn\) \{[^}]*position: relative;/);
  assert.match(css, /\.ag-sheet-floor:has\(> \.zf-btn\) \{ position: sticky;/, "control");
  assert.doesNotMatch(css, /\.zf-sheet/);
});
