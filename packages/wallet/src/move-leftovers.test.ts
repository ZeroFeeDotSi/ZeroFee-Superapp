// A Move's leftovers (the audit's three, 6 Nov, and the UI reviewer's T-E, A-6/A-28):
// 1. a part whose payment ended with its money still on its way to Private (send-job's slow end) says so, never "back in
//    Private"; the Problem's money state rides the part, by event and by a closed page's status read;
// 2. Try again on one wallet prefills the missed part's own dollars, or none for a split;
// 3. Hot never counts a missed part's dollars on their way;
// 4. "Move stopped": one title, "Nothing moved" and Try again only when every part's record proves nothing moved.
// No wall clock: every time is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privMissedUsd, privOnWay, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { checkOpen, moneyOf, moved, partEnd, type PrivateHost } from "@zerofee/trade/float-private.ts";
import type { MoveRow } from "@zerofee/trade/float-view.ts";
import { againUsd, moveStopFace, moveTrack, STOP_FACE, stopPartsOf, type StopPart } from "./app/money/live-steps.ts";
import { movingMoves, straightUsd } from "./app/trading.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const ON_WAY = { money: { state: "on-the-way" } };
const SAFE = { money: { state: "safe" } };
/** Machine text the face never says: "Not signed", chain names, ";" or a bracket (the app's own "ETH (RH)" aside). */
const MACHINE = /Not signed|Solana|Robinhood|;|\((?!RH\))|(?<!\(RH)\)/;

// ---- 1. on its way to Private ----
test("1: a part's end words follow its Problem's money state: on its way, back, or why it stopped (table)", () => {
  const rows: [Parameters<typeof partEnd>[0], string][] = [
    [{ usd: 5, ids: ["a"], money: { a: "on-the-way" } }, "The $5.00 is on its way to Private. Try again once it's there."],
    [{ usd: 0, ids: ["a"], money: { a: "on-the-way" } }, "It's on its way to Private. Try again once it's there."],
    [{ usd: 5, ids: ["a"], money: { a: "safe" } }, "The $5.00 is back in Private."],
    [{ usd: 5, ids: ["a"] }, "The $5.00 is back in Private."],
    [{ usd: 5, ids: ["a"], money: { b: "on-the-way" } }, "The $5.00 is back in Private."],
    [{ usd: 5, ids: ["a"], stopped: "Didn't start. It's still in Private.", money: { a: "on-the-way" } }, "Didn't start. It's still in Private."],
  ];
  for (const [p, want] of rows) assert.equal(partEnd(p), want, JSON.stringify(p));
  assert.equal(moneyOf({ status: "problem", problem: ON_WAY }), "on-the-way");
  assert.equal(moneyOf({ status: "done", problem: ON_WAY }), undefined, "a paid end keeps no money state");
});

const privRow = (parts: { chain: "sol" | "near"; usd: number; ids: string[] }[]): MoveRow => ({ id: "mv-job1234567890abcd", kind: "add", usd: parts.reduce((n, p) => n + p.usd, 0), status: "moving", where: "in-flight", at: T0, priv: { parts: parts.map((p) => ({ wallet: p.chain === "near" ? "near" : "w-sol", ...p })) } } as unknown as MoveRow);

test("1: the event path: a slow end (money on the way) says on its way to Private; a refund (money safe) says back (control)", () => {
  const slow = privRow([{ chain: "sol", usd: 5, ids: ["m1"] }]);
  assert.equal(moved(slow, { id: "m1", status: "problem", problem: ON_WAY }, T0), true);
  assert.deepEqual([slow.status, slow.note], ["failed", "The $5.00 is on its way to Private. Try again once it's there."]);
  assert.doesNotMatch(slow.note!, /back in Private/);
  const back = privRow([{ chain: "sol", usd: 5, ids: ["m1"] }]);
  moved(back, { id: "m1", status: "problem", problem: SAFE }, T0);
  assert.equal(back.note, "The $5.00 is back in Private.", "control: money in Private");
  // two parts, one slow: each says its own
  const two = privRow([{ chain: "sol", usd: 5, ids: ["m1"] }, { chain: "near", usd: 3, ids: ["m2"] }]);
  moved(two, { id: "m1", status: "problem", problem: ON_WAY }, T0);
  moved(two, { id: "m2", status: "refunded" }, T0);
  assert.equal(two.note, "Solana: The $5.00 is on its way to Private. Try again once it's there. · NEAR wallet: The $3.00 is back in Private.");
});

test("1: a closed page's path: the ledger's status read carries the money state onto the part (checkOpen)", async () => {
  const run = async (money: string | undefined) => {
    const r = privRow([{ chain: "sol", usd: 5, ids: ["m1"] }]);
    const h = {
      d: { now: () => T0 + 60_000, call: async () => ({ parts: [{ wallet: "w-sol", moves: [{ id: "m1", status: "problem", ...(money ? { money } : {}) }] }] }) },
      adds: [r], asking: new Set<string>(), changed: () => undefined,
    } as unknown as PrivateHost;
    await checkOpen(h);
    return r;
  };
  const slow = await run("on-the-way");
  assert.deepEqual([slow.priv!.parts[0]!.money, slow.note], [{ m1: "on-the-way" }, "The $5.00 is on its way to Private. Try again once it's there."]);
  assert.equal((await run(undefined)).note, "The $5.00 is back in Private.", "control: no money state read, the old words");
});

// ---- 2. Try again's figure ----
test("2: a missed part's own dollars (privMissedUsd) and Try again's figure (againUsd) (tables)", () => {
  const m = (parts: { chain: "sol" | "near"; usd?: number; stopped?: string; ends?: Record<string, string>; ids?: string[] }[]) => ({ priv: { parts: parts.map((p) => ({ ids: [], ...p })) } });
  assert.equal(privMissedUsd(m([{ chain: "sol", usd: 5, ids: ["a"], ends: { a: "refunded" } }, { chain: "near", usd: 9, ids: ["b"], ends: { b: "done" } }])), "5.00", "only the part that came back");
  assert.equal(privMissedUsd(m([{ chain: "sol", usd: 5, stopped: "x" }, { chain: "near", usd: 9, stopped: "y" }])), "14.00");
  assert.equal(privMissedUsd(m([{ chain: "sol", usd: 5, ids: ["a"], ends: { a: "done" } }])), undefined, "control: none missed");
  const rows: [Pick<SpendingActivity, "missed" | "missedUsd">, string, { usd?: string }][] = [
    [{ missed: ["sol"], missedUsd: "5.00" }, "sol", { usd: "5.00" }],
    [{ missed: ["sol", "near"], missedUsd: "14.00" }, "sol", {}],
    [{ missed: ["near"], missedUsd: "9.00" }, "sol", {}],
    [{ missed: ["sol"] }, "sol", {}],
    [{}, "sol", {}],
  ];
  for (const [r, to, want] of rows) assert.deepEqual(againUsd(r, to), want, JSON.stringify(r));
});

const privAct = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-1", kind: "top-up", usd: "14.00", status: "failed", shown: true, atIso: iso(0), words: "Didn't move $14.00 to your SOL wallet", goesTo: ["sol"], via: "private", note: "NEAR Confidential sent it back. Your money is in Private.", ...o } as SpendingActivity);

test("2: a SOL + NEAR wallet Move that came back offers Try again to SOL with no figure; SOL's own part alone, its own dollars (control: the row's sum before)", () => {
  const split = moveTrack(privAct({ missed: ["sol", "near"], missedUsd: "14.00" }))!;
  assert.deepEqual(split.next?.[0], { label: "Try again", go: { kind: "move", to: "sol" } });
  const one = moveTrack(privAct({ missed: ["sol"], missedUsd: "5.00" }))!;
  assert.deepEqual(one.next?.[0], { label: "Try again", go: { kind: "move", to: "sol", usd: "5.00" } }, "the missed part's own $5.00, never the row's $14.00");
});

test("the audit (6 Nov): no Try again while a part's money is on its way to Private (privOnWay table; control: the same row without it offers Try again)", () => {
  const rows: [Parameters<typeof privOnWay>[0], boolean][] = [
    [{ priv: { parts: [{ chain: "sol", ids: ["a"], money: { a: "on-the-way" } }] } }, true],
    [{ priv: { parts: [{ chain: "sol", ids: ["a"], money: { a: "safe" } }, { chain: "near", ids: ["b"], money: { b: "on-the-way" } }] } }, true],
    [{ priv: { parts: [{ chain: "sol", ids: ["a"], money: { a: "safe" } }] } }, false],
    [{ priv: { parts: [{ chain: "sol", ids: ["a"] }] } }, false],
    [{}, false],
  ];
  for (const [m, want] of rows) assert.equal(privOnWay(m), want, JSON.stringify(m));
  const held = moveTrack(privAct({ missed: ["sol"], missedUsd: "5.00", onWay: true }))!;
  assert.ok(!(held.next ?? []).some((n) => n.label === "Try again"), JSON.stringify(held.next));
  const free = moveTrack(privAct({ missed: ["sol"], missedUsd: "5.00" }))!;
  assert.equal(free.next?.[0]?.label, "Try again", "control");
});

// ---- 3. Hot's figure ----
test("3: Hot counts a Move paid straight from Private less its missed parts' dollars; every wallet missed or landed, none (table + movingMoves)", () => {
  const rows: [Pick<SpendingActivity, "goesTo" | "landed" | "missed" | "missedUsd">, number][] = [
    [{ goesTo: ["sol", "hood"] }, 20],
    [{ goesTo: ["sol", "hood"], missed: ["sol"], missedUsd: "8.00" }, 12],
    [{ goesTo: ["sol"], missed: ["sol"], missedUsd: "20.00" }, 0],
    [{ goesTo: ["sol", "hood"], missed: ["sol"], missedUsd: "8.00", landed: ["hood"] }, 0],
    [{ goesTo: ["sol", "hood"], missed: ["near"], missedUsd: "3.00" }, 17],
  ];
  for (const [a, want] of rows) assert.equal(straightUsd(a, 20), want, JSON.stringify(a));
  const S = (onItsWay: unknown[]) => ({ loaded: true, totalUsd: "0.00", reserveUsd: "0.00", networks: [], onItsWay }) as unknown as SpendingStatus;
  const going = { id: "mv-2", kind: "top-up", usd: "20.00", status: "on-its-way", shown: true, atIso: iso(0), goesTo: ["sol", "hood"], via: "private" };
  assert.deepEqual(movingMoves(S([{ ...going, missed: ["sol"], missedUsd: "8.00" }])).map((x) => x.usd), [12], "the stopped SOL part's $8.00 is never on its way");
  assert.deepEqual(movingMoves(S([{ ...going, goesTo: ["sol"], missed: ["sol"], missedUsd: "20.00" }])), [], "its only wallet missed: no row");
  assert.deepEqual(movingMoves(S([going])).map((x) => x.usd), [20], "control: nothing missed, the whole figure");
});

// ---- 4. "Move stopped" ----
test("4: moveStopFace: nothing moved only when every part never started or was refused; a part that went or is unsure keeps the job's words, no Try again (table)", () => {
  const again = { kind: "move" as const, to: "safe" };
  const line = "Check Activity before you try again.";
  const next = [{ label: "Try again", go: { kind: "move" as const, to: "sol" } }, { label: "Open Private", go: { kind: "private" as const } }];
  const funds = "That wallet doesn't have that much.";
  const cases: [string, StopPart[], { body: string; cause?: string; buttons: string[]; nothing: boolean }][] = [
    ["all not started", [{ at: "sol", state: "not-started" }, { at: "hood", state: "not-started" }], { body: "Nothing moved. Your money is still in your SOL wallet and your ETH (RH) wallet.", buttons: ["Try again", "Close"], nothing: true }],
    ["refused for funds, two wallets", [{ at: "sol", state: "refused", why: `${funds} · it's on the chain` }, { at: "hood", state: "refused", why: funds }], { body: "Nothing moved. Your money is still in your SOL wallet and your ETH (RH) wallet.", cause: "Those wallets don't hold that much.", buttons: ["Try again", "Close"], nothing: true }],
    ["refused for funds, one wallet", [{ at: "sol", state: "refused", why: funds }], { body: "Nothing moved. Your money is still in your SOL wallet.", cause: "Your SOL wallet doesn't hold that much.", buttons: ["Try again", "Close"], nothing: true }],
    ["refused, a machine reason", [{ at: "near", state: "refused", why: "Not signed: x (y); z" }], { body: "Nothing moved. Your money is still in your NEAR wallet.", buttons: ["Try again", "Close"], nothing: true }],
    ["one part went", [{ at: "sol", state: "went" }], { body: line, buttons: ["Open Private"], nothing: false }],
    ["one unsure", [{ at: "sol", state: "unsure" }], { body: line, buttons: ["Open Private"], nothing: false }],
    ["mixed: one refused, one went", [{ at: "sol", state: "refused", why: funds }, { at: "hood", state: "went" }], { body: line, buttons: ["Open Private"], nothing: false }],
    ["mixed: one not started, one unsure", [{ at: "safe", state: "not-started" }, { at: "private", state: "unsure" }], { body: line, buttons: ["Open Private"], nothing: false }],
    ["no parts", [], { body: line, buttons: ["Open Private"], nothing: false }],
  ];
  for (const [name, parts, want] of cases) {
    const f = moveStopFace(parts, { line, next, again });
    assert.equal(f.title, "Move stopped", name);
    assert.deepEqual([f.body, f.cause, f.buttons.map((b) => b.label), f.nothingMoved], [want.body, want.cause, want.buttons, want.nothing], name);
    assert.equal(f.row, want.nothing ? "Nothing moved. Your money is safe." : undefined, name);
    for (const w of [f.body, f.cause ?? "", f.row ?? ""]) assert.doesNotMatch(w, MACHINE, `${name}: never machine text`);
  }
  // the places by the app's names, from the record
  assert.equal(moveStopFace([{ at: "safe", state: "refused" }, { at: "private", state: "not-started" }, { at: "near", state: "refused" }], { line }).body, "Nothing moved. Your money is still in your Safe, Private and your NEAR wallet.");
  assert.equal(STOP_FACE.row, "Nothing moved. Your money is safe.");
});

const leg = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "l1", kind: "move", usd: "149.78", status: "refused", shown: false, atIso: iso(0), words: "From your SOL wallet", network: "sol", note: "That wallet doesn't have that much. · it's on the chain", ...o } as SpendingActivity);
const takeOut = (legs: SpendingActivity[]) => ({ id: "h1", kind: "put-away", usd: "179.00", status: "refused", shown: true, atIso: iso(0), words: "Didn't move $179.00 to your Safe", note: "$149.78 from Solana didn't come back (That wallet doesn't have that much.); $29.22 from Robinhood Chain didn't come back (That wallet doesn't have that much.) · it's still in your SOL wallet and still in your ETH (RH) wallet", legs } as unknown as SpendingActivity);

test("4: the reviewer's on the real row: one title, the body, the cause, Try again then Close, no steps; a leg that went keeps the job's words (control)", () => {
  const legs = [leg({}), leg({ id: "l2", usd: "29.22", network: "hood", words: "From your ETH (RH) wallet" })];
  assert.deepEqual(stopPartsOf(takeOut(legs) as never, legs).map((p) => [p.at, p.state]), [["sol", "refused"], ["hood", "refused"]]);
  const t = moveTrack(takeOut(legs) as never)!;
  assert.equal(t.bar, "Move", "the sheet's head says Move; the title once, under it");
  assert.equal(t.end!.head, "Move stopped");
  assert.equal(t.end!.line, "Nothing moved. Your money is still in your SOL wallet and your ETH (RH) wallet.");
  assert.equal(t.end!.cause, "Those wallets don't hold that much.");
  assert.equal(t.end!.row, "Nothing moved. Your money is safe.");
  assert.deepEqual(t.next, [{ label: "Try again", go: { kind: "move", to: "safe" } }, { label: "Close", go: { kind: "close" } }], "two wallets: no from, no figure");
  assert.deepEqual(t.steps, []);
  assert.doesNotMatch(JSON.stringify(t.end), MACHINE);
  // one wallet refused for another reason: from that wallet, its figure
  const one = moveTrack(takeOut([leg({ note: "You said no on the Approve sheet." })]) as never)!;
  assert.deepEqual(one.next?.[0], { label: "Try again", go: { kind: "move", to: "safe", from: "sol", usd: "179.00" } });
  assert.equal(one.end!.cause, "You said no on the Approve sheet.");
  // control: a leg that left its wallet (it landed): the job's own words, no Try again, no Nothing moved
  const went = [leg({}), leg({ id: "l2", usd: "29.22", network: "hood", status: "done", note: undefined })];
  const w = moveTrack(takeOut(went) as never)!;
  assert.equal(w.next, undefined, "no Try again");
  assert.doesNotMatch(w.end!.line, /^Nothing moved/);
  assert.equal(w.end!.head, "Move stopped");
  assert.ok(w.steps.length > 0, "its steps stay");
  // control: a leg still on its way (money unknown): no Try again
  const unsure = moveTrack(takeOut([leg({}), leg({ id: "l2", network: "hood", status: "on-its-way", note: undefined })]) as never)!;
  assert.equal(unsure.next, undefined);
});
