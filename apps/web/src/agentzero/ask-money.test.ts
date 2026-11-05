// H-2 "Ask your money", the phone's half: every figure is worked out on the phone from Activity's real rows and links to
// them; dollars only where the record carries them; Claude never gets a payee's name or address (QA, 3 Nov). Every test
// has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Chain, Movement, Token } from "@zerofee/wallet/types.ts";
import { chatTurn, type ChatEvent, type ChatHands } from "@zerofee/agent/chat/turn";
import { addDecimal, answerAsk, labelOf, markCounter, MAX_FACTS, moneyRows } from "./ask-money.ts";
import { keptRow, moneyReader, READ_LIMIT } from "./money-reader.ts";

const tok = (id: string, symbol: string, priceUsd?: string): Token => ({ assetId: id, symbol, name: symbol, chain: "near", decimals: 6, ...(priceUsd ? { priceUsd } : {}) } as unknown as Token);
const TOKENS = new Map<string, Token>([["nep141:usdc", tok("nep141:usdc", "USDC", "1")], ["nep141:sol", tok("nep141:sol", "SOL", "160")]]);
const CHAINS = [{ id: "sol", name: "Solana" }, { id: "base", name: "Base" }] as unknown as Chain[];
const at = (day: number, h = 12) => new Date(2026, 10, day, h, 5).toISOString();
const mv = (o: Partial<Movement> & Pick<Movement, "id" | "kind">): Movement => ({ status: "done", amount: "1", startedAtIso: at(3), updatedAtIso: at(3), explorerUrls: [], ...o } as Movement);
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BASE_ADDR = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const LEDGER: Movement[] = [
  mv({ id: "u1", kind: "transfer", from: "nep141:usdc", to: "kim.near", amount: "12.5", updatedAtIso: at(2), explorerUrls: ["https://nearblocks.io/txns/a"] }),
  mv({ id: "u2", kind: "transfer", from: "nep141:usdc", to: "kim.near", amount: "7.25", updatedAtIso: at(3) }),
  mv({ id: "u3", kind: "pay", from: "nep141:usdc", to: `${BASE_ADDR} on Base`, label: "Kiosk", amount: "4.2", updatedAtIso: at(4), caller: "pay" }),
  mv({ id: "s1", kind: "transfer", from: "nep141:sol", to: `${SOL_ADDR} on Solana`, amount: "0.5", private: true, updatedAtIso: at(5) }),
  // not counted: one that didn't go, one still on its way
  mv({ id: "x1", kind: "transfer", from: "nep141:usdc", to: "lee.near", amount: "100", status: "problem", updatedAtIso: at(6) }),
  mv({ id: "x2", kind: "transfer", from: "nep141:usdc", to: "lee.near", amount: "50", status: "moving", updatedAtIso: at(6, 13) }),
  // in, and a rules change (no money)
  mv({ id: "d1", kind: "deposit", from: "sol", to: "nep141:usdc", amount: "300", updatedAtIso: at(1) }),
  mv({ id: "a1", kind: "account", label: "Changed your day limit", amount: "", updatedAtIso: at(2) }),
];
const ROWS = moneyRows(LEDGER, TOKENS, CHAINS);
const NOW = Date.parse(at(10));
const ask = (q: Parameters<typeof answerAsk>[1], said = "what did I spend?", full = false) => answerAsk(ROWS, q, { said, mark: markCounter(), full, now: NOW });
const fact = (a: ReturnType<typeof ask>, mark?: string) => a.facts.find((f) => f.mark === mark)!;

test("rows: Activity's moves; a step that moved no money is left out", () => {
  assert.deepEqual(ROWS.map((r) => r.id).sort(), ["d1", "s1", "u1", "u2", "u3", "x1", "x2"]);
  assert.equal(ROWS.find((r) => r.id === "u3")!.payee, "Kiosk", "a shop's own name, on the phone");
  assert.equal(ROWS.find((r) => r.id === "s1")!.payee, "a Solana wallet (7xKXtg…osgAsU)", "the copy review's ruling (5 Nov): the kind, then the short address in brackets; never a whole one");
  assert.equal(ROWS.find((r) => r.id === "s1")!.dollars, "", "SOL moved as SOL: no dollars from today's price");
});

test("what went out: dollars only where the record has them; the rest in its own coin; each figure opens its rows", () => {
  const a = ask({ way: "out" });
  const usd = fact(a, a.marks.total);
  assert.equal(usd.shown, "$23.95");
  assert.deepEqual(usd.rows.sort(), ["u1", "u2", "u3"], "the dollars' own rows");
  assert.deepEqual(a.marks.coins.map((m) => fact(a, m).shown), ["0.5 SOL"]);
  assert.deepEqual(fact(a, a.marks.coins[0]).rows, ["s1"]);
  assert.equal(fact(a, a.marks.count).shown, "4 moves");
  // control: a move that didn't go and one on its way are listed, never counted
  assert.ok(!usd.rows.includes("x1") && !usd.rows.includes("x2"));
  assert.match(a.text, /didn't go through or not yet/);
});

test("the most paid: kim.near, as a chip only; Claude gets a stand-in", () => {
  const a = ask({ way: "out" });
  assert.equal(fact(a, a.marks.who).shown, "kim.near");
  assert.equal(fact(a, a.marks.whoTotal).shown, "$19.75");
  assert.deepEqual(fact(a, a.marks.who).rows, ["u2", "u1"]);
  assert.match(a.text, /p1: who \{\{f\d+\}\}, total \{\{f\d+\}\}/);
});

test("Claude's text: no name, no address, no label, no figure (control: the chips carry them)", () => {
  const a = ask({ way: "all" });
  for (const leak of ["kim.near", "lee.near", "Kiosk", SOL_ADDR, BASE_ADDR, "Solana wallet", "$", "12.5", "23.95"]) assert.equal(a.text.includes(leak), false, `no ${leak} in the text`);
  const shown = a.facts.map((f) => f.shown).join(" ");
  for (const kept of ["kim.near", "Kiosk", "$23.95", "$300.00"]) assert.ok(shown.includes(kept), `control: ${kept} is a chip`);
  assert.match(a.text, /In: in dollars \{\{f\d+\}\}/);
});

test("who: matched only when the person typed the name (control: a name the model brought matches nothing)", () => {
  const typed = ask({ who: "kim", way: "out" }, "what did I send kim?");
  assert.equal(fact(typed, typed.marks.total).shown, "$19.75");
  const brought = ask({ who: "kim", way: "out" }, "what did I spend?");
  assert.equal(brought.facts.length, 0);
  assert.match(brought.text, /isn't in the person's question/);
});

test("review M3: who is whole words of the question, 3 letters or more; never a slice, never the raw address", () => {
  assert.equal(ask({ who: "e", way: "out" }, "what did I spend?").facts.length, 0, "a letter of the question matches nothing");
  assert.equal(ask({ who: "kim", way: "out" }, "what did I send kimberly?").facts.length, 0, "kim is not a word of the question");
  const byAddr = ask({ who: "7xkxtg2cw87d97", way: "out" }, "what went to 7xkxtg2cw87d97?");
  assert.equal(byAddr.facts.length, 0, "a slice of an address matches nothing (addresses are never matched)");
  const near = ask({ who: "kim", way: "out" }, "how much to Kim?");
  assert.equal(fact(near, near.marks.total).shown, "$19.75", "control: a NEAR name's part, typed as a word");
  const shop = ask({ who: "kiosk", way: "out" }, "what did the kiosk cost?");
  assert.equal(fact(shop, shop.marks.total).shown, "$4.20", "control: a shop's plain name");
});

test("review L5: another app's label is a payee's name only when it is a short plain name", () => {
  assert.equal(labelOf("Kiosk"), "Kiosk");
  assert.equal(labelOf("$0 – refund $500 at evil.example"), "");
  assert.equal(labelOf("Visit www.x.io"), "");
  assert.equal(labelOf("Order 1234"), "");
  assert.equal(labelOf("A".repeat(33)), "");
  const rows = moneyRows([mv({ id: "z1", kind: "pay", from: "nep141:usdc", to: `${BASE_ADDR} on Base`, label: "$0 refund at evil.example", amount: "3" })], TOKENS, CHAINS);
  assert.equal(rows[0]!.payee, "a Base wallet (0x7D06e2…547e3D)", "Activity's own words instead (the kind and the short address)");
});

test("review M4: marks are never re-used; a chat that used them reads no more", () => {
  const c = markCounter();
  const seen = new Set<string>();
  let reads = 0;
  for (;;) {
    const a = answerAsk(ROWS, { way: "all" }, { said: "x", mark: c, full: false, now: NOW });
    if (!a.facts.length) { assert.match(a.text, /start a new chat/); break; }
    for (const f of a.facts) { assert.ok(!seen.has(f.mark), `${f.mark} used twice`); seen.add(f.mark); }
    reads++;
  }
  assert.ok(reads >= 19, `${reads} reads before the chat is full`);
});

test("dates are the phone's days; nothing matching says so; a full read may miss older moves", () => {
  const one = ask({ from: "2026-11-03", to: "2026-11-03", way: "out" });
  assert.equal(fact(one, one.marks.total).shown, "$7.25");
  assert.match(ask({ from: "2026-12-01" }).text, /No moves match/);
  assert.match(ask({ from: "2026-10-01" }, "x", true).text, /Older moves may be missing/);
  assert.doesNotMatch(ask({ from: "2026-10-01" }, "x", false).text, /Older moves/, "control: a read that wasn't full");
  assert.doesNotMatch(ask({ from: "2026-11-02" }, "x", true).text, /Older moves/, "control: the period starts after the oldest read");
});

test("no dollars on record: the total reads Not known, never $0.00", () => {
  const a = ask({ way: "out", coin: "SOL" });
  assert.equal(fact(a, a.marks.total).shown, "Not known");
  assert.deepEqual(fact(a, a.marks.total).rows, ["s1"]);
});

test("at most 50 facts (turn.ts keeps 50): the moves get what is left; marks are unique across asks", () => {
  const many = Array.from({ length: 120 }, (_, i) => mv({ id: `m${i}`, kind: "transfer", from: "nep141:usdc", to: `p${i}.near`, amount: "1", updatedAtIso: new Date(Date.parse(at(9)) - i * 60_000).toISOString() }));
  const mark = markCounter();
  const a = answerAsk(moneyRows(many, TOKENS, CHAINS), { way: "out" }, { said: "x", mark, full: false, now: NOW });
  assert.ok(a.facts.length <= MAX_FACTS, `${a.facts.length}`);
  assert.match(a.text, /More moves are not listed/);
  const b = answerAsk(ROWS, {}, { said: "x", mark, full: false, now: NOW });
  assert.equal(new Set([...a.facts, ...b.facts].map((f) => f.mark)).size, a.facts.length + b.facts.length);
});

test("exact sums, no floats", () => {
  assert.equal(addDecimal("0.1", "0.2"), "0.3");
  assert.equal(addDecimal("12.5", "7.25"), "19.75");
  assert.equal(addDecimal("0.000001", "1"), "1.000001");
});

// The QA test: the request body to Claude holds no address and no NEAR name; control: the phone's chip shows the name.
const sse = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const head = sse("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const tail = (stop: string) => sse("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }) + sse("message_stop", {});
const toolCall = (input: object) => head + sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu1", name: "read_activity", input: {} } }) + sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + sse("content_block_stop", { index: 0 }) + tail("tool_use");
const words = (t: string) => head + sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + sse("content_block_stop", { index: 0 }) + tail("end_turn");

test("end to end: what reaches Claude holds no NEAR name, address or label; the chip shows kim.near", async () => {
  const bridge: Bridge = {
    call: async <T,>(method: string): Promise<BridgeResult<T>> => ({ ok: (method === "ledger.activity" ? LEDGER : method === "ledger.tokens" ? [...TOKENS.values()] : CHAINS) as T }),
    on: () => () => {},
  };
  const reader = moneyReader(bridge, () => "what did I send kim this month?");
  const bodies: string[] = [];
  const answers = [toolCall({ from: "2026-11-01", way: "out", who: "kim" }), words("You sent {{f1}} to {{f4}}.")];
  const anthropicFetch = (async (_u: unknown, init: { body?: string } = {}) => {
    bodies.push(String(init.body ?? ""));
    return new Response(answers.shift() ?? words(""), { headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const hands: ChatHands = { receipts: async () => "", meter: async () => "", activity: reader.activity };
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], "what did I send kim this month?", { relayBase: null, ownKey: "sk-ant-test-0000000000000000", anthropicFetch, hands })) out.push(e);
  assert.equal(bodies.length, 2);
  for (const leak of ["kim.near", "lee.near", "Kiosk", SOL_ADDR, BASE_ADDR, "7xKXtg", BASE_ADDR.slice(0, 6)]) assert.equal(bodies[1]!.includes(leak), false, `no ${leak} to Claude`);
  assert.ok(bodies[1]!.includes("{{f1}}") && bodies[1]!.includes("p1"), "control: marks and stand-ins reach Claude");
  const facts = out.find((e) => e.kind === "facts");
  assert.ok(facts && facts.kind === "facts" && facts.facts.some((f) => f.shown === "kim.near"), "control: the chip shows the name, on the phone");
  assert.equal(keptRow("u1")?.title.startsWith("Sent"), true, "a chip's rows are kept on the phone to open");
  assert.equal(READ_LIMIT, 200);
});

// Product decision, 3 Nov said nothing came in. AgentZero now reads what Home's Activity reads (the ledger,
// Spending's rows, the account's own record of the Safe's sends, the person's own wallets) and says what Activity doesn't
// list (an Add's one-time address, the money that opened the account). Each test has a control.
import { statementRows, summaryLine } from "@zerofee/wallet/app/statement.ts";
import { ownRows } from "@zerofee/wallet/app/format.ts";
import type { SpendingActivity, SpendingWallet } from "@zerofee/core/spending";
import { chainSends, NOT_IN_RECORD, receivedListed, type ChainSend } from "./ask-money.ts";

const SOL_OWN = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const H_LEDGER: Movement[] = [
  mv({ id: "d1", kind: "deposit", from: "sol", to: "nep141:usdc", amount: "25.01", updatedAtIso: at(2, 9) }),
  // a Top up: the ledger's row and Spending's row are one move (Activity shows Spending's)
  mv({ id: "t1", kind: "trading", from: "nep141:usdc", to: "trading", amount: "5", updatedAtIso: at(2, 10) }),
  // a send into the person's own SOL wallet: between their own places, never "out"
  mv({ id: "o1", kind: "transfer", from: "nep141:usdc", to: `${SOL_OWN} on Solana`, amount: "3", updatedAtIso: at(2, 11) }),
  mv({ id: "u1", kind: "transfer", from: "nep141:usdc", to: "kim.near", amount: "2", updatedAtIso: at(2, 12) }),
];
const H_SPENDING = [
  { id: "t1", kind: "top-up", usd: "$5.00", status: "done", shown: true, atIso: at(2, 10), words: "Top up $5.00" },
  { id: "mv9", kind: "move", usd: "$1.21", status: "done", shown: true, atIso: at(2, 13), words: "Moved $1.21 to your NEAR wallet", network: "sol", to: "near" },
] as SpendingActivity[];
const H_RECORD: ChainSend[] = [
  { atIso: at(2, 14), ok: true, txHash: "H1", explorerUrl: "https://nearblocks.io/txns/H1", sent: { to: "bob.near", near: "1.5" } },
  { atIso: at(2, 15), ok: true, txHash: "H2", explorerUrl: "https://nearblocks.io/txns/H2" },
];
const H_WALLETS = [{ id: "w", role: "chain", network: "sol", address: SOL_OWN, label: "SOL", current: true, inCap: true }] as unknown as SpendingWallet[];

test("money in: a deposit counts as came in, and every read about money in says Activity doesn't list Adds (control: an 'out' read doesn't)", () => {
  const rows = moneyRows([...H_LEDGER, ...chainSends(H_RECORD, H_LEDGER)], TOKENS, CHAINS, H_SPENDING, ownRows(H_WALLETS));
  const a = answerAsk(rows, { way: "in" }, { said: "how much came in", mark: markCounter(), full: false, now: NOW });
  assert.equal(fact(a, a.marks.total).shown, "$25.01");
  assert.deepEqual(fact(a, a.marks.total).rows, ["d1"]);
  assert.ok(a.text.includes(NOT_IN_RECORD));
  assert.ok(answerAsk(rows, {}, { said: "x", mark: markCounter(), full: false, now: NOW }).text.includes(NOT_IN_RECORD), "an 'all' read says it too");
  assert.equal(answerAsk(rows, { way: "out" }, { said: "x", mark: markCounter(), full: false, now: NOW }).text.includes(NOT_IN_RECORD), false);
  // with nothing listed, the answer still never says nothing came in
  const none = answerAsk([], { way: "in" }, { said: "x", mark: markCounter(), full: false, now: NOW });
  assert.match(none.text, /No moves match/);
  assert.ok(none.text.includes(NOT_IN_RECORD));
});

test("line for line with Home: the same moves, ways and dollars as Home's statement of Activity (control: the old ledger-only read differs)", () => {
  const ledger = [...H_LEDGER, ...chainSends(H_RECORD, H_LEDGER)];
  const own = ownRows(H_WALLETS);
  const ours = moneyRows(ledger, TOKENS, CHAINS, H_SPENDING, own);
  const home = statementRows(ledger, H_SPENDING, TOKENS, CHAINS, 2026, 10, own);
  assert.equal(ours.length, home.length, "one row per Activity row");
  const key = (way: number, usd: string, done: boolean) => `${way}|${usd}|${done}`;
  assert.deepEqual(ours.map((r) => key(r.way === 0 || !r.done ? 0 : r.way, r.dollars ? Number(r.dollars).toFixed(2) : "", r.done)).sort(), home.map((r) => key(r.way, r.dollars, r.status === "Done")).sort());
  // the totals: what came in and went out in dollars, as Home's summary says them
  const a = answerAsk(ours, {}, { said: "x", mark: markCounter(), full: false, now: NOW });
  assert.match(a.text, /Out: in dollars \{\{f\d+\}\}/);
  assert.equal(summaryLine(home, 2026, 10), "6 moves in November 2026. $25.01 came in, $2.00 went out.");
  const outUsd = a.facts.find((f) => f.shown === "$2.00");
  assert.deepEqual(outUsd?.rows, ["u1"], "the send to kim; never the move into the person's own SOL wallet");
  assert.ok(ours.some((r) => r.id === "chain:H1" && r.way === -1 && r.coin === "NEAR"), "the Safe's own NEAR send, from the account's record");
  // control: the old read (the ledger alone, no Spending, no record, no wallets) counts the own-wallet move as out and
  // misses the Spending move and the Safe's send
  const old = moneyRows(H_LEDGER, TOKENS, CHAINS);
  assert.notEqual(old.length, home.length);
  assert.equal(old.find((r) => r.id === "o1")!.way, -1);
});

test("the reader asks Home's reads; a part the account doesn't have is none, any other failure is said (control)", async () => {
  const asked: string[] = [];
  const fake = (spendingFails: "unknown" | "down" | null): Bridge => ({
    call: async <T,>(method: string): Promise<BridgeResult<T>> => {
      asked.push(method);
      if (method === "spending.activity" && spendingFails) return { problem: { code: spendingFails === "unknown" ? "security.method.unknown" : "spending.unread", whatHappened: "x" } } as unknown as BridgeResult<T>;
      const ok = method === "ledger.activity" ? H_LEDGER : method === "ledger.tokens" ? [...TOKENS.values()] : method === "ledger.chains" ? CHAINS : method === "spending.activity" ? H_SPENDING : method === "account.activity" ? H_RECORD : method === "spending.wallets" ? H_WALLETS : [];
      return { ok: ok as T };
    },
    on: () => () => {},
  });
  const a = await moneyReader(fake(null), () => "how much came in").read({ way: "all" });
  assert.deepEqual(asked.sort(), ["account.activity", "ledger.activity", "ledger.chains", "ledger.tokens", "spending.activity", "spending.wallets"]);
  assert.doesNotMatch(a.text, /Couldn't be read/);
  assert.doesNotMatch((await moneyReader(fake("unknown"), () => "x").read({})).text, /Couldn't be read/, "no Spending: as Home reads it");
  assert.match((await moneyReader(fake("down"), () => "x").read({})).text, /Couldn't be read just now, so not counted above: moves between the person's own wallets/);
});

// Home's Received rows (99c53aa7): each Add that ended, the money that opened the account and money sent straight to the
// Safe are Activity rows with their dollars. AgentZero counts them in "came in", to the cent of Home's own statement, and
// no longer says Activity doesn't list Adds (review, 3 Nov). Controls: a read with none of them keeps the line.
test("Received rows: an Add, the opening and money sent to the Safe count as came in, equal to Home's statement, and the 'Adds aren't listed' line goes (control: without them it stays)", async () => {
  const toks = new Map([...TOKENS, ["near", tok("near", "NEAR", "3")]]);
  const received: Movement[] = [
    mv({ id: "rcv:add1", kind: "deposit", from: "sol", to: "nep141:sol", amount: "0.5", usd: "80.00", into: "sol", feeUsd: "0.30", updatedAtIso: at(2, 8) }),
    mv({ id: "rcv:open", kind: "deposit", to: "near", amount: "0.7", usd: "2.10", opened: true, updatedAtIso: at(1, 8) }),
    mv({ id: "rcv:safe", kind: "deposit", to: "nep141:usdc", amount: "4", usd: "4.00", updatedAtIso: at(2, 7) }),
  ];
  const ledger = [...H_LEDGER, ...received];
  const own = ownRows(H_WALLETS);
  const rows = moneyRows(ledger, toks, CHAINS, H_SPENDING, own);
  const home = statementRows(ledger, H_SPENDING, toks, CHAINS, 2026, 10, own);
  const homeIn = home.filter((r) => r.way === 1).reduce((s, r) => s + Number(r.dollars), 0).toFixed(2);
  assert.equal(homeIn, "111.11", "Home's statement: $25.01 + $80.00 + $2.10 + $4.00");
  assert.equal(receivedListed(ledger), true);
  const a = answerAsk(rows, { way: "in" }, { said: "how much came in", mark: markCounter(), full: false, now: NOW, received: true });
  assert.equal(fact(a, a.marks.total).shown, `$${homeIn}`, "AgentZero's total is Home's, to the cent");
  assert.deepEqual([...fact(a, a.marks.total).rows].sort(), ["d1", "rcv:add1", "rcv:open", "rcv:safe"]);
  assert.equal(a.text.includes(NOT_IN_RECORD), false, "Adds are listed now: the line is gone");
  // the reader passes it from the read itself
  const bridge: Bridge = { call: async <T,>(m: string): Promise<BridgeResult<T>> => ({ ok: (m === "ledger.activity" ? ledger : m === "ledger.tokens" ? [...toks.values()] : m === "ledger.chains" ? CHAINS : m === "spending.activity" ? H_SPENDING : m === "spending.wallets" ? H_WALLETS : []) as T }), on: () => () => {} };
  const viaReader = await moneyReader(bridge, () => "how much came in").read({ way: "in" });
  assert.equal(viaReader.text.includes(NOT_IN_RECORD), false);
  assert.ok(viaReader.facts.some((f) => f.shown === "$111.11"));
  // controls: a read with no Received row (a plain bridge deposit only) keeps the line, in the answer and through the reader
  assert.equal(receivedListed(H_LEDGER), false);
  assert.ok(answerAsk(moneyRows(H_LEDGER, TOKENS, CHAINS), { way: "in" }, { said: "x", mark: markCounter(), full: false, now: NOW, received: receivedListed(H_LEDGER) }).text.includes(NOT_IN_RECORD));
  const plain: Bridge = { ...bridge, call: async <T,>(m: string): Promise<BridgeResult<T>> => ({ ok: (m === "ledger.activity" ? H_LEDGER : m === "ledger.tokens" ? [...TOKENS.values()] : m === "ledger.chains" ? CHAINS : []) as T }) };
  assert.ok((await moneyReader(plain, () => "how much came in").read({ way: "in" })).text.includes(NOT_IN_RECORD));
});
