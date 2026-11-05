// The AgentZero sheet and Settings → AgentZero (D118/D120) are two parts of one component: each module exports its part,
// and both see the same engine for the same bridge (so a job started in the sheet shows in Settings at once).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { zeroEngine } from "../zero/engine.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("the sheet's and Settings' modules export their parts of AgentApp; the old tab still renders all of it", () => {
  assert.match(src("./AgentZeroAsk.tsx"), /export \{ AgentZeroAsk \} from "\.\/AgentApp\.tsx";/);
  assert.match(src("./AgentZeroSettings.tsx"), /export \{ AgentZeroSettings \} from "\.\/AgentApp\.tsx";/);
  const app = src("./AgentApp.tsx");
  assert.match(app, /export function AgentZeroAsk\(\{ bridge, onClose \}: \{ bridge: Bridge; onClose\?: \(\) => void \}\)/);
  assert.match(app, /export function AgentZeroSettings\(\{ bridge \}: \{ bridge: Bridge \}\)/);
  assert.match(app, /function AgentRoot\(\) \{\n  return <AgentZeroScreens \/>;/, "the old tab: part \"all\"");
});

test("one engine per bridge: the sheet and Settings share jobs and receipts; another bridge gets its own", () => {
  const b = { call: async () => ({ problem: { code: "x", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }), on: () => () => {} } as unknown as Bridge;
  const c = { ...b } as Bridge;
  assert.equal(zeroEngine(b), zeroEngine(b));
  assert.notEqual(zeroEngine(b), zeroEngine(c));
});
