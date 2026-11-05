// AgentZero has no mic (product decision, 3 Nov): the iPhone
// keyboard's own dictation types into the box. The page's host no longer passes device.speech.* to Swift for any app
// (Speech.swift may stay, unreachable), and AgentZero's screen has no mic button and never asks for speech.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { iosDevice, type IosHost } from "./ios.ts";

test("device.speech.* never reaches the iPhone, from any app (control: a known request from AgentZero still does)", async () => {
  const heard: string[] = [];
  const host = { call: async (m: string) => (heard.push(m), { ok: { ok: true } }), on: () => () => {} } as unknown as IosHost;
  const dev = iosDevice(host, new Set(["agent", "pay", "chat"]));
  for (const app of ["agent", "pay", "chat"]) {
    for (const m of ["device.speech.listen", "device.speech.stop"]) {
      const r = await dev.call(m, { app });
      assert.ok("problem" in (r as object), `${app} ${m}`);
    }
  }
  assert.deepEqual(heard, []);
  // control: the same app's ordinary device request is passed on, so the refusal above is about speech
  await dev.call("device.haptic", { app: "agent", kind: "tap" });
  assert.deepEqual(heard, ["device.haptic"]);
});

test("AgentZero's code has no mic button and never calls device.speech.* (control: the scan finds what it looks for)", () => {
  const dir = new URL("../agentzero/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));
  assert.ok(files.includes("AgentZeroChat.tsx") && files.length > 10, "the scan reads AgentZero's files");
  const speech = /device\.speech\.|MicButton|azc-mic|aria-label=\{?["'](Talk|Stop listening)/;
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), speech, f);
  // control: the same pattern catches the mic this screen used to have
  assert.match(`<button className="azc-send azc-mic" onClick={() => void bridge.call("device.speech.listen", {})} aria-label={listening ? "Stop listening" : "Talk"}>`, speech);
  // the box is a plain text field the keyboard (and its dictation) types into: a textarea, never read-only or inputMode none
  const chat = readFileSync(new URL("AgentZeroChat.tsx", dir), "utf8");
  const box = chat.match(/<textarea [\s\S]*?className="azc-input"[\s\S]*?\/>/)?.[0] ?? "";
  assert.ok(box, "the box is a textarea");
  assert.doesNotMatch(box, /readOnly|inputMode="none"|disabled/);
});
