// Real money, 4 Nov (tester's note a): Move and Swap said "Your wallets didn't answer" and then sat on "Reading your
// money…" for over 90 s. LoadingSheet's AWAY_SLOW_MS timer ran once (its effect had no deps): Try again reset `late`
// and nothing ever set it again. Each try now gets its own wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("a loading sheet's Try again gets its own wait (it never re-armed, and sat on 'Reading your money…' for 90 s)", () => {
  const host = src("./MoneyHost.tsx");
  assert.match(host, /setTimeout\(\(\) => setLate\(true\), AWAY_SLOW_MS\); return \(\) => clearTimeout\(t\); \}, \[tries\]\)/);
  assert.match(host, /setLate\(false\); setTries\(\(n\) => n \+ 1\); again\(\);/);
});
