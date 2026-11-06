// How a swap in place ends (intents-swap.ts and the ledger's follow), from the sandbox hunt of 5 Nov (its findings B1, B2,
// B3, M1, M2; its tests were written to fail on the first build). Pure logic, no network: 1Click and the chain are fakes.
// Time moves only when a test says so (an injected clock and sleep, node's mock timers for the ledger's follow).
import { walletProblems } from "./wallet-problems.ts";
import { whereNow } from "./app/format.ts";
import { problemLine } from "@zerofee/core/services";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApis } from "./apis.ts";
import { createIntentsSwap, PRIVATE_WATCH_MS, SLOW_WATCH_MS, SWAP_USDC, SAFE_WATCH_FOR_MS } from "./intents-swap.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const WNEAR = "nep141:wrap.near";
const DEP = (n: number) => String(n).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");

function rig(o: { privateStatus?: () => string; moveAnswer?: () => unknown } = {}) {
  let t = 1_000_000;
  const bal = new Map<string, bigint>([[SWAP_USDC, 1_000_000_000n], [WNEAR, 0n]]);
  const jobs = new Map<string, any>();
  const followed: string[] = [];
  let deps = 0;
  const sleepers: (() => void)[] = [];
  const slept: number[] = [];
  const moveReads: string[] = [];
  const said = new Map<string, { status: string; amountOut?: string }>();
  const d = {
    status: async (dep: string) => said.get(dep) ?? { status: "PENDING_DEPOSIT" },
    bridgeFor: () => ({
      call: async (method: string, p: any) => {
        if (method === "subwallet.safeSwapQuote") return { ok: { depositAddress: DEP(++deps), amountIn: p.amount, minAmountOut: p.atLeast } };
        if (method === "subwallet.float.swapQuote") return { ok: { amountIn: p.amount, amountOut: "2000000000000000000000000", minAmountOut: "1980000000000000000000000", decimals: 24, coinUsd: 2.5 } };
        if (method === "subwallet.float.swap") return { ok: { id: "fm-1", status: "pending" } };
        if (method === "subwallet.float.move") { moveReads.push(p.id); return o.moveAnswer?.() ?? { ok: { status: o.privateStatus?.() ?? "pending" } }; }
        return { problem: { code: "x", whatHappened: method } };
      },
    }) as any,
    myAccount: async () => ({ accountId: "kim.near" }),
    coin: async (id: string) => (id === WNEAR ? { decimals: 24, symbol: "wNEAR" } : { decimals: 6, symbol: "USDC" }),
    ledgerBalance: async (_a: string, token: string) => bal.get(token) ?? 0n,
    canChain: async () => true,
    dryQuote: async (r: any) => ({ quote: { amountIn: r.amount, amountOut: "2000000000000000000000000", minAmountOut: "1980000000000000000000000", amountInUsd: "5", amountOutUsd: "4.99" } }) as any,
    signAll: async () => ({ txHash: `tx${deps}`, explorerUrls: [] }),
    approvals: (s: any) => s,
    remember: async (m: any) => void jobs.set(m.id, m),
    follow: (m: any) => void followed.push(m.id),
    now: () => t,
    iso: () => new Date(t).toISOString(),
    // time moves only when the test says so: each sleep waits for tick()
    sleep: (ms: number) => new Promise<void>((r) => { slept.push(ms); sleepers.push(() => ((t += ms), r())); }),
  };
  const s = createIntentsSwap(d);
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { const w = sleepers.splice(0); w.forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  return { s, bal, jobs, followed, said, slept, moveReads, sleepers, tick, now: () => t, advance: (ms: number) => (t += ms) };
}

test("1. a Safe swap is NOT done because some other wNEAR reached the Safe (1Click hasn't swapped)", async () => {
  const r = rig();
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  r.bal.set(SWAP_USDC, r.bal.get(SWAP_USDC)! - 5_000_000n); // the mt_transfer left
  await r.tick(2);
  r.bal.set(WNEAR, 10n ** 22n); // anyone's 0.01 wNEAR deposit for the Safe (ft_transfer_call msg=<Safe>), not the swap
  await r.tick(2);
  const end = r.jobs.get(job.id);
  assert.notEqual(end.status, "done", `job says done with amountOut ${end.amountOut} off an unrelated deposit`);
  // control: 1Click's own SUCCESS for this deposit ends it, with 1Click's figure, never the stranger's 0.01
  r.said.set(job.depositAddress!, { status: "SUCCESS", amountOut: "2000000000000000000000000" });
  await r.tick(2);
  assert.equal(r.jobs.get(job.id).status, "done");
  assert.equal(r.jobs.get(job.id).amountOut, "2");
});

test("2. two Safe swaps to the same coin: the first one's coins don't end the second", async () => {
  const r = rig();
  const q1 = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const j1 = await r.s.swap({ quoteId: q1.id }, "wallet");
  const q2 = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "7", source: "safe" }, "wallet");
  const j2 = await r.s.swap({ quoteId: q2.id }, "wallet");
  r.bal.set(WNEAR, 2n * 10n ** 24n); // swap 1's 2 wNEAR lands; swap 2 is still with 1Click (or gets refunded later)
  r.said.set(r.jobs.get(j1.id).depositAddress, { status: "SUCCESS", amountOut: "2000000000000000000000000" }); // 1Click: swap 1 done
  await r.tick(2);
  assert.equal(r.jobs.get(j1.id).status, "done");
  assert.notEqual(r.jobs.get(j2.id).status, "done", `swap 2 says done with amountOut ${r.jobs.get(j2.id).amountOut}: swap 1's coins`);
});

test("3. a Safe swap 1Click refunds reads refunded inside a minute, not after 10 minutes of 'moving' (control: still with 1Click, it stays moving)", async () => {
  const r = rig();
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "safe" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  await r.tick(Math.ceil(60_000 / 400)); // control: a minute of 1Click saying nothing has ended
  assert.equal(r.jobs.get(job.id).status, "moving", "no end until 1Click says one");
  // 1Click refunds: the USDC is back in the Safe; wNEAR never rises
  r.said.set(job.depositAddress!, { status: "REFUNDED" });
  const at = r.now();
  await r.tick(Math.ceil(60_000 / 400)); // one minute of reads
  assert.equal(r.jobs.get(job.id).status, "refunded", "a minute after the refund it reads refunded");
  assert.ok(Date.parse(r.jobs.get(job.id).updatedAtIso) - at < 60_000);
  assert.deepEqual(r.followed, [], "its own read said so; nothing waited for the ledger's slow follow");
});

test("4. a NEAR-wallet (private) swap that ends after 10 minutes still ends", async () => {
  let status = "pending";
  const r = rig({ privateStatus: () => status });
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "private" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  await r.tick(Math.ceil(SAFE_WATCH_FOR_MS / 250) + 5); // past watchPrivate's 10 minutes
  assert.equal(r.jobs.get(job.id).status, "moving", "control: no end until its move ends");
  assert.equal(r.slept.at(-1), SLOW_WATCH_MS, "past its fast minutes it keeps a slow read");
  status = "done";
  await r.tick(20);
  assert.equal(r.jobs.get(job.id).status, "done", "watchPrivate gave up at 10 min with no fallback: the job is 'moving' forever (and a reload never follows it: the ledger's resume needs m.depositAddress, ledger.ts:1915)");
});

const MIN = 60_000, DAY = 24 * 60 * MIN;
/** A NEAR wallet swap kept "moving" by an earlier page, `age` old by the rig's clock. */
const kept = (r: { now: () => number }, id: string, age: number): Movement => {
  const at = new Date(r.now() - age).toISOString();
  return { id, kind: "swap", status: "moving", source: "private", from: SWAP_USDC, to: WNEAR, amount: "5", startedAtIso: at, updatedAtIso: at, explorerUrls: [], caller: "trade" };
};

test("B3: a reload at any age follows a NEAR wallet swap again and ends it; past its fast minutes it reads at the slow pace (control: a young one reads fast)", async () => {
  let status = "pending";
  const r = rig({ privateStatus: () => status });
  await r.s.resume(kept(r, "swap:fm-old", 3 * DAY));
  assert.deepEqual(r.slept, [SLOW_WATCH_MS], "three days old: every 10 s, not four times a second");
  await r.tick(3);
  assert.deepEqual(r.moveReads, ["fm-old", "fm-old", "fm-old"], "its own move");
  assert.equal(r.jobs.has("swap:fm-old"), false, "still pending: nothing written");
  status = "done";
  await r.tick(2);
  assert.equal(r.jobs.get("swap:fm-old").status, "done");
  const y = rig();
  await y.s.resume(kept(y, "swap:fm-young", MIN));
  assert.deepEqual(y.slept, [PRIVATE_WATCH_MS], "control: a minute old, the fast read");
});

test("B3: asking again never adds a reader: Activity's every read resumes the same job, and one reader follows it (control: another job has its own; a job that ended can be followed again)", async () => {
  const r = rig();
  const q = await r.s.swapQuote({ from: SWAP_USDC, to: WNEAR, amountIn: "5", source: "private" }, "wallet");
  const job = await r.s.swap({ quoteId: q.id }, "wallet");
  for (let i = 0; i < 5; i++) await r.s.resume(r.jobs.get(job.id));
  assert.equal(r.sleepers.length, 1, "the swap's own reader, no second one");
  await r.tick(3);
  assert.equal(r.moveReads.length, 3, "one read per tick");
  await r.s.resume(kept(r, "swap:fm-2", MIN));
  await r.s.resume(kept(r, "swap:fm-2", MIN));
  assert.equal(r.sleepers.length, 2, "control: another job, one more reader");
  let status = "pending";
  const e = rig({ privateStatus: () => status });
  await e.s.resume(kept(e, "swap:fm-3", MIN));
  status = "done";
  await e.tick(2);
  assert.equal(e.sleepers.length, 0, "it ended: its reader stopped");
  await e.s.resume(kept(e, "swap:fm-3", MIN));
  assert.equal(e.sleepers.length, 1, "control: its place is free again");
});

test("B3: a move the core no longer knows (it lets go of a move after a week) ends the job saying it can't be read, never 'moving' for ever (control: any other no from the core keeps reading)", async () => {
  const unknown = { problem: { code: "security.float.unknown-move", whatHappened: "ZeroFee doesn't know that move." } };
  const r = rig({ moveAnswer: () => unknown });
  await r.s.resume(kept(r, "swap:fm-gone", 8 * DAY));
  await r.tick(2);
  const end = r.jobs.get("swap:fm-gone");
  assert.equal(end.status, "problem");
  assert.match(end.problem.whatHappened, /more than a week old/);
  assert.equal(problemLine(end.problem), "This swap is more than a week old, so ZeroFee can't read how it ended. Your money is either in your NEAR wallet or still with NEAR Intents. Check your NEAR wallet's balance first.");
  assert.doesNotMatch(problemLine(end.problem), /\b(safe|lost|waiting for you)\b/i, "we can't know: neither safe nor lost, and no promise");
  assert.match(readFileSync(new URL("../../shell-api/src/ProblemView.tsx", import.meta.url), "utf8"), /case "unsure": return `Your money is \$\{m\.where\}\. \$\{m\.check\}`;/, "the Problem page says the same");
  assert.equal(end.problem.money.state, "unsure", "never a money line saying nothing moved");
  assert.equal(whereNow(end, ""), "check your NEAR wallet", "never \"still in your private balance\"");
  assert.equal(r.sleepers.length, 0, "no more reads");
  let answer: unknown = { problem: { code: "security.locked", whatHappened: "Locked." } };
  const c = rig({ moveAnswer: () => answer });
  await c.s.resume(kept(c, "swap:fm-locked", MIN));
  await c.tick(3);
  assert.equal(c.jobs.has("swap:fm-locked"), false, "control: a phone that is locked for now ends nothing");
  answer = { ok: { status: "refunded" } };
  await c.tick(2);
  assert.equal(c.jobs.get("swap:fm-locked").status, "refunded");
});

// ---- the ledger's follow (trackQuote), with Activity's re-follow next to the page's own fast read
const flush = async (t: { mock: { timers: { tick(ms: number): void } } }, ms: number, times: number) => {
  for (let i = 0; i < times; i++) { t.mock.timers.tick(ms); for (let n = 0; n < 6; n++) await new Promise((r) => setImmediate(r)); }
};
function followRig(t: { mock: { timers: { enable(o: { apis: string[] }): void } } }, job: Movement) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const core = fakeCore({ accountId: "kim.near" });
  core.store.set("movements", JSON.stringify([job]));
  let said: unknown = { status: "PROCESSING" };
  const asked: { dep: string; tag?: string }[] = [];
  const apis = { ...createApis(replayFetch()), status: async (dep: string, _via?: string, tag?: string) => { asked.push({ dep, ...(tag ? { tag } : {}) }); if (said instanceof Error) throw said; return said as never; } };
  const T0 = Date.parse(job.startedAtIso);
  const ledger = createLedgerService({ bridge: core, chain: fakeNear("kim.near", {}), apis, trackMs: 10, now: () => T0 + 20 * MIN });
  const heard: Movement[] = [];
  ledger.on<{ movement: Movement }>("ledger.movementUpdated", (e) => heard.push(e.movement));
  const kept = () => (JSON.parse(core.store.get("movements")!) as Movement[]).find((m) => m.id === job.id)!;
  return { core, ledger, heard, asked, kept, say: (v: unknown) => void (said = v) };
}
const safeJob = (id: string): Movement => {
  const at = "2026-11-05T06:00:00.000Z";
  return { id, kind: "swap", status: "moving", source: "safe", from: SWAP_USDC, to: WNEAR, amount: "5", startedAtIso: at, updatedAtIso: at, explorerUrls: [], depositAddress: "ab".repeat(32), statusTag: "tag-of-this-deposit-0001", caller: "trade" };
};

test("the follow leaves an end the page's fast read already wrote: its settled time stays, no second end, never back to moving", async (t) => {
  const f = followRig(t, safeJob("swap:tx1"));
  await f.ledger.call("ledger.activity", { limit: 50 });
  await flush(t, 10, 1);
  assert.deepEqual(f.asked[0], { dep: "ab".repeat(32), tag: "tag-of-this-deposit-0001" }, "1Click's status for its own address, with its tag");
  // the page's watchSafe ends it first: done, with the time it took
  f.core.store.set("movements", JSON.stringify([{ ...f.kept(), status: "done", amountOut: "2", settledMs: 1234 }]));
  f.say(new Error("no answer")); // a failed read, past the stuck mark: the older copy must not be written back as "moving"
  await flush(t, 10, 1);
  assert.equal(f.kept().status, "done", "never back to moving on a failed read");
  f.say({ status: "SUCCESS", swapDetails: { amountOut: "2000000000000000000000000" } });
  await flush(t, 10, 2);
  assert.equal(f.kept().settledMs, 1234, "the fast read's end stays as it wrote it");
  assert.equal(f.heard.filter((m) => m.status === "done").length, 0, "no second end");
  const n = f.asked.length;
  await flush(t, 10, 2);
  assert.equal(f.asked.length, n, "and the follow stopped");
  t.mock.timers.reset();
});

test("control: the follow alone ends a Safe swap on 1Click's word only, after a reload", async (t) => {
  const f = followRig(t, safeJob("swap:tx2"));
  await f.ledger.call("ledger.activity", { limit: 50 });
  await flush(t, 10, 2);
  assert.equal(f.kept().status, "moving");
  f.say({ status: "REFUNDED" });
  await flush(t, 10, 2);
  assert.equal(f.kept().status, "refunded");
  assert.equal(f.heard.at(-1)!.status, "refunded");
  t.mock.timers.reset();
});

// ---- what the person sees (source reads, as the other Home and Native screen tests do)
const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("M1: the Safe swap's privacy line is on its quote screen, Buy and Sell, before the button (control: not on the receipt; only Native's sheet asks for a Safe swap)", () => {
  const page = source("../../trade/src/native/NativeScreens.tsx");
  const receipt = page.indexOf('data-testid="native-receipt"'), who = page.indexOf('data-testid="native-who"'), about = page.indexOf('data-testid="native-about"'), go = page.indexOf("tp-go");
  assert.ok(receipt > 0 && who > 0, "both on the page");
  assert.ok(about > receipt && who > about && go > who, "after the receipt's branch, in the quote form, above the button");
  assert.match(page.slice(who - 60, who + 40), /<p className="zf-small nc-who" data-testid="native-who">\{W\.who\}<\/p>/, "shown as it is, under no condition of its own");
  assert.match(source("../../trade/src/native/words.ts"), /who: "Anyone can see your Safe's coins change on NEAR\./);
  assert.match(source("../../trade/src/native/swap.ts"), /"ledger\.swapQuote", \{ \.\.\.pairOf\(side, assetId\), amountIn: amount, source: "safe"/);
});

test("M2: the Safe's total holds a Safe swap in flight (moving only, at its price), with its row; Hot's number doesn't take it", () => {
  const home = source("./app/screens/Home.tsx");
  assert.match(home, /const swapping = \(activity \?\? \[\]\)\.filter\(\(m\) => m\.kind === "swap" && m\.status === "moving" && m\.source === "safe"\);/, "control: an ended swap, or a NEAR wallet's, isn't counted");
  assert.match(home, /const addsUsd = [^\n]*swapping\.reduce\(\(t, m\) => t \+ \(Number\(usdOf\(m\.amount, tokens\.get\(m\.from \?\? ""\)\?\.priceUsd\)\) \|\| 0\), 0\);/);
  assert.match(home, /const tabUsd = tab === "safe" \? \(!shown \? null : safeUsd && addsUsd > 0 \? plusUsd\(safeUsd, addsUsd\.toFixed\(2\)\) : safeUsd\) : hotUsd;/, "on the Safe tab only");
  assert.match(home, /\.\.\.swapping\.map\(\(m\) => \{[\s\S]{0,420}HOME_WORDS\.swapping/, "its own row says where it is");
});

test("a young move the core can't find keeps reading, slowly, and still lands: a missing record is not an end (control: a week old ends)", async () => {
  let answer: unknown = { problem: { code: "security.float.unknown-move", whatHappened: "ZeroFee doesn't know that move." } };
  const r = rig({ moveAnswer: () => answer });
  await r.s.resume(kept(r, "swap:fm-young", 2 * DAY));
  await r.tick(2);
  assert.equal(r.jobs.get("swap:fm-young"), undefined, "no end on an unknown read");
  assert.equal(r.sleepers.length, 1, "it keeps reading");
  assert.equal(r.slept.at(-1), SLOW_WATCH_MS, "at the slow pace");
  answer = { ok: { status: "done" } };
  await r.tick(2);
  assert.equal(r.jobs.get("swap:fm-young").status, "done", "the real end still lands");
});

test("a NEAR wallet swap 1Click failed says where to look, never that the money is back: only REFUNDED promises that (control: a refund does say it)", async () => {
  const r = rig({ moveAnswer: () => ({ ok: { status: "failed" } }) });
  await r.s.resume(kept(r, "swap:fm-failed", DAY));
  await r.tick(2);
  const end = r.jobs.get("swap:fm-failed");
  assert.equal(end.status, "problem");
  assert.equal(problemLine(end.problem), "NEAR Intents didn't finish this swap. Your money is either in your NEAR wallet or still with NEAR Intents. Check your NEAR wallet's balance first.");
  assert.doesNotMatch(`${problemLine(end.problem)} ${end.problem.more ?? ""}`, /\b(is back|coming back|Safe|waiting for you)\b/);
  assert.equal(whereNow(end, ""), "check your NEAR wallet");
  const refunded = rig({ moveAnswer: () => ({ ok: { status: "refunded" } }) });
  await refunded.s.resume(kept(refunded, "swap:fm-back", DAY));
  await refunded.tick(2);
  assert.equal(whereNow(refunded.jobs.get("swap:fm-back"), ""), "back in your NEAR wallet", "control");
});

