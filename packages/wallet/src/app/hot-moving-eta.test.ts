// The test shot of Hot (5 Nov): "On its way to your SOL wallet · $x" with "This job has no time estimate." under it.
// Every moving row carries a time from the one time model (job-steps LEG_SEC), counted from its own legs; no wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingStatus } from "@zerofee/core/spending";
import { LEG_SEC, TIME_WORDS, receiptLeft } from "@zerofee/shell-api/job-steps.ts";
import { movingRows, routeSec } from "./hot-moving.ts";

const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const S = (o: Partial<SpendingStatus>) => ({ loaded: true, totalUsd: "0.00", reserveUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "0", ready: true, firstTopUp: false, onItsWay: [], networks: [], ...o }) as SpendingStatus;
const net = (network: string, cashUsd: string) => ({ network, name: network, cashUsd, coinsUsd: "0.00", readyUsd: "0.00" });

test("an activity with no estimate gets its route's time, counted from its start (a test); control: a quote is kept", () => {
  const toSol = { id: "mv-1", kind: "top-up", usd: "20.00", status: "on-its-way", shown: true, atIso: iso(T), words: "Moving $20.00 to your SOL wallet", goesTo: ["sol"], via: "private" };
  const s = S({ totalUsd: "40.00", reserveUsd: "0.00", networks: [net("sol", "20.00")] as never, onItsWay: [toSol] as never });
  const [row] = movingRows(s);
  assert.equal(row!.etaSec, LEG_SEC.privateOut);
  assert.equal(row!.endsAt, T + LEG_SEC.privateOut * 1000, "the Jobs row's own end (its legs, from the start)");
  assert.notEqual(receiptLeft(row!.endsAt, T + 1000), TIME_WORDS.receiptNone);
  // NEAR Confidential paid it at 12 s (its step ticked): only the landing's read is left, as in the Jobs row
  const paid = movingRows(S({ ...s, onItsWay: [{ ...toSol, paidDone: true }] as never }))[0]!;
  assert.ok(paid.endsAt! < row!.endsAt!, "it shrinks on the real legs");
  // a wallet's move and the Safe's own route, each from LEG_SEC
  assert.equal(routeSec({ kind: "move", to: "sol" } as never), LEG_SEC.chainIn + LEG_SEC.nearOut);
  assert.equal(routeSec({ kind: "top-up", goesTo: ["sol"] } as never), LEG_SEC.safeToChain);
  // control: the protocol's own quote wins
  const quoted = movingRows(S({ ...s, onItsWay: [{ ...toSol, etaSeconds: 45 }] as never }))[0]!;
  assert.deepEqual([quoted.etaSec, quoted.endsAt], [45, T + 45_000]);
});

test("the copy review's rule (test, MUST 1): the engine's leg with no move to name draws no row; every row drawn has a time (control: a named move of the person's own is a row with its time)", () => {
  const rows = movingRows(S({ totalUsd: "5.00", reserveUsd: "0.00", onItsWay: [] }));
  assert.deepEqual(rows, [], "no \"On its way to your NEAR wallet\" row for an unnamed leg");
  const own = { id: "mv-2", kind: "top-up", usd: "5.00", status: "on-its-way", shown: true, atIso: iso(T), words: "Moving $5.00 to your SOL wallet", goesTo: ["sol"], via: "private" };
  const named = movingRows(S({ totalUsd: "5.00", reserveUsd: "0.00", onItsWay: [own] as never }));
  assert.deepEqual(named.map((r) => [r.id, r.etaSec]), [["mv-2", LEG_SEC.privateOut]]);
});

test("\"This job has no time estimate.\" never reaches the screen: TimeLeft draws nothing without a time; Hot passes each row's end", () => {
  const made = readFileSync(new URL("./money/JobMade.tsx", import.meta.url), "utf8");
  // a16: Hot's row wraps the time in its own line ("On its way · About 29 s left.", MOVING_WORDS.sub); the receipt's is bare
  assert.match(made, /if \(endsAt === undefined\) return watchLine;\n\s+const time = receiptLeft\(endsAt, now, startMs, landed\);\n\s+return <><p className="zf-receipt__line" data-testid="job-time-left">\{line \? line\(time\) : time\}<\/p>\{watchLine\}<\/>;/);
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /<Left etaSec=\{m\.etaSec\} endsAt=\{m\.endsAt\} follow=\{false\} line=\{movingWords\?\.sub\} \/>/);
  // control: the words still exist for the receipt's own pure function (a caller with no time gets null drawn, not them)
  assert.equal(receiptLeft(undefined, T), TIME_WORDS.receiptNone);
});
