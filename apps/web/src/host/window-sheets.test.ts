// D157 follow-up: in the extension, the shell's own sheets (being a guardian, any approval.needed the shell hears) go to
// the extension's full-screen window too, and the shell's gate takes a yes only for an approval that window said yes to.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { requireActivation } from "../unlock/activation.ts";
import { answerInWindow } from "./extension.ts";
import { markWindowYes, takeWindowYes } from "./window-yes.ts";

const words = { title: "Approve as Ana's guardian", lines: ["Ana adds a new phone."], warnings: [], effect: [] };
/** The core behind the shell's gate: records each answer it hears. */
function core() {
  const heard: Record<string, unknown>[] = [];
  const inner: Bridge = { call: async <T>(_m: string, p?: Record<string, unknown>) => { heard.push(p!); return { ok: {} } as BridgeResult<T>; }, on: () => () => {} };
  return { heard, gate: requireActivation(inner, () => true, takeWindowYes) };
}

test("a window yes is taken once, only for its own approval, only just now", () => {
  markWindowYes("a", 1_000);
  assert.equal(takeWindowYes("b", 1_100), false);
  assert.equal(takeWindowYes("a", 1_100), true);
  assert.equal(takeWindowYes("a", 1_200), false); // used up
  markWindowYes("c", 1_000);
  assert.equal(takeWindowYes("c", 7_000), false); // too old
  assert.equal(takeWindowYes(undefined), false);
});

test("D157: a guardian sheet approved in the window (the iPhone checked) reaches the core as a yes", async () => {
  const { heard, gate } = core();
  assert.equal(await answerInWindow({ id: "g1", words }, gate, async () => true), true);
  assert.deepEqual(heard, [{ id: "g1", approve: true }]);
});

test("D157: a no, a cancel or a throw in the window is a no; nothing reaches the core as a yes", async () => {
  const { heard, gate } = core();
  assert.equal(await answerInWindow({ id: "g2", words }, gate, async () => false), false);
  assert.equal(await answerInWindow({ id: "g3", words }, gate, async () => { throw new DOMException("closed", "NotAllowedError"); }), false);
  assert.deepEqual(heard, [{ id: "g2", approve: false }, { id: "g3", approve: false }]);
});

test("D157: a script's yes on the shell's bridge, without the window's yes, is answered no (control: with it, yes)", async () => {
  const { heard, gate } = core();
  const r = await gate.call("approval.answer", { id: "g4", approve: true });
  assert.ok("problem" in r && r.problem.code === "shell.approval.no-tap");
  assert.deepEqual(heard, [{ id: "g4", approve: false }]);
  markWindowYes("g5");
  await gate.call("approval.answer", { id: "g5", approve: true });
  assert.deepEqual(heard.at(-1), { id: "g5", approve: true });
  // a yes for one approval can't be spent on another
  markWindowYes("g6");
  await gate.call("approval.answer", { id: "g7", approve: true });
  assert.deepEqual(heard.at(-1), { id: "g7", approve: false });
});

test("D157: in the extension the shell draws no sheet in the panel, and its gate is the window's yes (the web's is unchanged)", () => {
  const sheet = readFileSync(new URL("../shell/ApprovalSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(!showing \|\| inWindow\) return null;/);
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /const SHEETS_IN_WINDOW = EXTENSION_BUILD && !SIM && !iosHost\(\);/);
  assert.match(app, /<ApprovalSheet bridge=\{shellBridge\} \{\.\.\.\(SHEETS_IN_WINDOW \? \{ inWindow: sheetInWindow \} : \{\}\)\} \/>/);
  // control: the demo page's sheet never goes to the window
  assert.match(readFileSync(new URL("../gallery/Demo.tsx", import.meta.url), "utf8"), /<ApprovalSheet bridge=\{demoShellBridge\} \/>/);
  const core = readFileSync(new URL("../core.ts", import.meta.url), "utf8");
  assert.match(core, /const shellOwn: Bridge = host \? gated : EXTENSION_BUILD && !SIM \? requireActivation\(gated, \(\) => true, takeWindowYes\) : requireActivation\(gated\);/);
});
