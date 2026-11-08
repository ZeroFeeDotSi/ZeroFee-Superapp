// Audit 14 E9's words and layout (8 Nov): no ellipsis on AgentZero's screens, no "coming soon" promise on the first frame,
// the sign-in line says the two sites it really signs in to, the Fund button never sits over the Wallet row, and the copy
// sheet's cost line is never under the scroll's fade. Each with a control. Shots: sim-crawls/2026-11-08-b16 e9-*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** The code without its comments (a comment may quote an old line). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
/** Words a person sees: string and JSX text with an ellipsis, outside screen-reader-only lines and the key box's hint. */
const shownEllipses = (s: string) => code(s).split("\n").filter((l) => l.includes("…") && !/azc-sr|placeholder="sk-ant-|sheet=\{pending \? "…"/.test(l));

test("AgentZero's screens say no line with an ellipsis (control: one is caught)", () => {
  for (const f of ["./AgentWallet.tsx", "./AgentZeroChat.tsx", "./AgentZeroChatApp.tsx", "./Jobs.tsx", "./fund-tap.ts"]) assert.deepEqual(shownEllipses(src(f)), [], f);
  assert.equal(shownEllipses('<button>{busy ? "Asking…" : "Go"}</button>').length, 1);
  // a code still on its way is nothing on screen (it arrives in ms), as the shell's own AppWaiting
  assert.doesNotMatch(src("./AgentZeroChatApp.tsx") + src("./AgentZeroChat.tsx") + src("./Jobs.tsx"), /<Suspense fallback=\{<p[^>]*>Opening/);
  assert.match(src("./AgentZeroChatApp.tsx"), /<Suspense fallback=\{null\}><SimChat /);
});

test("the first frame makes no promise: no \"coming soon\" line over the chat (control: the chat's own line stays)", () => {
  const app = src("./AgentZeroChatApp.tsx");
  assert.doesNotMatch(app, /OPEN_MODELS_LINE|azc-models/);
  assert.doesNotMatch(src("./az-web.ts"), /coming soon/i);
  assert.match(app, /registerMailbox/);
});

test("What it does says the two sites AgentZero signs you in to (control: the lines still list it)", () => {
  const lead = src("../../../../packages/agent/src/app/AzLead.tsx");
  assert.match(lead, /export const LEAD_SIGN_IN = "Signs you in to pump\.fun and GMGN\.";/);
  assert.match(lead, /LEAD_SIGN_IN, \.\.\.\(o\.pocket/);
});

test("Jobs and limits: the page covers the tab bar, so it keeps no room for it and the Fund button sits at the screen's foot (control: the shell's bar room is still set for the others)", () => {
  const chat = src("./chat.css");
  assert.match(chat, /\.azc-pushed \{ position: absolute; inset: 0; z-index: 30; background: var\(--bg\); --zf-safe-bottom: env\(safe-area-inset-bottom, 0px\); \}/);
  assert.match(src("../shell/apphost.css"), /\.ah--bar \.ah-page \{ --zf-safe-bottom: calc\(var\(--bar-gap\) \+ var\(--bar-h\) \+ var\(--bar-reach\)\); \}/);
});

test("the copy sheet's cost line sits in the floor above Start, never under the scroll's fade (control: it still shows only before a job runs)", () => {
  const app = src("../../../../packages/agent/src/app/AgentApp.tsx");
  assert.match(app, /<div className="ag-sheet-floor">\n(?:\s*\{\/\*[\s\S]*?\*\/\}\n)?\s*\{!isRunning && <p className="zf-small ag-cost">\{jobCostLine\(\)\}<\/p>\}/);
  assert.doesNotMatch(app, /ag-under ag-cost/);
});
