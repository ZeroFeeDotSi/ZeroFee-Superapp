// fix/move-row-truth (7 Nov; 04e/04f of the main reshoots, the audit's M1-M3): a two-wallet Move's one Activity row said
// "Move $119.33 to your SOL wallet · In your SOL wallet." with a tick while two of its parts still went in Now. Each test
// fails on cbaddc66d (named per test); each has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { walletsWords } from "@zerofee/core/move-plan";
import { foldJobs, goingOf, jobFacts, nameOf, onScreen, rowFace, usdOf } from "./activity-rows.ts";
import { dropMerged, foldInto, jobTrack, placesSaid, rowTrack, type LiveTrack } from "./money/live-steps.ts";

const T0 = Date.UTC(2026, 10, 7, 5, 20);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "40", status: "done", shown: true, atIso: iso(T0), words: "Move $40.00 to your SOL wallet", ...o });

// 04a's plan: $101.48 Safe fill to the NEAR wallet and $8.39 Private to the SOL wallet (one row, paid from Private), then
// the ETH (RH) wallet's $3.94 to the SOL wallet and $5.52 to the NEAR wallet (two core moves): $119.33 in all
const JOB = "move:mv-truth-1";
const safe = row({ id: "mv-truth-1", via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, askedUsd: "109.87", usd: "109.87", words: "Moved $8.39 to your SOL wallet" });
const toSol = (status: SpendingActivity["status"]) => row({ id: "mt-sol", kind: "move", network: "hood", to: "sol", usd: "3.94", status: "done", words: "Moved $3.94 from your Robinhood wallet to your SOL wallet", atIso: iso(T0 + 1_000), legs: [row({ id: "mt-sol-leg", kind: "ready", network: "sol", usd: "3.90", status, of: "mt-sol", words: "Moving $3.90 to Solana", atIso: iso(T0 + 30_000) })] });
const toNear = (status: SpendingActivity["status"]) => row({ id: "mt-near", kind: "move", network: "hood", to: "near", usd: "5.52", status, words: "Moving $5.52 from your Robinhood wallet to your NEAR wallet", atIso: iso(T0 + 2_000) });
carryTo([`move:${safe.id}`, "move:mt-sol", "move:mt-near"], { usd: "$119.33", job: JOB, to: ["sol", "near"] });
const jobOf = (id: string) => (["mv-truth-1", "mt-sol", "mt-near"].includes(id) ? JOB : undefined);

test("(1a) a Move with one part done and one going is a going row: no tick, the going words (on cbaddc66d its rows' \"done\" ticked it: \"In your SOL wallet.\"); control: every part landed, ticked", () => {
  // the NEAR part's rows say done (the engine's), its leg on to Solana still going: on main the row ticked on the rows alone
  const [going] = foldJobs([safe, toSol("on-its-way"), toNear("done")], jobOf);
  const face = rowFace(going!, new Map(), T0 + 60_000);
  assert.notEqual(face.mark, "on", "never ticked while a part goes");
  assert.doesNotMatch(face.line, /^In your SOL wallet\.$/);
  const [all] = foldJobs([safe, toSol("done"), toNear("done")], jobOf);
  const done = rowFace(all!, new Map(), T0 + 60_000);
  assert.equal(done.mark, "on", "control: every part landed");
  assert.equal(done.line, "In your SOL and NEAR wallets.", "the audit's M2: the line names every wallet");
});

test("(1b, 1c) a two-wallet Move's row names both wallets in the plan's order, with the Move's own total (on cbaddc66d: \"Move $119.33 to your SOL wallet\")", () => {
  const [r] = foldJobs([safe, toSol("done"), toNear("done")], jobOf);
  assert.equal(nameOf(r!), "Move $119.33 to your SOL and NEAR wallets");
  assert.equal(usdOf(r!), "$119.33", "the receipt's figure");
  assert.equal(placesSaid(["near", "hood", "sol"]), "your SOL, Robinhood and NEAR wallets", "three, in the plan's order");
  assert.equal(placesSaid(["sol"]), "your SOL wallet", "control: one wallet");
  // the same words as the sheet's (B13's walletsWords), for every set of wallets in the plan's order
  const name: Record<string, string> = { sol: "your SOL wallet", hood: "your Robinhood wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
  for (const set of [["sol"], ["near"], ["sol", "near"], ["sol", "hood"], ["hood", "near"], ["sol", "hood", "near"], ["sol", "hood", "near", "bsc"]]) assert.equal(placesSaid(set), walletsWords(set.map((p) => name[p]!)), set.join(","));
});

test("(1d) the Move's page: To lists every wallet (on cbaddc66d: \"SOL wallet\"); control: a row of one move keeps its facts", () => {
  const [r] = foldJobs([safe, toSol("done"), toNear("done")], jobOf);
  const facts = [{ label: "From", value: "Safe" }, { label: "To", value: "SOL wallet" }];
  // fix/move-leg-steps (QA's SHOULD): From names every wallet that paid ("Safe" alone before)
  assert.deepEqual(jobFacts(r!, facts), [{ label: "From", value: "Safe, Robinhood wallet" }, { label: "To", value: "SOL wallet, NEAR wallet" }]);
  assert.deepEqual(jobFacts(toNear("done"), facts), facts, "control: no parts");
});

test("the audit's M1: a three-part Move with one part going shows NO row in Money and ONE job in Now (on cbaddc66d: a ticked Money row beside two part cards); control: once every part ended, one Money row and no card", () => {
  const rows = [safe, toSol("on-its-way"), toNear("done")];
  // Now: watchLive's own fold (foldInto, then rowTrack): one track, the job's, going
  const now: LiveTrack[] = foldInto(rows, jobOf).map((r) => rowTrack(r)).filter((t): t is LiveTrack => !!t);
  assert.equal(now.length, 1, "one job in Now");
  assert.equal(now[0]!.title, "Move $119.33 to your SOL and NEAR wallets");
  assert.equal(now[0]!.end, undefined, "going");
  // Money: the row is in Now only, by its parts' tasks still going (a part published before its job's carry named it)
  const tasks = [{ app: "home", id: "move:mt-near", state: "pending" }] as const;
  assert.deepEqual(onScreen({ ledger: [], spending: foldJobs(rows, jobOf) }, T0 + 60_000, new Map(), goingOf(tasks)).spending, [], "no Money row");
  // the part's own task goes from the centre once it is in its job's track
  const dropped: string[] = [];
  const sent = new Map([["move:mt-near", "x"]]);
  dropMerged({ drop: (id: string) => (dropped.push(id), true) } as never, ["move:mt-near"], sent);
  assert.deepEqual(dropped, ["move:mt-near"]);
  assert.equal(sent.has("move:mt-near"), false);
  // control: every part ended
  const ended = [safe, toSol("done"), toNear("done")];
  const t = foldInto(ended, jobOf).map((r) => rowTrack(r)).filter((x): x is LiveTrack => !!x);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.end, { ok: true, line: "In your SOL and NEAR wallets." });
  assert.equal(onScreen({ ledger: [], spending: foldJobs(ended, jobOf) }, T0 + 60_000, new Map(), goingOf([])).spending.length, 1, "one Money row");
});

test("Now's fold (foldInto, as watchLive reads Spending's rows: each leg its own row, `of` its move): a part keeps its own leg on, so the job ends once that leg landed (the Sim walk: the card stayed \"Solana is landing it\" after every part landed); control: that leg still going, the job goes", () => {
  const flat = (status: SpendingActivity["status"]) => { const p = toSol(status); const { legs, ...part } = p; return [safe, part, ...legs!, toNear("done")]; };
  const done = foldInto(flat("done"), jobOf).map((r) => rowTrack(r)).filter((t): t is LiveTrack => !!t);
  assert.equal(done.length, 1);
  assert.deepEqual(done[0]!.end, { ok: true, line: "In your SOL and NEAR wallets." });
  const going = foldInto(flat("on-its-way"), jobOf).map((r) => rowTrack(r)).filter((t): t is LiveTrack => !!t);
  assert.equal(going[0]!.end, undefined);
});

test("a job's row whose parts' own tasks were dropped (dropMerged) ends by its one task, the store's end winning over a stale copy of its rows; control: no task end, it stays in Now", () => {
  const rows = foldJobs([safe, toSol("on-its-way"), toNear("done")], jobOf);
  const ended = new Map([[`move:${safe.id}`, { state: "done" as const, at: T0 + 120_000, where: "In your SOL and NEAR wallets." }]]);
  assert.equal(onScreen({ ledger: [], spending: rows }, T0 + 60_000, ended).spending.length, 1, "the job's task ended: its row");
  assert.deepEqual(rowFace(rows[0]!, ended, T0 + 60_000), { line: "In your SOL and NEAR wallets.", mark: "on" });
  assert.equal(onScreen({ ledger: [], spending: rows }, T0 + 60_000).spending.length, 0, "control: still going, in Now only");
});

test("jobTrack: ends only once every part ended; a stopped part's end once all ended; one part alone is itself", () => {
  const part = (id: string, end?: LiveTrack["end"]): LiveTrack => ({ id, kind: "move", title: `Move $1.00 to your SOL wallet`, wallets: ["sol"], startMs: T0, steps: [{ label: "x", state: end ? "done" : "doing" }], ...(end ? { end } : {}), money: { at: ["sol"], from: ["safe"], to: ["sol"] } });
  assert.equal(jobTrack([part("a", { ok: true, line: "In your SOL wallet." }), part("b")], { usd: "$2.00", to: ["sol", "near"] })!.end, undefined);
  const bad = { ok: false, line: "NEAR Confidential didn't pay your NEAR wallet." };
  assert.deepEqual(jobTrack([part("a", { ok: true, line: "In your SOL wallet." }), part("b", bad)], { usd: "$2.00", to: ["sol", "near"] })!.end, bad);
  const one = part("a");
  assert.equal(jobTrack([one]), one, "control");
});
