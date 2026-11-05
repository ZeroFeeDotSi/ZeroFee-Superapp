// D137: the live step monitor reads only the engine's own states, never a timer. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import { endLine, startingTracks, taskOf } from "./live-steps.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import { addTrack, elapsed, foldInto, liveNow, moveTrack, sendTrack, stamp, stepsLine, watchLive, DONE_SHOWN_MS, type LiveTrack, type Seen } from "./live-steps.ts";

const T0 = Date.parse("2026-11-03T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "m1", kind: "move", usd: "20.00", status: "on-its-way", shown: true, atIso: iso(0), words: "From your SOL wallet to your Safe", network: "sol", to: "near", ...o } as SpendingActivity);
const mv = (o: Partial<Movement>): Movement => ({ id: "s1", kind: "pay", status: "moving", amount: "5000000", startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], to: "kiosk.near", private: true, ...o });
const states = (t: LiveTrack | null) => t!.steps.map((s) => s.state).join(" ");

test("elapsed: m:ss, then h:mm:ss", () => {
  assert.equal(elapsed(4_000), "0:04");
  assert.equal(elapsed(41_900), "0:41");
  assert.equal(elapsed(12 * 60_000 + 3_000), "12:03");
  assert.equal(elapsed(3_729_000), "1:02:09");
  assert.equal(elapsed(-5), "0:00", "control: never a negative time");
});

test("an Add (product decision, 3 Nov): Received → Making it private → In your wallet, each step at the core's own time; refunded and held name the step and where it is", () => {
  const a = { key: "abc123", tokenId: "sol", chain: "sol" as const, to: "safe" as const };
  // the moment money reaches the one-time address, "Received" is done (the old monitor waited for 1Click: "doing")
  const got = addTrack({ ...a, stage: "arriving", usd: "150.00", at: { received: T0 } })!;
  assert.equal(states(got), "done doing waiting");
  assert.deepEqual(got.steps.map((s) => s.label), ["Received", "Into NEAR Confidential", "In your Safe"]);
  assert.equal(got.title, "Adding $150.00 to your Safe");
  assert.equal(got.startMs, T0);
  assert.equal(got.steps[0]!.atMs, 0);
  const fwd = addTrack({ ...a, stage: "forwarding", usd: "150.00", at: { received: T0, private: T0 + 4_000 } })!;
  assert.equal(states(fwd), "done done doing");
  assert.equal(fwd.steps[1]!.atMs, 4_000, "the private step at the core's own time");
  const landed = addTrack({ ...a, stage: "landed", usd: "150.00", at: { received: T0, private: T0 + 4_000, landed: T0 + 31_000 } })!;
  assert.equal(states(landed), "done done done");
  assert.equal(landed.steps[2]!.atMs, 31_000);
  assert.deepEqual(landed.end, { ok: true, line: "" }, "its last step already says where: said once");
  assert.equal(landed.title, "Added $150.00 to your Safe");
  assert.deepEqual(landed.wallets, ["safe", "near"]);
  assert.equal(addTrack({ ...a, stage: "arriving" })!.title, "Adding SOL to your Safe", "no amount yet: the coin");
  assert.equal(addTrack({ ...a, to: "wallet", stage: "arriving" })!.title, "Adding SOL to your wallet", "the wallet unnamed: its last step names it");
  assert.equal(addTrack({ ...a, stage: "arriving" })!.steps[0]!.atMs, undefined, "control: no engine time, none made up here (stamp gives the first sight)");
  const back = addTrack({ ...a, stage: "refunded" })!;
  assert.equal(states(back), "done failed waiting");
  assert.match(back.end!.line, /Your SOL is in your NEAR wallet\./);
  assert.equal(states(addTrack({ ...a, stage: "held", reason: "It was too little to move." })), "done done failed");
  assert.equal(addTrack({ key: "x", tokenId: "y" }), null, "control: an older Add without a stage has no steps to show");
  assert.equal(addTrack({ ...a, stage: "arriving", to: undefined })!.wallets[0], "sol", "into the wallet itself");
  assert.equal(addTrack({ ...a, stage: "arriving", to: undefined })!.steps[2]!.label, "In your SOL wallet");
});

test("an Add's Activity centre task opens its own page in Activity, with its proof (control: a Move's still opens its own)", () => {
  const t = addTrack({ key: "abc123", tokenId: "sol", chain: "sol", to: "wallet", stage: "arriving", at: { received: T0 } })!;
  const task = taskOf(t);
  assert.deepEqual(task.open, { route: "activity:add:abc123" });
  assert.equal(task.startedAt, T0);
  assert.deepEqual(task.steps.map((s) => [s.label, s.state, s.at]), [["Received", "done", T0], ["Into NEAR Confidential", "doing", undefined], ["In your SOL wallet", "waiting", undefined]]);
  const m = moveTrack(row({ id: "m9", kind: "top-up", status: "done", goesTo: ["sol"] }))!;
  assert.deepEqual(taskOf(m).open, { route: "activity:move:m9" });
});

test("a Move is ONE thing, start to end: Safe → SOL wallet is titled as asked, and is Done only once it is in the SOL wallet", () => {
  const up = row({ id: "m1", kind: "top-up", usd: "5.00", status: "done", words: "Moved $5.00 to your SOL wallet", network: undefined, to: undefined, goesTo: ["sol"] });
  const t = moveTrack(up)!;
  assert.equal(t.title, "Move $5.00 to your SOL wallet");
  // product decision (5 Nov): each step names who does the work (job-steps.ts), done forms once a read shows them
  assert.deepEqual(t.steps.map((s) => s.label), ["Approved", "In your NEAR wallet", "NEAR Intents is moving it to Solana", "Then Solana lands it in your SOL wallet."], "the copy review's ruling: a step not begun says Then");
  assert.deepEqual(t.steps.map((s) => s.key), ["safe", "near", "intents", "land"]);
  assert.equal(states(t), "done done doing waiting", "in the NEAR wallet is not where the person sent it");
  assert.equal(t.eta, "NEAR Intents took about 4 min on recent moves.", "both legs' time (measured), never the first quote alone");
  assert.equal(t.endsAt, t.startMs + 210_000, "the time left counts down from the tap (product decision, 5 Nov)");
  assert.equal(taskOf(t).endsAt, t.endsAt, "the Activity centre's row has it too");
  assert.equal(t.end, undefined);
  const leg = row({ id: "m2", of: "m1", kind: "ready", usd: "4.90", status: "on-its-way", atIso: iso(41), network: "sol", to: undefined, words: "Moving $4.90 to Solana" });
  const [going] = foldInto([up, leg]);
  const g = moveTrack(going!)!;
  assert.equal(states(g), "done done doing waiting");
  assert.equal(g.steps[1]!.atMs, 41_000, "in the NEAR wallet until the leg out began (the engine's own time)");
  assert.equal(stepsLine(g), "Approved ✓ 0:00 · In your NEAR wallet ✓ 0:41 · NEAR Intents is moving it to Solana… · Then Solana lands it in your SOL wallet.");
  const done = moveTrack({ ...going!, legs: [{ ...leg, status: "done" }] })!;
  assert.equal(states(done), "done done done done");
  assert.equal(done.steps[2]!.label, "NEAR Intents moved it to Solana");
  assert.deepEqual(done.end, { ok: true, line: "In your SOL wallet." });
  assert.match(stepsLine(done), / · Done$/);
  assert.doesNotMatch(JSON.stringify([t, g, done]), /Top/, "no Top up anywhere it says");
  // bug report (5 Nov): saved before the Safe signs; ticked only once NEAR's final block has its tx (on its way, not asked)
  const asked = moveTrack({ ...up, status: "waiting", signing: "asked" })!;
  assert.equal(states(asked), "doing waiting waiting waiting", "saved before its signature: nothing ticked yet");
  assert.equal(asked.steps[0]!.label, "Approve on your iPhone.");
  const checking = moveTrack({ ...up, status: "waiting", signing: "checking" })!;
  assert.equal(checking.steps[0]!.label, "Asking NEAR if your Safe sent it", "a closed page's job: asked, never guessed");
  const leaving = moveTrack({ ...up, status: "on-its-way" })!;
  assert.equal(states(leaving), "done doing waiting waiting", "control: on its way only once the Safe's tx is final");
  assert.equal(leaving.steps[1]!.label, "NEAR Intents is moving it to your NEAR wallet");
  // control: a Move to the NEAR wallet itself is done when it's there
  const near = moveTrack(row({ id: "n1", kind: "top-up", usd: "5.00", status: "done", words: "Moved $5.00 to your NEAR wallet", network: undefined, to: undefined }))!;
  assert.equal(near.title, "Move $5.00 to your NEAR wallet");
  assert.equal(states(near), "done done");
  assert.equal(moveTrack(row({ kind: "gas" })), null, "control: a quiet move isn't tracked");
});

test("a wallet → the Safe: its legs in come first (one tracker, even before the move home exists), Done only in the Safe", () => {
  const legIn = row({ id: "i1", of: "h1", kind: "put-away", usd: "20.18", status: "on-its-way", network: "sol", to: undefined, words: "Bringing $20.18 back from Solana" });
  const [pending] = foldInto([legIn]);
  assert.equal(pending!.id, "h1", "the legs wait under their move's own id");
  const a = moveTrack(pending!)!;
  assert.equal(a.title, "Move $20.18 to your Safe");
  assert.equal(states(a), "doing waiting waiting", "its leg in is going, not yet confirmed");
  assert.equal(a.steps[0]!.label, "Leaving your SOL wallet");
  assert.equal(states(moveTrack(foldInto([{ ...legIn, status: "done" }])[0]!)), "done done doing", "in the NEAR wallet, not yet the Safe");
  const home = row({ id: "h1", kind: "put-away", usd: "19.88", status: "done", atIso: iso(70), network: undefined, to: undefined, words: "Put away $19.88" });
  const folded = foldInto([{ ...legIn, status: "done" }, home]);
  assert.equal(folded.length, 1);
  const b = moveTrack(folded[0]!)!;
  assert.equal(states(b), "done done done");
  assert.equal(b.steps[1]!.atMs, 70_000, "through NEAR ended when the move home began");
  assert.equal(states(moveTrack({ ...folded[0]!, status: "on-its-way" })), "done done doing", "control: the move home still going is not Done");
});

test("a wallet → a wallet: Done only once its leg on has landed", () => {
  const first = row({ id: "w1", kind: "move", usd: "10.00", status: "done", network: "sol", to: "hood", words: "Moved $10.00 from your SOL wallet to your ETH (RH) wallet" });
  const t = moveTrack(first)!;
  assert.equal(t.title, "Move $10.00 to your ETH (RH) wallet");
  assert.equal(states(t), "done done doing");
  const leg = row({ id: "w2", of: "w1", kind: "ready", status: "done", network: "hood", to: undefined, atIso: iso(30) });
  assert.equal(states(moveTrack(foldInto([first, leg])[0]!)), "done done done");
});

test("a Move that fails names the step and where the money is (the engine's own note)", () => {
  const bad = moveTrack(row({ id: "f1", kind: "top-up", status: "failed", network: undefined, to: undefined, goesTo: ["sol"], note: "1Click sent it back. It's in your Safe." }))!;
  assert.equal(states(bad), "done failed waiting waiting");
  assert.deepEqual(bad.end, { ok: false, line: "1Click sent it back. It's in your Safe." });
  const up = row({ id: "f2", kind: "top-up", status: "done", network: undefined, to: undefined, goesTo: ["sol"] });
  const legBad = moveTrack({ ...up, legs: [row({ id: "f3", of: "f2", kind: "ready", status: "failed", network: "sol", to: undefined, note: "Solana didn't take it. It's in your NEAR wallet." })] })!;
  assert.equal(states(legBad), "done done failed waiting", "the leg out failing is NEAR Intents' step");
  assert.match(legBad.end!.line, /in your NEAR wallet/);
});

test("F4 (QA's Protection crawl, 5 Nov): a Move held by the account's rules is no moving row (no steps, no clock, no bar); Home's own row says Waiting with its time", async () => {
  const held = row({ id: "h1", kind: "top-up", usd: "250.00", status: "waiting", words: "Move $250.00 to your NEAR wallet", network: undefined, to: undefined, held: { id: "held-1", readyAtIso: iso(3 * 86400), needsSecondDevice: false } });
  assert.equal(moveTrack(held), null, "held: nothing moved, so never 'Leaving your Safe'");
  // control: the same move not held (listed before its signature) still shows its steps
  // (a Move from the Safe's steps name who does the work, job-steps.ts: the Safe signing, then NEAR Intents)
  const unheld = moveTrack({ ...held, held: undefined } as SpendingActivity)!;
  assert.equal(states(unheld), "doing waiting");
  assert.equal(unheld.steps[0]!.label, "Approve on your iPhone.");
  // control: once the hold lets it go (on its way), it is a moving row again
  assert.equal(states(moveTrack({ ...held, status: "on-its-way" })), "done doing");
  // the watch draws no card for it and covers nothing, so Home's Waiting row (Home.tsx: "Waiting · … · until …") stays
  const bridge = { call: async (m: string) => (m === "spending.activity" ? { ok: [{ ...held, atIso: new Date().toISOString() }, row({ id: "u1", atIso: new Date().toISOString() })] } : m === "device.store.get" ? { ok: { value: null } } : { ok: null }), on: () => () => {} };
  let got: LiveTrack[] = [], covered: ReadonlySet<string> = new Set();
  const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t, c) => { got = t; covered = c; });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.deepEqual(got.map((t) => t.id), ["move:u1"], "control: the unheld move still has its card");
  assert.ok(!covered.has("move:h1"));
  const home = readFileSync(new URL("../screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /m\.held \? "Waiting"/);
  assert.match(home, /until \$\{until\(m\.held\.readyAtIso\)\}/);
});

test("a Send: left, through NEAR privately, paid; its done time is the ledger's own; a problem says where the money is", () => {
  const asked = sendTrack(mv({}), undefined, "kiosk.near")!;
  assert.equal(states(asked), "doing waiting waiting", "no transaction on chain yet: nothing ticked");
  assert.equal(asked.steps[0]!.label, "Leaving your Safe");
  const going = sendTrack(mv({ explorerUrls: ["https://nearblocks.io/txns/abc"] }), undefined, "kiosk.near")!;
  assert.equal(states(going), "done doing waiting", "control: on chain, it left");
  assert.equal(going.steps[0]!.label, "Left your Safe");
  assert.equal(going.steps[1]!.label, "NEAR Confidential is paying kiosk.near.", "rule 11 + the copy review's ruling: who does the work while it runs, and for whom");
  assert.equal(going.title, "Send to kiosk.near");
  const paid = sendTrack(mv({ status: "done", updatedAtIso: iso(63) }), undefined, "kiosk.near")!;
  assert.equal(paid.steps[2]!.atMs, 63_000);
  assert.equal(paid.end!.line, "Paid to kiosk.near.");
  const problem = { code: "x", whatHappened: "1Click didn't pay it.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } };
  const refused = sendTrack(mv({ status: "problem", problem: problem as never }), undefined, "kiosk.near")!;
  assert.equal(states(refused), "failed waiting waiting", "nothing on chain, the money where it was: never signed");
  assert.equal(refused.end!.line, "Not signed: 1Click didn't pay it. Nothing moved.");
  const prob = sendTrack(mv({ status: "problem", explorerUrls: ["https://nearblocks.io/txns/abc"], problem: problem as never }), undefined, "kiosk.near")!;
  assert.equal(states(prob), "done failed waiting", "control: sent, then stopped");
  assert.equal(prob.end!.line, "1Click didn't pay it. Your money is in your Safe.");
  assert.equal(sendTrack(mv({ private: false }))!.steps[1]!.label, "Then NEAR Intents pays them.", "a public send never says privately (NEAR Intents, not NEAR Confidential)");
  assert.equal(sendTrack(mv({ kind: "deposit" })), null, "control: a deposit isn't a Send");
  assert.equal(sendTrack(mv({ status: "waiting" })), null, "control: a held send is the Waiting screen's");
});

test("stamp: a step without an engine time gets the moment this phone first saw it done, kept; a track first seen already ended gets no made-up times", () => {
  const seen: Seen = {};
  const a = { key: "k", tokenId: "t", chain: "sol" as const, to: "safe" as const };
  const s1 = stamp(addTrack({ ...a, stage: "arriving" })!, seen, T0);
  assert.equal(s1.startMs, T0, "an Add starts when this phone first sees it");
  assert.equal(s1.steps[0]!.atMs, 0, "Received: done the moment it is first seen");
  const s2 = stamp(addTrack({ ...a, stage: "forwarding" })!, seen, T0 + 9_000);
  assert.equal(s2.steps[1]!.atMs, 9_000);
  const s3 = stamp(addTrack({ ...a, stage: "landed" })!, seen, T0 + 70_000);
  assert.equal(s3.steps[1]!.atMs, 9_000, "kept: the first sight, not the latest");
  assert.equal(s3.steps[2]!.atMs, 70_000);
  assert.equal(s3.endMs, T0 + 70_000);
  const old = stamp(addTrack({ key: "o", tokenId: "t", chain: "sol", to: "safe", stage: "landed" })!, {}, T0 + 999_000);
  assert.ok(old.steps.every((s) => s.atMs === undefined), "control: no times made up for what ended before this phone looked");
  assert.equal(old.endMs, -Infinity);
  assert.deepEqual(liveNow([old], T0 + 999_000), [], "and it isn't live");
});

test("liveNow: everything still going, and what ended in the last two minutes, newest first", () => {
  const t = (id: string, startMs: number, endMs?: number): LiveTrack => ({ id, kind: "move", title: id, wallets: [], startMs, steps: [], ...(endMs !== undefined ? { end: { ok: true, line: "" }, endMs } : {}) });
  const now = T0 + 10 * 60_000;
  assert.deepEqual(liveNow([t("a", T0), t("b", T0 + 1, now - 1000), t("c", T0 + 2, now - DONE_SHOWN_MS - 1)], now).map((x) => x.id), ["b", "a"]);
});

test("watchLive reads Spending's rows and the phone's record only; its one clock is a re-read, never a step", async () => {
  const asked: string[] = [];
  const store: Record<string, string> = {};
  const bridge = {
    call: async (m: string, p?: { key: string; value: string }) => {
      asked.push(m);
      if (m === "spending.activity") return { ok: [row({ atIso: new Date().toISOString() })] };
      if (m === "device.store.get") return { ok: { value: store[p!.key] ?? null } };
      if (m === "device.store.set") { store[p!.key] = p!.value; return { ok: null }; }
      return { ok: null };
    },
    on: () => () => {},
  };
  let got: LiveTrack[] = [];
  const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t) => { got = t; });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(got.length, 1);
  assert.equal(states(got[0]!), "doing waiting waiting");
  // and a site wallet's Take outs (site-back.ts): the core's own record, which also sends a landed leg 1 on home
  assert.deepEqual([...new Set(asked)].sort(), ["device.store.get", "device.store.set", "spending.activity", "subwallet.site.moveBacks"]);
  assert.ok(JSON.parse(store["live-seen"]!)["move:m1"], "the phone keeps what it saw");
  const src = readFileSync(new URL("./live-steps.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Math\.random|setTimeout\([^)]*state|fake|simulat/i, "control: nothing invents progress");
});

test("watchLive waits for the phone's record before it draws: a slow record isn't overwritten or pruned", async () => {
  const at = Date.now() - 30_000;
  const failed = row({ status: "failed", note: "It's in your NEAR wallet.", atIso: new Date(at).toISOString() });
  const run = async (storeDelay: number, rowsDelay: number) => {
    const store: Record<string, string> = { "live-seen": JSON.stringify({ "move:m1": { start: at, done: {} } }) };
    const later = <T,>(v: T, d: number) => new Promise<T>((r) => setTimeout(() => r(v), d));
    const bridge = {
      call: async (m: string, p?: { key: string; value: string }) => {
        if (m === "spending.activity") return later({ ok: [failed] }, rowsDelay);
        if (m === "device.store.get") return later({ ok: { value: store[p!.key] ?? null } }, storeDelay);
        if (m === "device.store.set") { store[p!.key] = p!.value; return { ok: null }; }
        return { ok: null };
      },
      on: () => () => {},
    };
    let got: LiveTrack[] = [];
    const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t) => { got = t; });
    await new Promise((r) => setTimeout(r, 40));
    stop();
    return { got, kept: JSON.parse(store["live-seen"]!) as Seen };
  };
  for (const [s, r] of [[15, 0], [0, 15]] as const) {
    const { got, kept } = await run(s, r);
    assert.equal(got.length, 1, `seen going, then failed: still on Home (store ${s} ms, rows ${r} ms)`);
    assert.equal(kept["move:m1"]?.old, undefined, "the record isn't rewritten as first seen ended");
  }
});

test("honest ticks (UI's mainnet rehearsal): a refused signature never ticks Left; it fails the first step with Not signed and Nothing moved; a landed one ticks (control)", () => {
  const swap = (status: SpendingActivity["status"], note?: string) => moveTrack(row({ id: "s1", kind: "move", usd: "2.00", status, network: "sol", to: "near", words: "Swapping $2.00 of SOL", ...(note ? { note } : {}) }), "Swap $2 of SOL for USDC")!;
  const refused = swap("refused", "You said no on the Approve sheet.");
  assert.equal(states(refused), "failed waiting waiting");
  assert.equal(refused.steps[0]!.label, "Leaving your SOL wallet", "never Left");
  assert.equal(refused.steps.some((x) => x.state === "done"), false, "no tick anywhere");
  assert.deepEqual(refused.end, { ok: false, line: "Not signed: You said no on the Approve sheet. Nothing moved." });
  assert.doesNotMatch(stepsLine(refused), /✓/);
  assert.equal(states(swap("on-its-way")), "doing waiting waiting", "listed, not yet signed and sent: no tick");
  assert.equal(states(swap("waiting")), "doing waiting waiting");
  const landed = swap("done");
  assert.equal(states(landed), "done done done", "control: landed, every step ticked");
  assert.equal(landed.steps[0]!.label, "Left your SOL wallet");
  // a top-up the swap service refused before anything left: the same
  const up = moveTrack(row({ id: "u1", kind: "top-up", usd: "5.00", status: "refused", network: undefined, to: undefined, goesTo: ["sol"], words: "Didn't move $5.00 to your SOL wallet", note: "Nothing moved: the money stayed in your Safe" }))!;
  assert.equal(states(up), "failed waiting waiting waiting");
  assert.equal(up.end!.line, "Not signed: Nothing moved: the money stayed in your Safe.");
  // QA's MUST: a closed page's job the chain showed never sent says so plainly
  const never = moveTrack(row({ id: "u2", kind: "top-up", usd: "5.00", status: "refused", network: undefined, to: undefined, goesTo: ["sol"], words: "Didn't move $5.00 to your SOL wallet", note: "It wasn't sent. Nothing left your Safe" }))!;
  assert.equal(never.end!.line, "It wasn't sent. Nothing left your Safe.");
  // the task Home publishes is the same: no done step, failed, the money line
  const task = (taskOf as (t: unknown) => { state: string; steps: { state: string }[]; where?: string })(refused);
  assert.equal(task.state, "failed");
  assert.equal(task.steps.some((x) => x.state === "done"), false);
});

test("speed (D145): poke draws the screen's new movements at once, with no read of its own (control: without it, the card waits for the next read)", async () => {
  let reads = 0;
  const bridge = {
    call: async (m: string) => {
      if (m === "spending.activity") { reads++; return { ok: [] }; }
      if (m === "device.store.get") return { ok: { value: null } };
      return { ok: null };
    },
    on: () => () => {},
  };
  const now = new Date().toISOString();
  let movements: Movement[] = [];
  let got: LiveTrack[] = [];
  const w = watchLive(bridge as never, () => ({ adds: [], movements }), (t) => { got = t; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 0);
  assert.equal(reads, 1);
  movements = [mv({ startedAtIso: now, updatedAtIso: now })];
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 0, "control: a new movement alone draws nothing until a read");
  w.poke();
  assert.equal(got.length, 1, "poked: the send's card is drawn at once");
  assert.equal(got[0]!.id, "send:s1");
  assert.equal(reads, 1, "poke reads nothing");
  w();
  movements = [];
  w.poke();
  assert.equal(got.length, 1, "control: a stopped watch draws nothing");
  const src = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(src, /useEffect\(\(\) => \{ watch\.current\?\.poke\(\); \}, \[feedAdds\?\.length \? feedAdds : 0, feedMoves\.length \? feedMoves : 0\]\);/, "LiveHome pokes when its feed changes");
});

// The test Activity centre (3 Nov): "Move $3.00 to your SOL wallet" sat on "Arriving in your SOL wallet…" for
// nearly three hours. Home's tracks were made from the last hour's rows only, and only the tracks on Home's card were told to the
// centre, so a move that ended after an hour, or while the app was closed, never ended its task.
const topUp = (o: Partial<SpendingActivity>, leg: Partial<SpendingActivity>) => [
  { id: "t1", kind: "top-up", usd: "3.00", status: "done", shown: true, atIso: o.atIso!, words: "Moving $3.00 to your SOL wallet", goesTo: ["sol"], ...o } as SpendingActivity,
  { id: "t1-sol", kind: "ready", usd: "2.90", status: "on-its-way", shown: true, atIso: o.atIso!, words: "Moving $2.90 to Solana", network: "sol", of: "t1", ...leg } as SpendingActivity,
];
function centre() {
  const ended: [string, string][] = [], published: string[] = [];
  return { ended, published, tasks: { publish: (t: { id: string; state?: string }) => (published.push(`${t.id}:${t.state}`), true), update: () => true, end: (id: string, state: string) => (ended.push([id, state]), true), open: () => {} } };
}
async function watchOnce(rows: SpendingActivity[], kept: Seen | null) {
  const store: Record<string, string> = kept ? { "live-seen": JSON.stringify(kept) } : {};
  const bridge = {
    call: async (m: string, p?: { key: string; value: string }) => {
      if (m === "spending.activity") return { ok: rows };
      if (m === "device.store.get") return { ok: { value: store[p!.key] ?? null } };
      if (m === "device.store.set") { store[p!.key] = p!.value; return { ok: null }; }
      return { ok: null };
    },
    on: () => () => {},
  };
  const c = centre();
  const { publishTracks } = await import("./live-steps.ts");
  const sent = new Map<string, string>();
  let shown: LiveTrack[] = [];
  const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t, _c, tell) => { shown = t; publishTracks(c.tasks as never, tell ?? t, sent); });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  return { ...c, shown, kept: JSON.parse(store["live-seen"] ?? "{}") as Seen };
}

test("D144: a Move whose money landed while the app was closed, 2 h 49 min ago, ends its task on the next open, once (control: one this phone never saw going is not added to the centre)", async () => {
  const at = Date.now() - (2 * 3600 + 49 * 60) * 1000;
  const landed = topUp({ atIso: new Date(at).toISOString() }, { status: "done" });
  const seenGoing: Seen = { "move:t1": { start: at, done: { 0: 0, 1: 22_000 } } };
  const a = await watchOnce(landed, seenGoing);
  assert.deepEqual(a.ended, [["move:t1", "done"]], "the task ends done");
  assert.equal(a.kept["move:t1"]?.told, true, "kept as told, so the next open says nothing again");
  const again = await watchOnce(landed, a.kept);
  assert.deepEqual(again.ended, [], "told once");
  const never = await watchOnce(landed, null);
  assert.deepEqual([never.ended, never.published], [[], []], "control: first seen already ended, nothing is added");
});

test("D144: a Move not seen arriving in 15 minutes ends as taking longer, with where the money is going; still followed, it ends done the moment it lands (control: at 14 minutes it is still going)", async () => {
  const { SLOW_MS, slowed, taskOf } = await import("./live-steps.ts");
  const at = Date.now() - SLOW_MS - 60_000;
  const going = topUp({ atIso: new Date(at).toISOString() }, {});
  const seen: Seen = { "move:t1": { start: at, done: { 0: 0, 1: 22_000 } } };
  const slow = await watchOnce(going, seen);
  assert.deepEqual(slow.ended, [["move:t1", "stopped"]]);
  const t = slow.shown.find((x) => x.id === "move:t1")!;
  assert.equal(t.end?.line, "Slower than usual. It's on its way to your SOL wallet. This changes to Done when it lands.");
  assert.equal(taskOf(t).where, "Slower than usual. It's on its way to your SOL wallet. This changes to Done when it lands.");
  assert.equal(slow.kept["move:t1"]?.told, undefined, "still followed");
  const done = await watchOnce(topUp({ atIso: new Date(at).toISOString() }, { status: "done" }), slow.kept);
  assert.deepEqual(done.ended, [["move:t1", "done"]], "it lands: done");
  const early = moveTrack(foldInto(topUp({ atIso: new Date(Date.now() - SLOW_MS + 60_000).toISOString() }, {}))[0]!)!;
  assert.equal(slowed(early, Date.now()).end, undefined, "control: 14 minutes, still going");
});

// Phone test, 4 Nov and "Adding SOL to your wallet" sat on "Making it private…" in
// the Activity centre five hours on. When the core stops listing a track this phone saw going (and never told its end),
// nothing ended its task: watchLive dropped it from the phone's record and the centre kept it "Going" for good.
test("bug (Activity stuck): a track seen going that is no longer listed ends its task, stopped, after GONE_AFTER_MS; never on a read that came back empty for a moment (control: a told one ends nothing)", async () => {
  const { mock } = await import("node:test");
  const { endGone, GONE_AFTER_MS, GONE_WORDS } = await import("./live-steps.ts");
  const t0 = 10_000_000_000;
  mock.timers.enable({ apis: ["Date"], now: t0 });
  try {
    const store: Record<string, string> = { "live-seen": JSON.stringify({ "add:aaaaaa": { start: t0 - 5 * 3_600_000, done: { 0: 0 } }, "add:bbbbbb": { start: t0 - 3_600_000, done: {}, told: true } } satisfies Seen) };
    const bridge = {
      call: async (m: string, p?: { key: string; value: string }) => {
        if (m === "spending.activity") return { ok: [] };
        if (m === "device.store.get") return { ok: { value: store[p!.key] ?? null } };
        if (m === "device.store.set") { store[p!.key] = p!.value; return { ok: null }; }
        return { ok: null };
      },
      on: () => () => {},
    };
    const ended: [string, string, string | undefined][] = [];
    const tasks = { publish: () => true, update: () => true, end: (id: string, state: string, detail?: string) => (ended.push([id, state, detail]), true), open: () => {} };
    const sent = new Map<string, string>();
    const w = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (_t, _c, _tell, gone) => endGone(tasks as never, gone, sent));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(ended, [], "first read without it: not gone yet (a read can come back empty for a moment)");
    assert.ok(JSON.parse(store["live-seen"]!)["add:aaaaaa"], "still on the phone's record meanwhile");
    mock.timers.setTime(t0 + GONE_AFTER_MS + 1);
    w.poke();
    assert.deepEqual(ended, [["add:aaaaaa", "stopped", GONE_WORDS]], "gone past the limit: its task ends stopped, once; the told one is left alone");
    w.poke();
    assert.equal(ended.length, 1, "ended once");
    assert.equal(JSON.parse(store["live-seen"]!)["add:aaaaaa"], undefined, "and dropped from the phone's record");
    w();
  } finally {
    mock.timers.reset();
  }
});

test("finding 52: a slow move's card reads as on its way, never \"Move stopped\" over \"It's on its way\"", async () => {
  const { SLOW_MS, slowed, stillGoing, endLine } = await import("./live-steps.ts");
  const slow = slowed(moveTrack(foldInto(topUp({ atIso: new Date(Date.now() - SLOW_MS - 60_000).toISOString() }, {}))[0]!)!, Date.now());
  assert.equal(slow.end?.slow, true);
  assert.equal(stillGoing(slow), true, "slow is still on its way");
  assert.equal(endLine(slow), "Slower than usual. It's on its way to your SOL wallet. This changes to Done when it lands.");
  const bad = { ...slow, end: { ok: false, line: "It didn't go." } };
  assert.equal(stillGoing(bad), false, "control: a real stop is stopped");
  // every place the card and the row said "Stopped" or drew red asks stillGoing first
  const src = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  const steps = readFileSync(new URL("./live-steps.ts", import.meta.url), "utf8");
  assert.match(steps, /if \(t\.end && !stillGoing\(t\) && !t\.end\.ok\) return `\$\{verb\} stopped`;/);
  assert.match(steps, /return `\$\{verb\}\$\{m\[2\]\}`;/, "a slow move reads in the asked form, never \"Moving …\"");
  // the shared row (ACTIVITY-MOTION): a slow one's face is "slow" before any stop, keeps its progress line and its time
  assert.match(src, /if \(t\.end\?\.slow \|\| slowAdd\(t, now\)\) return "slow";\n  if \(t\.end\) return/, "rowState: slow is asked before stopped");
  assert.match(src, /p=\{t\.end && !t\.end\.ok && !stillGoing\(t\) \? undefined : progressOf/, "a slow row keeps its progress line");
  assert.match(src, /const now = useNow\(tracks\.filter\(stillGoing\)\.map\(\(t\) => t\.startMs\)\);/, "its time keeps moving");
  assert.match(src, /const now = useNow\(stillGoing\(t\) \? \[t\.startMs\] : \[\]\);/, "and the tracker's");
  assert.match(src, /stillGoing\(t\) \? `Slower than usual · \$\{shortElapsed\(now - t\.startMs\)\}` : "Stopped"/, "the tracker says slower, never Stopped");
});

test("a Move paid from Private (NEAR Confidential): the Safe's fill when Private was short, then the payment, each ticking on the ledger's word; one that came back says the money is in Private", () => {
  const up = (o: Partial<SpendingActivity>) => moveTrack(row({ id: "mv-k", kind: "top-up", usd: "20.00", words: "Moving $20.00 to your SOL wallet", goesTo: ["sol"], via: "private", ...o }))!;
  const filling = up({ fill: "doing" });
  // QA's Sim re-check (rule 11): every step shown, in order, a step to come naming who will do it
  assert.deepEqual(filling.steps.map((s) => [s.label, s.state]), [["NEAR Confidential is moving money from your Safe to Private.", "doing"], ["Then NEAR Confidential pays your SOL wallet.", "waiting"], ["Then Solana lands it in your SOL wallet.", "waiting"]], "the copy review's ruling: a step not begun says Then");
  assert.deepEqual(up({ fill: "done" }).steps.map((s) => s.state), ["done", "doing", "waiting"]);
  assert.deepEqual(up({ fill: "done", paidDone: true }).steps.map((s) => s.state), ["done", "done", "doing"], "paid: the landing waits on the chain read");
  const done = up({ fill: "done", status: "done" });
  assert.deepEqual([done.steps.map((s) => s.label), done.end], [["NEAR Confidential moved it to Private.", "NEAR Confidential paid your SOL wallet.", "It's in your SOL wallet."], { ok: true, line: "In your SOL wallet." }]);
  assert.deepEqual(up({}).steps.map((s) => s.label), ["NEAR Confidential is paying your SOL wallet.", "Then Solana lands it in your SOL wallet."], "Private covered it: no fill step");
  const back = up({ status: "failed", note: "NEAR Confidential sent it back. Your money is in Private." });
  // rule 8 (the design review's words, crawl-home): who didn't pay which wallet, the figure back in Private; its taps in crawl-home.test.ts
  assert.deepEqual(back.end, { ok: false, line: "NEAR Confidential didn't pay your SOL wallet. The $20.00 is back in Private.", whole: true });
});

test("a stopped step that names who does the work reads as a sentence: \"NEAR Intents didn't finish moving it to Solana.\"; control: a place's step keeps \"… didn't finish.\"", () => {
  const stopped = (label: string) => endLine({ id: "x", kind: "move", title: "Move $5.00", wallets: ["sol"], startMs: 0, steps: [{ key: "safe", label: "Approved", state: "done" }, { key: "intents", label, state: "failed" }], end: { ok: false, line: "It's in your NEAR wallet." } } as unknown as LiveTrack);
  assert.equal(stopped("NEAR Intents is moving it to Solana"), "NEAR Intents didn't finish moving it to Solana. It's in your NEAR wallet.");
  assert.equal(stopped("NEAR Confidential is paying your SOL wallet."), "NEAR Confidential didn't finish paying your SOL wallet. It's in your NEAR wallet.");
  assert.equal(stopped("Through NEAR Confidential"), "Through NEAR Confidential didn't finish. It's in your NEAR wallet.", "control: a place's step");
  assert.doesNotMatch(stopped("NEAR Intents is moving it to Solana")!, / is moving .* didn't finish/, "never the doing words with didn't finish after them");
});

test("a Send's first step names the wallet it really left (QA, 5 Nov: a SOL wallet Send said \"Left your Safe\")", async () => {
  const { sendFrom, sendTrack } = await import("./live-steps.ts");
  const at = new Date().toISOString();
  const mv = (id: string, from: string) => ({ id, kind: "pay", status: "done", from, to: "x", amount: "1", startedAtIso: at, updatedAtIso: at, explorerUrls: [] }) as never;
  assert.equal(sendFrom(mv("hidden-row:abc", "nep141:sol.omft.near")), "sol");
  assert.equal(sendFrom(mv("hidden-row:abc", "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near")), "sol", "a Solana token: the SOL wallet");
  assert.equal(sendFrom(mv("hidden-row:abc", "nep141:hood.omft.near")), "hood");
  assert.equal(sendFrom(mv("pocket-send:abc", "nep141:sol.omft.near")), "private");
  assert.equal(sendFrom(mv("send:abc", "nep141:wrap.near")), "safe", "control: the Safe's Send stays the Safe's");
  assert.equal(sendTrack(mv("hidden-row:abc", "nep141:sol.omft.near"))!.steps[0]!.label, "Left your SOL wallet");
  assert.equal(sendTrack(mv("pocket-send:abc", "nep141:sol.omft.near"))!.steps[0]!.label, "Left your private balance");
  assert.equal(sendTrack(mv("send:abc", "nep141:wrap.near"))!.steps[0]!.label, "Left your Safe");
});

test("Sim re-check (5 Nov): a Swap or Move paid from Private is ONE Home line; its payments (safe-send / pocket-send) are its steps, never \"Send to …\" lines of their own (control: a Send not in any move's `paid` keeps its line)", async () => {
  const now = new Date().toISOString();
  const swap = row({ id: "mv-k1", kind: "top-up", status: "on-its-way", via: "private", fill: "doing", paid: ["safe-send:abc"], goesTo: ["sol"], network: undefined, to: undefined, atIso: now, words: "Move $10.00 to your SOL wallet" });
  const bridge = { call: async (m: string) => (m === "spending.activity" ? { ok: [swap] } : m === "device.store.get" ? { ok: { value: null } } : { ok: null }), on: () => () => {} };
  const legOf = mv({ id: "safe-send:abc", to: "7xKX…sol", startedAtIso: now });
  const other = mv({ id: "s9", to: "kiosk.near", startedAtIso: now });
  let got: LiveTrack[] = [];
  const stop = watchLive(bridge as never, () => ({ adds: [], movements: [legOf, other] }), (t) => { got = t; });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.deepEqual(got.map((t) => t.id).sort(), ["move:mv-k1", "send:s9"], "the move once; its payment no line of its own; another Send still its own");
});

test("Sim re-check (5 Nov): a Safe Buy (Trade's native-buy job) has its Home line while it goes; ended, none (its record is Home's history); control: Trade's other jobs never draw on Home", () => {
  const t = (o: Partial<Task>): Task => ({ id: "x", app: "home", title: "", steps: [{ label: "NEAR Intents is swapping it", state: "doing", at: 0 }], state: "pending", startedAt: Date.now(), ...o } as Task);
  const buy = t({ id: "native-buy-nep141:btc.omft.near-1", app: "trade", title: "Buy $25.00 of BTC" });
  const rows = startingTracks([buy, t({ id: "native-buy-nep141:btc.omft.near-2", app: "trade", title: "Buy $5.00 of BTC", state: "done", endedAt: Date.now() }), t({ id: "buy-sol-abc", app: "trade", title: "Buy $5.00 of WIF" })]);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.title]), [[buy.id, "swap", "Buy $25.00 of BTC"]]);
});

test("a Sim walk (5 Nov): a Move's leg paid from Private is in its Move's job, never a Send \"to the address you gave\" (control: a payment no move names is still a Send)", async () => {
  const { activityRows } = await import("../activity-rows.ts");
  const now = new Date().toISOString();
  const move = row({ id: "mv1", kind: "move", usd: "30.00", words: "Move $30.00 to your SOL wallet", from: "safe", to: undefined, goesTo: ["sol"], via: "private", paid: ["pocket-send:sim-2"], atIso: now } as Partial<SpendingActivity>);
  const leg = mv({ id: "pocket-send:sim-2", to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", startedAtIso: now, updatedAtIso: now });
  const other = mv({ id: "pocket-send:sim-9", to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", startedAtIso: now, updatedAtIso: now });
  const bridge = { call: async (m: string) => (m === "spending.activity" ? { ok: [move] } : m === "device.store.get" ? { ok: { value: null } } : { ok: null }), on: () => () => {} };
  let got: LiveTrack[] = [];
  const stop = watchLive(bridge as never, () => ({ adds: [], movements: [leg, other] }), (t) => { got = t; });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  const ids = got.map((t) => t.id);
  assert.ok(ids.includes("move:mv1"), "the Move's own job");
  assert.ok(!ids.includes("send:pocket-send:sim-2"), "its leg is no Send of its own");
  assert.ok(!got.some((t) => t.id.endsWith("sim-2") && /address you gave/.test(t.title)), "never \"to the address you gave\"");
  // the one model (jobs-onerow): the move's `paid` list keeps the leg out of Activity's list too, so it is drawn once, as its Move
  const listed = activityRows([leg, other], [{ ...move, shown: true }]);
  assert.deepEqual(listed.ledger.map((m) => m.id), ["pocket-send:sim-9"], "the leg's row is drawn once, as its Move");
  assert.equal(got.find((t) => t.id === "move:mv1")!.kind, "move");
  assert.ok(ids.includes("send:pocket-send:sim-9"), "control: a payment no move names stays a Send");
});

test("a site's Add paid from Private is an Add on its job and Activity row: \"Add $10.00 to your pump.fun wallet\", never \"Move $10.00 …\" (control: a Move to the SOL wallet paid from Private stays \"Move\")", async () => {
  const { rowTitle } = await import("./live-steps.ts");
  const add = moveTrack(row({ id: "mv-s", kind: "top-up", usd: "10.00", words: "Add $10.00 to your pump.fun wallet", siteName: "pump.fun", site: "pump", goesTo: [], via: "private", status: "on-its-way" } as Partial<SpendingActivity>))!;
  assert.equal(add.title, "Add $10.00 to your pump.fun wallet");
  assert.equal(rowTitle(add), "Add $10.00 to your pump.fun wallet");
  assert.doesNotMatch(add.title, /^Move/);
  const move = moveTrack(row({ id: "mv-m", kind: "top-up", usd: "10.00", words: "Moving $10.00 to your SOL wallet", goesTo: ["sol"], via: "private", status: "on-its-way" }))!;
  assert.equal(move.title, "Move $10.00 to your SOL wallet", "control");
});
