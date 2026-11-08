// Builder 23, item 4 (audit 18 Tray: "the Tray's phone path shot"; the words bar: grade 5, one idea a sentence, the
// figure once, the button says what happens). The phone's "Use AgentZero on a computer" sheet, the core's words check
// sheet and the Tray's own relay lines, each at grade 5 (fk.mjs, b23's CRAWL.md has the grades). Fails on main 5d80fde2e
// ("...the same as AgentZero on this phone: up to $20 in any 24 hours, anywhere, until you tap Stop." 12.0, "Continue",
// "ZeroFee's relay answers again." 12.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAIR_WORDS } from "./pair-flow.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the Tray's lines name ZeroFee's server, one idea a sentence, never 'relay'", () => {
  assert.equal(PAIR_WORDS.relayDown, "ZeroFee's server is down. This Mac keeps trying.");
  assert.equal(PAIR_WORDS.relayBack, "ZeroFee's server is back. This Mac waits for your phone.");
  assert.equal(PAIR_WORDS.relayGaveUp, "ZeroFee's server didn't answer. Your yes didn't reach this Mac.");
  for (const l of Object.values(PAIR_WORDS)) assert.doesNotMatch(l, /relay|…|\.\.\./, l);
});

test("the phone's sheet: grade-5 rows, and its button says what happens next", () => {
  const app = read("../../../packages/agent/src/app/AgentApp.tsx");
  assert.match(app, /rowLine: "Let Claude Code on your computer use it\.",/);
  assert.match(app, /wallet: "The computer pays from AgentZero's wallet\. It can't touch your Safe\.",/);
  assert.match(app, /go: "Check the words",/);
  assert.match(app, /onClick=\{\(\) => onPair\(code\.trim\(\)\)\}>\{PAIR_SHEET\.go\}<\/button>/);
  assert.doesNotMatch(app, /like AgentZero here\. Your Safe's key stays here|can use AgentZero, from its own wallet|finishes by itself in a few seconds/);
});

test("the core's words check sheet: the day figure once, short sentences", () => {
  const core = read("../../../packages/core/src/agent-private.ts");
  assert.match(core, /`The computer pays from AgentZero's wallet\. It spends at most \$\$\{[^`]+\} in any 24 hours\. It stops when you tap Stop\.`/);
  assert.match(core, /"Tap Stop here any time\. It stops on every device at once\.",/);
  assert.doesNotMatch(core, /the same as AgentZero on this phone|its key stops everywhere at once/);
});
