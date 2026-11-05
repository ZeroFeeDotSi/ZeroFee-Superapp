// UI-SIMPLICITY-RULES rule 3 ($ZEROFEE_HOME/UI-SIMPLICITY-RULES.md; phone test, 2 Nov: the Protection change's
// Waiting screen printed "4906542056074766355140186 units of nep141:wrap.near or …"): no machine text on a screen.
// Two guards:
//   1. The core's words for protection (its sheet, the Waiting screen, the second device's) read in human names, for
//      every coin a band can list and one ZeroFee doesn't know, in the summary AND behind "See which coins count".
//   2. Every piece of text the UI source writes on screen itself (JSX text, and string literals placed in JSX) is free of
//      the same patterns: an app can't print a contract id, raw units or a hash by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { BAND_COINS, contractBands } from "../../packages/core/src/demo-core.ts";
import { coinAmount, coinName, ownAccountCall } from "../../packages/core/src/known-contracts.ts";
import { kidsReasonWords } from "../../packages/core/src/held.ts";

/** What may never be on a screen: a NEAR token id, an Intents coin id, raw units, a 0x… id, a 64-hex hash, a number over 12 digits. */
export const RAW = [
  { name: "nep141: id", re: /nep141:/ },
  { name: ".omft.near id", re: /\.omft\.near/ },
  { name: '"units of"', re: /units of/ },
  { name: "0x… id", re: /0x[0-9a-fA-F]{40,}/ },
  { name: "64-hex hash", re: /\b[0-9a-fA-F]{64}\b/ },
  { name: "number over 12 digits", re: /\d{13,}/ },
];
const raw = (s: string) => RAW.filter((r) => r.re.test(s)).map((r) => r.name);

test("the guard fires: every pattern catches its own bad case (a control that can't fail proves nothing)", () => {
  for (const bad of ["4906542056074766355140186 units of nep141:wrap.near", "500000000 units of nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "e48f761f450d37f07dc7c6145d93d21e7cf395cb4d25d217c7bee1d17c0d796c"]) {
    assert.ok(raw(bad).length > 0, bad);
  }
  assert.deepEqual(raw("Payments up to $21 go as soon as you approve."), []);
});

test("rule 3: a mainnet protection of every coin, and a coin ZeroFee doesn't know, read in human names on every line and in the disclosure", () => {
  const coins = Object.fromEntries(BAND_COINS.filter((c) => c.kind === "market").map((c) => [c.id, c.floorUsd! * 1.25]));
  const bands = contractBands([{ upToUsd: 21, level: "faceid" }, { upToUsd: 500, level: "wait", waitSeconds: 120 }, { upToUsd: null, level: "both", waitSeconds: 86400 }], { near: 4.28, coins }, "mainnet") as { up_to: [string, string][] | null }[];
  bands[0].up_to!.push(["nep141:some-new-token.near", "4906542056074766355140186"]);
  for (const method of ["set_protection", "new"]) {
    const w = ownAccountCall(method, { bands, delay_seconds: 86400 }, 4.28)!;
    const all = [w.title, ...w.lines, ...(w.details ?? []).flatMap((d) => [d.label, ...d.lines])];
    for (const line of all) assert.deepEqual(raw(line), [], `${method}: ${line}`);
    assert.ok((w.details ?? []).length > 0, "the coins are behind a disclosure");
    assert.ok(w.lines.every((l) => l.length <= 80), "the summary is short sentences");
  }
  for (const c of BAND_COINS) assert.notEqual(coinName(c.id), "another coin", `${c.id} has a human name`);
  assert.deepEqual(raw(coinAmount("nep141:some-new-token.near", "4906542056074766355140186")), []);
  assert.deepEqual(raw(kidsReasonWords("over-week:nep141:some-new-token.near:4906542056074766355140186")), []);
});

/** Text a .tsx file puts on screen itself: JSX text, and string or template literals that are JSX children or attribute
 *  values a person reads (aria-label, title, placeholder, label). */
function screenText(file: string, code = readFileSync(file, "utf8")): { text: string; line: number }[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { text: string; line: number }[] = [];
  const at = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && n.text.trim()) out.push({ text: n.text, line: at(n) });
    if (ts.isJsxExpression(n) && n.expression && (ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression) || ts.isTemplateExpression(n.expression))) {
      const parent = n.parent;
      const shown = !ts.isJsxAttribute(parent) || /^(aria-label|title|placeholder|label|alt)$/.test(parent.name.getText());
      if (shown) out.push({ text: n.expression.getText(), line: at(n) });
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && /^(aria-label|title|placeholder|label|alt)$/.test(n.name.getText())) out.push({ text: n.initializer.text, line: at(n) });
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

test("the screen scan fires on a screen that prints an id: in text, in a literal and in an aria-label", () => {
  const bad = 'export const A = () => <div aria-label="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"><p>Limit: 5 units of a coin</p>{"nep141:wrap.near"}</div>;';
  assert.deepEqual(screenText("bad.tsx", bad).flatMap(({ text }) => raw(text)).sort(), ['"units of"', "0x… id", "nep141: id"].sort());
  assert.deepEqual(screenText("ok.tsx", 'export const B = () => <p className="nep141:x">{"Payments up to $21"}</p>;').flatMap(({ text }) => raw(text)), [], "a class name is not screen text");
});

const tsxUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === "gallery" ? [] : tsxUnder(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });

test("rule 3: no screen's own text prints a contract id, raw units or a hash (apps/web and every app's screens)", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const dirs = [join(root, "apps/web/src"), ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "src")).filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })];
  const files = dirs.flatMap(tsxUnder);
  assert.ok(files.length > 50, `scanned ${files.length} screens`);
  const hits = files.flatMap((f) => screenText(f).flatMap(({ text, line }) => raw(text).map((what) => `${f.slice(root.length)}:${line} ${what}: ${text.trim().slice(0, 80)}`)));
  assert.deepEqual(hits, []);
});
