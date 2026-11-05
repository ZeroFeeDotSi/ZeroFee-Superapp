// The one thread (Job 1, criterion 3): five steps, Words → Money in → Protected → Second device → Done, one bar, the
// only progress device in the app, and it never says something that hasn't happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { threadOf, threadShows, type ThreadFacts } from "./thread.ts";

const READY: ThreadFacts = { stage: "ready", wordsDone: true, moneyIn: true, protection: true, secondDevice: false, safeUsd: 120 };
const keys = (f: ThreadFacts) => threadOf(f).steps.map((s) => `${s.label}:${s.state}`).join(" ");

test("five steps in one order, the next one under way, tap opens it", () => {
  const t = threadOf(READY);
  assert.deepEqual(t.steps.map((s) => s.label), ["Words", "Money in", "Protected", "Second device", "Done"]);
  assert.equal(keys(READY), "Words:done Money in:done Protected:done Second device:now Done:todo");
  assert.equal(t.next, "device");
  assert.equal(t.line, "Add a second device");
  assert.equal(threadOf({ ...READY, protection: false }).line, "Choose what big payments need");
  assert.equal(threadOf({ ...READY, wordsDone: false }).line, "Check your backup words", "Check later, or words never checked");
  assert.equal(threadOf({ ...READY, moneyIn: false }).line, "Add money to your Safe");
});

test("over $5,000 with no second device: the must-do is the thread's own line (no banner of its own)", () => {
  assert.equal(threadOf({ ...READY, safeUsd: 7250 }).line, "Add a second device", "one idea over the money (design review §1.2): the $5,000 reason lives on Devices");
});

test("all five done: the bar leaves", () => {
  const t = threadOf({ ...READY, secondDevice: true });
  assert.equal(t.complete, true);
  assert.equal(t.steps.at(-1)!.state, "done");
  assert.equal(threadShows(t), false);
});

test("never says what hasn't happened: a fact not read yet is neither ticked nor offered", () => {
  const unread: ThreadFacts = { stage: "ready", wordsDone: true, moneyIn: null, protection: null, secondDevice: null };
  const t = threadOf(unread);
  assert.equal(keys(unread), "Words:done Money in:todo Protected:todo Second device:todo Done:todo");
  assert.equal(t.next, null);
  assert.equal(threadShows(t), false, "nothing to offer until a fact is read");
  // control: the same facts read as missing do offer the step
  assert.equal(threadOf({ ...unread, moneyIn: false }).next, "money");
});

test("set-up: while the money comes, Money in is under way and the words wait; once open, the words come first", () => {
  const funding = threadOf({ stage: "needs-funding", wordsDone: false, moneyIn: null, protection: null, secondDevice: null });
  assert.equal(funding.next, "money");
  assert.equal(funding.steps.find((s) => s.key === "words")!.state, "todo");
  const words = threadOf({ stage: "needs-backup", wordsDone: false, moneyIn: true, protection: null, secondDevice: null });
  assert.equal(words.next, "words");
  assert.equal(words.line, "Write down your backup words");
});

/** Every user-facing source file of the app (no tests, no galleries' sample code). */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "testing") continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test("no other progress device: no 'Step 1 of 2', no 'n of 5' safety steps, no funding strip, no 'Move the rest to Private'", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const files = [...sources(join(root, "apps/web/src")), ...sources(join(root, "packages/wallet/src/app")), ...sources(join(root, "packages/shell-api/src"))];
  const banned: [RegExp, string][] = [
    [/Step \$\{n\} of|`Step \d of \d`|"Step \d of \d"/, "Step n of m"],
    [/safety steps done/, "Security's n of 5"],
    [/stepCount\(|barText\(|FundBarView|fs-bar\b/, "the funding strip"],
    [/Move the rest to Private|to Private` }/, "Move the rest to Private"],
    [/ob-dots/, "the check's dots"],
    [/VaultBanner/, "the $5,000 banner"],
  ];
  const hits: string[] = [];
  for (const f of files) {
    // code and on-screen words only: comments may name what was removed
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const [re, what] of banned) if (re.test(src)) hits.push(`${f.slice(root.length)}: ${what}`);
  }
  assert.deepEqual(hits, []);
});

test("control: the scan finds a planted progress device", () => {
  const re = /safety steps done/;
  assert.ok(re.test("`${on} of 5 safety steps done`"));
});
