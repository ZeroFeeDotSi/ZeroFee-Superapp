// Activity's job cards: a trade's three steps and a move's three, each done / now / next / stopped, the badge, and the
// words Activity already used (nothing moved, or only the network fee).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TradeRecord } from "../service.ts";
import type { MoveRow } from "../float-view.ts";
import { moveCard, openByDefault, tradeCard } from "./job-cards.ts";

const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 1, hashes: ["h"], startedAt: 1_000, sentAt: 1_300, endedAt: 1_700, filledInMs: 655, route: "PumpSwap", ...o });
const states = (c: { steps: { state: string }[] }) => c.steps.map((s) => s.state);

test("a filled buy: sent, bought, each with its time, the fill time on the last; no 'Approved' step (D143: nothing asked); Done, closed", () => {
  const c = tradeCard(rec({}));
  assert.equal(c.title, "Bought DOPE");
  assert.equal(c.result, "$1.00 · done in under a second · PumpSwap");
  assert.deepEqual(states(c), ["done", "done"]);
  assert.deepEqual(c.steps.map((s) => s.label), ["Sent to Solana", "Bought"], "UX audit 4 Nov: no step for a sheet nobody saw");
  assert.deepEqual(c.steps.map((s) => s.at), [1_300, 1_700]);
  assert.equal(c.steps[1]!.note, "done in under a second");
  assert.equal(c.badge, "Done");
  assert.equal(openByDefault(c), false);
});

test("a sale on its way: signed and sent, landing now; Running, open", () => {
  const c = tradeCard(rec({ kind: "sell", status: "confirming", endedAt: undefined, filledInMs: undefined }));
  assert.equal(c.title, "Selling DOPE");
  assert.deepEqual(states(c), ["done", "now"]);
  assert.equal(c.steps[1]!.label, "Sold");
  assert.equal(c.badge, "Running");
  assert.equal(openByDefault(c), true);
});

test("a trade that didn't go stops where it stopped, and says what moved", () => {
  const no = tradeCard(rec({ status: "declined", hashes: [], sentAt: undefined, endedAt: 1_200 }));
  assert.deepEqual(states(no), ["stopped", "next", "next"], "control: a trade turned down at its sheet (over a cap) keeps its Approved step, stopped");
  assert.equal(no.steps[0]!.label, "Approved");
  assert.equal(no.steps[0]!.note, "You said no · nothing moved");
  assert.equal(no.badge, "Didn't go");
  const reverted = tradeCard(rec({ status: "failed", problem: { code: "x", whatHappened: "The price moved too far.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } as never }));
  assert.deepEqual(states(reverted), ["done", "stopped"]);
  assert.equal(reverted.steps[1]!.note, "The price moved too far · only the network fee was spent");
  const expired = tradeCard(rec({ status: "expired", hashes: [], sentAt: undefined }));
  assert.match(expired.result, /nothing moved$/);
});

const mv = (o: Partial<MoveRow>): MoveRow => ({ id: "m1", kind: "out", chain: "sol", usd: 9.55, status: "moving", where: "in-flight", at: 5_000, etaSec: 40, ...o });

test("a move out: its short wait, on its way (with how long), on the chain", () => {
  const waiting = moveCard(mv({ status: "waiting", where: "reserve", etaSec: undefined }), "Solana");
  assert.deepEqual(states(waiting), ["now", "next", "next"]);
  assert.equal(waiting.badge, "Waiting");
  assert.equal(waiting.steps[0]!.label, "Waiting");
  const moving = moveCard(mv({}), "Solana");
  assert.deepEqual(states(moving), ["done", "now", "next"]);
  assert.equal(moving.steps[1]!.etaSec, 40);
  assert.equal(moving.title, "Moving $9.55 to your SOL wallet");
  const done = moveCard(mv({ status: "done", where: "chain" }), "Solana");
  assert.deepEqual(states(done), ["done", "done", "done"]);
  assert.equal(done.result, "Now in your SOL wallet");
  const back = moveCard(mv({ status: "refunded", where: "reserve" }), "Solana");
  assert.deepEqual(states(back), ["done", "stopped", "next"]);
  assert.equal(back.steps[1]!.note, "Back in your NEAR wallet");
});

test("an Add the protection holds waits on its first step and carries its hold (the Waiting screen); Take out's three steps", () => {
  const held = moveCard(mv({ kind: "add", chain: undefined, status: "waiting", where: "main", held: { id: "h1", readyAtIso: "", needsSecondDevice: false } }));
  assert.equal(held.steps[0]!.label, "Waiting for your Safe's protection");
  assert.deepEqual(states(held), ["now", "next", "next"]);
  assert.equal(held.held?.id, "h1");
  const home = moveCard(mv({ kind: "home", chain: undefined, status: "done", where: "main", usd: 5.88 }));
  assert.equal(home.title, "Moved $5.88 to your Safe");
  assert.deepEqual(home.steps.map((s) => s.label), ["Collecting your money from each wallet", "On its way to your Safe", "In your Safe"]);
  assert.equal(moveCard(mv({ kind: "add", chain: undefined, status: "failed", where: "main" })).steps[0]!.note, "Didn't go · still in your Safe");
});

test("webd-money2 crawl (4 Nov): a trade's row says its own dollars (the coin's part), never the fee and deposit on top; control: before the chain's figure, the ask", () => {
  const buy = tradeCard(rec({ kind: "buy", amountUsd: 0.78, costs: { coinUsd: 0.5, feeUsd: 0.15, depositUsd: 0.13 } }));
  assert.equal(buy.usd, 0.5, "Bought $0.50, as its receipt, never $0.78");
  const sell = tradeCard(rec({ kind: "sell", amountUsd: 0.64, costs: { coinUsd: 0.5, feeUsd: 0.001, depositUsd: 0.14 } }));
  assert.equal(sell.usd, 0.5, "Sold $0.50, never $0.64");
  assert.equal(tradeCard(rec({ kind: "buy", amountUsd: 0.5 })).usd, 0.5, "control: no chain figure yet, the ask's own");
  assert.equal(tradeCard(rec({ kind: "fund", amountUsd: 3 })).usd, 3, "control: not a trade, its own figure");
});
