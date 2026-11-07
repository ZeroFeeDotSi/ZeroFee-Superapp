// the copy review's MUST (8 Nov): Activity's Money list showed Private's one way home as one "Moved out of Private" row per coin
// ($8.86 and $25.00). Now the coins' core moves fold under their job, as a Move's parts do: one row, "Moved $33.86 from
// Private to your Safe", its line "USDC $25.00 · NEAR $8.86 · in your Safe", each coin's figure on its page. The Sim's
// ledger on the test's own clock (simClock), and the real ledger's record (private-pay.ts fromPrivate); controls: a lone
// move out of Private with no job keeps its own row, and the record (the Statement) never folds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { fromPrivate as ledgerFromPrivate } from "../private-pay.ts";
import type { Movement, Token } from "../types.ts";
import { activityRows, carriedJob, homeRowOf } from "./activity-rows.ts";

const homeRows = (rows: readonly Movement[]) => rows.filter((m) => m.kind === "private" && m.from === "private");

test("Sim: the way home's two coins are ONE Activity row, \"Moved $33.86 from Private to your Safe\", each coin's figure kept [before: two rows]", async () => {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 50, timers: clock.timers, hiddenStart: { usdc: "25", near: "2" } }));
  const tk = await mock.call<Token[]>("ledger.tokens", {});
  assert.ok("ok" in tk);
  // the app's own key (useWallet's tokens: the coin's Intents id)
  const tokens = new Map(tk.ok.map((t) => [(t as unknown as { assetId: string }).assetId, t] as const));
  const r = await mock.call<Movement[]>("ledger.fromPrivate", {});
  assert.ok("ok" in r && r.ok.length === 2, JSON.stringify(r));
  // what Private.tsx carries the moment the core answers (its job, its figure)
  carryTo(r.ok.map((m) => `send:${m.id}`), { job: "job:sim-fold" });
  carryTo(["job:sim-fold"], { usd: "$33.86", parts: r.ok.map((m) => m.id) });
  await clock.quiet();
  await clock.advance(60);
  const led = await mock.call<Movement[]>("ledger.activity", { limit: 50 });
  assert.ok("ok" in led);
  const shown = homeRows(activityRows(led.ok, [], carriedJob).ledger);
  assert.equal(shown.length, 1, "fails before: one row per coin");
  const row = homeRowOf(shown[0]!, tokens);
  assert.equal(row?.title, "Moved $33.86 from Private to your Safe");
  assert.equal(row?.line, "USDC $25.00 · NEAR $8.86 · in your Safe");
  assert.deepEqual(row?.coins.map((c) => c.usd).sort(), ["$25.00", "$8.86"], "each coin's figure on its page");
  // control: the record (the Statement, AgentZero) keeps every core move its own row
  assert.equal(homeRows(activityRows(led.ok, []).ledger).length, 2);
});

test("real ledger: the record private-pay.ts writes (\"home:<id>\") folds the same way; a part still moving keeps the row going", async () => {
  const record: Movement[] = [];
  let n = 0;
  const USDC = "nep141:usdc.near";
  const out = await ledgerFromPrivate<{ id: string; status: string }>({}, "wallet", {
    rows: [{ tokenId: USDC, amount: "25" }, { tokenId: "near", amount: "2" }],
    home: async () => ({ ok: { id: `pm-${++n}`, status: "pending" } }),
    status: () => "moving",
    remember: async (m) => { record.unshift(m); },
    emit: () => {},
    iso: () => new Date().toISOString(),
  });
  assert.deepEqual(out.map((m) => m.id.startsWith("home:")), [true, true]);
  carryTo(out.map((m) => `send:${m.id}`), { job: "job:real-fold" });
  carryTo(["job:real-fold"], { usd: "$33.86", parts: out.map((m) => m.id) });
  const tokens = new Map<string, Token>([[USDC, { id: USDC, symbol: "USDC", priceUsd: "1", decimals: 6 } as Token], ["nep141:wrap.near", { id: "nep141:wrap.near", symbol: "NEAR", priceUsd: "4.43", decimals: 24 } as Token]]);
  record[0]!.status = "done"; // one coin landed, the other still on its way
  const shown = homeRows(activityRows(record, [], carriedJob).ledger);
  assert.equal(shown.length, 1, "fails before: two rows");
  assert.equal(shown[0]!.status, "moving", "the job's worst part");
  assert.equal(homeRowOf(shown[0]!, tokens)?.title, "Moving $33.86 from Private to your Safe");
  record[1]!.status = "done";
  const done = homeRowOf(homeRows(activityRows(record, [], carriedJob).ledger)[0]!, tokens);
  assert.equal(done?.line, "USDC $25.00 · NEAR $8.86 · in your Safe");
});

test("control: a lone move out of Private with no job (the sweep, an older build) keeps its own row and its own words", () => {
  const at = new Date().toISOString();
  const lone = { id: "home:lone", kind: "private", from: "private", to: "near", amount: "1", status: "done", startedAtIso: at, updatedAtIso: at, explorerUrls: [] } as unknown as Movement;
  const shown = homeRows(activityRows([lone], [], carriedJob).ledger);
  assert.equal(shown.length, 1);
  assert.equal(homeRowOf(shown[0]!, new Map()), null, "no job: describe()'s own row");
});
