import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { readPasted } from "./paste.ts";

const bridgeOf = (answer: unknown, calls: string[] = []) => ({ call: async (m: string) => { calls.push(m); return answer; }, on: () => () => {} }) as unknown as Bridge;
const withClipboard = async (readText: () => Promise<string>, fn: () => Promise<void>) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { readText } }, configurable: true });
  try { await fn(); } finally { if (had) Object.defineProperty(globalThis, "navigator", had); else delete (globalThis as { navigator?: unknown }).navigator; }
};

test("the phone's clipboard, trimmed; empty is nothing; the host is asked once, on the tap", async () => {
  const calls: string[] = [];
  assert.equal(await readPasted(bridgeOf({ ok: { text: "  0xabc \n" } }, calls)), "0xabc");
  assert.deepEqual(calls, ["device.clipboard.read"]);
  assert.equal(await readPasted(bridgeOf({ ok: { text: "" } })), null);
  assert.equal(await readPasted(bridgeOf({ ok: { text: null } })), null);
});

test("a browser (the host can't): the page's own clipboard; refused, nothing", async () => {
  const problem = { problem: { code: "device.clipboard.unavailable" } };
  await withClipboard(async () => " So1aNaMint ", async () => assert.equal(await readPasted(bridgeOf(problem)), "So1aNaMint"));
  await withClipboard(async () => { throw new Error("denied"); }, async () => assert.equal(await readPasted(bridgeOf(problem)), null));
});
