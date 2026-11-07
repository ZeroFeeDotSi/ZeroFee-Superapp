// the copy review's checkpoints (6 Nov, Part 1): a going row's track is four dots for any step count, the current one from the job's
// own step, the fill to it exactly, no track on an ended row, its words from one table, and nothing loops.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { CHECKPOINT_WORDS, checkpointAt, checkpointFill, checkpointKind, checkpointLabel, dotsOf } from "./checkpoints.ts";

let server: ViteDevServer;
let LiveRow: ComponentType<Record<string, unknown>>;
let Checkpoints: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  LiveRow = (await server.ssrLoadModule("./LiveRow.tsx")).LiveRow;
  Checkpoints = (await server.ssrLoadModule("./Checkpoints.tsx")).Checkpoints;
});
after(async () => server?.close());

const steps = (n: number, done: number, failed = false) => Array.from({ length: n }, (_, i) => ({ state: i < done ? "done" : i === done ? (failed ? "failed" : "doing") : "waiting" }));

test("the current checkpoint, folded from any step count: the first leg going is the working step, the last Landing", () => {
  // (n, done): the step at `done` is doing
  const table: [n: number, done: number, at: number][] = [
    [1, 0, 1], [1, 1, 3],
    [2, 0, 1], [2, 1, 2], [2, 2, 3],
    [3, 0, 1], [3, 1, 1], [3, 2, 2], [3, 3, 3],
    [4, 0, 1], [4, 1, 1], [4, 2, 1], [4, 3, 2],
    [6, 1, 1], [6, 4, 1], [6, 5, 2], [6, 6, 3],
  ];
  for (const [n, done, at] of table) assert.equal(checkpointAt(steps(n, done)), at, `${done} of ${n} done`);
  // the copy review (6 Nov): a Send's "Leaving your Safe" going lights Sending, never Signed
  assert.equal(checkpointAt([{ state: "doing" }, { state: "waiting" }, { state: "waiting" }]), 1, "the first leg going: Sending");
  assert.equal(checkpointAt([{ state: "waiting" }, { state: "waiting" }, { state: "waiting" }]), 0, "control: nothing begun, Signed");
  assert.equal(checkpointAt([]), 0, "no steps yet: Signed is current");
  assert.equal(checkpointAt(steps(4, 1), true), 3, "ended: Done");
  assert.equal(checkpointAt(steps(4, 3, true)), 2, "a failed last step stops on Landing");
});

test("the fill runs to the current dot exactly: at/3", () => {
  assert.deepEqual([0, 1, 2, 3].map(checkpointFill), [0, 1 / 3, 2 / 3, 1]);
  assert.equal(checkpointFill(7), 1);
  assert.equal(checkpointFill(-1), 0);
});

test("one table of words by kind: four each, ≤ 9 characters, never a protocol's name; Done last", () => {
  for (const [kind, words] of Object.entries(CHECKPOINT_WORDS)) {
    assert.equal(words.length, 4, kind);
    for (const w of words) assert.ok(w.length <= 9, `${kind}: ${w}`);
    assert.doesNotMatch(words.join(" "), /NEAR|Intents|Jupiter|Solana|Ethereum|Robinhood|1Click/, kind);
    assert.equal(words[3], "Done");
    assert.ok(!words.includes("Sent"), `${kind}: "Sent" is an ended row's word, never a checkpoint`);
  }
  assert.deepEqual(CHECKPOINT_WORDS.swap, ["Signed", "Swapping", "Landing", "Done"]);
  assert.deepEqual(CHECKPOINT_WORDS.send, ["Signed", "Sending", "Landing", "Done"]);
  assert.deepEqual(CHECKPOINT_WORDS.move, ["Signed", "Moving", "Landing", "Done"]);
  assert.deepEqual(CHECKPOINT_WORDS.buy, ["Signed", "Buying", "Landing", "Done"]);
  assert.deepEqual(CHECKPOINT_WORDS.sell, ["Signed", "Selling", "Landing", "Done"]);
  assert.deepEqual(CHECKPOINT_WORDS.agent, ["Signed", "Working", "Landing", "Done"]);
});

test("the kind from what a row knows: its app, its kind, its title's verb; a top up is a move", () => {
  const table: [Record<string, string>, string][] = [
    [{ title: "Swap $10.00 of USDC for SOL", app: "home" }, "swap"],
    [{ title: "Send $25.00 to bob.near", app: "home" }, "send"],
    [{ title: "Move $29.00 to your Safe", app: "home" }, "move"],
    [{ title: "Top up Private", app: "home" }, "move"],
    [{ title: "Buy $5.00 of BONK", app: "trade" }, "buy"],
    [{ title: "Sell all your BONK", app: "trade" }, "sell"],
    [{ title: "Book a flight", app: "agentzero" }, "agent"],
    [{ kind: "add", title: "Adding SOL" }, "add"],
    [{ kind: "swap", title: "Move" }, "swap"],
  ];
  for (const [t, kind] of table) assert.equal(checkpointKind(t), kind, JSON.stringify(t));
});

test("dots: done before the current, the current a ring and centre, the rest rings; a bad stop lights nothing past it", () => {
  assert.deepEqual(dotsOf(1), ["done", "now", "next", "next"]);
  assert.deepEqual(dotsOf(0), ["now", "next", "next", "next"]);
  assert.deepEqual(dotsOf(3), ["done", "done", "done", "now"]);
  assert.deepEqual(dotsOf(2, true), ["done", "done", "bad", "next"]);
  assert.equal(checkpointLabel("swap", 1), "step 2 of 4, Swapping");
});

const row = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(LiveRow, { mark: "M", title: "Swap $10.00 of USDC for SOL", line: "NEAR Intents is swapping it.", usd: "$10.00", when: "About 29 s left", label: "Swap $10.00 of USDC for SOL", ...p }));

test("drawn: a going row has exactly four dots, its current one, the fill to it, aria-hidden, and the row's label says the step", () => {
  for (const n of [1, 2, 3, 4, 7]) {
    const html = row({ state: "going", p: 0.5, track: { kind: "swap", at: checkpointAt(steps(n, Math.min(1, n - 1))) } });
    assert.equal((html.match(/class="zf-cp__pt /g) ?? []).length, 4, `${n} steps`);
  }
  const html = row({ state: "going", p: 0.5, track: { kind: "swap", at: 1 } });
  assert.match(html, /class="zf-cp zf-lrow__cp" aria-hidden="true" data-at="1"/);
  assert.match(html, /--cp:0\.333/);
  assert.match(html, /class="zf-cp__pt is-done"><i><\/i><b>Signed<\/b>/);
  assert.match(html, /class="zf-cp__pt is-now"><i><\/i><b>Swapping<\/b>/);
  assert.equal((html.match(/is-next/g) ?? []).length, 2);
  assert.match(html, /aria-label="Swap \$10\.00 of USDC for SOL, step 2 of 4, Swapping"/);
  assert.doesNotMatch(html, /zf-lrow__line/, "the track replaces the plain progress line");
  assert.match(html, /class="zf-lrow is-going has-track"/);
});

test("drawn: no track on an ended row (done, stopped, back, past), even when one is passed; the plain line where no track is given", () => {
  for (const state of ["done", "stopped", "back", "past"]) {
    const html = row({ state, track: { kind: "swap", at: 3 } });
    assert.doesNotMatch(html, /zf-cp/, state);
    assert.doesNotMatch(html, /step \d of 4/, state);
  }
  assert.match(row({ state: "slow", track: { kind: "move", at: 2 } }), /is-now"><i><\/i><b>Landing/, "a slow row keeps its track");
  // control: a going row without a track is as before (its progress line)
  assert.match(row({ state: "going", p: 0.5 }), /zf-lrow__line/);
});

test("drawn alone (the job page's, Part 2): a bad stop's dot, the fill only to the last done dot", () => {
  const html = renderToStaticMarkup(createElement(Checkpoints, { kind: "move", at: 2, bad: true }));
  assert.match(html, /class="zf-cp is-bad"/);
  assert.match(html, /--cp:0\.333/, "fill ends at the last done dot, never reaching the bad one");
  assert.match(html, /is-bad"><i><\/i><b>Landing/);
});

test("a17's shape (copy review, 6 Nov): a track row's step line is a 2-line clamp, never one line cut with an ellipsis; its time on that line's last line, right", () => {
  const css = readFileSync(new URL("./liverow.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => { const i = css.lastIndexOf(sel); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
  const line = rule(".zf-lrow.has-track .zf-lrow__d {");
  assert.match(line, /white-space: normal/);
  assert.match(line, /-webkit-line-clamp: 2/);
  assert.match(line, /text-overflow: clip/);
  // the going row's one-line cut (a16) comes before it, so the track row's rule wins at the same weight
  assert.ok(css.indexOf(".zf-lrow.is-going .zf-lrow__d") < css.lastIndexOf(".zf-lrow.has-track .zf-lrow__d {"));
  assert.match(rule(".zf-lrow.has-track .zf-lrow__w {"), /grid-row: 2; align-self: end;/);
  assert.match(rule(".zf-lrow.has-track .zf-lrow__text > .zf-lrow__d:nth-child(2) {"), /grid-row: 2/);
  assert.match(rule(".zf-lrow.has-track > .zf-lrow__text, .zf-lrow.has-track > .zf-lrow__r {"), /display: contents/);
  assert.match(rule(".zf-lrow__cp {"), /grid-column: 2 \/ 4; grid-row: 4/);
});

test("motion: the track never loops (no animation on any dot), tokens only", () => {
  const css = readFileSync(new URL("./checkpoints.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /animation|@keyframes|box-shadow/);
  assert.doesNotMatch(css.replace(/var\(--[\w-]+\)/g, ""), /#[0-9a-f]{3,6}\b|rgb/i, "colours from tokens only");
  assert.match(css, /height: 30px/);
});
