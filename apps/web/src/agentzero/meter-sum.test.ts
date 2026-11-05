// AgentZero's money figures from one source (QA, 5 Nov: a chat that cost $0.034 showed "$0.101 used" on the
// pill, "Used today $0.203 · paid $0.650" in the sheet, and the pill stepped 2.7¢ → 5.4¢). The source is the relay's own
// cost per reply, the figure each receipt pays. The pill and the sheet's today read the same meter, which the phone kept
// read again on each new shell context and added to itself. Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReplyOwed } from "@zerofee/agent/chat/turn";
import { heardMicros, keptPlusEarly, monthShown, readMeter, type Meter } from "./meter.ts";
import { receiptTitle, todayLine, usedChip } from "./wallet-words.ts";

const DAY = "2026-11-05";
const m = (used: number, paid = 0, day = DAY): Meter => ({ day, usedMicros: used, paidMicros: paid });

test("the kept meter read again never adds the meter to itself (the 2.7¢ → 5.4¢ step); what was heard before the first read counts once (controls)", () => {
  // the phone kept $0.027 used and $0.014 paid; the read runs again with nothing new heard: the same figures
  assert.deepEqual(keptPlusEarly(m(27_000, 14_000), m(0)), m(27_000, 14_000));
  assert.deepEqual(keptPlusEarly(keptPlusEarly(m(27_000, 14_000), m(0)), m(0)), m(27_000, 14_000), "again and again: never doubled");
  // control: the old merge (kept + all in memory) doubled it, which is what the pill showed
  const old = (kept: Meter, now: Meter) => m(kept.usedMicros + now.usedMicros, kept.paidMicros + now.paidMicros);
  assert.deepEqual(old(m(27_000, 14_000), m(27_000, 14_000)), m(54_000, 28_000));
  // a reply heard while the first read was out: added once
  assert.deepEqual(keptPlusEarly(m(27_000, 14_000), m(12_000, 0)), m(39_000, 14_000));
  // control: yesterday's early figures never land on today
  assert.deepEqual(keptPlusEarly(m(27_000), m(5_000, 0, "2026-11-04")), m(27_000));
  assert.deepEqual(readMeter(JSON.stringify(m(27_000, 14_000)), "2026-11-06"), m(0, 0, "2026-11-06"), "control: a new day starts at nothing");
  // the hook: the kept meter is read once per open (its own effect, on the bridge only), and nothing hangs off the
  // shell's tasks facade (a new object with each new shell context, which re-ran the read and the payment path)
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /const next = keptPlusEarly\(kept, early\.current\);[\s\S]*?read\.current = true;[\s\S]*?\}\);\n\s*return \(\) => void \(live = false\);\n\s*\}, \[bridge\]\);/);
  assert.doesNotMatch(hook, /meterRef\.current = \{ day: m\.day, usedMicros: m\.usedMicros \+ \(now\.day/, "the doubling merge is gone");
  assert.match(hook, /\}, \[bridge, token, refresh, heard, bump\]\);/, "the payment path doesn't change with the shell's tasks");
  assert.doesNotMatch(hook, /\[[^\]]*\btasks\b[^\]]*\]\);/, "no hook depends on the tasks facade");
  assert.match(hook, /if \(!read\.current\) \{[\s\S]*?return;\n\s*\}\n\s*void bridge\.call\("device\.store\.set"/, "nothing is written over the kept figures before they are read");
});

test("three replies: used = the relay's cost of each = what the receipts paid; owed is the difference; the month never below today (control: a batch that keeps its paid figure adds only the new reply)", () => {
  const costs = [5_000, 3_000, 6_000];
  let owed: ReplyOwed | null = null;
  let known = true;
  let used = 0;
  let paid = 0;
  const receipts: string[] = [];
  costs.forEach((c, i) => {
    const next: ReplyOwed = { owedMicros: c, usage: {}, model: "claude-opus-5-5", memo: "m", reply: `b${i}`, replies: 1, paidMicros: 0, turnMicros: c };
    used += heardMicros(owed, known, next, c, 0);
    owed = next;
    known = true;
    // paid at once: the relay counts it and closes the batch; the receipt is its figure
    paid += c;
    receipts.push(receiptTitle(c));
    owed = null;
  });
  const sum = costs.reduce((a, b) => a + b, 0);
  assert.deepEqual([used, paid, used - paid], [sum, sum, 0]);
  assert.deepEqual(receipts, ["AgentZero paid 0.5¢ for a reply", "AgentZero paid 0.3¢ for a reply", "AgentZero paid 0.6¢ for a reply"]);
  assert.equal(usedChip(used / 1e6), "$0.014 used", "the pill: the three replies, nothing more");
  assert.equal(todayLine(used / 1e6, paid / 1e6), "Used today $0.014 · paid $0.014", "the sheet says the same");
  assert.ok(monthShown({ spentUsd: paid / 1e6 }, 0)!.spentUsd >= used / 1e6 - 1e-9, "the month: what was paid plus what is owed, never below today's paid");
  // control: a batch that still carries its paid replies (the same batch, paid figure kept) adds only the new one
  const a: ReplyOwed = { owedMicros: 5_000, usage: {}, model: "claude-opus-5-5", memo: "m", reply: "b", replies: 1, paidMicros: 0 };
  const b: ReplyOwed = { ...a, owedMicros: 3_000, replies: 2, paidMicros: 5_000 };
  assert.equal(heardMicros(a, true, b, 3_000, 0), 3_000);
});

test("real test (QA): one reply paid in two parts is ONE receipt row of their sum, both transactions under it; the next message's payments are its own row (control: no message named, a row per payment)", async () => {
  const { replyReceipt } = await import("./az-tasks.ts");
  const rows = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  const tasks = { publish: (t: Record<string, unknown>) => (rows.has(String(t.id)) || order.push(String(t.id)), rows.set(String(t.id), t), true), update: () => true, end: () => true } as never;
  const one = { id: "m1", titleOf: receiptTitle };
  replyReceipt(tasks, 4_000, receiptTitle(4_000), () => 10, "TX1", one);
  replyReceipt(tasks, 3_000, receiptTitle(3_000), () => 11, "TX2", one);
  assert.equal(order.length, 1, "one row for the reply");
  const r = rows.get(order[0]!)!;
  assert.deepEqual([r.title, r.usd, r.proof], [receiptTitle(7_000), "$0.007", [{ chain: "near", hash: "TX1" }, { chain: "near", hash: "TX2" }]]);
  replyReceipt(tasks, 5_000, receiptTitle(5_000), () => 12, "TX3", { id: "m2", titleOf: receiptTitle });
  assert.equal(order.length, 2, "the next message: its own row");
  replyReceipt(tasks, 2_000, receiptTitle(2_000), () => 13, "TX4");
  replyReceipt(tasks, 2_000, receiptTitle(2_000), () => 14, "TX5");
  assert.equal(order.length, 4, "control: no message named, a row per payment");
  // the hook: a message's calls add up; the last message's whole cost is what read_meter says; its payments one row
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(turnId\.current !== null && turnSum\.current > 0\) setLastMicros\(turnSum\.current\);/);
  assert.match(hook, /if \(o\.turnMicros !== undefined\) turnSum\.current \+= o\.turnMicros;/);
  assert.match(hook, /replyReceipt\(tasksRef\.current, r\.paidMicros, receiptTitle\(r\.paidMicros\), Date\.now, r\.tx, turnId\.current \? \{ id: turnId\.current, titleOf: receiptTitle \} : undefined\);/);
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const go = useCallback\(\(w: string, id: string\) => \{\s*\/\/[^\n]*\n\s*walletRef\.current\?\.turn\(id\);/, "each message names itself as it goes");
});

test("real test (QA): \"paid $0.678\" beside $0.028 of receipts was the day kept before the doubling fix; the meter's new key starts clean (control: the old key's figures are never read)", async () => {
  const { METER_KEY } = await import("./meter.ts");
  assert.equal(METER_KEY, "agentzero.meter.v2");
  const src = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8") + readFileSync(new URL("./meter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /"agentzero\.meter"/, "the doubled figures' key is read nowhere");
});
