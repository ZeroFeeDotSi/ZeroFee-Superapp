// S2 (QA's web privsec hunt, 5 Nov): the backup words at creation can't be selected, copied, cut, called out by
// the context menu, dragged or printed. The check after is typed, so nothing it needs is taken away. Control: the block
// as it was (no handlers, no user-select) fails each check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tsx = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./onboarding.css", import.meta.url), "utf8");
const words = (src: string) => /<ol className="ob-words[^>]*>/.exec(src)?.[0] ?? "";
const guarded = (ol: string) => ["onCopy", "onCut", "onContextMenu", "onDragStart"].every((h) => ol.includes(`${h}={noCopy}`));
const cssGuarded = (c: string) => /\.ob-words \{[^}]*(?<!-webkit-)user-select: none/.test(c) && /\.ob-words \{[^}]*-webkit-user-select: none/.test(c) && /@media print \{ \.ob-words \{ display: none/.test(c);

test("the words block blocks copy, cut, the context menu and drag; CSS blocks selection and printing", () => {
  assert.ok(guarded(words(tsx)), words(tsx));
  assert.match(tsx, /const noCopy = \(e: \{ preventDefault: \(\) => void \}\) => e\.preventDefault\(\);/);
  assert.ok(cssGuarded(css));
  assert.match(words(tsx), /translate="no"/, "still never sent to a translation service");
});

test("control: the block as it was fails", () => {
  assert.ok(!guarded('<ol className="ob-words zf-enter-2" translate="no">'));
  assert.ok(!cssGuarded(".ob-words { margin-bottom: 12px; }"));
});

test("a blocked event does nothing else: preventDefault only", () => {
  let n = 0;
  const noCopy = new Function("return " + /const noCopy = ([^;]+);/.exec(tsx)![1]!.replace(/: \{ preventDefault: \(\) => void \}/, ""))() as (e: { preventDefault: () => void }) => void;
  noCopy({ preventDefault: () => n++ });
  assert.equal(n, 1);
});
