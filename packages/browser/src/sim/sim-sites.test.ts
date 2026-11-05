// The Sim's simulated sites (sites-data.ts): every coin is complete and made up, no person is named, and the Sim flag
// alone turns the pages on (the real app, and the phone, keep their real window).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GMGN_TRENCHES, PUMP_BOARDS, SIM_HISTORY, SIM_SITE_COINS, SIM_SITE_WORDS, coinsInTrench, coinsOnBoard, simSiteKind, simSitesOn, sparkOf, sparkPath } from "./sites-data.ts";

test("every coin has every field, a sample id the Sim's bridge accepts, and sane numbers", () => {
  assert.ok(SIM_SITE_COINS.length >= 8 && SIM_SITE_COINS.length <= 12);
  const ids = new Set<string>();
  for (const c of SIM_SITE_COINS) {
    assert.match(c.token, /^sim-[a-z0-9]{2,12}$/, c.token);
    assert.ok(!ids.has(c.token), `unique ${c.token}`);
    ids.add(c.token);
    for (const k of ["symbol", "name", "line"] as const) assert.ok(typeof c[k] === "string" && c[k].length > 0, `${c.token}.${k}`);
    for (const k of ["priceUsd", "capUsd", "changePct", "curvePct", "ageMin", "replies", "holders", "volUsd", "hue"] as const) assert.ok(Number.isFinite(c[k]), `${c.token}.${k}`);
    assert.ok(c.priceUsd > 0 && c.capUsd > 0 && c.curvePct >= 0 && c.curvePct <= 100);
    assert.ok(PUMP_BOARDS.some((b) => b.id === c.board) && GMGN_TRENCHES.some((t) => t.id === c.trench));
  }
  for (const b of PUMP_BOARDS) assert.ok(coinsOnBoard(b.id).length > 0, `board ${b.id} has coins`);
  for (const t of GMGN_TRENCHES) assert.ok(coinsInTrench(t.id).length > 0, `trench ${t.id} has coins`);
});

test("made up: no real coin's name or ticker, no person's name, no real person's handle", () => {
  const real = /\b(bonk|wif|dogwifhat|popcat|pepe|doge|shib|trump|melania|elon|musk|fartcoin|pnut|goat|moodeng|jup|ray|sol|usdc)\b/i;
  const people = /\b(elon|musk|trump|melania|vitalik|buterin|saylor|cz|sbf|toly|yakovenko|alon|cohen|kanye|biden|obama|@\w+)\b/i;
  const words = [...SIM_SITE_COINS.flatMap((c) => [c.name, c.symbol, c.line]), ...Object.values(SIM_SITE_WORDS).filter((w): w is string => typeof w === "string")];
  for (const w of words) {
    assert.doesNotMatch(w, real, w);
    assert.doesNotMatch(w, people, w);
  }
  // History's sample rows are hosts only
  for (const h of SIM_HISTORY) assert.match(h.host, /^[a-z0-9.-]+\.[a-z]+$/);
});

test("the Sim flag gates it: on in the public Sim and the demo page in a browser; off in the real app and on the phone", () => {
  assert.equal(simSitesOn({ sim: true, demo: true, phone: false }), true);
  assert.equal(simSitesOn({ sim: false, demo: true, phone: false }), true);
  assert.equal(simSitesOn({ sim: false, demo: false, phone: false }), false);
  assert.equal(simSitesOn({ sim: false, demo: true, phone: true }), false);
  // under node: no page, no ?demo: off
  assert.equal(simSitesOn(), false);
});

test("pump.fun opens the board, GMGN the trenches, anything else a plain page", () => {
  assert.equal(simSiteKind("pump"), "pump");
  assert.equal(simSiteKind("gmgn"), "gmgn");
  assert.equal(simSiteKind("axiom"), "web");
  assert.equal(simSiteKind(undefined), "web");
});

test("the drawn price walk is stable and inside its box", () => {
  const c = SIM_SITE_COINS[0]!;
  assert.deepEqual(sparkOf(c), sparkOf(c));
  for (const p of sparkOf(c)) assert.ok(p >= 0 && p <= 1);
  assert.match(sparkPath(sparkOf(c, 4), 40, 20), /^M0\.0 [\d.]+ L/);
});
