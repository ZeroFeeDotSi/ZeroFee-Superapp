// AgentZero's Jobs (product decision, 3 Nov) and its email row: the lists come only from the core's own records, a failed read
// is said, the live card finds the move a sheet started, and the email sheet tells mail's real state. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement } from "@zerofee/wallet/types.ts";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Job } from "@zerofee/agent/zero/jobs";
import type { Routine } from "@zerofee/agent/zero/routines";
import type { Receipt } from "@zerofee/agent/zero/receipts";
import { agoWords, jobsOf, MAIL_WORDS, mailLines, startedSince, type JobsRead } from "./jobs.ts";
import { MAIL_SEND_LIVE } from "./inbox-gate.ts";

const NOW = Date.parse("2026-11-03T08:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const mv = (o: Partial<Movement> & Pick<Movement, "id" | "kind" | "status">): Movement => ({ amount: "5", startedAtIso: ago(3), updatedAtIso: ago(2), explorerUrls: [], ...o } as Movement);
const LEDGER: Movement[] = [
  mv({ id: "send", kind: "transfer", status: "moving", from: "nep141:usdc", to: "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ on Solana", startedAtIso: ago(2) }),
  mv({ id: "in", kind: "deposit", status: "done", from: "sol", to: "nep141:usdc", amount: "25.01", updatedAtIso: ago(60) }),
  mv({ id: "old", kind: "transfer", status: "done", from: "nep141:usdc", to: "kim.near", updatedAtIso: ago(60 * 30) }),
  mv({ id: "acct", kind: "account", status: "done", amount: "0", label: "Added a key" }),
  mv({ id: "t1", kind: "trading", status: "moving", from: "nep141:usdc", to: "trading", startedAtIso: ago(1) }),
];
const SPENDING = [
  { id: "t1", kind: "top-up", usd: "$5.00", status: "on-its-way", shown: true, atIso: ago(1), words: "Top up $5.00", by: "agentzero" },
  { id: "q", kind: "refill", usd: "$1.00", status: "done", shown: false, atIso: ago(5), words: "$1.00 to Solana, behind the scenes" },
] as SpendingActivity[];
const JOB = { id: "j1", kind: "keep", keepUsd: 50, perDayUsd: 20, on: true, startedAtIso: ago(600) } as unknown as Job;
const ROUTINE = { id: "r1", when: { every: "week", day: 5 }, do: { act: "tell" }, limitUsd: 0, on: true, startedAtIso: ago(900) } as unknown as Routine;
const RECEIPT = { id: "rc", atIso: ago(30), jobId: "j1", title: "AgentZero moved $5 to your SOL wallet", state: "done", why: ["Job: keep"] } as Receipt;
const READ: JobsRead = { ledger: LEDGER, spending: SPENDING, agent: { jobs: [JOB, { ...JOB, id: "j2", on: false }], routines: [ROUTINE], receipts: [RECEIPT] } };

test("now: moves in flight from the record (one row per move, Spending's wins), then AgentZero's running jobs and routines", () => {
  const j = jobsOf(READ, NOW);
  assert.deepEqual(j.now.map((i) => i.key), ["spending:t1", "ledger:send", "job:j1", "routine:r1"]);
  assert.equal(j.moving, 2, "the top bar's Now count: moves in flight only");
  assert.equal(j.now[0]!.kind === "move" && j.now[0]!.by, "agentzero");
  // control: a stopped job, a behind-the-scenes move and a step that moved no money are never listed
  const keys = [...j.now, ...j.recent].map((i) => i.key);
  for (const k of ["job:j2", "spending:q", "ledger:acct", "ledger:t1"]) assert.ok(!keys.includes(k), k);
});

test("last 24 hours: finished moves and receipts, newest first; older ones drop off (control: 30 h ago)", () => {
  const j = jobsOf(READ, NOW);
  assert.deepEqual(j.recent.map((i) => i.key), ["receipt:rc", "ledger:in"]);
  assert.ok(!j.recent.some((i) => i.key === "ledger:old"));
});

test("never a made-up status: a failed read is said, nothing is listed in its place; before the first answer it's reading", () => {
  const failed = jobsOf({ ledger: "unread", spending: "unread", agent: null }, NOW);
  assert.deepEqual(failed.unread, ["Your moves couldn't be read just now.", "Moves between your wallets couldn't be read just now."]);
  assert.equal(failed.now.length + failed.recent.length, 0);
  assert.equal(failed.moving, 0);
  assert.equal(jobsOf({ ledger: null, spending: null, agent: null }, NOW).loading, true);
  // control: a good read says nothing failed
  assert.deepEqual(jobsOf(READ, NOW).unread, []);
  // the record's own state, word for word: a move that came back is "came-back", never "done"
  const back = jobsOf({ ledger: [mv({ id: "b", kind: "transfer", status: "refunded", updatedAtIso: ago(1) })], spending: [], agent: null }, NOW);
  assert.equal(back.recent[0]!.state, "came-back");
});

test("the live card finds the move the sheet started: after the tap, AgentZero's own first (control: one from before the tap)", () => {
  const items = [...jobsOf(READ, NOW).now, ...jobsOf(READ, NOW).recent];
  assert.equal(startedSince(items, NOW - 90_000)?.key, "spending:t1", "AgentZero's own move wins");
  assert.equal(startedSince(items.filter((i) => i.key !== "spending:t1"), NOW - 150_000)?.key, "ledger:send");
  assert.equal(startedSince(items, NOW + 60_000), null, "nothing started after the tap: no card invented");
});

test("ago words", () => {
  assert.equal(agoWords(ago(0), NOW), "just now");
  assert.equal(agoWords(ago(2), NOW), "2 min");
  assert.equal(agoWords(ago(180), NOW), "3 h");
});

test("the email sheet says mail's real state and never offers what can't work (control: once sending is live, nothing to warn)", () => {
  assert.deepEqual(mailLines("maya.river@zerofee.si"), [MAIL_WORDS.notLive, MAIL_WORDS.meanwhile]);
  assert.deepEqual(mailLines(null), [MAIL_WORDS.none]);
  assert.deepEqual(mailLines("unread"), [MAIL_WORDS.unread]);
  assert.equal(MAIL_WORDS.notLive, "AgentZero can get mail now. It can't send mail yet.", "receiving is live (5 Nov); only sending is said off");
  assert.equal(MAIL_WORDS.none, "AgentZero gets its email address, two words like name.word, the next time it opens.");
  assert.equal(MAIL_SEND_LIVE, false, "sending isn't live today (the product steps 8, 9 and 21)");
  // control: with sending live and an address, the sheet has nothing to warn about
  assert.deepEqual(mailLines("maya.river@zerofee.si", true), []);
  assert.deepEqual(mailLines(null, true), [MAIL_WORDS.none], "no address is said even when sending is live");
  // the sheet's only button besides Close is Copy, shown only with a real address (never a dead button)
  const sheet = readFileSync(new URL("./Jobs.tsx", import.meta.url), "utf8");
  const mail = sheet.slice(sheet.indexOf("export function MailSheet"));
  assert.equal([...mail.matchAll(/<button/g)].length, 1);
  assert.match(mail, /\{has && <div className="azj-acts"><button/);
});

test("the menu and the chat use these (control: the rows exist)", () => {
  const menu = readFileSync(new URL("./ChatsMenu.tsx", import.meta.url), "utf8");
  // QA 5 Nov: the menu's "Jobs" opened Activity; the one row now is Jobs and limits, with what's on now
  assert.match(menu, /onClick=\{\(\) => \(onJobs\(\), onClose\(\)\)\}><span>Jobs and limits<\/span>\{nowCount\}<\/button>/);
  assert.doesNotMatch(menu, /<span>Jobs<\/span>/, "no second Jobs row");
  const app = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  assert.match(app, /onJobs: \(\) => setSection\("settings"\)/, "the menu's row opens Jobs and limits");
  assert.match(app, /section === "settings" && <div className="azc-pushed"><PushedFrame name="Jobs and limits"/, "control: that section is Jobs and limits");
  const az = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(az, /<ChatsMenu [^\n]*onJobs=\{\(\) => onJobs\?\.\(\)\}/);
  assert.doesNotMatch(az, /<ChatsMenu [^\n]*(onNow|centre\()/, "the menu opens no Activity");
  assert.match(menu, />AgentZero's email</);
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /<AgentTasks /);
  assert.doesNotMatch(chat, /<NowChip /, "D144: the shell's corner badge is the one now");
  assert.match(chat, /<JobCard /);
});
