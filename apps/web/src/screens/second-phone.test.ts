// Dead ends row 16 (3 Nov): "Add a second phone" told the other phone to go to Devices, which a phone reaches only
// inside an account of its own (a whole funded account on mainnet). Being a second device needs no account: the
// guardian core (guardian.ts) keeps its own key in its own vault. Now Welcome offers it, and the steps name what the
// other phone shows. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
// the copy review's S5 (7 Nov): "Be a second phone or a guardian" became "Approve for someone else", in every place it shows
const LABEL = "Approve for someone else";

test("Welcome (no account) offers being a second phone or a guardian, and it opens the guardian screen", () => {
  const onboarding = read("./Onboarding.tsx");
  const welcome = onboarding.slice(onboarding.indexOf("export function Welcome"), onboarding.indexOf("/** The words' screens"));
  assert.match(welcome, new RegExp(`onClick=\\{onGuard\\}[^>]*>${LABEL}<`));
  const app = read("../App.tsx");
  assert.match(app, /case "welcome": screen = <Welcome [^\n]*onGuard=\{\(\) => setView\(gate\(\{ k: "guard" \}\)\)\}/);
  const guard = app.slice(app.indexOf('case "guard":'), app.indexOf('case "reroute":'));
  assert.match(guard, /<GuardianSide bridge=\{shellBridge\}/, "the shell's own bridge: guardian.* answers only the shell");
  assert.doesNotMatch(guard, /account/, "no account is needed or read");
  // a browser's first visit (FirstRun, before the lock): the same link, then terms and the lock, then the same screen
  const first = read("./FirstRun.tsx");
  assert.match(first, /<Welcome [^\n]*onGuard=\{/);
  assert.match(first, /const guard = \(\) => \{\n\s+setFirstChoice\("guard"\);\n\s+onDone\(true\);/, "locks, and never marks set-up unfinished");
  assert.match(app, /if \(first === "guard"\) return setView\(\{ k: "guard" \}\);/);
  // the guardian core is made whether or not this phone has an account (core.ts): no account read on the way
  const core = read("../core.ts");
  assert.match(core, /const guardian = createGuardian\(/);
  assert.match(core, /guardian: guardian\.service/);
});

test("the main phone's steps name what the other phone shows, in both places it shows it", () => {
  const sec = read("../apps/security/SecurityApp.tsx");
  const pair = sec.slice(sec.indexOf("const PAIR_WORDS"), sec.indexOf("} as const;", sec.indexOf("const PAIR_WORDS")));
  for (const kind of ["phone", "guardian"]) {
    const block = pair.slice(pair.indexOf(`  ${kind}: {`));
    // step 1 alone in the words (B11: step 2 is its button's, pair-steps.ts)
    const step = /step1: "([^"]+)"/.exec(block)![1]!;
    assert.ok(step.includes(LABEL), `${kind}: ${step}`);
    // control: main's step sent the other phone to Devices, which Welcome doesn't have
    assert.doesNotMatch(step, /Devices/, kind);
  }
  assert.ok(sec.includes(`<span>${LABEL}</span>`), "a phone with an account finds the same words in Devices");
  const onboarding = read("./Onboarding.tsx");
  assert.ok(!onboarding.slice(onboarding.indexOf("export function Welcome"), onboarding.indexOf("/** The words' screens")).includes("Devices"), "control: Welcome has no Devices");
});
