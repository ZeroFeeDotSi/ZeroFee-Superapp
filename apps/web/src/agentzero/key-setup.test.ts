// The AI key's screen (product decision, 3 Nov): the clipboard is read only in the Paste button's handler (D33: never on open, never
// on focus); the card's words are the product's; the chat's thread never shows the key card as a fault line; the sample
// demo has no keys at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromItems } from "./chat-items.ts";

const src = readFileSync(new URL("./KeySetup.tsx", import.meta.url), "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

/** Where the clipboard is reached in a component's source: each `.paste(` call and what encloses it. */
const pasteCalls = (s: string) => [...s.matchAll(/\.paste\(/g)].map((m) => m.index!);

test("the clipboard is read only in onPaste, and onPaste only runs from the Paste button's onClick", () => {
  const at = pasteCalls(code);
  assert.equal(at.length, 1, "one place reads the clipboard");
  const before = code.slice(0, at[0]);
  assert.ok(before.lastIndexOf("const onPaste = async () =>") > before.lastIndexOf("const check ="), "that place is onPaste");
  const uses = [...code.matchAll(/onPaste\b/g)].map((m) => code.slice(m.index! - 60, m.index! + 10));
  assert.equal(uses.length, 2, "defined once, used once");
  assert.match(uses[1]!, /onClick=\{\(\) => void onPaste\(\)\}/);
  for (const w of ["useEffect", "useLayoutEffect", "onFocus", "navigator.clipboard", "clipboard.read"]) assert.equal(code.includes(w), false, w);
  // control: the check catches a read on open
  const bad = `${code}\nuseEffect(() => { void keys.paste(); }, []);`;
  assert.equal(pasteCalls(bad).length, 2);
});

test("the card says the product's words; only the key's last 4 is ever shown", () => {
  for (const w of ["Paste an AI key to start", "Paste", "and goes only to the AI company. ZeroFee never sees it.", "console.anthropic.com", "Add an AI key", "Replace", "Remove", "Key ending ${s.tail}"]) assert.ok(src.includes(w), w);
  assert.doesNotMatch(code, /price server|relay|token/i);
});

test("the thread never shows the key card as a line; \"Claude is ready\" is ZeroFee's own line (control: a fault still shows)", () => {
  const ms = fromItems([{ kind: "you", text: "Hey" }, { kind: "needs-key", why: "off" }], false);
  assert.deepEqual(ms.map((m) => m.role), ["user"]);
  const ready = fromItems([{ kind: "you", text: "Hey" }, { kind: "needs-key", why: "off" }, { kind: "note", line: "Claude is ready." }], false);
  assert.deepEqual(ready.at(-1)?.parts, [{ type: "fault", line: "Claude is ready." }]);
  const fault = fromItems([{ kind: "you", text: "Hey" }, { kind: "fault", line: "Claude didn't answer." }], false);
  assert.deepEqual(fault.at(-1)?.parts, [{ type: "fault", line: "Claude didn't answer." }]);
});

test("the sample demo has no keys: its chat is given none, so no chip and no card", () => {
  // the Sim's chat (D157) hands the screen no keys: no key chip, no key card, no wallet
  const sample = readFileSync(new URL("./sim-chat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sample.slice(sample.indexOf("return { messages")), /keys|wallet/);
  assert.match(readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8"), /activityNote: chat\.via \? activityPrivacy\(chat\.via\) : ACTIVITY_PRIVACY, keys, chats, newChat(, stepEnded: chat\.stepEnded(, planCheck: chat\.planCheck, planStop: chat\.planStop(, cardSaw: chat\.cardSaw)?)?)?(, \.\.\.\(wallet \? \{ wallet, resume \} : \{\}\))? \}/);
});

test("the real chat hands the screen every plan and card hook (a missing one left a card's news unkept: real-Claude flow-fail-03, 3 Nov)", () => {
  const src = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  for (const k of ["stepEnded: chat.stepEnded", "planCheck: chat.planCheck", "planStop: chat.planStop", "cardSaw: chat.cardSaw"]) assert.ok(src.includes(k), k);
});
