// Builder 22's item 6 (8 Nov): a Trenches trade's time left was one fixed guess (the sheet's SALE_SEC, 2 s on every
// chain) or none (a row's Buy chip: "No time estimate"). Now it is this device's measured pace on the trade's chain: the
// median tap-to-landed time of its last landed trades there, the chain's speed bar before any (trade-pace.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAR_MS, PACE_RUNS, tradeEndsAt, tradePaceMs } from "./trade-pace.ts";
import { timeLeft } from "@zerofee/shell-api/job-steps.ts";
import type { TradeRecord } from "../service.ts";

const rec = (chain: TradeRecord["chain"], ms: number, o: Partial<TradeRecord> = {}): TradeRecord =>
  ({ id: `${chain}-${ms}`, kind: "buy", chain, symbol: "X", status: "done", startedAt: 0, filledInMs: ms, timing: { tapAt: 1_000, landedAt: 1_000 + ms }, ...o }) as TradeRecord;

test("hood-pace-b22: a Robinhood trade's time left is the median of its own last landed trades, not a fixed 2 s", () => {
  const all = [rec("hood", 4_200), rec("sol", 300), rec("hood", 3_800), rec("hood", 5_100), rec("hood", 900, { status: "failed" })];
  assert.equal(tradePaceMs(all, "hood"), 4_200);
  assert.equal(timeLeft(1_000 + tradePaceMs(all, "hood"), 1_000), "5 s left");
  assert.equal(tradePaceMs(all, "sol"), 300, "Solana's own, as before for its chain");
  // the last PACE_RUNS only, newest first (as Trade keeps them)
  const many = [...Array.from({ length: PACE_RUNS }, () => rec("hood", 1_500)), rec("hood", 9_000), rec("hood", 9_000)];
  assert.equal(tradePaceMs(many, "hood"), 1_500);
});

test("hood-pace-b22: before any landed trade, the chain's speed bar (Solana 1 s, Robinhood Chain 2 s)", () => {
  assert.equal(tradePaceMs([], "hood"), BAR_MS.hood);
  assert.equal(tradePaceMs([], "sol"), BAR_MS.sol);
  assert.equal(BAR_MS.sol, 1_000);
  assert.equal(BAR_MS.hood, 2_000);
});

test("hood-pace-b22: tradeEndsAt reads the service's records and follows each change", async () => {
  let records = [rec("hood", 6_000)];
  const fns = new Set<() => void>();
  const svc = { activity: async () => records, on: (f: () => void) => (fns.add(f), () => fns.delete(f)) };
  assert.equal(tradeEndsAt(svc as never, "hood", 0), BAR_MS.hood, "the first tap, before the read answers: the bar");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tradeEndsAt(svc as never, "hood", 0), 6_000);
  records = [rec("hood", 2_500), ...records];
  for (const f of fns) f();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tradeEndsAt(svc as never, "hood", 0), 4_250);
});

test("hood-pace-b22: the Trenches row's Buy and the sheet publish the chain's pace from the first frame", () => {
  const discover = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
  assert.match(discover, /tasks\?\.publish\(\{ id: taskId, title: `Buy \$\$\{quick\} of \$\{r\.symbol\}`, open: \{ route \}, endsAt: tradeEndsAt\(svc, r\.chain, taskAt\),/);
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /endsAt: tradeEndsAt\(svc, coin\.chain, taskAt\),/);
  assert.doesNotMatch(sheet, /endsAt: saleEndsAt\(taskAt\)/, "no one fixed guess for every chain");
});
