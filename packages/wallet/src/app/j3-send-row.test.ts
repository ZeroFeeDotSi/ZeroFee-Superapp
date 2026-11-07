// J3-4 (the copy review's walk, 8 Nov, A-40): Activity's Send row read "Send $25.00 to 0x7D06e2…547e3D" then "From your Safe · to
// 0x529084… 169EE7". The row's title carries the address once, 4+4 ("0x7D06…7e3D", never wrapping); its line is where it
// left from only; the page keeps the 6+6. Fails on main: the 6+6 title and no line. Controls: a name stays whole; a Send
// that came back keeps its back line; the page's track keeps 6+6.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Movement, Token } from "../types.ts";
import { rowPayee, sendJobOf, sendRowOf } from "./activity-rows.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKENS = new Map<string, Token>([[USDC, { id: USDC, symbol: "USDC", decimals: 6, priceUsd: 1 } as Token]]);
const ADDR = "0x5290845c3C2e5D7aF8B1bD3E4f6A7c8D9E169EE7";
/** The sim clock's own start (sim-clock.ts: now = 0): never the wall clock, never a fixed date. */
const T = 0;
const iso = (ms: number) => new Date(ms).toISOString();
const send = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:s1", kind: "pay", status: "done", from: USDC, to: ADDR, amount: "25", startedAtIso: iso(T), updatedAtIso: iso(T + 20_000), explorerUrls: ["https://nearblocks.io/txns/abc"], private: true, ...o } as Movement);

test("J3-4: a Send's row is \"Send $25.00 to 0x7D06…7e3D\" over \"From your Safe\"; the page keeps the 6+6; control: a name, a refund", () => {
  const row = sendRowOf(send(), "$25.00", TOKENS);
  assert.deepEqual(row, { title: "Send $25.00 to 0x7D06…7e3D", usd: "$25.00", line: "From your Safe" }, "fails on main: the 6+6 title, the address again on the line");
  assert.equal(sendJobOf(send(), TOKENS, "$25.00")?.title.includes("0x7D06e2…547e3D"), true, "control: the page keeps the 6+6");
  assert.equal(sendRowOf(send({ id: "pocket-send:s2" }), "$25.00", TOKENS)?.line, "From Private", "paid from Private: its place");
  assert.deepEqual(sendRowOf(send({ to: "bob.near" }), "$25.00", TOKENS), { title: "Send $25.00 to bob.near", usd: "$25.00", line: "From your Safe" }, "control: a name stays whole");
  assert.equal(sendRowOf(send({ status: "refunded" }), "$25.00", TOKENS)?.line, "Came back to Private.", "control: a refund keeps its own line");
  assert.equal(sendRowOf(send({ status: "moving" }), "$25.00", TOKENS)?.line, undefined, "control: a Send still going keeps its state line");
});

test("J3-4: rowPayee is the 6+6 form's own ends, 4+4 (0x kept); a name as it is", () => {
  const table: [string, string][] = [["0x7D06e2…547e3D", "0x7D06…7e3D"], ["7xKXtg…cYgAsU", "7xKX…gAsU"], ["bob.near", "bob.near"], ["kiosk.near on NEAR", "kiosk.near on NEAR"]];
  for (const [full, short] of table) assert.equal(rowPayee(full), short, full);
});
