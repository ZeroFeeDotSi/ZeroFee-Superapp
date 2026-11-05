// T-1 landing 2: the order screens' words and wiring. Dollars first; a scam coin's long name is cut; QA's honest line
// is on the sheet; the book is looked at only while Trade is on screen and visible, and leaving forgets what was seen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderLine, stateWord, sym, triggerFrom, STEPS } from "./order-words.ts";

test("an order's line, dollars first, and its state in a word", () => {
  assert.equal(orderLine({ kind: "limit-buy", usd: 10, triggerPx: 0.002989 }), "Buy $10.00 if it falls to $0.002989");
  assert.equal(orderLine({ kind: "take-profit", triggerPx: 0.00415 }), "Sell all if it rises to $0.00415");
  assert.equal(orderLine({ kind: "stop-loss", triggerPx: 0.002822 }), "Sell all if it falls to $0.002822");
  assert.equal(stateWord({ status: "missed" }), "Needs you");
  assert.equal(triggerFrom(0.00332, -10), 0.002988);
  assert.deepEqual(STEPS["take-profit"].every((s) => s > 0), true);
  assert.deepEqual(STEPS["stop-loss"].every((s) => s < 0), true, "a stop is always under today's price");
});

test("a scam coin's long name is cut on the order screens (control: a short one stays)", () => {
  assert.equal(sym("BONK"), "BONK");
  assert.equal(sym("USDC-OFFICIAL-AIRDROP-CLAIM"), "USDC-OFFICI…");
});

test("the sheet says QA's honest line and that a stop sells all held; the book ticks only on screen and pauses when leaving", () => {
  const sheet = readFileSync(new URL("./screens/Orders.tsx", import.meta.url), "utf8");
  // D143: an order's trade signs with no sheet, so no line says it asks
  assert.match(sheet, /<p className="zf-small">\{ORDER_RUNS_LINE\}<\/p>/);
  assert.doesNotMatch(sheet, /asks you first|trading limits/);
  assert.match(sheet, /SELLS_ALL_LINE\(name\)/);
  assert.match(sheet, /symbol: name/, "the stored order keeps the cut name");
  const app = readFileSync(new URL("./TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(!shell\.active\) \{ book\.pause\(\); plans\.pause\(\); return; \}/);
  assert.match(app, /const away = \(\) => \{ if \(!visible\(\)\) \{ book\.pause\(\); plans\.pause\(\); \} \};/);
  assert.match(app, /return \(\) => \{ clearInterval\(t\); document\.removeEventListener\("visibilitychange", away\); book\.pause\(\); plans\.pause\(\); \};/);
  assert.match(app, /<MissedOrders \/>/, "a missed order asks at the top of Trade");
  assert.doesNotMatch(sheet, /Spending/);
});

test("T-1 L2 review: the book reads the coin's live price with its own time and stops those feeds on pause; frozen timers forget what was seen; the sheet's price is frozen", () => {
  const glue = readFileSync(new URL("./order-book.ts", import.meta.url), "utf8");
  assert.match(glue, /rt\.market\.livePrice\(chain, coin, \(px, t\) =>/);
  assert.doesNotMatch(glue, /market\.coin\(/, "never the 30 s cached coin answer");
  assert.match(glue, /b\.pause = \(\) => \{ pause\(\); stopFeeds\(\); \};/);
  const app = readFileSync(new URL("./TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(Date\.now\(\) - last > 15_000\) \{ book\.pause\(\); plans\.pause\(\); \}/);
  const sheet = readFileSync(new URL("./screens/Orders.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const \[px\] = useState\(livePx\);/);
  assert.match(sheet, /\}, days, px\);/);
});

test("QA: the device lock: navigator.locks with ifAvailable where the browser has it; else a BroadcastChannel claim where the first claim wins (control: a lone tab runs)", async () => {
  const { deviceLock } = await import("./order-book.ts");
  const { NOT_RUN } = await import("../orders.ts");
  // navigator.locks: a held name with ifAvailable gives the callback null, and nothing runs
  const asked: unknown[] = [];
  const nav = { locks: { request: async (name: string, opts: { ifAvailable: boolean }, cb: (l: unknown) => Promise<unknown>) => (asked.push([name, opts]), cb(name === "busy" ? null : {})) } };
  const viaLocks = deviceLock(nav as never, null)!;
  assert.equal(await viaLocks("busy", true, async () => "ran"), NOT_RUN);
  assert.equal(await viaLocks("zf-order-o1", true, async () => "ran"), "ran");
  assert.deepEqual(asked[1], ["zf-order-o1", { ifAvailable: true }]);
  // the BroadcastChannel claim: two tabs claim the same order at once; exactly one runs it
  const tabs: ((m: unknown) => void)[] = [];
  const channel = () => { const mine: ((e: { data: unknown }) => void)[] = []; const idx = tabs.length; tabs.push((m) => mine.forEach((h) => h({ data: m }))); return { postMessage: (m: unknown) => tabs.forEach((deliver, i) => i !== idx && deliver(m)), addEventListener: (_t: "message", h: (e: { data: unknown }) => void) => void mine.push(h) }; };
  const a = deviceLock(undefined, channel, 20)!, b = deviceLock(undefined, channel, 20)!;
  const ran: string[] = [];
  await Promise.all([a("zf-order-o1", true, async () => void ran.push("A")), b("zf-order-o1", true, async () => void ran.push("B"))]);
  assert.equal(ran.length, 1, `one tab ran it: ${ran.join(",")}`);
  const alone = deviceLock(undefined, channel, 5)!;
  assert.equal(await alone("zf-order-o2", true, async () => "ran"), "ran", "control: no other claim, it runs");
});

test("QA: a damaged store's line shows at the top of Trade (control: the missed asks are in the same place)", () => {
  const sheet = readFileSync(new URL("./screens/Orders.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{damaged && <div className="zf-note tr-missed-one" data-testid="orders-damaged"><p className="zf-body">\{DAMAGED_LINE\}<\/p><\/div>/);
  assert.match(sheet, /const damaged = book\.damaged\(\) \|\| unreadable;/, "a store that can't be read at all says so too");
  const glue = readFileSync(new URL("./order-book.ts", import.meta.url), "utf8");
  assert.match(glue, /key: `\$\{ORDERS_KEY\}\.damaged\.\$\{Date\.now\(\)\}`/, "kept aside under its own name");
});

test("safety review M3: in the BroadcastChannel fallback a tab's own held lock counts (never 'closed while it ran' for its own run), and the store's lock is exclusive (a waiter gets it after)", async () => {
  const { deviceLock } = await import("./order-book.ts");
  const { NOT_RUN } = await import("../orders.ts");
  const tabs: ((m: unknown) => void)[] = [];
  const channel = () => { const mine: ((e: { data: unknown }) => void)[] = []; const idx = tabs.length; tabs.push((m) => mine.forEach((h) => h({ data: m }))); return { postMessage: (m: unknown) => tabs.forEach((deliver, i) => i !== idx && deliver(m)), addEventListener: (_t: "message", h: (e: { data: unknown }) => void) => void mine.push(h) }; };
  const a = deviceLock(undefined, channel, 10)!, b = deviceLock(undefined, channel, 10)!;
  let inner: unknown;
  await a("zf-order-o1", true, async () => { inner = await a("zf-order-o1", true, async () => "ran twice"); });
  assert.equal(inner, NOT_RUN, "its own held name");
  const order: string[] = [];
  await Promise.all([
    a("zf-orders-store", false, async () => { order.push("A in"); await new Promise((r) => setTimeout(r, 40)); order.push("A out"); }),
    b("zf-orders-store", false, async () => { order.push("B in"); await new Promise((r) => setTimeout(r, 5)); order.push("B out"); }),
  ]);
  assert.ok(order.join() === "A in,A out,B in,B out" || order.join() === "B in,B out,A in,A out", `never both inside: ${order.join()}`);
  // navigator.locks refusing (an opaque origin) falls back, never breaks every change
  const refusing = deviceLock({ locks: { request: async () => { throw new DOMException("no", "SecurityError"); } } } as never, null)!;
  assert.equal(await refusing("x", true, async () => "ran"), "ran");
});

test("T-2 landing 2: standing buys are looked at with the orders (on screen, visible) and pause with them; the sheet says the honest line and that a missed time asks once", () => {
  const app = readFileSync(new URL("./TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(!shell\.active\) \{ book\.pause\(\); plans\.pause\(\); return; \}/);
  assert.match(app, /void plans\.tick\(\)\.catch\(\(\) => undefined\)/);
  assert.match(app, /const away = \(\) => \{ if \(!visible\(\)\) \{ book\.pause\(\); plans\.pause\(\); \} \};/);
  assert.match(app, /<MissedStanding \/>/);
  const sheet = readFileSync(new URL("./screens/Standing.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{PLAN_RUNS_LINE\} If ZeroFee is closed at a buy time, it asks you once\. It never buys late by itself\./);
  assert.match(sheet, /PLANS_DAMAGED_LINE/);
  assert.doesNotMatch(sheet, /Spending/);
  const glue = readFileSync(new URL("./order-book.ts", import.meta.url), "utf8");
  assert.match(glue, /key: `\$\{STANDING_KEY\}\.damaged\.\$\{Date\.now\(\)\}`/);
  assert.match(glue, /run: standingRunner\(rt\.svc as never\),\n\s+\.\.\.\(sharedLock \? \{ lock: sharedLock \} : \{\}\),/);
});

test("T-2 landing 2 review: the plan sheet takes plain dollars only, its most a week follows the run, the engine's refusal shows inline, one plan per tap, and a failed Pause says so", async () => {
  const sheet = readFileSync(new URL("./screens/Standing.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\/\^\\d\+\(\\\.\\d\{1,2\}\)\?\$\/\.test\(typed\)/);
  assert.match(sheet, /const weekCap = caps\.includes\(cap\) \? cap : caps\[0\] \?\? cap;/);
  assert.match(sheet, /\(why \?\? refusal\) && <p className="zf-small tr-why" role="status">/);
  assert.match(sheet, /if \(taps\.current\) return;/);
  assert.match(sheet, /"That didn't save\. Try again\."/);
  const { planRefusal } = await import("../standing.ts");
  assert.match(planRefusal({ usd: 60, weekCapUsd: 100, every: "day" }, 30)!, /\$1 to \$50/, "the line a $60 run shows");
  assert.equal(planRefusal({ usd: 40, weekCapUsd: 50, every: "day" }, 30), null, "control: $40 with the cap that follows it");
});

test("ST-C fold-in (QA): a tap's failure on the order screens says one line, never an unhandled rejection (control: a tap that went clears it)", async () => {
  const { tapped, TAP_FAILED, NOT_NOW } = await import("./order-words.ts");
  const unhandled: unknown[] = [];
  const on = (e: unknown) => void unhandled.push(e);
  process.on("unhandledRejection", on);
  try {
    const said: (string | null)[] = [];
    let after = 0;
    await tapped(Promise.reject(new Error("store can't be read")), (l) => void said.push(l), () => void after++);
    await tapped(Promise.resolve(), (l) => void said.push(l), () => void after++);
    await tapped(Promise.resolve(false), (l) => void said.push(l), () => void after++);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(said, [TAP_FAILED, null, NOT_NOW]);
    assert.equal(TAP_FAILED, "That didn't go. Try again.");
    assert.equal(after, 3, "the list is read again either way");
    assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", on); }
  for (const f of ["./screens/Orders.tsx", "./screens/ExitPlan.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /void book\.(runMissed|cancel)\([^)]*\)\.finally/, `${f}: every tap goes through tapped()`);
    assert.match(src, /tapped\(book\.runMissed\(o\.id\)/);
  }
});
