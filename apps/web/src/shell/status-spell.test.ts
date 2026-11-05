// QA's crawl (5 Nov, the bundle): the banner's "since" jumped six times in 10 min,
// and "busy since <a time>" and "slow since <a time>" showed in the same second. One spell, one clock (StatusBanner nextSpell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ServiceStatus } from "@zerofee/core/services";
import { CLEAR_MS, nextSpell, type Spell } from "./status-spell.ts";

const T0 = Date.parse("2026-11-04T16:41:00Z");
const MIN = 60_000;
const row = (service: ServiceStatus["service"], state: ServiceStatus["state"], sinceMin: number): ServiceStatus => ({ service, state, since: new Date(T0 + sinceMin * MIN).toISOString(), seen: "both" });

/** Reads every 30 s; returns what each read shows: "<service> <state> <start minute>" or "back <service>" or "". */
function run(reads: ServiceStatus[][], clearMs = CLEAR_MS): string[] {
  let spell: Spell | null = null;
  return reads.map((list, i) => {
    const r = nextSpell(spell, list, T0 + i * 30_000, clearMs);
    spell = r.spell;
    return r.back ? `back ${r.back}` : spell ? `${spell.row.service} ${spell.state} ${(spell.start - T0) / MIN}` : "";
  });
}

test("the crawl's 10 minutes: busy/slow flips and a new 'since' every read keep one clock, the first one", () => {
  const sinceEach = [0, 1, 4, 7, 9, 10];
  const reads = sinceEach.map((m, i) => [row("near", i % 2 ? "slow" : "busy", m)]);
  const out = run(reads);
  assert.deepEqual(new Set(out.map((x) => x.split(" ")[2])), new Set(["0"]), `one clock: ${out.join(" | ")}`);
  // the worse state wins and never flips back within the spell
  assert.deepEqual(out, ["near busy 0", "near slow 0", "near slow 0", "near slow 0", "near slow 0", "near slow 0"]);
});

test("two states in one read: the worse one, one line (down over slow over busy)", () => {
  assert.deepEqual(run([[row("near", "busy", -3), row("solana", "slow", -7)]]), ["solana slow -7"]);
  assert.deepEqual(run([[row("near", "slow", -7), row("solana", "down", -3)]]), ["solana down -3"]);
  assert.deepEqual(run([[row("near", "busy", -3), row("solana", "busy", -7)]]), ["near busy -3"], "equals: the one that blocks most");
  assert.deepEqual(run([[row("near", "busy", 5)]]), ["near busy 0"], "a since in the future is now");
});

test("a fine read inside the clear window keeps the spell and its clock; only a long clear says back", () => {
  const out = run([[row("near", "busy", 0)], [], [row("near", "busy", 1)], [], [], [], [], []]);
  assert.deepEqual(out.slice(0, 3), ["near busy 0", "near busy 0", "near busy 0"], "a re-read never resets it");
  assert.ok(out.includes("back near"), "control: clear for 90 s, it says back");
  assert.equal(out.indexOf("back near"), 2 + CLEAR_MS / 30_000, "90 s after the last bad read (read 2)");
  assert.deepEqual(run([[row("near", "busy", 0)], []], 0), ["near busy 0", "back near"], "control: no window, back at once");
});

test("the shown service recovers while another is still bad: that one, same clock", () => {
  assert.deepEqual(run([[row("near", "busy", 0)], [row("solana", "busy", 5)]]), ["near busy 0", "solana busy 0"]);
});

test("the notice reads its line from the spell, never the table's newest since", () => {
  const src = readFileSync(new URL("./StatusBanner.tsx", import.meta.url), "utf8");
  assert.match(src, /since: new Date\(spell\.start\)\.toISOString\(\)/);
  assert.doesNotMatch(src, /const top = rows\[0\]/, "control: the old per-read row is gone");
});
