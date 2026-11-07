// the copy review's words (7 Nov) for a Solana trade no read can place yet, and for one the chain provably never took (the audit's MUST: a
// false "expired" with Try again paid twice). Trade has no job page with checkpoints: the words map onto its problem
// card (the tap's end), its Activity card and its row. Unconfirmed: "Buy not confirmed", the reason naming who checks,
// the unsure money line, the step landing lit (not stopped), no Try again, one way out (Open your SOL wallet).
// Expired: "Buy stopped", the reason with where the money is, one Try again. Controls: a done trade keeps its words.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TradeRecord } from "../service.ts";
import { tradeProblems } from "../trade-problems.ts";
import { tradeCard } from "./job-cards.ts";
import { rowBuyLine } from "./screens/row-buy.ts";

const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "WIF", status: "done", amountUsd: 25, hashes: ["h"], startedAt: 1_000, sentAt: 1_300, endedAt: 1_700, filledInMs: 655, route: "PumpSwap", ...o });
/** ProblemView's money line (shell-api ProblemView.tsx moneyWords), for the unsure and safe shapes used here. */
const moneyLine = (m: { state: string; where?: string; check?: string }) => (m.state === "unsure" ? `Your money is ${m.where}. ${m.check}` : `Your money hasn't moved. It's ${m.where}.`);

test("unconfirmed, the card: 'Buy not confirmed', the copy review's reason, the row says 'Not confirmed yet', landing lit (not stopped), Running", () => {
  for (const [kind, title] of [["buy", "Buy not confirmed"], ["sell", "Sell not confirmed"]] as const) {
    // a sent trade the live re-check can look at (its step's last valid height: live-check.ts)
    const c = tradeCard(rec({ kind, status: "unconfirmed", endedAt: undefined, filledInMs: undefined, steps: [{ id: "swap", tx: "", lastValidBlockHeight: 1 }] }), 2_000);
    assert.equal(c.title, title);
    assert.equal(c.result, "Solana hasn't confirmed this trade yet. ZeroFee keeps checking.");
    assert.equal(c.status, "Not confirmed yet");
    assert.deepEqual(c.steps.map((s) => s.state), ["done", "now"], "waiting, never --bad");
    assert.equal(c.badge, "Running");
  }
  assert.equal(rowBuyLine({ phase: "checking", at: 0 }, "WIF"), "Not confirmed yet");
});

test("unconfirmed, the problem card: no Try again, the unsure money line, one way out to the SOL wallet", () => {
  const p = tradeProblems.unconfirmed("WIF", "Solana");
  assert.equal(p.whatHappened, "Solana hasn't confirmed this trade yet. ZeroFee keeps checking.");
  assert.equal(moneyLine(p.money as never), "Your money is either in your SOL wallet or already traded. Check your SOL wallet first.");
  assert.deepEqual(p.next, { kind: "open", label: "Open your SOL wallet", screen: "wallets" });
  assert.notEqual(p.next.kind, "retry");
});

test("expired (proven): 'Buy stopped', the copy review's reason with where the money is, the row says 'Buy stopped', one Try again", () => {
  const c = tradeCard(rec({ status: "expired", hashes: ["h"], endedAt: 2_000, filledInMs: undefined, problem: tradeProblems.expired("WIF", "Solana") }));
  assert.equal(c.title, "Buy stopped");
  assert.equal(c.result, "Solana didn't confirm it in time, so nothing was traded. Your money is in your SOL wallet.");
  assert.equal(c.status, "Buy stopped");
  assert.equal(c.badge, "Didn't go");
  const p = tradeProblems.expired("WIF", "Solana");
  assert.equal(p.whatHappened, "Solana didn't confirm it in time, so nothing was traded.");
  assert.equal(moneyLine(p.money as never), "Your money hasn't moved. It's in your SOL wallet.");
  assert.deepEqual(p.next, { kind: "retry", label: "Try again" });
});

test("control: a done trade keeps its words (title, no row word)", () => {
  const c = tradeCard(rec({}));
  assert.equal(c.title, "Bought WIF");
  assert.equal(c.status, undefined);
});

test("unconfirmed where no live look is possible (no step to prove it by): 'Open this again to check.', never 'keeps checking'", () => {
  const c = tradeCard(rec({ status: "unconfirmed", endedAt: undefined, filledInMs: undefined }), 2_000);
  assert.equal(c.result, "Solana hasn't confirmed this trade yet. Open this again to check.");
  const live = tradeCard(rec({ status: "unconfirmed", endedAt: undefined, filledInMs: undefined, steps: [{ id: "swap", tx: "", lastValidBlockHeight: 1 }] }), 2_000);
  assert.equal(live.result, "Solana hasn't confirmed this trade yet. ZeroFee keeps checking.", "control: a live-checkable one");
  // the audit's SHOULD: over an hour from its send no live look runs, so the same card says how to look again
  const old = tradeCard(rec({ status: "unconfirmed", endedAt: undefined, filledInMs: undefined, steps: [{ id: "swap", tx: "", lastValidBlockHeight: 1 }] }), 1_300 + 60 * 60_000 + 1);
  assert.equal(old.result, "Solana hasn't confirmed this trade yet. Open this again to check.");
  assert.equal(tradeProblems.unconfirmed("WIF", "Solana", false).whatHappened, "Solana hasn't confirmed this trade yet. Open this again to check.");
});
