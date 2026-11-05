// QA 3 Nov, Send's sheet loads after Home (77ae90af): (1) the Send button can't enable until the guard's code is here, so a
// slow load never lets a tap skip the guard; (2) a failed load (offline mid-tap) is one named line with Try again, and
// nothing can be sent, for the guard and for the sheet's own code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIDNT_LOAD, codeGate, didntLoad } from "./code-gate.ts";

const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
const host = readFileSync(new URL("./MoneyHost.tsx", import.meta.url), "utf8");

test("(1) a slow guard load: nothing is here, so Send stays off and a tap sends nothing; once it arrives, Send enables (control)", async () => {
  const slow = deferred<{ judge: () => string }>();
  const gate = codeGate(() => slow.promise);
  const asked = gate.load();
  assert.equal(gate.here(), null, "on its way: not here");
  // the sheet's wiring: the button is off while the guard isn't here, and a tap without it returns before anything
  assert.match(sheet, /<SendForm key=\{formKey\} prefill=\{prefill\} sources=\{sources\} [^>]*?busy=\{busy\} waits=\{waits\} blocked=\{stop\} notYet=\{guard \? null : guardFailed \? GUARD_FAILED_WHY : GETTING_READY\}/, "Hold off until the guard is here, and it says why (the review's walk, item 2)");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const why = !source \? null\n\s+: source\.cant \? source\.cant\n\s+: notYet \? notYet\n/, "the reason first (after a coin that can't go), said under the Send button");
  assert.match(form, /const ready = [^;]*!why[^;]*;/, "and Hold is off while it stands");
  assert.match(sheet, /export const GETTING_READY = "Send is getting ready\.";\nexport const GUARD_FAILED_WHY = "Tap Try again above\.";/);
  assert.doesNotMatch(sheet, /busy=\{busy \|\| !guard\}/, "control: never greyed with no reason (the whole form was off while the guard loaded)");
  assert.match(sheet, /const send = async \(a: SendAsk\) => \{[^]*?const g = guardCode\.here\(\);\n\s+if \(!g \|\| checking\.current\) return;\n\s+const \{ GUARD_HIDES, firstPayLine, guardFactsSoon, guardTarget, judge, obfuscated \} = g;/, "no other way in skips it");
  assert.doesNotMatch(sheet, /await loadGuard\(\)|import\("\.\/send-guard\.ts"\)\.then/, "no tap waits on a load and then goes on its own");
  slow.resolve({ judge: () => "ok" });
  await asked;
  assert.equal(gate.here()?.judge(), "ok", "control: here, so Send enables");
  assert.equal(await gate.load(), gate.here(), "kept: never asked twice");
});

test("(2) a failed load: one named line with Try again, nothing sent; asking again loads again (control: a good load)", async () => {
  assert.equal(DIDNT_LOAD, "Send didn't load. Try again.");
  let fail = true, loads = 0;
  const gate = codeGate(async () => { loads++; if (fail) throw new TypeError("Failed to fetch dynamically imported module"); return { judge: () => "ok" }; });
  await assert.rejects(gate.load());
  assert.equal(gate.here(), null, "nothing here: Send stays off");
  await assert.rejects(gate.load(), undefined, "a failed load is never kept as the answer: the retry asks again");
  assert.equal(loads, 2);
  fail = false;
  assert.equal((await gate.load()).judge(), "ok", "control: back online, Try again loads it");
  assert.equal(gate.here()?.judge(), "ok");
  // the guard: its line and its Try again on the sheet
  assert.match(sheet, /guardCode\.load\(\)\.then\(\(g\) => setGuard\(\(\) => g\), \(\) => setGuardFailed\(true\)\)/);
  assert.match(sheet, /\{guardFailed && \([^]*?\{DIDNT_LOAD\}[^]*?onClick=\{loadTheGuard\}>Try again</);
  // the sheets' own code (Add, Swap, Send): the same line and Try again, never "Reading…" for ever (sheet-code test below)
  // a failed load's Try again at once (its words aren't the plain "Reading…"); a slow read's after 5 s (phone test, 3 Nov)
  assert.match(host, /const again = retry && \(late \|\| words !== "Reading your money…"\) \? retry : undefined;/);
  assert.match(host, /\{again && <button className="zf-btn" onClick=\{\(\) => \{ setLate\(false\); setTries\(\(n\) => n \+ 1\); again\(\); \}\}>Try again<\/button>\}/);
});

test("Add, Swap and Send's own code: a failed load is never kept; each says its own line with Try again, which asks again (control: a good load paints the sheet)", async () => {
  assert.deepEqual(["Add", "Swap", "Send"].map((n) => didntLoad(n as "Add")), ["Add didn't load. Try again.", "Swap didn't load. Try again.", "Send didn't load. Try again."]);
  // each sheet's code goes through a gate (never a kept failed import) and the one shared loader with its retry
  for (const [name, file, words] of [["add", "AddSheet", 'didntLoad("Add")'], ["swap", "SwapSheet", 'didntLoad("Swap")'], ["send", "SendSheet", 'didntLoad("Send")']] as const) {
    assert.match(host, new RegExp(`const ${name}Code = codeGate\\(\\(\\) => import\\("\\./${file}\\.tsx"\\)`), `${name}: a gate`);
    assert.match(host, new RegExp(`useLater\\(${name}Code\\)`), `${name}: the shared loader`);
    assert.ok(host.includes(words), `${name}: its own line`);
  }
  assert.doesNotMatch(host, /\b(add|swap|send)Asked\b|\?\?= import\(/, "no import's promise kept by hand");
  // the shared loader: a failure sets the line; Try again clears it and asks again (a fresh ask: the gate forgot the failure)
  assert.match(host, /code\.load\(\)\.then\(\(c\) => live && setHere\(\(\) => c\), \(\) => live && setFailed\(true\)\)/);
  assert.match(host, /failed: failed \? \{ retry: \(\) => \{ setFailed\(false\); setTries\(\(n\) => n \+ 1\); \} \} : null/);
  assert.match(host, /\}, \[tries\]\);/);
  // the gate itself, as the loader uses it: offline, then back (control: a good load is kept)
  let online = false;
  const gate = codeGate(async () => { if (!online) throw new TypeError("Failed to fetch dynamically imported module"); return "the sheet"; });
  await assert.rejects(gate.load());
  online = true;
  assert.equal(await gate.load(), "the sheet");
  assert.equal(gate.here(), "the sheet");
});
