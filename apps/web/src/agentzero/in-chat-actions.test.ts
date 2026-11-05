// AgentZero's in-chat actions (3 Nov: the buttons took too much space and looked poor): a plan's
// Start / Not now, Home's Open / Open again, Review, the live card's Start / Stop. Each is a small pill or a quiet word
// in the reply, never the app's full-width ink slab (.zf-btn), never a box around a step. With controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (css: string, sel: string) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
/** The in-thread action buttons a component draws: its <button …> tags that aren't the composer's. */
const buttons = (src: string) => [...src.matchAll(/<button [\s\S]*?>/g)].map((m) => m[0]).filter((b) => !/azc-send|azc-chip|azc-chat|azc-menu|azc-fact|azc-quiet|azc-mdlink|azc-starter/.test(b));
/** A button that would draw full width: the app's .zf-btn (width: 100%) or a width of 100% of its own. */
const fullWidth = (b: string) => /className="[^"]*\bzf-btn\b|width: ?["']?100%/.test(b);

test("no in-thread action button is full width (control: the old card's zf-btn is caught, and zf-btn is full width)", () => {
  const files = { "MoneyCard.tsx": read("./MoneyCard.tsx"), "LiveCard.tsx": read("./LiveCard.tsx"), "AgentZeroChat.tsx": read("./AgentZeroChat.tsx") };
  // the whole chat file, not one card: a new in-thread action anywhere in it is held to the same rule (the plan's "Check
  // again" line came in with two slabs after this test first ran on the plan card alone)
  const seen = [...buttons(files["MoneyCard.tsx"]), ...buttons(files["LiveCard.tsx"]), ...buttons(files["AgentZeroChat.tsx"])];
  assert.ok(seen.length >= 9, `the scan found the actions (${seen.length})`);
  assert.match(files["AgentZeroChat.tsx"], /className="azc-act" onClick=\{\(\) => check\?\.\(\)\}>Check again/, "the plan's Check again is a small pill");
  // control: that line as it came in (two slabs) is caught by the same scan
  assert.ok(buttons(`<div><button className="zf-btn" onClick={() => check?.()}>Check again</button><button className="zf-btn zf-btn--quiet" onClick={() => stop?.()}>Stop the plan</button></div>`).every(fullWidth));
  for (const b of seen) assert.equal(fullWidth(b), false, b);
  for (const b of seen) assert.match(b, /className="azc-act(-link)?\b/, b);
  // control: the cards as they were (a full-width ink slab and a second stacked one) are caught
  assert.equal(fullWidth(`<button className="zf-btn" onClick={() => say("Start")}>`), true);
  assert.equal(fullWidth(`<button className="zf-btn zf-btn--quiet" onClick={() => say("No")}>`), true);
  assert.match(rule(strip(read("../../../../packages/design/src/ui.css")), ".zf-btn"), /width: 100%/, "control: .zf-btn is the full-width slab");
});

test("the pill is small and quiet, the second choice a word, no box around a card or a step (control: the old meter rule squeezed every card)", () => {
  const css = strip(read("./chat.css"));
  const act = rule(css, ".azc-act");
  assert.match(act, /height: 32px/);
  assert.doesNotMatch(act, /width: 100%/);
  assert.match(rule(css, ".azc-act-link"), /background: none; padding: 0; color: var\(--mute\)/);
  assert.match(css, /\.azc-act::after, \.azc-act-link::after \{ content: ""; position: absolute; inset: -6px -4px; \}/, "a 44 pt tap all the same");
  assert.doesNotMatch(rule(css, ".azc-card"), /border|background|padding/, "no box around a card");
  assert.match(rule(css, ".azc-plan-steps"), /font: var\(--t-body\)/, "the steps in the reply's own type");
  // the in-chat card's name is its own: nothing else in AgentZero's CSS styles .azc-step as a 40 px pill
  assert.equal([...css.matchAll(/(?:^|\n)\.azc-step \{/g)].length, 1);
  assert.doesNotMatch(rule(css, ".azc-step"), /height: 40px/);
  assert.match(read("./KeySetup.tsx"), /className="azc-meter-step"/);
  assert.match(".azc-step { appearance: none; height: 40px; border: 0; border-radius: 999px; }", /\.azc-step \{[^}]*height: 40px/, "control");
});
