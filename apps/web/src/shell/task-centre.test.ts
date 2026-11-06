// D144: the Activity centre's face. Every app's header has the icon, its badge counts what is still going; a tap opens the
// whole-screen centre: Now, then Earlier, newest first, one row each (ACTIVITY-MOTION, 4 Nov): the title, the step under
// way and how long in words (never a clock), or where the money is.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let ShellContext: { Provider: unknown };
let AppFrame: FunctionComponent<Record<string, unknown>>;
let TaskCentre: FunctionComponent<Record<string, unknown>>;
let store: { list: () => { app: string; id: string; state: string }[]; pending: () => number; forApp: (a: string) => { publish: (t: unknown) => boolean; end: (id: string, s: string, d?: string) => boolean } };
let live: { publishTracks: (tasks: unknown, list: unknown[], sent: Map<string, string>) => void };
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf8");

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ ShellContext, AppFrame } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
  ({ TaskCentre } = await server.ssrLoadModule("@zerofee/shell-api/TaskCentre.tsx"));
  store = (await server.ssrLoadModule("@zerofee/shell-api/tasks.ts")).taskStore();
  live = (await server.ssrLoadModule("@zerofee/wallet/app/money/LiveTrack.tsx")) as typeof live;
});
after(async () => { runtime?.unmount(); await server?.close(); });

const opened: string[] = [];
const ctx = { bridge: { call: async () => ({ ok: null }), on: () => () => {} }, openApp: (id: string, tab?: string) => opened.push(`${id} ${tab ?? ""}`), showProblem: async () => ({}), showWaiting: () => {}, openMoney: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
async function frame(): Promise<string> {
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(AppFrame, { name: "Trade", tray: [], tab: "a", onTab: () => {} }, createElement("p", null, "PAGE"))), { limit: 60 });
  return runtime.text();
}
async function openCentre(): Promise<string> {
  runtime.press(/^(\d+|9\+)$/);
  for (let i = 0; i < 400 && !/ACTIVITY|Activity|Nothing yet/.test(runtime.text().replace(/PAGE/, "")); i++) { await new Promise((r) => setTimeout(r, 25)); await runtime.settle(); }
  return runtime.text();
}

test("empty: the icon has no badge, and the centre says so in one line", async () => {
  const shown = await frame();
  assert.doesNotMatch(shown, /^\d+$/m, "no badge with nothing going");
  runtime.unmount();
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(TaskCentre, { onClose: () => {} })), { limit: 30 });
  assert.match(runtime.text(), /^Activity\nNothing yet\. What you do in any app shows here\.$/m);
  runtime.unmount();
});

test("the badge counts pending only; the centre shows Now then Earlier, one row each with the step under way and its time in words, or why it ended; a tap opens its app", async () => {
  const T = Date.now() - 41_000;
  const home = store.forApp("wallet"), trade = store.forApp("trade");
  home.publish({ id: "m1", title: "Move $5.00 to your SOL wallet", startedAt: T, endsAt: T + 240_000, steps: [{ label: "Left your Safe", state: "done", at: T }, { label: "Through NEAR privately", state: "done", at: T + 41_000 }, { label: "Arriving in your SOL wallet", state: "doing" }], open: { route: "balance" } });
  trade.publish({ id: "b1", title: "Buy $20.00 of BONK", startedAt: T, steps: [{ label: "Sent", state: "done", at: T + 400 }] });
  trade.publish({ id: "b0", title: "Sell all PEPE", startedAt: T - 60_000, steps: [] });
  trade.end("b0", "failed", "The market moved. Nothing was sold.");
  assert.equal(store.pending(), 2, "control: the failed one doesn't count");
  const shown = await frame();
  assert.match(shown, /^2$/m, "the badge: 2 going");
  const c = await openCentre();
  const i = (re: RegExp) => c.search(re);
  assert.ok(i(/^Now$/m) >= 0 && i(/^Now$/m) < i(/^Ended$/m), "Now, then Ended");
  assert.equal(i(/^Earlier$/m) + i(/^Recent$/m), -2, "control: never 'Earlier' (nor 'Recent', which could be the running ones) over a task that ended now (webd-money2 crawl)");
  // the time LEFT from the job's own estimate (the HARD RULE; Jobs hunt B3), never the time spent; none, said so
  assert.match(c, /^Move \$5\.00 to your SOL wallet\nArriving in your SOL wallet\n4 min left$/m, "the step under way and the time left, in words");
  assert.match(c, /^Buy \$20\.00 of BONK\nSent\nNo time estimate$/m, "every app's in one list; control: no estimate is said plainly");
  assert.doesNotMatch(c, / · 4\d s$/m, "control: never the time spent");
  assert.doesNotMatch(c, /^\d+:\d\d$/m, "no clock anywhere");
  assert.doesNotMatch(c.slice(c.indexOf("Activity")), /^(Home|Trade)$/m, "no app groups: the mark says which app");
  assert.match(c, /^Ended\nSell all PEPE\nThe market moved\. Nothing was sold\.\n(now|\d+ min)$/m, "why it ended, and when");
  runtime.press(/^Move \$5\.00 to your SOL wallet/);
  await runtime.settle();
  assert.deepEqual(opened.at(-1), "wallet balance", "a tap opens its app where it lives");
  runtime.unmount();
});

test("Home's moves are the same tasks: each live track is published once it changes, and ended with where the money is", () => {
  const calls: string[] = [];
  const tasks = { publish: (t: { id: string; state: string }) => (calls.push(`publish ${t.id} ${t.state}`), true), update: () => true, end: (id: string, s: string, d?: string) => (calls.push(`end ${id} ${s} ${d}`), true) };
  const sent = new Map<string, string>();
  const going = { id: "move:x", kind: "move", title: "Move $5.00 to your SOL wallet", wallets: ["safe", "sol"], startMs: 1000, steps: [{ label: "Left your Safe", state: "done", atMs: 0 }, { label: "Through NEAR privately", state: "doing" }, { label: "Arriving in your SOL wallet", state: "waiting" }] };
  live.publishTracks(tasks, [going], sent);
  live.publishTracks(tasks, [going], sent);
  assert.deepEqual(calls, ["publish move:x pending"], "control: unchanged, not sent again");
  live.publishTracks(tasks, [{ ...going, steps: going.steps.map((s) => ({ ...s, state: "done", atMs: 7000 })), end: { ok: true, line: "In your SOL wallet." } }], sent);
  assert.deepEqual(calls.slice(1), ["publish move:x pending", "end move:x done undefined"]);
  live.publishTracks(undefined, [going], new Map());
});

test("the centre's code loads on the first tap, never in an app's first load; the icon is in an app root's header, never a pushed page's", () => {
  const bell = read("packages/shell-api/src/TaskBell.tsx");
  assert.match(bell, /import\("\.\/TaskCentre\.tsx"\)/);
  assert.doesNotMatch(bell, /^import .*TaskCentre/m);
  const frameSrc = read("packages/shell-api/src/AppFrame.tsx");
  // §2.1 B6: the icon in an app's root header (AppFrame) only; a pushed page has its back arrow alone
  const pushed = frameSrc.slice(frameSrc.indexOf("export function PushedFrame"));
  const root = frameSrc.slice(frameSrc.indexOf("export function AppFrame"), frameSrc.indexOf("export function PushedFrame"));
  assert.equal(root.match(/\{centre\.bell\}/g)?.length, 1, "AppFrame keeps the icon");
  assert.doesNotMatch(pushed, /\{centre\.bell\}/, "a pushed page has no Activity icon");
  assert.match(pushed, /aria-label="Back"><Back \/><\/button>/, "control: its back arrow stays");
  assert.match(pushed, /\{centre\.sheet\}/, "control: tasks.open still opens the centre over a pushed page");
  assert.match(read("apps/web/src/speed-budget.test.ts"), /TaskCentre/);
});

test("tasks.open({ app }) opens the centre on the app on screen, only that app's tasks, with a chip that shows every app (control: a frame not on screen doesn't open)", async () => {
  const agent = store.forApp("agent") as unknown as { publish: (t: unknown) => boolean; open: (o?: { app?: string }) => void };
  agent.publish({ id: "j1", title: "Find the best price for BONK", steps: [{ label: "Reading prices", state: "doing" }] });
  // not on screen: nothing opens
  await runtime.mount(createElement(ShellContext.Provider as never, { value: { ...ctx, active: false } }, createElement(AppFrame, { name: "Chat", tray: [], tab: "a", onTab: () => {} }, createElement("p", null, "PAGE"))), { limit: 60 });
  agent.open({ app: "agentzero" });
  for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 20)); await runtime.settle(); }
  assert.doesNotMatch(runtime.text(), /Find the best price/, "control: a frame not on screen stays shut");
  runtime.unmount();
  await frame();
  agent.open({ app: "agentzero" });
  for (let i = 0; i < 400 && !/Find the best price/.test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, 25)); await runtime.settle(); }
  const one = runtime.text();
  assert.match(one, /^Activity\nAgentZero\n✕\nNow\nFind the best price for BONK\nReading prices\nNo time estimate$/m, "only AgentZero's tasks, its chip on top");
  assert.doesNotMatch(one, /Move \$5\.00 to your SOL wallet|Buy \$20\.00 of BONK/, "no other app's");
  runtime.press(/^AgentZero ✕$/);
  await runtime.settle();
  assert.match(runtime.text(), /Move \$5\.00 to your SOL wallet/, "the chip shows every app");
  assert.doesNotMatch(runtime.text(), /^AgentZero\n✕$/m, "and goes");
  runtime.unmount();
});

test("QA 4 Nov: a finished row with a public transaction is a receipt: a tap opens it (amount, where, when, proof with Copy and View); AgentZero's says it never names the Safe (control: a row without one opens its app; a trade's has no such line)", async () => {
  const HASH = "8kN3vRz7Qe1fT6yW2pLm9sJc4bXaHdUq5oGiEtYwZr7A";
  const { replyReceipt } = (await server.ssrLoadModule("/agentzero/az-tasks.ts")) as { replyReceipt: (t: unknown, m: number, title: string, now?: () => number, tx?: string) => void };
  replyReceipt(store.forApp("agent"), 33_000, "AgentZero paid ZeroFee 3.3¢ for a reply", Date.now, HASH);
  const trade = store.forApp("trade");
  trade.publish({ id: "r1", title: "Sold all WIF", usd: "$12.40", where: "In your SOL wallet", steps: [], proof: [{ chain: "sol", hash: HASH.replace("8k", "5j") }] });
  trade.end("r1", "done");
  trade.publish({ id: "r2", title: "Bought $3.00 of MEW", steps: [], open: { route: "trade" } });
  trade.end("r2", "done");
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(TaskCentre, { onClose: () => {} })), { limit: 60 });
  runtime.press(/^AgentZero paid ZeroFee 3\.3¢ for a reply/);
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 10)); await runtime.settle(); }
  const r = runtime.text();
  const receipt = r.slice(r.lastIndexOf("AgentZero paid ZeroFee 3.3¢ for a reply"));
  assert.match(receipt, /^AgentZero paid ZeroFee 3\.3¢ for a reply\nAmount\n\$0\.033\nWhere\nPaid from AgentZero's wallet\nWhen\n(now|\d+ min)\nProof\n/m, "what, how much, where, when");
  // QA (5 Nov): no raw id on screen; its network and View (Copy proof only where a network has no explorer)
  assert.match(receipt, /On NEAR\nView\nAnyone can check this on the chain\. It never names your Safe\./, "its proof, its network and View, and the public line");
  runtime.unmount();
  const before = opened.length;
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(TaskCentre, { onClose: () => {} })), { limit: 60 });
  runtime.press(/^Sold all WIF/);
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 10)); await runtime.settle(); }
  const sold = runtime.text().slice(runtime.text().lastIndexOf("Sold all WIF"));
  assert.match(sold, /^Sold all WIF\nAmount\n\$12\.40\nWhere\nIn your SOL wallet\n/m, "every app's receipt, not only AgentZero's");
  assert.doesNotMatch(sold, /never names your Safe/, "control: only AgentZero's payments say that");
  assert.equal(opened.length, before, "a receipt opens in place, no app");
  runtime.unmount();
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(TaskCentre, { onClose: () => {} })), { limit: 60 });
  runtime.press(/^Bought \$3\.00 of MEW/);
  await runtime.settle();
  assert.equal(opened.at(-1), "trade trade", "control: no transaction, the tap opens its app as before");
  assert.doesNotMatch(runtime.text(), /^Amount$/m);
  runtime.unmount();
});

test("copy note, 6 Nov: a swap job's row in the centre has the swap mark Home's row has; any other row keeps its app's mark", async () => {
  const { markOf } = await server.ssrLoadModule("@zerofee/shell-api/TaskCentre.tsx") as { markOf: (t: unknown) => unknown };
  const icons = await server.ssrLoadModule("@zerofee/design/icons.tsx") as Record<string, unknown>;
  assert.equal(markOf({ app: "home", id: "swap:home-swap-a", title: "Swap $10.00 of USDC for ZEC" }), icons.ActSwap);
  assert.equal(markOf({ app: "home", id: "swap:quote-1", title: "Swap $5.00 of SOL for BONK" }), icons.ActSwap, "a coin swap's job too");
  assert.equal(markOf({ app: "home", id: "job:1", title: "Swap $5.00 of USDC for NEAR" }), icons.ActSwap, "Home's row goes by the title");
  assert.equal(markOf({ app: "home", id: "job:2", title: "Move $5.00 to your Safe" }), icons.AppHome, "control");
  assert.equal(markOf({ app: "trade", id: "swap:t", title: "Swap $5.00 of SOL for BONK" }), icons.AppTrade, "control: the mark says the app");
  assert.match(read("packages/wallet/src/app/icons.tsx"), /export \{ ActSwap \} from "@zerofee\/design\/icons\.tsx";/, "one drawing: Home's row and this one");
});

test("real-tap proof, 6 Nov: at 390 wide a going row keeps its time left: the step on the left, the time under its dollars, nothing cut (control: an ended row's time is still how long ago)", async () => {
  const { goingParts } = await server.ssrLoadModule("@zerofee/shell-api/TaskCentre.tsx") as { goingParts: (t: unknown, now: number) => { line: string; left?: string } };
  const t = { steps: [{ label: "NEAR Intents is swapping it", state: "doing" }], startedAt: 0, endsAt: 9_000 };
  assert.deepEqual(goingParts(t, 1_000), { line: "NEAR Intents is swapping it", left: "8 s left" });
  assert.deepEqual(goingParts({ ...t, endsAt: undefined }, 1_000), { line: "NEAR Intents is swapping it", left: "No time estimate" });
  assert.deepEqual(goingParts({ steps: [], startedAt: 0 }, 1_000), { line: "No time estimate" }, "no step: its one piece");
  const c = read("packages/shell-api/src/TaskCentre.tsx");
  assert.match(c, /line=\{parts \? parts\.line : line\} \{\.\.\.\(slot\.below \? \{ below: slot\.below \} : \{\}\)\} usd=\{t\.usd\} when=\{when\}/);
  assert.match(c, /const when = parts \? slot\.when : ago\(/);
  assert.match(read("packages/wallet/src/app/money/LiveTrack.tsx"), /line=\{parts\.words\} \{\.\.\.timeSlot\(parts\.time\)\}/, "Home's row too");
  const { timeSlot } = await server.ssrLoadModule("@zerofee/design/live-row.ts") as { timeSlot: (t?: string) => object };
  assert.deepEqual(timeSlot("8 s left"), { when: "8 s left" }, "fits beside the step");
  assert.deepEqual(timeSlot("3 min left"), { when: "3 min left" });
  for (const w of ["Slower than usual.", "Almost there.", "No time estimate"]) assert.deepEqual(timeSlot(w), { below: w }, "its own line, never cutting the step");
  assert.deepEqual(timeSlot(undefined), {});
  assert.match(read("packages/design/src/liverow.css"), /\.zf-lrow__w \{[^}]*white-space: nowrap/, "the time column is never cut");
});
