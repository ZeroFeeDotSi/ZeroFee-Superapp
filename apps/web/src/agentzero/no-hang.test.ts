// AgentZero never hangs, on the screen's side (wait.ts): a follow's Activity read, read_activity's other parts, the
// engine's account view and a failed turn's line each end within their limit; each has a control answering in time.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { LIMITS, TimedOut, timedOutLine } from "@zerofee/agent/chat/wait";
import { zeroEngine } from "@zerofee/agent/zero/engine";
import { readMoves } from "./az-tasks-live.ts";
import { moneyReader } from "./money-reader.ts";
import { failLine } from "./fail-line.ts";

const REAL = { ...LIMITS };
beforeEach(() => Object.assign(LIMITS, { core: 120, read: 120, firstByte: 150, gap: 150 }));
afterEach(() => Object.assign(LIMITS, REAL));
const never = () => new Promise<never>(() => undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A bridge whose `slow` methods never answer (or answer after `delayMs`); the rest answer `rows`. */
const bridgeOf = (slow: string[], o: { delayMs?: number; answers?: Record<string, unknown> } = {}): Bridge => ({
  call: (async (m: string) => {
    if (slow.includes(m)) return o.delayMs === undefined ? never() : (await sleep(o.delayMs), { ok: o.answers?.[m] ?? [] });
    return { ok: o.answers?.[m] ?? [] };
  }) as never,
  on: () => () => undefined,
}) as unknown as Bridge;

test("a follow's Activity read that never answers is a failed read within the core's limit; in time it's read (control)", async () => {
  const t0 = Date.now();
  const r = await readMoves(bridgeOf(["ledger.activity", "spending.activity"]));
  assert.deepEqual(r, { rows: [], legsRead: false, read: false });
  assert.ok(Date.now() - t0 < LIMITS.core + 1_000);
  const c = await readMoves(bridgeOf(["ledger.activity"], { delayMs: 20 }));
  assert.equal(c.read, true, "control");
});

test("read_activity: Spending's rows or the account's record not answering still answers from the moves, saying what wasn't read; in time it's all read (control)", async () => {
  const t0 = Date.now();
  const r = await moneyReader(bridgeOf(["spending.activity", "account.activity", "spending.wallets", "ledger.tokens", "ledger.chains"]), () => "").read({});
  assert.ok(Date.now() - t0 < LIMITS.core + 1_000, `${Date.now() - t0} ms`);
  assert.match(r.text, /Couldn't be read just now/);
  const c = await moneyReader(bridgeOf(["spending.activity"], { delayMs: 10 }), () => "").read({});
  assert.doesNotMatch(c.text, /Couldn't be read just now/, "control");
});

test("the engine's refresh with NEAR's account view never answering ends within the core's limit and keeps the last state; in time it reads (control)", async () => {
  const view = { limitUsd: 20, spentTodayUsd: "0", sample: true, people: ["kim.near"] };
  const store = new Map<string, string>();
  let hang = false;
  const b = {
    call: (async (m: string, p: { key?: string; value?: string } = {}) => {
      if (m === "account.agent.view") return hang ? never() : { ok: view };
      if (m === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } };
      if (m === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: {} });
      return { problem: { code: "x" } };
    }) as never,
    on: () => () => undefined,
  } as unknown as Bridge;
  const e = zeroEngine(b);
  const first = await e.refresh();
  assert.ok(first.state, "control: read in time");
  hang = true;
  const t0 = Date.now();
  const again = await e.refresh();
  assert.ok(Date.now() - t0 < LIMITS.core + 1_000);
  assert.deepEqual(again.state, first.state, "the last state is kept, never 'off' for a slow NEAR");
});

test("a wait that ran out before the turn began is said by name: what didn't answer, nothing moved", () => {
  assert.equal(failLine(new TimedOut("This phone's keychain", 8_000), true), timedOutLine("This phone's keychain"));
  assert.match(failLine(new Error("boom"), true), /AgentZero didn't answer/, "control: other failures as before");
});

test("Jobs' polling reads each have the core's limit, so one read that never answers can't stop the polling (control: the old unbounded form is caught)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./use-jobs.ts", import.meta.url), "utf8");
  const unbounded = /void Promise\.all\(\[\s*bridge\.call<Movement\[\]>\("ledger\.activity"/;
  assert.doesNotMatch(src, unbounded);
  assert.match(src, /withinOr\(bridge\.call<Movement\[\]>\("ledger\.activity", \{ limit: 50 \}\), LIMITS\.core/);
  assert.match(`void Promise.all([\n      bridge.call<Movement[]>("ledger.activity", { limit: 50 }).catch(() => undefined),`, unbounded, "control");
});

test("a money card in 'open' keeps a way on (Open again), and only the newest Open's end counts (control: the old card had none)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./MoneyCard.tsx", import.meta.url), "utf8");
  const wayOn = /state === "ask" \|\| state === "closed" \|\| state === "open"/;
  assert.match(src, wayOn);
  assert.doesNotMatch(`{(state === "ask" || state === "closed") && <div`, wayOn, "control");
  assert.match(src, /if \(!current\(\)\) return;/);
  assert.match(src, /const current = \(\) => live\.current && opens\.current === mine;/);
});
