// J2-5 (the audit's MUST, 8 Nov): Send's "ready" figure is under Home's for a Safe coin, and the From list says where the rest
// is by its REAL place (send-sources.ts restOf): one send pays from ONE of NEAR Intents, the account, or Private.
import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.deepEqual(Object.keys(REST_WORDS), ["private", "elsewhere", "staked"], "no fees branch");
  assert.equal(restLine({ ...s, rest: { privateUsd: 0, elsewhereUsd: 0, stakedUsd: 0 } }), null, "control: nothing to say");
});
