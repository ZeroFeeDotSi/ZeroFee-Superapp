// What a plain throw may say (audit, 6 Nov): the one list of calls that can't move money, a table each way; anything not listed is a money call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoCore } from "./demo-core.ts";
import { asOutcome } from "./dev-signer.ts";
import { movesNothing, readsOnly, unexpectedFor } from "./money-calls.ts";
import { ProblemError } from "./problem.ts";
import { READS } from "./read-deadline.ts";
import { SecondDeviceCore } from "./second-device.ts";
import { securityProblems } from "./security-problems.ts";
import { createSpendingService } from "./spending.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const NOTHING_MOVES = [
  // reads
  "account.state", "account.safeUpdate", "alerts.poll", "ledger.balances", "ledger.activity", "ledger.private", "ledger.privateMoveStatus", "ledger.services", "spending.status", "spending.wallets", "subwallet.balances", "subwallet.preflight", "subwallet.cap.check", "tx.describe",
  // quotes
  "ledger.swapQuote", "ledger.sendFee", "ledger.quoteToPrivate", "subwallet.safeSwapQuote", "subwallet.private.quoteIn", "subwallet.float.swapQuote", "subwallet.add.quote", "spending.swap.quote",
  // signs and hands the bytes back: Trade sends them
  "subwallet.signTx", "subwallet.signMessage", "subwallet.signTypedData", "subwallet.near.trade", "subwallet.session.start",
  // no money in them
  "account.create", "recovery.check", "recovery.confirm", "subwallet.create", "subwallet.export", "ledger.relabel", "spending.setCap", "nostr.sign", "site2fa.backup", "sitemail.list",
];
const MONEY = [
  // named after a read, but each sends on (float-moves.ts refresh, goHome; pocket-moves.ts: "sends it again"; 83, 6 Nov)
  "subwallet.float.move", "subwallet.private.move",
  "ledger.sendFromSafe", "ledger.moveFromPrivate", "ledger.swap", "ledger.toPrivate", "ledger.fromPrivate", "ledger.toTrading", "ledger.oldWordsMove", "ledger.withdraw", "ledger.transfer", "ledger.pay", "ledger.convert", "ledger.addSent", "ledger.hiddenFromRow",
  "spending.topUp", "spending.putAway", "spending.move", "spending.makeReady", "spending.swap.go",
  "subwallet.sign", "subwallet.send", "subwallet.sendPrivate", "subwallet.privatePay", "subwallet.hiddenFromRow", "subwallet.float.out", "subwallet.float.in", "subwallet.float.nearOut", "subwallet.float.nearIn", "subwallet.float.home", "subwallet.float.swap", "subwallet.near.rheaSwap", "subwallet.near.rheaAdd", "subwallet.near.rheaClaim", "subwallet.near.register", "subwallet.private.home", "subwallet.oldWords.move", "subwallet.site.moveBack", "subwallet.site.moveBackAll",
  "tx.request", "approval.answer", "sign", "account.waiting.run", "account.secondDevice.refill", "secondDevice.answer", "perps.deposit", "account.agent.pocketSign",
];

for (const m of NOTHING_MOVES) test(`moves nothing: ${m}`, () => assert.equal(movesNothing(m), true));
for (const m of MONEY) test(`a money call: ${m}`, () => assert.equal(movesNothing(m), false));
test("a method nobody listed is a money call; so is no method at all", () => {
  for (const m of ["ledger.somethingNew", "subwallet.brandNew", "spending.next", "", "nostr", "sitemailbox"]) assert.equal(movesNothing(m), false, m);
  assert.equal(movesNothing(undefined), false);
});
test("every method that only reads (read-deadline.ts READS) is on the list", () => {
  for (const m of READS) assert.equal(movesNothing(m), true, m);
});

const assertMoney = (p: { code: string; whatHappened: string; money: { state: string }; next: unknown }, code: string) => {
  assert.equal(p.code, code);
  assert.equal(p.whatHappened, "ZeroFee hit a problem on its side. Check Activity before you try again.");
  assert.equal(p.money.state, "unsure");
  assert.deepEqual(p.next, { kind: "open", label: "See what happened", screen: "activity" });
};
const assertRead = (p: { code: string; whatHappened: string; money: { state: string }; next: unknown }) => {
  assert.equal(p.code, "security.unexpected");
  assert.match(p.whatHappened, /Nothing was sent\.$/);
  assert.equal(p.money.state, "safe");
  assert.deepEqual(p.next, { kind: "retry", label: "Try again" });
};

test("unexpectedFor: a money call can't say; a read keeps its Try again and its words; both keep the details line", () => {
  const boom = new Error("boom");
  assertMoney(unexpectedFor("ledger.swap", boom), "security.unexpected.money");
  assertMoney(unexpectedFor(undefined, boom), "security.unexpected.money");
  assertRead(unexpectedFor("account.state", boom));
  assert.match(unexpectedFor("ledger.swap", boom).more ?? "", /ledger\.swap · Error: boom/);
  assert.equal(readsOnly(securityProblems.unexpected("x")), true);
  assert.equal(readsOnly(securityProblems.unexpectedMoney("x")), false);
});

test("DemoCore's own door: a plain throw in a money call vs in a read, on the real call()", async () => {
  const chain = new FakeChain();
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => new Uint8Array(), createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: [{ up_to: null, level: "FaceId" }], watchIntervalMs: 60_000 } as never);
  (core as unknown as { dispatch: () => Promise<unknown> }).dispatch = async () => { throw new Error("boom"); };
  const money = await core.call("tx.request", {});
  assert.ok("problem" in money);
  assertMoney(money.problem, "security.unexpected.money");
  const read = await core.call("account.activity", {});
  assert.ok("problem" in read);
  assertRead(read.problem);
  core.close();
});

test("the second device's door: its yes is a money call; its read keeps Try again", async () => {
  const vault = new MemoryVault();
  (vault as unknown as { get: () => Promise<never> }).get = async () => { throw new Error("boom"); };
  const core = new SecondDeviceCore({ chain: new FakeChain(), vault });
  const read = await core.call("secondDevice.state");
  assert.ok("problem" in read);
  assertRead(read.problem);
  const yes = await core.call("secondDevice.answer", { accountId: "kid.near", id: "1", approve: true });
  assert.ok("problem" in yes);
  assertMoney(yes.problem, "security.unexpected.money");
});

test("a signature's outcome: a plain throw can't say what it signed", () => {
  const out = asOutcome(new Error("boom"));
  assert.equal(out.status, "problem");
  assert.ok(out.status === "problem");
  assertMoney(out.problem, "security.unexpected.money");
});

test("Spending's door: a Top up's throw never says \"Nothing was sent\"; a read's keeps its own; a read's plain throw inside a Top up is the Top up's; a named refusal stays itself", async () => {
  // every call waits for ready(), which asks for the engine first: the throw comes from there
  const make = (e: unknown) => createSpendingService({
    engine: () => { throw e; },
    async call<T>(): Promise<T> { return { value: null } as T; },
  });
  const up = await make(new Error("boom")).call("spending.topUp", { usd: 5 });
  assert.ok("problem" in up);
  assertMoney(up.problem, "security.unexpected.money");
  const nested = await make(new ProblemError(securityProblems.unexpected("subwallet.list", new Error("boom")))).call("spending.topUp", { usd: 5 });
  assert.ok("problem" in nested);
  assertMoney(nested.problem, "security.unexpected.money");
  const named = await make(new ProblemError(securityProblems.notReady())).call("spending.topUp", { usd: 5 });
  assert.ok("problem" in named);
  assert.equal(named.problem.code, securityProblems.notReady().code);
  const read = await make(new Error("boom")).call("spending.setCap", { usd: 5 });
  assert.ok("problem" in read);
  assert.equal(read.problem.code, "security.partner.unreachable", "control: a call that moves nothing keeps its words");
});
