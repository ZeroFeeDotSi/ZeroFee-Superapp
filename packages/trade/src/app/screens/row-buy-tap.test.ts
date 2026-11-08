// the audit's Trade audit T3 (8 Nov): a list row's Buy quoted, built and checked after the tap (Discover.tsx: await svc.quote,
// then p.ready(): Jupiter's quote and build, then up to PREFLIGHT_WAIT_MS for the core's check), and only then made its
// job: signing started after two to four network answers and Jobs had no row until then. Now the chip's quote is got and
// checked from the finger's first touch (pointerdown, or focus), so the tap only signs, and the job is made at the tap.
// Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHIP_QUOTE_MS, createChipQuotes } from "./row-buy.ts";

const src = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");

test("the chip's quote: got once from the touch, the tap takes that very one; a second tap gets its own; a failed or old one is got again", async () => {
  let t = 1_000, made = 0, fail = false;
  const q = createChipQuotes(() => t);
  const make = async () => { made++; if (fail) throw new Error("no quote"); return { n: made }; };
  const warm = q.warm("sol:DOPE:5", make);
  assert.equal(q.warm("sol:DOPE:5", make), warm, "a second touch reuses the one on its way");
  assert.deepEqual(await q.take("sol:DOPE:5", make), { n: 1 }, "the tap takes the touch's quote");
  assert.equal(made, 1);
  assert.deepEqual(await q.take("sol:DOPE:5", make), { n: 2 }, "taken once: the next tap gets its own");
  // an old one (past CHIP_QUOTE_MS: the core's check of its bytes is kept 10 s) is got again
  void q.warm("sol:DOPE:5", make);
  t += CHIP_QUOTE_MS + 1;
  assert.deepEqual(await q.take("sol:DOPE:5", make), { n: 4 });
  // a quote that failed is never kept: the tap asks again and says its own refusal
  fail = true;
  await q.warm("sol:X:5", make).catch(() => undefined);
  fail = false;
  assert.deepEqual(await q.take("sol:X:5", make), { n: 6 });
  // another amount or coin is another quote
  assert.notEqual(q.warm("sol:DOPE:25", make), q.warm("sol:DOPE:5", make));
});

test("QA 16's guards (7 Nov): one quote in flight per coin; a touch that became a scroll forgets its quote; a quote that lands after its tap signed with another is never the next tap's", async () => {
  const q = createChipQuotes(() => 0);
  let made = 0;
  const slow: ((v: { n: number }) => void)[] = [];
  const make = () => { made++; const n = made; return new Promise<{ n: number }>((res) => slow.push(() => res({ n }))); };
  const a = q.warm("sol:DOPE:5", make);
  q.warm("sol:DOPE:5", make);
  q.warm("sol:DOPE:5", make);
  assert.equal(made, 1, "one in flight per coin, however many touches");
  q.drop("sol:DOPE:5");
  const tap = q.take("sol:DOPE:5", make);
  assert.notEqual(tap, a, "after a cancel the tap gets its own quote");
  assert.equal(made, 2);
  slow[0]!({ n: 1 });
  slow[1]!({ n: 2 });
  assert.deepEqual(await tap, { n: 2 });
  // the first quote landed after the tap took another: the next tap never gets it
  const next = q.take("sol:DOPE:5", make);
  assert.equal(made, 3);
  slow[2]!({ n: 3 });
  assert.deepEqual(await next, { n: 3 });
});

test("the chip warms its quote on pointerdown and focus, forgets it on pointercancel, and the tap takes it", () => {
  assert.match(src, /onPointerDown=\{warm\} onFocus=\{warm\} onPointerCancel=\{cancel\}/);
  assert.match(src, /const cancel = \(\) => chipQuotes\.drop\(key\);/);
  assert.match(src, /const p = await chipQuotes\.take\(key, \(\) => quoteNow\(quick\)\);/);
  assert.doesNotMatch(src, /await svc\.quote\("buy", r\.chain, r\.address, \{ usd: quick \}\);\n\s+await p\.ready\(\);/, "never quoted and built after the tap any more");
});

test("the job is made at the tap, before any network answer; its title is the ask", () => {
  const press = src.slice(src.indexOf("const press = async"), src.indexOf("const rec = await svc.trade(p, `chip:"));
  const publish = press.indexOf("tasks?.publish({ id: taskId, title: `Buy $${quick} of ${r.symbol}`");
  assert.ok(publish > 0, "published in press");
  assert.ok(publish < press.indexOf("await chipQuotes.take"), "before the quote is awaited");
  // control: a chain short of the Quick buy amount is refused on the row before anything (no job for nothing)
  assert.ok(press.indexOf("if (ready !== undefined && ready < quick)") < publish);
});
