// The hold's end (audit, 6 Nov): a Move's part whose payment ended slow (send-job's slow end: its money on its way to
// Private) said "The $X is on its way to Private. Try again once it's there." with no button, and nothing ever changed
// it. Now leg 1 is kept after the slow end, and a status read (ledger.privateMoveStatus) asks 1Click about leg 1 again,
// on the word the follower trusts to pay (leg 1's SUCCESS, read with its tag). Once it says the money arrived, the
// payment's Problem says it is in Private, the part's money is "safe", its words say back in Private, and Try again
// returns with the part's own dollars. A failed read, or one still on its way, keeps the hold. No timer ends it.
// No wall clock: every time is injected (mocked timers for the follower).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { privMissedUsd, privOnWay, type SpendingActivity } from "@zerofee/core/spending";
import { checkOpen, moved, type PrivateHost } from "@zerofee/trade/float-private.ts";
import { heldRow, type MoveRow } from "@zerofee/trade/float-view.ts";
import { moveTrack } from "./app/money/live-steps.ts";
import { createPrivateMove, lateIds } from "./private-move.ts";
import { createSendJobs, LEG1_WAIT_MS, SEND_LATE, type SendJob } from "./send-job.ts";
import type { Movement } from "./types.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const ONWAY_WORDS = "The $5.00 is on its way to Private. Try again once it's there.";
const BACK_WORDS = "The $5.00 is back in Private.";

// ---- the clearing rule: lateEnd, its table in late-leg-ends.test.ts (REFUNDED and FAILED end the hold since) ----
test("lateIds: a status read asks again only about a payment that ended slow with its money on its way (table)", () => {
  const slow = { code: "ledger.send.slow", money: { state: "on-the-way" } };
  const mv = (id: string, status: string, problem?: unknown) => ({ id, status, ...(problem ? { problem } : {}) }) as Pick<Movement, "id" | "status" | "problem">;
  const parts = [{ ids: ["a", "b"] }, { ids: ["c", "d", "e", "f"] }];
  const ms = [
    mv("a", "problem", slow),
    mv("b", "done"),
    mv("c", "problem", { code: "ledger.send.slow", money: { state: "safe", where: "in Private" } }),
    mv("d", "problem", { code: "ledger.send.unknown", money: { state: "on-the-way" } }),
    mv("e", "moving", slow),
  ];
  assert.deepEqual(lateIds(parts, ms), ["a"], "only the slow end still on its way; never one cleared, an unknown one, a moving one or one not listed (f)");
  assert.deepEqual(lateIds([], ms), []);
});

test("heldRow: a row is read again while a part's money is on its way to Private (table)", () => {
  const row = (money?: Record<string, string>, ids = ["m1"]) => ({ priv: { parts: [{ ids, ...(money ? { money } : {}) }] } }) as unknown as MoveRow;
  assert.equal(heldRow(row({ m1: "on-the-way" })), true);
  assert.equal(heldRow(row({ m1: "safe" })), false, "back in Private: no hold");
  assert.equal(heldRow(row({ other: "on-the-way" })), false, "a payment not this part's");
  assert.equal(heldRow(row()), false);
  assert.equal(heldRow({} as MoveRow), false);
});

// ---- the ledger: slow end keeps leg 1, the status read clears the hold on 1Click's word ----
const JOB = "job0123456789abcdef";
const sendJob: SendJob = { id: "safe-send:out-dep-0000000000000000", inDeposit: "in-dep", inTag: "in-tag", outDeposit: "out-dep", signedData: { signed: true }, coinId: "nep141:usdc", leg2In: "5000000", coin: "USDC", startedAtIso: "2026-11-06T12:00:00.000Z" };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function ledgerRig() {
  const kv = new Map<string, string>();
  let clock = T0;
  let leg1: "PENDING" | "SUCCESS" | "throw" = "PENDING";
  const told: Movement[] = [];
  let list: Movement[] = [{ id: sendJob.id, kind: "pay", status: "moving", from: "usdc", to: "Your SOL wallet", amount: "5.00", startedAtIso: sendJob.startedAtIso, updatedAtIso: sendJob.startedAtIso, explorerUrls: [], private: true } as unknown as Movement];
  const remember = async (m: Movement) => { list = [m, ...list.filter((x) => x.id !== m.id)]; told.push(m); };
  const sj = createSendJobs({
    apis: {
      status: (async (dep: string, _relay: unknown, tag: unknown) => {
        if (dep !== "in-dep" || tag !== "in-tag") return { status: "PENDING_DEPOSIT" };
        if (leg1 === "throw") throw new Error("relay down");
        return { status: leg1 };
      }) as never,
      submitIntent: (async () => { throw new Error("never paid late"); }) as never,
    },
    relayed: "relay", remember, note: async () => {}, forget: async () => {},
    loadMovements: async () => list, emit: () => {}, stored: async (k) => kv.get(k), store: async (k, v) => void kv.set(k, v),
    serially: (f) => f(), iso: () => new Date(clock).toISOString(), now: () => clock, trackMs: 1_000,
  });
  // the Move's own record of its part, as moveFromPrivate keeps it
  kv.set("private-moves", JSON.stringify({ [JOB]: { at: T0, parts: [{ wallet: "w-sol", usd: 5, ids: [sendJob.id] }], fillAt: T0 } }));
  const pm = createPrivateMove({ stored: async (k: string) => kv.get(k), store: async (k: string, v: string) => void kv.set(k, v), serially: (f: () => Promise<unknown>) => f(), loadMovements: async () => list, resume: async () => {}, now: () => clock, settleLate: (id: string) => sj.settleLate(id) } as never);
  return { kv, sj, pm, told, list: () => list, set: (s: typeof leg1) => { leg1 = s; }, at: (ms: number) => { clock = T0 + ms; } };
}
const statusMoney = async (r: Awaited<ReturnType<typeof ledgerRig>>) => ((await r.pm.privateMoveStatus({ job: JOB }))!.parts[0]!.moves[0]!).money;

test("the ledger: a slow leg 1 keeps leg 1 (never the signed payment); the status read keeps the hold while 1Click says on its way or the read fails, and clears it once 1Click says it arrived (control: without the re-read it stays on its way)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await ledgerRig();
    await r.sj.start(sendJob);
    mock.timers.tick(1_000); await flush();
    r.at(LEG1_WAIT_MS + 1);
    mock.timers.tick(1_000); await flush();
    const ended = r.list().find((m) => m.id === sendJob.id)!;
    assert.deepEqual([ended.status, ended.problem?.code, ended.problem?.money.state], ["problem", "ledger.send.slow", "on-the-way"], "the slow end, as before");
    const late = JSON.parse(r.kv.get(SEND_LATE) ?? "{}");
    assert.deepEqual(Object.keys(late), [sendJob.id], "leg 1 kept for a later read");
    assert.deepEqual([late[sendJob.id].inDeposit, late[sendJob.id].inTag, "signedData" in late[sendJob.id]], ["in-dep", "in-tag", false], "its address and tag, never the signed payment");

    // control: 1Click still says on its way: the hold stays, nothing told
    const told = r.told.length;
    assert.equal(await statusMoney(r), "on-the-way");
    // control: the read fails: the hold stays
    r.set("throw");
    assert.equal(await statusMoney(r), "on-the-way");
    assert.equal(r.told.length, told, "no change told while it holds");

    // 1Click says leg 1 arrived: the payment's Problem says the money is in Private, told to its app
    r.set("SUCCESS");
    assert.equal(await statusMoney(r), "safe");
    const now = r.list().find((m) => m.id === sendJob.id)!;
    assert.deepEqual([now.status, now.problem?.code, now.problem?.money.state, now.problem?.money.where, now.problem?.whatHappened], ["problem", "ledger.send.slow", "safe", "in Private", `It wasn't paid. ${BACK_WORDS}`], "nothing was paid; the money is in Private");
    assert.equal(r.told.at(-1)?.id, sendJob.id, "told once it changed (ledger.movementUpdated: the live path)");
    assert.deepEqual(JSON.parse(r.kv.get(SEND_LATE) ?? "{}"), {}, "leg 1 forgotten");
    // read again: no second change, no second read of leg 1
    const after = r.told.length;
    assert.equal(await statusMoney(r), "safe");
    assert.equal(r.told.length, after);
  } finally {
    mock.timers.reset();
  }
});

// ---- the engine: the row re-settles, by a closed page's read and by the live event ----
const failedRow = (): MoveRow => ({ id: `mv-${JOB}`, kind: "add", usd: 5, status: "failed", where: "main", at: T0, note: ONWAY_WORDS, priv: { parts: [{ wallet: "w-sol", chain: "sol", usd: 5, ids: ["m1"], ends: { m1: "problem" }, money: { m1: "on-the-way" } }] } } as unknown as MoveRow);
/** Two parts: the NEAR wallet's landed (the row is Done), Solana's ended slow. */
const doneRow = (): MoveRow => {
  const note = `Solana: ${ONWAY_WORDS}`;
  return { id: `mv-${JOB}`, kind: "add", usd: 8, status: "done", where: "chain", at: T0, note, priv: { landed: { at: T0, note }, parts: [{ wallet: "w-sol", chain: "sol", usd: 5, ids: ["m1"], ends: { m1: "problem" }, money: { m1: "on-the-way" } }, { wallet: "near", chain: "near", usd: 3, ids: ["m2"], ends: { m2: "done" } }] } } as unknown as MoveRow;
};
const host = (r: MoveRow, money: string, fails = false) => ({
  d: { now: () => T0 + 60_000, call: async () => { if (fails) throw new Error("ledger busy"); return { parts: r.priv!.parts.map((p) => ({ wallet: p.wallet, moves: p.ids.map((id) => ({ id, status: p.ends?.[id] ?? "moving", ...(id === "m1" ? { money } : {}) })) })) }; } },
  adds: [r], asking: new Set<string>(), changed: () => undefined,
}) as unknown as PrivateHost;
/** The row's Spending fields as spending.ts makes them, and its sheet (live-steps). */
const sheetOf = (r: MoveRow) => moveTrack({ id: r.id, kind: "top-up", usd: "5.00", status: "failed", shown: true, atIso: new Date(T0).toISOString(), words: "Didn't move $5.00 to your SOL wallet", goesTo: ["sol"], via: "private", note: r.note, missed: ["sol"], missedUsd: privMissedUsd(r as never), ...(privOnWay(r as never) ? { onWay: true as const } : {}) } as SpendingActivity)!;
const tryAgain = (r: MoveRow) => (sheetOf(r).next ?? []).find((n) => n.label === "Try again");

test("a closed page's path (checkOpen): an ended row on hold is read again; the ledger's 'safe' says back in Private and Try again returns with the part's own $5.00 (controls: still on its way, a failed read)", async () => {
  // control: still on its way
  const held = failedRow();
  await checkOpen(host(held, "on-the-way"));
  assert.deepEqual([held.note, heldRow(held), tryAgain(held)], [ONWAY_WORDS, true, undefined], "the hold stays, no Try again");
  // control: the read fails
  const unread = failedRow();
  await checkOpen(host(unread, "safe", true));
  assert.deepEqual([unread.note, heldRow(unread)], [ONWAY_WORDS, true]);
  // the money arrived in Private
  const back = failedRow();
  await checkOpen(host(back, "safe"));
  assert.deepEqual([back.status, back.note, heldRow(back), privOnWay(back as never)], ["failed", BACK_WORDS, false, false]);
  assert.deepEqual(tryAgain(back), { label: "Try again", go: { kind: "move", to: "sol", usd: "5.00" } }, "Try again, the missed part's own figure");
  // a Done row whose other part landed: its words follow too
  const done = doneRow();
  await checkOpen(host(done, "safe"));
  assert.deepEqual([done.status, done.note, done.priv!.landed!.note], ["done", `Solana: ${BACK_WORDS}`, `Solana: ${BACK_WORDS}`]);
  const doneHeld = doneRow();
  await checkOpen(host(doneHeld, "on-the-way"));
  assert.equal(doneHeld.note, `Solana: ${ONWAY_WORDS}`, "control");
});

test("the live path (ledger.movementUpdated → moved): the cleared payment's Problem re-settles the row, an ended one and a Done one (control: on its way keeps the words)", () => {
  const cleared = { id: "m1", status: "problem", problem: { money: { state: "safe" } } };
  const held = { id: "m1", status: "problem", problem: { money: { state: "on-the-way" } } };
  const one = failedRow();
  moved(one, held, T0 + 60_000);
  assert.equal(one.note, ONWAY_WORDS, "control");
  moved(one, cleared, T0 + 60_000);
  assert.deepEqual([one.note, heldRow(one)], [BACK_WORDS, false]);
  assert.equal(tryAgain(one)?.go.kind, "move");
  const done = doneRow();
  moved(done, held, T0 + 60_000);
  assert.equal(done.note, `Solana: ${ONWAY_WORDS}`, "control");
  moved(done, cleared, T0 + 60_000);
  assert.deepEqual([done.status, done.note, done.priv!.landed!.at], ["done", `Solana: ${BACK_WORDS}`, T0], "its words follow; its landing keeps its time");
  // a Done row that said something else (its own words since) keeps them
  const own = doneRow();
  own.note = "Some other words.";
  moved(own, cleared, T0 + 60_000);
  assert.equal(own.note, "Some other words.");
});
