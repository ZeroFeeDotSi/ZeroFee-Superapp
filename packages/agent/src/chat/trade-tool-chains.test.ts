// The trade tool offers only chains AgentZero can act on, in the app and on the relay (audit, 6 Nov): a NEAR coin gets
// words, never a call. The app still refuses a stale call (trade-ask.ts agentNearLine), so the relay can deploy later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolLine = (src: string): string => src.split("\n").find((l) => l.includes('{ name: "trade",')) ?? "";

test("the trade tool lists sol and hood, never near, on both sides, and says what to do with a NEAR coin (control: the same line on both)", () => {
  const app = toolLine(readFileSync(new URL("./tools.ts", import.meta.url), "utf8"));
  const relay = toolLine(readFileSync(new URL("../../../../apps/quotes/agentzero-chat.mjs", import.meta.url), "utf8"));
  assert.ok(app && relay, "found on both sides");
  assert.equal(app, relay, "the app's copy and the relay's say the same");
  assert.match(app, /chain: \{ type: "string", enum: \["sol", "hood"\] \}/);
  assert.doesNotMatch(app, /enum: \[[^\]]*"near"/);
  assert.match(app, /I don't trade NEAR coins yet\./);
});
