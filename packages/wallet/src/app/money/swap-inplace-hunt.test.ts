// Home's Swap in place, the bug hunt of 4 Nov: each FAIL held by a test, each with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus } from "@zerofee/core/spending";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { NEAR_CASH, nearOwnCoins, nearOwnUsd } from "../near-coins.ts";
import { tradingUsd } from "../trading.ts";
import { SWAP_NOT_TAKEN } from "@zerofee/core/float-moves";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { walletProblems } from "../../wallet-problems.ts";
import { endLine } from "./live-steps.ts";
import { SWAP_WORDS, swapKey } from "./swap-corridor.ts";
import { INPLACE_FACTS, inplaceDetail, inplaceJobDetail, inplacePage, inplaceRowOf, inplaceRows, isInplaceRow, SWAP_ROW, type FloatSwapMove } from "./inplace-activity.ts";
import { lineOf } from "../activity-rows.ts";
import { INPLACE_WORDS, inplaceTitle, quoteFailed, endsAtOf, inplaceArrives, failedLine, FOLLOW_CHECK_MS, inplaceBlock, inplaceTrack, inplaceUnits, INPLACE_STALE_MS, moveIdOf, nearCash, NOT_TAKEN_REASON, resumeInplace, RESUME_WAIT_MS, runInplaceJob, type InplaceQuote } from "./swap-inplace.ts";

const ZEC = "nep141:zec.omft.near";
const LIST: Record<string, { symbol: string; decimals: number; priceUsd?: string }> = { [ZEC]: { symbol: "ZEC", decimals: 8, priceUsd: "1000" }, "nep141:np.near": { symbol: "NP", decimals: 2 } };
const Q: InplaceQuote = { amountIn: "10000000", amountOut: "1000000", minAmountOut: "990000", decimals: 8, symbol: "ZEC", coinUsd: 1000, etaSeconds: 1 };

test("item 1: a coin bought in place counts on Home: its dollars at 1Click's list; no price, its amount and the total says so", () => {
  const own = nearOwnCoins([{ tokenId: NEAR_CASH, amount: "40000000" }, { tokenId: ZEC, amount: "1000000" }, { tokenId: "nep141:np.near", amount: "250" }, { tokenId: "nep141:sol.omft.near", amount: "1" }], (id) => LIST[id]);
  assert.deepEqual(own.map((c) => [c.symbol, c.amount, c.usd]), [["ZEC", "0.01", "10.00"], ["NP", "2.5", null]], "cash and the chains' coins (in reserveUsd) left out");
  assert.deepEqual(nearOwnUsd(own), { usd: 10, uncounted: true });
  const s = { reserveUsd: "40.00", networks: [{ network: "sol", cashUsd: "0.00", coinsUsd: "0.00" }, { network: "hood", cashUsd: "0.00", coinsUsd: "0.00" }] } as unknown as SpendingStatus;
  // the bug: Trade's positions name only what Trade bought, so $10 of ZEC bought in place was in neither figure
  assert.equal(tradingUsd(s, [], []).usd, "40.00", "control: without the NEAR wallet's own coins, the swap's $10 is missing");
  assert.deepEqual(tradingUsd(s, [], [], own), { usd: "50.00", partial: false, uncounted: true });
  // a coin Trade bought is the same coin in the NEAR wallet: counted once, from its balance
  const held = [{ chain: "near", address: "zec.omft.near", symbol: "ZEC", amount: "0.01", usd: "10.00" }];
  assert.equal(tradingUsd(s, held, [], own).usd, "50.00", "never twice");
  assert.equal(tradingUsd(s, held, []).usd, "50.00", "control: unread balance, Trade's positions as before");
});

test("item 4: the NEAR wallet's cash is one figure, and Max spends all of it, to the last unit", () => {
  assert.deepEqual(nearCash([{ tokenId: NEAR_CASH, amount: "50000000" }]), { usd: 50, raw: "50000000" }, "$50.00, never $48.54 (the move-out fee room)");
  assert.deepEqual(nearCash([{ tokenId: NEAR_CASH, amount: "27999999" }]), { usd: 27.99, raw: "27999999" });
  assert.equal(inplaceUnits("buy", 27.99, true, undefined, "27999999"), "27999999", "Max: all of it, nothing stranded");
  assert.equal(inplaceUnits("buy", 27.99, false, undefined, "27999999"), "27990000", "control: a typed amount is that amount");
  assert.equal(nearCash(null), null, "unread: no figure");
});

test("item 5: the floor before any quote; Max under it is blocked plainly; only all of a coin sells under it", () => {
  assert.equal(inplaceBlock({ side: "buy", amount: 0.79, all: true, most: 0.79, priced: true }), SWAP_WORDS.least, "Max $0.79: blocked, never blamed on NEAR Intents");
  assert.equal(inplaceBlock({ side: "buy", amount: 2, all: false, most: 50, priced: true }), null, "control: $2 goes");
  assert.equal(inplaceBlock({ side: "sell", amount: 0.5, all: true, most: 0.5, priced: true }), null, "all of a coin: any size (the core's rule)");
  assert.equal(inplaceBlock({ side: "sell", amount: 0.5, all: false, most: 3, priced: true }), SWAP_WORDS.least, "a part of a coin: the floor");
  assert.equal(inplaceBlock({ side: "sell", amount: 1, all: false, most: 0, priced: false }), INPLACE_WORDS.noPrice);
  assert.equal(inplaceBlock({ side: "sell", amount: 0, all: true, most: 0, priced: false }), INPLACE_WORDS.noPrice, "no price, no swap (float-moves.ts swapNow): Max is no door either");
  assert.equal(INPLACE_WORDS.noPrice, "NEAR Intents gave no price for this coin.");
  assert.equal(inplaceBlock({ side: "sell", amount: 0, all: true, most: 9, priced: true }), null, "control: a priced coin's whole sale goes");
});

test("item 5: a refusal before the swap started names no step that 'didn't finish'", () => {
  const t = { id: "r", kind: "swap" as const, title: "Swap $1 of USDC for ZEC", wallets: ["near"], startMs: 0, steps: [] };
  const before = inplaceTrack(t, { state: "failed", end: { ok: false, line: "A trade under $1 would mostly go on fees." }, before: true }, 1);
  assert.equal(endLine(before), "A trade under $1 would mostly go on fees.");
  // item 11: the quoter's own time is counted down, once; the running step is only who is doing it (control: no time of ours)
  assert.equal(inplaceTrack(t, { state: "doing" }, 0).steps[0]!.label, INPLACE_WORDS.step);
  assert.deepEqual(endsAtOf(1_000, Q), { endsAt: 2_000 });
  assert.deepEqual(endsAtOf(1_000, { ...Q, etaSeconds: undefined } as InplaceQuote), {});
});

test("item 9: the least the tap signs is shown with the quote", () => {
  const { etaSeconds: _e, ...noTime } = Q;
  assert.equal(inplaceArrives("buy", noTime, "ZEC"), "You get about 0.01 ZEC, at least 0.0099 ZEC.");
  assert.equal(inplaceArrives("buy", Q, "ZEC"), `You get about 0.01 ZEC, at least 0.0099 ZEC. About ${Q.etaSeconds} s.`, "the quote's own time, here");
  assert.equal(inplaceArrives("sell", { ...noTime, amountOut: "9940000", minAmountOut: "9840600" }, "ZEC"), "You get about $9.94, at least $9.84.");
});

test("items 9, 10, 12: the sheet asks the quote again, the job keeps its dollars, its time ends a stuck job, the coin says where it lands", () => {
  const src = readFileSync(new URL("./InplaceSwap.tsx", import.meta.url), "utf8");
  assert.match(src, /setTimeout\(\(\) => once\(false\), QUOTE_REFRESH_MS\)/, "asked again while it sits");
  assert.match(src, /Date\.now\(\) - price\.at > QUOTE_FRESH_MS\) return price\.again\(\)/, "a stale price is asked again before the tap");
  assert.match(src, /usd: `\$\$\{paid\.toFixed\(2\)\}`/, "tasks.ts keeps only \"$10.00\", never \"10.00\"");
  assert.match(src, /staleMs: INPLACE_STALE_MS, staleDetail: INPLACE_WORDS\.unread/);
  assert.match(src, /name: NEAR_WALLET/);
});

test("a dead NEAR Intents: Try again is its own button on its own line, under the sentence, never inline with it", () => {
  const src = readFileSync(new URL("./InplaceSwap.tsx", import.meta.url), "utf8");
  const line = src.match(/<p [^>]*data-testid="swap-price-late">.*<\/p>\s*<button [^>]*>Try again<\/button>/);
  assert.ok(line, "the sentence closes, then the button follows");
  assert.match(line[0], /<button type="button" className="zf-btn zf-btn--quiet" data-testid="swap-price-again" onClick=\{price\.again\}>/);
  assert.doesNotMatch(src, /swap-price-late">(?:(?!<\/p>).)*<button/, "no button inside the sentence");
  // the Swap sheet's two: the UI reviewer's ruling (6 Nov), its sentence in line 1's slot and the ONE button reading Try again
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /zf-btn--quiet" data-testid="swap-(price-again|stopped-next)"/, "never a second grey button");
  for (const id of ["swap-price-late", "swap-stopped"]) assert.doesNotMatch(sheet, new RegExp(`${id}">(?:(?!</p>).)*<button`), id);
});

test("item 3: a reload mid-swap: the job is picked up from the core's moves by its key and ends on the move's own end", async () => {
  // the tap's page, still following it: the load's pickup leaves it alone
  let release: () => void = () => {};
  const hang = { call: async (m: string) => { if (m === "subwallet.float.swap") await new Promise<void>((r) => (release = r)); return { ok: { id: "fm-a", status: m === "subwallet.float.swap" ? "pending" : "done" } }; } } as unknown as Bridge;
  const first = runInplaceJob({ bridge: hang, tasks: undefined, rowId: "swap:a", route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "4000000", q: Q, key: "a", tapMs: 1_000, sleep: async () => undefined });
  const moves = [{ id: moveIdOf("swap:b"), kind: "swap", status: "pending" }, { id: "fm-a", kind: "swap", status: "pending" }];
  let reads = 0;
  const core = { call: async (m: string) => (m === "subwallet.float.moves" ? { ok: moves } : { ok: { ...moves[0], status: ++reads < 2 ? "pending" : "done" } }) } as unknown as Bridge;
  const row = (id: string) => ({ id, steps: [{ label: INPLACE_WORDS.step }], startedAt: 1_000 });
  assert.equal(await resumeInplace({ bridge: core, tasks: undefined, pending: [row("swap:a")], now: () => 2_000, sleep: async () => undefined }), 0, "running here: not picked up");
  release();
  assert.equal(await first, "done");
  // the reload: a new page, only the job's row (Home's sealed store) and the core's moves
  const ends: [string, string, string | undefined][] = [];
  const tasks = { update: () => true, end: (id: string, s: string, d?: string) => (ends.push([id, s, d]), true) } as never;
  assert.equal(await resumeInplace({ bridge: core, tasks, pending: [row("swap:b")], now: () => 60_000, sleep: async () => undefined }), 1);
  assert.deepEqual(ends, [["swap:b", "done", undefined]], "followed to the core's end");
  assert.equal(moveIdOf("swap:b"), "fm-b", "the core's id from the tap's one key");
});

test("item 3: the job's own row and the core's moves are all a reload needs: nothing about a swap is kept in plain localStorage", () => {
  const code = readFileSync(new URL("./swap-inplace.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /localStorage|setItem/, "never beside Home's sealed store (job-start.ts sealJobs)");
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(app, /sealJobs\(bridge\)\.then\(\(\) => \{\n\s+const pending = taskStore\(\)\.list\(\)/, "the rows are read only after the sealed store gave them back (control: before it, this page has none)");
});

test("item 3: a tap the core never had ends 'Nothing moved' only after it had time to get there; another swap's job and a failed read are left alone", async () => {
  const ends: [string, string, string | undefined][] = [];
  const tasks = { update: () => true, end: (id: string, s: string, d?: string) => (ends.push([id, s, d]), true) } as never;
  const empty = { call: async () => ({ ok: [] }) } as unknown as Bridge;
  let slept = 0;
  await resumeInplace({ bridge: empty, tasks, pending: [{ id: "swap:c", steps: [{ label: INPLACE_WORDS.step }], startedAt: 1_000 }, { id: "swap:trade", steps: [{ label: "Jupiter is swapping it" }], startedAt: 0 }], now: () => 10_000, sleep: async (ms) => void (slept += ms) });
  assert.equal(slept, RESUME_WAIT_MS - 9_000, "a tap 9 s ago may still reach the core: read again once its wait is up");
  assert.deepEqual(ends, [["swap:c", "failed", INPLACE_WORDS.nothing]], "control: Trade's coin swap isn't touched");
  ends.length = 0;
  // the move turns up on the second read: followed, never "Nothing moved"
  let second = 0;
  const late = { call: async (m: string) => (m === "subwallet.float.moves" ? { ok: second++ ? [{ id: "fm-d", kind: "swap", status: "done" }] : [] } : { ok: { id: "fm-d", status: "done" } }) } as unknown as Bridge;
  await resumeInplace({ bridge: late, tasks, pending: [{ id: "swap:d", steps: [{ label: INPLACE_WORDS.step }], startedAt: 1_000 }], now: () => 10_000, sleep: async () => undefined });
  assert.deepEqual(ends, [["swap:d", "done", undefined]]);
  ends.length = 0;
  // a moves read that fails ends nothing, however old the job: it is read again, and the core's end is the end
  let tries = 0, pause = 0;
  const down = { call: async (m: string) => (m === "subwallet.float.moves" ? (++tries < 3 ? { problem: { code: "x" } } : { ok: [{ id: "fm-e", kind: "swap", status: "done" }] }) : { ok: { id: "fm-e", status: "done" } }) } as unknown as Bridge;
  await resumeInplace({ bridge: down, tasks, pending: [{ id: "swap:e", steps: [{ label: INPLACE_WORDS.step }], startedAt: 0 }], now: () => 20 * 60_000, sleep: async (ms) => { pause += ms; assert.deepEqual(ends, [], "the moves unread: not ended"); } });
  assert.equal(pause, 2 * FOLLOW_CHECK_MS);
  assert.deepEqual(ends, [["swap:e", "done", undefined]]);
});

test("item 2: Activity lists each swap in place from the core's moves: what it paid and for what, by where it is", () => {
  const at = new Date(5_000).toISOString();
  const rows = inplaceRows([
    { id: "fm-home-swap-1", kind: "swap", status: "done", usd: 10, sent: { tokenId: NEAR_CASH, amount: "10000000" }, expected: { tokenId: ZEC, amount: "1" }, startedAtIso: at },
    { id: "fm-home-swap-2", kind: "swap", status: "refunded", usd: 4, sent: { tokenId: ZEC, amount: "1" }, expected: { tokenId: NEAR_CASH, amount: "1" }, startedAtIso: at },
    { id: "fm-home-swap-3", kind: "swap", status: "pending", usd: 5, sent: { tokenId: NEAR_CASH, amount: "5000000" }, expected: { tokenId: "nep141:xrp.omft.near", amount: "1" }, startedAtIso: at },
    { id: "fm-4", kind: "out", status: "done", usd: 5, sent: { tokenId: NEAR_CASH, amount: "1" }, expected: { tokenId: "x", amount: "1" }, startedAtIso: at },
  ], (id) => LIST[id]);
  assert.deepEqual(rows.map((r) => [r.words, r.status]), [
    [SWAP_ROW.done("10.00", "USDC", "ZEC"), "done"], [SWAP_ROW.back("4.00", "ZEC"), "refunded"], [SWAP_ROW.going("5.00", "USDC", "XRP"), "on-its-way"],
  ], "control: a move out isn't a swap row (Spending lists it)");
  assert.equal(rows[0]!.words, "Swapped $10.00 of USDC for ZEC");
  // "came back" only on a true refund (the core's status, set only by 1Click's REFUNDED); a failed move names no refund
  const failed = inplaceRows([{ id: "fm-home-swap-9", kind: "swap", status: "failed", usd: 3, sent: { tokenId: ZEC, amount: "1" }, expected: { tokenId: NEAR_CASH, amount: "1" }, startedAtIso: at }], (id) => LIST[id]);
  assert.equal(failed[0]!.words, "Couldn't swap $3.00 of ZEC for USDC");
  assert.doesNotMatch(failed[0]!.words, /came back/);
  // its page: both ends are the NEAR wallet, one step, no public transaction (the Sim crawl: Spending's page said "To Safe")
  assert.ok(rows.every(isInplaceRow));
  assert.ok(!isInplaceRow({ id: "move:mv-1" }), "control: Spending's own rows keep their page");
  assert.deepEqual(INPLACE_FACTS.map((f) => f.value), ["NEAR wallet", "NEAR wallet"]);
  const page = inplacePage(rows[0]!);
  assert.deepEqual([page.steps.length, page.steps[0]!.label, page.done, page.swaps], [1, INPLACE_WORDS.stepDone, true, []]);
  assert.deepEqual(page.steps[0]!.end, { private: true });
  assert.equal(inplacePage(rows[2]!).steps[0]!.label, INPLACE_WORDS.step, "still going: never ticked");
  assert.equal(inplacePage(rows[2]!).done, undefined);
  assert.deepEqual(inplacePage(rows[1]!).steps, [], "came back: no step, never \"swapped\"");
});

test("the Sim: Wallet reads the NEAR wallet's moves; NEAR itself buys in place; 1Click's list prices the coins it holds", async () => {
  const b = createMockBridge({ latencyMs: 0, float: { startUsd: 50, swapMs: 0 } });
  const r = await b.call<unknown[]>("subwallet.float.moves", { app: "wallet" });
  assert.ok("ok" in r, "Home's Activity and the reload pickup read it");
  assert.ok("problem" in (await b.call("subwallet.float.moves", { app: "pay" })), "control: another app can't");
  const q = await b.call<{ amountOut: string }>("subwallet.float.swapQuote", { app: "wallet", side: "buy", coin: "nep141:wrap.near", amount: "4000000" });
  assert.ok("ok" in q && BigInt(q.ok.amountOut) > 0n, "wNEAR: priced in place");
  const list = await b.call<{ assetId: string; priceUsd?: string }[]>("ledger.tokens", {});
  assert.ok("ok" in list && Number(list.ok.find((t) => t.assetId === ZEC)?.priceUsd) > 0, "ZEC has its price in the Sim's list");
  assert.equal(list.ok.filter((t) => t.assetId === "nep141:wrap.near").length, 1, "NEAR once in the list, though the Sim's swap buys it too");
  // the Sim's move has the core's id, from the tap's key: what the reload's pickup looks for
  const m = await b.call<{ id: string }>("subwallet.float.swap", { app: "wallet", side: "buy", coin: ZEC, amount: "4000000", atLeast: "0", key: "swap-key-00000001" });
  assert.ok("ok" in m && m.ok.id === moveIdOf("swap:swap-key-00000001"), JSON.stringify(m));
});

const swapRow = (id: string, startedAt: number) => ({ id, steps: [{ label: INPLACE_WORDS.step }], startedAt });
const endsOf = () => {
  const ends: [string, string, string | undefined][] = [];
  return { ends, tasks: { update: () => true, end: (id: string, s: string, d?: string) => (ends.push([id, s, d]), true) } as never };
};

test("audit MUST 1: a swap that settled while the phone was closed ends done: the core's record decides, never the store's clock", async () => {
  // the real store: a job kept past the old 15 minutes is still pending for the load to pick up
  let t = 1_000_000;
  const store = createTaskStore({ now: () => t });
  const shellTasks = store.forApp("wallet");
  shellTasks.publish({ id: "swap:home-swap-old", title: "Swap $10 of USDC for ZEC", steps: [{ label: INPLACE_WORDS.step, state: "doing", at: t }], staleMs: INPLACE_STALE_MS, staleDetail: INPLACE_WORDS.unread });
  shellTasks.publish({ id: "swap:control", title: "The old clock", steps: [{ label: INPLACE_WORDS.step, state: "doing", at: t }], staleMs: 15 * 60_000, staleDetail: "old" });
  t += 20 * 60_000;
  const list = store.list();
  assert.equal(list.find((x) => x.id === "swap:control")!.state, "failed", "control: a 15-minute clock had already failed it, before any load read it");
  const row = list.find((x) => x.id === "swap:home-swap-old")!;
  assert.equal(row.state, "pending");
  const core = { call: async (m: string) => (m === "subwallet.float.moves" ? { ok: [{ id: moveIdOf(row.id), kind: "swap", status: "done" }] } : { ok: {} }) } as unknown as Bridge;
  assert.equal(await resumeInplace({ bridge: core, tasks: shellTasks, pending: [row], now: () => t, sleep: async () => undefined }), 1);
  const after = store.list().find((x) => x.id === row.id)!;
  assert.equal(after.state, "done");
  assert.equal(after.detail, INPLACE_WORDS.landed, "the time it took isn't counted across a closed phone");
  // only past the core's own week can the store's clock end it, and then it says neither safe nor lost
  assert.equal(INPLACE_STALE_MS, 7 * 86_400_000);
  assert.match(readFileSync(new URL("../../../../core/src/float-moves.ts", import.meta.url), "utf8"), /const KEEP_MS = 7 \* 86_400_000;/);
});

test("audit MUST 1: past 10 minutes the job says checking and goes on reading, and any page load finds it again", async () => {
  const { ends, tasks } = endsOf();
  let t = 0, reads = 0;
  const details: string[] = [];
  const slow = { call: async (m: string) => (m === "subwallet.float.swap" ? { ok: { id: "fm-s", status: "pending" } } : { ok: { id: "fm-s", status: ++reads < 8 ? "pending" : "done" } }) } as unknown as Bridge;
  const r = await runInplaceJob({ bridge: slow, tasks: { update: (_: string, u: { detail?: string }) => (u.detail && details.push(u.detail), true), end: (tasks as unknown as { end: (...a: unknown[]) => boolean }).end } as never, rowId: "swap:s", route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "s", tapMs: 0, now: () => t, sleep: async () => { t += 4 * 60_000; } });
  assert.equal(r, "done", "it never gave up");
  assert.deepEqual(ends, [["swap:s", "done", undefined]]);
  assert.equal(details[0], INPLACE_WORDS.checking);
  assert.equal(details.filter((d) => d === INPLACE_WORDS.checking).length, 1, "said once");
  assert.match(readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8"), /m\.resumeInplace\(/);
});

test("audit MUST 1: a tap whose answer was lost isn't ended by the lost answer: the core's record says", async () => {
  const route = { kind: "inplace" as const, source: "private" as const, side: "buy" as const, coin: ZEC };
  const { ends, tasks } = endsOf();
  const ran = { call: async (m: string) => { if (m === "subwallet.float.swap") throw new Error("the bridge dropped"); return m === "subwallet.float.moves" ? { ok: [{ id: moveIdOf("swap:l"), kind: "swap", status: "done" }] } : { ok: {} }; } } as unknown as Bridge;
  assert.equal(await runInplaceJob({ bridge: ran, tasks, rowId: "swap:l", route, units: "1", q: Q, key: "l", tapMs: 0, now: () => 40_000, sleep: async () => undefined }), "done");
  assert.deepEqual(ends, [["swap:l", "done", undefined]]);
  // control: the core never had it, its record read whole: only then "Nothing moved"
  const none = endsOf();
  const never = { call: async (m: string) => { if (m === "subwallet.float.swap") throw new Error("the bridge dropped"); return { ok: [] }; } } as unknown as Bridge;
  await runInplaceJob({ bridge: never, tasks: none.tasks, rowId: "swap:n", route, units: "1", q: Q, key: "n", tapMs: 0, now: () => RESUME_WAIT_MS, sleep: async () => undefined });
  assert.deepEqual(none.ends, [["swap:n", "failed", INPLACE_WORDS.nothing]]);
  // a job past the core's week with no move: nobody can say "Nothing moved"
  const old = endsOf();
  await resumeInplace({ bridge: { call: async () => ({ ok: [] }) } as unknown as Bridge, tasks: old.tasks, pending: [swapRow("swap:w", 0)], now: () => INPLACE_STALE_MS, sleep: async () => undefined });
  assert.deepEqual(old.ends, [["swap:w", "failed", INPLACE_WORDS.unread]]);
});

test("audit MUST 2: only a true refund or 1Click's own no says the money is back; a signed move's money is named unsure, as the landed words do", async () => {
  assert.equal(failedLine({ status: "refunded" }), INPLACE_WORDS.refunded);
  assert.equal(failedLine({ status: "failed", reason: NOT_TAKEN_REASON }), NOT_TAKEN_REASON, "1Click's own no: nothing moved, never \"back\"");
  assert.ok(RESUME_WAIT_MS >= 120_000, "the phone's core outlives a reload: a slow quote isn't \"Nothing moved\"");
  assert.equal(failedLine({ status: "failed", reason: "declined" }), INPLACE_WORDS.declined);
  for (const m of [{ status: "failed" as const }, { status: "failed" as const, reason: "anything else" }]) assert.equal(failedLine(m), INPLACE_WORDS.failed);
  assert.equal(NOT_TAKEN_REASON, SWAP_NOT_TAKEN, "the core's own reason");
  // the whole line, as endLine draws it on the tracker: 1Click's FAILED promises no refund
  const { ends, tasks } = endsOf();
  const failed = { call: async (m: string) => (m === "subwallet.float.swap" ? { ok: { id: "fm-f", status: "failed" } } : { ok: {} }) } as unknown as Bridge;
  await runInplaceJob({ bridge: failed, tasks, rowId: "swap:f", route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "f", tapMs: 0 });
  assert.deepEqual(ends, [["swap:f", "failed", "NEAR Intents didn't finish this swap. Your money is either in your NEAR wallet or still with NEAR Intents. Check your NEAR wallet first."]]);
  const tracked = inplaceTrack({ id: "r", kind: "swap", title: "x", wallets: ["near"], startMs: 0, steps: [] } as never, { state: "failed", end: { ok: false, line: INPLACE_WORDS.failed, whole: true } }, 1);
  assert.equal(endLine(tracked), INPLACE_WORDS.failed, "the whole line: no \"The swap didn't finish.\" before it");
  for (const w of ["failed", "checking", "lost", "unread"] as const) {
    assert.doesNotMatch(INPLACE_WORDS[w], /Your money is in your|back in your/, w);
    assert.ok(INPLACE_WORDS[w].includes(walletProblems.nearSwapFailed().money.where as string), w);
  }
  assert.ok(INPLACE_WORDS.failed.includes(walletProblems.nearSwapFailed().money.check as string), "its check line");
});

test("Activity lists Home's own swaps once: Trade's NEAR trades (same core call, Trade's history) and a ledger swap's key aren't a second row", () => {
  const at = new Date(5_000).toISOString();
  const move = (id: string) => ({ id, kind: "swap", status: "done" as const, usd: 10, sent: { tokenId: NEAR_CASH, amount: "10000000" }, expected: { tokenId: ZEC, amount: "1" }, startedAtIso: at });
  const home = moveIdOf(`swap:${swapKey()}`);
  const rows = inplaceRows([move(home), move("fm-job-000000000001"), move("fm-swap-q1")], () => "ZEC");
  assert.deepEqual(rows.map((r) => r.id), [`swap:${home}`], "Home's key only");
  assert.ok(isInplaceRow(rows[0]!));
  assert.ok(!isInplaceRow({ id: "swap:fm-swap-q1" }), "control: a ledger swap's row keeps its own page");
});

test("what a swap in place's row opens (copy review, 6 Nov): how it ended, by what the core says; Check your NEAR wallet only where nobody can prove it; never Not finished yet under Finished", () => {
  const at = new Date(5_000).toISOString();
  const row = (status: "done" | "failed" | "refunded" | "pending", more: object = {}) => inplaceRows([{ id: "fm-home-swap-1", kind: "swap", status, usd: 10, sent: { tokenId: NEAR_CASH, amount: "10000000" }, expected: { tokenId: ZEC, amount: "800000" }, startedAtIso: at, ...more }], () => ({ symbol: "ZEC", decimals: 8 }))[0]!;
  const done = inplaceDetail(row("done", { settled: { amountOut: "801000" } }));
  assert.deepEqual(done.page.ended, { label: "Finished", line: "Swapped 10 USDC for 0.00801 ZEC." });
  assert.equal(done.line, "10 USDC to ZEC");
  assert.equal(done.dayFirst, true);
  assert.equal(done.page.ended!.check, undefined);
  assert.deepEqual(inplaceDetail(row("done")).page.ended, { label: "Finished", line: "Swapped 10 USDC for ZEC." }, "no settled figure: never the quote's least as what came");
  const failed = inplaceDetail(row("failed"));
  assert.deepEqual(failed.page.ended, { label: "Ended", line: "NEAR Intents didn't finish this swap. Your money is either in your NEAR wallet or still with NEAR Intents.", check: "Check your NEAR wallet." });
  assert.equal(failed.page.steps[0]!.label, "NEAR Intents didn't finish it");
  // the same truth as the job's line: a true refund and a no are not "didn't finish"
  const back = inplaceDetail(row("refunded"));
  assert.deepEqual(back.page.ended, { label: "Ended", line: INPLACE_WORDS.refunded });
  assert.equal(back.again, true, "its next tap: Swap again");
  assert.deepEqual(back.page.steps, [], "a refund names no step");
  const no = inplaceDetail(row("failed", { reason: "declined" }));
  assert.deepEqual(no.page.ended, { label: "Ended", line: "Nothing moved." });
  assert.equal(no.again, undefined);
  const notTaken = inplaceDetail(row("failed", { reason: NOT_TAKEN_REASON }));
  assert.deepEqual(notTaken.page.ended, { label: "Ended", line: NOT_TAKEN_REASON });
  assert.equal(notTaken.again, undefined);
  assert.equal(inplaceDetail(row("pending")).page.ended, null, "no card while it runs");
  // the page draws them, and no other row's page changes
  const page = readFileSync(new URL("../screens/ActivityDetail.tsx", import.meta.url), "utf8");
  assert.match(page, /page\.ended === null \? null :/);
  assert.match(page, /page\.ended\?\.line \?\? \(page\.done \? W\.doneNoLink : W\.notYet\)/, "control: other rows keep their words");
});

test("a refunded swap in place's row says where the money is once: its name, then only \"Refunded\" (control: another row's refund keeps its words)", () => {
  const move = { id: "fm-home-swap-r", kind: "swap", status: "refunded", usd: 12, sent: { tokenId: NEAR_CASH, amount: "12000000" }, expected: { tokenId: "nep141:zec.omft.near", amount: "1" }, startedAtIso: "2026-11-06T00:00:00.000Z" } as FloatSwapMove;
  const row = inplaceRows([move], () => ({ symbol: "ZEC", decimals: 8 }))[0]!;
  assert.match(row.words, /came back to your NEAR wallet/);
  assert.equal(lineOf(row), "Refunded");
  assert.match(lineOf({ ...row, id: "other" }), /back in your NEAR wallet/);
});

test("real-tap proof, 6 Nov: the sheet's end is exactly the job's own line, on a refund and every other end (shots K02, M02: \"The swap didn't finish.\" went first)", async () => {
  const route = { kind: "inplace", source: "private", side: "buy", coin: ZEC } as const;
  const start = { id: "r", kind: "swap" as const, title: "x", wallets: ["near"], startMs: 0, steps: [] };
  const sheetOf = async (m: object) => {
    let t = start as Parameters<typeof endLine>[0];
    const { tasks, ends } = endsOf();
    await runInplaceJob({ bridge: { call: async () => ({ ok: m }) } as unknown as Bridge, tasks, rowId: "swap:r", route, units: "1", q: Q, key: "r", tapMs: 0, onView: (v) => { t = inplaceTrack(t, v, 1); } });
    return { line: endLine(t), row: ends[0]![2] };
  };
  const back = await sheetOf({ id: "fm-r", status: "refunded" });
  assert.equal(back.line, "NEAR Intents couldn't swap it. Your money is back in your NEAR wallet.");
  assert.equal(back.row, back.line, "the row says the same");
  assert.equal((await sheetOf({ id: "fm-r", status: "failed", reason: NOT_TAKEN_REASON })).line, NOT_TAKEN_REASON);
  // the copy review's FAILED sheet: the headline is its title and step; the row still says the whole end
  const failed = await sheetOf({ id: "fm-r", status: "failed" });
  assert.equal(failed.line, "Your money is either in your NEAR wallet or still with NEAR Intents. Check your NEAR wallet first.");
  assert.equal(failed.row, INPLACE_WORDS.failed);
});

test("real-tap proof, 6 Nov (4b): a swap in place has its one row on Home's Jobs, going and through its ended window; no other swap: row gets in", async () => {
  const { startingTracks, FOLD_AFTER_MS, FOLD_MS } = await import("./live-steps.ts");
  let t = 1_000_000;
  const store = createTaskStore({ now: () => t });
  const home = store.forApp("wallet"), trade = store.forApp("trade");
  const steps = [{ label: INPLACE_WORDS.step, state: "doing" as const, at: t }];
  home.publish({ id: "swap:home-swap-a", title: "Swap $10.00 of USDC for ZEC", steps, endsAt: t + 9_000 });
  home.publish({ id: "swap:home-swap-b", title: "Swap $20.00 of USDC for ZEC", steps });
  // controls: Trade's own, and a coin trade's row by its quote's id
  trade.publish({ id: "swap:home-swap-trade", title: "Swap $1", steps });
  trade.publish({ id: "swap:q1", title: "Swap $1", steps });
  home.publish({ id: "swap:quote-1", title: "Swap $5.00 of SOL for USDC", steps });
  const rows = () => startingTracks(store.list(), t);
  assert.deepEqual(rows().map((r) => r.id).sort(), ["swap:home-swap-a", "swap:home-swap-b"], "one row each; never Trade's");
  const going = rows().find((r) => r.id === "swap:home-swap-a")!;
  assert.deepEqual([going.kind, going.end, going.endsAt], ["swap", undefined, t + 9_000], "its time left");
  // ended: failed stays the hour, with its line alone; done holds, then folds
  home.end("swap:home-swap-a", "failed", INPLACE_WORDS.failed);
  home.end("swap:home-swap-b", "done");
  assert.equal(rows().find((r) => r.id === "swap:home-swap-a")!.end!.whole, true);
  assert.equal(rows().find((r) => r.id === "swap:home-swap-b")!.end!.ok, true);
  t += FOLD_AFTER_MS + FOLD_MS;
  assert.deepEqual(rows().map((r) => r.id), ["swap:home-swap-a"], "done, it folded");
  t += 60 * 60_000;
  assert.deepEqual(rows(), [], "the hour its neighbours get");
  // the screen: Home draws it, Activity's own page only while it goes, the centre never (its Now is the one row)
  const live = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8"), act = readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(live, /isHomeSwapRow\(s\.id\) && \(swaps === "all" \|\| \(swaps === "going" && !s\.end\)\)/);
  assert.match(live, /!folded\.has\(t\.id\)\), \.\.\.swapRows\.filter\(\(s\) => s\.end\?\.ok\)\];/);
  assert.match(act, /swaps=\{onDone \? "none" : "going"\}/);
});

test("real-tap proof, 6 Nov (4c): a reloaded job's end reads Hot and Activity again, once; no other row's end does", async () => {
  const { watchSwapEnds } = await import("./swap-ended.ts");
  const store = createTaskStore({ now: () => 1_000 });
  const home = store.forApp("wallet"), trade = store.forApp("trade");
  const steps = [{ label: INPLACE_WORDS.step, state: "doing" as const, at: 1 }];
  home.publish({ id: "swap:home-swap-r", title: "Swap $10.00 of USDC for ZEC", steps });
  home.publish({ id: "swap:quote-1", title: "Another", steps });
  trade.publish({ id: "swap:home-swap-t", title: "Trade's", steps });
  let reads = 0;
  const off = watchSwapEnds(store, () => { reads++; });
  // the real pick-up, as a load runs it, on the real store
  let status = "pending";
  const bridge = { call: async (m: string) => (m === "subwallet.float.moves" ? { ok: [{ id: "fm-home-swap-r", status }] } : { ok: { id: "fm-home-swap-r", status } }) } as unknown as Bridge;
  const up = resumeInplace({ bridge, tasks: home, pending: [swapRow("swap:home-swap-r", 500)], now: () => 1_000, sleep: async () => { status = "done"; } });
  home.publish({ id: "swap:home-swap-new", title: "Going", steps });
  assert.equal(reads, 0, "a row made, or going on, reads nothing");
  await up;
  assert.equal(store.list().find((t) => t.id === "swap:home-swap-r")!.state, "done");
  assert.equal(reads, 1, "its end reads once");
  home.end("swap:quote-1", "done");
  trade.end("swap:home-swap-t", "done");
  assert.equal(reads, 1, "controls: another row's end, Trade's");
  home.end("swap:home-swap-new", "failed", "x");
  assert.equal(reads, 2, "a live tap's end too");
  off();
  // both screens hear it
  assert.match(readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8"), /watchSwapEnds\(taskStore\(\), \(\) => readAgain\.current\(\)\)/);
  assert.match(readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8"), /watchSwapEnds\(taskStore\(\), read\)/);
});

test("real-tap proof, 6 Nov (4d): the running row opens that swap's own page, with its steps, from the core's record or its job alone", () => {
  assert.match(readFileSync(new URL("./InplaceSwap.tsx", import.meta.url), "utf8"), /open: \{ route: `activity:\$\{rowId\}` \}/);
  assert.match(readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8"), /t\?\.startsWith\("activity:"\)\) return \{ kind: "activity", open: t\.slice\("activity:"\.length\) \}/, "the route opens Activity on it");
  const act = readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(act, /swaps\.find\(\(x\) => x\.id === inplaceRowOf\(openId\)\)/);
  assert.equal(inplaceRowOf("swap:home-swap-ab"), "swap:fm-home-swap-ab");
  const [row] = inplaceRows([{ id: "fm-home-swap-ab", kind: "swap", status: "pending", usd: 10, sent: { tokenId: NEAR_CASH, amount: "10000000" }, expected: { tokenId: ZEC, amount: "1" }, startedAtIso: new Date(0).toISOString() }], () => ({ symbol: "ZEC", decimals: 8 }));
  assert.equal(row!.id, inplaceRowOf("swap:home-swap-ab"), "the job's row and the record's are the one swap");
  const page = inplacePage(row!);
  assert.deepEqual([page.stepsShown, page.steps[0]!.label, page.ended], [true, INPLACE_WORDS.step, null], "its one step is shown; no card while it runs");
  // not in the core's record yet: its job's own title and steps, never an empty page
  const job = inplaceJobDetail({ title: "Swap $10.00 of USDC for ZEC", state: "pending", usd: "$10.00", steps: [{ label: INPLACE_WORDS.step, state: "doing" }], startedAt: 0 });
  assert.deepEqual([job.title, job.usd, job.page.steps[0]!.label, job.page.steps[0]!.usd, job.page.ended, job.page.stepsShown], ["Swap $10.00 of USDC for ZEC", "$10.00", INPLACE_WORDS.step, "10.00", null, true]);
  assert.deepEqual(inplaceJobDetail({ title: "x", state: "failed", steps: [], startedAt: 0, detail: INPLACE_WORDS.nothing }).page.ended, { label: "Ended", line: INPLACE_WORDS.nothing });
  // the page draws one step only for these
  assert.match(readFileSync(new URL("../screens/ActivityDetail.tsx", import.meta.url), "utf8"), /\(page\.steps\.length > 1 \|\| \(page\.stepsShown && page\.steps\.length > 0\)\) &&/);
});

test("the copy review's words (6 Nov): the tap's screen, the failed and refunded sheets on the tracker and on Home's row, and a price that failed", async () => {
  const { rowTitle, startingTracks, endLine: line } = await import("./live-steps.ts");
  // the tap: "Job created." and two decimals, as Move's
  assert.equal(inplaceTitle(10, "USDC", "ZEC"), "Swap $10.00 of USDC for ZEC");
  const X = readFileSync(new URL("./InplaceSwap.tsx", import.meta.url), "utf8"), T = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(X, /bar: SWAP_WORDS\.title, made: true/);
  assert.match(T, /t\.made && !t\.end \? `\$\{JOB_WORDS\.created\} \$\{f\.what\}` : f\.what/);   // f.what: the title, a Send's figure said once (J2-4)
  assert.match(T, /<Sheet title=\{f\.bar\}/);
  // one end, said once: no status line ("Stopped") under its own title (the copy review's Part 2: the bar is the one title)
  assert.doesNotMatch(T, /lv-tracker__status/);
  const start = { id: "swap:home-swap-a", kind: "swap" as const, title: "Swap $10.00 of USDC for ZEC", wallets: ["near"], startMs: 0, steps: [], bar: "Swap", made: true as const };
  const sheet = async (m: object) => {
    let t = start as Parameters<typeof line>[0];
    const store = createTaskStore({ now: () => 5 });
    const tasks = store.forApp("wallet");
    tasks.publish({ id: start.id, title: start.title, steps: [{ label: INPLACE_WORDS.step, state: "doing" }] });
    await runInplaceJob({ bridge: { call: async () => ({ ok: m }) } as unknown as Bridge, tasks, rowId: start.id, route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "home-swap-a", tapMs: 0, onView: (v) => { t = inplaceTrack(t, v, 1); } });
    return { t, home: startingTracks(store.list(), 5)[0]! };
  };
  const failed = await sheet({ id: "fm-a", status: "failed" });
  for (const t of [failed.t, failed.home]) {
    assert.equal(rowTitle(t), "Swap didn't finish");
    assert.equal(line(t), "Your money is either in your NEAR wallet or still with NEAR Intents. Check your NEAR wallet first.");
    assert.deepEqual(t.steps.map((s) => [s.label, s.state]), [["NEAR Intents didn't finish it", "failed"]]);
    assert.doesNotMatch(JSON.stringify(t), /Stopped|stopped/);
    assert.equal(t.next, undefined, "no NEAR wallet page to open: Close only");
    assert.equal(t.bar, "Swap");
  }
  const back = await sheet({ id: "fm-a", status: "refunded" });
  for (const t of [back.t, back.home]) {
    assert.equal(line(t), "NEAR Intents couldn't swap it. Your money is back in your NEAR wallet.");
    assert.deepEqual(t.steps, [], "no step named just \"The swap\"");
    assert.deepEqual(t.next, [{ label: "Swap again", go: { kind: "swap" } }]);
  }
  // a no, 1Click's own no, one never in the record: their own line, no step, no next tap
  const no = await sheet({ id: "fm-a", status: "failed", reason: NOT_TAKEN_REASON });
  assert.deepEqual([rowTitle(no.t), line(no.t), no.t.steps, no.t.next], ["Swap didn't finish", NOT_TAKEN_REASON, [], undefined]);
  // the tracker's Swap again: the sheet again here, Home's row opens Swap on the NEAR wallet
  assert.match(readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8"), /<LiveTracker track=\{track\} onClose=\{\(\) => onDone\(""\)\} onNext=\{\(\) => setTrack\(null\)\} \/>/);
  assert.match(T, /go\.kind === "swap"\) shell\.openMoney\(\{ kind: "swap", wallet: "near" \}\)/);
  // J02: a price that failed signed nothing, so the money is where it was; the core's own words may say so already
  assert.equal(quoteFailed("NEAR Intents isn't answering, so ZeroFee stopped."), "NEAR Intents isn't answering, so ZeroFee stopped. Your money is still in your NEAR wallet.");
  assert.equal(quoteFailed("NEAR Intents gave no price for this coin. Nothing moved."), "NEAR Intents gave no price for this coin. Nothing moved.", "control");
  assert.match(X, /quoteFailed\(price\.late \? INPLACE_WORDS\.late : price\.said \?\? ""\)/);
  assert.match(X, /const q = price\.q;\n\s+if \(!q \|\| !units \|\| went\.current\) return;/, "no price, no tap");
  const core = readFileSync(new URL("../../../../core/src/float-moves.ts", import.meta.url), "utf8");
  const dry = core.slice(core.indexOf("async swapQuote("), core.indexOf("private async swapNow("));
  assert.ok(dry.length > 100);
  assert.doesNotMatch(dry, /signNep413|submitIntent|\.keep\(/, "a dry quote signs, sends and keeps nothing");
});

test("last copy notes (6 Nov): a refund's title says the money came back, every other end keeps its own; the step and the time under it both end in a stop", async () => {
  const { rowTitle, oneLine } = await import("./live-steps.ts");
  const { swapEndOf } = await import("../../near-swap-words.ts");
  const start = { id: "swap:home-swap-a", kind: "swap" as const, title: "Swap $10.00 of USDC for ZEC", wallets: ["near"], startMs: 0, steps: [], bar: "Swap" };
  assert.equal(swapEndOf(INPLACE_WORDS.refunded).head, "Your money came back");
  const titled = (line: string) => rowTitle({ ...start, end: { ok: false, ...swapEndOf(line) } });
  assert.equal(titled(INPLACE_WORDS.refunded), "Your money came back");
  for (const line of [INPLACE_WORDS.failed, NOT_TAKEN_REASON, INPLACE_WORDS.declined, INPLACE_WORDS.nothing, INPLACE_WORDS.unread]) assert.equal(titled(line), "Swap didn't finish", line);
  // Home's ended row, read from the store, and the sheet: the same title, and the bar stays "Swap"
  const { startingTracks } = await import("./live-steps.ts");
  const store = createTaskStore({ now: () => 5 });
  const tasks = store.forApp("wallet");
  tasks.publish({ id: start.id, title: start.title, steps: [{ label: INPLACE_WORDS.step, state: "doing" }] });
  let sheet = start as Parameters<typeof rowTitle>[0];
  await runInplaceJob({ bridge: { call: async () => ({ ok: { id: "fm-a", status: "refunded" } }) } as unknown as Bridge, tasks, rowId: start.id, route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "home-swap-a", tapMs: 0, onView: (v) => { sheet = inplaceTrack(sheet as never, v, 1) as never; } });
  const home = startingTracks(store.list(), 5)[0]!;
  for (const t of [sheet, home]) { assert.equal(rowTitle(t), "Your money came back"); assert.equal(t.bar, "Swap"); }
  // both sentences: the step on the row and the time under it
  assert.equal(INPLACE_WORDS.step, "NEAR Intents is swapping it.");
  assert.equal(INPLACE_WORDS.stepDone, "NEAR Intents swapped it.");
  assert.equal(inplacePage({ status: "moving", atIso: "x", usd: "1", ended: null } as never).steps[0]!.label, INPLACE_WORDS.step);
  assert.equal(inplacePage({ status: "done", atIso: "x", usd: "1", ended: null } as never).steps[0]!.label, INPLACE_WORDS.stepDone);
  // the tracker's one line joins them with a dot, so no stop before it
  assert.equal(oneLine("NEAR Intents is swapping it. · 8 s left"), "NEAR Intents is swapping it · 8 s left");
  assert.equal(oneLine("Done in 2 s"), "Done in 2 s", "control");
  // the page shows the time left alone under the money line (the copy review's Part 2); Home's row keeps oneLine
  assert.match(readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8"), /const left = f\.state === "going" \? rowParts\(t, now\)\.time : undefined;/);
  // a job kept by a build before the stop is still this job's: a reload finds it
  const ends: string[] = [];
  const kept = { update: () => true, end: (id: string) => (ends.push(id), true) } as never;
  const moved = { call: async (m: string) => (m === "subwallet.float.moves" ? { ok: [{ id: "fm-old", kind: "swap", status: "done" }] } : { ok: { id: "fm-old", status: "done" } }) } as unknown as Bridge;
  assert.equal(await resumeInplace({ bridge: moved, tasks: kept, pending: [{ id: "swap:old", steps: [{ label: "NEAR Intents is swapping it" }], startedAt: 0 }], now: () => 1_000, sleep: async () => undefined }), 1);
  assert.deepEqual(ends, ["swap:old"]);
  assert.equal(await resumeInplace({ bridge: moved, tasks: kept, pending: [{ id: "swap:trade", steps: [{ label: "Jupiter is swapping it" }], startedAt: 0 }], now: () => 1_000, sleep: async () => undefined }), 0, "control: Trade's isn't");
});

test("audit, 6 Nov: a problem from the swap call ends nothing until the core's record is read: its move there is followed, none there is the refusal's own words, a read that fails claims nothing", async () => {
  const REFUSAL = "Your NEAR wallet doesn't have that much cash.";
  const rowId = "swap:home-swap-a", id = moveIdOf(rowId);
  const run = async (moves: () => unknown, move?: unknown) => {
    const ends: [string, string | undefined][] = [], views: { state: string; checking?: string; before?: true; end?: { line: string } }[] = [], slept: number[] = [], details: (string | undefined)[] = [];
    const tasks = { update: (_: string, p: { detail?: string }) => (details.push(p.detail), true), end: (_: string, st: string, d?: string) => (ends.push([st, d]), true) } as never;
    const bridge = { call: async (m: string) => {
      if (m === "subwallet.float.swap") return { problem: { code: "x", whatHappened: REFUSAL } };
      if (m === "subwallet.float.moves") return moves();
      return { ok: move };
    } } as unknown as Bridge;
    const result = await runInplaceJob({ bridge, tasks, rowId, route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "home-swap-a", tapMs: 0, now: () => 1, sleep: async (ms) => void slept.push(ms), onView: (v) => void views.push(v as never) });
    return { result, ends, views, slept, details };
  };
  // the core's last keep after it handed the swap on threw: the move is there, still going, and is followed to its real end
  const going = await run(() => ({ ok: [{ id, kind: "swap", status: "pending" }] }), { id, status: "done" });
  assert.equal(going.result, "done", "never ended on the refusal while the swap may be running");
  assert.deepEqual(going.ends, [["done", undefined]]);
  assert.ok(!going.views.some((v) => v.state === "failed"));
  // the control: no such move, so nothing was signed (the core keeps it before it signs): the refusal's own words, at once
  const absent = await run(() => ({ ok: [{ id: "fm-another", kind: "swap", status: "pending" }] }));
  assert.equal(absent.result, "failed");
  assert.deepEqual(absent.ends, [["failed", REFUSAL]]);
  assert.equal(absent.views.at(-1)!.before, true);
  assert.deepEqual(absent.slept, [], "the core has answered: no wait for a tap on its way");
  // the core ended this very move and said why (float-moves.ts: nothing was signed): its words, never "either in your NEAR wallet"
  const refused = await run(() => ({ ok: [{ id, kind: "swap", status: "failed" }] }));
  assert.deepEqual(refused.ends, [["failed", REFUSAL]]);
  // 1Click's own no is in the record too: its clean line
  const notTaken = await run(() => ({ ok: [{ id, kind: "swap", status: "failed", reason: NOT_TAKEN_REASON }] }));
  assert.deepEqual(notTaken.ends, [["failed", NOT_TAKEN_REASON]]);
  // the record can't be read: never "nothing moved"; the row stays going with the lost answer's words, read again, however the read fails
  let tries = 0;
  const lost = await run(() => { tries++; if (tries === 1) throw new Error("gone"); return tries === 2 ? { problem: { code: "x" } } : { ok: [{ id, kind: "swap", status: "pending" }] }; }, { id, status: "done" });
  assert.equal(lost.result, "done");
  assert.deepEqual(lost.slept.slice(0, 2), [FOLLOW_CHECK_MS, FOLLOW_CHECK_MS]);
  assert.deepEqual(lost.views.filter((v) => v.checking), [{ state: "doing", checking: INPLACE_WORDS.lost }], "said once");
  assert.ok(lost.details.includes(INPLACE_WORDS.lost));
  // and read at last with no such move: the refusal's words only then
  tries = 0;
  const lostThenAbsent = await run(() => (++tries < 2 ? { problem: { code: "x" } } : { ok: [] }));
  assert.deepEqual(lostThenAbsent.ends, [["failed", REFUSAL]]);
});

test("copy review, 6 Nov: a true refund wears the neutral \"back\" face on its sheet and Home's row; FAILED, 1Click's no and a declined tap never do", async () => {
  const { endFace, trackMark, startingTracks } = await import("./live-steps.ts");
  const start = { id: "swap:home-swap-a", kind: "swap" as const, title: "Swap $10.00 of USDC for ZEC", wallets: ["near"], startMs: 0, steps: [], bar: "Swap" };
  const ended = async (m: object) => {
    const store = createTaskStore({ now: () => 5 });
    const tasks = store.forApp("wallet");
    tasks.publish({ id: start.id, title: start.title, steps: [{ label: INPLACE_WORDS.step, state: "doing" }] });
    let sheet = start as Parameters<typeof trackMark>[0];
    await runInplaceJob({ bridge: { call: async () => ({ ok: m }) } as unknown as Bridge, tasks, rowId: start.id, route: { kind: "inplace", source: "private", side: "buy", coin: ZEC }, units: "1", q: Q, key: "home-swap-a", tapMs: 0, onView: (v) => { sheet = inplaceTrack(sheet as never, v, 1) as never; } });
    return [sheet, startingTracks(store.list(), 5)[0]!];
  };
  // the sheet's job and Home's row read back from the store: both ways an end reaches a face
  for (const t of await ended({ id: "fm-a", status: "refunded" })) {
    assert.equal(endFace(t.end!), "back");
    assert.equal(trackMark(t), "back");
    assert.equal(t.end!.back, true, "the end itself says so, not a title's words");
  }
  for (const m of [{ status: "failed" }, { status: "failed", reason: NOT_TAKEN_REASON }, { status: "failed", reason: "declined" }]) {
    for (const t of await ended({ id: "fm-a", ...m })) {
      assert.equal(endFace(t.end!), "stopped", JSON.stringify(m));
      assert.equal(trackMark(t), "refused", JSON.stringify(m));
      assert.equal(t.end!.back, undefined, JSON.stringify(m));
    }
  }
  // the title's words alone give no face: "Your money came back" on an end not marked so stays stopped on the sheet
  assert.equal(trackMark({ ...start, end: { ok: false, line: "x", head: "Your money came back" } }), "refused");
  // the other marks are as they were
  assert.equal(trackMark(start), "away");
  assert.equal(trackMark({ ...start, end: { ok: true, line: "x" } }), "landed");
  // another job's refund words keep the row's face they had, and its sheet's mark
  assert.equal(endFace({ ok: false, line: "It came back. Your money is in your NEAR wallet." }), "back");
  assert.equal(trackMark({ ...start, kind: "add", end: { ok: false, line: "It came back. Your money is in your NEAR wallet." } }), "refused");
  // the screen uses them, and the mark draws it without red
  const T = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(T, /if \(t\.end\) return endFace\(t\.end\);/);
  // the page has no mark now (the copy review's Part 2: no mark-with-badge); a true refund's face is no --bad dot (job-face.ts)
  assert.match(readFileSync(new URL("./job-face.ts", import.meta.url), "utf8"), /bad: stopped && !t\.end\?\.back,/);
  const R = readFileSync(new URL("../../../../design/src/Receipt.tsx", import.meta.url), "utf8");
  assert.match(R, /state === "back" \? BACK : state === "refused" \? CROSS : TICK/);
  const css = readFileSync(new URL("../../../../design/src/receipt.css", import.meta.url), "utf8");
  const rule = /\.zf-receipt\[data-state="back"\] \.zf-receipt__badge \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /background: var\(--ink\); color: var\(--bg\);/);
  assert.doesNotMatch(rule, /--down/);
  assert.match(css, /\.zf-receipt--mark\[data-state="back"\] \.zf-receipt__badge/, "placed as the refused badge is");
});
