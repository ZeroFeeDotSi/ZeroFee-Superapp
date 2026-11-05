// The tracker drawn (React's server renderer through vite's loader, as the shell tests do): the Receipt's state on the
// object, each step's row with its time only once done, the end line, and the lit verb only when there is one.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let JobTracker: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  JobTracker = (await server.ssrLoadModule("./JobTracker.tsx")).JobTracker;
});
after(async () => server?.close());

const steps = (doing: number, failed = -1) => ["safe", "near", "intents", "sol"].map((key, i) => ({ key, label: ["Your Safe signed", "On NEAR", "NEAR Intents is moving it to Solana", "In your SOL wallet"][i], state: i === failed ? "failed" : i < doing ? "done" : i === doing ? "doing" : "waiting", ...(i < doing ? { atMs: [1200, 4100, 41_000, 42_300][i] } : {}) }));
const draw = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(JobTracker, { title: "Move $5.00", coin: { symbol: "USDC", icon: "usdc" }, ...p }));

test("away: the mark is away, the doing step has the live dot, no time on an open step, no lit verb", () => {
  const html = draw({ state: "away", steps: steps(2), line: "NEAR Intents is moving it to Solana · 41 s", onDone: () => {} });
  assert.match(html, /class="zf-job zf-job--page" data-state="away"/);
  assert.match(html, /class="zf-receipt zf-receipt--mark" data-state="away"/);
  assert.match(html, /data-step="intents"[^>]*><span class="zf-job__mark is-doing"/);
  assert.match(html, /data-step="near"[^>]*>.*?<span class="zf-job__time">4\.1 s<\/span>/);
  assert.match(html, /data-step="intents"[^>]*>.*?<span class="zf-job__time"><\/span>/, "no time on the step being done");
  assert.doesNotMatch(html, /zf-btn/, "nothing lit while it is on its way");
});

test("landed: every step done with its time, the end line, Done lit once", () => {
  const html = draw({ state: "landed", steps: steps(4), line: "In your SOL wallet.", end: { ok: true, line: "In your SOL wallet." }, onDone: () => {} });
  assert.match(html, /data-state="landed"/);
  assert.equal((html.match(/zf-job__step is-done/g) ?? []).length, 4);
  assert.match(html, /<span class="zf-job__time">42 s<\/span>/);
  assert.match(html, /class="zf-job__end">In your SOL wallet\.<\/p>/);
  assert.equal((html.match(/class="zf-btn"/g) ?? []).length, 1, "one lit verb");
  assert.match(html, /class="zf-btn"[^>]*>Done<\/button>/);
});

test("refused: the failed step is marked, the end says where the money is, Try again is lit and Close is quiet", () => {
  const html = draw({ state: "refused", steps: steps(1, 1), line: "Stopped on NEAR.", end: { ok: false, line: "It stopped on NEAR. Your $5.00 is still in your Safe." }, onDone: () => {}, onAgain: () => {} });
  assert.match(html, /data-step="near" class="zf-job__step is-failed"|class="zf-job__step is-failed" data-step="near"/);
  assert.match(html, /class="zf-job__end is-bad">It stopped on NEAR\. Your \$5\.00 is still in your Safe\.<\/p>/);
  assert.match(html, /class="zf-btn"[^>]*>Try again<\/button>/);
  assert.match(html, /class="zf-btn zf-btn--quiet"[^>]*>Close<\/button>/);
  assert.doesNotMatch(html, /zf-live/, "control: nothing alive once it stopped");
});

test("row size: the mark is 48 and the head is a row", () => {
  const html = draw({ state: "checking", steps: steps(3), line: "Still checking", size: "row", onDone: () => {} });
  assert.match(html, /class="zf-job zf-job--row" data-state="checking"/);
  assert.match(html, /--ring:48px/);
  assert.match(html, /class="zf-btn"[^>]*>Done<\/button>/, "checking: Done (the job keeps being checked)");
});
