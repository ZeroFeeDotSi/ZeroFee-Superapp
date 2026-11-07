// H-3, the statement: every move Activity shows for one month, as a CSV the person keeps; it leaves the phone only by
// their own share (QA's GO, 3 Nov). Every test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Chain, Movement, Token } from "../types.ts";
import { cell, COLUMNS, fileName, mayBeShort, monthBounds, saveStatement, statementRows, summaryLine, toCsv } from "./statement.ts";

const tok = (id: string, symbol: string, priceUsd?: string): Token => ({ id, symbol, name: symbol, icon: "", chain: "near", decimals: 6, ...(priceUsd ? { priceUsd } : {}) } as unknown as Token);
const TOKENS = new Map<string, Token>([
  ["nep141:usdc", tok("nep141:usdc", "USDC", "1")],
  ["nep141:sol", tok("nep141:sol", "SOL", "160")],
  ["nep141:btc", tok("nep141:btc", "BTC", "90000")],
  ["nep141:eth", tok("nep141:eth", "ETH", "3000")],
  ["nep141:bnb", tok("nep141:bnb", "BNB", "600")],
]);
const CHAINS = [{ id: "btc", name: "Bitcoin" }, { id: "sol", name: "Solana" }] as unknown as Chain[];
// the phone's own time, mid-November
const at = (day: number, h = 12) => new Date(2026, 10, day, h, 5).toISOString();
const mv = (o: Partial<Movement> & Pick<Movement, "id" | "kind">): Movement => ({ status: "done", amount: "1", startedAtIso: at(3), updatedAtIso: at(3), explorerUrls: [], ...o } as Movement);

const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const HOOD_ADDR = "0x5a3e0000000000000000000000000000000c0ffee";
const BNB_ADDR = "0x1111222233334444555566667777888899990000";
const LEDGER: Movement[] = [
  // in: BTC (a coin only 1Click lists) from Bitcoin, plain
  mv({ id: "d1", kind: "deposit", from: "btc", to: "nep141:btc", amount: "0.00123456", updatedAtIso: at(2), explorerUrls: ["https://mempool.space/tx/abc"] }),
  // out, plain: SOL to a Solana address; ETH to Robinhood Chain; BNB; NEAR to a NEAR name
  mv({ id: "s1", kind: "transfer", from: "nep141:sol", to: `${SOL_ADDR} on Solana`, amount: "0.5", updatedAtIso: at(4) }),
  mv({ id: "s2", kind: "transfer", from: "nep141:eth", to: `${HOOD_ADDR} on Robinhood Chain`, amount: "0.01", updatedAtIso: at(5) }),
  mv({ id: "s3", kind: "transfer", from: "nep141:bnb", to: `${BNB_ADDR} on BNB Chain`, amount: "0.2", updatedAtIso: at(6) }),
  mv({ id: "s4", kind: "transfer", from: "near", to: "kim.near", amount: "3", updatedAtIso: at(7) }),
  // out, Hidden: USDC paid from Hidden; a Hidden send from the SOL row (recorded on this phone)
  mv({ id: "pay:h1", kind: "pay", from: "nep141:usdc", to: `${SOL_ADDR} on Solana`, amount: "25", private: true, updatedAtIso: at(8), caller: "wallet" }),
  mv({ id: "hidden-row:x1", kind: "transfer", from: "nep141:sol", to: `${SOL_ADDR} on Solana`, amount: "0.05", updatedAtIso: at(9) }),
  // between your own places: into Hidden; a rules change moved no money
  mv({ id: "p1", kind: "private", from: "nep141:usdc", to: "private", amount: "40", updatedAtIso: at(10) }),
  mv({ id: "a1", kind: "account", label: "Changed your day limit", amount: "", updatedAtIso: at(11) }),
  // outside the month (control for the bounds): 1 minute into December
  mv({ id: "late", kind: "transfer", from: "nep141:usdc", to: "kim.near", amount: "9", updatedAtIso: new Date(2026, 11, 1, 0, 1).toISOString() }),
];
const SPENDING: SpendingActivity[] = [
  { id: "t1", kind: "top-up", usd: "$500.00", status: "done", shown: true, atIso: at(12), words: "Topped up $500.00" },
  { id: "q1", kind: "gas", usd: "$0.40", status: "done", shown: false, atIso: at(12), words: "$0.40 to Solana, behind the scenes" },
];
const ROWS = statementRows(LEDGER, SPENDING, TOKENS, CHAINS, 2026, 10);

test("the month in the phone's own time, oldest first; control: a move one minute into the next month is not in it", () => {
  const { from, to } = monthBounds(2026, 10);
  assert.equal(new Date(from).getDate(), 1);
  assert.equal(new Date(to).getMonth(), 11);
  assert.deepEqual(ROWS.map((r) => r.date.slice(8, 10)), ["02", "04", "05", "06", "07", "08", "09", "10", "12"]);
  assert.equal(statementRows(LEDGER, [], TOKENS, CHAINS, 2026, 11).length, 1, "control: December has the late one");
});

test("§0 matrix as data: in from Bitcoin (a 1Click-only coin), out to SOL, ETH on Robinhood, BNB and a NEAR name, Plain and Hidden, full addresses", () => {
  const to = ROWS.map((r) => r.to);
  assert.ok(to.includes(`${SOL_ADDR} on Solana`), "a Solana address, whole, never shortened");
  assert.ok(to.includes(`${HOOD_ADDR} on Robinhood Chain`) && to.includes(`${BNB_ADDR} on BNB Chain`) && to.includes("kim.near"));
  assert.deepEqual(ROWS.map((r) => r.coin), ["BTC", "SOL", "ETH", "BNB", "NEAR", "USDC", "SOL", "USDC", "USDC"]);
  const btc = ROWS[0]!;
  assert.equal(btc.from, "Bitcoin");
  assert.equal(btc.to, "Safe");
  assert.equal(btc.amount, "0.00123456", "every decimal as recorded");
  assert.equal(btc.link, "https://mempool.space/tx/abc");
  // Hidden and Plain: which rows say yes
  assert.deepEqual(ROWS.filter((r) => r.hidden === "yes").map((r) => r.date.slice(8, 10)), ["08", "09", "10"]);
  assert.equal(ROWS.find((r) => r.date.slice(8, 10) === "08")!.from, "Private");
  assert.equal(ROWS.find((r) => r.date.slice(8, 10) === "04")!.from, "Safe", "control: a plain send is from the Safe");
});

test("Hidden rows come only from what this phone recorded: its own mark or its own Hidden-from-row id; control: the same send without them is plain", () => {
  const one = (m: Movement) => statementRows([m], [], TOKENS, CHAINS, 2026, 10)[0]!.hidden;
  assert.equal(one(mv({ id: "hidden-row:z", kind: "transfer", from: "nep141:sol", to: "x", updatedAtIso: at(4) })), "yes");
  assert.equal(one(mv({ id: "z", kind: "transfer", from: "nep141:sol", to: "x", updatedAtIso: at(4) })), "no");
});

test("dollars only where the move was in dollars then; control: SOL is blank even with today's price on hand", () => {
  assert.equal(ROWS.find((r) => r.coin === "USDC" && r.type.startsWith("Sent"))!.dollars, "25.00");
  assert.equal(ROWS.find((r) => r.coin === "SOL")!.dollars, "", "never priced from today's $160");
  assert.equal(ROWS.at(-1)!.dollars, "500.00", "Trading's own dollars");
  assert.equal(ROWS.at(-1)!.from, "Safe");
  assert.equal(ROWS.at(-1)!.to, "NEAR wallet");
});

test("what moved no money, and Trading's quiet moves, are left out, as Activity leaves them; control: a shown one is in", () => {
  assert.ok(!ROWS.some((r) => /day limit/.test(r.type)));
  assert.ok(!ROWS.some((r) => /behind the scenes/.test(r.type)));
  assert.ok(ROWS.some((r) => r.type === "Topped up $500.00"));
});

test("CSV: the header, one line per move, every cell quoted, and never a formula a spreadsheet would run, in any locale; control: a plain cell is only quoted", () => {
  const csv = toCsv(ROWS);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], COLUMNS.map((c) => `"${c}"`).join(","));
  assert.equal(lines.length, ROWS.length + 1);
  assert.equal(cell("a,b"), '"a,b"');
  assert.equal(cell("a;b"), '"a;b"', "a semicolon (German and French spreadsheets) never starts a new cell");
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell("two\nlines"), '"two\nlines"');
  for (const bad of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tx", "  =1+1", " @x"]) assert.match(cell(bad), /^" *'/, bad);
  assert.equal(cell("Sent"), '"Sent"');
  assert.equal(cell("0.5"), '"0.5"');
  // a label from another app can't become a formula in the file, with a comma or a semicolon before it (review M1)
  for (const label of ["=cmd|' /C calc'!A0", "x;=HYPERLINK(\"http://evil\")", "x,=1+1", " =1"]) {
    const evil = statementRows([mv({ id: "e", kind: "pay", from: "nep141:usdc", to: "shop.near", label, updatedAtIso: at(4) })], [], TOKENS, CHAINS, 2026, 10);
    const line = toCsv(evil).split("\r\n")[1]!;
    // every field is one quoted cell, so splitting on , or ; inside it never yields a cell that starts with a formula
    for (const piece of line.split(/[,;]/)) assert.doesNotMatch(piece, /^\s*"?\s*[=+@]/, `${label}: ${piece}`);
  }
});

test("a month older than a full read says it may be short; control: a read under the cap, or a month inside it, doesn't", () => {
  const many = Array.from({ length: 5 }, (_, i) => mv({ id: `m${i}`, kind: "transfer", from: "nep141:usdc", to: "x", updatedAtIso: at(10 + i) }));
  assert.equal(mayBeShort(many, 5, 2026, 9), true, "October is older than the oldest of a full read");
  assert.equal(mayBeShort(many, 6, 2026, 9), false, "control: the read wasn't full, so it has everything");
  assert.equal(mayBeShort(many, 5, 2026, 11), false, "control: December starts after the oldest move read");
});

test("the summary is dollars first and only from dollars known then; control: no moves says so", () => {
  assert.equal(summaryLine(ROWS, 2026, 10), "9 moves in November 2026. $25.00 went out.", "BTC came in with no dollars known then: never \"$0.00 came in\"");
  const usdcIn = statementRows([mv({ id: "u", kind: "deposit", from: "sol", to: "nep141:usdc", amount: "100", updatedAtIso: at(4) })], [], TOKENS, CHAINS, 2026, 10);
  assert.equal(summaryLine(usdcIn, 2026, 10), "1 move in November 2026. $100.00 came in.", "control: dollars in, said");
  assert.equal(summaryLine([], 2026, 10), "Nothing moved in November 2026.");
  assert.equal(fileName(2026, 10), "ZeroFee statement 2026-11.csv");
  assert.match(fileName(2026, 0), /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.csv$/, "the name the iPhone accepts");
});

test("save: on the iPhone only its share sheet (the person picks where), in a browser a download; control: the other way is never taken", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const bridge = (answer: BridgeResult<unknown>): Bridge => ({ async call<T>(m: string, p: Record<string, unknown> = {}) { calls.push([m, p]); return answer as BridgeResult<T>; }, on: () => () => {} });
  const downloads: string[] = [];
  const dl = (name: string) => void downloads.push(name);
  assert.deepEqual(await saveStatement(bridge({ ok: { shared: true } }), "s.csv", "a,b\r\n", true, dl), { saved: "shared" });
  assert.deepEqual(calls, [["device.shareFile", { name: "s.csv", text: "a,b\r\n", mime: "text/csv" }]]);
  assert.deepEqual(downloads, [], "control: no download on the phone");
  assert.deepEqual(await saveStatement(bridge({ ok: { shared: false } }), "s.csv", "x", true, dl), { saved: "closed" });
  assert.deepEqual(await saveStatement(bridge({ problem: { code: "x", whatHappened: "That file is too big to share. Nothing was shared." } } as BridgeResult<unknown>), "s.csv", "x", true, dl), { line: "That file is too big to share. Nothing was shared." });
  calls.length = 0;
  assert.deepEqual(await saveStatement(bridge({ ok: {} }), "s.csv", "x", false, dl), { saved: "downloaded" });
  assert.deepEqual(downloads, ["s.csv"]);
  assert.deepEqual(calls, [], "control: a browser never asks the host");
});

test("crawl F6: a site wallet's Take out names the site as where it came from, on its row and its page; control: a plain Put away is still from the NEAR wallet", async () => {
  const { movementFacts } = await import("./statement.ts");
  const { describe } = await import("./format.ts");
  const out = mv({ id: "k1-home", kind: "trading", from: "trading", to: "nep141:usdc", amount: "9.60", site: "pump.fun" });
  const plain = mv({ id: "k2", kind: "trading", from: "trading", to: "nep141:usdc", amount: "9.60" });
  const ends = (m: Movement) => movementFacts(m, TOKENS, CHAINS).map((f) => `${f.label} ${f.value}`);
  assert.deepEqual(ends(out).slice(0, 2), ["From Your pump.fun wallet", "To Safe"]);
  assert.deepEqual(ends(plain).slice(0, 2), ["From NEAR wallet", "To Safe"], "control");
  assert.equal(describe(out, TOKENS, CHAINS).title, "Take out $9.60 from your pump.fun wallet");
  assert.doesNotMatch(describe(out, TOKENS, CHAINS).title, /Put away/);
  assert.equal(describe(plain, TOKENS, CHAINS).title, "Put away $9.60", "control");
});
