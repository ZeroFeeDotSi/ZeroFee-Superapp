// home/words2 (3 Nov): a person never reads "Trading", "Spending", "Hidden" or "row" in Wallet or the core: the words are
// your Safe, your SOL wallet, your NEAR wallet, your private balance. This reads every string a person can be shown in
// packages/wallet/src and packages/core/src (string and template literals with a space, and JSX text; comments, class
// names and ${…} code aside) and lists any with an old word. AgentZero's own packages (packages/agent,
// apps/web/src/agentzero) are the design review's and aren't read here. Control: a planted old word is caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OLD = /\b(Trading|Spending|Hidden)\b|\brows?\b/;
/** Not words a person reads: a proper name, and lines only the developer's log sees (chain.ts netLog). */
const ALLOWED = [/\bSocial Trading\b/, /^history answer has no rows$/, /^a history row unreadable: skipped$/];

/** Comments blanked (kept to their newlines), so a word in a comment is never a word a person reads. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** Every string literal of a source: quotes, and templates with each ${…} as "…" (the strings inside it, nested
 *  templates among them, read as strings of their own). A regex can't: a template holds templates. */
function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  /** A regex literal starts here (a / after an operator or an opening bracket): skipped whole, so its quotes aren't strings. */
  const regex = (): boolean => {
    if (src[i] !== "/" || src[i + 1] === "/" || src[i + 1] === "*") return false;
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j]!)) j--;
    if (j >= 0 && !/[(,=:[!&|?{};+]/.test(src[j]!)) return false;
    let k = i + 1, cls = false;
    for (; k < src.length && src[k] !== "\n"; k++) {
      if (src[k] === "\\") { k++; continue; }
      if (src[k] === "[") cls = true;
      else if (src[k] === "]") cls = false;
      else if (src[k] === "/" && !cls) break;
    }
    if (src[k] !== "/") return false;
    i = k + 1;
    return true;
  };
  const expr = (): void => {
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i]!;
      if (regex()) continue;
      if (c === "{") { depth++; i++; } else if (c === "}") { depth--; i++; } else if (c === '"' || c === "'" || c === "`") str(c); else i++;
    }
  };
  const str = (q: string): void => {
    i++;
    let text = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") { text += src[i + 1] ?? ""; i += 2; continue; }
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") { i += 2; text += "…"; expr(); continue; }
      if (q !== "`" && src[i] === "\n") break;
      text += src[i];
      i++;
    }
    i++;
    out.push(text);
  };
  while (i < src.length) {
    const c = src[i]!;
    if (regex()) continue;
    if (c === '"' || c === "'" || c === "`") str(c);
    else i++;
  }
  return out;
}

/** The person-facing strings of one file's source with an old word in them. */
export function oldWordsIn(source: string): string[] {
  const out: string[] = [];
  const src = strip(source);
  const said = (raw: string) => {
    const t = raw.trim();
    if (/^(Trading|Spending|Hidden)$/.test(t)) return void out.push(t);                       // a name alone: a label, a column
    if (!/[A-Za-z]+ +[A-Za-z]/.test(t)) return;                                              // a key or a code, not words
    if (t.split(/\s+/).every((w) => /^[a-z0-9:._/…-]*$/.test(w)) && /-/.test(t)) return;     // a class list (wl-row wl-pick)
    if (!OLD.test(t) || ALLOWED.some((a) => a.test(t))) return;
    out.push(t);
  };
  for (const s of literals(src)) said(s);
  // JSX text: between a tag's > and the next <, on one line, never code (no ; = ( ) in it)
  for (const m of src.matchAll(/>([^<>{}\n;=()]+)</g)) said(m[1]!);
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "testing" || f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.|\.d\.ts$/.test(f) ? [p] : [];
  });
}

test("no string a person reads in Wallet or the core says Trading, Spending, Hidden or row", () => {
  const found = ["packages/wallet/src", "packages/core/src"].flatMap((d) => files(join(ROOT, d))).flatMap((f) => oldWordsIn(readFileSync(f, "utf8")).map((t) => `${relative(ROOT, f)}: ${t}`));
  assert.deepEqual(found, []);
});

test("control: one planted old word is caught; code, class names and comments aren't", () => {
  assert.deepEqual(oldWordsIn('const a = "Move it to Trading first.";'), ["Move it to Trading first."]);
  assert.deepEqual(oldWordsIn("const b = `Your ${x} row is ready.`;"), ["Your … row is ready."]);
  assert.deepEqual(oldWordsIn("const c = `It lands ${r === 1 ? `in your ${n} row` : \"in your Safe\"}.`;"), ["in your … row"], "a template inside a template");
  assert.deepEqual(oldWordsIn("<p>Set up Hidden?</p>"), ["Set up Hidden?"]);
  assert.deepEqual(oldWordsIn('<div className="wl-row wl-pick">x</div>'), []);
  assert.deepEqual(oldWordsIn("// Trading was the old name\nconst d = `It lands in your ${row} wallet.`;"), []);
  assert.deepEqual(oldWordsIn('const e = "spending.status";'), [], "a method name, one word");
  assert.deepEqual(oldWordsIn('const f = { hidden: "Hidden", plain: "Plain" };'), ["Hidden"], "a label alone is caught");
});
