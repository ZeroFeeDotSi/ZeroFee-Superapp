import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { balanceTotal, privateAllUsd, privateWhole, safeLines } from "../format.ts";
import { moveHead, safeRowFigure } from "../one-total.ts";
import { placesNow, totalOf } from "./move-split.ts";
import type { Balance, PrivatePocket } from "../../types.ts";

// the audit's S2 (7 Nov): old-wallet money gave Private two figures. Home and the Private page count it (privateAllUsd), the Move
// sheet's Private row didn't (privateFigure), and the gap landed in "Not moved" as "coins in your wallets".
const row = (tokenId: string, symbol: string, amount: string, usd: string, held: Balance["held"]): Balance => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", amount, usd, bridged: false, held, listed: true });
const SAFE = [row("usdc", "USDC", "100", "100", "ledger")];
const POCKET: PrivatePocket = { available: true, ready: true, rows: [row("usdc", "USDC", "15", "15", "private")], defaultOn: false,
  oldWords: { rows: [row("usdc", "USDC", "7.5", "7.5", "private")], moving: false, stuck: false, left: false } };

test("the audit's S2: the Move sheet's Private row is Home's Private figure (old wallets' money in it), and nothing lands in Not moved", () => {
  const whole = privateWhole(POCKET)!;
  assert.deepEqual(whole, { usd: 22.5, oldUsd: 7.5 });
  assert.equal(whole.usd.toFixed(2), privateAllUsd(POCKET), "the Private page's figure");
  // the sheet's places as MoveSheet builds them: Home's Safe figure (safeLines) plus the old wallets' part, Private whole
  const safeUsd = Number(safeLines(SAFE, POCKET, []).totalUsd);
  const places = placesNow({ safeUsd: safeUsd + whole.oldUsd, safeMostUsd: 100, privateUsd: whole.usd, privateMostUsd: 15, networks: [] });
  assert.equal(places.find((p) => p.place === "private")!.usd, 22.5, "Private's row");
  assert.equal(places.find((p) => p.place === "safe")!.usd, 100, "the Safe's own coins, unchanged");
  assert.equal(safeRowFigure(100, 22.5).toFixed(2), balanceTotal(SAFE, [], [], POCKET), "the Safe's row is Home's Safe pill, old wallets' money in it");
  const head = moveHead(balanceTotal(SAFE, [], [], POCKET, "0"), totalOf(places), []);
  assert.deepEqual(head, { total: 122.5, outside: null }, "no \"coins in your wallets\" row for Private's own money");
  // control: no old wallets, the same figure as before
  assert.deepEqual(privateWhole({ ...POCKET, oldWords: undefined } as never), { usd: 15, oldUsd: 0 });
  assert.equal(privateWhole({ ...POCKET, ready: false }), null, "not read: no figure");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const privParts = useMemo\(\(\) => privateWhole\(pocket\), \[pocket\]\);/);
  assert.match(sheet, /placesNow\(\{ safeUsd: safeUsd === null \? null : Number\(safeUsd\) \+ oldUsd,/);
});
