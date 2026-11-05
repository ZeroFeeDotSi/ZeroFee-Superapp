// The one Activity (D144, the design review §4.7): Home hands its money history to the Activity centre through one slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setAppHistory, setHistory } from "./history-slot.ts";

test("the slot is one per page, and every hand-over tells the centre to draw again (control: cleared, nothing to draw)", () => {
  const g = globalThis as { __zfHistorySlot?: { render: unknown; seq: number; fns: Set<() => void> } };
  setHistory(null);
  const s = g.__zfHistorySlot!;
  let told = 0;
  const off = (() => { const f = () => { told++; }; s.fns.add(f); return () => s.fns.delete(f); })();
  const draw = () => "history";
  setHistory(draw);
  assert.equal(s.render, draw);
  setHistory(draw);
  assert.equal(told, 2, "each hand-over is a fresh draw");
  setHistory(null);
  assert.equal(s.render, null, "control: Home gone, the centre shows tasks alone");
  off();
});

test("the centre draws the history under Now, its pages over it, and says 'nothing yet' only when there is no history either; Home hands its Activity (with the statement and Account) over; the menu's Activity opens the centre", () => {
  const centre = readFileSync(new URL("./TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(centre, /const history = useHistory\(\);/);
  // R2: drawn on the whole centre and on Home alone (homeHistory), never on another app's own view
  assert.match(centre, /const homeHistory = !!history && \(!only \|\| only === "home"\);/);
  assert.match(centre, /\{homeHistory && <section className="tc-part tc-history" aria-label="History">\{history\(setOver, onClose\)\}<\/section>\}/);
  assert.match(centre, /<\/Sheet>\n\s*\{over\}/, "a history row's own page draws over the centre");
  assert.match(centre, /all\.length === 0 && !history && others\.length === 0 \? <p className="zf-small tc-empty">/);
  const home = readFileSync(new URL("../../wallet/src/app/WalletApp.tsx", import.meta.url), "utf8");
  assert.match(home, /setHistory\(\(overlay, closeCentre\) => \(/);
  assert.match(home, /useEffect\(\(\) => \(\) => setHistory\(null\), \[\]\);/, "cleared when Home goes");
  assert.match(home, /<Activity overlay=\{overlay\} onDone=\{close\} onProblem=\{onProblem\} onHeld=\{onHeld\} onStatement=\{statement\} statementFailed=\{failed\} \/>/, "the same list, with its statement row; a row's page closes the centre with ✕");
  assert.match(home, /items=\{\[\{ id: "money", label: "Money" \}, \{ id: "account", label: "Account" \}\]\}/, "Account beside Money, as the page had");
  // its ‹ goes back to Your account (QA, 5 Nov)
  assert.match(home, /<NavRow title="Activity" line="What you did" icon="clock" onClick=\{go\(\(\) => \(shell\.tasks\?\.open \? shell\.tasks\.open\(\{ back: toAccount \}\) : setView\(\{ kind: "activity", fromAccount: true \}\)\)\)\} \/>/);
});

test("another app's history (Trade's trades) has its own place beside Home's, and clearing one leaves the other (control)", () => {
  const g = globalThis as { __zfHistorySlot?: { render: unknown; seq: number; fns: Set<() => void>; apps?: Map<string, unknown> } };
  const home = () => "home", trade = () => "trade";
  setHistory(home);
  let told = 0;
  const f = () => { told++; };
  g.__zfHistorySlot!.fns.add(f);
  setAppHistory("trade", trade);
  assert.equal(g.__zfHistorySlot!.apps!.get("trade"), trade);
  assert.equal(g.__zfHistorySlot!.render, home, "Home's stays");
  setAppHistory("trade", null);
  assert.equal(g.__zfHistorySlot!.apps!.has("trade"), false);
  assert.equal(g.__zfHistorySlot!.render, home, "control: Trade gone, Home's still drawn");
  assert.equal(told, 2, "each hand-over is a fresh draw");
  g.__zfHistorySlot!.fns.delete(f);
  setHistory(null);
  const centre = readFileSync(new URL("./TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(centre, /filter\(\(\[a\]\) => !only \|\| a === only\)/, "opened on Trade: Trade's history alone");
  assert.match(centre, /<h3 className="zf-small tc-part__h">\{TASK_APP_HOME\[a as TaskApp\]\.name\}<\/h3>\{draw\(setOver, onClose\)\}/);
});
