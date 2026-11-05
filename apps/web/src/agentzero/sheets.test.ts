// D135 (product decision, 3 Nov): every AgentZero sheet takes the WHOLE screen, locked at that size, with Close; its content scrolls
// inside. That size is the one Sheet's (@zerofee/design, D135): AgentZero has no sheet of its own and puts nothing of its
// own on a sheet's size, place, corners or rise. Measured on screen too: sheets-walk.mjs in
// $ZEROFEE_HOME/screens/agentzero-wallet-ui-2026-11-03 opens each sheet at 390x844 and checks its body is the whole
// screen and keeps its size when its content changes (its control, the old bottom-sheet style, fails every sheet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dirs = [new URL("./", import.meta.url), new URL("../../../../packages/agent/src/app/", import.meta.url)];
const files = (ext: RegExp) => dirs.flatMap((d) => readdirSync(d).filter((f) => ext.test(f) && !f.includes(".test.")).map((f) => ({ f, src: readFileSync(new URL(f, d), "utf8") })));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every way AgentZero's code could show a sheet that isn't the one Sheet. */
export function ownSheets(src: string): string[] {
  const s = strip(src);
  const hits: string[] = [];
  if (/role=["{]?["']?dialog/.test(s)) hits.push("a dialog of its own");
  if (/aria-modal/.test(s)) hits.push("a modal of its own");
  if (/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*["'](?!@zerofee\/design\/Sheet\.tsx)/.test(s)) hits.push("a Sheet not from @zerofee/design");
  return hits;
}
/** CSS rules that put AgentZero's own size, place, corners or motion on a sheet. */
export function sheetOverrides(css: string): string[] {
  return [...strip(css).matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => /\.zf-sheet/.test(sel!)).map(([, sel]) => sel!.trim());
}

test("D135: every AgentZero sheet is the one Sheet (@zerofee/design): no dialog or modal of its own", () => {
  const tsx = files(/\.tsx$/);
  assert.ok(tsx.length >= 10, "the AgentZero screens were read");
  const withSheets = tsx.filter((x) => /<Sheet\b/.test(x.src)).map((x) => x.f).sort();
  for (const f of ["AgentApp.tsx", "AgentWallet.tsx", "ChatsMenu.tsx", "FactRows.tsx", "KeySetup.tsx"]) assert.ok(withSheets.includes(f), `${f} shows its sheets with the one Sheet`);
  for (const { f, src } of tsx) assert.deepEqual(ownSheets(src), [], f);
  // control: a sheet of its own is caught
  assert.deepEqual(ownSheets('<div role="dialog" aria-modal="true" className="my-sheet">'), ["a dialog of its own", "a modal of its own"]);
  assert.deepEqual(ownSheets('import { Sheet } from "./MySheet.tsx";'), ["a Sheet not from @zerofee/design"]);
});

test("D135: no AgentZero style changes a sheet's size, place, corners or rise (the look's 1.15 s rounded rise is gone)", () => {
  const css = files(/\.css$/);
  assert.ok(css.some((x) => x.f === "chat.css") && css.some((x) => x.f === "az-mark.css") && css.some((x) => x.f === "agent.css"));
  for (const { f, src } of css) assert.deepEqual(sheetOverrides(src), [], f);
  // control: the look's old plan-sheet rise, put back, is caught
  assert.deepEqual(sheetOverrides(".azc .azc-sheet .zf-sheet__body { animation: zf-sheet-rise 1150ms var(--az-rise) both; border-radius: 32px 32px 0 0; }"), [".azc .azc-sheet .zf-sheet__body"]);
});
