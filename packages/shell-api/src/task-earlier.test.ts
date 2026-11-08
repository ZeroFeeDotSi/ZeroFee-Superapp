// R2 (4 Nov): the Activity centre never shows a finished Home move twice (a "Done" card under Earlier and its row in
// the Money list). Controls: with no history the card still shows; another app's finished card stays; a live Home task
// stays (it is Now, not Earlier).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { earlierOf } from "./task-earlier.ts";
import type { Task } from "./tasks.ts";

const t = (app: Task["app"], state: Task["state"], id = `${app}-${state}`) => ({ id, app, state, title: id, steps: [], startedAtIso: "2026-11-04T00:00:00Z" }) as unknown as Task;

test("while Home's history is drawn, Earlier leaves out Home's done, failed and stopped tasks", () => {
  const all = [t("home", "done"), t("home", "failed"), t("home", "stopped"), t("trade", "done"), t("home", "pending")];
  assert.deepEqual(earlierOf(all, true).map((x) => x.id), ["trade-done"]);
});

test("controls: no history, Home's done card still shows; a Trade done still shows; a Home pending is never Earlier", () => {
  assert.deepEqual(earlierOf([t("home", "done")], false).map((x) => x.id), ["home-done"], "no history");
  assert.deepEqual(earlierOf([t("trade", "done")], true).map((x) => x.id), ["trade-done"], "another app's");
  assert.deepEqual(earlierOf([t("home", "pending")], true), [], "a live one is Now");
  assert.deepEqual(earlierOf([t("home", "pending")], false), [], "a live one is Now, with no history too");
});

test("the centre uses it, with or without `only`", () => {
  const src = readFileSync(new URL("./TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(src, /const homeHistory = !!history && \(!only \|\| only === "home"\);\n  const earlier = newestFirst\(earlierOf\(all, homeHistory, new Set\(others\.map\(\(\[a\]\) => a\)\), appRecorded\(\)\)\);/, "changed pin (T11): the rows Trade's records stand for");
  assert.match(src, /\{homeHistory && <section className="tc-part tc-history" aria-label="History">/, "the history is drawn exactly when the rule hides Home's cards");
  assert.match(src, /const now = newestFirst\(all\.filter\(\(t\) => t\.state === "pending"\)\);/, "Now keeps every live task");
});

test("QA (4 Nov): a web wallet's Send is its own record, so its done card stays beside Home's history (control: Home's other done card is still left out)", () => {
  const all = [t("home", "done", "web-send:5Hq9xY"), t("home", "done", "send:mv1")];
  assert.deepEqual(earlierOf(all, true).map((x) => x.id), ["web-send:5Hq9xY"]);
  assert.deepEqual(earlierOf(all, false).map((x) => x.id), ["web-send:5Hq9xY", "send:mv1"], "control: no history, both");
});

test("Sim re-check (5 Nov): Trade's done Buy of a Safe coin is one row, its swap in Home's history (controls: no history, it shows; a failed one stays; Trade's other done card stays)", () => {
  const buy = t("trade", "done", "native-buy-nep141:btc.omft.near-1762300000000");
  const sell = t("trade", "done", "native-sell-nep141:btc.omft.near-1762300000001");
  const bad = t("trade", "failed", "native-buy-nep141:btc.omft.near-1762300000002");
  const meme = t("trade", "done", "buy-sol-abc");
  assert.deepEqual(earlierOf([buy, sell, bad, meme], true).map((x) => x.id), [bad.id, meme.id]);
  assert.deepEqual(earlierOf([buy, sell], false).map((x) => x.id), [buy.id, sell.id], "control: no history, both cards");
  const src = readFileSync(new URL("../../trade/src/native/NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(src, /taskId = ownRowJob\(`native-\$\{side\}-/, "the Trade side names its Safe swaps this way");
});

test("lap FAIL 4 (QA, 5 Nov: each trade listed twice, a task row under Earlier and a trade row under Trade): while Trade's own history is drawn, its done tasks leave Earlier (controls: Trade's history not drawn, they stay; a trade that didn't finish stays, it has no trade row)", () => {
  const all = [t("trade", "done", "buy-mogmas"), t("trade", "failed", "buy-failed"), t("agentzero", "done", "az-done")];
  assert.deepEqual(earlierOf(all, true, new Set(["trade"])).map((x) => x.id), ["buy-failed", "az-done"]);
  assert.deepEqual(earlierOf(all, true, new Set()).map((x) => x.id), ["buy-mogmas", "buy-failed", "az-done"], "control: Trade not drawn");
  assert.deepEqual(earlierOf([t("home", "done", "web-send:abc")], true, new Set(["trade"])).map((x) => x.id), ["web-send:abc"], "control: Home's own-record rule unchanged");
});
