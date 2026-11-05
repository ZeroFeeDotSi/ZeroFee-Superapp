// The one-balance screens (S1, S4, S6, S7, S8 and the top line): their words from the FloatView, their problems, and
// their source (one pill per screen, the three-word vocabulary). JSX doesn't render under node, so the words are tested
// on the sample float and the screens' files are read as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ProblemError } from "@zerofee/core/problem";
import { createMockBridge, type MockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { FloatMove } from "@zerofee/shell-api/mock-float.ts";
import { createSampleFloat, type ChainView, type FloatChain, type MoveRow } from "../float-view.ts";
import { about, DECLINED_WORDS, floatProblems, problemOf, rowOf, shareWords, shortChain, shownMove, tradingLine, whereWords } from "./boards.ts";

const dir = new URL("./screens/", import.meta.url);
const catalogue = readFileSync(new URL("../../errors.md", import.meta.url), "utf8");
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");

function sample(approve = true) {
  let t = 0;
  const queue: { at: number; fn: () => void }[] = [];
  const f = createSampleFloat({ now: () => t, later: (fn, ms) => { queue.push({ at: t + ms, fn }); }, approve: async () => approve, moveSec: 6 });
  const step = (ms: number) => { const end = t + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const q = queue[0]; if (!q || q.at > end) break; queue.shift(); t = q.at; q.fn(); } t = end; };
  return { f, step };
}
const chain = (over: Partial<ChainView> = {}): ChainView => ({ chain: "sol", name: "Solana", nativeUsd: 12, readyUsd: 11, coinsUsd: 0, targetUsd: 40, pct: 40, tooLittle: false, wallets: [], ...over });

test("the top line: Trading $X · Solana $a · Robinhood $b · BNB $c, from the float", async () => {
  const { f, step } = sample();
  assert.equal(tradingLine(f.snapshot()), "Your NEAR wallet $0.00 · Solana $0.00 · Robinhood Chain $0.00 · BNB Chain $0.00");
  await f.add(100);
  step(12_000);
  assert.equal(tradingLine(f.snapshot()), "Your NEAR wallet $100.00 · Solana $40.00 · Robinhood Chain $25.00 · BNB Chain $25.00");
});

test("S4 short chain: what's ready now and the smaller buy; on its way while a move flies; nothing under $1", () => {
  assert.deepEqual(shortChain(chain(), 50), { ready: "$11.00 ready now", buyNow: 11, moreUsd: 39 });
  assert.deepEqual(shortChain(chain({ readyUsd: 0.4 }), 25), { ready: "$0.40 ready now", moreUsd: 25 });
  assert.equal(shortChain(chain({ inFlight: { usd: 30, etaSec: 4, to: "chain" } }), 50).onWay, "More is on its way · about 4 s");
  assert.equal(shortChain(chain({ inFlight: { usd: 30, etaSec: 4, to: "reserve" } }), 50).onWay, undefined, "money leaving the chain isn't on its way to it");
  assert.equal(about(70), "about 1 minute");
  assert.equal(about(130), "about 2 minutes");
  assert.equal(about(0), "any moment");
});

test("D143: a trade asks no Face ID, so the Buy page has no Face ID icon or line and never hides for a sheet; the page is the trade from the tap (control: Short chain still there)", () => {
  const sheet = read("TradeSheet.tsx").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(sheet, /faceLine|<Face \/>|hidden=\{away\}/);
  assert.match(sheet, /setMoment\(\{ phase: "sending", at, got \}\);/);
  assert.match(sheet, /<ShortChain /, "control");
});

test("D143 (review, 3 Nov): a whole sale under $1 says \"Most of this goes on fees.\" on Trade's sheet before the tap, never on an approve sheet (control: the line rides on the quote's own flag)", () => {
  const sheet = read("TradeSheet.tsx");
  assert.match(sheet, /\{q\?\.mostlyFees && <p className="zf-small tp-note">Most of this goes on fees\.<\/p>\}/);
  assert.match(read("../../near/engine.ts"), /side === "sell" && units === have && payUsd < NEAR_MIN_USD \? \{ mostlyFees: true as const \}/, "control: the quote says it for a whole sale under the floor only");
});

test("S8: where a move's money is now, in words", () => {
  const m: MoveRow = { id: "1", kind: "out", chain: "sol", usd: 40, status: "moving", where: "in-flight", at: 0, etaSec: 5 };
  assert.equal(whereWords(m, "Solana"), "On its way · about 5 s");
  assert.equal(whereWords({ ...m, status: "done", where: "chain" }, "Solana"), "Now in your SOL wallet", "a wallet by its own name (D129)");
  assert.equal(whereWords({ ...m, kind: "in", status: "done", where: "reserve" }), "Now in your NEAR wallet");
  assert.equal(whereWords({ ...m, kind: "home", status: "done", where: "main" }), "Back in your Safe");
  assert.equal(whereWords({ ...m, status: "refunded", where: "reserve" }), "Back in your NEAR wallet");
  assert.equal(whereWords({ ...m, status: "failed", where: "reserve" }), "It didn't go through · nothing moved");
  assert.equal(whereWords({ ...m, status: "waiting", where: "reserve" }), "Waiting its turn", "the planner's own move: waiting, nothing about how it works");
  assert.equal(whereWords({ ...m, kind: "home", status: "waiting", where: "reserve" }), "Waiting its turn · still in your NEAR wallet");
  assert.equal(whereWords({ ...m, kind: "add", status: "waiting", where: "main", held: { id: "h", readyAtIso: "", needsSecondDevice: false } }), "Waiting · in your Safe");
  assert.equal(whereWords({ ...m, kind: "add", status: "failed", where: "main" }), "Didn't go · still in your Safe");
});

test("the sliders' second line: the share in dollars, Off at 0 %, 'too little to move' under the chain's minimum", () => {
  assert.equal(shareWords(chain()), "$40.00");
  assert.equal(shareWords(chain({ pct: 0, targetUsd: 0 })), "Off");
  assert.equal(shareWords(chain({ chain: "bsc", name: "BNB", targetUsd: 4, pct: 10, tooLittle: true })), "$4.00 · too little to move (under $10.00)");
});

test("S1 and S7: a refill the person says no to is said plainly, nothing moved; it isn't a Problem", async () => {
  const { f } = sample(false);
  assert.equal(await f.add(15), "declined");
  assert.equal(f.snapshot().totalUsd, 0);
  assert.equal(DECLINED_WORDS, "You said no. Nothing moved.");
  assert.match(read("AddTakeOut.tsx"), /DECLINED_WORDS/);
});

test("S7 Take out: all by default; the chains come back first, so the words say so", async () => {
  const { f, step } = sample();
  await f.add(100); step(12_000);
  const m = await f.takeOut("all");
  assert.equal(m.kind, "home");
  step(12_000);
  assert.equal(f.snapshot().totalUsd, 0);
  assert.match(read("AddTakeOut.tsx"), /stay until you sell them/);
});

test("every float Problem has a unique code, the three parts, a next step, and a row in errors.md", () => {
  const seen = new Set<string>();
  for (const [name, make] of Object.entries(floatProblems)) {
    const p = (make as (c: "sol") => ReturnType<typeof floatProblems.addFailed>)("sol");
    assert.ok(p.code.startsWith("trade.float."), name);
    assert.ok(!seen.has(p.code), `${p.code} twice`); seen.add(p.code);
    assert.ok(p.whatHappened.length > 8 && p.money.state && p.next.label, name);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
  // every failure path on the screens ends at onProblem
  for (const file of ["AddTakeOut.tsx", "ShortChain.tsx"]) assert.ok(read(file).includes("await onProblem("), `${file} shows a Problem`);
});

test("one pill per screen, and the three words: no Public, Private mode, Spread or Rearrange on any board", () => {
  const files = readdirSync(dir).filter((f) => /^(AddTakeOut|TradingLine|ShortChain|JobCard|Activity)\.tsx$/.test(f));
  assert.equal(files.length, 5);
  for (const f of files) {
    const src = read(f);
    const texts = src.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g) ?? [];
    for (const t of texts) assert.doesNotMatch(t, /\b(Public|Private mode|Spread|Rearrange|untraceable|anonymous|recommended|coming soon)\b/i, `${f}: ${t}`);
    // a screen (one return) holds at most one solid pill; the set-up's five steps are five returns
    const screens = src.split(/\n\s*(?:if \(step === "[a-z]+"\) )?return \(/).slice(1);
    for (const s of screens) assert.ok((s.match(/className="zf-btn"/g) ?? []).length <= 1, `${f}: more than one pill on a screen`);
  }
});

/**
 * The screens' add and moveNow over MockBridge's float (mock-float.ts, Security's shapes): a Problem from the core is thrown
 * as the core said it, `{ declined: true }` is "declined", and a FloatMove becomes the screens' row.
 */
function overMock(mock: MockBridge) {
  let n = 0;
  const call = async <T,>(method: string, p: Record<string, unknown>): Promise<T> => { const r = await mock.call<T>(method, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  return {
    add: async (usd: number): Promise<MoveRow | "declined"> => { const m = await call<{ id: string; status: string; startedAtIso?: string }>("ledger.toTrading", { amount: String(usd) }); return m.status === "declined" ? "declined" : { id: m.id, kind: "add", usd, status: "moving", where: "in-flight", at: Date.now() }; },
    moveNow: async (chain: FloatChain, lamports: string): Promise<MoveRow | "declined"> => { const m = await call<FloatMove | { declined: true }>("subwallet.float.out", { chain, slot: 0, amount: lamports, key: `trade-boards-${String(++n).padStart(6, "0")}` }); return "declined" in m ? "declined" : rowOf(m, 1); },
    move: async (id: string) => rowOf(await call<FloatMove>("subwallet.float.move", { id })),
  };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("over MockBridge's float: the core's own Problems reach the screen in its words (short, under $2), the fallback only otherwise", async () => {
  const f = overMock(createMockBridge({ latencyMs: 0, settleMs: 1, float: { moveMs: 10 } }));
  // nothing in the float yet: the move is refused as short, in the core's words
  await assert.rejects(f.moveNow("sol", "100000000"), (e: unknown) => { const p = problemOf(e, floatProblems.moveFailed("sol")); assert.equal(p.code, "security.float.short"); assert.match(p.whatHappened, /Spending has \$[0-9.]+ in cash/); return true; });
  // under $2: not allowed
  await assert.rejects(f.moveNow("sol", "1000000"), (e: unknown) => { assert.equal(problemOf(e, floatProblems.moveFailed("sol")).code, "security.request.not-allowed"); return true; });
  assert.equal(problemOf(new Error("boom"), floatProblems.moveFailed("sol")).code, "trade.float.move-failed", "anything else: the screen's own Problem");
});

test("over MockBridge's float: a move that fails or is refunded says so on its row, and one that lands says where", async () => {
  for (const outcome of ["done", "failed", "refunded"] as const) {
    const f = overMock(createMockBridge({ latencyMs: 0, settleMs: 1, float: { moveMs: 10, startUsd: 50, outcome } }));
    const row = await f.moveNow("sol", "100000000");
    assert.notEqual(row, "declined");
    assert.equal(whereWords(row as MoveRow, "Solana"), "On its way · about 1 s");
    await wait(25);
    const after = await f.move((row as MoveRow).id);
    assert.equal(whereWords(after, "Solana"), { done: "Now in your SOL wallet", failed: "It didn't go through · nothing moved", refunded: "Back in your NEAR wallet" }[outcome]);
    void outcome;
  }
});

test("over MockBridge's float: past 20 moves a day with `decline`, the sheet's no is 'declined', shown plainly", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 1, float: { moveMs: 1, startUsd: 5000 }, decline: true });
  const f = overMock(mock);
  let last: MoveRow | "declined" = "declined";
  for (let i = 0; i < 21; i++) { last = await f.moveNow("sol", "100000000"); if (last === "declined") break; }
  assert.equal(last, "declined");
  assert.equal(DECLINED_WORDS, "You said no. Nothing moved.");
});

test("the Trading line's chain figures count money on its way there, so they agree with the total while a move lands", async () => {
  const { tradingLine } = await import("./boards.ts");
  const base = { chain: "sol" as const, name: "Solana", nativeUsd: 10, readyUsd: 9, coinsUsd: 0, targetUsd: 40, pct: 40, tooLittle: false, wallets: [] };
  const line = tradingLine({ totalUsd: 40, takeableUsd: 40, reserveUsd: 0, split: { sol: 100, hood: 0, bsc: 0, reserve: 0 }, moves: [], movesLeftToday: 20, chains: [{ ...base, inFlight: { usd: 30, etaSec: 4, to: "chain" } }] });
  assert.equal(line, "Your NEAR wallet $40.00 · Solana $40.00");
});

test("one name for one place: the person's own money outside Trading is \"your balance\" everywhere in Trade, never \"main balance\" (re-walk.5, D41)", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const files = [...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => new URL(f, dir)),
    ...["../boards.ts", "../job-cards.ts", "../../trade-problems.ts", "../../float-view.ts", "../../move-words.ts"].map((f) => new URL(f, dir))];
  for (const f of files) assert.doesNotMatch(strip(readFileSync(f, "utf8")), /main balance/i, f.pathname);
});

test("re-walk.3: \"Move $N more\" never offers the whole reserve: $8.06 held offers $7 (its fee comes out of the reserve too)", async () => {
  const { moveMoreUsd } = await import("./boards.ts");
  const { OUT_FEE_ROOM } = await import("../float.ts");
  assert.equal(moveMoreUsd(8, 8.06, OUT_FEE_ROOM), 7);
  assert.equal(moveMoreUsd(17, 17.2, OUT_FEE_ROOM), 16);
  assert.equal(moveMoreUsd(3, 50, OUT_FEE_ROOM), 3, "with room, what's missing");
  assert.ok(moveMoreUsd(9, 9.27, OUT_FEE_ROOM) * (1 + OUT_FEE_ROOM) <= 9.27);
});

test("Activity shows what the person did, what failed, and (D102) every move the engine still makes by itself", () => {
  const m = { id: "1", usd: 10, at: 0, where: "chain" as const, status: "done" as const };
  assert.equal(shownMove({ ...m, kind: "add" }), true, "a Top up");
  assert.equal(shownMove({ ...m, kind: "home", why: "asked" }), true, "a Put away");
  assert.equal(shownMove({ ...m, kind: "out", chain: "sol", why: "ready" }), true, "Make ready for Apps (D55)");
  assert.equal(shownMove({ ...m, kind: "in", chain: "sol", why: "older" }), true, "an older wallet's cash coming back (D55, D102)");
  assert.equal(shownMove({ ...m, kind: "out", chain: "hood", why: "gas" }), true, "gas (D102)");
  assert.equal(shownMove({ ...m, kind: "home", why: "over-cap" }), true, "the put-away above the cap (D102)");
  // a refill or rebalance exists only in a journal from before D102: behind the scenes unless it failed
  assert.equal(shownMove({ ...m, kind: "out", chain: "sol" }), false, "a refill");
  assert.equal(shownMove({ ...m, kind: "in", chain: "sol" }), false, "rebalancing");
  assert.equal(shownMove({ ...m, kind: "out", chain: "sol", status: "failed" }), true, "a background move that failed is shown");
});
