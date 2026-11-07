// the audit's two MUSTs on Private's "Move it all to your Safe" (8 Nov). Before, one tap ran ledger.fromPrivate at once: no Check
// this, all of Private's money out of privacy to the Safe, where anyone can see it, so a mis-tap couldn't be undone. And
// "Job created. … Watch it in Activity." sat under `rows.length > 0`, so it went the moment the refresh read $0.
// Now: the tap opens Check this (no call); Not now or Close moves nothing; Approve alone makes the one job, as before (a hot
// key to the person's own Safe: no Face ID, D143); and the line stays while its job is made, whatever the rows say.
// Drawn with React's server renderer through vite's loader (as refusal-face.test.ts does); the taps run the screen's own
// handlers (homeTaps, homeFromPrivate) on a real task store.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import type { Balance } from "../../types.ts";

type Mod = typeof import("./Private.tsx");
let server: ViteDevServer;
let P: Mod;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL(".", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  P = (await server.ssrLoadModule("./Private.tsx")) as Mod;
});
after(async () => { await server?.close(); });

const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
const rows: Balance[] = [
  { tokenId: "usdc", symbol: "USDC", amount: "30.00", usd: "30.00", held: "private", chain: "near" } as unknown as Balance,
  { tokenId: "near", symbol: "NEAR", amount: "1.5", usd: "3.86", held: "private", chain: "near" } as unknown as Balance,
];

/** The screen's own handlers, as PrivateScreen wires them, on a real task store and a counted bridge. */
function screen(o: { answer?: () => Promise<unknown> } = {}) {
  const store = createTaskStore();
  const calls: string[] = [];
  let step: import("./Private.tsx").HomeStep = "no";
  const steps: string[] = [];
  const set = (s: typeof step) => { step = s; steps.push(s); };
  const params: unknown[] = [];
  const bridge = { call: async (m: string, p?: unknown) => { calls.push(m); params.push(p); return (o.answer ? await o.answer() : { ok: [{ id: "mv-9", kind: "private", status: "moving" }] }) as never; } };
  const problems: unknown[] = [];
  let refreshed = 0;
  const plan = P.homePlan(rows, 33.86);
  const madeWith: unknown[] = [];
  const taps = P.homeTaps({ step: () => step, set, run: () => P.homeFromPrivate({ tasks: store.forApp("wallet"), caps: plan.caps, usd: "$33.86", bridge, set, onProblem: (p) => problems.push(p), refresh: () => { refreshed++; }, onMade: (o) => madeWith.push(o) }) });
  const jobs = () => store.list().filter((t) => t.id.startsWith("job:"));
  return { taps, calls, params, madeWith, jobs, steps, problems, step: () => step, refreshed: () => refreshed };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("(a) the tap opens Check this and calls nothing; Not now and Close call nothing and make no job [before: the tap was the call]", async () => {
  const s = screen();
  s.taps.open();
  await settle();
  assert.equal(s.step(), "check", "the tap opens Check this");
  assert.deepEqual(s.calls, [], "no ledger.fromPrivate at the tap");
  assert.equal(s.jobs().length, 0, "no job at the tap");
  s.taps.close();
  await settle();
  assert.equal(s.step(), "no", "Not now (and Close, the same handler) closes it");
  assert.deepEqual(s.calls, [], "Not now: no bridge call");
  assert.equal(s.jobs().length, 0, "Not now: no job");
  s.taps.approve();
  await settle();
  assert.deepEqual(s.calls, [], "an Approve with no sheet up does nothing");
  // the screen: the trigger only opens the sheet; Not now and Close are its close; Approve alone runs the way home
  assert.match(src, /<HomeRow step=\{moving\} has=\{has\} onOpen=\{\(\) => openSheet\(false\)\} line=\{/, "fails before: onClick={() => void home()}");
  assert.match(src, /const openSheet = \(slide: boolean\) => \{ if \(step\.current !== "no"\) return; setShown\(\{ rows: \[\.\.\.rows\], slide \}\); setPick\(Number\(privateUsd\(rows\)\)\); taps\.open\(\); \};/);
  assert.match(src, /\{moving === "check" && shown && <MoveAllSheet usd=\{usd\} stays=\{stays\} [^\n]*onApprove=\{taps\.approve\} onClose=\{taps\.close\} \/>\}/);
  assert.match(src, /<Sheet title=\{slide \? PRIVATE_MOVE_WORDS\.bar : w\.bar\} onClose=\{onClose\}>/, "Close in the bar (and Escape, Back, the scrim) is Not now");
  assert.match(src, /<button className="zf-link" onClick=\{onClose\} data-testid="private-home-notnow">/);
  assert.doesNotMatch(src, /onClick=\{\(\) => void home\(\)\}/, "fails before: the one-tap call");
});

test("(b) Approve makes exactly one ledger.fromPrivate call and one job; a second Approve (a double tap) makes no other", async () => {
  const s = screen();
  s.taps.open();
  s.taps.approve();
  s.taps.approve();
  await settle();
  assert.deepEqual(s.calls, ["ledger.fromPrivate"], "one call");
  assert.equal(s.jobs().length, 1, "one job");
  assert.deepEqual(s.problems, [], "no taken refusal from the second tap");
});

test("(c) \"Job created. … Watch it in Activity.\" stays once its job is made, when the refresh reads Private empty [before: gone with the rows]", () => {
  const made = renderToStaticMarkup(createElement(P.HomeRow, { step: "sent", has: false, onOpen: () => {} }));
  assert.match(made, /data-testid="private-home-made">Job created\. It goes through NEAR Confidential\. Watch it in Activity\.<\/p>/);
  assert.doesNotMatch(src, /rows\.length > 0 && \(moving === "sent"/, "fails before: the line was under rows.length > 0");
  // control: before the job, the trigger shows only while Private holds money, a 44 px quiet capsule (copy review)
  assert.equal(renderToStaticMarkup(createElement(P.HomeRow, { step: "no", has: false, onOpen: () => {} })), "");
  assert.match(renderToStaticMarkup(createElement(P.HomeRow, { step: "no", has: true, onOpen: () => {} })), /<button class="zf-btn zf-btn--quiet wl-capsule" data-testid="private-home-open">Move it all to your Safe<\/button>/);
  assert.match(renderToStaticMarkup(createElement(P.HomeRow, { step: "asking", has: true, onOpen: () => {} })), /disabled="" data-testid="private-home-open">Moving…<\/button>/);
  const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-btn\.wl-capsule \{ width: auto; height: 44px; min-height: 44px;/, "the capsule is 44 px");
});

test("(d) Check this's words are exact: the head with Private's dollars, the Safe's row, the privacy line, Approve lit and Not now; no Stays row at $0", () => {
  const html = renderToStaticMarkup(createElement(P.MoveAllSheet, { usd: "$33.86", stays: "$0.00", onApprove: () => {}, onClose: () => {} }));
  assert.match(html, /<div class="zf-label zf-sheet__title">Check this<\/div>/);
  assert.match(html, /aria-label="Close"/, "Close in the bar (D135)");
  // P5 (the audit's way-home audit): the figure once, on the rows; the rows add up (From = at least + at most)
  assert.match(html, /<h2 class="zf-title wl-moveall__head" data-testid="private-home-head">Move money from Private to your Safe<\/h2>/);
  assert.match(html, /<div class="wl-kv" data-testid="private-home-from"><span>From Private<\/span><span>\$33\.86<\/span><\/div><div class="wl-kv" data-testid="private-home-gets"><span>Your Safe gets<\/span><span>about \$33\.86, at least \$33\.18<\/span><\/div><div class="wl-kv" data-testid="private-home-fee"><span>Fees<\/span><span>at most \$0\.68<\/span><\/div>/);
  assert.match(html, /data-testid="private-home-seen">Anyone can see what reaches your Safe\.<\/p>/);
  assert.match(html, /<div class="wl-moveall__foot"><button class="zf-btn" data-testid="private-home-approve">Approve<\/button>/, "Approve: the lit 56 px .zf-btn, no Face ID glyph");
  assert.match(html, /<button class="zf-link" data-testid="private-home-notnow">Not now<\/button><\/div>/, "Not now: the 44 px link");
  assert.doesNotMatch(html, /Stays in Private|keeps the rest/, "$0 kept: no row");
  // control: above $0 the row shows, in the copy review's words (never "Stays in Private" on a Check this)
  assert.match(renderToStaticMarkup(createElement(P.MoveAllSheet, { usd: "$33.86", stays: "$1.20", onApprove: () => {}, onClose: () => {} })), /<span>Private keeps the rest<\/span><span>\$1\.20<\/span>/, "exact: no about (P5)");
  // the head's dollars are the plan's, from the rows as the sheet opened on them
  assert.match(src, /const usd = dollars\(plan\.usd\.toFixed\(2\)\);/);
});

test("(e) control: after Approve the job is as before: its title and dollars, a hot key (no Face ID), \"Job created.\" at once, its ids, the refresh", async () => {
  const s = screen();
  s.taps.open();
  s.taps.approve();
  await settle();
  const [job] = s.jobs();
  assert.ok(job, "the job");
  assert.match(JSON.stringify(job), /Move money from Private to your Safe/);
  assert.match(JSON.stringify(job), /\$33\.86/);
  assert.doesNotMatch(JSON.stringify(job), /"approve":true/, "no Safe approve step: a hot key, no Face ID");
  assert.deepEqual(s.steps, ["check", "asking", "sent"], "\"Job created.\" as the call starts");
  assert.equal(s.refreshed(), 1);
  // the run's own words, unchanged
  assert.match(src, /tasks, title: "Move money from Private to your Safe", usd, safe: false, money: \["private"\],/);
  assert.match(src, /call: \(\) => bridge\.call<Movement\[\]>\("ledger\.fromPrivate", \{ upTo: caps \}\),/);
  // control: a No from the core puts the trigger back, and a refusal before the job is said
  const no = screen({ answer: async () => ({ problem: { code: "ledger.private.declined", whatHappened: "No.", money: { state: "safe", where: "" }, next: { kind: "nothing" } } }) });
  no.taps.open();
  no.taps.approve();
  await settle();
  assert.equal(no.step(), "no");
  assert.equal(no.jobs().length, 0, "a No takes the job away");
});
