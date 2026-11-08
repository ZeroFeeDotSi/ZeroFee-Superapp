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
    assert.match(line!, /\b(can't go now|can't answer|works?|moves|stays|can't be traded)\b/, `${id}: ${line}`);
  }
  assert.equal(DOWN_WORDS.near, "Payments can't go now. Your money stays in your Safe.");
  assert.equal(DOWN_WORDS.solana, "pump.fun and Solana trades can't go now. Your Safe and sending on NEAR work.");
  assert.equal(DOWN_WORDS.hood, "Robinhood Chain sends and trades can't go now. Your Safe and your other wallets work.", "Status keeps the chain's name");
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
  assert.equal(statusSummary(rep(["working", "down"])), "NEAR is down");
  assert.equal(statusSummary(rep(["working", "working", "down"])), "Solana is down");
  assert.equal(statusSummary(rep(["slow", "slow", "working"])), "2 services have trouble");
  assert.equal(statusSummary(rep(["slow", "working", "down", "down"])), "3 services have trouble", "more than one: their count (B12)");
  const partly = { at: 0, relay: true, rows: [{ ...row("relay", "working"), doors: { data: "working" as const, chains: "down" as const } }, row("near", "working")] };
  assert.equal(statusSummary(partly), "ZeroFee's server is partly down");
  // the Sim's ?fault=solana:521: the server partly down (its chain door) and Solana down: Solana is named
  assert.equal(statusSummary({ ...partly, rows: [partly.rows[0]!, row("near", "working"), row("solana", "down")] }), "2 services have trouble");
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
  assert.equal(statusSummary({ at: 0, relay: true, rows: [relay] }), "ZeroFee's server is partly down");
  assert.equal(shownWord({ ...relay, doors: { data: "working", chains: "working" } }), "Working");
  assert.equal(shownWord({ ...relay, state: "down" }), "Down");
  assert.equal(STATUS_NAMES.hood, "Robinhood Chain");
  assert.ok(Object.values(STATUS_NAMES).concat(Object.values(DOWN_WORDS)).every((w) => !/\(RH\)/.test(w)));
});

test("B12 (audit 11): the Settings row is a sentence and the sheet's first line agrees with its rows [before: \"Solana down +1\", \"Using ZeroFee's server\" over a partly down server]", () => {
  const relay = { id: "relay", state: "working", via: "relay", ms: 80, doors: { data: "working", chains: "down" } } as never;
  const sol = { id: "solana", state: "down", via: "public", ms: null } as never;
  assert.equal(statusSummary({ at: 0, relay: true, rows: [sol] }), "Solana is down");
  assert.equal(statusSummary({ at: 0, relay: true, rows: [relay, sol] }), "2 services have trouble");
  assert.equal(usingDefault(true, [relay, sol]), "Using public servers for the chains");
  assert.equal(usingDefault(true, [{ id: "relay", state: "down", via: "public", ms: null } as never]), "Using each service's public servers");
  assert.equal(usingDefault(true, [{ id: "relay", state: "working", via: "relay", ms: 80, doors: { data: "working", chains: "working" } } as never]), "Using ZeroFee's server", "control: all well");
  assert.doesNotMatch(PARTLY_WORDS, /Money still moves/);
});

// Audit 12 C6: the banner said "Swaps and moves wait." while the Swap sheet under it said "can't go now": two stories, and
// nothing waited. Every down line says what can't go now; none says "wait" for a thing that won't queue.
test("C6: no down line says \"wait\"; each says what can't go now, as the sheet does (control: the back lines say work again)", async () => {
  const { SERVICE_EFFECTS } = await import("./services.ts");
  for (const [id, e] of Object.entries(SERVICE_EFFECTS)) {
    assert.doesNotMatch(e.blocks, /\bwaits?\b/, `${id}: ${e.blocks}`);
    assert.match(e.back, /again\.$/, `${id} back: ${e.back}`);
  }
  // audit 13's D4: Send needs both, so the banner says Sends too (send-down-top.test.ts)
  assert.equal(SERVICE_EFFECTS.oneclick.blocks, "Sends, swaps, moves, Safe Buy and Sell can't go now.");
  assert.equal(SERVICE_EFFECTS.relay.blocks, "Sends, swaps, moves, Safe Buy and Sell can't go now.");
  assert.equal(SERVICE_EFFECTS.near.blocks, "Payments can't go now.");
  assert.equal(SERVICE_EFFECTS.hood.blocks, "Robinhood sends and trades can't go now.");
  for (const id of STATUS_IDS) assert.doesNotMatch(DOWN_WORDS[id], /\bwaits?\b/, id);
});
