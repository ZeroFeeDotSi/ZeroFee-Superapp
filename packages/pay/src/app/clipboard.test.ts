import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { readCopied } from "./clipboard.ts";

const host = (answer: BridgeResult<unknown>): Bridge => ({ call: async <T>() => answer as BridgeResult<T>, on: () => () => {} });

test("on the phone, what was copied comes from the host (device.clipboard.read), trimmed", async () => {
  assert.equal(await readCopied(host({ ok: { text: "  0x2527…f10d\n" } })), "0x2527…f10d");
});

test("the phone's empty clipboard is nothing copied: the screen offers pasting by hand", async () => {
  assert.equal(await readCopied(host({ ok: { text: null } })), null);
  assert.equal(await readCopied(host({ ok: { text: "   " } })), null);
});

test("a browser's host can't read it (device.clipboard.unavailable): the page's own read, or nothing", async () => {
  const unavailable = host({ problem: { code: "device.clipboard.unavailable", whatHappened: "Use Paste instead.", money: { state: "safe", where: "in your balance" }, next: { kind: "nothing", label: "OK" } } });
  // Node has no page clipboard, so this is the "nothing may be read" case.
  assert.equal(await readCopied(unavailable), null);
});
