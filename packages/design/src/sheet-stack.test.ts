// One sheet at a time, and a sheet blocks the page behind it (J3 C6: Chat's first-time sheet stayed open under the
// Request sheet, and posting worked behind it). The order and what to block, on a stand-in page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SheetStack, behind, type Node_ } from "./sheet-stack.ts";

type N = Node_ & { name: string; children: N[]; parentElement: N | null };
const el = (name: string, ...children: N[]): N => {
  const n: N = { name, children, parentElement: null };
  for (const c of children) c.parentElement = n;
  return n;
};

test("the newest sheet is the one on screen; the earlier waits under it and comes back when it closes", () => {
  const stack = new SheetStack<string>();
  stack.open("anyone can post here");
  assert.equal(stack.top(), "anyone can post here");
  stack.open("request money");
  assert.equal(stack.top(), "request money");
  assert.deepEqual(stack.under(), ["anyone can post here"], "two never show at once");
  stack.open("request money");
  assert.equal(stack.size, 2, "opening one twice is one");
  stack.close("request money");
  assert.equal(stack.top(), "anyone can post here");
  assert.deepEqual(stack.under(), []);
  stack.close("anyone can post here");
  assert.equal(stack.top(), undefined);
  stack.close("never opened");
  assert.equal(stack.size, 0);
});

test("everything on the screen but the sheet is blocked: the list, the composer, Back and an earlier sheet", () => {
  const first = el("first-time sheet");
  const sheet = el("request sheet");
  const page = el("chat", el("list"), el("composer"));
  const main = el("main", page, first, sheet);
  const header = el("header (Back)");
  const screen = el("screen", header, main);
  const blocked = behind(sheet, screen).map((n) => n.name);
  assert.deepEqual(blocked.sort(), ["chat", "first-time sheet", "header (Back)"].sort());
  assert.ok(!blocked.includes("request sheet") && !blocked.includes("main"), "the sheet and the way to it stay live");
  // Control: what's outside the screen (the shell's app bar beside it) is never touched.
  const shell = el("shell", screen, el("app bar"));
  assert.ok(!behind(sheet, screen).some((n) => n.name === "app bar"));
  assert.ok(shell.children.length === 2);
});

test("Tab inside an open sheet wraps at its ends and never leaves it (shell audit 15c)", async () => {
  const { wrapTab } = await import("./sheet-stack.ts");
  const parts = ["close", "money", "account"];
  assert.equal(wrapTab(parts, "account", false), "close", "Tab from the last goes to the first, not to the app row behind");
  assert.equal(wrapTab(parts, "close", true), "account", "Shift+Tab from the first goes to the last");
  assert.equal(wrapTab(parts, "money", false), null, "in the middle the browser's own next stop is inside the sheet");
  assert.equal(wrapTab(parts, null, false), "close", "focus outside the sheet comes back to its first part");
  assert.equal(wrapTab([], "x", false), null, "a sheet with nothing to focus leaves Tab alone");
});
