// J3 C8: Chat's screens never say "nostr", "relay", "pubkey" or "kind" (the plumbing's words). Every piece of text the
// app's JSX writes (its text, and the strings and templates inside it: labels, lines, placeholders) is read from the
// source and checked, with a control that the reader finds a planted word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const JARGON = /\b(nostr|relays?|pubkeys?|kind)\b/i;
/** Attributes that never reach the screen. */
const HIDDEN = new Set(["className", "key", "data-testid", "role", "type", "inputMode", "autoCapitalize", "autoCorrect", "href", "target", "rel", "style"]);

function screenWords(code: string): string[] {
  const src = ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node, inJsx: boolean, hidden: boolean) => {
    if (ts.isJsxAttribute(n)) hidden = HIDDEN.has(n.name.getText(src));
    const jsx = inJsx || ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
    if (jsx && !hidden) {
      if (ts.isJsxText(n) && n.text.trim()) out.push(n.text);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isBinaryExpression(n.parent) && !ts.isCaseClause(n.parent)) out.push(n.text);
      if (ts.isTemplateExpression(n)) out.push([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "));
    }
    n.forEachChild((c) => visit(c, jsx, hidden));
  };
  visit(src, false, false);
  return out;
}

test("Chat's screens never say nostr, relay, pubkey or kind", () => {
  const words = screenWords(readFileSync(new URL("./ChatApp.tsx", import.meta.url), "utf8"));
  assert.ok(words.some((w) => /Ask for money/.test(w)), "the reader finds the screens' words");
  assert.deepEqual(words.filter((w) => JARGON.test(w)), []);
  // NEAR rooms (J3 part 2): the same rule on their screen.
  const rooms = screenWords(readFileSync(new URL("./Room.tsx", import.meta.url), "utf8"));
  assert.ok(rooms.some((w) => /Use my NEAR account here/.test(w)), "the reader finds the rooms' words");
  assert.deepEqual(rooms.filter((w) => JARGON.test(w)), []);
  // Control: a planted word is found, in text, in a label and in a line.
  for (const bad of [`const A = () => <p>Connected to 3 relays</p>;`, "const A = () => <More label={`your pubkey ${x}`} />;", `const A = () => <More lines={["kind 20000 events"]} />;`]) {
    assert.ok(screenWords(bad).some((w) => JARGON.test(w)), bad);
  }
});
