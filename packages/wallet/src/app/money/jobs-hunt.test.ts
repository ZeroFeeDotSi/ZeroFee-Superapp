// QA's Jobs hunt (5 Nov), each with its control:
// B3 every job shows the time LEFT from the protocol's own estimate, or says there is none; never the time spent.
// M4 a Move's job names what went on to the wallets, never the inflow grid's rest; its receipt keeps the cents.
// M5 a finished Send keeps its dollars. M6 the Activity centre lists a move once (Trade shows its trades there).
// M7 the Sim lands nothing while the page is offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";
import { TIME_WORDS, receiptLeft, timeLeft } from "@zerofee/shell-api/job-steps.ts";
import { startJob } from "@zerofee/shell-api/job-start.ts";
import { carried, createJobCarry } from "@zerofee/shell-api/job-carry.ts";
import { moveTrack, sendTrack, withCarry, type LiveTrack } from "./live-steps.ts";
import { dollars } from "../format.ts";
import type { Movement } from "../../types.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const T = 1_700_000_000_000;

test("B3: the time left in words, counting down; past the estimate it never blames the estimate (QA's Sim walk, 5 Nov): \"Almost there\" under twice it, then \"Slower than usual\"; none, said plainly (copywriter, 5 Nov)", () => {
  assert.equal(timeLeft(T + 12_000, T), "12 s left");
  assert.equal(timeLeft(T + 150_000, T), "3 min left");
  // a 60 s job, started at T - 90 s: 30 s past, under 2x, "Almost there"; 125 s past (185 s run, over 120 s): slow
  assert.equal(timeLeft(T - 30_000, T, T - 90_000), TIME_WORDS.almost);
  assert.equal(timeLeft(T - 125_000, T, T - 185_000), TIME_WORDS.slow);
  assert.equal(timeLeft(T - 60_000, T, T - 120_000), TIME_WORDS.almost, "control: exactly twice the estimate is still almost there");
  assert.equal(timeLeft(T - 30_000, T), TIME_WORDS.almost, "control: no start known, never slow, never a blame");
  assert.equal(receiptLeft(T - 5_000, T, T - 45_000), "Almost there.");
  // the copy review's ruling (5 Nov): both with a full stop and no figure, the row's and the receipt's the same
  assert.deepEqual([TIME_WORDS.almost, TIME_WORDS.slow], ["Almost there.", "Slower than usual."]);
  assert.equal(receiptLeft(T - 125_000, T, T - 185_000), "Slower than usual.", "never a doubled full stop");
  for (const w of [TIME_WORDS.almost, TIME_WORDS.slow]) assert.doesNotMatch(w, /\d|\.\.$/, w);
  for (const at of [T - 1_000, T - 30_000, T - 125_000, T - 3_600_000]) for (const st of [undefined, at - 10_000, at - 3_600_000]) {
    assert.doesNotMatch(`${timeLeft(at, T, st)} ${receiptLeft(at, T, st)}`, /longer than shown|than shown|estimate was|wrong/, "never says the estimate was wrong");
  }
  assert.equal(timeLeft(undefined, T), TIME_WORDS.none);
  assert.equal(receiptLeft(T + 240_000, T), "About 4 min left.");
  assert.equal(receiptLeft(T + 40_000, T), "About 40 seconds left.");
  assert.equal(receiptLeft(undefined, T), "This job has no time estimate.");
  // control: the rows never count the time spent while a job runs (Home's rows and the Activity centre)
  const live = src("./LiveTrack.tsx");
  // fix/move-leg-steps (copy review): the step's words through cardStep (no figure the title shows)
  assert.match(live, /return `\$\{step \? cardStep\(step\.label, t\.title\) : "On its way"\} · \$\{timeLeft\(t\.endsAt, now, t\.startMs\)\}`;/);
  assert.doesNotMatch(live, /"On its way"\} · \$\{shortElapsed/);
  const centre = src("../../../../shell-api/src/TaskCentre.tsx");
  assert.match(centre, /const left = timeLeft\(t\.endsAt, now, t\.startedAt\);/);
});

test("B3: the starting row's time goes on with the rows that take its place (after a reload too); a quote's own time wins; an ended row has none", () => {
  const store = { list: () => [{ id: "send:s1" }], subscribe: () => () => undefined };
  const published: Record<string, unknown>[] = [];
  const tasks = { publish: (t: Record<string, unknown>) => (published.push(t), true), update: () => true, end: () => true, open: () => {}, drop: () => true } as never;
  const job = startJob(tasks, { title: "Send $3.00 to 9xQe…VFin", usd: "$3.00", etaSec: 60 }, { now: () => T, store });
  assert.equal(published[0]!.endsAt, T + 60_000, "the starting row counts down from the tap");
  job.made(["send:s1"]);
  assert.deepEqual([carried("send:s1")?.usd, carried("send:s1")?.endsAt], ["$3.00", T + 60_000]);
  const going: LiveTrack = { id: "send:s1", kind: "send", title: "Send to the address you gave", wallets: ["safe"], startMs: T, steps: [] };
  assert.equal(withCarry(going, carried("send:s1")).endsAt, T + 60_000);
  assert.equal(withCarry({ ...going, endsAt: T + 9_000 }, carried("send:s1")).endsAt, T + 9_000, "the protocol's own quote wins");
  assert.equal(withCarry({ ...going, end: { ok: true, line: "" } }, carried("send:s1")).endsAt, undefined, "control: an ended row has no time left");
  assert.equal(withCarry(going, undefined).endsAt, undefined, "control: nothing carried, nothing made up");
  // a reload: Home's sealed store reads back what was kept; a damaged copy is no copy
  let sealed: string | null = null;
  const page = (now: number) => { const c = createJobCarry(new Map(), () => now); c.keep(sealed, (t) => { sealed = t; }); return c; };
  page(T).set(["move:mv-1"], { endsAt: T + 240_000, usd: "$20.00" });
  assert.equal(page(T + 1_000).get("move:mv-1")?.endsAt, T + 240_000);
  sealed = "{not json";
  assert.equal(page(T).get("move:mv-1"), undefined);
});

test("B3: a Move paid from Private counts down from its quote's time (control: none quoted, none made up)", () => {
  const r = { id: "mv-1", kind: "top-up", usd: "21.00", legsUsd: "20.00", status: "on-its-way", shown: true, atIso: new Date(T).toISOString(), words: "Moving $21.00 to your SOL wallet", goesTo: ["sol"], via: "private", etaSeconds: 130 } as SpendingActivity;
  assert.equal(moveTrack(r)!.endsAt, T + 130_000);
  const { etaSeconds: _e, ...none } = r;
  assert.equal(moveTrack(none as SpendingActivity)!.endsAt, undefined);
});

test("M4: a Move's job names what went on to the wallets ($20), never the inflow grid's rest that stayed ($21) (control: no legs, the row's own)", () => {
  const r = { id: "mv-1", kind: "top-up", usd: "21.00", legsUsd: "20.00", status: "done", shown: true, atIso: new Date(T).toISOString(), words: "Moved $21.00 to your SOL wallet", goesTo: ["sol"], via: "private" } as SpendingActivity;
  assert.equal(moveTrack(r)!.title, "Move $20.00 to your SOL wallet");
  const { legsUsd: _l, ...plain } = r;
  assert.equal(moveTrack(plain as SpendingActivity)!.title, "Move $21.00 to your SOL wallet", "control");
  // the receipt: the job's own figure, with its cents
  // the receipt's figure keeps its cents (format.ts dollars: "$20.00")
  assert.match(src("../screens/MoveSheet.tsx"), /<p className="zf-receipt__amount">\{dollars\(made\.toFixed\(2\)\)\}<\/p>/);
  assert.equal(dollars((20).toFixed(2)), "$20.00");
});

test("M4: the core says what went on to the wallets when the Safe sent more (the inflow grid) (control: a Move to the NEAR wallet alone has no second figure)", async () => {
  const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const run = async (usd: number, network = "sol") => {
    // the Sim's steps held on the test's clock (it reads only the core's answer to the tap): none lands mid-call on a busy machine
    const clock = simClock();
    const mock = createMockBridge({ latencyMs: 0, settleMs: 20, timers: clock.timers, float: { moveMs: 10, timers: clock.timers }, hiddenStart: { usdc: "5", near: "0" }, safeFillOpen: true } as never);
    for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
    const kept = new Map<string, unknown>();
    const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok as never; };
    const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => Date.now(), every: () => () => undefined, fromPrivate: true } as never);
    const host = async <R,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as R;
    const svc = createSpendingService({ engine: () => f as never, call: host });
    const r = await svc.call<SpendingActivity>("spending.topUp", { usd, legs: [{ network, usd }], key: `hunt-${network}-0123456789abcdef0123456789` });
    assert.ok("ok" in r, JSON.stringify(r));
    return r.ok;
  };
  const grid = await run(20);
  assert.deepEqual([grid.usd, grid.legsUsd], ["21.00", "20.00"]);
  const exact = await run(20, "near");
  assert.deepEqual([exact.usd, exact.legsUsd], ["20.00", undefined], "control: to the NEAR wallet, exactly as asked");
});

test("M5: a Send's row keeps the dollars it was made for, to its end (control: none carried, as before)", () => {
  const m = { id: "s1", kind: "pay", status: "done", amount: "3", startedAtIso: new Date(T).toISOString(), updatedAtIso: new Date(T + 5_000).toISOString(), explorerUrls: ["x"] } as Movement;
  assert.equal(sendTrack(m, "safe", "the address you gave", "$3.00")!.title, "Send $3.00 to the address you gave");
  assert.equal(sendTrack({ ...m, id: "s9" }, "safe", "the address you gave")!.title, "Send to the address you gave", "control: nothing carried, no coin named");
  assert.equal(sendTrack({ ...m, id: "s9", from: "nep141:sol.omft.near", amount: "0.05" }, "safe", "them")!.title, "Send 0.05 SOL to them", "nothing carried: the coin it sent (core hunt, 5 Nov)");
  assert.equal(sendTrack({ ...m, id: "s1" }, "safe", "them")!.title, "Send $3.00 to them", "its watch's dollars, carried from the tap");
  // its watch hands it the dollars carried from the tap
  assert.match(src("./live-steps.ts"), /sendTrack\(m, sendFrom\(m\), payeeWords\(m\.to \?\? ""\), carried\(`send:\$\{m\.id\}`\)\?\.usd\)/);
});

test("M6: in the Activity centre Trade shows its trades, never Home's moves a second time (control: Trade's own tab keeps them)", () => {
  const app = src("../../../../trade/src/app/TradeApp.tsx");
  assert.match(app, /setAppHistory\("trade", \(\) => \([\s\S]{0,200}<Activity tradesOnly \/>/);
  assert.match(app, /\{tab === "activity" && <Activity \/>\}/, "control: Trade's own Activity tab lists its moves too");
  assert.match(src("../../../../trade/src/app/screens/Activity.tsx"), /\.\.\.\(tradesOnly \? \[\] : moves\)/);
});

test("M7: the Sim lands nothing while the page is offline; back online, it lands (control: online, it lands as before)", async () => {
  const g = globalThis as { navigator?: unknown; addEventListener?: unknown };
  const was = { nav: Object.getOwnPropertyDescriptor(globalThis, "navigator"), add: g.addEventListener };
  const waiting: (() => void)[] = [];
  const nav = { onLine: false };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  g.addEventListener = (_e: string, f: () => void) => void waiting.push(f);
  try {
    const clock = simClock();
    const mock = createMockBridge({ latencyMs: 0, settleMs: 10, timers: clock.timers, hiddenStart: { usdc: "50", near: "0" } } as never);
    await mock.call("subwallet.create", { kind: "trade", chain: "sol" });
    const sol = ((await mock.call<any>("subwallet.list", {})) as any).ok.find((w: { chain: string }) => w.chain === "sol");
    const r = await mock.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: sol.id, usd: 5 }], label: "Move $5.00" });
    assert.ok("ok" in r, JSON.stringify(r));
    const status = async () => (((await mock.call<any>("ledger.activity", {})) as any).ok as { id: string; status: string }[]).find((x) => x.id.startsWith("pocket-send:"))?.status;
    // the pay's 10 ms step falls due on the test's clock (it was a 60 ms wall wait), with the page offline
    await clock.advance(60);
    assert.notEqual(await status(), "done", "offline: not Done");
    assert.ok(waiting.length > 0, "it waits for the page to be back online");
    nav.onLine = true;
    for (const f of waiting.splice(0)) f();
    assert.equal(await status(), "done", "back online: it lands");
  } finally {
    if (was.nav) Object.defineProperty(globalThis, "navigator", was.nav); else delete (globalThis as { navigator?: unknown }).navigator;
    g.addEventListener = was.add;
  }
});

test("UI's Home audit (5 Nov): a Move's row names the receipt's figure, its job's own (receipt $118.00, row \"Moving $130.00\"); control: nothing carried, the row's own", () => {
  const t: LiveTrack = { id: "move:mv-9", kind: "move", title: "Move $130.00 to your SOL wallet", wallets: ["safe", "sol"], startMs: T, steps: [] };
  assert.equal(withCarry(t, { usd: "$118.00", at: T }).title, "Move $118.00 to your SOL wallet");
  assert.equal(withCarry(t, undefined).title, "Move $130.00 to your SOL wallet", "control");
  assert.equal(withCarry({ ...t, kind: "swap", title: "Swap $10 of USDC for SOL" }, { usd: "$118.00", at: T }).title, "Swap $10 of USDC for SOL", "control: a Swap keeps its own name");
});
