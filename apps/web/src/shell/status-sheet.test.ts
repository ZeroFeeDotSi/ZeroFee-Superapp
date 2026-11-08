// Settings → Status (rule 9b, T13 phase 1; QA 16's holds, 8 Nov): the Settings row says "Checking…" until this open's
// look answered (at most 5 s), then "All working" or what isn't; the sheet shows one line per row at rest, more only for
// what isn't the usual; the checks run only while Settings or the sheet is open (nothing else asks); the sheet's code
// is never in Home's first load (lazy); the Sim answers without asking any service. Vite's loader loads the TSX.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { StatusReport } from "@zerofee/core/status-probe";
import { DOWN_WORDS, NOT_CHECKED_LINE, PARTLY_WORDS } from "@zerofee/core/status-words";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { faultedBridge } from "@zerofee/shell-api/faults.ts";
import { ROW_WAIT_MS } from "./status-row.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
let ssr: ViteDevServer;
let fakeServer: ViteDevServer;
let StatusList: (p: { report: StatusReport | null; failed?: boolean }) => ReactElement;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; settle: () => Promise<number>; press: (l: RegExp) => void };
let SettingsPanel: FunctionComponent<Record<string, unknown>>;
let useStatusSummary: (b: Bridge | null, t?: unknown) => string;

before(async () => {
  const base = { configFile: false as const, logLevel: "silent" as const, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" as const, optimizeDeps: { noDiscovery: true, include: [] } };
  ssr = await createServer({ ...base, root: WEB });
  StatusList = (await ssr.ssrLoadModule("./shell/StatusSheet.tsx")).StatusList;
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  fakeServer = await createServer({ ...base, root: WEB, resolve: { alias: [{ find: /^react$/, replacement: fake }] } });
  runtime = (await fakeServer.ssrLoadModule(fake)) as typeof runtime;
  SettingsPanel = (await fakeServer.ssrLoadModule("./shell/SettingsPanel.tsx")).SettingsPanel;
  useStatusSummary = (await fakeServer.ssrLoadModule("./shell/status-row.ts")).useStatusSummary;
});
after(async () => { await ssr?.close(); await fakeServer?.close(); });

const AT = new Date(2026, 10, 8, 8, 15).getTime();
const up = (): StatusReport => ({
  at: AT, relay: true,
  rows: [
    { id: "relay", state: "working", via: "direct", ms: 100, doors: { data: "working", chains: "working" } },
    { id: "near", state: "working", via: "relay", ms: 100 },
    { id: "solana", state: "working", via: "relay", ms: 100 },
    { id: "hood", state: "working", via: "relay", ms: 100 },
    { id: "price", state: "working", via: "relay", ms: 100 },
    { id: "oneclick", state: "working", via: "direct", ms: 100 },
    { id: "jupiter", state: "working", via: "direct", ms: 100 },
    { id: "agentzero", state: "working", via: "relay", ms: 100 },
  ],
});
const lines = (html: string) => (html.match(/class="zf-small st__line"/g) ?? []).length;

test("the sheet at rest: every service by name, one line each, Working and when it was checked, ZeroFee's server said once", () => {
  const html = renderToString(StatusList({ report: up() }));
  for (const name of ["ZeroFee&#x27;s server", "NEAR", "Solana", "Robinhood Chain", "Price feed", "Jupiter", "AgentZero", "Chain servers"]) assert.ok(html.includes(name), name);
  // QA 16's MUSTs 2 and 3: no bracketed chain code; one row for prices
  assert.doesNotMatch(html, /\(RH\)|Prices and charts/);
  assert.equal((html.match(/data-state="working" data-id=/g) ?? []).length, 8);
  // QA 16's SHOULD: when it was checked is said once, under the first line, never on every row
  assert.equal((html.match(/8:15/g) ?? []).length, 1);
  assert.match(html, /st__checked">Checked 8:15 am</);
  assert.equal(lines(html), 0, "nothing under a row at rest");
  assert.equal((html.match(/Using ZeroFee&#x27;s server/g) ?? []).length, 1);
});

test("a row that isn't the usual says so under it: the public servers it is on, and Down says whether money can move", () => {
  const r = up();
  r.rows[2] = { id: "solana", state: "down", via: "public", ms: null };
  r.rows[0] = { ...r.rows[0]!, doors: { data: "working", chains: "down" } };
  const html = renderToString(StatusList({ report: r }));
  assert.ok(html.includes("Using Solana&#x27;s public servers"));
  assert.ok(html.includes(DOWN_WORDS.solana.replace(/'/g, "&#x27;")));
  assert.equal(lines(html), 3, "Solana's two lines, and the server's partly down line");
  // QA 16's MUST 1: the server answers but its chain door is Down: "Partly down", in the alert colour, never "Working"
  assert.match(html, /data-state="down" data-id="relay"><div class="set__row st__row"><span class="st__name">ZeroFee&#x27;s server<\/span><span class="st__state"><span class="st__word">Partly down</);
  assert.ok(html.includes(PARTLY_WORDS));
  assert.match(html, /data-state="down" data-id="solana"/);
  assert.match(html, /st__door" data-state="down"><span>Chain servers<\/span><span>Down/);
});

test("before the first answer the sheet says Checking…; a look that couldn't run says so by name", () => {
  assert.match(renderToString(StatusList({ report: null })), /ZeroFee checks each one now\. Up to 5 s\./);
  assert.ok(renderToString(StatusList({ report: null, failed: true })).includes(NOT_CHECKED_LINE.replace(/'/g, "&#x27;")));
});

/** Timers the test fires by hand (no wall-clock waits). */
function handTimers() {
  const due = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  return { set: (fn: () => void, ms: number) => { due.set(++n, { fn, ms }); return n; }, clear: (h: unknown) => void due.delete(h as number), fire: () => { for (const [k, t] of [...due]) { due.delete(k); t.fn(); } }, due };
}
function probeBridge(answer: () => Promise<BridgeResult<StatusReport>> | null) {
  const calls: string[] = [];
  const bridge: Bridge = {
    call<T>(method: string): Promise<BridgeResult<T>> {
      calls.push(method);
      if (method === "status.probe") return (answer() ?? new Promise(() => {})) as Promise<BridgeResult<T>>;
      return Promise.resolve({ ok: { value: null } as T });
    },
    on: () => () => {},
  };
  return { bridge, calls };
}

test("the Settings row: Checking… until the look answered, then All working, or the worst by name (NEAR down)", async () => {
  const t = handTimers();
  let give: (r: BridgeResult<StatusReport>) => void = () => {};
  const { bridge, calls } = probeBridge(() => new Promise((r) => { give = r; }));
  const Row = () => createElement("span", null, useStatusSummary(bridge, t));
  await runtime.mount(createElement(Row));
  assert.equal(runtime.text(), "Checking");
  assert.equal([...t.due.values()][0]?.ms, ROW_WAIT_MS, "at most 5 s");
  const r = up();
  r.rows[1] = { id: "near", state: "down", via: "public", ms: null };
  give({ ok: r });
  await runtime.settle();
  assert.equal(runtime.text(), "NEAR is down");
  assert.equal(t.due.size, 0, "the 5 s cap is cleared once it answered");
  runtime.unmount();
  // audit 13's D6: one look per open, with the app's own record for NEAR Confidential's row
  assert.deepEqual(calls, ["status.probe", "ledger.status"], "one look per open");
});

test("the Settings row never says Checking… past 5 s: no answer by then is Not checked", async () => {
  const t = handTimers();
  const { bridge } = probeBridge(() => null);
  const Row = () => createElement("span", null, useStatusSummary(bridge, t));
  await runtime.mount(createElement(Row));
  assert.equal(runtime.text(), "Checking");
  t.fire();
  await runtime.settle();
  assert.equal(runtime.text(), "Not checked");
  runtime.unmount();
});

test("Settings shows the Status row with this open's word; no bridge (the gallery), no row and no look", async () => {
  const { bridge, calls } = probeBridge(() => Promise.resolve({ ok: up() }));
  await runtime.mount(createElement(SettingsPanel, { accountId: "", onClose: () => {}, logins: null, bridge }));
  assert.match(runtime.text(), /Status\nAll working/);
  assert.equal(calls.filter((c) => c === "status.probe").length, 1);
  runtime.unmount();
  await runtime.mount(createElement(SettingsPanel, { accountId: "", onClose: () => {}, logins: null }));
  assert.doesNotMatch(runtime.text(), /Status/);
  runtime.unmount();
});

test("only Settings' row and the Status sheet ask for the checks: nothing on Home, nothing in the background", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", "status\\.probe", "--", "apps", "packages", "tools"], { cwd: REPO, encoding: "utf8" }).trim().split("\n").filter((f) => !/\.test\.tsx?$/.test(f));
  // audit 13's D6: the sheet looks through status-row.ts lookStatus
  assert.deepEqual(out.sort(), ["apps/web/src/shell/status-row.ts", "packages/core/src/money-calls.ts", "packages/core/src/status-probe.ts", "packages/shell-api/src/MockBridge.ts", "packages/shell-api/src/faults.ts"]);
  const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  // the sheet (and the checks behind it) load when it opens: Home's JS budget (speed-budget.test.ts)
  assert.match(settings, /const StatusSheet = lazy\(\(\) => import\("\.\/StatusSheet\.tsx"\)/);
  assert.doesNotMatch(settings, /from "\.\/StatusSheet\.tsx"|status-probe|status-words/);
  const core = readFileSync(new URL("../core.ts", import.meta.url), "utf8");
  assert.match(core, /const status = laterBridge\(\(\) => Promise\.all\(\[import\("@zerofee\/core\/status-probe"\)/);
  assert.doesNotMatch(core, /from "@zerofee\/core\/status-probe"/);
  // the sheet looks again every 30 s only while it is up: its effect's cleanup clears the timer
  const sheet = readFileSync(new URL("./StatusSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /return \(\) => \{ live = false; timers\.clear\(timer\); \};/);
});

test("the Sim answers Status itself, every row Working, and asks no service", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  const r = await m.call<StatusReport>("status.probe");
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.rows.length, 8);
  assert.ok(r.ok.rows.every((x) => x.state === "working"));
  assert.equal(r.ok.relay, true);
});

test("a dev build's ?fault=solana:521 rigs the Sim's Solana row Down, and the relay's chain door with it (the proof shots)", async () => {
  const m = faultedBridge(createMockBridge({ latencyMs: 0 }), { service: "solana", failure: 521 });
  const r = await m.call<StatusReport>("status.probe");
  assert.ok("ok" in r);
  const rows = Object.fromEntries(r.ok.rows.map((x) => [x.id, x]));
  assert.equal(rows.solana!.state, "down");
  assert.equal(rows.relay!.doors!.chains, "down");
  assert.equal(rows.near!.state, "working");
  const slow = faultedBridge(createMockBridge({ latencyMs: 0 }), { service: "gecko", failure: "timeout" });
  const s = await slow.call<StatusReport>("status.probe");
  assert.ok("ok" in s);
  assert.equal(s.ok.rows.find((x) => x.id === "price")!.state, "slow");
});
