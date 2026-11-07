// the audit's filing (6 Nov): a plain throw on an early Move part still let the later parts go. Ruling: no new payment starts
// while one is unknown (partMayHaveGone). On the real ledger: the later part's quote and payment stay flat, each part
// that never started says so, the record and the sweep hold; control: a refusal with nothing gone lets the later part go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { moneyMayHaveMoved } from "@zerofee/core/money-calls";
import { securityProblems } from "@zerofee/core/security-problems";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { NOT_STARTED, notStarted, sweepHeld } from "./private-move.ts";
import { walletProblems } from "./wallet-problems.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const BSC = "0x00000000000000000000000000000000deadbeef";
const JOB = "move-private-0123456789abcdef0123";
const WALLETS = [
  { kind: "private", id: "sw-private", chain: "near", address: POCKET },
  { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL },
  { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT },
  { kind: "trade", id: "sw-trade-bsc", chain: "bsc", address: BSC },
];
const UNKNOWN = walletProblems.unexpectedMoney("").whatHappened;

/** The `stopAt`-th signed quote throws `stop()`; every other one is priced. `recipients`: each signed quote's payee. */
function setup(pocketUnits: string, stopAt: number, stop: () => unknown) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: pocketUnits }], subwallets: WALLETS as never });
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const recipients: string[] = [];
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      if (!req.dry) { recipients.push(req.recipient); if (recipients.length === stopAt) throw stop(); }
      return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  return { ledger, core, recipients };
}
type Parts = { parts: { wallet: string; ids: string[]; stopped?: string }[] };
// asked in this order; paid smallest first: NEAR wallet $2, SOL $3, BNB $5
const THREE = [{ wallet: "sw-trade-bsc", usd: 5 }, { wallet: "sw-trade-sol", usd: 3 }, { wallet: "near", usd: 2 }];
const move = (s: ReturnType<typeof setup>, parts: unknown[] = THREE) => s.ledger.call<Parts>("ledger.moveFromPrivate", { parts, job: JOB, caller: "trade" });
const held = (s: ReturnType<typeof setup>, ended?: string) => sweepHeld(s.core.store.get("private-moves") as string | undefined, ended, Date.now(), { stored: async (k) => s.core.store.get(k) as string | undefined, store: async (k, v) => { s.core.store.set(k, v); } });
const kept = (s: ReturnType<typeof setup>) => JSON.parse((s.core.store.get("private-moves") as string | undefined) ?? "{}");

test("a plain throw on the second part, after the first went: the third part never starts (no quote, no payment); it says so; the record and the sweep hold", async () => {
  const s = setup("20000000", 2, () => new Error("boom"));
  const r = await move(s);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(s.recipients, [FLOAT, SOL], "the BNB part was never quoted");
  assert.equal(s.core.privatePays.length, 1, "only the first part was paid");
  const [bsc, sol, near] = r.ok.parts;
  assert.equal(near!.ids.length, 1, "the first part went");
  assert.equal(near!.stopped, undefined);
  assert.deepEqual([sol!.ids, sol!.stopped], [[], UNKNOWN], "the stop can't say what moved");
  assert.deepEqual([bsc!.ids, bsc!.stopped], [[], NOT_STARTED.private], "never started: not 'went', not 'unknown'");
  const rec = kept(s)[JOB];
  assert.deepEqual(rec.parts.map((p: { stopped?: string }) => p.stopped ?? null), [NOT_STARTED.private, UNKNOWN, null]);
  assert.equal(rec.paying, undefined, "the Move's legs are over");
  assert.equal(await held(s, near!.ids[0]), true, "the first part's end never sweeps");
  assert.equal(await held(s), true, "unknown: the sweep is held 24 h");
  const st = await s.ledger.call<{ parts: { stopped?: string; moves: unknown[] }[] } | null>("ledger.privateMoveStatus", { job: JOB });
  assert.ok("ok" in st && st.ok);
  assert.deepEqual(st.ok.parts.map((p) => [p.stopped ?? null, p.moves.length]), [[NOT_STARTED.private, 0], [UNKNOWN, 0], [null, 1]]);
});

test("control: a refusal with nothing gone on the second part lets the third go, as before", async () => {
  const s = setup("20000000", 2, () => new ProblemError(walletProblems.quoteExpired()));
  const r = await move(s);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(s.recipients, [FLOAT, SOL, BSC], "the BNB part was quoted");
  assert.equal(s.core.privatePays.length, 2, "the first and third parts were paid");
  const [bsc, sol, near] = r.ok.parts;
  assert.equal(near!.ids.length, 1);
  assert.deepEqual([sol!.ids, sol!.stopped], [[], walletProblems.quoteExpired().whatHappened]);
  assert.equal(bsc!.ids.length, 1);
  assert.equal(bsc!.stopped, undefined);
  assert.equal(await held(s), false, "nothing unknown, no fill: the sweep isn't held");
});

test("a plain throw on the very first part: nothing after it starts; the record stays with no ids; the sweep holds", async () => {
  const s = setup("20000000", 1, () => new Error("boom"));
  const r = await move(s);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(s.recipients, [FLOAT]);
  assert.equal(s.core.privatePays.length, 0);
  assert.deepEqual(r.ok.parts.map((p) => [p.ids.length, p.stopped]), [[0, NOT_STARTED.private], [0, NOT_STARTED.private], [0, UNKNOWN]]);
  assert.ok(kept(s)[JOB], "kept: the stop proves nothing");
  assert.equal(kept(s)[JOB].paying, undefined);
  assert.equal(await held(s), true);
});

test("control: a refusal with nothing gone on the very first part is thrown as itself, nothing kept, as before", async () => {
  const s = setup("20000000", 1, () => new ProblemError(walletProblems.quoteExpired()));
  const r = await move(s);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, walletProblems.quoteExpired().code);
  assert.deepEqual(s.recipients, [FLOAT]);
  assert.equal(kept(s)[JOB], undefined);
});

test("Private short, the fill open ($6 for $10): a stop on the first part leaves the last, which needed the Safe's fill, unstarted with its money in Private and the Safe; no Safe sheet", async () => {
  const s = setup("6000000", 1, () => new Error("boom"));
  const r = await move(s);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(r.ok.parts.map((p) => p.stopped), [NOT_STARTED.fill, NOT_STARTED.private, UNKNOWN]);
  assert.equal(s.core.signed.length, 0, "the Safe signed nothing");
  assert.equal(s.core.privateIns.length, 0, "nothing filled Private");
});

for (const [name, units, share, at, want] of [
  ["a stop on the first of three, Private covers all", [5n, 3n, 2n], 10n, 0, [[1, NOT_STARTED.private], [0, NOT_STARTED.private]]],
  ["a stop on the second of three, Private covers all", [5n, 3n, 2n], 10n, 1, [[0, NOT_STARTED.private]]],
  ["a stop on the last: none after it", [5n, 3n, 2n], 10n, 2, []],
  ["Private short: the last would have needed the fill", [5n, 3n, 2n], 6n, 0, [[1, NOT_STARTED.private], [0, NOT_STARTED.fill]]],
  ["Private short by exactly the last", [5n, 3n, 2n], 5n, 0, [[1, NOT_STARTED.private], [0, NOT_STARTED.fill]]],
  ["Private short by more than the last: the middle part would have needed a fill too", [5n, 3n, 2n], 4n, 0, [[1, NOT_STARTED.fill], [0, NOT_STARTED.fill]]],
  ["one part", [4n], 1n, 0, []],
] as [string, bigint[], bigint, number, [number, string][]][]) {
  test(`notStarted: ${name}`, () => {
    // order is smallest first, as moveFromPrivate sorts it
    const order = units.map((_, i) => i).sort((a, b) => (units[a]! < units[b]! ? -1 : units[a]! > units[b]! ? 1 : 0));
    assert.deepEqual(notStarted(order, units, share, at).map((n) => [n.part, n.stopped]), want);
  });
}

for (const [name, p, moved] of [
  ["the core's plain throw in a money call", securityProblems.unexpectedMoney("spending.move", new Error("x")), true],
  ["the ledger's plain throw in a money call", walletProblems.unexpectedMoney("x"), true],
  ["one step: Activity", { ...walletProblems.quoteExpired(), next: { kind: "open", label: "See what happened", screen: "activity" } }, true],
  ["on its way", { ...walletProblems.quoteExpired(), money: { state: "on-the-way", where: "on its way" } }, true],
  ["a send NEAR hasn't confirmed", walletProblems.sendUnread("someone"), true],
  ["a quote expired, money safe", walletProblems.quoteExpired(), false],
  ["a read's plain throw", walletProblems.unexpected("x"), false],
  ["the person's No", walletProblems.declined(), false],
] as [string, Parameters<typeof moneyMayHaveMoved>[0], boolean][]) {
  test(`moneyMayHaveMoved: ${name}`, () => assert.equal(moneyMayHaveMoved(p), moved));
}
