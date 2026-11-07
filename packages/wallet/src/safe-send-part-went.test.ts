// the audit's MUST (6 Nov): Private's part of a Send went, then the Safe's part stopped with a refusal that offers Try again. A second go is a
// new quote and Private's part paid again, so that refusal must not offer one. Control: with nothing gone, it does.
// Reached with route B on (nearOrigin; closed in the shipped CONVERT_ROUTES, where Send's fill goes whole) and by a Move's part (private-move.ts, ownWallet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError, type NextStep, type Problem } from "@zerofee/core/problem";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { endHere, saidOnSheet, sendEndsHere } from "./app/money/swap-refused.ts";
import { MOVE_AGAIN, refusedLine, refusedStep, stoppedWords } from "./app/screens/move-run.ts";
import { pocketPartWent, walletProblems } from "./wallet-problems.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const STRANGER_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }];

/** Every signed quote after the first `good` is refused with a Problem that offers Try again. */
function setup(pocketUnits: string, good: number) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: pocketUnits }], subwallets: WALLETS as never });
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  let real = 0;
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      if (!req.dry && ++real > good) throw new ProblemError(walletProblems.quoteExpired());
      return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000" } } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: true, nearOrigin: true }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  return { ledger, core };
}
const send = (l: ReturnType<typeof setup>["ledger"], amount: string) => l.call<unknown[]>("ledger.sendFromSafe", { tokenId: USDC, amount, fill: true, to: { kind: "chain", chain: "sol", address: STRANGER_SOL } });

test("Private's part went, the Safe's part refused with Try again: no Try again; the one step is Activity", async () => {
  const s = setup("2000000", 1);
  const r = await send(s.ledger, "5");
  assert.ok("problem" in r, `the Safe's part stops; got ${JSON.stringify(r)} after ${s.core.privatePays.length} pays`);
  assert.equal(s.core.privatePays.length, 1, "Private's part went");
  assert.equal(r.problem.code, "ledger.send.part-went");
  assert.equal(saidOnSheet(r.problem), false);
  assert.equal(sendEndsHere(r.problem), true);
});

test("control: the same refusal with nothing gone still offers Try again", async () => {
  const s = setup("0", 0);
  const r = await send(s.ledger, "5");
  assert.ok("problem" in r);
  assert.equal(s.core.privatePays.length, 0, "nothing went");
  assert.equal(r.problem.code, walletProblems.quoteExpired().code);
  assert.equal(saidOnSheet(r.problem), walletProblems.quoteExpired().next.kind === "retry");
  assert.equal(sendEndsHere(r.problem), false);
});

const unread: Problem = walletProblems.sendUnread("someone");
for (const [name, p, code] of [
  ["a retry with nothing of the Safe's part moved", walletProblems.quoteExpired(), "ledger.send.part-went"],
  ["a No", walletProblems.declined(), "ledger.send.part-went"],
  ["an error nobody expected", walletProblems.unexpected("x"), "ledger.send.part-went"],
  ["one that may have moved keeps its own words", unread, unread.code],
  ["a money call's plain throw keeps its own words", walletProblems.unexpectedMoney("x"), "ledger.unexpected.money"],
] as [string, Problem, string][]) {
  test(`pocketPartWent: ${name}`, () => {
    const after = pocketPartWent(p);
    assert.equal(after.code, code);
    assert.deepEqual(after.next, { kind: "open", label: "See what happened", screen: "activity" });
    assert.equal(saidOnSheet(after), false);
    assert.equal(sendEndsHere(after), true);
    assert.match(after.more ?? "", /The part from Private went\./);
    if (code === p.code) assert.equal(after.whatHappened, p.whatHappened);
    else assert.doesNotMatch(after.whatHappened, /[Nn]othing (moved|was sent)/);
  });
}

test("a money call's plain throw proves nothing about the money: no Try again on Send, Swap or Move; its row says no \"Tap Move\"", () => {
  const p = walletProblems.unexpectedMoney("x");
  assert.deepEqual(p.next, { kind: "open", label: "See what happened", screen: "activity" });
  assert.equal(p.money.state, "unsure");
  assert.equal(saidOnSheet(p), false);
  assert.equal(sendEndsHere(p), true);
  assert.equal(refusedStep(p), null, "the shell's screen, never the floor's button");
  assert.equal(refusedLine(p), null);
  assert.doesNotMatch(stoppedWords(p, "$5.00"), /Tap Move|[Nn]othing moved/);
});

test("control: a read's plain throw keeps its Try again on every sheet (only a read reaches them with it: asProblem)", () => {
  const p = walletProblems.unexpected("x");
  assert.equal(p.next.kind, "retry");
  assert.equal(saidOnSheet(p), true);
  assert.equal(sendEndsHere(p), false);
  assert.equal(refusedStep(p)?.again, true);
  assert.match(stoppedWords(p, "$5.00"), /Tap Move to try again\.$/);
});

for (const [name, p, again] of [
  ["a retry", walletProblems.quoteExpired(), true],
  ["a part that went", pocketPartWent(walletProblems.quoteExpired()), false],
  ["money that can't be read", walletProblems.unexpectedMoney("x"), false],
  ["a step that opens another screen", { ...walletProblems.quoteExpired(), next: { kind: "open", label: "Check your Safe", screen: "balance" } }, false],
  ["a step on the sheet", { ...walletProblems.quoteExpired(), next: { kind: "nothing", label: "Move less" } }, true],
] as [string, Problem, boolean][]) {
  test(`stoppedWords: ${name}`, () => assert.equal(stoppedWords(p, "$5.00").endsWith(MOVE_AGAIN), again));
}

for (const [name, tapped, opens] of [
  ["its pill: the sheet closes, Activity opens", { kind: "open", label: "See what happened", screen: "activity" }, ["wallet", "activity"]],
  ["Close on the screen: the sheet closes all the same, so its lit button can't pay again", { kind: "nothing", label: "Back" }, null],
] as [string, NextStep, unknown][]) {
  test(`endHere: ${name}`, async () => {
    const seen: string[] = [];
    let went: unknown = null;
    await endHere({ showProblem: async () => (seen.push("problem"), tapped), openApp: (a: never, t?: string) => { seen.push("open"); went = [a, t]; } }, walletProblems.unexpectedMoney("x"), () => seen.push("close"));
    assert.deepEqual(seen, opens ? ["problem", "close", "open"] : ["problem", "close"]);
    assert.deepEqual(went, opens);
  });
}
