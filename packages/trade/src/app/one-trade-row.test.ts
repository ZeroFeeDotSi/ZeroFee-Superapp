// the audit's Trade audit T11 (8 Nov): one trade was two rows in the Activity centre. Earlier kept every trade task that didn't
// finish ("it has no record there"), yet Trade's history drew that trade's record too: a reverted buy said "Buy $5 of
// DOPE · DOPE didn't buy…" under Earlier and "Didn't buy DOPE" under Trade; a trade not confirmed yet was in Now and
// "Buy not confirmed" under Trade. Now each record carries its row's id (T12), Trade's keeper tells the centre which
// rows it has records for (setAppRecorded), Earlier drops those while Trade's history is drawn, and Trade's part in the
// centre leaves out a trade whose row is still going (Now shows it). Fails on t12b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { earlierOf } from "@zerofee/shell-api/task-earlier.ts";
import { appRecorded, setAppRecorded } from "@zerofee/shell-api/history-slot.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { TradeRecord } from "../service.ts";
import { goingIds, keepTradeTasks } from "./trade-tasks.ts";

const t = (app: string, state: Task["state"], id: string) => ({ id, app, state, title: id, steps: [], startedAt: 1 }) as unknown as Task;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const seq = () => (globalThis as { __zfHistorySlot?: { seq: number } }).__zfHistorySlot?.seq ?? 0;
const tick = () => new Promise((r) => setTimeout(r, 0));

test("Earlier: a trade row that failed or stopped and has a record leaves while Trade's history is drawn; one with no record stays; Trade not drawn, both stay", () => {
  const all = [t("trade", "failed", "trade-rev"), t("trade", "stopped", "trade-closed"), t("trade", "done", "trade-ok"), t("agentzero", "failed", "az-bad")];
  const recorded = new Map([["trade", new Set(["trade-rev", "trade-ok"])]]);
  assert.deepEqual(earlierOf(all, true, new Set(["trade"]), recorded).map((x) => x.id), ["trade-closed", "az-bad"], "the reverted buy is one row, Trade's");
  assert.deepEqual(earlierOf(all, true, new Set(), recorded).map((x) => x.id), ["trade-rev", "trade-closed", "trade-ok", "az-bad"], "control: Trade's history not drawn");
  assert.deepEqual(earlierOf(all, true, new Set(["trade"])).map((x) => x.id), ["trade-rev", "trade-closed", "az-bad"], "control: no records told, as before (done ones only)");
});

test("the centre hands Earlier the recorded rows; an unchanged set never draws it again", () => {
  assert.match(read("../../../shell-api/src/TaskCentre.tsx"), /earlierOf\(all, homeHistory, new Set\(others\.map\(\(\[a\]\) => a\)\), appRecorded\(\)\)/);
  setAppRecorded("trade", new Set(["trade-a"]));
  const was = seq();
  setAppRecorded("trade", new Set(["trade-a"]));
  assert.equal(seq(), was, "same rows: no redraw");
  setAppRecorded("trade", new Set(["trade-a", "trade-b"]));
  assert.equal(seq(), was + 1);
  assert.deepEqual([...appRecorded().get("trade")!], ["trade-a", "trade-b"]);
});

test("Trade's keeper tells the centre which rows its records stand for, as the records change", async () => {
  const rec = (id: string, task?: string): TradeRecord => ({ id, kind: "buy", chain: "sol", symbol: "DOPE", status: "failed", amountUsd: 5, hashes: ["h"], startedAt: 0, ...(task ? { task } : {}) });
  let list = [rec("a", "trade-r1"), rec("b")];
  const fns = new Set<() => void>();
  const svc = { activity: async () => list, on: (f: () => void) => { fns.add(f); return () => fns.delete(f); } };
  const stop = keepTradeTasks(svc, taskStore().forApp("trade"), { now: () => 10 });
  await tick();
  assert.deepEqual([...appRecorded().get("trade")!], ["trade-r1"], "a record with no row adds none");
  list = [...list, rec("c", "trade-r2")];
  for (const f of [...fns]) f();
  await tick();
  assert.deepEqual([...appRecorded().get("trade")!].sort(), ["trade-r1", "trade-r2"]);
  stop();
});

test("Trade's part in the centre leaves out a trade whose row is still going (Now shows it), and never says Nothing yet under it", () => {
  assert.equal(goingIds([t("trade", "pending", "trade-1"), t("trade", "failed", "trade-2"), t("home", "pending", "send:x")] as never), "trade-1");
  const src = read("./screens/Activity.tsx");
  assert.match(src, /const listed = tradesOnly \? rows\.value\.filter\(\(r\) => !\(r\.task && going\.has\(r\.task\)\)\) : rows\.value;/);
  assert.match(src, /\[\.\.\.listed\.map\(\(r\) => tradeCard\(r\)\)/);
  assert.match(src, /if \(cards\.length === 0\) return <>\{listed\.length < rows\.value\.length \? null : <p className="zf-small tr-none">Nothing yet\. Your trades will show here\.<\/p>\}<EarlierHistory bridge=\{bridge\} \/><\/>;/);
});
