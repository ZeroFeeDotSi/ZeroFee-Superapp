// QA (3 Nov e2e walk, 143 + 83): one Move showed as two Activity rows ("Topped up $10.00", "Moved $9.70 to Solana"; a
// take-out "Brought $20.18 back from Solana", "Put away $19.88"). Now a leg folds into its move's row, each leg kept whole.
// QA's condition: Activity's and the Statement's totals are the same before and after, with a control that fails if the
// folded row drops or double-counts a leg.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { foldLegs, unfoldLegs } from "@zerofee/core/spending-fold";
import { activityRows, legsLine } from "./activity-rows.ts";
import { statementRows, summaryLine, toCsv } from "./statement.ts";
import type { Movement, Token } from "../types.ts";

const at = (min: number) => new Date(2026, 10, 3, 9, min).toISOString();
const row = (o: Partial<SpendingActivity> & Pick<SpendingActivity, "id" | "kind" | "usd" | "words">): SpendingActivity => ({ status: "done", shown: true, atIso: at(1), ...o });
const ROWS: SpendingActivity[] = [
  row({ id: "add1", kind: "top-up", usd: "10.00", words: "Topped up $10.00", atIso: at(1) }),
  row({ id: "out1", kind: "ready", usd: "9.70", words: "Moved $9.70 to Solana", network: "sol", of: "add1", atIso: at(3) }),
  row({ id: "home1", kind: "put-away", usd: "19.88", words: "Put away $19.88", atIso: at(10) }),
  row({ id: "in1", kind: "put-away", usd: "20.18", words: "Brought $20.18 back from Solana", network: "sol", of: "home1", atIso: at(8) }),
  row({ id: "in2", kind: "put-away", usd: "5.00", words: "Bringing $5.00 back from Robinhood Chain", network: "hood", of: "home1", status: "on-its-way", atIso: at(9) }),
  // a leg whose move isn't in the list stays its own row; a plain move has no legs
  row({ id: "lone", kind: "ready", usd: "3.00", words: "Moved $3.00 to Solana", network: "sol", of: "gone", atIso: at(12) }),
  row({ id: "t2", kind: "top-up", usd: "25.00", words: "Topped up $25.00", atIso: at(14) }),
];
const cents = (rs: readonly SpendingActivity[]) => rs.reduce((n, r) => n + Math.round(Number(r.usd) * 100), 0);
const shownSum = (rs: readonly SpendingActivity[]) => rs.reduce((n, r) => n + Math.round(Number(r.usd) * 100) + cents(r.legs ?? []), 0);
const ids = (rs: readonly SpendingActivity[]) => rs.flatMap((r) => [r.id, ...(r.legs ?? []).map((l) => l.id)]).sort();
const TOKENS = new Map<string, Token>();
const LEDGER: Movement[] = [{ id: "d1", kind: "deposit", status: "done", from: "btc", to: "nep141:usdc", amount: "42.1", startedAtIso: at(0), updatedAtIso: at(0), explorerUrls: [] } as Movement];

/** What QA asked to hold: every leg once, the dollars the same, and the Statement the same. */
function same(folded: readonly SpendingActivity[]): void {
  assert.deepEqual(ids(folded), ROWS.map((r) => r.id).sort(), "every row and leg exactly once");
  assert.equal(shownSum(folded), cents(ROWS), "Activity's dollars, every leg counted once");
  const before = statementRows(LEDGER, ROWS, TOKENS, [], 2026, 10);
  const after = statementRows(LEDGER, unfoldLegs(folded), TOKENS, [], 2026, 10);
  assert.equal(toCsv(after), toCsv(before), "the Statement, line for line");
  assert.equal(summaryLine(after, 2026, 10), summaryLine(before, 2026, 10));
}

test("one move, one row: the Move's leg and the take-out's two legs fold into their rows; a leg whose move isn't listed stays", () => {
  const f = foldLegs(ROWS);
  assert.deepEqual(f.map((r) => r.id), ["add1", "home1", "lone", "t2"]);
  assert.deepEqual(f.find((r) => r.id === "home1")!.legs!.map((l) => l.id), ["in1", "in2"]);
  assert.equal(legsLine(f.find((r) => r.id === "add1")!), "Moved $9.70 to Solana · Done");
  assert.equal(legsLine(f.find((r) => r.id === "home1")!), "Brought $20.18 back from Solana · Bringing $5.00 back from Robinhood Chain: On its way · Done");
  assert.equal(legsLine(f.find((r) => r.id === "t2")!), "Done", "a move with no legs reads as before");
  // Wallet's Activity reads the folded list; the Statement reads every leg as its own line
  assert.deepEqual(activityRows(LEDGER, ROWS).spending.map((r) => r.id), ["add1", "home1", "lone", "t2"]);
  assert.equal(statementRows(LEDGER, ROWS, TOKENS, [], 2026, 10).length, ROWS.length + 1);
});

test("QA's condition: Activity's and the Statement's totals are the same before and after the fold", () => {
  same(foldLegs(ROWS));
  assert.deepEqual(unfoldLegs(foldLegs(ROWS)).map((r) => r.id).sort(), ROWS.map((r) => r.id).sort());
});

test("control: a fold that drops a leg, or counts one twice, fails the same check", () => {
  const f = foldLegs(ROWS);
  const dropped = f.map((r) => (r.id === "home1" ? { ...r, legs: r.legs!.slice(0, 1) } : r));
  assert.throws(() => same(dropped), /every row and leg exactly once/);
  const twice = [...f, ROWS.find((r) => r.id === "out1")!];
  assert.throws(() => same(twice), /every row and leg exactly once/);
  const twiceInside = f.map((r) => (r.id === "add1" ? { ...r, legs: [...r.legs!, r.legs![0]!] } : r));
  assert.throws(() => same(twiceInside), /every row and leg exactly once/);
});

test("a chain of legs never hides a whole move: a leg of a leg stays its own row", () => {
  const chain = [row({ id: "a", kind: "top-up", usd: "5.00", words: "A" }), row({ id: "b", kind: "ready", usd: "4.00", words: "B", of: "a" }), row({ id: "c", kind: "ready", usd: "3.00", words: "C", of: "b" })];
  const f = foldLegs(chain);
  assert.deepEqual(ids(f), ["a", "b", "c"]);
  assert.deepEqual(f.map((r) => r.id), ["a", "c"]);
});

test("security review: a leg that failed, came back or was refused never folds; it keeps its own row (control: a done leg folds)", () => {
  for (const status of ["failed", "refunded", "refused", "waiting", "waiting-for-you"] as const) {
    const rs = [row({ id: "m", kind: "top-up", usd: "10.00", words: "Topped up $10.00" }), row({ id: "l", kind: "ready", usd: "9.70", words: "Moving $9.70 to Solana", of: "m", status })];
    assert.deepEqual(foldLegs(rs).map((r) => [r.id, r.legs?.length ?? 0]), [["m", 0], ["l", 0]], status);
  }
  const done = [row({ id: "m", kind: "top-up", usd: "10.00", words: "Topped up $10.00" }), row({ id: "l", kind: "ready", usd: "9.70", words: "Moved $9.70 to Solana", of: "m" })];
  assert.deepEqual(foldLegs(done).map((r) => [r.id, r.legs?.length ?? 0]), [["m", 1]]);
});

test("D137: a Move from the Safe reads Done only once it is in the wallet the person chose (control: its leg there done)", () => {
  const up = row({ id: "m", kind: "top-up", usd: "5.00", words: "Moving $5.00 to your SOL wallet", goesTo: ["sol"] });
  assert.doesNotMatch(legsLine(up), /Done/, "in the NEAR wallet, not yet the SOL wallet");
  const leg = row({ id: "l", kind: "ready", usd: "4.90", words: "Moved $4.90 to Solana", network: "sol", of: "m" });
  assert.equal(legsLine({ ...up, legs: [leg] }), "Moved $4.90 to Solana · Done");
  assert.equal(legsLine(row({ id: "n", kind: "top-up", usd: "5.00", words: "Moved $5.00 to your NEAR wallet" })), "Done", "control: a move to the NEAR wallet is done there");
});

test("rule 11 (the proof's Sim walk, 5 Nov): a $5.20 Move to the SOL wallet never ticks or says \"Moved\" before the SOL wallet's chain read: \"Moving … · On its way\" (control: its leg read done, it is Moved and Done)", () => {
  const up = row({ id: "m", kind: "top-up", usd: "5.20", words: "Moved $5.20 to your SOL wallet", goesTo: ["sol"] });
  const [going] = activityRows([], [up]).spending;
  assert.equal(going!.status, "on-its-way", "no tick: not done until the SOL wallet has it");
  assert.equal(going!.words, "Moving $5.20 to your SOL wallet");
  assert.match(legsLine(going!), /On its way/);
  const leg = row({ id: "l", kind: "ready", usd: "5.10", words: "Moved $5.10 to Solana", network: "sol", of: "m" });
  const [landed] = activityRows([], [up, leg]).spending;
  assert.deepEqual([landed!.status, landed!.words], ["done", "Moved $5.20 to your SOL wallet"], "control: its leg landed, read on chain");
  const [near] = activityRows([], [row({ id: "n", kind: "top-up", usd: "5.00", words: "Moved $5.00 to your NEAR wallet" })]).spending;
  assert.equal(near!.status, "done", "control: a move that ends in the NEAR wallet is done there");
});

test("rule 11 (the prover, 5 Nov): a $5.20 Move to SOL paid from Private reads \"Moving … · On its way\" with no tick until the SOL wallet's own chain read (`landed`), never on the ledger's \"done\" alone; then Moved and Done (controls: came back to Private; Safe-paid waits for its leg; a Move to the NEAR wallet is done there)", () => {
  const paid = row({ id: "p", kind: "top-up", usd: "5.20", words: "Moving $5.20 to your SOL wallet", goesTo: ["sol"], via: "private", status: "on-its-way" });
  const [going] = activityRows([], [paid]).spending;
  assert.deepEqual([going!.status, going!.words], ["on-its-way", "Moving $5.20 to your SOL wallet"], "paying: no tick");
  assert.match(legsLine(going!), /^On its way$/);
  // the ledger said done, the SOL wallet not read yet: still no tick, still "Moving"
  const [unread] = activityRows([], [{ ...paid, status: "done", words: "Moved $5.20 to your SOL wallet" }]).spending;
  assert.deepEqual([unread!.status, unread!.words, legsLine(unread!)], ["on-its-way", "Moving $5.20 to your SOL wallet", "On its way"], "no tick before the chain read");
  // its chain read landed: Moved, Done, one way
  const [landed] = activityRows([], [{ ...paid, status: "done", words: "Moved $5.20 to your SOL wallet", landed: ["sol"] }]).spending;
  assert.deepEqual([landed!.status, landed!.words, legsLine(landed!)], ["done", "Moved $5.20 to your SOL wallet", "Done"]);
  // two wallets: one read is not both
  const [half] = activityRows([], [{ ...paid, goesTo: ["sol", "hood"], status: "done", words: "Moved $5.20 to your wallets", landed: ["sol"] }]).spending;
  assert.equal(half!.status, "on-its-way", "the ETH (RH) wallet not read yet");
  // control: a part that came back to Private is over (its note says so): `landed` names it, the row ends
  const [back] = activityRows([], [{ ...paid, status: "done", words: "Moved $5.20 to your SOL wallet", note: "Solana: back in Private", landed: ["sol"] }]).spending;
  assert.equal(back!.status, "done");
  // control: Safe-paid, `landed` means nothing: it waits for its leg row
  const [safe] = activityRows([], [{ ...paid, via: undefined, status: "done", words: "Moved $5.20 to your SOL wallet", landed: ["sol"] }]).spending;
  assert.deepEqual([safe!.status, legsLine(safe!)], ["on-its-way", "On its way"], "control: Safe-paid, no leg read yet: still on its way");
  // control: a Move paid from Private to the NEAR wallet goes nowhere on: done on its end, as before
  const [near] = activityRows([], [row({ id: "n", kind: "top-up", usd: "5.00", words: "Moved $5.00 to your NEAR wallet", via: "private" })]).spending;
  assert.deepEqual([near!.status, legsLine(near!)], ["done", "Done"]);
});
