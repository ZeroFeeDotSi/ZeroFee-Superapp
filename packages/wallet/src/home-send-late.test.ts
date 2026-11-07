// A plain Send's slow row ends on Home, with Activity never opened (the auditor and QA, 6 Nov, on fix/late-leg-ends):
// Home's reads (home-reads.ts startHomeReads, the runtime's `activity`, Home's live cards) ask the ledger's own
// ledger.activity, whose resume asks leg 1 again (send-job settleLates, at most every 15 s). So Home's open is enough:
// after 1Click's SUCCESS of leg 1, Home's next read shows the row back in Private. Control: PENDING holds.
// Fails without ledger.ts activity's settleLates (392f8b1ac). No wall clock: the ledger's time is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { startHomeReads, type HomeSink } from "./app/home-reads.ts";
import { createLedgerService } from "./ledger.ts";
import { LEG1_WAIT_MS, SEND_LATE, sendWords } from "./send-job.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const ME = "kid.near";
const ID = "safe-send:out-dep-0000000000000000";
const BACK_LINE = "It wasn't paid. The $5.00 is back in Private.";
const flush = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };

function rig() {
  let leg1 = "PENDING", clock = T0 + LEG1_WAIT_MS + 60_000, asks = 0;
  const core = fakeCore({ accountId: ME });
  const base = createApis(replayFetch({}));
  const apis: Apis = { ...base, status: async (a: string, _v?: string, tag?: string) => (a === "in-dep" && tag === "in-tag" ? (asks++, { status: leg1 }) : { status: "PENDING_DEPOSIT" }) as never };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, {}, {}), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: "https://quotes.example", now: () => clock });
  const at = new Date(T0).toISOString();
  const send = { id: ID, kind: "pay", status: "problem", from: "usdc", to: "a friend", amount: "5.00", startedAtIso: at, updatedAtIso: at, explorerUrls: [], private: true, problem: sendWords.slow("USDC") } as unknown as Movement;
  core.store.set("movements", JSON.stringify([send]));
  core.store.set(SEND_LATE, JSON.stringify({ [ID]: { inDeposit: "in-dep", inTag: "in-tag", coin: "USDC", at: T0 + LEG1_WAIT_MS } }));
  /** Home opened (its reads over Wallet's bridge, as the runtime starts them): the Send's row as Home's activity has it. */
  const openHome = async (): Promise<Movement | undefined> => {
    let rows: Movement[] | null = null;
    const sink = new Proxy({}, { get: (_t, k) => (k === "activity" ? (r: Movement[]) => void (rows = r) : () => undefined) }) as HomeSink;
    const timers = { setTimeout: () => 0, clearTimeout: () => undefined };
    const home = startHomeReads(ledger as Bridge, sink, { timers });
    for (let i = 0; i < 20 && rows === null; i++) await flush();
    home.stop();
    assert.ok(rows, "Home read its activity");
    return (rows as Movement[]).find((m) => m.id === ID);
  };
  return { openHome, say: (s: string) => void (leg1 = s), later: (ms: number) => void (clock += ms), asks: () => asks };
}

test("Home's row for a plain Send ended slow ends after leg 1's SUCCESS, Activity never opened: Home's own read asks leg 1 again (control: PENDING holds; inside 15 s nothing is asked) [fails without ledger.activity's settleLates]", async () => {
  const r = rig();
  const first = await r.openHome();
  assert.equal(first?.problem?.money.state, "on-the-way", "control: PENDING, the row holds on Home");
  assert.equal(r.asks(), 1, "Home's open asked leg 1");
  r.say("SUCCESS");
  assert.equal((await r.openHome())?.problem?.money.state, "on-the-way", "control: Home again inside 15 s asks nothing");
  assert.equal(r.asks(), 1);
  r.later(15_000);
  const done = await r.openHome();
  assert.equal(r.asks(), 2);
  assert.deepEqual([done?.problem?.money.state, done?.problem?.whatHappened], ["safe", BACK_LINE], "Home's row: back in Private");
});
