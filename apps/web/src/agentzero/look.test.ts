// AgentZero's look, aligned with the rest of the app (product decision, 3 Nov): its living mark (the ZeroFee ring and slash with a
// dot, at the top, the only colour), the app's own tokens and shapes, and the ready screen's words. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the mark is AgentZero's presence at the top: the logo's ring and slash with a dot, no shader, no big orb (control: the old orb is gone)", () => {
  const mark = readFileSync(new URL("./AzMark.tsx", import.meta.url), "utf8");
  assert.match(mark, /<circle cx="12" cy="12" r="8\.2"/, "Mark.tsx's ring");
  assert.match(mark, /className="az-slash" d="M6\.2 17\.8/, "Mark.tsx's slash");
  assert.match(mark, /<span className="az-dot" \/>/, "a dot in the middle");
  assert.doesNotMatch(mark.replace(/^\/\/.*$/gm, ""), /getContext|webgl|<canvas/i, "SVG and CSS only");
  for (const f of ["orb.ts", "Orb.tsx", "look.css"]) assert.equal(existsSync(new URL(`./${f}`, import.meta.url)), false, f);
  const app = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<AppFrame name="AgentZero" top=\{<AzMark /, "in the app's top row, in the name's place");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chat, /createPortal|Orb/, "nothing drawn into the middle of the screen");
});

test("the mark alone carries colour: Ocean on White, Aurora on Black; still under reduced motion; paused when hidden (control: the chat's CSS names no colour)", () => {
  const css = strip(readFileSync(new URL("./az-mark.css", import.meta.url), "utf8"));
  assert.match(css, /^\.az-mark \{ --az-c1: #21d4ed; --az-c2: #2e6bff; --az-c3: #5433db;/m, "Ocean on White");
  assert.match(css, /:root\[data-theme="dark"\] \.az-mark \{ --az-c1: #2ee6c4; --az-c2: #8c5cf5; --az-c3: #ff8fc7; \}/, "Aurora on Black");
  assert.doesNotMatch(css, /az-breathe|az-glow|az-pulse/, "no breathing at rest (product decision, 5 Nov: keep things subtle)");
  assert.match(css, /\[data-m="thinking"\] \.az-ring \{ animation: az-turn/, "thinking turns the ring");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.az-mark \*, \.az-mark, \.az-mark::before \{ animation: none !important; \}/);
  assert.match(css, /\.az-mark\[data-paused\] \*, \.az-mark\[data-paused\], \.az-mark\[data-paused\]::before \{ animation-play-state: paused !important; \}/);
  assert.doesNotMatch(css, /blur\(/, "no CSS blur");
  const mark = readFileSync(new URL("./AzMark.tsx", import.meta.url), "utf8");
  assert.match(mark, /data-paused=\{!shown \|\| hidden \? "" : undefined\}/);
  assert.match(mark, /document\.addEventListener\("visibilitychange"/);
  const chat = strip(readFileSync(new URL("./chat.css", import.meta.url), "utf8"));
  assert.doesNotMatch(chat, /#[0-9a-f]{3,8}\b|rgba?\(|hsl/i, "the chat's CSS: tokens only");
  assert.match(css, /#[0-9a-f]{6}/i, "control: the same scan finds the mark's colours");
});

test("the chat uses the app's own shapes: body type, Chat's bubble and composer, ink pills, hairline rows (control: no big light type, no pill field)", () => {
  const css = strip(readFileSync(new URL("./chat.css", import.meta.url), "utf8"));
  assert.match(css, /\.azc-msg \{[^}]*font: var\(--t-body\)/);
  assert.match(css, /\.azc-user \{[^}]*background: var\(--ink\); color: var\(--bg\)/, "Chat's own bubble (.ch-mine .ch-text)");
  assert.match(css, /\.azc-input \{[^}]*border-radius: 14px; background: var\(--raise\)/, "Chat's own field (.ch-input)");
  assert.doesNotMatch(css, /font: 300 2\dpx|border-radius: 27px|min-height: 54px/, "the old look's big light type and pill field are gone");
  assert.match("font: 300 21px/1.42 var(--font)", /font: 300 2\dpx/, "control");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /className="zf-btn azc-send"/, "Send is the app's ink pill");
  assert.match(chat, /className="zf-body azc-lead"/, "the ready line in the app's body type");
});

test("the ready screen: one line and three starters, in the product's words (control: no old money word)", async () => {
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /"Ask me about your money, or give me a job\."/);
  assert.match(chat, /\["What did I spend this week\?", "Copy a wallet on pump\.fun", "Keep \$50 ready in your SOL wallet"\]/);
  assert.doesNotMatch(chat, /className="zf-small azc-thinking" role="status">AgentZero is thinking/, "no Thinking… on screen");
  assert.match(chat, /className="azc-sr" role="status">AgentZero is thinking…/, "control: still said to a screen reader");
});

test("polish: the privacy line is short, once a chat, and its whole sentence names the path the answer took (control: each path differs)", async () => {
  const { ACTIVITY_SHORT, activityPrivacy } = await import("./fact-text.ts");
  assert.equal(ACTIVITY_SHORT, "Read without names or addresses.");
  assert.match(activityPrivacy("own"), /through your own key\./);
  assert.doesNotMatch(activityPrivacy("own"), /free reading|paid reading/, "own key: no relay named");
  assert.match(activityPrivacy("paid"), /through AgentZero's paid reading, which keeps nothing\./);
  assert.match(activityPrivacy("free"), /through ZeroFee's free reading, which keeps nothing\./);
  assert.notEqual(activityPrivacy("paid"), activityPrivacy("free"), "control");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /activityNote=\{i === firstRead \? chat\.activityNote : undefined\}/, "once a chat, under the first answer that read Activity");
  const hook = readFileSync(new URL("../../../../packages/agent/src/chat/use-chat-turn.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(ownKey\) setVia\("own"\)/);
  assert.match(hook, /setVia\(e\.turnUsd !== undefined \? "paid" : "free"\)/);
});

test("polish: figure chips are quiet text and no line in the chat has a quote bar", () => {
  const css = strip(readFileSync(new URL("./chat.css", import.meta.url), "utf8"));
  const fact = css.match(/\.azc-fact \{[^}]*\}/)?.[0] ?? "";
  assert.match(fact, /border: 0/);
  assert.match(fact, /background: none/);
  assert.match(fact, /underline dotted/);
  assert.doesNotMatch(css, /border-left: 2px/, "no quote bar");
  assert.match(".azc-system { border-left: 2px solid var(--ink); }", /border-left: 2px/, "control");
});
