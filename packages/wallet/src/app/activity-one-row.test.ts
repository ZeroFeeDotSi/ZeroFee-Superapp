// Activity, 7 Nov (fix/activity-one-row): one Move, one row; a Send's row says what was signed and where a refund is; step
// lines never leave one lone word; ended rows say their date; a stopped Move's reason line is plain. Each table fails on
// main's code (named per test); each has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "../../../trade/src/float-core.ts";
import type { Movement, Token } from "../types.ts";
import { activityRows, foldJobs, jobRowLine, joinTracks, movementEnded, rowEnded, sameMove, sendJobOf, sendRowOf, whenOf } from "./activity-rows.ts";
import { describe as describeRow, ownRows } from "./format.ts";
import { moveTrack, openTrackOf, type LiveTrack } from "./money/live-steps.ts";
import { jobFace, linePhrases, plainLine, unsureLine } from "./money/job-face.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;

/** The Sim's ledger and the real Spending engine (home-root.test.ts's harness): the Move sheet's own spending.topUp. */
async function sim(fromPrivate: boolean) {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 5, timers: clock.timers, float: { moveMs: 10, timers: clock.timers }, safeFillOpen: true }));
  /** A round's 60 ms of the test's own time: the engine's calls answered, then the Sim's steps due by then land in order. */
  const settle = async () => { await clock.quiet(); await clock.advance(60); };
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const ticks: (() => void)[] = [];
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: (fn) => { ticks.push(fn); return () => undefined; }, rng: () => 0.5, ...(fromPrivate ? { fromPrivate: true } : {}) });
  f.start();
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const move = async (key: string, legs: { network: string; usd: number }[]) => {
    const r = await svc.call<SpendingActivity>("spending.topUp", { usd: legs.reduce((n, l) => n + l.usd, 0), legs, key });
    assert.ok("ok" in r, JSON.stringify(r));
    return r.ok;
  };
  const run = async () => { for (let i = 0; i < 6; i++) { for (const tick of ticks) tick(); await settle(); await f.refresh(); t += 5_000; } };
  const lists = async () => {
    const sp = await svc.call<SpendingActivity[]>("spending.activity", {});
    const led = await mock.call<Movement[]>("ledger.activity", { limit: 80 });
    assert.ok("ok" in sp && "ok" in led);
    return { ledger: led.ok, spending: sp.ok };
  };
  return { mock, move, run, lists };
}
const newIds = (before: readonly Movement[], after: readonly Movement[]) => after.filter((m) => !before.some((b) => b.id === m.id));

test("item 1: a Move from the Safe to two wallets that the Safe tops up is ONE Activity row (its fill and each payment folded); on main the fill was a second row (\"Moved to Private\")", async () => {
  const s = await sim(true);
  const before = (await s.lists()).ledger;
  const row = await s.move("one-row-move-000000001", [{ network: "sol", usd: 20 }, { network: "hood", usd: 20 }]);
  await s.run();
  const { ledger, spending } = await s.lists();
  const made = newIds(before, ledger);
  assert.ok(made.some((m) => m.kind === "private"), "the Sim's Safe fill of Private is on the ledger");
  const rows = activityRows(ledger, spending);
  assert.deepEqual(rows.spending.map((r) => r.id), [row.id], "the Move's one row");
  assert.deepEqual(newIds(before, rows.ledger), [], "no fill row, no payment row: each is the Move's own (paid)");
});

test("item 1, controls: a top-up of Private on its own stays its own row; two Moves never fold together", async () => {
  const s = await sim(true);
  const before = (await s.lists()).ledger;
  const a = await s.move("one-row-move-000000002", [{ network: "sol", usd: 20 }]);
  const b = await s.move("one-row-move-000000003", [{ network: "hood", usd: 20 }]);
  await s.run();
  const { ledger, spending } = await s.lists();
  const rows = activityRows(ledger, spending);
  assert.deepEqual(rows.spending.map((r) => r.id).sort(), [a.id, b.id].sort(), "two Moves, two rows");
  assert.deepEqual(newIds(before, rows.ledger), []);
  // a move into Private that no Move paid (its own top-up): its row stays
  const own: Movement = { id: "private:own-1", kind: "private", status: "done", from: "nep141:usdc", to: "private", amount: "30", startedAtIso: new Date(0).toISOString(), updatedAtIso: new Date(0).toISOString(), explorerUrls: [] } as Movement;
  assert.ok(activityRows([...ledger, own], spending).ledger.some((m) => m.id === own.id));
});

test("item 1, core ledger id (spending.ts ledgerId): a keyed row's Safe leg on the public route (E7, a swap in the Safe) is its row, never a \"trading\" row of its own (controls: another movement stays; a plain row matches by its id)", async () => {
  const s = await sim(false);
  const before = (await s.lists()).ledger;
  const row = await s.move("one-row-move-000000004", [{ network: "sol", usd: 20 }, { network: "hood", usd: 20 }]);
  await s.run();
  const { ledger, spending } = await s.lists();
  const mine = spending.find((r) => r.id === row.id)!;
  assert.match(mine.ledgerId ?? "", /\S/, "the core names its ledger movement");
  const trading = newIds(before, ledger).filter((m) => m.kind === "trading");
  assert.deepEqual(trading.map((m) => m.id), [mine.ledgerId]);
  assert.deepEqual(newIds(before, activityRows(ledger, spending).ledger), [], "on main: the trading row stayed, a second row");
  assert.equal(sameMove({ kind: "trading", id: "mv-4" }, { id: "mv-k", ledgerId: "mv-4" }), true);
  assert.equal(sameMove({ kind: "trading", id: "mv-5" }, { id: "mv-k", ledgerId: "mv-4" }), false, "control: another movement");
  assert.equal(sameMove({ kind: "pay", id: "mv-4" }, { id: "mv-k", ledgerId: "mv-4" }), false, "control: a payment is never a Top up");
  assert.equal(sameMove({ kind: "trading", id: "mv-6" }, { id: "mv-6" }), true, "control: a row with its ledger id as its own");
});

const T0 = Date.UTC(2026, 10, 6, 15, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "40", status: "done", shown: true, atIso: iso(T0), words: "Move $40.00 to your SOL wallet", ...o });

test("item 1, the audit's check: a folded Move with one leg done and one unsure shows both places on its row, and its page lists both legs' steps (on main the row said \"Didn't go\" alone); control: all done, the job's one line", () => {
  const safe = row({ id: "s1", via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, askedUsd: "27.08", usd: "27.08", words: "Moved $27.08 to your SOL wallet" });
  const leg = row({ id: "l1", kind: "move", network: "hood", to: "sol", status: "failed", unsure: true, usd: "12.92", words: "Moving $12.92 to your SOL wallet", note: "Your money is either in Private or still with NEAR Intents. Check Private first.", atIso: iso(T0 + 1_000) });
  carryTo(["move:s1", "move:l1"], { usd: "$40.00", job: "job:fold-1" });
  const [j] = foldJobs([safe, leg], (id) => (id === "s1" || id === "l1" ? "job:fold-1" : undefined));
  assert.equal(j!.status, "failed", "the job's state is its worst part's");
  const line = jobRowLine(j!);
  assert.match(line, /In your SOL wallet\./, "the leg that landed says where it is");
  assert.match(line, /either in Private or still with NEAR Intents/, "the unsure leg says where it may be");
  assert.doesNotMatch(line, /^Didn't go$/);
  // its page: both parts' steps, grouped as the person sees them (fix/move-leg-steps, the copy review's ruling on the audit's M4: Signed, the
  // ETH (RH) wallet once, NEAR Confidential once, the SOL wallet with no share figure (the Safe's part kept no plan legs:
  // never a guess) and failed (its ETH (RH) part stopped), then Done waiting)
  const joined = joinTracks([moveTrack({ ...j!, status: j!.own ?? j!.status }), ...j!.parts!.map((p) => moveTrack(p))])!;
  const one = moveTrack(safe)!;
  assert.deepEqual(joined.steps.map((s) => [s.label, s.state]), [["Signed.", "done"], ["Left your ETH (RH) wallet · about $12.92", "done"], ["Through NEAR Confidential · about $40.00", "failed"], ["Solana is landing it in your SOL wallet", "failed"], ["Then it's done.", "waiting"]]);
  // control: every part done, the job's own line, once (fix/move-row-truth, the audit's M2: the wallet leg's own leg on to Solana
  // landed too; its row's "done" alone is its leg into the NEAR wallet, never the SOL wallet's)
  const [k] = foldJobs([safe, { ...leg, status: "done", unsure: undefined, note: undefined, words: "Moved $12.92 to your SOL wallet", legs: [row({ id: "l1-on", kind: "ready", network: "sol", of: "l1", usd: "12.80", atIso: iso(T0 + 30_000) })] }], () => "job:fold-1");
  assert.equal(jobRowLine(k!), "In your SOL wallet.");
  assert.equal(joinTracks([one]), one, "control: one track is itself");
});

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKENS = new Map<string, Token>([[USDC, { id: USDC, symbol: "USDC", decimals: 6, priceUsd: 1 } as Token], ["nep141:wrap.near", { id: "nep141:wrap.near", symbol: "NEAR", decimals: 24, priceUsd: 4.43 } as Token]]);
const send = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:s1", kind: "pay", status: "done", from: USDC, to: "bob.near", amount: "24.75", startedAtIso: iso(T0), updatedAtIso: iso(T0 + 20_000), explorerUrls: ["https://nearblocks.io/txns/abc"], private: true, ...o } as Movement);

test("item 2: a Send's row and title say what was signed and sent, never the typed figure where they differ (on main: $25.00); control: the same figure stays", () => {
  assert.deepEqual(sendRowOf(send(), "$25.00", TOKENS), { title: "Send $24.75 to bob.near", usd: "$24.75", line: "From your Safe" });
  assert.deepEqual(sendRowOf(send({ amount: "25" }), "$25.00", TOKENS), { title: "Send $25.00 to bob.near", usd: "$25.00", line: "From your Safe" }, "control: signed as typed");
  // another coin: its own amount at its price; no price known, the typed figure (never no figure)
  assert.equal(sendRowOf(send({ from: "nep141:wrap.near", amount: "5.6433" }), "$25.00", TOKENS)?.usd, "$25.00");
  assert.equal(sendRowOf(send({ from: "nep141:wrap.near", amount: "5" }), "$25.00", TOKENS)?.usd, "$22.15");
  assert.equal(sendRowOf(send({ from: "nep141:nope.near" }), "$25.00", TOKENS)?.usd, "$25.00");
  assert.equal(sendRowOf(send(), undefined, TOKENS), null, "control: a payment this phone didn't make");
});

test("item 2: a Send that came back never reads as spent: its line says it came back and where, from the leg's own record (paid from Private: Private; else the Safe); control: a done Send has no such line", () => {
  assert.equal(sendRowOf(send({ status: "refunded" }), "$25.00", TOKENS)?.line, "Came back to Private.");
  assert.equal(sendRowOf(send({ status: "refunded", id: "pocket-send:s2" }), "$25.00", TOKENS)?.line, "Came back to Private.");
  assert.equal(sendRowOf(send({ status: "refunded", private: false }), "$25.00", TOKENS)?.line, "Came back to your Safe.");
  assert.equal(sendRowOf(send(), "$25.00", TOKENS)?.line, "From your Safe", "J3-4: a done Send's line is where it left from only");
});

test("item 3: a step line's pieces never leave one lone word on line 2 (\"NEAR Confidential is moving / it\"); joined, they are the line; short lines are one piece", () => {
  const table: [string, string[]][] = [
    ["NEAR Confidential is moving it", ["NEAR", "Confidential", "is", "moving it"]],
    ["NEAR Confidential is moving it…", ["NEAR", "Confidential", "is", "moving it…"]],
    ["Robinhood Chain is landing it in your ETH (RH) wallet", ["Robinhood", "Chain", "is", "landing", "it", "in", "your", "ETH", "(RH) wallet"]],
    ["Then NEAR Confidential moves it.", ["Then", "NEAR", "Confidential", "moves it."]],
    ["Done", ["Done"]],
    ["In Private", ["In Private"]],
    ["Getting ready · 2 min", ["Getting ready", "· 2 min"]],
    ["Moved $9.70 to Solana, then landed", ["Moved", "$9.70", "to Solana,", "then landed"]],
  ];
  for (const [line, want] of table) {
    const got = linePhrases(line);
    assert.deepEqual(got, want, line);
    assert.equal(got.join(" "), line, `${line}: the same words`);
    assert.ok(got.every((p, i) => i < got.length - 1 || p.includes(" ") || got.length === 1), `${line}: the last piece is never one lone word`);
  }
});

test("item 4: an ended row says its date and time (\"6 Nov, 10:41 pm\"), never \"now\"; one still going says how long ago (control)", () => {
  const at = new Date(2026, 10, 6, 22, 41).getTime();
  assert.equal(whenOf(new Date(at).toISOString(), true, at + 5_000), "6 Nov, 10:41 pm");
  assert.equal(whenOf(new Date(at).toISOString(), false, at + 5_000), "now", "control: going");
  for (const status of ["done", "failed", "refused", "refunded"] as const) assert.equal(rowEnded({ status }), true, status);
  for (const status of ["on-its-way", "waiting", "waiting-for-you"] as const) assert.equal(rowEnded({ status }), false, status);
  for (const status of ["done", "refunded", "problem"] as const) assert.equal(movementEnded({ status }), true, status);
  assert.equal(movementEnded({ status: "moving" }), false);
});

test("item 4: the copy review's words: the Safe's top-up row \"Into Private from your Safe.\"; a leg paid from Private \"From Private.\"; never \"anyone can see this move\"", () => {
  const into = describeRow({ id: "p1", kind: "private", status: "done", from: USDC, to: "private", amount: "200", startedAtIso: iso(T0), updatedAtIso: iso(T0) } as Movement, TOKENS, []);
  assert.deepEqual(into, { title: "Moved to Private", detail: "Into Private from your Safe." });
  const sol = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const own = ownRows([{ role: "chain", network: "sol", address: sol }]);
  const leg = describeRow(send({ to: sol, amount: "20" }), TOKENS, [], own);
  // a safe-send: leg left the Safe (the audit's MUST, 7 Nov); Private's own leg (pocket-send:) keeps the copy review's "From Private."
  assert.deepEqual(leg, { title: "Moved to your SOL wallet", detail: "From your Safe." });
  assert.deepEqual(describeRow(send({ id: "pocket-send:p1", to: sol, amount: "20" }), TOKENS, [], own), { title: "Moved to your SOL wallet", detail: "From Private." });
  // control: a Send to someone else keeps who it went to
  assert.equal(describeRow(send({ amount: "20" }), TOKENS, []).detail, "From your Safe · to bob.near");
  for (const d of [into, leg]) assert.doesNotMatch(`${d.title} ${d.detail}`, /anyone can see/);
});

test("item 5: a stopped Move's page never says \"Not signed\", a \";\" or brackets in its reason line, whatever its record's words (control: plainLine refuses each)", () => {
  const dirty = ["Not signed: the swap service refused the price. Nothing moved.", "It stopped; try again.", "NEAR Intents said no (code 4). Nothing moved.", "It stopped [x]."];
  for (const w of dirty) assert.equal(plainLine(w), false, w);
  const tracks: LiveTrack[] = [];
  for (const note of dirty) {
    tracks.push(moveTrack(row({ id: `a-${note.length}`, status: "refused", note, words: "Move $40.00 to your SOL wallet" }))!);
    tracks.push(moveTrack(row({ id: `b-${note.length}`, kind: "put-away", network: "sol", status: "failed", note, words: "Move $40.00 to your Safe" }))!);
    tracks.push(moveTrack(row({ id: `c-${note.length}`, via: "private", goesTo: ["sol"], status: "failed", note, missed: ["sol"], missedUsd: "40" }))!);
    tracks.push(moveTrack(row({ id: `d-${note.length}`, kind: "move", network: "hood", to: "sol", status: "failed", note, words: "Moving $12.92 to your SOL wallet" }))!);
  }
  for (const t of tracks) {
    const f = jobFace(t);
    if (f.reason) assert.doesNotMatch(f.reason, /Not signed|[()[\];]/, `${t.id}: ${f.reason}`);
    assert.doesNotMatch(f.bar, /Not signed|[()[\];]/, t.id);
  }
});

// J1 (the copy review's walk, 7 Nov): the Activity centre's Now row opened Activity's list ("Jobs" above the rows), the job's page a
// third tap. Its task ("activity:<task id>") now opens the live track with that id; an Add's and a way back's stay Activity's own.
test("J1: the centre's task opens its own job's page, by its track's id", () => {
  const tracks = [{ id: "move:mv-k1" }, { id: "send:safe-send:s1" }, { id: "add:abc123" }];
  const table: [string | undefined, string | undefined][] = [
    ["move:mv-k1", "move:mv-k1"],
    ["send:safe-send:s1", "send:safe-send:s1"],
    ["add:abc123", undefined], // control: an Add's page is Activity's own (openAdd)
    ["back:xyz", undefined],
    ["move:gone", undefined], // ended and no longer a track: Activity opens its row's page
    [undefined, undefined],
  ];
  for (const [id, want] of table) assert.equal(openTrackOf(id, tracks)?.id, want, String(id));
});

// J2 (the copy review's walk, 7 Nov): a Send's page wore the old layout ("Private balance", a "Paid to" card, "Finished / Not finished
// yet.", "Nov 7, 1:22 AM"). It is now the job face, from the same track as its Now row (sendJobOf).
test("J2: a Send's page is the job face: its figure, Sent to its payee, the steps with no arrow glyph", () => {
  const t = sendJobOf(send(), TOKENS, "$25.00")!;
  assert.equal(t.kind, "send");
  const f = jobFace(t);
  assert.equal(f.figure, "$24.75", "what was signed and sent");
  assert.deepEqual(f.money, { lead: "Sent to ", place: "bob.near", after: "." });
  assert.equal(f.state, "done");
  for (const s of f.steps) assert.doesNotMatch(s.label, /→|->|Private balance|Paid to .* card/);
  // a Send that came back: never Sent; its stop words and the way on
  const back = jobFace(sendJobOf(send({ status: "refunded" }), TOKENS, "$25.00")!);
  assert.notEqual(back.state, "done");
  assert.doesNotMatch(JSON.stringify(back.money ?? ""), /Sent to/);
  assert.equal(sendJobOf(send(), TOKENS, undefined), null, "control: a payment this phone didn't make keeps its old page");
  assert.equal(sendRowOf(send(), "$25.00", TOKENS)?.title, "Send $24.75 to bob.near", "control: the row's title is the same track's");
});

// the audit's pin (7 Nov): a Move whose Safe leg's own ledger movement ended FAILED (convertFailed, unsure) was hidden behind its
// row (its `paid` id, or sameMove for the public move) while the row still said Moving or Done.
test("the audit's pin: a Move whose Safe leg's ledger movement ended FAILED (unsure) says the unsure place on its one row and its page, never Moving or Done; control: all done, its one line", () => {
  const failed = (id: string, kind: Movement["kind"]): Movement => ({ id, kind, status: "problem", from: USDC, to: "private", amount: "40", startedAtIso: iso(T0), updatedAtIso: iso(T0 + 9_000), explorerUrls: [],
    problem: { code: "ledger.convert.failed", whatHappened: "NEAR Intents didn't finish this move.", money: { state: "unsure", where: "either in your Safe or still with NEAR Intents", check: "Check your Safe first." }, next: { kind: "nothing", label: "Done" } } } as unknown as Movement);
  const cases: [string, SpendingActivity, Movement][] = [
    // the private route: the Safe's fill is one of the row's payments (`paid`)
    ["private route, paid fill", row({ id: "p1", via: "private", goesTo: ["sol"], status: "on-its-way", paid: ["mv-9"], words: "Moving $40.00 to your SOL wallet" }), failed("mv-9", "private")],
    // the public route: the row's own ledger move (sameMove, by ledgerId)
    ["public route, sameMove", row({ id: "mv-k1", ledgerId: "trading-7", status: "done", words: "Moved $40.00 to your SOL wallet" }), failed("trading-7", "trading")],
  ];
  for (const [name, r, m] of cases) {
    const { ledger, spending } = activityRows([m], [r]);
    assert.equal(ledger.length, 0, `${name}: still one row`);
    const [j] = spending;
    assert.notEqual(j!.status, "done", name);
    assert.notEqual(j!.status, "on-its-way", name);
    assert.match(jobRowLine(j!), /either in your Safe or still with NEAR Intents/, `${name}: the row says where it may be`);
    const f = jobFace(moveTrack(j!)!);
    assert.deepEqual(f.money, { lead: "Either in ", place: "your Safe", after: " or still with NEAR Intents." }, `${name}: the page names the Safe`);
    assert.equal(f.reason, "Check your Safe first.", name);
  }
  // control: the same Move with its movement done says its one line
  const ok = { ...failed("mv-9", "private"), status: "done", problem: undefined } as Movement;
  const [d] = activityRows([ok], [row({ id: "p1", via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, paid: ["mv-9"], words: "Moved $40.00 to your SOL wallet" })]).spending;
  assert.equal(d!.status, "done");
  assert.doesNotMatch(jobRowLine(d!), /either in/);
});

test("the copy review (7 Nov): the unsure money line starts with a capital, the place in its slot, for every place", () => {
  for (const p of ["your Safe", "Private", "your NEAR wallet"]) {
    const l = unsureLine(p);
    assert.equal(`${l.lead}${l.place}${l.after}`, `Either in ${p} or still with NEAR Intents.`);
    assert.equal(l.place, p);
  }
});
