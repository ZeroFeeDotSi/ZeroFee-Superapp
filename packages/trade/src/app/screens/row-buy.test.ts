// The quiet Buy chip (Build A): the row's words per phase, the service's answer mapped to the Receipt's states, and the
// money rules pinned in the source (the sheet's service with origin chip:<address>; the ready check; never a silent fail;
// never a button inside the row's button; 44 pt; lit only under the finger).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowBuyEnd, rowBuyLine } from "./row-buy.ts";
import { QUICK_BUY_DEFAULT } from "./quick-buy.ts";

const src = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../discover.css", import.meta.url), "utf8");

test("the row's line per phase: on its way with the coins, bought with its time, still checking, didn't buy with the why", () => {
  assert.equal(rowBuyLine({ phase: "away", at: 0 }, "DOPE"), "On its way");
  assert.equal(rowBuyLine({ phase: "away", at: 0, got: "7,505 DOPE" }, "DOPE"), "On its way · about 7,505 DOPE");
  assert.equal(rowBuyLine({ phase: "landed", at: 0, got: "7,505 DOPE", ms: 1050 }, "DOPE"), "Bought · 7,505 DOPE");
  assert.equal(rowBuyLine({ phase: "checking", at: 0 }, "DOPE"), "Not confirmed yet", "the copy review's row word (7 Nov)");
  assert.equal(rowBuyLine({ phase: "refused", at: 0, why: "You said no. Nothing moved." }, "DOPE"), "Didn't buy · You said no. Nothing moved.");
  assert.doesNotMatch(rowBuyLine({ phase: "landed", at: 0, got: "7,505 DOPE", ms: 1050 }, "DOPE"), /about/, "control: a landed line never says about");
});

test("the service's answer: done = landed; unconfirmed = checking (never refused); declined/failed/expired = refused, fee words by whether a hash landed", () => {
  assert.deepEqual(rowBuyEnd({ status: "done", hashes: ["h"] }), { phase: "landed" });
  assert.deepEqual(rowBuyEnd({ status: "unconfirmed", hashes: ["h"] }), { phase: "checking" });
  assert.deepEqual(rowBuyEnd({ status: "declined", hashes: [] }), { phase: "refused", why: "You said no. Nothing moved." });
  assert.deepEqual(rowBuyEnd({ status: "failed", hashes: ["h"] }), { phase: "refused", why: "Only the network fee left your wallet." });
  assert.deepEqual(rowBuyEnd({ status: "expired", hashes: [] }), { phase: "refused", why: "Nothing left your wallet." });
  assert.deepEqual(rowBuyEnd({ status: "failed", hashes: [], problem: { whatHappened: "The core said no." } as never }), { phase: "refused", why: "The core said no." }, "the core's own words first");
});

test("money rules in the source: the sheet's service with origin chip:<address>, the preset, the ready check before any ask, the core's refusal said on the row", () => {
  assert.match(src, /svc\.trade\(p, `chip:\$\{r\.address\}`, \{ task: taskId, tapAt: epochOf\(at\) \}\)/, "changed pin (T12, then 83\'s T4): with its task and its press");
  assert.match(src, /svc\.quote\("buy", r\.chain, r\.address, \{ usd \}\)/);
  assert.equal(QUICK_BUY_DEFAULT, 25);
  assert.match(src, /if \(ready !== undefined && ready < quick\) \{[\s\S]*?onState\(\{ phase: "refused", at, why: `Only \$/);
  assert.match(src, /const why = e instanceof ProblemError \? e\.problem\.whatHappened : "It didn't go through\. Nothing moved\.";/);
  assert.match(src, /if \(busy\.current \|\| quick === undefined\) return;/, "a second tap while one is on its way does nothing (and the lock's origin makes it one trade anyway)");
});

test("the chip is a sibling of the row (never a button inside the row's button), gone while the row is the receipt; 44 pt to hit; lit only under the finger", () => {
  assert.match(src, /\{noSale \? <span className="dc-nfs" data-testid="row-not-for-sale">\{NOT_FOR_SALE\}<\/span> : !buy && !down && <RowBuy r=\{r\} onState=\{setBuy\} follow=\{follow\} \/>\}\n    <\/div>/);
  assert.doesNotMatch(src, /<button[^>]*className="dc-row[\s\S]*?<button[^>]*dc-qb[\s\S]*?<\/button>\s*<\/button>/, "control: no nested button");
  assert.match(css, /\.dc-qb \{[^}]*height: 44px/);
  assert.match(css, /\.dc-qb__pill \{[^}]*background: var\(--fill\)/);
  assert.match(css, /\.dc-qb:active \.dc-qb__pill \{ background: var\(--lit, var\(--mint\)\)/);
  assert.doesNotMatch(css, /^\.dc-qb__pill \{[^}]*var\(--lit/m, "control: not lit at rest");
});

test("QA's MUST: an unconfirmed trade is never shown as failed, never invites a second buy; the task stays open and the record is followed to its end", () => {
  // the checking branch: the task is updated (Sent done, Landed doing), never ended; no failed buzz; the row stays the receipt
  const checking = src.slice(src.indexOf("// unconfirmed (QA's MUST)"), src.indexOf("    try {", src.indexOf("// unconfirmed (QA's MUST)")));
  assert.match(checking, /tasks\?\.update\(taskId, \{ detail: "Not confirmed yet", steps: \[\{ label: "Sent", state: "done", at: taskAt \}, \{ label: "Landed", state: "doing" \}/);
  assert.doesNotMatch(checking, /tasks\?\.end\(/, "the task is not ended while the trade may still land");
  assert.doesNotMatch(checking, /feel\.failed\(\)/, "no failed buzz");
  assert.match(checking, /onState\(\{ phase: "checking", at, got \}\)/);
  // 7 Nov (live re-check): followed by followRecord (unconfirmed-follow.ts: on the service's own events, its end once,
  // unconfirmed-follow.test.ts), the Row's stop kept in follow.current
  assert.match(checking, /follow\.current = followRecord\(svc, rec\.id, \(now\) => \{/, "the record is followed on the service's own events");
  assert.match(checking, /if \(e2\.phase === "landed"\) landed\(now\); else if \(e2\.phase === "refused"\) refused\(now, e2\.why\);/, "it ends only as the chain's answer says");
  // 7 Nov: the trade the service throws as its unconfirmed Problem (run()) is this same checking row, never "Didn't buy"
  assert.match(src, /e\.problem\.code === UNCONFIRMED \? await recordOf\(svc, e\.problem\) : undefined;\n\s*if \(rec\) \{ stillChecking\(rec\); return; \}/);
  // and while the row says so with Trade on screen, the service looks at it again (watch)
  assert.match(src, /useEffect\(\(\) => \(checking && active \? svc\.watch\(\) : undefined\), \[checking, active, svc\]\);/);
  assert.match(src, /useEffect\(\(\) => \(\) => \{ follow\.current\?\.\(\); follow\.current = null; \}, \[\]\);/, "the Row's cleanup");
  // the row: checking is never cleared by the timer, so the chip (rendered only while !buy) cannot come back
  assert.match(src, /if \(!buy \|\| buy\.phase === "away" \|\| buy\.phase === "checking"\) return;/);
  assert.match(src, /: !buy && !down && <RowBuy r=\{r\} onState=\{setBuy\} follow=\{follow\} \/>\}/, "control: the chip is drawn only while the row holds no trade");
  // control: landed and refused still end as before
  assert.match(src, /if \(end\.phase === "landed"\) \{ landed\(rec\); return; \}/);
  assert.match(src, /if \(end\.phase === "refused"\) \{ refused\(rec, end\.why\); return; \}/);
});

test("QA's Sim crawl (5 Nov, 110, 195): a chip's buy that landed ends its job done, so it leaves Now and the badge (control: steps ticked alone left it pending)", async () => {
  const { createTaskStore } = await import("@zerofee/shell-api/tasks.ts");
  const { rowBuyLanded } = await import("./row-buy.ts");
  const kv = new Map<string, string>();
  const store = createTaskStore({ kv: { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) } as Storage });
  const tasks = store.forApp("trade");
  const steps = [{ label: "Sent", state: "doing" as const, at: 1 }, { label: "Landed", state: "waiting" as const }, { label: "In your SOL wallet", state: "waiting" as const }];
  tasks.publish({ id: "trade-1", title: "Buy $25 of AMD", steps });
  tasks.publish({ id: "trade-2", title: "Buy $25 of CASHCAT", steps });
  assert.equal(store.pending(), 2);
  rowBuyLanded(tasks, "trade-1", { taskAt: 1, now: 2, wallet: "In your SOL wallet", detail: "Landed in 0.62 s", proof: [{ chain: "sol", hash: "h" }] });
  assert.equal(store.pending(), 1, "the landed one left Now; the badge counts one");
  const t = store.list().find((x) => x.id === "trade-1")!;
  assert.equal(t.state, "done");
  assert.deepEqual(t.steps.map((s) => s.state), ["done", "done", "done"]);
  assert.equal(t.detail, "Landed in 0.62 s");
  // control: the old landing (update only) kept it pending for good
  tasks.update("trade-2", { steps: steps.map((s) => ({ ...s, state: "done" as const })) });
  assert.equal(store.list().find((x) => x.id === "trade-2")!.state, "pending", "control: steps alone never end it");
  assert.match(src, /rowBuyLanded\(tasks, taskId, \{ taskAt, now, wallet:/);
});
