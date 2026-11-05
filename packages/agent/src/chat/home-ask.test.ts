// AgentZero does what Home does (a casual multi-turn ask, then a pasted Solana address, once got "Say their NEAR
// name"): every tool opens Home's own sheet filled in, read in our own code. Each refusal has a control that passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatSystem as relaySystem } from "../../../../apps/quotes/agentzero-chat.mjs";
import { chatSystem, CHAT_TOOLS } from "./tools.ts";
import { chatTurn, type ChatEvent, type ChatOptions } from "./turn.ts";
import { addSheet, chainOf, moveSheet, NOT_SAID, putLine, requestSheet, sendSheet, swapSheet, tradeSheet, tradeWant, WHO_ANY, HOW_MUCH, BNB_CLOSED } from "./home-ask.ts";

const SOL = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";
const EVM = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";

test("the address's chain is read by its shape: Solana base58 32-44, ETH (RH) 0x+40 hex, a NEAR name or 64 hex; nothing else", () => {
  assert.equal(chainOf(SOL), "sol");
  assert.equal(chainOf(EVM), "hood");
  assert.equal(chainOf("kim.near"), "near");
  assert.equal(chainOf("a".repeat(64)), "near");
  for (const bad of ["0x123", "kim", "kim.neer", `${SOL}0`, "0OIl" + SOL.slice(4)]) assert.equal(chainOf(bad), null, bad);
});

test("a multi-turn send: \"sol pls, like 5$\" then the pasted Solana address is Home's Send, filled in (the words of the chat, not one message)", () => {
  const words = `hey could u help me pay back a buddy\nsol pls, like 5$\n${SOL}`;
  const s = sendSheet({ to: SOL, usd: 5, coin: "SOL" }, words);
  assert.ok(typeof s !== "string", String(s));
  assert.deepEqual(s.ask, { kind: "send", to: SOL, chain: "sol", usd: "5.00", coin: "SOL" });
  assert.equal(s.line, "Send $5.00 in SOL to Do1R…7vcy.");
  // ETH (RH) and NEAR, from a wallet
  const e = sendSheet({ to: EVM, usd: 2, coin: "ETH", from: "hood" }, `send $2 of ETH to ${EVM}`);
  assert.ok(typeof e !== "string");
  assert.equal(e.line, "Send $2.00 in ETH (RH) to 0x7D…7e3D, from your ETH (RH) wallet.");
  const n = sendSheet({ to: "Kim.near", usd: 3 }, "send $3 to kim.near");
  assert.ok(typeof n !== "string");
  assert.deepEqual(n.ask, { kind: "send", to: "kim.near", chain: "near", usd: "3.00" });
});

test("never Claude's guess: a wrong shape, an address not in the person's words, a coin the chain can't take, an amount not said", () => {
  assert.match(sendSheet({ to: "0x123", usd: 5 }, "send $5 to 0x123") as string, /isn't a whole ETH \(RH\) address.*Nothing moved/);
  assert.equal(sendSheet({ to: "kim", usd: 5 }, "send $5 to kim"), WHO_ANY);
  // one letter changed by the model: not the person's address
  const changed = SOL.slice(0, -1) + "x";
  assert.equal(sendSheet({ to: changed, usd: 5 }, `send $5 to ${SOL}`), NOT_SAID);
  assert.match(sendSheet({ to: SOL, usd: 5, coin: "ETH" }, `send $5 of ETH to ${SOL}`) as string, /Solana address, so it can't get ETH \(RH\)/);
  assert.equal(sendSheet({ to: SOL, usd: 50 }, `send $5 to ${SOL}`), HOW_MUCH);
  assert.equal(sendSheet({ to: SOL, usd: 5 }, `send five to ${SOL}`), HOW_MUCH);
  assert.equal(sendSheet({ to: EVM, usd: 5, coin: "BNB" }, `send $5 of BNB to ${EVM}`), BNB_CLOSED);
  // control: the same asks, right, pass
  assert.equal(typeof sendSheet({ to: SOL, usd: 5 }, `send $5 to ${SOL}`), "object");
});

test("swap, move (an amount or everything, any way), add, request and trade each read to Home's own sheet", () => {
  const sw = swapSheet({ from: "USDC", to: "SOL", usd: 10 }, "swap $10 of USDC to SOL");
  assert.ok(typeof sw !== "string");
  assert.deepEqual([sw.ask, sw.line], [{ kind: "swap", from: "USDC", to: "SOL", usd: "10.00", wallet: "safe" }, "Swap $10.00 of USDC to SOL."]);
  const mv = moveSheet({ from: "safe", to: "sol", usd: 20 }, "move $20 from my Safe to my SOL wallet");
  assert.ok(typeof mv !== "string");
  assert.equal(mv.line, "Move $20.00 from your Safe to your SOL wallet.");
  const all = moveSheet({ from: "sol", to: "safe", all: true }, "move everything from my SOL wallet to my Safe");
  assert.ok(typeof all !== "string");
  assert.deepEqual([all.ask, all.usd, all.line], [{ kind: "move", from: "sol", to: "safe", all: true }, null, "Move everything from your SOL wallet to your Safe."]);
  assert.equal(moveSheet({ from: "sol", to: "safe", all: true }, "move from my SOL wallet to my Safe"), HOW_MUCH, "everything must be said");
  assert.match(moveSheet({ from: "sol", to: "sol", usd: 5 }, "move $5") as string, /same place/);
  const add = addSheet({ coin: "SOL" });
  assert.ok(typeof add !== "string");
  assert.deepEqual(add.ask, { kind: "receive", coin: "SOL", wallet: "sol" });
  const rq = requestSheet({ usd: 15, from: "bob.near" }, "ask bob.near for $15");
  assert.ok(typeof rq !== "string");
  assert.deepEqual([rq.ask, rq.line], [{ kind: "request", usd: "15.00" }, "Ask bob.near for $15.00. You share the link."]);
});

const BONK = { chain: "sol" as const, address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", liquidityUsd: 9_000_000 };
test("trade: the coin by chain and address only, found in Trade's market and shown; copycats are asked about, never picked", () => {
  const w = tradeWant({ side: "buy", coin: "BONK", usd: 5 }, "buy $5 of BONK");
  assert.ok(typeof w !== "string");
  const tr = tradeSheet(w, [BONK, { ...BONK, address: SOL, name: "Bonk Copy", liquidityUsd: 1_000 }]);
  assert.ok(typeof tr !== "string");
  assert.deepEqual(tr.ask, { kind: "trade", side: "buy", chain: "sol", address: BONK.address, symbol: "BONK", name: "Bonk", usd: 5 });
  assert.equal(tr.line, "Buy $5.00 of BONK (Bonk, Solana, DezX…B263) in Trade.");
  assert.equal(putLine(tr.ask), "Trade is open on BONK: buy $5.00 of it there.");
  // two that trade alike: asked, never guessed
  assert.match(tradeSheet(w, [BONK, { ...BONK, address: SOL, liquidityUsd: 5_000_000 }]) as string, /More than one coin is called BONK: .*Which one\? Paste its address/);
  assert.match(tradeSheet(w, []) as string, /no coin called BONK/);
  assert.match(tradeSheet(w, null) as string, /couldn't be searched/);
  // the coin and the amounts come from the person's words; Trade's limits
  assert.equal(tradeWant({ side: "buy", coin: "WIF", usd: 5 }, "buy $5 of BONK"), "Which coin? Say its name. Nothing moved.");
  assert.equal(tradeWant({ side: "buy", coin: "BONK", usd: 20_000 }, "buy $20000 of BONK"), "A buy is between $0.01 and $10,000. Nothing moved.");
  assert.match(tradeWant({ side: "sell", coin: "BONK", pct: 50 }, "sell some BONK") as string, /share/);
  const half = tradeWant({ side: "sell", coin: "BONK", pct: 50 }, "sell half my BONK");
  assert.ok(typeof half !== "string" && half.pct === 50);
  // a pasted address: used as written, on its chain by its shape
  const pasted = tradeWant({ side: "buy", coin: BONK.address, usd: 5 }, `buy $5 of ${BONK.address}`);
  assert.ok(typeof pasted !== "string" && pasted.chain === "sol" && pasted.address === BONK.address);
  assert.equal(tradeWant({ side: "buy", coin: BONK.address, usd: 5 }, "buy $5 of bonk"), NOT_SAID);
});

test("prompt words (product decision, 3 Nov): ETH (RH), your Safe, your SOL wallet; never ETH on RH or Robinhood, Hidden, row, Trading or Spending (both copies, wallet on and off)", () => {
  const OLD = /ETH on (?:RH|Robinhood)|\b(?:Hidden|Trading|Spending)\b|\brows?\b/;
  for (const on of [false, true]) {
    const app = chatSystem(on);
    assert.equal(app, relaySystem(on), "the relay's copy is word for word");
    assert.deepEqual(app.split("\n").filter((l) => OLD.test(l)), []);
    for (const w of ["ETH (RH)", "your Safe", "your SOL wallet", "your ETH (RH) wallet", "your NEAR wallet"]) assert.ok(app.includes(w), w);
  }
  const home = CHAT_TOOLS.filter((t) => ["send", "swap", "move", "add", "request", "trade"].includes(t.name));
  assert.equal(home.length, 6);
  assert.deepEqual(home.filter((t) => OLD.test(JSON.stringify(t))).map((t) => t.name), []);
  assert.ok(!CHAT_TOOLS.some((t) => t.name === "propose_payment"), "send replaced the NEAR-only payment");
  // control: the line Claude once wrote in a test run is caught
  assert.ok(OLD.test("Which coin (SOL, ETH on RH, or NEAR/USDC)"));
});

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const toolSse = (name: string, input: object) =>
  ev("message_start", { message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu_1", name, input: {} } }) +
  ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } }) + ev("message_stop", {});
async function turn(words: string, history: any[], name: string, input: object) {
  const f = (async () => new Response(toolSse(name, input), { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
  const out: ChatEvent[] = [];
  const o: ChatOptions = { relayBase: null, ownKey: "sk-ant-own-test-key-3333333333333333", anthropicFetch: f, hands: { receipts: async () => "", meter: async () => "" } };
  for await (const e of chatTurn(history, words, o)) out.push(e);
  return out;
}

test("the turn: two casual messages make one Home Send sheet; the $50 pocket limit isn't on the person's own send", async () => {
  const history = [{ role: "user", content: "sol pls, like 5$" }, { role: "assistant", content: "Got it: $5 in SOL. What's your friend's Solana address?" }];
  const out = await turn(SOL, history, "send", { to: SOL, usd: 5, coin: "SOL" });
  const sheet = out.find((e) => e.kind === "needs-you") as { sheet: { kind: string; line: string } } | undefined;
  assert.equal(sheet?.sheet.kind, "home");
  assert.equal(sheet?.sheet.line, "Send $5.00 in SOL to Do1R…7vcy.");
  const big = await turn(`send $200 to ${SOL}`, [], "send", { to: SOL, usd: 200 });
  assert.ok(big.some((e) => e.kind === "needs-you"), "Home's own limits apply, not AgentZero's $50");
  // control: no amount said anywhere, so no sheet
  const none = await turn(SOL, [{ role: "user", content: "send some sol to a friend" }], "send", { to: SOL, usd: 5 });
  assert.ok(!none.some((e) => e.kind === "needs-you"));
  assert.ok(none.some((e) => e.kind === "refused"));
});

test("trade: a sale with a fraction asks for a whole percent, and a buy over Trade's cap says the cap (review, 3 Nov: never refused without why); controls: a whole percent and a buy inside the cap still read", () => {
  assert.equal(tradeWant({ side: "sell", coin: "BONK", pct: 33.5 }, "sell 33.5% of my BONK"), "Trade sells whole percents. Say 33% or 34%. Nothing moved.");
  assert.equal(typeof tradeWant({ side: "sell", coin: "BONK", pct: 33 }, "sell 33% of my BONK"), "object", "control: a whole percent");
  assert.match(tradeWant({ side: "sell", coin: "BONK", pct: 33.5 }, "sell some BONK") as string, /share/, "control: a share the person never said is still asked");
  assert.equal(tradeWant({ side: "buy", coin: "BONK", usd: 20_000 }, "buy $20000 of BONK"), "A buy is between $0.01 and $10,000. Nothing moved.");
  assert.equal(typeof tradeWant({ side: "buy", coin: "BONK", usd: 9_000 }, "buy $9000 of BONK"), "object", "control: inside the cap");
  assert.equal(tradeWant({ side: "buy", coin: "BONK", usd: 20_000 }, "buy some BONK"), HOW_MUCH, "control: dollars never said are asked");
});

// mainnet rehearsal, 3 Nov: "Swap $1", "Move $1" and "Request $0.50" opened Home's sheets whose button stayed off ("At least
// $2 per swap", "At least $2 per move", "Ask for $3 or more"): AgentZero says the least itself, and no sheet opens.
import { MOVE_LEAST_USD, REQUEST_LEAST_USD, SWAP_LEAST_USD } from "./home-ask.ts";
import { SWAP_MIN_USD } from "../../../wallet/src/app/money/swap-corridor.ts";
import { LEG_MIN_USD } from "../../../wallet/src/app/screens/move-split.ts";
import { ADD_LEAST_USD } from "../../../core/src/add-outside.ts";

test("the least each sheet takes is Home's own (copies held equal)", () => {
  assert.equal(SWAP_LEAST_USD, SWAP_MIN_USD);
  assert.equal(MOVE_LEAST_USD, LEG_MIN_USD);
  assert.equal(REQUEST_LEAST_USD, ADD_LEAST_USD);
});

test("a swap, a move or a request under its least is one line and no sheet; at the least, the sheet (control)", () => {
  assert.equal(swapSheet({ from: "SOL", to: "NEAR", usd: 1 }, "swap $1 of SOL to NEAR"), "A swap takes at least $2. Say $2 or more. Nothing moved.");
  assert.equal(moveSheet({ from: "safe", to: "near", usd: 1 }, "move $1 from my Safe to my NEAR wallet"), "A move takes at least $2. Say $2 or more. Nothing moved.");
  assert.match(requestSheet({ usd: 0.5 }, "request $0.50") as string, /^Ask for \$3 or more.*Nothing moved\.$/);
  // controls: the least itself opens the sheet; "everything" has no amount to check here (Home's sheet says what it holds)
  assert.equal(typeof swapSheet({ from: "SOL", to: "NEAR", usd: 2 }, "swap $2 of SOL to NEAR"), "object");
  assert.equal(typeof moveSheet({ from: "safe", to: "near", usd: 2 }, "move $2 from my Safe to my NEAR wallet"), "object");
  assert.equal(typeof requestSheet({ usd: 3 }, "request $3"), "object");
  assert.equal(typeof moveSheet({ from: "sol", to: "safe", all: true }, "move everything from my SOL wallet to my Safe"), "object");
});

test("the card shortens a 64-hex NEAR account like an address; a NEAR name stays whole (control)", () => {
  const hex = "25666ef02c8073aed61914550961b3a7e0cca6809407f4a10f50cae45cd364a5";
  const s = sendSheet({ to: hex, usd: 2 }, `send $2 to ${hex}`);
  assert.equal(typeof s, "object");
  assert.equal((s as { line: string }).line, "Send $2.00 to 2566…64a5.");
  // the ask keeps the whole account: only the words are short
  assert.equal(((s as { ask: { to: string } }).ask).to, hex);
  assert.equal((sendSheet({ to: "kim.near", usd: 2 }, "send $2 to kim.near") as { line: string }).line, "Send $2.00 to kim.near.");
});

// mainnet rehearsal, 3 Nov: a Safe → wallet swap of $2.00–$2.08 passed AgentZero's $2 and dead-ended on Home's sheet.
// AgentZero reads Home's own floors (core float-floors.ts), never a copy.
import { FLOORS, moveLeast, swapLeast } from "./home-ask.ts";
import { HOME_LEG_MIN_USD, SAFE_LEG_MIN_USD } from "../../../core/src/float-floors.ts";
import { fit } from "./plan.ts";
test("a leg between the Safe and a wallet takes Home's own least ($2.09 in, $2.59 home), read from float-floors (control: other floors change the answer)", () => {
  assert.deepEqual(FLOORS, { safeLeg: SAFE_LEG_MIN_USD, homeLeg: HOME_LEG_MIN_USD });
  assert.equal(SAFE_LEG_MIN_USD, 2.09);
  assert.equal(swapSheet({ from: "USDC", to: "SOL", usd: 2.05 }, "swap $2.05 of USDC to SOL"), "A swap takes at least $2.09. Say $2.09 or more. Nothing moved.");
  assert.equal(typeof swapSheet({ from: "USDC", to: "SOL", usd: 2.09 }, "swap $2.09 of USDC to SOL"), "object");
  assert.equal(moveSheet({ from: "safe", to: "hood", usd: 2.05 }, "move $2.05 from my Safe to my ETH wallet"), "A move takes at least $2.09. Say $2.09 or more. Nothing moved.");
  assert.match(moveSheet({ from: "sol", to: "safe", usd: 2.5 }, "move $2.5 from my SOL wallet to my Safe") as string, /at least \$2\.59/);
  // not a leg: the plain least
  assert.equal(typeof swapSheet({ from: "SOL", to: "NEAR", usd: 2 }, "swap $2 of SOL to NEAR"), "object");
  assert.equal(moveLeast("safe", "near"), 2);
  // control: the answer follows the floors handed in (so a change in Home's file changes AgentZero's)
  assert.equal(moveLeast("safe", "sol", { safeLeg: 5, homeLeg: 6 }), 5);
  assert.equal(swapLeast("SOL", "USDC", { safeLeg: 5, homeLeg: 6 }), 6);
  // a plan's funding move is never under the least: a $0.50 gap moves $2.09
  const send = sendSheet({ to: "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy", usd: 1, coin: "SOL" }, "send $1 in SOL to Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy") as Exclude<ReturnType<typeof sendSheet>, string>;
  const p = fit(send, { safe: 10, sol: 0.5, hood: 0, near: 0 }) as { plan: { steps: { line: string }[] } };
  assert.equal(p.plan.steps[0]!.line, "Move $2.09 from your Safe to your SOL wallet.");
});

// Audit M11: payees and tickers are matched as whole tokens of the person's words, never as a substring.
test("M11: \"send $20 to joakim.near\" plus injected kim.near is refused; a ticker inside a longer word is not the ticker (controls: the whole name and the whole ticker pass)", () => {
  assert.equal(sendSheet({ to: "kim.near", usd: 20 }, "send $20 to joakim.near"), NOT_SAID);
  assert.equal(typeof sendSheet({ to: "joakim.near", usd: 20 }, "send $20 to joakim.near"), "object");
  assert.equal(typeof sendSheet({ to: "kim.near", usd: 20 }, "send $20 to kim.near."), "object", "a full stop after the name is fine");
  const SOL6 = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";
  assert.equal(sendSheet({ to: SOL6.slice(0, 40), usd: 5 }, `send $5 to ${SOL6}`), NOT_SAID, "part of an address is never the address");
  assert.equal(tradeWant({ side: "buy", coin: "BONK", usd: 5 }, "buy $5 of BONKERS"), "Which coin? Say its name. Nothing moved.");
  assert.equal(typeof tradeWant({ side: "buy", coin: "BONK", usd: 5 }, "buy $5 of BONK"), "object");
  assert.equal(typeof tradeWant({ side: "buy", coin: "WIF", usd: 5 }, "buy $5 of $wif"), "object");
});

// Audit L15: words with no figure never let Claude's amount through. Audit L20: a note is the person's own or none.
import { withNumbers } from "./home-ask.ts";
test("L15: no figure in the person's words → \"How much?\", never Claude's $5 (attack: \"send kim.near some money\" took any amount); number words count (controls)", () => {
  assert.equal(sendSheet({ to: "kim.near", usd: 5 }, "send kim.near some money"), HOW_MUCH);
  assert.equal(sendSheet({ to: "kim.near", usd: 900 }, "pay kim.near in dollars"), HOW_MUCH);
  assert.equal(swapSheet({ from: "USDC", to: "NEAR", usd: 50 }, "swap some USDC to NEAR, a few dollars"), HOW_MUCH);
  assert.equal(requestSheet({ usd: 500 }, "make me a request in dollars"), HOW_MUCH);
  // controls: digits and number words the person said still read
  assert.equal(withNumbers("send five bucks and twenty-five dollars, a hundred too"), "send 5 bucks and 25 dollars, 100 too");
  assert.equal((sendSheet({ to: "kim.near", usd: 5 }, "send five bucks to kim.near") as { usd: number }).usd, 5);
  assert.equal(sendSheet({ to: "kim.near", usd: 6 }, "send five bucks to kim.near"), HOW_MUCH, "control: a different figure than the word said");
  assert.equal((sendSheet({ to: "kim.near", usd: 5 }, "send $5 to kim.near") as { usd: number }).usd, 5);
});

test("L20: a note on Send or Request is kept only when the person wrote it (attack: a model-written note is dropped; control: their own words stay)", () => {
  const s = sendSheet({ to: "kim.near", usd: 5, note: "Refund for the scam, call +1 555 0100" }, "send $5 to kim.near") as { ask: { note?: string } };
  assert.equal(s.ask.note, undefined);
  const own = sendSheet({ to: "kim.near", usd: 5, note: "for lunch" }, "send $5 to kim.near for lunch") as { ask: { note?: string } };
  assert.equal(own.ask.note, "for lunch");
  const r = requestSheet({ usd: 5, note: "pay to 0xdead first" }, "request $5 for pizza") as { ask: { note?: string } };
  assert.equal(r.ask.note, undefined);
  assert.equal((requestSheet({ usd: 5, note: "For pizza" }, "request $5 for pizza") as { ask: { note?: string } }).ask.note, "For pizza");
});
