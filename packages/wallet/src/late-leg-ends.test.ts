// A slow leg 1's every end (the audit's rulings, 6 Nov), after the hold's end on SUCCESS (private-hold-clear.test.ts):
// (1) leg 1 (subwallet.private.quoteIn) refunds to Private (its quote's refundTo is the pocket), so REFUNDED ends as
//     SUCCESS ("It wasn't paid. The $X is back in Private."); FAILED promises nothing: failedProblem's words for Private
//     ("either in Private or still with NEAR Intents. Check Private first."); never "back in your Safe";
// (2) an older build's slow end (no leg 1 kept): past the 3-day keep with no record, unsure words, and no more reads;
// (3) a plain Send's own row: the ledger's Activity read asks leg 1 again, so it ends the same way.
// No wall clock: every time is injected (mocked timers for the follower).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { PRIVATE_KEEP_MS, PRIVATE_UNSURE } from "@zerofee/core/private-route";
import { privMissedUsd, privOnWay, privUnsure, type SpendingActivity } from "@zerofee/core/spending";
import { checkOpen, holdExpired, partEnd, type PrivateHost } from "@zerofee/trade/float-private.ts";
import { heldRow, type MoveRow } from "@zerofee/trade/float-view.ts";
import { moveTrack } from "./app/money/live-steps.ts";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { createPrivateMove } from "./private-move.ts";
import { createSendJobs, LEG1_WAIT_MS, lateEnd, SEND_LATE, sendWords, type SendJob } from "./send-job.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = 86_400_000;
const BACK_LINE = "It wasn't paid. The $5.00 is back in Private.";
const UNSURE_WHERE = "either in Private or still with NEAR Intents";
const UNSURE_CHECK = "Check Private first.";
const ONWAY_WORDS = "The $5.00 is on its way to Private. Try again once it's there.";

// ---- the rule ----
test("lateEnd: SUCCESS and REFUNDED are back in Private, FAILED unsure; no record past the keep unsure; the rest holds (table)", () => {
  const rows: [Parameters<typeof lateEnd>[0], ReturnType<typeof lateEnd>][] = [
    [{ kept: true, status: "SUCCESS", ageMs: DAY }, "back"],
    [{ kept: true, status: "REFUNDED", ageMs: DAY }, "back"],
    [{ kept: true, status: "FAILED", ageMs: DAY }, "unsure"],
    [{ kept: true, status: "PENDING_DEPOSIT", ageMs: DAY }, "hold"],
    [{ kept: true, status: "PROCESSING", ageMs: 10 * DAY }, "hold"],
    [{ kept: true, status: undefined, ageMs: DAY }, "hold"],
    [{ kept: false, status: undefined, ageMs: PRIVATE_KEEP_MS }, "hold"],
    [{ kept: false, status: undefined, ageMs: PRIVATE_KEEP_MS + 1 }, "unsure"],
    [{ kept: false, status: undefined, ageMs: DAY }, "hold"],
    [{ kept: false, status: "SUCCESS", ageMs: DAY }, "hold"],
  ];
  for (const [o, want] of rows) assert.equal(lateEnd(o), want, JSON.stringify(o));
  assert.equal(PRIVATE_KEEP_MS, 3 * DAY);
});

test("partEnd and privUnsure: a payment whose money is unsure says failedProblem's words for Private, never 'back', and gets no Try again (table)", () => {
  assert.equal(PRIVATE_UNSURE, `Your money is ${UNSURE_WHERE}. ${UNSURE_CHECK}`);
  const rows: [Parameters<typeof partEnd>[0], string][] = [
    [{ usd: 5, ids: ["a"], money: { a: "unsure" } }, PRIVATE_UNSURE],
    [{ usd: 5, ids: ["a"], money: { a: "on-the-way" } }, ONWAY_WORDS],
    [{ usd: 5, ids: ["a"], money: { a: "safe" } }, "The $5.00 is back in Private."],
    [{ usd: 5, ids: ["a"], money: { b: "unsure" } }, "The $5.00 is back in Private."],
  ];
  for (const [p, want] of rows) assert.equal(partEnd(p), want, JSON.stringify(p));
  const m = (money?: Record<string, string>) => ({ priv: { parts: [{ chain: "sol" as const, ids: ["a"], ...(money ? { money } : {}) }, { chain: "near" as const, ids: ["b"] }] } });
  assert.deepEqual([privUnsure(m({ a: "unsure" })), privUnsure(m({ a: "safe" })), privUnsure(m())], [true, false, false]);
  for (const w of [PRIVATE_UNSURE]) assert.doesNotMatch(w, /your Safe/, "never 'back in your Safe'");
});

test("holdExpired: a held row past the keep from its tap; never a younger one, never one not held (table)", () => {
  const row = (money: Record<string, string> | undefined, ageMs: number) => ({ at: T0, priv: { parts: [{ ids: ["m1"], ...(money ? { money } : {}) }] } }) as unknown as MoveRow;
  const rows: [MoveRow, number, boolean][] = [
    [row({ m1: "on-the-way" }, 0), T0 + PRIVATE_KEEP_MS + 1, true],
    [row({ m1: "on-the-way" }, 0), T0 + PRIVATE_KEEP_MS, false],
    [row({ m1: "on-the-way" }, 0), T0 + DAY, false],
    [row({ m1: "safe" }, 0), T0 + 10 * DAY, false],
    [row(undefined, 0), T0 + 10 * DAY, false],
  ];
  for (const [r, now, want] of rows) assert.equal(holdExpired(r, now), want, `${JSON.stringify(r.priv)} at +${now - T0}`);
});

// ---- the ledger: a Move's status read (privateMoveStatus) ----
const JOB = "job0123456789abcdef";
const sendJob: SendJob = { id: "safe-send:out-dep-0000000000000000", inDeposit: "in-dep", inTag: "in-tag", outDeposit: "out-dep", signedData: { signed: true }, coinId: "nep141:usdc", leg2In: "5000000", coin: "USDC", startedAtIso: new Date(T0).toISOString() };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
type Leg1 = "PENDING" | "SUCCESS" | "REFUNDED" | "FAILED";
const moving = (): Movement => ({ id: sendJob.id, kind: "pay", status: "moving", from: "usdc", to: "Your SOL wallet", amount: "5.00", startedAtIso: sendJob.startedAtIso, updatedAtIso: sendJob.startedAtIso, explorerUrls: [], private: true } as unknown as Movement);

async function rig(o: { slowAlready?: boolean } = {}) {
  const kv = new Map<string, string>();
  let clock = T0;
  let leg1: Leg1 = "PENDING";
  let asked = 0;
  let list: Movement[] = [o.slowAlready ? { ...moving(), status: "problem", problem: sendWords.slow("USDC") } as Movement : moving()];
  const remember = async (m: Movement) => { list = [m, ...list.filter((x) => x.id !== m.id)]; };
  const sj = createSendJobs({
    apis: {
      status: (async (dep: string, _r: unknown, tag: unknown) => { if (dep !== "in-dep" || tag !== "in-tag") return { status: "PENDING_DEPOSIT" }; asked++; return { status: leg1 }; }) as never,
      submitIntent: (async () => { throw new Error("never paid late"); }) as never,
    },
    relayed: "relay", remember, note: async () => {}, forget: async () => {},
    loadMovements: async () => list, emit: () => {}, stored: async (k) => kv.get(k), store: async (k, v) => void kv.set(k, v),
    serially: (f) => f(), iso: () => new Date(clock).toISOString(), now: () => clock, trackMs: 1_000,
  });
  kv.set("private-moves", JSON.stringify({ [JOB]: { at: T0, parts: [{ wallet: "w-sol", usd: 5, ids: [sendJob.id] }], fillAt: T0 } }));
  const pm = createPrivateMove({ stored: async (k: string) => kv.get(k), store: async (k: string, v: string) => void kv.set(k, v), serially: (f: () => Promise<unknown>) => f(), loadMovements: async () => list, resume: async () => {}, now: () => clock, settleLate: (id: string) => sj.settleLate(id) } as never);
  const slowEnd = async () => {
    await sj.start(sendJob);
    mock.timers.tick(1_000); await flush();
    clock = T0 + LEG1_WAIT_MS + 1;
    mock.timers.tick(1_000); await flush();
  };
  return { kv, sj, pm, list: () => list, mv: () => list.find((m) => m.id === sendJob.id)!, set: (s: Leg1) => { leg1 = s; }, at: (ms: number) => { clock = T0 + ms; }, asked: () => asked, slowEnd };
}
const money = async (r: Awaited<ReturnType<typeof rig>>) => (await r.pm.privateMoveStatus({ job: JOB }))!.parts[0]!.moves[0]!.money;

test("(1) the ledger: leg 1 REFUNDED is back in Private as SUCCESS is; FAILED says failedProblem's place for Private; never 'your Safe' (control: still on its way holds)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const [end, state, where, said] of [["REFUNDED", "safe", "in Private", BACK_LINE], ["FAILED", "unsure", UNSURE_WHERE, "NEAR Intents didn't finish this payment."]] as const) {
      const r = await rig();
      await r.slowEnd();
      assert.equal(r.mv().problem?.code, "ledger.send.slow");
      assert.equal(await money(r), "on-the-way", "control: PENDING holds");
      r.set(end);
      assert.equal(await money(r), state, end);
      const p = r.mv().problem!;
      assert.deepEqual([p.money.state, p.money.where, p.whatHappened], [state, where, said], end);
      if (end === "FAILED") assert.equal((p.money as { check?: string }).check, UNSURE_CHECK);
      assert.doesNotMatch(JSON.stringify(p), /your Safe/, `${end}: never the Safe`);
      assert.deepEqual(JSON.parse(r.kv.get(SEND_LATE) ?? "{}"), {}, `${end}: leg 1 forgotten`);
      const n = r.asked();
      await money(r);
      assert.equal(r.asked(), n, `${end}: never asked again`);
    }
  } finally {
    mock.timers.reset();
  }
});

test("(2) the ledger: an older build's slow end (no leg 1 kept) holds for the keep, then says unsure and is asked no more (control: a day old holds; one already back stays back)", async () => {
  const r = await rig({ slowAlready: true });
  r.at(DAY);
  assert.equal(await money(r), "on-the-way", "control: a day old, no record: held");
  r.at(PRIVATE_KEEP_MS + 1);
  assert.equal(await money(r), "unsure");
  assert.deepEqual([r.mv().problem!.money.where, r.asked()], [UNSURE_WHERE, 0], "failedProblem's place, with no 1Click read (nothing to read)");
  // control: a slow end already back in Private is never made unsure by its age
  const b = await rig();
  b.list()[0] = { ...moving(), status: "problem", problem: sendWords.inPrivate(sendWords.slow("USDC"), 5) } as Movement;
  b.at(10 * DAY);
  assert.equal(await money(b), "safe");
});

// ---- the engine: a closed page's read of a held row with no record past the keep ----
const heldFailed = (): MoveRow => ({ id: `mv-${JOB}`, kind: "add", usd: 5, status: "failed", where: "main", at: T0, note: ONWAY_WORDS, priv: { parts: [{ wallet: "w-sol", chain: "sol", usd: 5, ids: ["m1"], ends: { m1: "problem" }, money: { m1: "on-the-way" } }] } } as unknown as MoveRow);
const sheetOf = (r: MoveRow) => moveTrack({ id: r.id, kind: "top-up", usd: "5.00", status: "failed", shown: true, atIso: new Date(T0).toISOString(), words: "Didn't move $5.00 to your SOL wallet", goesTo: ["sol"], via: "private", note: r.note, missed: ["sol"], missedUsd: privMissedUsd(r as never), ...(privOnWay(r as never) ? { onWay: true as const } : {}), ...(privUnsure(r as never) ? { unsure: true as const } : {}) } as SpendingActivity)!;
const tryAgain = (r: MoveRow) => (sheetOf(r).next ?? []).find((n) => n.label === "Try again");

test("(2) the engine (checkOpen): no record past the keep says unsure for Private, offers no Try again, and is read no more (control: inside the keep it holds and is read)", async () => {
  const run = async (ageMs: number, ans: unknown) => {
    const r = heldFailed();
    let calls = 0;
    const h = { d: { now: () => T0 + ageMs, call: async () => { calls++; return ans; } }, adds: [r], asking: new Set<string>(), changed: () => undefined } as unknown as PrivateHost;
    await checkOpen(h);
    delete r.priv!.checkedAt;
    await checkOpen(h);
    return { r, calls };
  };
  const young = await run(DAY, null);
  assert.deepEqual([young.r.note, heldRow(young.r), young.calls], [ONWAY_WORDS, true, 2], "control: held, read each round");
  const old = await run(PRIVATE_KEEP_MS + 1, null);
  assert.deepEqual([old.r.status, old.r.note, heldRow(old.r), old.calls], ["failed", PRIVATE_UNSURE, false, 1], "unsure, then never read again");
  assert.equal(tryAgain(old.r), undefined, "no Try again while the money is unsure");
  assert.equal(tryAgain(young.r), undefined, "control: no Try again while it's on its way either");
  // the ledger's FAILED read the same way (its money 'unsure'): unsure words, reads stop
  const failed = await run(DAY, { parts: [{ wallet: "w-sol", moves: [{ id: "m1", status: "problem", money: "unsure" }] }] });
  assert.deepEqual([failed.r.note, heldRow(failed.r), failed.calls], [PRIVATE_UNSURE, false, 1]);
});

// ---- (3) a plain Send's own row, through the ledger's Activity read ----
const ME = "kid.near";
function ledgerOf(status: () => string, now: () => number) {
  const core = fakeCore({ accountId: ME });
  const base = createApis(replayFetch({}));
  const apis: Apis = { ...base, status: async (a: string, _v?: string, tag?: string) => (a === "in-dep" && tag === "in-tag" ? { status: status() } : { status: "PENDING_DEPOSIT" }) as never };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, {}, {}), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: "https://quotes.example", now });
  return { ledger, core };
}
test("(3) a plain Send's row: the ledger's Activity read asks its slow leg 1 again: REFUNDED says back in Private, FAILED unsure for Private (control: PENDING holds, and a second read inside 15 s doesn't ask)", async () => {
  for (const [end, state] of [["REFUNDED", "safe"], ["FAILED", "unsure"]] as const) {
    let s = "PENDING", clock = T0 + LEG1_WAIT_MS + 60_000, asks = 0;
    const { ledger, core } = ledgerOf(() => { asks++; return s; }, () => clock);
    const send = { ...moving(), to: "a friend", status: "problem", problem: sendWords.slow("USDC") } as Movement;
    core.store.set("movements", JSON.stringify([send]));
    core.store.set(SEND_LATE, JSON.stringify({ [send.id]: { inDeposit: "in-dep", inTag: "in-tag", coin: "USDC", at: T0 + LEG1_WAIT_MS } }));
    const row = async () => { const r = await ledger.call<Movement[]>("ledger.activity", {}); assert.ok("ok" in r, JSON.stringify(r)); return JSON.parse(core.store.get("movements")!).find((m: Movement) => m.id === send.id) as Movement; };
    assert.equal((await row()).problem?.money.state, "on-the-way", `${end}: control, PENDING holds`);
    assert.equal(asks, 1);
    s = end;
    await row();
    assert.equal(asks, 1, `${end}: a second read inside 15 s asks nothing`);
    clock += 15_000;
    const done = await row();
    assert.deepEqual([asks, done.problem?.money.state], [2, state], end);
    assert.equal(done.problem?.whatHappened, end === "REFUNDED" ? BACK_LINE : "NEAR Intents didn't finish this payment.");
  }
});
