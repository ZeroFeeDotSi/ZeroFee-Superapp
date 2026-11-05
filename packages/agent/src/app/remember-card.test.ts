// "Remember this?" in the chat (real-Claude walk, 3 Nov): after Keep the card closed and the chat's last word was the ask
// again ("AgentZero asks to remember this. Keep it?"), after the line was kept. The card now answers in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
const card = (s: string) => s.slice(s.indexOf("function RememberCard("), s.indexOf("function MemoryList("));

test("Keep and No each answer in the card itself; the card never closes back to the ask", () => {
  const c = card(src);
  assert.ok(c.length > 100, "the card is found");
  assert.match(c, /setSaid\(r\.ok \? REMEMBER_LINE\.kept : r\.line\)/);
  assert.match(c, /onClick=\{\(\) => setSaid\(REMEMBER_LINE\.no\)\}>No</);
  assert.doesNotMatch(c, /onDone/);
  assert.match(src, /kept: "Kept\. You can delete it in Jobs and limits\."/);
  // control: the card as it was (closing itself on Keep) fails the same check
  const before = `function RememberCard({ onDone }) { const keep = async () => { setSaid(r.ok ? "Kept." : r.line); if (r.ok) onDone?.(); }; return <button onClick={() => onDone?.()}>No</button>; }\nfunction MemoryList(`;
  assert.match(card(before), /onDone/);
});
