// QA (3 Nov, fresh-account walk): Activity listed a $10 Swap from your private balance into the SOL row as "Paid · 0.09 USDC from
// Hidden · with" ($0.10): the demo recorded the SOL out-amount under the USDC it was paid with, and no payee. The real
// ledger records what left, in the coin that left, and who got it. Known answers per Activity kind, read the way Activity
// (describe) and the Statement (ledgerRow, summaryLine) read the real ledger's movements; each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chain, Movement, Token } from "../types.ts";
import { describe, movementDollars, ownRows } from "./format.ts";
import { ledgerRow, statementRows, summaryLine } from "./statement.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const ETH = "nep141:hood.omft.near";
const tok = (id: string, symbol: string, decimals: number, priceUsd: string): Token => ({ id, symbol, name: symbol, icon: "", chain: "near", decimals, priceUsd } as unknown as Token);
const TOKENS = new Map<string, Token>([[USDC, tok(USDC, "USDC", 6, "1")], [SOL, tok(SOL, "SOL", 9, "101.75")], [ETH, tok(ETH, "ETH", 18, "3000")], ["nep141:wrap.near", tok("nep141:wrap.near", "wNEAR", 24, "2.5")]]);
const CHAINS = [{ id: "btc", name: "Bitcoin" }] as unknown as Chain[];
const at = (day: number) => new Date(2026, 10, day, 12, 0).toISOString();
const mv = (o: Partial<Movement> & Pick<Movement, "id" | "kind">): Movement => ({ status: "done", amount: "1", startedAtIso: at(3), updatedAtIso: at(3), explorerUrls: [], ...o } as Movement);

const MY_SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MY_ETH = "0x5A3E00000000000000000000000000000000C0Fe";
const THEIR_SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OWN = ownRows([{ role: "chain", network: "sol", address: MY_SOL }, { role: "chain", network: "hood", address: MY_ETH }, { role: "site", network: "sol", address: THEIR_SOL }, { role: "hub", network: "near", address: "a1".repeat(32) }]);

// As the real ledger records each (packages/wallet/src/ledger.ts): the coin and amount that left, and the payee
const SWAP = mv({ id: "pay:x", kind: "pay", from: USDC, to: MY_SOL, amount: "10.02", private: true, caller: "wallet", updatedAtIso: at(4) });
const HIDDEN_PAY = mv({ id: "pay:y", kind: "pay", from: USDC, to: "bob.near", amount: "5", private: true, caller: "wallet", updatedAtIso: at(5) });
const HIDDEN_ADDR = mv({ id: "pay:z", kind: "pay", from: USDC, to: THEIR_SOL, amount: "7.5", private: true, caller: "wallet", updatedAtIso: at(6) });
const ROW_HIDDEN = mv({ id: "hidden-row:abc", kind: "pay", from: SOL, to: THEIR_SOL, amount: "0.0515", private: true, caller: "wallet", updatedAtIso: at(7) });
const KIOSK = mv({ id: "pay:k", kind: "pay", from: USDC, to: "kiosk.near", amount: "4.2", label: "Kiosk", caller: "pay", updatedAtIso: at(8) });
const SENT = mv({ id: "transfer:s", kind: "transfer", from: USDC, to: "kim.near", amount: "18", caller: "wallet", updatedAtIso: at(9) });
const OUT = mv({ id: "withdraw:w", kind: "withdraw", from: SOL, to: `${THEIR_SOL} on Solana`, amount: "0.25", caller: "wallet", updatedAtIso: at(10) });
const IN = mv({ id: "deposit:d", kind: "deposit", from: "btc", to: USDC, amount: "42.1", updatedAtIso: at(2) });
const TO_HIDDEN = mv({ id: "private:p", kind: "private", from: USDC, to: "private", amount: "40", updatedAtIso: at(11) });
const FROM_HIDDEN = mv({ id: "home:h", kind: "private", from: "private", to: USDC, amount: "12.5", updatedAtIso: at(12) });
const TOP_UP = mv({ id: "trading:t", kind: "trading", from: USDC, to: "trading", amount: "10", updatedAtIso: at(13) });
const CONVERT = mv({ id: "convert:c", kind: "convert", from: SOL, to: USDC, amount: "0.5", updatedAtIso: at(14) });

test("each Activity kind reads the coin that moved, with its own amount and dollars (known answers)", () => {
  const rows: [Movement, string, string, string | null][] = [
    [HIDDEN_PAY, "Sent", "From Private · to bob.near", "$5.00"],
    [HIDDEN_ADDR, "Sent", "From Private · to 13Qkxh…r6gjRK", "$7.50"],
    [ROW_HIDDEN, "Sent", "From your SOL wallet · to 13Qkxh…r6gjRK", "$5.24"],
    [KIOSK, "Paid · Kiosk", "to kiosk.near", "$4.20"],
    [SENT, "Sent", "to kim.near", "$18.00"],
    [OUT, "Sent", "to 13Qkxh…r6gjRK", "$25.44"],
    [IN, "Received", "42.1 USDC from Bitcoin · in your Safe", "$42.10"],
    [TO_HIDDEN, "Moved to Private", "Into Private from your Safe.", "$40.00"],
    [FROM_HIDDEN, "Moved out of Private", "in your Safe", "$12.50"],
    [TOP_UP, "Moved $10.00 to your NEAR wallet", "10.00 USDC · in your NEAR wallet", null],
    [CONVERT, "Converted", "0.5 SOL to USDC · in your Safe", "$50.88"],
  ];
  for (const [m, title, detail, usd] of rows) {
    assert.deepEqual(describe(m, TOKENS, CHAINS, OWN), { title, detail }, m.id);
    assert.equal(movementDollars(m, TOKENS), usd, `${m.id} dollars`);
  }
});

test("the $10 Swap from your private balance into my own SOL row: 10.02 USDC moved to my SOL row, $10.02, never 0.09 USDC or a payment; control: the demo's old record reads $0.10", () => {
  assert.deepEqual(describe(SWAP, TOKENS, CHAINS, OWN), { title: "Moved to your SOL wallet", detail: "From Private." }, "the copy review's words, 7 Nov");
  assert.equal(movementDollars(SWAP, TOKENS), "$10.02");
  assert.deepEqual(describe({ ...SWAP, status: "moving" }, TOKENS, CHAINS, OWN), { title: "Moving to your SOL wallet", detail: "From Private · on its way to your SOL wallet" });
  // an EVM row matched in any case
  assert.equal(describe({ ...SWAP, to: MY_ETH.toLowerCase() }, TOKENS, CHAINS, OWN).title, "Moved to your Robinhood wallet");
  // control: the demo's old record (SOL's out-amount under USDC, no payee) is the bug as QA saw it
  const old = { ...SWAP, amount: "0.09828010", to: undefined } as Movement;
  assert.deepEqual(describe(old, TOKENS, CHAINS, OWN), { title: "Sent", detail: "From Private" });
  assert.equal(movementDollars(old, TOKENS), "$0.10");
  // control: a site's own wallet is not one of my rows, and with no rows known it is a send
  assert.equal(describe({ ...SWAP, to: THEIR_SOL }, TOKENS, CHAINS, OWN).title, "Sent");
  assert.equal(describe(SWAP, TOKENS, CHAINS).title, "Sent");
});

test("a record with no payee never ends on a bare \"with\"; control: with a payee it says who", () => {
  const none = describe({ ...HIDDEN_PAY, to: undefined } as Movement, TOKENS, CHAINS);
  assert.equal(none.detail, "From Private");
  assert.doesNotMatch(none.detail, /(with|to)\s*$|·\s*$/);
  assert.equal(describe({ ...HIDDEN_PAY, to: undefined, status: "moving" } as Movement, TOKENS, CHAINS).detail, "From Private · on its way");
  assert.match(describe(HIDDEN_PAY, TOKENS, CHAINS).detail, /to bob\.near$/);
});

test("the Statement per kind: coin, amount, dollars at the time and which way; a swap into my own row is not \"went out\" (control: without my rows known it is)", () => {
  const row = (m: Movement, own: typeof OWN | null = OWN) => { const r = ledgerRow(m, TOKENS, CHAINS, own ?? undefined)!; return [r.coin, r.amount, r.dollars, r.from, r.to, r.way]; };
  assert.deepEqual(row(SWAP), ["USDC", "10.02", "10.02", "Private", `Your SOL wallet (${MY_SOL})`, 0], "where it went, whole");
  assert.deepEqual(row(SWAP, null), ["USDC", "10.02", "10.02", "Private", MY_SOL, -1], "control");
  assert.deepEqual(row(HIDDEN_PAY), ["USDC", "5", "5.00", "Private", "bob.near", -1]);
  assert.deepEqual(row(ROW_HIDDEN), ["SOL", "0.0515", "", "SOL wallet", THEIR_SOL, -1], "it left the SOL wallet (audit, 7 Nov)");
  assert.deepEqual(row(KIOSK), ["USDC", "4.2", "4.20", "Safe", "kiosk.near", -1]);
  assert.deepEqual(row(SENT), ["USDC", "18", "18.00", "Safe", "kim.near", -1]);
  assert.deepEqual(row(OUT), ["SOL", "0.25", "", "Safe", `${THEIR_SOL} on Solana`, -1]);
  assert.deepEqual(row(IN), ["USDC", "42.1", "42.10", "Bitcoin", "Safe", 1]);
  assert.deepEqual(row(TO_HIDDEN), ["USDC", "40", "40.00", "Safe", "Private", 0]);
  assert.deepEqual(row(FROM_HIDDEN), ["USDC", "12.5", "12.50", "Private", "Safe", 0]);
  assert.deepEqual(row(TOP_UP), ["USDC", "10", "10.00", "Safe", "NEAR wallet", 0]);
  assert.deepEqual(row(CONVERT), ["SOL", "0.5", "", "Safe", "Safe, as USDC", 0]);
});

test("the Statement's total: what went out is the payments, never the swap into my own row, never the swap read as $0.10 (control: the old record's total)", () => {
  const month = [SWAP, HIDDEN_PAY, KIOSK, SENT, IN];
  assert.equal(summaryLine(statementRows(month, [], TOKENS, CHAINS, 2026, 10, OWN), 2026, 10), "5 moves in November 2026. $42.10 came in, $27.20 went out.");
  const old = [{ ...SWAP, amount: "0.09828010", to: undefined } as Movement, HIDDEN_PAY, KIOSK, SENT, IN];
  assert.equal(summaryLine(statementRows(old, [], TOKENS, CHAINS, 2026, 10, OWN), 2026, 10), "5 moves in November 2026. $42.10 came in, $27.30 went out.", "control: QA's $27.30");
});

test("own-row matching: the network a record names must be the row's; an address two rows share, with no network named, is neither (controls: the demo's sample send \"on Base\", and the same address on BNB Chain)", () => {
  const SAME = "0x5a3E000000000000000000000000000000005a3E";
  const own = ownRows([{ role: "chain", network: "bsc", address: SAME }, { role: "chain", network: "hood", address: SAME }, { role: "chain", network: "sol", address: MY_SOL }]);
  const send = (to: string) => describe(mv({ id: "w", kind: "withdraw", from: USDC, to, amount: "18" }), TOKENS, CHAINS, own).title;
  assert.equal(send(`${SAME} on Base`), "Sent", "Base is not a row");
  assert.equal(send(`${SAME} on BNB Chain`), "Moved to your BNB wallet", "control: the same address on BNB Chain is the BNB row");
  assert.equal(send(`${SAME.toLowerCase()} on Robinhood Chain`), "Moved to your Robinhood wallet");
  assert.equal(send(SAME), "Sent", "two rows share it and no network is named: neither");
  // review L1: a bare address (no network named) counts only for a Hidden payment; a plain one to the row's own address
  // could be on another chain the same key reaches
  assert.equal(describe(mv({ id: "w", kind: "withdraw", from: USDC, to: MY_SOL, amount: "1" }), TOKENS, CHAINS, own).title, "Sent");
  assert.equal(describe(mv({ id: "w", kind: "pay", from: USDC, to: MY_SOL, amount: "1", private: true, caller: "wallet" }), TOKENS, CHAINS, own).title, "Moved to your SOL wallet", "control: Hidden's");
  assert.equal(send(`${MY_SOL} on Solana`), "Moved to your SOL wallet");
  assert.equal(send(`${MY_SOL} on Ethereum`), "Sent");
  const row = ledgerRow(mv({ id: "w", kind: "withdraw", from: USDC, to: `${SAME} on Base`, amount: "18", updatedAtIso: at(4) }), TOKENS, CHAINS, own)!;
  assert.equal(row.way, -1, "the Statement counts it as went out");
});
