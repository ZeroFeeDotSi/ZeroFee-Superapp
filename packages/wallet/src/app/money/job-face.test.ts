// The bug report (6 Nov, his phone): a "Move stopped" page with its title twice, a bare "Stopped", no reason, no
// money line and no button, over steps "NEAR Confidential moved it to Private ✓", "NEAR Confidential paid your ETH (RH)
// wallet ✓", "Robinhood Chain is landing it in your ETH (RH) wallet" (unticked). Lead (a), the one that matched: a merely
// SLOW Move was published to the Activity centre as "stopped" with no words (taskOf), Home dropped the slow track after 2
// min (liveNow), and the centre's wordless copy drew the page (startingTracks). Lead (b): a wallet Move whose second leg
// never started had a zero-button face (moveStopFace). Each table below fails without its fix; each has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { LANDED_UNREAD, PRIVATE_KEEP_MS } from "@zerofee/core/private-route";
import { DONE_SHOWN_MS, SLOW_MS, foldInto, liveNow, moveTrack, privateMoney, publishTracks, routeMoney, rowTitle, homeRows, oldStop, slowed, startingTracks, stamp, stillGoing, taskOf, taskState, wordlessStop, type LiveTrack, type Seen } from "./live-steps.ts";
import { FACE_WORDS, jobFace, stepWord, stopLine, type FaceState } from "./job-face.ts";

const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "222", status: "on-its-way", shown: true, atIso: iso(T0), words: "Move $222.00 to your Robinhood wallet", ...o });
/** The owner's Move: from the Safe, paid from Private after the Safe's fill, NEAR Confidential's payment done, the landing unread. */
const OWNER = row({ via: "private", goesTo: ["hood"], fill: "done", paidDone: true, askedUsd: "222" });
const live = (r: SpendingActivity, now: number, seen: Seen = {}): LiveTrack => slowed(stamp(moveTrack(r, undefined, undefined)!, seen, now), now);
/** The test shot: NEAR Confidential paid, the ETH (RH) wallet's reads failing (float-private missedRead: LANDED_UNREAD). */
const UNREAD = { ...OWNER, note: LANDED_UNREAD };

// ---- lead (a): slow is still going, never "stopped" ----

test("taskState: a slow or unshown job stays pending in the Activity centre; never \"stopped\" (the bug)", () => {
  const table: [LiveTrack["end"], string][] = [
    [undefined, "pending"],
    [{ ok: false, slow: true, line: "Slower than usual." }, "pending"],
    [{ ok: false, slow: true, unshown: true, whole: true, line: "x" }, "pending"],
    [{ ok: true, line: "In your SOL wallet." }, "done"],
    [{ ok: false, line: "It stopped." }, "failed"],
  ];
  for (const [end, want] of table) assert.equal(taskState({ ...(end ? { end } : {}) }), want, JSON.stringify(end));
  // the owner's own Move, 20 min on: slow, and its task pending with its words
  const t = live(OWNER, T0 + SLOW_MS + 5 * 60_000);
  assert.equal(t.end?.slow, true);
  assert.equal(taskOf(t).state, "pending");
});

test("liveNow keeps a slow job on Home past DONE_SHOWN_MS (its place never goes to a wordless copy); a done one still leaves", () => {
  // the owner's: its end (slow, LANDED_UNREAD) seen at once, so stamp gave it an endMs; 30 min on it was dropped from Home
  const seen: Seen = {};
  live(UNREAD, T0 + 60_000, seen);
  const now = T0 + 30 * 60_000;
  const slow = live(UNREAD, now, seen);
  assert.ok((slow.endMs ?? now) < now - DONE_SHOWN_MS, "its endMs is long past");
  assert.equal(taskOf(slow).state, "pending");
  assert.deepEqual(liveNow([slow], now).map((t) => t.id), [slow.id]);
  const done = live(row({ id: "r2", via: "private", goesTo: ["hood"], status: "done", landed: ["hood"] }), now);
  assert.deepEqual(liveNow([done], now + DONE_SHOWN_MS * 10), [], "control: a done job leaves");
});

test("startingTracks: a Move task an older build ended \"stopped\" with no words reads as still on its way, never \"Move stopped\"", () => {
  const base: Task = { id: "move:mv-abc", app: "home", title: "Move $222.00 to your Robinhood wallet", state: "stopped", startedAt: T0, endedAt: T0 + SLOW_MS, steps: [{ label: "NEAR Confidential moved it to Private.", state: "done" }, { label: "NEAR Confidential paid your Robinhood wallet.", state: "done" }, { label: "Robinhood Chain is landing it in your Robinhood wallet.", state: "waiting" }] };
  assert.equal(wordlessStop(base), true);
  const [t] = startingTracks([base], T0 + SLOW_MS + 60_000);
  assert.equal(t?.end?.slow, true);
  assert.equal(rowTitle(t!), "Move $222.00 to your Robinhood wallet");
  assert.equal(jobFace(t!).bar, "Move");
  // control: a stop that said why stays a stop
  const [s] = startingTracks([{ ...base, detail: "Nothing moved. Your money is still in your Safe." }], T0 + SLOW_MS + 60_000);
  assert.equal(s?.end?.slow, undefined);
  assert.equal(rowTitle(s!), "Move stopped");
});

test("publishTracks: an ended task in the store gets the slow job's words, never a bare Stopped; a stop ends with its words", () => {
  const store = taskStore();
  for (const t of store.list()) store.remove(t.app, t.id);
  const tasks = store.forApp("wallet");
  const slow = live(OWNER, T0 + SLOW_MS + 60_000);
  tasks.publish({ id: slow.id, title: slow.title, steps: [] });
  tasks.end(slow.id, "stopped");
  publishTracks(tasks, [slow], new Map());
  const kept = store.list().find((t) => t.id === slow.id)!;
  assert.match(kept.detail ?? "", /^Slower than usual\. It's on its way to your Robinhood wallet\./);
  const stop = live(row({ id: "r3", via: "private", goesTo: ["hood"], status: "failed", note: "NEAR Confidential sent it back" }), T0 + 60_000);
  publishTracks(tasks, [stop], new Map());
  assert.match(store.list().find((t) => t.id === stop.id)!.detail ?? "", /NEAR Confidential didn't pay your Robinhood wallet/);
});

// ---- the owner's page now ----

test("the owner's Move on its page: title once \"Move\", Landing lit, money on its way to the Robinhood wallet, who hasn't shown it, Activity and Close", () => {
  const f = jobFace(live(UNREAD, T0 + 60_000));
  assert.equal(f.state, "slow");
  assert.equal(f.bar, "Move");
  assert.equal(f.what, "Move $222.00 to your Robinhood wallet");
  assert.equal(f.figure, "$222.00");
  assert.deepEqual([f.at, f.bad], [2, false]);
  assert.deepEqual(f.money, { lead: "Your money is on its way to ", place: "your Robinhood wallet" });
  // waiting (the copy review's ruling, 6 Nov): "<who> is taking longer than usual. ZeroFee keeps checking."
  assert.equal(f.reason, "Robinhood Chain is taking longer than usual. ZeroFee keeps checking.");
  assert.deepEqual(f.choices, []);
  // and merely slow (SLOW_MS): the same page, its words "taking longer"
  assert.equal(jobFace(live(OWNER, T0 + SLOW_MS + 60_000)).reason, "Robinhood Chain is taking longer than usual. ZeroFee keeps checking.");
  assert.equal(f.out, "x", "the way out is the bar's X; no floor button");
});

// ---- the money line follows the ticks (privateMoney, routeMoney) ----

test("privateMoney: where a Move paid from Private has the money, by its reads only", () => {
  const to = ["hood"];
  const table: [Partial<SpendingActivity>, boolean, object][] = [
    [{ fill: "doing" }, false, { at: ["safe"] }],
    [{ fill: "done" }, false, { at: ["private"] }],
    [{}, false, { at: ["private"] }],
    [{ paidDone: true }, false, { at: ["hood"], going: true }],
    [{ paidDone: true, note: LANDED_UNREAD }, false, { at: ["hood"], going: true }],
    [{ paidDone: true, landed: ["hood"] }, false, { at: ["hood"], proven: true }],
    [{ status: "done" }, false, { at: ["hood"], proven: true }],
    [{ status: "failed", note: "NEAR Confidential sent it back" }, true, { at: ["private"], proven: true }],
    // the audit (6 Nov): unsure is its own place, "either in Private or still with NEAR Intents", never "on its way"
    [{ status: "failed", unsure: true }, false, { at: ["private"], unknown: true, unsure: true }],
    [{ status: "failed", onWay: true }, true, { at: ["hood"], unknown: true }],
    [{ status: "failed", paidDone: true }, false, { at: ["hood"], unknown: true }],
    [{ status: "refused" }, false, { at: ["private"], proven: true }],
  ];
  for (const [o, back, want] of table) {
    const { from: _f, to: _t, usd: _u, ...got } = privateMoney({ status: "on-its-way", ...o } as SpendingActivity, to, { back, usd: null });
    assert.deepEqual(got, want, JSON.stringify(o));
  }
});

test("routeMoney: a Move through the NEAR wallet; a later part that never started left it in the NEAR wallet; any other stop unknown", () => {
  const b = { from: ["sol"], to: ["hood"], arrived: false, mid: false, left: false, first: false, mover: "near" };
  const at = (o: Partial<typeof b> & { bad?: { status: string; note: string } }) => { const { from: _f, to: _t, ...g } = routeMoney({ ...b, ...o }); return g; };
  assert.deepEqual(at({}), { at: ["sol"] });
  assert.deepEqual(at({ left: true }), { at: ["near"], going: true });
  assert.deepEqual(at({ left: true, mid: true }), { at: ["hood"], going: true });
  assert.deepEqual(at({ arrived: true }), { at: ["hood"], proven: true });
  assert.deepEqual(at({ first: true, bad: { status: "refused", note: "That wallet doesn't have that much." } }), { at: ["sol"], proven: true });
  assert.deepEqual(at({ first: true, bad: { status: "failed", note: "1Click didn't finish this." } }), { at: ["sol"], unknown: true });
  assert.deepEqual(at({ bad: { status: "failed", note: "It came back to your NEAR wallet." } }), { at: ["near"], proven: true });
  assert.deepEqual(at({ bad: { status: "failed", note: "It never left its wallet." } }), { at: ["near"], proven: true });
  assert.deepEqual(at({ bad: { status: "failed", note: "Solana didn't confirm it." } }), { at: ["hood"], unknown: true });
});

// ---- lead (b): a wallet Move whose leg 2 never started, and every ended face ----

/** A wallet → wallet Move (SOL wallet to ETH (RH) wallet): its leg into the NEAR wallet landed; its leg on as given. */
const walletMove = (leg: Partial<SpendingActivity>) => moveTrack({ ...row({ id: "w1", kind: "move", network: "sol", to: "hood", status: "done", usd: "40", words: "Move $40.00" }), legs: [row({ id: "w1b", kind: "move", of: "w1", network: "hood", usd: "40", ...leg })] }, undefined, undefined)!;

test("lead (b): leg 2 not started (float-jobs NOT_STARTED) is a mid-way stop with Resume and the way back, never zero buttons", () => {
  for (const note of ["It came back to your NEAR wallet.", "It never left its wallet."]) {
    const t = walletMove({ status: "failed", note });
    const f = jobFace(t);
    assert.equal(f.state, "mid", note);
    assert.equal(f.bar, "Move stopped");
    assert.deepEqual(f.money, { lead: "Your money is here: ", place: "your NEAR wallet" });
    assert.deepEqual(f.choices.map((n) => [n.label, n.go]), [["Resume", { kind: "move", from: "near", to: "hood", usd: "40.00" }], ["Send it back to your SOL wallet", { kind: "move", from: "near", to: "sol" }]]);
    assert.equal(f.out, "x");
    // the old face it had: moveStopFace's taps, none (the audit's lead)
    assert.deepEqual(t.next ?? [], []);
  }
  // control: a leg on whose money no read places is never a button (a re-tap could pay twice)
  const u = jobFace(walletMove({ status: "failed", note: "Robinhood Chain didn't confirm it." }));
  assert.equal(u.state, "unknown");
  assert.deepEqual(u.choices, []);
  assert.deepEqual(u.money, { lead: "Your money is ", place: "on its way" });
  assert.doesNotMatch(u.reason ?? "", /keeps checking/, "a stop never says keeps checking (copy review)");
});

/** One fixture per face (going, slow, stopped mid-way, nothing moved, refunded back, landed late, unknown, done). */
const NOW = T0 + 60_000;
const FACES: [FaceState, LiveTrack][] = [
  ["going", live(OWNER, NOW)],
  ["slow", live(OWNER, T0 + SLOW_MS + 60_000)],
  ["mid", walletMove({ status: "failed", note: "It came back to your NEAR wallet." })],
  ["nothing", moveTrack(row({ id: "n1", kind: "put-away", network: "sol", status: "refused", note: "That wallet doesn't have that much.", usd: "40", words: "Move $40.00 to your Safe" }), undefined, undefined)!],
  ["back", live(row({ id: "b1", via: "private", goesTo: ["hood"], status: "failed", note: "NEAR Confidential sent it back", missed: ["hood"], missedUsd: "222" }), NOW)],
  ["late", moveTrack(row({ id: "l1", kind: "put-away", network: "sol", unshown: true, note: "NEAR Intents says it's in your Safe. Your Safe hasn't shown it yet.", usd: "40", words: "Move $40.00 to your Safe" }), undefined, undefined)!],
  ["unknown", live(row({ id: "u1", via: "private", goesTo: ["hood"], status: "failed", unsure: true, note: "NEAR Confidential didn't finish. Your money is either in Private or still with NEAR Intents. Check Private first." }), NOW)],
  ["done", live(row({ id: "d1", via: "private", goesTo: ["hood"], status: "done", landed: ["hood"] }), NOW)],
];

test("every face: its state; the title once; a money line with a Home name; 0 to 2 choices; the bar's X on every face", () => {
  for (const [want, t] of FACES) {
    const f = jobFace(t);
    assert.equal(f.state, want, t.id);
    assert.notEqual(f.what, f.bar, `${want}: the title is said once (the bar), the line under the figure is what it is`);
    // the copy review (7 Nov): the unsure line is its own sentence, "Either in <place> or still with NEAR Intents."
    assert.ok(f.money!.lead.startsWith("Your money is") || f.money!.lead === "Either in ", want);
    assert.match(f.money!.place, /^(Private|your Safe|your (SOL|Robinhood|NEAR|BNB) wallet|on its way|either in Private or still with NEAR Intents)$/, want);
    assert.ok(f.choices.length <= 2, want);
    assert.equal(f.out, "x", `${want}: never a dead end (the bar's X)`);
    assert.ok(!f.choices.some((n) => n.go.kind === "close" || n.go.kind === "activity"), `${want}: no Close or Activity button in the floor (copy review)`);
    if (f.reason) assert.doesNotMatch(f.reason, /Not signed|[(;]/, want);
    assert.notEqual(f.reason, "Stopped", want);
    // the bad dot is where it stopped (main's checkpointAt since d2892bfa7: the leg under way is Moving), never Done
    if (f.bad) assert.ok(f.at < 3, `${want}: a stop is never on Done`);
  }
});

test("choices by face: back = Resume + Send it back to the Safe; nothing for funds = Try a smaller amount (never a bare Try again); slow, late, unknown, done = none", () => {
  const by = Object.fromEntries(FACES.map(([s, t]) => [s, jobFace(t).choices.map((n) => n.label)]));
  assert.deepEqual(by.back, [FACE_WORDS.resume, FACE_WORDS.back]);
  assert.deepEqual(by.nothing, [FACE_WORDS.smaller]);
  for (const s of ["going", "slow", "late", "unknown", "done"]) assert.deepEqual(by[s], [], s);
  const back = jobFace(FACES.find(([s]) => s === "back")![1]);
  assert.deepEqual(back.choices[0]!.go, { kind: "move", to: "hood", usd: "222.00" }, "Resume is the person's Move again: the Move sheet asks for any signature");
  assert.deepEqual(back.money, { lead: "Your money is here: ", place: "Private" });
  const nothing = jobFace(FACES.find(([s]) => s === "nothing")![1]);
  assert.equal(nothing.reason, "Your SOL wallet doesn't hold that much. Nothing moved.");
  assert.deepEqual([nothing.at, nothing.bad], [0, true]);
  assert.equal("usd" in nothing.choices[0]!.go, false, "a smaller amount: the figure is the person's to set");
});

// ---- the copy review's rulings on the page (6 Nov): the words, the steps' one word, the floor ----

/** A place a line says the money is in ("It's in Private.", "NEAR Intents says it's in your Safe."), if it says one. */
const saysIn = (w: string) => /(?:it's|It's|is) (?:back )?in (Private|your Safe|your SOL wallet|your Robinhood wallet|your NEAR wallet|your BNB wallet)/.exec(w)?.[1];

test("money truth: on every face the money line and the reason line never disagree (a place said is the money line's, here)", () => {
  for (const [want, t] of FACES) {
    const f = jobFace(t);
    const said = saysIn(f.reason ?? "");
    if (said) assert.deepEqual(f.money, { lead: "Your money is here: ", place: said }, `${want}: the reason says ${said}`);
    if (f.money!.place === "on its way") assert.equal(said, undefined, `${want}: money unknown, the line names no place`);
    if (want === "late" || want === "back" || want === "nothing" || want === "mid") assert.equal(f.money!.lead, "Your money is here: ", `${want}: a read places it`);
  }
  const late = jobFace(FACES.find(([s]) => s === "late")![1]);
  assert.deepEqual(late.money, { lead: "Your money is here: ", place: "your Safe" }, "landed late: here, by NEAR Intents' read");
  // the audit (6 Nov): an unsure part (1Click FAILED, a hold past the keep) says where it may be, never "on its way"
  const unknown = jobFace(FACES.find(([s]) => s === "unknown")![1]);
  assert.deepEqual(unknown.money, { lead: "Either in ", place: "Private", after: " or still with NEAR Intents." });
  assert.equal(unknown.reason, "Check Private first.", "the reason line is what to do, the place said once");
  // the same truth from a job its builder didn't place: its own end's unsure words
  const said = { ...live(OWNER, NOW), money: undefined, end: { ok: false, line: "NEAR Confidential didn't finish. Your money is either in Private or still with NEAR Intents. Check Private first." } } as LiveTrack;
  assert.deepEqual(jobFace(said).money, { lead: "Either in ", place: "Private", after: " or still with NEAR Intents." }); // 53, 7 Nov: the place in its slot
  // control: a payment still on its way (onWay, not unsure): on its way, never the unsure place
  const paid = jobFace(live(row({ id: "u2", via: "private", goesTo: ["hood"], status: "failed", onWay: true }), NOW));
  assert.equal(paid.state, "unknown");
  assert.deepEqual(paid.money, { lead: "Your money is ", place: "on its way" });
  assert.doesNotMatch(paid.reason ?? "", /either in Private/);
});

test("refund place by the leg's own record (audit, 6 Nov): a float leg back in the NEAR wallet says so; a leg paid from Private says Private", () => {
  const float = jobFace(FACES.find(([s]) => s === "mid")![1]);
  assert.deepEqual(float.money, { lead: "Your money is here: ", place: "your NEAR wallet" }, "a wallet-to-wallet leg refunds to the NEAR wallet's own balance");
  const priv = jobFace(FACES.find(([s]) => s === "back")![1]);
  assert.deepEqual(priv.money, { lead: "Your money is here: ", place: "Private" }, "a leg paid from Private refunds to Private");
});

test("the back face names who sent it back, and where it is", () => {
  const back = jobFace(FACES.find(([s]) => s === "back")![1]);
  assert.equal(back.reason, "NEAR Confidential sent it back. It's in Private.");
});

test("words: waiting says keeps checking; a stop never does; Nothing is lost only where a read proves the place", () => {
  const by = Object.fromEntries(FACES.map(([st, t]) => [st, jobFace(t).reason]));
  assert.match(by.slow ?? "", /is taking longer than usual\. ZeroFee keeps checking\.$/);
  for (const st of ["mid", "nothing", "back", "late", "unknown"]) assert.doesNotMatch(by[st] ?? "", /keeps checking/, st);
  for (const st of ["late", "unknown"]) assert.ok((by[st] ?? "").length > 0, st);
  for (const st of Object.keys(by)) assert.notEqual(by[st], "ZeroFee keeps checking.", st);
  // stopLine: the table
  const table: [string, boolean, string][] = [
    ["Robinhood Chain didn't answer in time. Nothing is lost.", true, "Robinhood Chain didn't answer in time. Nothing is lost."],
    ["Robinhood Chain didn't answer in time. Nothing is lost.", false, "Robinhood Chain didn't answer in time."],
    ["Solana didn't confirm it. ZeroFee keeps checking.", true, "Solana didn't confirm it."],
    ["It came back to your NEAR wallet.", false, "It came back to your NEAR wallet."],
  ];
  for (const [w, proven, want] of table) assert.equal(stopLine(w, proven), want, `${w} ${proven}`);
});

test("steps: each once with one word (Done, Stopped here, Not yet); the step going now has none", () => {
  const table: [Parameters<typeof stepWord>[0], Parameters<typeof stepWord>[1], string | undefined][] = [
    ["done", "going", "Done"], ["doing", "going", undefined], ["waiting", "going", "Not yet"],
    ["done", "stopped", "Done"], ["doing", "stopped", "Stopped here"], ["failed", "stopped", "Stopped here"], ["waiting", "stopped", "Not yet"],
    ["doing", "ended", "Not yet"], ["done", "ended", "Done"],
  ];
  for (const [st, face, want] of table) assert.equal(stepWord(st, face), want, `${st} ${face}`);
  for (const [want, t] of FACES) {
    const f = jobFace(t);
    assert.equal(f.steps.length, t.steps.length, want);
    for (const x of f.steps) assert.ok(!x.word || !x.label.includes(x.word), `${want}: the word once`);
    assert.ok(f.steps.filter((x) => x.word === "Stopped here").length <= (f.bad ? 1 : 0), `${want}: Stopped here at most once, only on a stop`);
    if (want === "mid") assert.equal(f.steps.filter((x) => x.word === "Stopped here").length, 1, "mid: where it stopped");
  }
});

test("a wordless stop past the keep (PRIVATE_KEEP_MS from its tap) with no core row is the unknown face, not going; within it, on its way; a core row wins", () => {
  const base: Task = { id: "move:mv-old", app: "home", title: "Move $222.00 to your Robinhood wallet", state: "stopped", startedAt: T0, endedAt: T0 + SLOW_MS, steps: [{ label: "NEAR Confidential moved it to Private.", state: "done" }, { label: "Robinhood Chain is landing it.", state: "waiting" }] };
  const table: [number, "going" | "unknown"][] = [[T0 + 60 * 60_000, "going"], [T0 + PRIVATE_KEEP_MS - 1, "going"], [T0 + PRIVATE_KEEP_MS, "unknown"], [T0 + PRIVATE_KEEP_MS + 30 * 60_000, "unknown"]];
  for (const [now, want] of table) {
    assert.equal(oldStop(base, now), want, String(now - T0));
    const [t] = startingTracks([base], now);
    assert.ok(t, `${now - T0}: still shown`);
    assert.equal(stillGoing(t!), want === "going", `${now - T0}: going on Home`);
    const f = jobFace(t!);
    // within the keep: no read places it, but it is still followed (the late face: title "Move", no bad dot, no choice)
    assert.equal(f.state, want === "going" ? "late" : "unknown", `${now - T0}`);
    assert.equal(f.bar, want === "going" ? "Move" : "Move stopped", `${now - T0}`);
    if (want === "unknown") {
      assert.deepEqual(f.money, { lead: "Your money is ", place: "on its way" });
      assert.equal(f.reason, "Robinhood Chain hasn't shown it yet.");
      assert.deepEqual(f.choices, []);
    }
  }
  // the unknown face shows its hour, then leaves Home
  assert.deepEqual(startingTracks([base], T0 + PRIVATE_KEEP_MS + 61 * 60_000), []);
  // control: with the core's own row by its id, the row wins (homeRows)
  const [old] = startingTracks([base], T0 + PRIVATE_KEEP_MS + 60_000);
  const core = live(UNREAD, T0 + 60_000);
  assert.deepEqual(homeRows([old!], [{ ...core, id: old!.id }]), []);
  assert.deepEqual(homeRows([old!], [core]).map((x) => x.id), [old!.id]);
});

// ---- the copy review's MUST 2 (Activity train, 6 Nov): one $161 Move showed two going rows on Now ----

test("foldInto: two rows saved under one job are one track and one task (the Safe's top-up and the wallet's leg share no `of`)", () => {
  const safe = row({ id: "top1", kind: "top-up", usd: "150", words: "Move $161.00 to your Robinhood wallet", atIso: iso(T0) });
  const leg = row({ id: "leg1", kind: "move", network: "sol", to: "hood", usd: "11", words: "Move $11.00", atIso: iso(T0 + 2_000) });
  const other = row({ id: "x9", kind: "top-up", usd: "5", words: "Move $5.00 to your SOL wallet", atIso: iso(T0 + 1_000) });
  const jobs: Record<string, string> = { top1: "job:A", leg1: "job:A", x9: "job:B" };
  const folded = foldInto([leg, safe, other], (id) => jobs[id]);
  assert.deepEqual(folded.map((f) => [f.id, (f.legs ?? []).map((l) => l.id)]), [["top1", ["leg1"]], ["x9", []]]);
  const tracks = folded.flatMap((f) => { const t = moveTrack(f, undefined, undefined); return t ? [t] : []; });
  assert.equal(tracks.filter((t) => t.id.includes("top1") || t.id.includes("leg1")).length, 1, "one track for the job");
  assert.equal(new Set(tracks.map((t) => taskOf(t).id)).size, tracks.length, "one task per track");
  // control: with no job saved (an older row), each is its own, as before
  assert.equal(foldInto([leg, safe], () => undefined).length, 2);
  // control: `of` still wins where a row carries one
  assert.deepEqual(foldInto([safe, { ...leg, of: "top1" }], () => undefined).map((f) => f.id), ["top1"]);
});
