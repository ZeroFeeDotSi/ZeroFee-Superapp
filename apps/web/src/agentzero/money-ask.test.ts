// AgentZero opens Home's own sheet (useShell().openMoney) with the ask Home takes, and follows the move it started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADD_COIN_OF, HOME_PREFILL, SWAP_COIN_OF, followLine, hopLine, hopOf, moneyAsk, movesOf, tradeEndLine } from "./money-ask.ts";
import { SWAP_PLACES } from "@zerofee/wallet/app/money/swap-corridor.ts";
import { ADD_OPEN } from "@zerofee/core/add-outside";

const SOL = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";

test("each Home sheet opens filled in with the fields Home takes (prefill landed), in Home's own names", () => {
  const send = moneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00", coin: "SOL" }) as Record<string, unknown>;
  assert.equal(send.kind, "send");
  assert.equal(send.link, `zerofee:send?v=1&to=${SOL}&chain=sol&coin=SOL`);
  assert.deepEqual([send.to, send.chain, send.usd], [SOL, "sol", "5.00"]);
  // an 0x address names its network, so Send never asks "Which network?" for what AgentZero already read (rehearsal, 3 Nov)
  assert.equal((moneyAsk({ kind: "send", to: "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", chain: "hood", usd: "0.50" }) as Record<string, unknown>).chain, "hood");
  // ETH (RH): the payee only in the link (Send's list names no "ETH" ticker there; the walk saw the link refused with it)
  assert.equal((moneyAsk({ kind: "send", to: "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", chain: "hood", usd: "2.00", coin: "ETH" }) as Record<string, unknown>).link, "zerofee:send?v=1&to=0x7D06e272b5305a4b9D40e872C7950D3437547e3D&chain=hood");
  // Swap's coins by where they sit (shell-api SwapCoin), never the ticker: the mainnet rehearsal saw "SOL to USDC" open as SOL to ETH (RH)
  assert.deepEqual(moneyAsk({ kind: "swap", from: "USDC", to: "SOL", usd: "10.00", wallet: "safe" }), { kind: "swap", from: "safe-usdc", to: "sol", usd: "10.00", wallet: "safe" });
  assert.deepEqual(moneyAsk({ kind: "swap", from: "SOL", to: "NEAR", usd: "2.00", wallet: "sol" }), { kind: "swap", from: "sol", to: "safe-near", usd: "2.00", wallet: "sol" });
  assert.deepEqual(moneyAsk({ kind: "move", from: "safe", to: "sol", usd: "20.00" }), { kind: "move", from: "safe", to: "sol", usd: "20.00", wallet: "sol" });
  // a wallet's money to the Safe is Move too, on that wallet's slider; everything has no amount (the person sets it)
  assert.deepEqual(moneyAsk({ kind: "move", from: "sol", to: "safe" }), { kind: "move", from: "sol", to: "safe", wallet: "sol" });
  // Add and Request by the coin's chain (shell-api AddCoin); USDC has none: Add opens on the Safe
  assert.deepEqual(moneyAsk({ kind: "receive", coin: "SOL", wallet: "sol" }), { kind: "receive", coin: "sol", wallet: "sol" });
  assert.deepEqual(moneyAsk({ kind: "receive", coin: "USDC", wallet: "safe" }), { kind: "receive", wallet: "safe" });
  assert.deepEqual(moneyAsk({ kind: "request", usd: "15.00", coin: "ETH" }), { kind: "request", usd: "15.00", coin: "hood" });
  // Request opens Home's own request kind (not Add's list), with its note; USDC names no chain
  assert.deepEqual(moneyAsk({ kind: "request", usd: "3.00", coin: "USDC", note: "lunch" }), { kind: "request", usd: "3.00", note: "lunch" });
  // control: with prefill off, today's fields only (the payee, the tab; Request inside Add)
  assert.deepEqual(moneyAsk({ kind: "request", usd: "15.00" }, false), { kind: "receive" });
  assert.deepEqual(moneyAsk({ kind: "request", usd: "3.00", coin: "SOL", note: "lunch" }, false), { kind: "receive" });
  assert.deepEqual(moneyAsk({ kind: "swap", from: "USDC", to: "SOL", usd: "10.00", wallet: "safe" }, false), { kind: "swap", wallet: "safe" });
  assert.equal((moneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00" }, false) as Record<string, unknown>).usd, undefined);
  assert.equal((moneyAsk({ kind: "send", to: SOL, chain: "sol", usd: "5.00" }, false) as Record<string, unknown>).chain, undefined);
});

test("the coins AgentZero names are Swap's and Add's own (held equal to Home's lists)", () => {
  for (const c of Object.values(SWAP_COIN_OF)) assert.ok((SWAP_PLACES as readonly string[]).includes(c), c);
  for (const c of Object.values(ADD_COIN_OF)) if (c) assert.ok(c in ADD_OPEN, c);
  assert.equal(HOME_PREFILL, true);
});

test("the move is followed to its end in Activity's words: never a landed line before done", () => {
  assert.deepEqual(followLine({ status: "moving" }, 1000), { text: "On its way. Jobs shows the time left.", end: false });
  assert.deepEqual(followLine({ status: "done" }, 1000), { text: "Landed. It's in your Activity.", end: true });
  assert.equal(followLine({ status: "refunded" }, 1000).text, "It came back to you, so nothing was lost.");
  assert.equal(followLine({ status: "problem", problem: { code: "x", whatHappened: "The swap service didn't answer.", money: { state: "safe", where: "your Safe" }, next: { kind: "nothing", label: "OK" } } }, 1000).text, "It stopped. The swap service didn't answer.");
  assert.equal(followLine({ status: "waiting", held: { id: "h", readyAtIso: "", needsSecondDevice: false } }, 1000).end, true);
  assert.equal(followLine(null, 1000).end, false);
  assert.equal(followLine(null, 120_000).end, true, "control: not found for long, it says so and stops");
});

test("Trade's end in one line: its own landing time, why it didn't open, or closed", () => {
  assert.equal(tradeEndLine({ went: true, tradeId: "t1", landedMs: 620 }), "Landed in 0.62 s.");
  assert.equal(tradeEndLine({ went: true }), "It went. Trade shows it.");
  assert.equal(tradeEndLine({ went: false, refused: "Name the coin by its address on its chain." }), "Name the coin by its address on its chain. Nothing traded.");
  // a sale of a coin not held (Trade f95f419a): its words, plainly, at once
  assert.equal(tradeEndLine({ went: false, refused: "You don't hold BONK." }), "You don't hold BONK. Nothing traded.");
  assert.equal(tradeEndLine({ went: false, refused: "You don't hold BONK" }), "You don't hold BONK. Nothing traded.");
  assert.equal(tradeEndLine({ went: false }), "Closed. Nothing traded.");
});

test("a sheet's moves as one: by its id, or every new leg; a stop in any leg is the answer, done only when all are", () => {
  const mv = (id: string, status: string) => ({ id, status, kind: "transfer", amount: "1", startedAtIso: "", updatedAtIso: "", explorerUrls: [] }) as never;
  const before = new Set(["old"]);
  assert.deepEqual(movesOf([mv("old", "moving")], undefined, before), { m: null, legs: 0 });
  assert.equal(movesOf([mv("a", "done"), mv("b", "moving"), mv("old", "done")], undefined, before).m?.status, "moving");
  assert.equal(movesOf([mv("a", "done"), mv("b", "problem")], undefined, before).m?.status, "problem");
  assert.deepEqual([movesOf([mv("a", "done"), mv("b", "done")], undefined, before).m?.status, movesOf([mv("a", "done"), mv("b", "done")], undefined, before).legs], ["done", 2]);
  // control: by id, only that move counts
  assert.equal(movesOf([mv("a", "done"), mv("b", "moving")], "a", before).m?.status, "done");
});

test("a Move or Swap on to the SOL or Robinhood wallet is two steps: AgentZero never says the whole move landed when it can only see step one", () => {
  assert.equal(hopOf({ kind: "move", from: "safe", to: "sol", usd: "20.00" }), "sol");
  assert.equal(hopOf({ kind: "swap", from: "USDC", to: "ETH", usd: "5.00" }), "hood");
  assert.equal(hopOf({ kind: "move", from: "sol", to: "safe" }), null, "control: to the Safe, step one is the move");
  assert.equal(hopOf({ kind: "send", to: "kim.near", chain: "near", usd: "3.00" }), null);
  assert.ok(!/^Landed/.test(hopLine("sol")) && /Step one landed/.test(hopLine("sol")));
});

// rehearsal, 3 Nov: the page met fastnear's 429 and 5xx 55 times. Cards following at once share one read; a failed read
// backs off to a minute; reads answer again: the pace is back.
import { followDelay, sharedRead } from "./money-ask.ts";
test("three cards following make one read per pace, not three (control: after the pace, a new read); a failed read backs off, then recovers", async () => {
  let reads = 0;
  let t = 0;
  const key = {};
  const read = async () => (reads++, { read: true });
  await Promise.all([sharedRead(key, read, 2_400, () => t), sharedRead(key, read, 2_400, () => t), sharedRead(key, read, 2_400, () => t)]);
  assert.equal(reads, 1);
  t = 2_000;
  await sharedRead(key, read, 2_400, () => t);
  assert.equal(reads, 1, "still within the pace: the same read");
  t = 2_500;
  await sharedRead(key, read, 2_400, () => t);
  assert.equal(reads, 2, "control: past the pace, a new read");
  // control: another bridge reads for itself
  await sharedRead({}, read, 2_400, () => t);
  assert.equal(reads, 3);
  // backoff: 2.5 s → 5 → 10 … at most a minute; one good read and the pace is back
  const waits: number[] = [];
  let w = 2_500;
  for (const ok of [false, false, false, false, false, false, false, true]) waits.push((w = followDelay(w, ok, 2_500)));
  assert.deepEqual(waits, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 2_500]);
});

// a real run, 3 Nov: a restored card said "Nothing moved." about money that had moved
import { CANT_SEE, oldSheetLine } from "./money-ask.ts";
import type { Movement as Mv } from "@zerofee/wallet/types.ts";
test("a money card from before a reload says what Activity says became of it; unread is \"can't see\", never \"nothing moved\" (controls)", async () => {
  const mv = (id: string, status: Mv["status"], startedAtIso = "2026-11-03T10:00:00Z") => ({ id, kind: "transfer", status, amount: "", startedAtIso, updatedAtIso: "", explorerUrls: [] }) as Mv;
  const ok = (rows: Mv[]) => async () => ({ rows, read: true });
  assert.equal(await oldSheetLine({ went: true, movementId: "a" }, ok([mv("a", "done")])), "Landed. It's in your Activity.");
  assert.equal(await oldSheetLine({ went: true, movementId: "a" }, ok([mv("a", "moving")])), "It's on its way. Activity shows when it lands.");
  assert.equal(await oldSheetLine({ went: true }, ok([])), "It went. Activity shows it when it lands.");
  // opened, its end never heard: the moves since it opened
  assert.equal(await oldSheetLine({ opened: Date.parse("2026-11-03T09:00:00Z") }, ok([mv("b", "done")])), "Landed. It's in your Activity.");
  assert.equal(await oldSheetLine({ opened: Date.parse("2026-11-03T11:00:00Z") }, ok([mv("b", "done")])), CANT_SEE, "an older move is never taken for it");
  // unread: can't see (the attack: \"nothing moved\" said about money that moved)
  assert.equal(await oldSheetLine({ went: true, movementId: "a" }, async () => ({ rows: [], read: false })), CANT_SEE);
  assert.equal(await oldSheetLine({ opened: 1 }, async () => { throw new Error("429"); }), CANT_SEE);
  // controls: what the card itself knows
  assert.equal(await oldSheetLine({ opened: 1, closed: true }, ok([])), "It closed before it went. Nothing moved.");
  assert.equal(await oldSheetLine({}, ok([])), "It was never opened, so nothing moved.");
});
test("\"move everything\" opens Home's Move with all: true, never an amount read earlier (control: an amount is passed as itself)", () => {
  assert.deepEqual(moneyAsk({ kind: "move", from: "sol", to: "safe", usd: "7.55", all: true }, true), { kind: "move", from: "sol", to: "safe", all: true, wallet: "sol" });
  assert.deepEqual(moneyAsk({ kind: "move", from: "safe", to: "sol", usd: "5.00" }, true), { kind: "move", from: "safe", to: "sol", usd: "5.00", wallet: "sol" });
});
