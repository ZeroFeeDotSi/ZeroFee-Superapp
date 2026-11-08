// Audit 15 (8 Nov), the laptop page, graded F (FL1 in laptop-fl1.test.ts): FL2 no "Desktop app soon" line,
// FL3 a NEAR blip wiped the paired page. Each fails on main ea3017f8a.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { LAPTOP_LOCK, LAPTOP_START } from "../unlock/laptop-lock-words.ts";
import { LOAD_LATE, keptLines, pollOutcome } from "./laptop-load.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

let server: ViteDevServer;
let UnlockGate: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  UnlockGate = (await server.ssrLoadModule("../unlock/UnlockGate.tsx")).UnlockGate;
});
after(async () => server?.close());

test("FL2: the owner's Desktop app line, plain and with no date, on the first screen and at the page's foot; the dead notice is gone", () => {
  assert.equal(LAPTOP_START.soon, "A ZeroFee Desktop app is coming soon.");
  assert.doesNotMatch(LAPTOP_START.soon, /…|\d/);
  assert.equal(existsSync(new URL("./laptop-notice.ts", import.meta.url)), false, "LAPTOP_NOTICE had no caller");
  const hung = { readRecord: () => new Promise(() => {}), vaults: () => new Promise(() => {}) };
  const start = { heading: LAPTOP_START.what, next: LAPTOP_START.next, soon: LAPTOP_START.soon };
  const words = text(renderToStaticMarkup(createElement(UnlockGate, { device: hung, laptopWords: LAPTOP_LOCK, laptopStart: start }, createElement("p", null, "x"))));
  assert.ok(words.includes(LAPTOP_START.soon), words);
  assert.match(read("./LaptopGate.tsx"), /soon: LAPTOP_START\.soon/, "the gate passes it");
  assert.match(read("./Laptop.tsx"), /data-testid="laptop-soon">\{LAPTOP_START\.soon\}</, "the paired and unpaired page say it at the foot");
  // control: the phone's own lock never says it
  const app = text(renderToStaticMarkup(createElement(UnlockGate, { device: hung }, createElement("p", null, "app"))));
  assert.ok(!app.includes(LAPTOP_START.soon));
});

test("FL3: a later poll NEAR doesn't answer keeps the page with one line and the last read's time; only the first load is a Problem", () => {
  assert.deepEqual(pollOutcome({ ok: 1 }, false), { ok: 1 });
  assert.deepEqual(pollOutcome({ problem: LOAD_LATE }, false), { problem: LOAD_LATE }, "first load: nothing to keep, the Problem with Try again");
  assert.deepEqual(pollOutcome({ problem: LOAD_LATE }, true), { late: true }, "shown once: kept");
  const at = Date.UTC(2026, 10, 8, 3, 52);
  assert.deepEqual(keptLines(at, "en-US"), ["NEAR isn't answering. This page checks again by itself.", `As of ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at)}`]);
  for (const l of keptLines(at)) assert.doesNotMatch(l, /…/);
  const page = read("./Laptop.tsx");
  // every poll goes through pollOutcome (state and requests); the person's own answer still shows its Problem
  const refresh = page.slice(page.indexOf("const refresh = async"), page.indexOf("const [added"));
  assert.doesNotMatch(refresh, /take\(/, "no poll wipes the page");
  assert.equal(refresh.match(/poll\(await withinDeadline/g)?.length, 2);
  assert.match(page, /\{late && lastRead !== null && <div className="lp-late"/);
});
