// browser-sites crawl F1 (MUST, QA, 5 Nov) and F2/F8: a site wallet's Take out finishes from its saved record
// after a reload, on any app, with no tap; the Browser's old rows open Home and end; the site page follows it to its end.
// Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SITE_MONEY_MOVED, endOldSiteMoneyRows, siteMoneyRow } from "@zerofee/shell-api/site-money-rows.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import { resumeTakeOuts, stillOpen } from "./take-out-resume.ts";

const memory = (from?: Map<string, string>) => {
  const data = new Map(from);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a Take out reloaded mid-way goes home by itself from its saved record, once (F1); control: before the reload nothing read it, so nothing went", async () => {
  const storage = memory();
  const opts = { latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 100 } } as const;
  const first = createMockBridge({ ...opts, persist: { storage } } as never);
  const call = async <T,>(b: typeof first, m: string, p: Record<string, unknown> = {}) => { const r = await b.call<T>(m, p); if (!("ok" in r)) throw new Error(`${m}: ${JSON.stringify(r.problem)}`); return r.ok; };
  const site = await call<{ id: string }>(first, "subwallet.create", { kind: "site", chain: "sol", siteId: "pump" });
  // its SOL: a move out of Spending into it, landed
  await call(first, "subwallet.float.out", { chain: "sol", to: site.id, amount: "100000000", key: "fund-the-site-wallet1" });
  await wait(40);
  await call(first, "subwallet.float.moves");
  await call(first, "subwallet.site.moveBack", { id: site.id, amount: "all", key: "reload-takeout-key-01" });
  await wait(40); // leg 1 lands while the page is gone; nothing read the moves back yet
  first.flush();
  const homes = (moves: { kind: string }[]) => moves.filter((m) => m.kind === "home").length;
  assert.equal(homes(await call(first, "subwallet.float.moves")), 0, "control: no leg 2 yet (nothing read the Take out)");
  // the reload: a new page on the same saved state, and the shell's resumer (no Take out page, no tap)
  const again = createMockBridge({ ...opts, persist: { storage: memory(storage.data) } } as never);
  const stop = resumeTakeOuts(again as never, 20);
  await wait(60);
  stop();
  assert.equal(homes(await call(again, "subwallet.float.moves")), 1, "leg 2 went by itself");
  const [b] = await call<any[]>(again, "subwallet.site.moveBacks");
  assert.ok(b.home, "the Take out's record names its leg home");
  // and never twice: another page's resumer on the same record
  const third = resumeTakeOuts(again as never, 20);
  await wait(60);
  third();
  assert.equal(homes(await call(again, "subwallet.float.moves")), 1, "once");
});

test("stillOpen: going, or landed with its leg home not ended; a refused leg home waits for the quiet read (control: ended ones aren't open)", () => {
  assert.equal(stillOpen({ back: { status: "pending" } }), true);
  assert.equal(stillOpen({ back: { status: "done" } }), true);
  assert.equal(stillOpen({ back: { status: "done" }, home: { status: "pending" } }), true);
  assert.equal(stillOpen({ back: { status: "done", homeStopped: "No." } }), false);
  assert.equal(stillOpen({ back: { status: "done" }, home: { status: "done" } }), false);
  assert.equal(stillOpen({ back: { status: "failed" } }), false);
});

test("the Browser's old site-money rows open Home's Activity and end saying where the move is (F2); control: a sign-in row is untouched", () => {
  const row = (id: string, app: Task["app"] = "browser"): Task => ({ id, app, title: "x", steps: [], state: "pending", startedAt: 1 });
  assert.equal(siteMoneyRow(row("back-pump-fun-1")), true);
  assert.equal(siteMoneyRow(row("add-pump-fun-1")), true);
  assert.equal(siteMoneyRow(row("signin-pump-fun-1")), false);
  assert.equal(siteMoneyRow(row("back-x", "home")), false);
  const ended: [string, string, string?][] = [];
  const n = endOldSiteMoneyRows([row("back-pump-fun-1"), row("signin-pump-fun-1"), { ...row("add-pump-fun-2"), state: "done" }], { end: (id, s, d) => (ended.push([id, s, d]), true) });
  assert.equal(n, 1);
  assert.deepEqual(ended, [["back-pump-fun-1", "stopped", SITE_MONEY_MOVED]]);
  const centre = readFileSync(new URL("../../../shell-api/src/TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(centre, /if \(siteMoneyRow\(t\)\) return shell\.openApp\(TASK_APP_HOME\.home\.app as AppId, "activity"\)/);
});

test("the shell starts the resumer once the account is home, on any app (F1); the site page reads an open Take out again until it ends (F8)", () => {
  const app = readFileSync(new URL("../../../../apps/web/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /take-out-resume\.ts"\)\.then\(\(m\) => \{ if \(!gone\) stopBacks = m\.resumeTakeOuts\(appBridge\("social"\)\)/);
  const page = readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!active \|\| !backOpen\) return;\n\s+const t = setTimeout\(refresh, BACK_READ_MS\)/);
});
