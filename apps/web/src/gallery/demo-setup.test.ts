// Findings 42 and 50 (sample-page crawl, 4 Nov): the sample page's set-up. 42: Welcome had only "Create my account".
// 50: "Money in" and "Protected" ticked themselves with nothing shown; the recovery wait's sheet said "No one can shorten
// it later, not even you" with no way back and no plain why; "What these words can do" opened out of sight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEMO_MONEY_IN, demoMoneyThread } from "./demo-money-in.ts";
import { CHOICE_WORDS } from "../screens/recovery-words.ts";
import { grade } from "../../../../tools/copy/voice.ts";

/** Flesch-Kincaid grade, the audit's D7 measure (as onboarding-j2.test.ts measures it). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const demo = read("./Demo.tsx");

test("finding 42: the sample Welcome brings back an account with its 24 words; other words don't match", () => {
  assert.match(demo, /<Welcome onCreate=\{\(\) => setSetup\("words"\)\} onRestore=\{\(\) => setSetup\("restore"\)\}/);
  const screen = demo.slice(demo.indexOf('if (setup === "restore")'), demo.indexOf('if (setup === "words")'));
  assert.match(screen, /<RestoreWords [^>]*purpose="restore" sample=\{WORDS\}/, "the restore screen, with this account's words on a button");
  assert.match(screen, /wrong=\{!!restoreTyped\}/, "words that don't match are said so, kept to fix");
  assert.match(screen, /onBack=\{\(\) => \{ setRestoreTyped\(null\); setSetup\("welcome"\); \}\}/, "a way back to Welcome");
  const restore = demo.slice(demo.indexOf("const restoreSetup"), demo.indexOf("// Start over"));
  assert.match(restore, /if \(typed\.join\(" "\) !== WORDS\.join\(" "\)\) return setRestoreTyped\(typed\);/, "only the account's own words bring it back");
  assert.ok(restore.indexOf("keepDemoSetup(") > restore.indexOf("!== WORDS.join"), "nothing is kept before the words match");
  assert.match(restore, /setSetup\("done"\)/);
  const welcome = read("../screens/Onboarding.tsx");
  assert.match(welcome, /\{onRestore && <button className="zf-link" onClick=\{onRestore\}>I already have one<\/button>\}/);
});

test("finding 50: Money in is ticked only once its figure is shown; Protected comes with its rule in figures", () => {
  const step = (total: string | null, key: string) => demoMoneyThread(total).steps.find((s) => s.key === key)!.state;
  assert.notEqual(step(null, "money"), "done", "while the figure is read: not ticked");
  assert.equal(step("5460.55", "money"), "done");
  assert.equal(step("5460.55", "protected"), "done");
  assert.notEqual(step("5460.55", "device"), "done", "control: the second device is still to come");
  assert.equal(DEMO_MONEY_IN.rule, "Your Safe's rule: up to $500 each day needs your yes. More waits 24 hours first.");
  const view = read("./DemoMoneyIn.tsx");
  assert.match(view, /const parts = useBalanceParts\(bridge\);\s*const total = parts\?\.usd \?\? null;\s*const t = demoMoneyThread\(total\);/);
  assert.match(view, /\{total === null \? "…" : dollars\(total\)\}/, "the figure that ticks Money in is on screen");
  assert.match(view, /\{DEMO_MONEY_IN\.rule\} \{DEMO_MONEY_IN\.ruleWhere\}/, "the rule that ticks Protected is on screen");
  assert.match(demo, /<DemoMoneyIn bridge=\{demoWalletBridge\}/);
});

test("finding 50: the recovery wait's sheet says how you hear of a move, what rules are, that it's picked once, and has a way back", () => {
  const sheet = read("../screens/Recovery.tsx");
  const wl = sheet.slice(sheet.indexOf("export function WaitLine"), sheet.indexOf("export function WasThisYou"));
  assert.match(wl, /<Sheet title=\{CHOICE_WORDS\.line\} onClose=\{\(\) => setOpen\(false\)\}>/, "its Close");
  assert.match(wl, /onClick=\{\(\) => setOpen\(false\)\}>\{CHOICE_WORDS\.keep\(waitName\(seconds\)\)\}<\/button>/, "Keep: back, nothing changed");
  assert.match(wl, /\{CHOICE_WORDS\.rules\} \{CHOICE_WORDS\.later\}/);
  assert.doesNotMatch(JSON.stringify(CHOICE_WORDS), /not even you/, "control: the old line is gone");
  assert.equal(CHOICE_WORDS.keep("48 hours"), "Keep 48 hours");
});

test("finding 50: 'What these words can do' shows what it opened", () => {
  const words = read("../screens/Onboarding.tsx");
  const view = words.slice(words.indexOf("export function Words("), words.indexOf("export function revealWhenOpened"));
  assert.match(view, /useEffect\(\(\) => revealWhenOpened\(notes\.current\), \[\]\);/);
  assert.match(view, /<div className="ob-notes zf-enter-3" ref=\{notes\}>[^]*<More label=\{WORDS_MORE\}/, "the listener holds the explanation");
  assert.match(words, /box\.addEventListener\("toggle", on, true\)/, "heard on the way down: toggle doesn't bubble");
  assert.match(words, /scrollIntoView\(\{ block: "nearest", behavior: still \? "auto" : "smooth" \}\)/, "Reduce Motion: no smooth scroll");
});

test("findings 36, 42, 50: every new line reads at grade 5 or under and A or B on the voice guard", () => {
  const strings = [DEMO_MONEY_IN.line, DEMO_MONEY_IN.rule, DEMO_MONEY_IN.ruleWhere, DEMO_MONEY_IN.next, CHOICE_WORDS.sub, CHOICE_WORDS.fixed, CHOICE_WORDS.rules, CHOICE_WORDS.keep("48 hours")];
  const hard = strings.filter((s) => s.split(/\s+/).length > 3).map((s) => ({ s, fk: fkGrade(s) })).filter((x) => x.fk > 5);
  assert.deepEqual(hard.map((x) => `${x.s} (grade ${x.fk.toFixed(1)})`), []);
  const graded = strings.map((s) => ({ s, g: grade("j2", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B");
  assert.deepEqual(graded.map((x) => `${x.s}: ${x.g.grade} ${x.g.problems.join("; ")}`), []);
});
