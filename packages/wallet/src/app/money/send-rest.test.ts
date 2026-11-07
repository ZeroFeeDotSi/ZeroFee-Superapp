// J2-5 (the audit's MUST, 8 Nov): Send's "ready" figure is under Home's for a Safe coin, and the From list says where the rest
// is by its REAL place (send-sources.ts restOf): one send pays from ONE of NEAR Intents, the account, or Private.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sendSources, restOf } from "./send-sources.ts";
import { restLine, REST_WORDS } from "./send-cap.ts";
import type { Balance } from "../../types.ts";

const row = (tokenId: string, symbol: string, amount: string, usd: string, held: Balance["held"]): Balance => ({ tokenId, symbol, name: symbol, icon: "", chain: "near", amount, usd, bridged: false, held, listed: true });
// the Sim's NEAR (the copy review's shot): NEAR Intents 312.4 ($1,383.93), the account 12.5 ($55.37), Private 2 ($8.86): Home $1,448.16
const SAFE = [row("nep141:wrap.near", "NEAR", "312.4", "1383.93", "ledger"), row("near", "NEAR", "12.5", "55.37", "account")];
const POCKET = [row("nep141:wrap.near", "NEAR", "2", "8.86", "private")];

test("the NEAR row: $1,383.92 ready, and the rest named by place: Private's $8.86, the account's $55.37 elsewhere in the Safe (control: all of it can go, no line)", () => {
  const near = sendSources([], SAFE, POCKET, true).find((s) => s.symbol === "NEAR")!;
  assert.equal(near.usd, "1448.16", "Home's figure");
  assert.ok(near.rest, "a rest");
  assert.equal(restLine(near), "$8.86 more is in Private. $55.38 more is elsewhere in your Safe.", "the copy review's trim: the row says the ready figure; this only the causes");
  const total = 1383.92 + near.rest!.privateUsd + near.rest!.elsewhereUsd + near.rest!.stakedUsd;
  assert.equal(total.toFixed(2), "1448.16", "ready + the parts = Home's figure");
  const whole = sendSources([], [row("nep141:wrap.near", "NEAR", "10", "44.30", "ledger")], [], true).find((s) => s.symbol === "NEAR")!;
  assert.equal(whole.rest, undefined, "control: one place holds it all");
  assert.equal(restLine(whole), null);
});

test("a split whose paying place is Private names the Safe's places elsewhere, never Private for what pays; staked NEAR is with validators", () => {
  const r = restOf({ symbol: "NEAR", amount: 30, usd: 132.9, per: 4.43, can: 20, paysPrivate: true, thisPocket: 20, pocket: [row("nep141:wrap.near", "NEAR", "20", "88.60", "private")], earning: [{ poolId: "p", name: "P", amount: "4", usd: "17.72", state: "earning" } as never] });
  assert.deepEqual(r, { privateUsd: 0, elsewhereUsd: 26.58, stakedUsd: 17.72 });
});

test("the words by place; a part under $0.01 is left out; no fees words (audit: the account's NEAR row is already net of its storage and fee room, ledger.ts spendable)", () => {
  const s = { row: null, symbol: "NEAR", amount: "326.9", usd: "1448.16", max: "312.4" };
  assert.equal(restLine({ ...s, rest: { privateUsd: 8.86, elsewhereUsd: 0.004, stakedUsd: 0 } }), "$8.86 more is in Private.");
  assert.equal(REST_WORDS.elsewhere("$1.00"), "$1.00 more is elsewhere in your Safe.");
  assert.deepEqual(Object.keys(REST_WORDS), ["private", "elsewhere", "staked", "kept"], "no fees branch (kept: the round sum's gap, QA 16 7 Nov)");
  assert.equal(restLine({ ...s, rest: { privateUsd: 0, elsewhereUsd: 0, stakedUsd: 0 } }), null, "control: nothing to say");
});

test("QA 20 (8 Nov, B+): the line under From names the rest's figure: all in Private \"Private keeps the rest · about $X\" (copy review), spread by place, else \"Your Safe keeps the rest · about $X\" (controls: a dollar coin is exact, no price says the coins, all of it can go says nothing, a wallet says nothing)", async () => {
  const { restStaysLine, REST_KEPT } = await import("./send-cap.ts");
  const near = sendSources([], SAFE, POCKET, true).find((s) => s.symbol === "NEAR")!;
  assert.equal(restStaysLine(near), "$8.86 more is in Private. $55.38 more is elsewhere in your Safe.", "spread over two places: each by its own figure, the From list's own words");
  // the copy review's exact words (8 Nov, QA 16's B+): the rest all in Private
  const inPrivate = { row: null, symbol: "NEAR", amount: "314.4", usd: "1392.79", max: "312.4", rest: { privateUsd: 8.86, elsewhereUsd: 0, stakedUsd: 0 } };
  assert.equal(restStaysLine(inPrivate), "Private keeps the rest · about $8.86");
  assert.equal(restStaysLine({ ...inPrivate, rest: { privateUsd: 8.86, elsewhereUsd: 0.004, stakedUsd: 0 } }), "Private keeps the rest · about $8.86", "a part under $0.01 elsewhere doesn't count");
  assert.equal(restStaysLine({ ...inPrivate, rest: { privateUsd: 0, elsewhereUsd: 4, stakedUsd: 0 } }), "$4.00 more is elsewhere in your Safe.", "control: none in Private, never Private's words");
  const s = { row: null, symbol: "NEAR", amount: "326.9", usd: "1448.16", max: "312.4" };
  assert.equal(restStaysLine(s), `${REST_KEPT} · about $64.23`, "14.5 NEAR at the row's price, down to the cent");
  assert.equal(restStaysLine({ row: null, symbol: "USDC", amount: "30", usd: "30", max: "12.5" }), "Your Safe keeps the rest · $17.50", "control: a dollar coin's figure is exact, no about");
  assert.equal(restStaysLine({ row: null, symbol: "ZEC", amount: "3", max: "1" }), "Your Safe keeps the rest · 2 ZEC", "control: no price, the coins");
  assert.equal(restStaysLine({ ...s, max: "326.9" }), null, "control: all of it can go");
  assert.equal(restStaysLine({ row: "sol", symbol: "SOL", amount: "1.42", usd: "201", max: "1.419" }), null, "control: a wallet keeps its fee room, no rest line");
  for (const l of [restStaysLine(near), restStaysLine(s)]) assert.match(l!, /\$[\d,]+\.\d\d/, "every rest line has its figure");
  // the From card says it once, and not while the From list (which says it per coin) is open
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const restNow = source\.privateOnly \? null : restStaysLine\(\{ \.\.\.source, max: can, rest: withKept\(source\.rest, readyUsd\(max, perCoin\), readyNow\) \}\);/);
  assert.match(form, /\{!open && restNow && <p className="zf-small wl-send2__coins" data-testid="send-rest">\{restNow\}<\/p>\}/);
  assert.doesNotMatch(form, /The rest stays in your Safe for now|REST_STAYS/, "the old figureless words are gone");
});
