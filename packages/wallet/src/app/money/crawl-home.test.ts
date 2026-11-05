// QA's Sim crawl (cut d35c2e524, 5 Nov) and its lap on main (realmoney-all/2026-11-05T-move-swap-main-lap):
// a stopped job says who failed, the figure, where it is by name, and a next tap that works (rule 8; 081, 083); every
// job step names who does the work and its page lists every step (rule 11; 351, 358); a row's tick agrees with its line
// (051). Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import { endLine, moveTrack, sendTrack, STOP_WORDS } from "./live-steps.ts";
import { rowTicked, legsLine } from "../activity-rows.ts";
import { withTrackSteps, spendingPage } from "../proof.ts";

const T0 = Date.parse("2026-11-05T08:33:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-1", kind: "top-up", usd: "14.00", status: "on-its-way", shown: true, atIso: iso(0), words: "Moving $14.00 to your SOL wallet", goesTo: ["sol"], via: "private", ...o } as SpendingActivity);
const mv = (o: Partial<Movement>): Movement => ({ id: "s1", kind: "pay", status: "moving", amount: "5000000", startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], to: "alice.near", private: true, ...o });

test("rule 8 (081): a Move paid from Private that came back names NEAR Confidential, the wallet, the figure back in Private, and offers Try again (lit) then Open Private", () => {
  const t = moveTrack(row({ status: "failed", note: "NEAR Confidential sent it back. Your money is in Private." }))!;
  assert.equal(endLine(t), "NEAR Confidential didn't pay your SOL wallet. The $14.00 is back in Private.");
  assert.deepEqual(t.next, [{ label: "Try again", go: { kind: "move", to: "sol", usd: "14.00" } }, { label: "Open Private", go: { kind: "private" } }]);
  // control: the old line, twice named, no figure, and no tap
  assert.doesNotMatch(endLine(t)!, /didn't finish paying|sent it back|Your money is in Private/);
  // a part that never started keeps the core's own reason, with the same taps
  const own = moveTrack(row({ status: "failed", note: "SOL wallet: it wasn't sent" }))!;
  assert.match(endLine(own)!, /it wasn't sent/);
  assert.equal(own.next?.[0]?.label, "Try again");
  // going or done: no taps
  assert.equal(moveTrack(row({}))!.next, undefined);
  assert.equal(moveTrack(row({ status: "done" }))!.next, undefined);
});

test("rule 8 (083): a Send that came back says who didn't pay, the figure and where it is by name; Open Private when it's there, else Send again", () => {
  const priv = sendTrack(mv({ status: "refunded", explorerUrls: ["https://nearblocks.io/txns/abc"] }), "safe", "alice.near", "$5.00")!;
  assert.equal(endLine(priv), "NEAR Confidential didn't pay that address. The $5.00 is back in Private.");
  assert.deepEqual(priv.next, [{ label: "Open Private", go: { kind: "private" } }]);
  const plain = sendTrack(mv({ status: "refunded", private: false }), "safe", "alice.near", "$5.00")!;
  assert.equal(endLine(plain), "NEAR Intents didn't pay that address. The $5.00 is back in your Safe.");
  assert.deepEqual(plain.next, [{ label: "Send again", go: { kind: "send", wallet: "safe" } }]);
  assert.equal(STOP_WORDS.sendPaid("NEAR Confidential", null, "Private"), "NEAR Confidential didn't pay that address. Your money is back in Private.", "no figure known: never a blank");
  // control: the old words
  assert.doesNotMatch(endLine(priv)!, /where it left from|Through NEAR Confidential didn't finish/);
  // the tracker draws the taps and LiveHome follows them to Move, Private's screen and Send
  const live = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(live, /t\.next\?\.map\(\(n, i\) => <button key=\{n\.label\}/);
  assert.match(live, /if \(go\.kind === "private"\) shell\.openApp\("wallet", "private"\);/);
  assert.match(live, /shell\.openMoney\(\{ kind: "move", from: "safe", to: go\.to as HomeWallet/);
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(t === "private" && privateOpen\(\)\) return \{ kind: "private" \};/, "Private's screen is on this base, reached by its request");
});

test("the product Jobs rule (a test run): a move home names who does the work while it runs, and says where once read (control: 'Arriving in your Safe' named no one)", () => {
  const home = (o: Partial<SpendingActivity>) => moveTrack({ id: "pa-1", kind: "put-away", usd: "2.04", status: "on-its-way", shown: true, atIso: iso(0), words: "Moving $2.04 to your Safe", network: "near", ...o } as SpendingActivity)!;
  const going = home({});
  assert.deepEqual(going.steps.map((s) => s.label), ["Left your NEAR wallet", "Through NEAR Confidential", "NEAR is landing it in your Safe"]);
  assert.equal(going.steps.find((s) => s.state === "doing")?.label, "NEAR is landing it in your Safe");
  assert.ok(going.steps.every((s) => !/^Arriving in/.test(s.label)), "control: the old step named no one");
  const done = home({ status: "done" });
  assert.deepEqual(done.steps.map((s) => s.label), ["Left your NEAR wallet", "Through NEAR Confidential", "In your Safe"]);
});

test("rule 11 (a test run): a job's page lists every step its row shows, ticked only where the reads ticked them; its proof stays on the first and last (control: no track, the old one-row page)", () => {
  const r = row({ status: "on-its-way", fill: "done" } as Partial<SpendingActivity>);
  const t = moveTrack(r)!;
  const page = withTrackSteps(spendingPage(r), t);
  assert.equal(page.steps.length, t.steps.length);
  assert.deepEqual(page.steps.map((s) => s.label), t.steps.map((s) => s.label));
  assert.deepEqual(page.steps.map((s) => !!s.ended), t.steps.map((s) => s.state === "done"), "a step reads done only where the job's reads ticked it");
  assert.deepEqual(withTrackSteps(spendingPage(r), null), spendingPage(r), "control: no track, the page as it was");
  const activity = readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(activity, /page: withTrackSteps\(spendingPage\(s, activity\), Steps\?\.moveTrack\(s\)\)/);
});

test("Sim test: a row's tick agrees with its line: never 'On its way' beside a tick (control: done in every wallet is ticked)", () => {
  const short = { id: "m", kind: "top-up", usd: "11.00", status: "done", shown: true, atIso: iso(0), words: "Moved $11.00 to your SOL wallet", goesTo: ["sol"] } as SpendingActivity;
  assert.match(legsLine(short), /On its way/);
  assert.equal(rowTicked(short), false);
  const there = { ...short, legs: [{ ...short, id: "l", kind: "ready", network: "sol", status: "done" } as SpendingActivity] };
  assert.equal(rowTicked(there), true, "control: in every wallet, ticked");
  // paid from Private (no leg rows), one rule (the audit's rule 11, notLanded): ticked only once the wallet's own read showed it
  const priv = { ...short, via: "private" } as SpendingActivity;
  assert.equal(rowTicked({ ...priv, landed: ["sol"] }), true, "paid from Private: ticked once its SOL wallet's read showed it");
  assert.equal(rowTicked(priv), false, "control: paid from Private, the ledger's done alone is not landed");
  assert.match(legsLine(priv), /On its way/, "its line agrees with its tick");
});
