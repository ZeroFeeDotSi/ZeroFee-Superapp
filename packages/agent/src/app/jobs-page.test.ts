// Jobs and limits (QA, 5 Nov: Sim, real test): the memory list drawn over Receipts and
// under the Turn on button; $50 shown at once while the sheet said 3 days; the copy job's sheet at $20 under $50 pocket
// money; no ✓ on Ask me first; Receipts "Nothing yet" beside nine paid replies in Activity; no way to Activity. Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import { defaultTerms, startSheet, type JobTerms } from "../zero/jobs.ts";
import { makeReceipt } from "../zero/receipts.ts";
import { pageRows, raiseShown, readRaise, replyRows } from "./page-rows.ts";

const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./agent.css", import.meta.url), "utf8");

test("the memory list is inside the page, before its floor, and the page never shrinks under its rows (control: the ask part has no memory list)", () => {
  assert.match(css, /\.ag \{[^}]*min-height: 100%;[^}]*flex-shrink: 0;/, "a pushed page's column can't squeeze it");
  assert.match(app, /<AgentZeroScreens bridge=\{bridge\} part="settings" below=\{<MemoryList bridge=\{bridge\} \/>\} \/>/);
  assert.doesNotMatch(app, /<MemoryList bridge=\{bridge\} \/>\n\s*<\/>/, "never a sibling after the page");
  const at = (s: string) => app.indexOf(s);
  assert.ok(at("{below}") > at('<div className="zf-label ag-section">Receipts</div>') && at("{below}") < at('<div className="ag-floor">'), "after Receipts, before the Turn on button");
  assert.match(app, /return <AgentZeroScreens bridge=\{bridge\} part="ask" \{\.\.\.\(onClose \? \{ onClose \} : \{\}\)\} \/>;/, "control: no memory list on the ask part");
});

test("a job's sheet opens at $20 or the pocket money if less, never the whole pocket money (QA: a default is never the ceiling); its sheet says its own day", () => {
  const leader = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const at50 = { ...(defaultTerms("copy", 50) as Extract<JobTerms, { kind: "copy" }>), leader };
  assert.deepEqual([at50.perDayUsd, at50.perTradeUsd], [20, 5], "pocket $50: opens at $20");
  assert.ok(startSheet(at50, { agentOn: true, pocketUsd: 50, sample: true }).lines.includes("It spends at most $20.00 in any 24 hours."));
  const at8 = { ...(defaultTerms("copy", 8) as Extract<JobTerms, { kind: "copy" }>), leader };
  assert.deepEqual([at8.perDayUsd, at8.perTradeUsd], [8, 5], "control: pocket $8: opens at $8, never over it");
  const lines = startSheet(at8, { agentOn: true, pocketUsd: 8, sample: true }).lines;
  assert.ok(lines.includes("It spends at most $8.00 in any 24 hours.") && !lines.some((l) => l.includes("$20.00")), lines.join(" | "));
  assert.equal((defaultTerms("pay-list", 8) as Extract<JobTerms, { kind: "pay-list" }>).perDayUsd, 8);
  assert.equal((defaultTerms("pay-list", 50) as Extract<JobTerms, { kind: "pay-list" }>).perDayUsd, 20);
  assert.equal((defaultTerms("copy") as Extract<JobTerms, { kind: "copy" }>).perDayUsd, 20, "control: nothing given, $20");
  assert.equal((defaultTerms("copy", 3) as Extract<JobTerms, { kind: "copy" }>).perTradeUsd, 3, "a trade never over the day");
  assert.equal((app.match(/defaultTerms\([^)]*on \? pocketUsd : choice\)/g) ?? []).length, 3, "every sheet the page opens");
});

test("Sim: a higher pocket money waits the safety wait, the one in force stays; a lower one works at once (control); after the wait it holds", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const set = (usd: number, method = "account.agent.setBudget") => mock.call<{ status: string; id?: string; readyAtIso?: string }>(method, { limitUsd: usd, people: [] });
  const view = async () => ((await mock.call<{ limitUsd: number }>("account.agent.view")) as { ok: { limitUsd: number } }).ok.limitUsd;
  assert.equal(((await set(20, "account.agent.set")) as { ok: { status: string } }).ok.status, "done", "turning on: as before");
  const up = (await set(50)) as { ok: { status: string; id: string; readyAtIso: string } };
  assert.equal(up.ok.status, "waiting");
  assert.ok(Date.parse(up.ok.readyAtIso) - Date.now() >= 2 * 86_400_000, "the account's wait (2 days and a day more)");
  assert.equal(await view(), 20, "$20 holds until then");
  assert.equal(((await set(5)) as { ok: { status: string } }).ok.status, "done", "control: lower, at once");
  assert.equal(await view(), 5);
  assert.ok("problem" in (await mock.call("account.waiting.run", { id: up.ok.id })), "control: not before its wait");
  // a wait that is over (the tests' short wait): finishing it runs the held change
  const quick = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0 } });
  await quick.call("account.agent.set", { limitUsd: 20, people: [] });
  const held = (await quick.call<{ status: string; id: string }>("account.agent.setBudget", { limitUsd: 50, people: [] })) as { ok: { status: string; id: string } };
  assert.equal(held.ok.status, "waiting");
  const run = await quick.call("account.waiting.run", { id: held.ok.id });
  assert.ok("ok" in run, JSON.stringify(run));
  assert.equal(((await quick.call<{ limitUsd: number }>("account.agent.view")) as { ok: { limitUsd: number } }).ok.limitUsd, 50, "after the wait, $50");
});

test("Pocket money's row while a raise waits: both figures, never the new one alone (controls: none waiting, or reached, or off: as before)", () => {
  const r = readRaise(JSON.stringify({ usd: 50, atIso: "2026-11-08T12:00:00.000Z" }));
  assert.deepEqual(r, { usd: 50, atIso: "2026-11-08T12:00:00.000Z" });
  assert.deepEqual(raiseShown(r, true, 20), r);
  assert.equal(raiseShown(r, true, 50), null, "control: the account has it now");
  assert.equal(raiseShown(r, false, 0), null, "control: AgentZero off");
  assert.equal(readRaise("{bad"), null);
  assert.equal(readRaise(JSON.stringify({ usd: -1, atIso: "x" })), null);
  assert.match(app, /if \(on\) setRaise\(\{ usd, atIso: r\.ok\.readyAtIso \}\);\s*else setStartsAt\(r\.ok\.readyAtIso\);/, "on: the raise waits, the limit stays; off: AgentZero starts then");
  assert.match(app, /on && raiseShown\(raise, on, pocketUsd\) \? `Goes up to \$\{dollars\(raise!\.usd\)\} on /);
  assert.match(app, /\{walletRow\(on \? Math\.max\(0, Math\.round\(\(pocketUsd - Math\.max\(today, agent\.spentUsd\)\) \* 100\) \/ 100\) : 0\)\}/, "the title: what AgentZero's wallet holds, never a daily price (product decision, 5 Nov)");
});

test("Sim: Ask me first is read and kept, so its ✓ shows (Never by default, as the core); asking less often asks first (control: asking more often, at once)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  let sheets = 0;
  mock.on("approval.needed", (e: { id: string }) => { sheets++; void mock.call("approval.answer", { id: e.id, approve: true }); });
  const read = async () => ((await mock.call<{ askAboveUsd: number | null }>("account.agent.askAbove", {})) as { ok: { askAboveUsd: number | null } }).ok.askAboveUsd;
  assert.equal(await read(), null, "never, as the core starts");
  assert.deepEqual((await mock.call("account.agent.askAbove", { set: true, usd: 5 })) as unknown, { ok: { askAboveUsd: 5 } });
  assert.equal(sheets, 0, "control: asking more often, no sheet");
  assert.equal(await read(), 5);
  assert.deepEqual((await mock.call("account.agent.askAbove", { set: true, usd: 20 })) as unknown, { ok: { askAboveUsd: 20 } });
  assert.equal(sheets, 1, "asking less often: the person's Approve");
  assert.ok("problem" in (await mock.call("account.agent.askAbove", { set: true, usd: -3 })));
  assert.match(app, /aria-checked=\{askAbove === c\}[\s\S]{0,200}\{askAbove === c \? "✓" : ""\}/);
});

test("Receipts lists AgentZero's paid replies from Activity's own tasks, newest first with the engine's; a tap and \"See all in Activity\" open Activity (controls: other apps' and unfinished tasks left out)", () => {
  const task = (id: string, at: number, extra: Partial<Task> = {}): Task => ({ id, app: "agentzero", title: "AgentZero paid ZeroFee 0.4¢ for a reply", steps: [], state: "done", startedAt: at, endedAt: at, usd: "$0.004", ...extra });
  const rows = replyRows([task("agentzero:reply:a", 1000), task("agentzero:reply:b", 3000), task("agentzero:job:x", 4000), task("other", 5000, { app: "home" }), task("agentzero:reply:c", 6000, { state: "pending" })]);
  assert.deepEqual(rows.map((r) => r.id), ["agentzero:reply:b", "agentzero:reply:a"]);
  const rec = makeReceipt({ kind: "note", jobId: "j", line: "Job on: Copy a wallet." }, 2000, []);
  assert.deepEqual(pageRows([rec], rows).map((x) => x.kind), ["reply", "receipt", "reply"], "by time");
  assert.equal(pageRows([], Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, title: "t", atMs: i }))).length, 12, "12 at most");
  assert.match(app, /receipts\.length === 0 && replies\.length === 0 && <div className="ag-row"><span className="d">Nothing yet\./, "\"Nothing yet\" only when both are empty");
  assert.match(app, /onClick=\{\(\) => shell\.tasks\?\.open\(\{ app: "agentzero" \}\)\}>See all in Activity<\/button>/);
  assert.match(app, /useEffect\(\(\) => taskStore\(\)\.subscribe\(\(\) => setReplies\(replyRows\(taskStore\(\)\.list\(\)\)\)\), \[\]\);/, "kept in step with Activity");
});

test("UX hunt G9: a pay list whose person still waits reads Waiting, never On; control: on the account, or the Sim's sample, it reads On", async () => {
  const { listWaiting, jobLine } = await import("../zero/jobs.ts");
  const job = { id: "j", kind: "pay-list", people: ["coffee.near"], perDayUsd: 20, startedAtIso: "2026-11-05T00:00:00.000Z", on: true } as const;
  assert.equal(listWaiting(job, []), true);
  assert.equal(listWaiting(job, ["coffee.near"]), false);
  assert.equal(listWaiting(job, null), false, "the Sim's sample money has no wait");
  assert.equal(listWaiting({ ...job, on: false }, []), false);
  assert.equal(jobLine("pay-list", job, 20, true), "Waiting · 1 person · only people you pick");
  assert.equal(jobLine("pay-list", job, 20, false), "1 person · only people you pick");
  const src = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
  assert.match(src, /waiting \? "Waiting ›" : "On ›"/);
});

test("UX hunt G9: the first run's Fund button sticks above the tab bar, never below the fold on 390×844", () => {
  const css = readFileSync(new URL("./agent.css", import.meta.url), "utf8");
  assert.match(css, /\.ag-floor:has\(> \.zf-btn\) \{ position: sticky; bottom: 0;[^}]*linear-gradient\(to bottom, transparent, var\(--bg\)/, "with a soft top fade, no hard edge");
  assert.match(css, /\.ag-sheet-floor:has\(> \.zf-btn\) \{ position: sticky; bottom: 0;/, "and the funding sheet's Add button");
});
