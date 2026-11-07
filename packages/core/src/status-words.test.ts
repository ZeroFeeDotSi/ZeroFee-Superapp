// Settings → Status in words (rule 9b, 9a): one line per row at rest; a row says more only when it isn't the usual (the
// public servers it is on, and when Down whether money can still move); the Settings row's summary; "Checked 8:15 am".
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_IDS, type StatusRow } from "./status-probe.ts";
import { DOWN_WORDS, PARTLY_DOWN, PARTLY_WORDS, STATUS_NAMES, checkedWords, rowLines, shownWord, usingDefault, usingLine } from "./status-words.ts";
import { SUMMARY_ALL, SUMMARY_CHECKING, SUMMARY_NOT_CHECKED, statusSummary } from "./status-summary.ts";
import { bannedIn } from "../../../tools/copy/voice.ts";

const row = (id: StatusRow["id"], state: StatusRow["state"], via: StatusRow["via"] = "relay"): StatusRow => ({ id, state, via, ms: 100 });

test("at rest a row is one line: Working through ZeroFee's server says nothing under it", () => {
  for (const id of STATUS_IDS) assert.deepEqual(rowLines(row(id, "working"), true), [], id);
  for (const id of STATUS_IDS) assert.deepEqual(rowLines(row(id, "slow"), true), [], `${id} slow`);
});

test("Down says whether money can still move, by name, for every service", () => {
  for (const id of STATUS_IDS) {
    const [line] = rowLines(row(id, "down"), true);
    assert.equal(line, DOWN_WORDS[id]);
    assert.match(line!, /\b(wait|works?|moves|stays|can't be traded)\b/, `${id}: ${line}`);
  }
  assert.equal(DOWN_WORDS.near, "Payments wait. Your money stays in your Safe.");
  assert.equal(DOWN_WORDS.solana, "pump.fun and Solana trades wait. Your Safe and sending on NEAR work.");
});

test("what it is using: the sheet says ZeroFee's server once; a row on public servers says whose", () => {
  assert.equal(usingDefault(true), "Using ZeroFee's server");
  assert.equal(usingDefault(false), "Using each service's public servers");
  assert.equal(usingLine(row("near", "working", "public"), true), "Using NEAR's public servers");
  assert.equal(usingLine(row("hood", "working", "public"), true), "Using Robinhood Chain's public servers");
  assert.equal(usingLine(row("near", "working", "relay"), true), null);
  assert.equal(usingLine(row("near", "working", "public"), false), null, "no relay: the sheet's own first line says it");
  assert.deepEqual(rowLines(row("solana", "down", "public"), true), ["Using Solana's public servers", DOWN_WORDS.solana]);
});

test("Checked 8:15 am, on the device's clock", () => {
  const at = new Date(2026, 10, 8, 8, 15).getTime();
  assert.equal(checkedWords(at, "en-US"), "Checked 8:15 am");
  assert.equal(checkedWords(new Date(2026, 10, 8, 20, 5).getTime(), "en-US"), "Checked 8:05 pm");
  assert.match(checkedWords(at, "en-GB"), /^Checked 0?8:15$/);
});

test("the Settings row: Checking… until the look answered, then All working, or the worst one by name (QA 16's SHOULD)", () => {
  const rep = (states: StatusRow["state"][]) => ({ at: 0, relay: true, rows: states.map((s, i) => row(STATUS_IDS[i]!, s)) });
  assert.equal(statusSummary(null), SUMMARY_CHECKING);
  assert.equal(statusSummary("failed"), SUMMARY_NOT_CHECKED);
  assert.equal(statusSummary({ value: null } as never), SUMMARY_NOT_CHECKED, "a stand-in's answer is no look");
  assert.equal(statusSummary(rep(["working", "working"])), SUMMARY_ALL);
  // rows in STATUS_IDS order: relay, near, solana, hood, …
  assert.equal(statusSummary(rep(["working", "down"])), "NEAR down");
  assert.equal(statusSummary(rep(["working", "working", "down"])), "Solana down");
  assert.equal(statusSummary(rep(["slow", "slow", "working"])), "ZeroFee's server slow +1");
  assert.equal(statusSummary(rep(["slow", "working", "down", "down"])), "Solana down +2", "a down one before a slow one, the rest counted");
  const partly = { at: 0, relay: true, rows: [{ ...row("relay", "working"), doors: { data: "working" as const, chains: "down" as const } }, row("near", "working")] };
  assert.equal(statusSummary(partly), "ZeroFee's server partly down");
  // the Sim's ?fault=solana:521: the server partly down (its chain door) and Solana down: Solana is named
  assert.equal(statusSummary({ ...partly, rows: [partly.rows[0]!, row("near", "working"), row("solana", "down")] }), "Solana down +1");
});

test("the house style: no banned word in any line the sheet can show (servers, never nodes or RPC; never relay)", () => {
  const lines = [
    ...Object.values(STATUS_NAMES), ...Object.values(DOWN_WORDS), usingDefault(true), usingDefault(false),
    ...STATUS_IDS.flatMap((id) => [usingLine(row(id, "working", "public"), true) ?? ""]).filter(Boolean),
  ];
  for (const l of lines) assert.deepEqual(bannedIn("packages/core/src/status-words.ts", l).map((b) => b.word), [], l);
  assert.ok(lines.every((l) => !/\b(relay|nodes?|RPC)\b/i.test(l)));
});

test("QA 16's MUSTs: a row with a door Down says Partly down and counts as down; Robinhood Chain by its name, never a code", () => {
  const relay: StatusRow = { id: "relay", state: "working", via: "direct", ms: 100, doors: { data: "working", chains: "down" } };
  assert.equal(shownWord(relay), PARTLY_DOWN);
  assert.deepEqual(rowLines(relay, true), [PARTLY_WORDS]);
  assert.equal(statusSummary({ at: 0, relay: true, rows: [relay] }), "ZeroFee's server partly down");
  assert.equal(shownWord({ ...relay, doors: { data: "working", chains: "working" } }), "Working");
  assert.equal(shownWord({ ...relay, state: "down" }), "Down");
  assert.equal(STATUS_NAMES.hood, "Robinhood Chain");
  assert.ok(Object.values(STATUS_NAMES).concat(Object.values(DOWN_WORDS)).every((w) => !/\(RH\)/.test(w)));
});
