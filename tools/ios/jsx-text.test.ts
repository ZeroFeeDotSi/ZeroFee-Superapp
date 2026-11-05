// B31 (2 Nov): a `//` line inside a JSX return is not a comment: it renders as text into the screen's DOM (the Buy
// sheet carried "// The one money sheet's design (Job 1): … (B12) …", read by screen readers, copy-all and innerText).
// Every screen's source is read by TypeScript itself and every piece of JSX text checked: none may hold a comment
// marker or a work-order reference ("//", "/*", "Job 1", "B12"…). A comment in JSX is {/* … */}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = new URL("../../", import.meta.url).pathname;
const DIRS = ["packages", "apps/web/src", "apps/extension/src"];
/** What never shows on a screen: a comment marker, or our own work-order names (Job 3, B12, D55, H31, TN2…). */
const LEAK = /\/\/|\/\*|\*\/|\bJob \d+\b|\b(?:B|D|H|TN|ST|J)\d{1,3}\b/;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every piece of JSX text in a file (what renders as words), with its line. */
function jsxTexts(file: string): { line: number; text: string }[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { line: number; text: string }[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isJsxText(n) && n.getText().trim()) out.push({ line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.getText().trim() });
    ts.forEachChild(n, walk);
  };
  walk(src);
  return out;
}

test("B31: no screen renders a comment or a work-order name as text", () => {
  const files = DIRS.flatMap((d) => tsxFiles(join(root, d)));
  assert.ok(files.length > 50, `screens read: ${files.length}`);
  const leaks = files.flatMap((f) => jsxTexts(f).filter((t) => LEAK.test(t.text)).map((t) => `${f.slice(root.length)}:${t.line}: ${t.text.slice(0, 100)}`));
  assert.deepEqual(leaks, []);
});

test("B31: the guard sees the leak it was written for (the control)", () => {
  const f = join(root, "tools/ios/.jsx-text-control.tsx");
  const src = ts.createSourceFile(f, "const A = () => (\n  <div>\n    // The one money sheet's design (Job 1) (B12).\n    <b>Buy</b>\n  </div>\n);", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts: string[] = [];
  const walk = (n: ts.Node) => { if (ts.isJsxText(n) && n.getText().trim()) texts.push(n.getText().trim()); ts.forEachChild(n, walk); };
  walk(src);
  assert.ok(texts.some((t) => LEAK.test(t)), texts.join(" | "));
});
