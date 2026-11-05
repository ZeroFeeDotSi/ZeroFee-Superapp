// QA's real-money re-test (4 Nov): a BONK buy on Jupiter (through Orca) was refused, "It routes through
// an app ZeroFee doesn't know". The same route read now: every account it names is a plain account on both nodes. One
// node not answering made every account count as a program, and so every Jupiter buy as an unknown app. Now a node that
// didn't answer is asked once more; if it still doesn't, the read fails (said as "ZeroFee can't check the apps it routes
// through"), never "an app ZeroFee doesn't know".
import { test } from "node:test";
import assert from "node:assert/strict";
import { executableOn } from "./coin-meta.ts";
import { routeProgramsRefusal, PAYOUT_WORDS } from "./payout.ts";

const KEYS = ["Pool1111111111111111111111111111111111111111", "Tick1111111111111111111111111111111111111111"];
/** A two-node `both` whose answers come from a script: one entry per call, one answer (or null: no answer) per node. */
function scripted(calls: ((boolean | null)[] | null)[][]) {
  let n = 0;
  const both = async <T,>(ask: (url: string) => Promise<T>): Promise<(T | null)[]> => {
    const round = calls[Math.min(n++, calls.length - 1)]!;
    return Promise.all(round.map((v, i) => (v === null ? Promise.resolve(null) : ask(`node${i}:${JSON.stringify(v)}`).catch(() => null))));
  };
  const accounts = async (u: string, _keys: string[]) => ({ value: (JSON.parse(u.slice(u.indexOf(":") + 1)) as (boolean | null)[]).map((x) => (x === null ? null : { executable: x })) });
  return { both, accounts, calls: () => n };
}

test("one node that doesn't answer is asked once more; with both answers in, plain accounts read as plain", async () => {
  const s = scripted([[null, [false, false]], [[false, false], [false, false]]]);
  assert.deepEqual(await executableOn(KEYS, s.both, s.accounts), [false, false]);
  assert.equal(s.calls(), 2);
});

test("a node that still doesn't answer fails the read; it never says every account is a program", async () => {
  const s = scripted([[null, [false, false]], [null, [false, false]]]);
  await assert.rejects(executableOn(KEYS, s.both, s.accounts));
  // and the route check says it couldn't check, not that it found an unknown app
  const decoded = { routeAccounts: KEYS } as never;
  assert.equal(await routeProgramsRefusal(decoded, (k) => executableOn(k, s.both, s.accounts)), PAYOUT_WORDS.appsUnread);
});

test("controls: both answer at once (one read); a real program still counts; nodes that disagree count it as a program", async () => {
  const ok = scripted([[[false, true], [false, true]]]);
  assert.deepEqual(await executableOn(KEYS, ok.both, ok.accounts), [false, true]);
  assert.equal(ok.calls(), 1);
  const split = scripted([[[false, false], [false, true]]]);
  assert.deepEqual(await executableOn(KEYS, split.both, split.accounts), [false, true]);
  const missing = scripted([[[null, false], [null, false]]]);
  assert.deepEqual(await executableOn(KEYS, missing.both, missing.accounts), [false, false], "an account that doesn't exist yet isn't a program");
});
