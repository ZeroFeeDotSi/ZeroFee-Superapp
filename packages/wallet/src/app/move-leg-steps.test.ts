// fix/move-leg-steps (the audit's M4, 7 Nov): the two-wallet Move (the Safe and the ETH (RH) wallet into the SOL and NEAR
// wallets, $119.33) showed two "Left your ETH (RH) wallet" steps that couldn't be told apart on its page, and no step for
// the Safe's $101.48 to the NEAR wallet. Each test fails on 6c4cab5a1 (named per test); each has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { carried, carryTo, createJobCarry } from "@zerofee/shell-api/job-carry.ts";
import { foldJobs } from "./activity-rows.ts";
import * as steps from "./money/live-steps.ts";
import { runMove, type MoveRunIo } from "./screens/move-run.ts";
import { planOf, type Leg } from "./screens/move-split.ts";

const { foldInto, joinTracks, moveTrack, rowTrack } = steps;
type LiveTrack = steps.LiveTrack;
const T0 = Date.UTC(2026, 10, 7, 5, 20);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "40", status: "done", shown: true, atIso: iso(T0), words: "Move $40.00 to your SOL wallet", ...o });

// the walk's records: the Safe's part (paid from Private: $8.39 to the SOL wallet, $101.48 to the NEAR wallet; its row's
// goesTo names chains only), then the ETH (RH) wallet's two core moves ($3.94 to the SOL wallet, $5.52 to the NEAR wallet)
const JOB = "move:mv-legs-1";
const safe = (o: Partial<SpendingActivity> = {}) => row({ id: "mv-legs-1", via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, askedUsd: "109.87", usd: "109.87", words: "Moved $8.39 to your SOL wallet", fill: "done", ...o });
const toSol = (status: SpendingActivity["status"] = "done") => row({ id: "ml-sol", kind: "move", network: "hood", to: "sol", usd: "3.94", status: "done", words: "Moved $3.94 from your ETH (RH) wallet to your SOL wallet", atIso: iso(T0 + 1_000), legs: [row({ id: "ml-sol-leg", kind: "ready", network: "sol", usd: "3.90", status, of: "ml-sol", words: "Moving $3.90 to Solana", atIso: iso(T0 + 30_000) })] });
const toNear = (status: SpendingActivity["status"] = "done") => row({ id: "ml-near", kind: "move", network: "hood", to: "near", usd: "5.52", status, words: "Moving $5.52 from your ETH (RH) wallet to your NEAR wallet", atIso: iso(T0 + 2_000) });
carryTo([`move:mv-legs-1`, "move:ml-sol", "move:ml-near"], { usd: "$119.33", job: JOB, to: ["sol", "near"] });
// move-run's carry of the plan's legs for the Safe's part (the tap's own record)
carryTo(["move:mv-legs-1"], { legs: [{ to: "sol", usd: "$8.39" }, { to: "near", usd: "$101.48" }] });
const jobOf = (id: string) => (["mv-legs-1", "ml-sol", "ml-near"].includes(id) ? JOB : undefined);

/** The job's page as Activity draws it (Activity.tsx: joinTracks over the row and its parts, each moveTrack). */
const page = (rows: SpendingActivity[]) => {
  const [j] = foldJobs(rows, jobOf);
  return joinTracks([{ ...j!, status: j!.own ?? j!.status }, ...(j!.parts ?? [])].map((x) => moveTrack(x)))!.steps;
};
const labels = (s: readonly { label: string }[]) => s.map((x) => x.label);
const face = (s: readonly { label: string; state: string; note?: string }[]) => s.map((x) => [x.label.replace(/^Done in \d+ seconds\.$/, "Done in N seconds."), x.note ?? "", x.state]);

// the copy review's ruling (7 Nov): grouped by what the person sees, six steps at most; a wallet's line names only what the records
// prove (the ETH (RH) wallet's own part, never the Safe or Private); the run's figure the plan's whole $119.33 (every
// part goes through NEAR Confidential), "about" as the ETH (RH) parts are priced
test("M4 (a): the two-wallet Move's page, every part landed, is six steps: Signed, the ETH (RH) wallet once, NEAR Confidential once with the whole run's figure, each wallet with its share and its proven part, Done (on 6c4cab5a1: ten steps, two \"Left your ETH (RH) wallet\", no NEAR wallet step for the Safe's part)", () => {
  const s = page([safe(), toSol(), toNear()]);
  assert.deepEqual(face(s), [
    ["Signed.", "", "done"],
    ["Left your ETH (RH) wallet · about $9.46", "to your SOL and NEAR wallets", "done"],
    ["Through NEAR Confidential · about $119.33", "NEAR Confidential moved it to your SOL and NEAR wallets.", "done"],
    ["It's in your SOL wallet · about $12.33", "about $3.94 of it from your ETH (RH) wallet", "done"],
    ["It's in your NEAR wallet · about $107.00", "about $5.52 of it from your ETH (RH) wallet", "done"],
    ["Done in N seconds.", "", "done"],
  ]);
  assert.equal(new Set(s.map((x) => x.label)).size, s.length, "no two steps read the same");
  assert.ok(!s.some((x) => /from your Safe|from Private/.test(`${x.label} ${x.note ?? ""}`)), "never a source the records don't prove");
});

test("M4 (b): Now's card (watchLive's fold, rowTrack) is the same six steps; going, the landings go, Done waits and the job has no end; done, its end once every part landed (on 6c4cab5a1: ten steps)", () => {
  const now = (rows: SpendingActivity[]) => foldInto(rows, jobOf).map((r) => rowTrack(r)).filter((t): t is LiveTrack => !!t);
  // going: the Safe's part paid, its NEAR wallet landing not read; the ETH (RH) wallet's leg on to Solana going
  const going = now([safe({ status: "on-its-way", landed: ["sol"] }), toSol("on-its-way"), toNear("done")]);
  assert.equal(going.length, 1);
  assert.deepEqual(face(going[0]!.steps), [
    ["Signed.", "", "done"],
    ["Left your ETH (RH) wallet · about $9.46", "to your SOL and NEAR wallets", "done"],
    ["Through NEAR Confidential · about $119.33", "NEAR Confidential moved it to your SOL and NEAR wallets.", "done"],
    ["Solana is landing it in your SOL wallet · about $12.33", "about $3.94 of it from your ETH (RH) wallet", "doing"],
    ["NEAR is landing it in your NEAR wallet · about $107.00", "about $5.52 of it from your ETH (RH) wallet", "doing"],
    ["Then it's done.", "", "waiting"],
  ]);
  assert.equal(going[0]!.end, undefined, "going");
  const done = now([safe(), toSol(), toNear()]);
  assert.deepEqual(face(done[0]!.steps), face(page([safe(), toSol(), toNear()])));
  assert.deepEqual(done[0]!.end, { ok: true, line: "In your SOL and NEAR wallets." });
});

test("M4 (c): a share the records can't split names no source (the Safe's part alone to the NEAR wallet); a share wholly from one wallet says so (on 6c4cab5a1: no such steps)", () => {
  carryTo(["move:mv-legs-2"], { legs: [{ to: "near", usd: "$20.00" }] });
  const s2 = row({ id: "mv-legs-2", via: "private", paidDone: true, usd: "20.00", words: "Moved $20.00 to your NEAR wallet" });
  const [j] = foldJobs([s2, toSol()], (id) => (id === "mv-legs-2" || id === "ml-sol" ? "move:j2" : undefined));
  const s = joinTracks([{ ...j!, status: j!.own ?? j!.status }, ...(j!.parts ?? [])].map((x) => moveTrack(x)))!.steps;
  assert.deepEqual(face(s).slice(3, 5), [
    ["It's in your SOL wallet · about $3.94", "from your ETH (RH) wallet", "done"],
    ["It's in your NEAR wallet · about $20.00", "", "done"],
  ]);
});

test("M4 control: a one-wallet Move is unchanged: a wallet's own Move, and the Safe's Move to one wallet, keep their steps with no figure on them", () => {
  const one = moveTrack(row({ id: "ml-only", kind: "move", network: "hood", to: "sol", usd: "3.94", words: "Moved $3.94 from your ETH (RH) wallet to your SOL wallet", legs: [row({ id: "ml-only-leg", kind: "ready", network: "sol", usd: "3.90", of: "ml-only" })] }))!;
  assert.deepEqual(labels(joinTracks([one])!.steps), ["Left your ETH (RH) wallet", "Through NEAR Confidential", "In your SOL wallet"]);
  const s1 = row({ id: "mv-only", via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, usd: "5.00", words: "Moved $5.00 to your SOL wallet" });
  carryTo(["move:mv-only"], { legs: [{ to: "sol", usd: "$5.00" }] });
  const t = moveTrack(s1)!;
  assert.deepEqual(labels(t.steps), ["NEAR Confidential paid your SOL wallet.", "It's in your SOL wallet."]);
  assert.equal(t.title, "Move $5.00 to your SOL wallet");
});

test("M4: the Safe's part with no plan legs kept (a reload that lost the carry, another device) is as before: no NEAR wallet step made up, never a figure guessed", () => {
  const bare = moveTrack(safe({ id: "mv-legs-bare" }))!;
  assert.deepEqual(labels(bare.steps), ["NEAR Confidential moved it to Private.", "NEAR Confidential paid your SOL wallet.", "It's in your SOL wallet."]);
});

test("M4: move-run carries the plan's legs to the Safe's part, each wallet with its own dollars; the wallet legs carry none (they have their own records). Fails on 6c4cab5a1 (no legs carried)", async () => {
  const legs: Leg[] = [{ from: "safe", to: "near", usd: 90 }, { from: "private", to: "near", usd: 11.48 }, { from: "private", to: "sol", usd: 8.39 }, { from: "hood", to: "sol", usd: 3.94 }, { from: "hood", to: "near", usd: 5.52 }];
  let k = 0;
  const io: MoveRunIo = {
    call: async (m) => ({ ok: m === "spending.topUp" ? { id: "mv-run-legs" } : { id: `ml-run-${k++}` } }) as never,
    tasks: undefined, keyFor: (w) => `legs-${w.length}-${k}`, onApproval: () => () => {}, asks: false, fills: false, onSigned: () => () => {}, onAsked: () => () => {},
    say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {},
  };
  const ran = await runMove(legs, planOf(legs), io);
  assert.deepEqual(ran?.followed.map((f) => f.id), ["mv-run-legs", "ml-run-0", "ml-run-1"]);
  assert.deepEqual(carried("move:mv-run-legs")?.legs, [{ to: "near", usd: "$101.48" }, { to: "sol", usd: "$8.39" }]);
  assert.equal(carried("move:ml-run-0")?.legs, undefined, "control: a wallet's leg");
});

test("M4: a kept carry keeps only well-formed legs (a place key and a dollar figure); control: a carry without legs as before", () => {
  const c = createJobCarry(new Map(), () => 1_000);
  c.keep(JSON.stringify({ a: { at: 1_000, legs: [{ to: "near", usd: "$101.48" }, { to: "elsewhere", usd: "$1.00" }, { to: "sol", usd: "1e9" }, "x"] }, b: { at: 1_000, usd: "$2.00" } }), () => {});
  assert.deepEqual(c.get("a")?.legs, [{ to: "near", usd: "$101.48" }]);
  assert.deepEqual(c.get("b"), { at: 1_000, usd: "$2.00" });
});

// 83 and QA's A- notes, the copy review's B+ grade (7 Nov): each fails on b72730c69
import * as proof from "./proof.ts";
import * as rows from "./activity-rows.ts";
import * as jobWords from "@zerofee/shell-api/job-steps.ts";
import { readFileSync } from "node:fs";

test("QA's MUST: \"This step is private\" shows only when every leg had no public tx: a Move with the Safe's fill never says it, nor a job of several parts (no Finished row at all); control: a Move from Private alone keeps it (on b72730c69 the fill's Move said it)", () => {
  const filled = row({ id: "mv-priv-1", via: "private", fill: "done", paid: ["safe-send:1", "pocket-send:2"], paidDone: true, landed: ["sol"], goesTo: ["sol"], usd: "5.00" });
  const p1 = proof.spendingPage(filled);
  assert.equal(p1.finished, undefined);
  assert.ok(!p1.steps.some((s) => s.end && "private" in s.end));
  const alone = row({ id: "mv-priv-2", via: "private", paid: ["pocket-send:3"], paidDone: true, landed: ["sol"], goesTo: ["sol"], usd: "5.00" });
  assert.equal(proof.everyLegPrivate?.(alone), true);
  // the six-step page: no Finished row (its Done says it), no head row
  const [j] = foldJobs([safe(), toSol(), toNear()], jobOf);
  const pg = proof.withTrackSteps(proof.spendingPage(j!), joinTracks([{ ...j!, status: j!.own ?? j!.status }, ...(j!.parts ?? [])].map((x) => moveTrack(x))));
  assert.equal(pg.finished, undefined);
  assert.equal(pg.ended, null);
  assert.ok(!pg.steps.some((s) => s.end), "no step carries a Finished row");
});

test("QA's SHOULD: From names every wallet that paid, in the sheet's row order (on b72730c69: \"Safe\"); control: a row of one move keeps its facts", () => {
  const [j] = foldJobs([safe(), toSol(), toNear()], jobOf);
  assert.equal(rows.jobFrom?.(j!), "Safe, Private, ETH (RH) wallet");
  assert.deepEqual(rows.jobFacts(j!, [{ label: "From", value: "Safe" }, { label: "To", value: "SOL wallet" }]), [{ label: "From", value: "Safe, Private, ETH (RH) wallet" }, { label: "To", value: "SOL wallet, NEAR wallet" }]);
  assert.deepEqual(rows.jobFacts(toNear(), [{ label: "From", value: "ETH (RH) wallet" }]), [{ label: "From", value: "ETH (RH) wallet" }], "control");
});

test("53 (2): a finished step's line is its date alone, no \"Done\"; the live step says \"Going\", a stopped one \"Stopped\" (on b72730c69: \"7 Nov, 8:08 am · Done\")", () => {
  assert.equal(proof.stepLine({ ended: true }, "7 Nov, 8:08 am"), "7 Nov, 8:08 am");
  assert.equal(proof.stepLine({ live: true } as never, ""), "Going");
  assert.equal(proof.stepLine({ stopped: true } as never, "7 Nov, 8:08 am"), "7 Nov, 8:08 am · Stopped");
  const pg = proof.withTrackSteps({ steps: [], swaps: [] }, { startMs: T0, steps: [{ label: "a", state: "done", atMs: 0 }, { label: "b", state: "doing" }, { label: "c", state: "failed" }, { label: "d", state: "waiting" }] });
  assert.deepEqual(pg.steps.map((s) => [!!(s as { live?: true }).live, !!(s as { stopped?: true }).stopped]), [[false, false], [true, false], [false, true], [false, false]]);
});

test("53 (4): the line under the title has no full stop before the dot (on b72730c69: \"In your SOL and NEAR wallets. · 7 Nov, 8:08 am\"); control: no time, the words as they are", () => {
  assert.equal(proof.headLine?.("In your SOL and NEAR wallets.", "7 Nov, 8:08 am"), "In your SOL and NEAR wallets · 7 Nov, 8:08 am");
  assert.equal(proof.headLine?.("In your SOL wallet.", undefined), "In your SOL wallet.");
  assert.match(readFileSync(new URL("./screens/ActivityDetail.tsx", import.meta.url), "utf8"), /headLine\(line, when\(atIso\)\)/);
});

test("53 (5): a card's step words never repeat a figure its title shows (on b72730c69: \"Through NEAR Confidential · about $119.33\" under \"Move $119.33 ...\"); control: a figure the title doesn't show stays", () => {
  const title = "Move $119.33 to your SOL and NEAR wallets";
  assert.equal(jobWords.cardStep?.("Through NEAR Confidential · about $119.33", title), "Through NEAR Confidential");
  assert.equal(jobWords.cardStep?.("It's in your SOL wallet · about $12.33", title), "It's in your SOL wallet · about $12.33", "control");
  assert.equal(jobWords.cardStep?.("Left your ETH (RH) wallet · about $9.46", undefined), "Left your ETH (RH) wallet · about $9.46", "control: no title");
  // every card line: the Activity centre's going line and Home's row
  assert.match(readFileSync(new URL("../../../shell-api/src/TaskCentre.tsx", import.meta.url), "utf8"), /cardStep\(step\.label, t\.title\)/);
  assert.match(readFileSync(new URL("./money/LiveTrack.tsx", import.meta.url), "utf8"), /cardStep\(step\.label, t\.title\)/);
});

// the audit's MUST (7 Nov): "This step is private" goes only on a step whose own action happens inside NEAR Confidential; a Move
// to any wallet ends in a public tx, so never on its landing or Finished. Each fails on 7b929f1e2
const privateOnly = (o: Partial<SpendingActivity>) => row({ id: `mv-po-${o.goesTo?.[0] ?? "near"}`, via: "private", paid: ["pocket-send:9"], paidDone: true, usd: "5.00", words: "Moved $5.00", ...o });
const said = (pg: ReturnType<typeof proof.spendingPage>) => [pg.finished, ...pg.steps.flatMap((s) => [s.start, s.end])].filter((e) => e && "private" in e).length;
test("the audit's MUST: a Move from Private alone to the SOL wallet says \"This step is private\" on neither its Finished nor its landing step (on 7b929f1e2: Finished said it)", () => {
  const r = privateOnly({ goesTo: ["sol"], landed: ["sol"] });
  const pg = proof.spendingPage(r);
  assert.equal(pg.finished, undefined);
  const full = proof.withTrackSteps(pg, moveTrack(r));
  assert.equal(full.steps.at(-1)!.end, undefined, "the landing step");
  assert.equal(full.steps.at(-1)!.label, "It's in your SOL wallet.");
});
test("the audit's MUST: the same for the NEAR wallet (on 7b929f1e2: Finished said it)", () => {
  const r = privateOnly({});
  const pg = proof.spendingPage(r);
  assert.equal(said(pg), 0);
  const full = proof.withTrackSteps(pg, moveTrack(r));
  assert.equal(full.steps.at(-1)!.end, undefined, "the landing step");
});
test("the audit's MUST control: the private step itself, \"NEAR Confidential paid ...\", carries the line (on 7b929f1e2: no step did, Finished did)", () => {
  const r = privateOnly({ goesTo: ["sol"], landed: ["sol"] });
  const full = proof.withTrackSteps(proof.spendingPage(r), moveTrack(r));
  const pay = full.steps.find((s) => /^NEAR Confidential paid /.test(s.label))!;
  assert.deepEqual(pay.end, { private: true });
  assert.equal(full.steps.filter((s) => s.end && "private" in s.end).length, 1, "that step only");
  assert.equal(proof.insideConfidential?.({ label: "It's in your SOL wallet.", state: "done" }), false, "never a landing");
});
