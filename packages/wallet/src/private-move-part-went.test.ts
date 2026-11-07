// the audit's filing (6 Nov): a Move's part whose Private part went and whose Safe part stopped reached private-move.ts with no ids on that
// part (sendFromSafe threw), read as "nothing went yet", dropped the record and rethrew, and a re-tap paid Private's part again.
// On the real ledger: the answer, the kept record, the sweep, each with its control where nothing went.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { asProblem, createLedgerService } from "./ledger.ts";
import { partMayHaveGone, sweepHeld } from "./private-move.ts";
import { saidOnSheet, sendEndsHere } from "./app/money/swap-refused.ts";
import { walletProblems } from "./wallet-problems.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const JOB = "move-private-0123456789abcdef0123";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL }];

/** Every signed quote after the first `good` throws `stop`. */
function setup(pocketUnits: string, good: number, stop: () => unknown, nearOrigin = false) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: pocketUnits }], subwallets: WALLETS as never });
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  let real = 0;
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      if (!req.dry && ++real > good) throw stop();
      return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: nearOrigin, nearOrigin }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  return { ledger, core };
}
type Parts = { parts: { wallet: string; ids: string[]; stopped?: string }[] };
const move = (s: ReturnType<typeof setup>, usd = 5) => s.ledger.call<Parts>("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd }], job: JOB, caller: "trade" });
const held = (s: ReturnType<typeof setup>, ended?: string) => sweepHeld(s.core.store.get("private-moves") as string | undefined, ended, Date.now(), { stored: async (k) => s.core.store.get(k) as string | undefined, store: async (k, v) => { s.core.store.set(k, v); } });
const kept = (s: ReturnType<typeof setup>) => JSON.parse((s.core.store.get("private-moves") as string | undefined) ?? "{}");

test("Private's part went, the Safe's part refused: the Move's answer holds the part that went and why it stopped; the record stays; that payment's end never sweeps", async () => {
  const s = setup("520000000", 1, () => new ProblemError(walletProblems.quoteExpired()));
  // one Face ID (6 Nov): Private's share past its $500 buffer, so the fill doesn't fold it (the audit's R2): Private's part first
  const r = await move(s, 600);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.equal(s.core.privatePays.length, 1, "Private's part went, once");
  const [part] = r.ok.parts;
  assert.equal(part!.ids.length, 1, "the part that went, by its id");
  assert.match(part!.ids[0]!, /^pocket-send:/);
  assert.equal(part!.stopped, "Only the part from Private was sent. Activity shows it.");
  assert.deepEqual(kept(s)[JOB].parts[0].ids, part!.ids, "the kept record holds it");
  assert.equal(kept(s)[JOB].paying, undefined, "the Move's legs are over");
  assert.equal(await held(s, part!.ids[0]), true, "the end of Private's part doesn't sweep");
  assert.equal(await held(s), false, "the next start's sweep is as after any Move: the Safe's refused part brought no extra to hold");
  const st = await s.ledger.call<{ parts: { stopped?: string; moves: { id: string }[] }[] } | null>("ledger.privateMoveStatus", { job: JOB });
  assert.ok("ok" in st && st.ok);
  assert.equal(st.ok.parts[0]!.stopped, part!.stopped);
  assert.deepEqual(st.ok.parts[0]!.moves.map((m) => m.id), part!.ids);
});

test("control: the same refusal with nothing gone is thrown as itself, no record is kept, the sweep isn't held by it", async () => {
  const s = setup("0", 0, () => new ProblemError(walletProblems.quoteExpired()));
  const r = await move(s);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, walletProblems.quoteExpired().code);
  assert.equal(s.core.privatePays.length, 0);
  assert.equal(kept(s)[JOB], undefined);
  const st = await s.ledger.call<unknown>("ledger.privateMoveStatus", { job: JOB });
  assert.deepEqual(st, { ok: null });
  assert.equal(await held(s), false);
});

test("Private's part went, a plain throw on the Safe's: the same, its words can't say, the fill's extra is held 24 h since a fill may have gone", async () => {
  const s = setup("520000000", 1, () => new Error("boom"));
  // one Face ID (6 Nov): Private's share past its $500 buffer, so the fill doesn't fold it (the audit's R2): Private's part first
  const r = await move(s, 600);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.equal(r.ok.parts[0]!.ids.length, 1);
  assert.equal(r.ok.parts[0]!.stopped, "ZeroFee hit a problem on its side. Check Activity before you try again.");
  assert.equal(await held(s), true, "no sweep home from Private for 24 h");
});

test("a plain throw with no part gone yet: it proves nothing, so the record stays and it isn't a refusal to tap again", async () => {
  const s = setup("9000000", 0, () => new Error("boom"));
  const r = await move(s);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(r.ok.parts[0]!.ids, []);
  assert.equal(r.ok.parts[0]!.stopped, "ZeroFee hit a problem on its side. Check Activity before you try again.");
  assert.ok(kept(s)[JOB], "kept");
  assert.equal(await held(s), true);
});

const unsure: Problem = walletProblems.unexpectedMoney("x");
const onWay: Problem = { ...walletProblems.quoteExpired(), money: { state: "on-the-way", where: "on its way" } };
const coming: Problem = { ...walletProblems.quoteExpired(), money: { state: "coming-back", where: "to Private" } };
for (const [name, e, gone] of [
  ["a plain throw", new Error("boom"), true],
  ["a string thrown", "boom", true],
  ["the money call's plain throw, as a Problem", new ProblemError(unsure), true],
  ["one step: Activity", new ProblemError({ ...walletProblems.quoteExpired(), next: { kind: "open", label: "See what happened", screen: "activity" } }), true],
  ["money on its way", new ProblemError(onWay), true],
  ["money coming back", new ProblemError(coming), true],
  ["a send NEAR hasn't confirmed", new ProblemError(walletProblems.sendUnread("someone")), true],
  ["a quote expired, money safe", new ProblemError(walletProblems.quoteExpired()), false],
  ["the person's No", new ProblemError(walletProblems.declined()), false],
  ["money involved in nothing", new ProblemError(walletProblems.amountInvalid()), false],
  ["a read's plain throw", new ProblemError(walletProblems.unexpected("x")), false],
] as [string, unknown, boolean][]) {
  test(`partMayHaveGone: ${name}`, () => assert.equal(partMayHaveGone(e), gone));
}

test("Send: a plain throw in the Safe's part after Private's part went: Activity is the one step, and it says the part went", async () => {
  const s = setup("2000000", 1, () => new Error("boom"), true);
  const r = await s.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "5", fill: true, to: { kind: "chain", chain: "sol", address: SOL } });
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "ledger.unexpected.money");
  assert.equal(sendEndsHere(r.problem), true);
  assert.equal(saidOnSheet(r.problem), false);
  assert.match(r.problem.more ?? "", /The part from Private went\./);
});

test("the ledger's door, on the real call(): a plain throw in a money call can't say; in a read, it keeps Try again", async () => {
  const s = setup("9000000", 0, () => new Error("boom"));
  const send = await s.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "5", to: { kind: "chain", chain: "sol", address: SOL } });
  assert.ok("problem" in send);
  assert.equal(send.problem.code, "ledger.unexpected.money");
  assert.equal(send.problem.money.state, "unsure");
  const quote = await s.ledger.call("ledger.quoteToPrivate", {});
  assert.ok("problem" in quote);
  assert.notEqual(quote.problem.code, "ledger.unexpected.money", "not a money call");
});

for (const [name, e, method, code] of [
  ["a money call's plain throw", new Error("boom"), "ledger.swap", "ledger.unexpected.money"],
  ["no method: a money call", new Error("boom"), undefined, "ledger.unexpected.money"],
  ["a new method: a money call", new Error("boom"), "ledger.brandNew", "ledger.unexpected.money"],
  ["a read's plain throw", new Error("boom"), "ledger.balances", "ledger.unexpected"],
  ["a read's plain throw inside a money call", new ProblemError(walletProblems.unexpected("x")), "ledger.swap", "ledger.unexpected.money"],
  ["the core read's plain throw inside a money call", new ProblemError({ ...walletProblems.unexpected("x"), code: "security.unexpected" }), "ledger.swap", "ledger.unexpected.money"],
  ["the core read's plain throw inside a read", new ProblemError({ ...walletProblems.unexpected("x"), code: "security.unexpected" }), "ledger.balances", "security.unexpected"],
  ["a named refusal stays itself", new ProblemError(walletProblems.quoteExpired()), "ledger.swap", walletProblems.quoteExpired().code],
] as [string, unknown, string | undefined, string][]) {
  test(`asProblem: ${name}`, () => assert.equal(asProblem(e, method).code, code));
}
