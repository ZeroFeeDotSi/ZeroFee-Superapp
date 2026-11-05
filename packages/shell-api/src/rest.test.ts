// HEAT-2026-11-03: nothing for the eyes runs while the page rests (hidden or under a site's window), one scheduler for the
// idle reads, and the endless animations pause under html[data-zf-rest].
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeScheduler, onScreen, resting, setCovered, setShown, onRestChange } from "./rest.ts";

function fakeWorld() {
  let now = 0, seq = 0, resting = false;
  const shown = new Set<string>();
  const timers = new Map<number, { at: number; fn: () => void }>();
  const subs = new Set<() => void>();
  const clock = {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const rest = (on: boolean) => { resting = on; for (const f of [...subs]) f(); };
  const s = makeScheduler(clock, () => resting, (f) => { subs.add(f); return () => void subs.delete(f); }, (a) => shown.has(a));
  const show = (app: string, on: boolean) => { if (on) shown.add(app); else shown.delete(app); for (const f of [...subs]) f(); };
  return { s, advance, rest, timers, subs, show };
}

test("one timer for every read: the next one due, reads due together run in one wake", () => {
  const w = fakeWorld();
  const runs: string[] = [];
  w.s.every(4_000, () => runs.push("a"));
  w.s.every(20_000, () => runs.push("b"));
  w.s.every(5_000, () => runs.push("c"));
  assert.equal(w.timers.size, 1, "one timer armed, never one per read");
  let wakes = 0;
  const set = w.timers.set.bind(w.timers);
  w.timers.set = (k, v) => { wakes++; return set(k, v); };
  w.advance(20_000);
  const n = (k: string) => runs.filter((r) => r === k).length;
  // 4 s and 5 s share wakes (the 4 s one held back up to 1 s): 4 + 4 reads in 4 wakes, plus the 20 s one with them
  assert.equal(n("a"), 4, "never more often than its period, stretched at most 1 s to share a wake");
  assert.equal(n("c"), 4);
  assert.equal(n("b"), 1);
  assert.ok(wakes <= 5, `wakes ${wakes}: fewer than the 9 reads`);
  assert.equal(w.timers.size, 1);
});

test("no timer survives the page resting; back, each read that missed runs once, then on its period", () => {
  const w = fakeWorld();
  let a = 0, b = 0;
  w.s.every(4_000, () => a++);
  w.s.every(20_000, () => b++);
  w.advance(4_000);
  assert.equal(a, 1);
  w.rest(true);
  assert.equal(w.timers.size, 0, "resting: nothing armed");
  assert.equal(w.s.armed, false);
  w.advance(300_000);
  assert.equal(a, 1, "nothing ran while resting");
  assert.equal(b, 0);
  w.rest(false);
  assert.equal(a, 2, "one fresh read on return");
  assert.equal(b, 1, "one fresh read on return, even of the slow one");
  assert.equal(w.timers.size, 1);
  w.advance(4_000);
  assert.equal(a, 3);
  // control: a page that never rests reads on its period only (no extra read)
  const c = fakeWorld();
  let n = 0;
  c.s.every(4_000, () => n++);
  c.rest(false);
  assert.equal(n, 0, "control: not resting before, nothing missed, nothing extra");
});

test("back from resting, each read runs once at once (the page may have changed unseen), never twice", () => {
  const w = fakeWorld();
  let a = 0;
  w.s.every(20_000, () => a++);
  w.advance(1_000);
  w.rest(true);
  w.rest(false);
  assert.equal(a, 1, "one read on return");
  w.rest(false);
  assert.equal(a, 1, "a second 'shown' with no rest between reads nothing");
  // control: not resting at all, nothing runs until its time
  const c = fakeWorld();
  let m = 0;
  c.s.every(20_000, () => m++);
  c.advance(19_000);
  assert.equal(m, 0);
});

test("a read for an app runs only while that app is on screen: another app shown, nothing armed for it; back, one read", () => {
  const w = fakeWorld();
  let home = 0, any = 0;
  w.show("wallet", true);
  w.s.every(4_000, () => home++, "wallet");
  w.advance(4_000);
  assert.equal(home, 1);
  w.show("wallet", false);
  w.show("trade", true);
  assert.equal(w.timers.size, 0, "Wallet not on screen: no timer for its read");
  w.advance(60_000);
  assert.equal(home, 1);
  w.show("trade", false);
  w.show("wallet", true);
  assert.equal(home, 2, "one read on return");
  // control: a read with no app runs whichever app shows
  w.s.every(4_000, () => any++);
  w.show("wallet", false);
  w.advance(8_000);
  assert.equal(any, 2);
  assert.equal(home, 2);
});

test("the stop ends the read; the last stop leaves nothing armed and no listener", () => {
  const w = fakeWorld();
  let a = 0;
  const stopA = w.s.every(4_000, () => a++);
  const stopB = w.s.every(4_000, () => undefined);
  assert.equal(w.subs.size, 1, "one rest listener for the whole scheduler");
  stopA();
  w.advance(8_000);
  assert.equal(a, 0);
  stopB();
  assert.equal(w.timers.size, 0);
  assert.equal(w.subs.size, 0);
  assert.equal(w.s.size, 0);
});

test("one read that throws never stops the others", () => {
  const w = fakeWorld();
  let ok = 0;
  w.s.every(1_000, () => { throw new Error("x"); });
  w.s.every(1_000, () => ok++);
  w.advance(3_000);
  assert.equal(ok, 3);
});

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the idle reads of Home's live rows go through the scheduler, never their own interval", () => {
  for (const f of ["../../wallet/src/app/money/live-steps.ts", "../../wallet/src/app/money/adds-on-way.ts"]) {
    const s = src(f);
    assert.doesNotMatch(s, /setInterval\(/, f);
    assert.match(s, /from "@zerofee\/shell-api\/rest\.ts"/, f);
    // on every app (their tracks are Activity centre tasks), never gated to Wallet alone
    assert.match(s, /= every\((4_000|20_000|ADDS_FAST_MS), /, f);
    assert.doesNotMatch(s, /every\([^;]*, "wallet"\)/, f);
  }
});

test("every endless animation pauses while the page rests; the page installs it at boot; the iPhone's covered event rests it", () => {
  assert.match(src("../../../apps/web/src/app.css"), /html\[data-zf-rest\] \*, html\[data-zf-rest\] \*::before, html\[data-zf-rest\] \*::after \{ animation-play-state: paused !important; \}/);
  assert.match(src("../../../apps/web/src/main.tsx"), /installRest\(\);/);
  assert.match(src("../../../apps/web/src/host/ios.ts"), /host\.on\("device\.covered", \(p\) => setCovered\(/);
  assert.match(src("../../../apps/web/src/shell/AppHost.tsx"), /setShown\(app\.id, active\)/);
});

test("the live balance push runs only where its figures show (Wallet, Trade, a money sheet) and never while resting", () => {
  const s = src("../../wallet/src/app/home-reads.ts");
  assert.match(s, /const seen = \(\) => \(o\.money \? !rest\.resting\(\) : rest\.onScreen\("wallet"\) \|\| rest\.onScreen\("trade"\)\);/);
  assert.match(s, /\{ visible: seen, onVisibility: rest\.onRestChange \}/);
});

test("an app is on screen only while shown and the page isn't covered; told once the change settles", async () => {
  let told = 0;
  const off = onRestChange(() => told++);
  const settle = () => new Promise<void>((r) => queueMicrotask(r));
  setShown("wallet", true);
  assert.equal(onScreen("wallet"), true);
  assert.equal(onScreen("trade"), false);
  await settle();
  assert.equal(told, 1);
  // Wallet to Trade in one commit (Wallet cleared first): one telling, never an "off" in between
  setShown("wallet", false);
  setShown("trade", true);
  await settle();
  assert.equal(told, 2, "one telling for the switch");
  setCovered(true);
  assert.equal(resting(), true);
  assert.equal(onScreen("trade"), false, "under a site's window nothing is on screen");
  await settle();
  setCovered(false);
  setShown("trade", false);
  await settle();
  assert.equal(onScreen("trade"), false);
  assert.equal(told, 4);
  setShown("trade", false);
  await settle();
  assert.equal(told, 4, "no change, nothing told");
  off();
});

test("covered by a site's window, the Browser's wallet engine still answers every request (only animations and idle reads rest)", async () => {
  const { startBrowserWallet } = await import("../../browser/src/service.ts");
  const handlers = new Map<string, (p: unknown) => void>();
  const replies: unknown[] = [];
  const bridge = {
    on: (event: string, h: (p: unknown) => void) => { handlers.set(event, h); return () => void handlers.delete(event); },
    call: async (method: string, params: unknown) => { if (method === "device.wallet.reply") replies.push(params); return { ok: {} }; },
  } as unknown as Parameters<typeof startBrowserWallet>[0];
  const w = startBrowserWallet(bridge);
  setCovered(true);
  assert.equal(resting(), true);
  const ask = (id: string) => handlers.get("device.wallet.request")!({ id, method: "eth_chainId", params: [], origin: "https://pump.fun", mainFrame: true });
  ask("1");
  for (let i = 0; i < 20 && replies.length < 1; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(replies.length, 1, "answered while covered");
  assert.equal((replies[0] as { id?: string }).id, "1");
  // control: the same request uncovered is answered the same way
  setCovered(false);
  ask("2");
  for (let i = 0; i < 20 && replies.length < 2; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(replies.length, 2);
  w.stop();
});

test("nothing that answers a site or the core reads the page's rest (only the CSS, the idle reads and the push do)", () => {
  for (const f of ["../../browser/src/service.ts", "../../browser/src/engine/engine.ts", "../../../apps/web/src/host/partner.ts"]) assert.doesNotMatch(src(f), /shell-api\/rest\.ts/, f);
  // ios.ts only sets the cover; it never gates a call on it
  const ios = src("../../../apps/web/src/host/ios.ts");
  assert.doesNotMatch(ios, /resting\(\)|onScreen\(/);
});
