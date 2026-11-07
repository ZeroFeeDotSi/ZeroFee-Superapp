import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { createApis } from "./apis.ts";
import { NATIVE_NEAR } from "./catalogue.ts";
import { toUnits } from "./amount.ts";
import { FEE_RESERVE_YOCTO as CORE_FEE_RESERVE_YOCTO, availableYocto } from "@zerofee/core/near-available";
import { FEE_RESERVE_YOCTO, createLedgerService, upfrontYocto } from "./ledger.ts";
import type { ReadCall, CallResult } from "./receipts.ts";
import type { Balance, Chain, DepositAddress, Movement, PayQuote, Quote, RecipientInfo, Token } from "./types.ts";
import { QUOTE_ADDRESS, SAMPLE_ADDRESS, fakeCore, fakeNear, replayFetch, type CoreOptions, type Holdings, type ReplayOptions } from "./testing/replay.ts";

const ME = "kid.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL = "nep141:sol.omft.near";
const BNB = "nep245:v2_1.omni.hot.tg:56_11111111111111111111";
const NEAR = 10n ** 24n;
/** Every step of every request ran (its receipts, read back on two nodes). */
const ran: ReadCall = async () => ({ kind: "ran" });

function setup(o: { core?: CoreOptions; holdings?: Holdings; others?: Record<string, Holdings>; replay?: ReplayOptions; chain?: FakeChain; readCall?: ReadCall; trackMs?: number } = {}) {
  const core = fakeCore({ accountId: ME, ...o.core });
  const chain = o.chain ?? fakeNear(ME, o.holdings ?? {}, o.others);
  const fetch = replayFetch(o.replay);
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(fetch), readCall: o.readCall ?? ran, trackMs: o.trackMs });
  return { core, chain, fetch, ledger };
}

async function ok<T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> {
  const r: BridgeResult<T> = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
}

/** The next movement update that matches: waits for the event, never for a length of time. */
const update = (ledger: Bridge, match: (m: Movement) => boolean) =>
  new Promise<Movement>((resolve) => {
    const off = ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => {
      if (!match(movement)) return;
      off();
      resolve(movement);
    });
  });

async function problem(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<string> {
  const r = await ledger.call(method, params);
  assert.ok("problem" in r, `${method} should have given a Problem`);
  return r.problem.code;
}

test("the ledger refuses to start on testnet: intents.near runs on mainnet only", () => {
  assert.throws(() => createLedgerService({ bridge: fakeCore(), chain: new FakeChain("testnet") }), /mainnet only/);
});

test("ledger.tokens and ledger.chains come from 1Click's list and the bridge's table", async () => {
  const { ledger } = setup();
  const tokens = await ok<Token[]>(ledger, "ledger.tokens");
  assert.ok(tokens.length > 100);
  const chains = await ok<Chain[]>(ledger, "ledger.chains");
  assert.equal(chains[0].id, "near");
  assert.ok(chains.some((c) => c.id === "hood"));
});

test("D134: on mainnet ledger.chains never asks the account (Home's kept rows wait on it); a test build still does", async () => {
  const asked = (testChain?: FakeChain) => {
    const core = fakeCore({ accountId: ME });
    const methods: string[] = [];
    const counted: Bridge = { call: (m, p) => (methods.push(m), core.call(m, p)), on: (e, h) => core.on(e, h) };
    const ledger = createLedgerService({ bridge: counted, chain: fakeNear(ME, {}), ...(testChain ? { testChain } : {}), apis: createApis(replayFetch()), readCall: ran });
    return { ledger, methods };
  };
  const main = asked();
  assert.ok((await ok<Chain[]>(main.ledger, "ledger.chains")).some((c) => c.id === "sol"));
  assert.equal(main.methods.filter((m) => m === "account.state").length, 0, "mainnet: no account read for the chains");
  // control: with a test network the same call does read the account (the counter sees it)
  const withTest = asked(new FakeChain("testnet"));
  await ok<Chain[]>(withTest.ledger, "ledger.chains");
  assert.equal(withTest.methods.filter((m) => m === "account.state").length, 1);
});

test("ledger.receiveChain: the network Receive last showed, the same in every app's Receive (D29)", async () => {
  const { ledger } = setup();
  assert.deepEqual(await ok(ledger, "ledger.receiveChain"), { chain: null });
  assert.deepEqual(await ok(ledger, "ledger.receiveChain", { chain: "sol", caller: "pay" }), { chain: "sol" });
  assert.deepEqual(await ok(ledger, "ledger.receiveChain"), { chain: "sol" }, "Wallet opens where Pay's Receive was");
  assert.equal(await problem(ledger, "ledger.receiveChain", { chain: "nowhere" }), "ledger.chain.unsupported");
  assert.deepEqual(await ok(ledger, "ledger.receiveChain", { caller: "pay" }), { chain: "sol" }, "an unknown network is never kept");
});

test("the coin list is fetched once and reused", async () => {
  const { ledger, fetch } = setup();
  await ok(ledger, "ledger.tokens");
  await ok(ledger, "ledger.chains");
  assert.equal(fetch.calls.filter((c) => c.url.endsWith("/tokens")).length, 1);
});

test("a deposit address on Solana: the bridge's address, the minimum, and one plain note", async () => {
  const { ledger, fetch } = setup();
  const a = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "sol" });
  assert.deepEqual(a, { address: SAMPLE_ADDRESS.sol, chain: "sol", token: SOL, minAmount: "0.00125", qr: SAMPLE_ADDRESS.sol, note: "Send only on Solana." });
  const asked = fetch.calls.find((c) => c.body?.method === "deposit_address")!.body.params[0];
  assert.deepEqual(asked, { account_id: ME, chain: "sol:mainnet", deposit_mode: "SIMPLE" }, "asked for this account, on the bridge's id for Solana");
});

test("a coin asked for by name gets that coin's own minimum", async () => {
  const { ledger } = setup();
  const a = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "sol", token: USDC_SOL });
  assert.equal(a.token, USDC_SOL);
  assert.equal(a.minAmount, "0.001");
});

test("Stellar needs a memo: asked again in memo mode, and the memo comes back on its own", async () => {
  const { ledger } = setup();
  const a = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "stellar" });
  assert.equal(a.address, SAMPLE_ADDRESS.stellar.address);
  assert.equal(a.memo, SAMPLE_ADDRESS.stellar.memo);
  assert.equal(a.qr, a.address, "the QR is the address alone; the memo is shown on its own line");
  assert.equal(a.note, "Send only on Stellar, and always include the memo.");
});

test("every EVM network shares one address, and BNB Chain and Robinhood Chain can receive", async () => {
  const { ledger } = setup();
  const hood = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "hood" });
  const bsc = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "bsc" });
  assert.equal(hood.address, SAMPLE_ADDRESS.evm);
  assert.equal(bsc.address, SAMPLE_ADDRESS.evm);
  assert.equal(hood.token, "nep141:hood.omft.near");
  assert.equal(bsc.token, BNB);
});

test("on NEAR the address is the account's own name", async () => {
  const { ledger, fetch } = setup();
  const a = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "near" });
  assert.deepEqual(a, { address: ME, chain: "near", token: "near", minAmount: "0", qr: ME, note: "Send from any NEAR wallet or exchange." });
  assert.equal(fetch.calls.filter((c) => c.body?.method === "deposit_address").length, 0, "the bridge isn't asked");
  assert.equal((await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "near", token: USDC })).token, USDC);
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "near", token: SOL }), "ledger.token.unsupported");
});

test("receiving is blocked until the backup words are confirmed (Security's rule)", async () => {
  assert.equal(await problem(setup({ core: { stage: "needs-backup" } }).ledger, "ledger.depositAddress", { chain: "sol" }), "security.backup.needed");
  assert.equal(await problem(setup({ core: { stage: "none" } }).ledger, "ledger.depositAddress", { chain: "sol" }), "security.account.none");
  assert.equal(await problem(setup({ core: { stage: "recovering" } }).ledger, "ledger.depositAddress", { chain: "sol" }), "security.stage.wrong");
});

test("a test account never gets a mainnet deposit address", async () => {
  const { ledger, fetch } = setup({ core: { network: "testnet", accountId: "zf-1.testnet" } });
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol" }), "ledger.account.testnet");
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "near" }), "ledger.account.testnet");
  assert.equal(await problem(ledger, "ledger.balances"), "ledger.account.testnet");
  assert.equal(fetch.calls.filter((c) => c.body?.method === "deposit_address").length, 0);
});

test("grade 1 Nov, 02f E3: a test account's balance is its own test NEAR, valued at NEAR's one price, never a blank or $0", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran });
  const rows = await ok<Balance[]>(ledger, "ledger.balances");
  assert.equal(rows.length, 1);
  // The catalogue's wNEAR price, the one 1Click list price Protection and the sheets read too (grade 02f, E3).
  const wnear = (await ok<Token[]>(ledger, "ledger.tokens")).find((t) => t.assetId === "nep141:wrap.near");
  assert.ok(wnear?.priceUsd && Number(wnear.priceUsd) > 0, "control: the replay prices wNEAR");
  assert.ok(Math.abs(Number(rows[0]!.usd) - Number(rows[0]!.amount) * Number(wnear.priceUsd)) < 0.01, `${rows[0]!.usd} vs ${rows[0]!.amount} x ${wnear.priceUsd}`);
  assert.equal(rows[0]!.held, "account");
  assert.match(rows[0]!.name, /^Test NEAR/);
  assert.ok(Number(rows[0]!.amount) > 0 && Number(rows[0]!.amount) <= 10, rows[0]!.amount);
  // Add money on NEAR shows the account's own address, for test NEAR (D7); every other network still says it's a test account.
  const near = await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "near" });
  assert.equal(near.address, "zf-1.testnet");
  assert.match(near.note ?? "", /Test NEAR only/);
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol" }), "ledger.account.testnet");
  // Grade 02e, E2: so Add money lists NEAR alone; Bitcoin (or any network it can't serve) is never offered.
  assert.deepEqual((await ok<Chain[]>(ledger, "ledger.chains")).map((c) => c.id), ["near"]);
});

test("grade 02h, H1: one NEAR price snapshot, the core's: Wallet's balance, the coin list Send's review reads and the review's amount all say the sheet's dollars", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  const inner = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  let priceAsks = 0;
  const said = "about $30.34 (7.1049 NEAR)";
  const core: Bridge = {
    on: inner.on.bind(inner),
    async call<T>(method: string, p?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (method === "account.nearPrice") return (priceAsks++, { ok: { usd: 4.2795 } as T });
      if (method === "tx.describe") return { ok: { title: "", lines: [], warnings: [], effect: [], fee: "0.011 NEAR", amount: said } as T };
      return inner.call<T>(method, p);
    },
  };
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran });
  const wnear = (await ok<Token[]>(ledger, "ledger.tokens")).find((t) => t.assetId === "nep141:wrap.near");
  assert.equal(wnear?.priceUsd, "4.2795", "the coin list carries the core's price, not the list's own");
  const [row] = await ok<Balance[]>(ledger, "ledger.balances");
  // To the nearest cent, as the sheet rounds: never a cent under it.
  const cents = Math.round(Number(row!.amount) * 4.2795 * 100) / 100;
  assert.equal(row!.usd, cents.toFixed(2), `${row!.amount} NEAR`);
  assert.ok(priceAsks >= 2, "asked of the core each time, never kept apart from it");
  // Send's review says the sheet's own amount words (tx.describe), so the two can't differ.
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to: { kind: "chain", chain: "near", address: "guest-book.testnet" }, amountOut: "0.01" });
  assert.equal(q.amount, said);
  assert.equal(q.fee, "0.011 NEAR");
});

test("grade 02h, H1 control: a core with no price leaves the list's own (no figure is made up, none is lost)", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  const inner = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const core: Bridge = { on: inner.on.bind(inner), call: <T>(m: string, p?: Record<string, unknown>) => (m === "account.nearPrice" ? Promise.resolve({ ok: { usd: null } as T }) : inner.call<T>(m, p)) };
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran });
  const wnear = (await ok<Token[]>(ledger, "ledger.tokens")).find((t) => t.assetId === "nep141:wrap.near");
  assert.ok(wnear?.priceUsd && Number(wnear.priceUsd) > 0 && wnear.priceUsd !== "4.2795");
});

test("grade 02f, item 4: Wallet's Activity is the account's record on chain plus this device's own rows, never two Activities", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  const at = "2026-11-02T03:14:00.000Z";
  const record = [
    { atIso: at, title: "Sent 0.01 NEAR to guest-book.testnet", lines: [], by: "A key you removed later", ok: true, txHash: "Hsend", explorerUrl: "https://testnet.nearblocks.io/txns/Hsend", sent: { to: "guest-book.testnet", near: "0.01" } },
    { atIso: "2026-11-02T03:00:00.000Z", title: "Changed your protection", lines: [], by: "This phone", ok: true, txHash: "Hrules", explorerUrl: "https://testnet.nearblocks.io/txns/Hrules" },
  ];
  let clock = Date.parse("2026-11-02T05:00:00.000Z");
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet", activity: record });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran, now: () => clock });
  // After a restore this device recorded nothing: the record still lists the send and the rules change, newest first.
  const rows = await ok<Movement[]>(ledger, "ledger.activity", { caller: "wallet" });
  assert.deepEqual(rows.map((r) => [r.kind, r.status, r.to ?? r.label]), [["transfer", "done", "guest-book.testnet"], ["account", "done", "Changed your protection"]]);
  assert.equal(rows[1]!.by, "This phone");
  // Pay's Send reads the sends only (its recent people); any other app, none of the record.
  assert.deepEqual((await ok<Movement[]>(ledger, "ledger.activity", { caller: "pay" })).map((r) => r.id), ["chain:Hsend"]);
  assert.deepEqual(await ok<Movement[]>(ledger, "ledger.activity", { caller: "chat" }), []);
  // A row this device recorded keeps its own words: the record's copy of it is never listed twice.
  const to = { kind: "chain", chain: "near", address: "guest-book.testnet" };
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to, amountOut: "0.01" });
  const m = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id });
  record.unshift({ ...record[0]!, txHash: m.id.split(":").at(-1)!, explorerUrl: m.explorerUrls[0]!, atIso: "2026-11-02T04:00:00.000Z" }, { ...record[1]!, txHash: "Hnew", atIso: "2026-11-02T04:30:00.000Z" });
  // The record is read again after 20 s, in the background: the next Activity has it.
  clock += 21_000;
  await ok(ledger, "ledger.activity", { caller: "wallet" });
  await new Promise((r) => setTimeout(r, 20));
  const both = await ok<Movement[]>(ledger, "ledger.activity", { caller: "wallet" });
  assert.ok(both.some((r) => r.id === "chain:Hnew"), "control: the record was read again");
  assert.equal(both.length, 4, "the device's send, the new row and the two older rows: the send once");
  assert.equal(both.filter((r) => r.id === m.id || r.id === `chain:${m.id.split(":").at(-1)}`).length, 1);
});

test("grade 01c P2: a test account's Send asks the test network who the receiver is, and sends its test NEAR there", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  // Mainnet has no such account: the old check asked mainnet and said "There's no account called guest-book.testnet".
  const mainnet = fakeNear(ME, {});
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const ledger = createLedgerService({ bridge: core, chain: mainnet, testChain, apis: createApis(replayFetch()), readCall: ran });
  const there = await ok<{ exists: boolean; hasLedgerBalance: boolean }>(ledger, "ledger.recipientInfo", { accountId: "guest-book.testnet" });
  assert.deepEqual([there.exists, there.hasLedgerBalance], [true, false]);
  assert.equal((await ok<{ exists: boolean }>(ledger, "ledger.recipientInfo", { accountId: "nobody-here.testnet" })).exists, false);
  // The Send itself: planned on testnet, a plain NEAR transfer to the receiver, its fee worth $0.00.
  const to = { kind: "chain", chain: "near", address: "guest-book.testnet" };
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to, amountOut: "0.01" });
  assert.equal(q.feeUsd, "0.00");
  const m = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id });
  assert.equal(m.status, "done");
  assert.equal(core.signed.length, 1);
  assert.equal(core.signed[0]!.receiverId, "guest-book.testnet");
  // Grade 01d Q1: Activity has it at once, done (format.ts describe gives it the outcome screen's word).
  const [row] = await ok<Movement[]>(ledger, "ledger.activity", {});
  assert.deepEqual([row?.id, row?.status, row?.kind], [m.id, "done", "pay"]);
  // Anything but test NEAR to a NEAR account still says it's a test account (no NEAR Intents on testnet).
  assert.equal(await problem(ledger, "ledger.quotePay", { fromTokenId: USDC, toTokenId: USDC, to, amountOut: "1" }), "ledger.account.testnet");
});

test("grade 01c P6: the Safe's NEAR and the approval sheet's NEAR are one figure (the core's availableYocto)", async () => {
  assert.equal(FEE_RESERVE_YOCTO, CORE_FEE_RESERVE_YOCTO, "the ledger's fee reserve is the core's");
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 9_994_100_000_000_000_000_000_000n;
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran });
  const [row] = await ok<Balance[]>(ledger, "ledger.balances");
  const acct = await testChain.account("zf-1.testnet", await testChain.commonBlock());
  assert.equal(toUnits(row!.amount, 24), availableYocto(acct));
});

test("grade 01c P12: the balance poll asks the core for the account once, not on every tick", async (t) => {
  // the poll's ticks on the test's own clock, never a real 120 ms window (a loaded gate saw 2 ticks in it, 5 Nov): each
  // tick is stepped and its read awaited
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const real = core.call.bind(core);
  let states = 0;
  core.call = (async (method: string, p?: Record<string, unknown>) => (method === "account.state" && states++, real(method, p))) as typeof core.call;
  let reads = 0;
  const realAccount = testChain.account.bind(testChain);
  testChain.account = (async (...a: Parameters<typeof testChain.account>) => (reads++, realAccount(...a))) as typeof testChain.account;
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran, pollMs: 10 });
  const off = ledger.on("ledger.balancesChanged", () => {});
  for (let tick = 1; tick <= 6; tick++) {
    t.mock.timers.tick(10);
    // until this tick's read is in (event-loop turns, counted, never a clock)
    for (let turn = 0; turn < 100 && reads < tick; turn++) await new Promise((r) => setImmediate(r));
  }
  off();
  assert.ok(reads >= 4, `the poll read the balance ${reads} times`);
  assert.equal(states, 1, "and the account once");
});

test("a network or coin we can't receive is a Problem, never a guess", async () => {
  const { ledger } = setup();
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "qtc" }), "ledger.chain.unsupported");
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "nope" }), "ledger.chain.unsupported");
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol", token: USDC }), "ledger.token.unsupported", "NEAR's USDC isn't a Solana coin");
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol", token: "nep141:no-such.near" }), "ledger.token.unsupported");
});

test("an address that changes after it was first shown is never shown", async () => {
  const { core } = setup();
  const first = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch()), readCall: ran });
  await ok(first, "ledger.depositAddress", { chain: "sol" });
  const later = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch({ addressOverride: "AttackerAddress1111111111111111111111111111" })), readCall: ran });
  assert.equal(await problem(later, "ledger.depositAddress", { chain: "sol" }), "ledger.deposit.address-changed");
  assert.equal((await ok<DepositAddress>(first, "ledger.depositAddress", { chain: "sol" })).address, SAMPLE_ADDRESS.sol, "the first address still shows");
});

test("W-4: without device storage the address is not shown: it can't be checked against the first one (fails closed)", async () => {
  const { ledger } = setup({ core: { noStore: true } });
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol" }), "ledger.deposit.unchecked");
  // NEAR's own address is the account's name: nothing from the bridge, nothing to pin
  assert.equal((await ok<DepositAddress>(ledger, "ledger.depositAddress", { chain: "near" })).address, ME);
});

test("W-4: a deposit address that isn't a real address on its network is never shown (nor kept)", async () => {
  const cases: [string, string][] = [
    ["sol", "0xdeadbeef"],
    ["sol", SAMPLE_ADDRESS.evm],
    ["sol", "AttackerAddress1111111111111111111111111111111111111"],
    ["bsc", SAMPLE_ADDRESS.sol],
    ["hood", "0x1A1eb2Ac53a500e2429366f53dF6FB53Dc0b53A8"],   // one letter's case wrong: the EIP-55 checksum fails
    ["btc", "bc1qlcwnxxf6q3ppkhkfl069e609h6ly3uzs0epyx4"],    // the checksum fails
  ];
  for (const [chain, address] of cases) {
    const { ledger, core } = setup({ replay: { addressOverride: address } });
    assert.equal(await problem(ledger, "ledger.depositAddress", { chain }), "ledger.deposit.address-invalid", `${chain} ${address}`);
    // and it was never pinned: the real address shows next time
    const again = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch()), readCall: ran });
    assert.ok((await ok<DepositAddress>(again, "ledger.depositAddress", { chain })).address, `${chain}: the real address shows after`);
  }
});

test("W-4: a device that won't keep the first address refuses to show one it can't check later", async () => {
  const { core } = setup();
  const refuseSet: Bridge = { ...core, call: (async (method: string, params?: Record<string, unknown>) => (method === "device.store.set" ? { problem: { code: "shell.device.refused" } } : core.call(method, params))) as Bridge["call"] };
  const ledger = createLedgerService({ bridge: refuseSet, chain: fakeNear(ME, {}), apis: createApis(replayFetch()), readCall: ran });
  assert.equal(await problem(ledger, "ledger.depositAddress", { chain: "sol" }), "ledger.deposit.unchecked");
});

test("a bridge that's down: a deposit address on another chain is a Problem naming it, retried by the app (B28)", async () => {
  const r = await setup({ replay: { down: ["bridge"] } }).ledger.call("ledger.depositAddress", { chain: "sol" });
  assert.ok("problem" in r);
  assert.deepEqual([r.problem.code, r.problem.whatHappened, r.problem.service, r.problem.next.kind], ["ledger.service.unreachable", "NEAR Intents' bridge is down right now.", "bridge", "retry"]);
  assert.doesNotMatch(r.problem.whatHappened, /the service that holds|we can't/i);
});

test("B28 R3: 1Click down, the coin list and the networks still answer, from what the app shipped with", async () => {
  const { ledger } = setup({ replay: { down: ["1click"] } });
  const tokens = await ok<Token[]>(ledger, "ledger.tokens");
  assert.ok(tokens.length > 100, "the shipped list");
  const chains = await ok<Chain[]>(ledger, "ledger.chains");
  assert.equal(chains[0].id, "near");
});

test("B28 R3: a coin list read once is kept on the device and painted from when 1Click is down later", async () => {
  const core = fakeCore({ accountId: ME });
  const first = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch()), readCall: ran });
  await ok(first, "ledger.tokens");
  const kept = await core.call<{ value: string | null }>("device.store.get", { key: "coins-kept" });
  assert.ok("ok" in kept && kept.ok.value && JSON.parse(kept.ok.value).length > 100, "the live list is kept");
  // a later start of the app, with 1Click down: the kept list, not the shipped one
  const later = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch({ fault: { service: "oneclick", failure: 521 } })), readCall: ran });
  const tokens = await ok<Token[]>(later, "ledger.tokens");
  assert.equal(tokens.length, JSON.parse((kept as { ok: { value: string } }).ok.value).length);
});

test("balances: ledger coins, plus coins sent straight to the account, each with its place, price and bridged flag", async () => {
  const { ledger } = setup({
    holdings: {
      ledger: { [USDC]: "12500000", [SOL]: "50000000", [BNB]: "0", "nep141:wrap.near": "2000000000000000000000000" },
      account: { [USDC]: "1000000" },
      nearYocto: 3n * NEAR,
      storageBytes: 100_000n, // 1 NEAR of storage
    },
  });
  const rows = await ok<Balance[]>(ledger, "ledger.balances");
  const get = (tokenId: string, held: string) => rows.find((r) => r.tokenId === tokenId && r.held === held);
  assert.deepEqual({ ...get(USDC, "ledger"), usd: undefined }, { tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "12.5", usd: undefined, bridged: false, held: "ledger", listed: true, agreed: true });
  assert.ok(Number(get(USDC, "ledger")!.usd) > 12);
  assert.deepEqual([get(SOL, "ledger")!.amount, get(SOL, "ledger")!.bridged, get(SOL, "ledger")!.chain], ["0.05", true, "sol"]);
  assert.equal(get("nep141:wrap.near", "ledger")!.symbol, "NEAR");
  assert.equal(get(USDC, "account")!.amount, "1");
  // 3 NEAR − 1 NEAR of storage − 0.06 NEAR kept for fees (a Send's 50 Tgas taken up front, and the slack)
  assert.deepEqual([get("near", "account")!.amount, get("near", "account")!.bridged], ["1.94", false]);
  assert.equal(rows.find((r) => r.tokenId === BNB), undefined, "empty coins aren't shown");
  assert.equal(rows[0].tokenId, USDC, "largest first");
});

test("balances read every page of the ledger, all at one block", async () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 230; i++) many[`nep141:coin${i}.near`] = "1";
  const chain = fakeNear(ME, { ledger: many });
  chain.contract("coin7.near", "code", { ft_metadata: () => ({ symbol: "SEVEN", decimals: 0 }) });
  const rows = await ok<Balance[]>(setup({ chain }).ledger, "ledger.balances");
  assert.equal(rows.length, 230);
  const seven = rows.find((r) => r.tokenId === "nep141:coin7.near")!;
  assert.deepEqual([seven.symbol, seven.amount, seven.usd, seven.icon, seven.listed], ["SEVEN", "1", undefined, "", false], "a coin 1Click doesn't list is named from its contract, never priced, never a logo");
  assert.equal(rows.find((r) => r.tokenId === "nep141:coin8.near")!.name, "An unnamed coin");
});

test("a junk coin that won't answer never breaks the balance, and only the first 20 unlisted coins are asked their name", async () => {
  const many: Record<string, string> = { [USDC]: "5000000" };
  for (let i = 0; i < 40; i++) many[`nep141:junk${i}.near`] = "1";
  const chain = fakeNear(ME, { ledger: many });
  chain.contract("junk0.near", "code", { ft_metadata: () => { throw new Error("panicked"); } });
  const view = chain.view.bind(chain);
  let asked = 0;
  chain.view = async (id, method, args, block) => (method === "ft_metadata" && asked++, view(id, method, args, block));
  const rows = await ok<Balance[]>(setup({ chain }).ledger, "ledger.balances");
  assert.equal(rows.length, 41);
  assert.equal(rows.find((r) => r.tokenId === USDC)?.amount, "5");
  assert.equal(rows.find((r) => r.tokenId === "nep141:junk0.near")?.symbol, "?");
  assert.equal(asked, 20);
});

test("two nodes that disagree give the ledger's own Problem, never a number", async () => {
  const chain = fakeNear(ME, { ledger: { [USDC]: "1" } });
  chain.disagree = true;
  const { ledger } = setup({ chain });
  assert.equal(await problem(ledger, "ledger.balances"), "ledger.nodes.disagree");
  assert.equal(await problem(ledger, "ledger.recipientInfo", { accountId: "bob.near" }), "ledger.nodes.disagree");
});

test("an empty account has an empty balance", async () => {
  assert.deepEqual(await ok<Balance[]>(setup().ledger, "ledger.balances"), []);
});

test("balances can be read before the backup is done (only receiving waits)", async () => {
  const rows = await ok<Balance[]>(setup({ core: { stage: "needs-backup" }, holdings: { ledger: { [USDC]: "1000000" } } }).ledger, "ledger.balances");
  assert.equal(rows.length, 1);
});

const CONTRACT_CODE = "BN15g8yVE5QVWppgXNQWnPVdqedH6vuJ7ftqR1RoF5jJ";
test("recipientInfo: does the account exist, does it already hold coins in the ledger, and what code does it run", async () => {
  const chain = fakeNear(ME, {}, { "bob.near": { nearYocto: NEAR, ledger: { [USDC]: "5" } }, "carol.near": { nearYocto: NEAR } });
  chain.contract("trip.near", CONTRACT_CODE);
  const { ledger } = setup({ chain });
  assert.deepEqual(await ok<RecipientInfo>(ledger, "ledger.recipientInfo", { accountId: "bob.near" }), { exists: true, hasLedgerBalance: true, code: null });
  assert.deepEqual(await ok<RecipientInfo>(ledger, "ledger.recipientInfo", { accountId: "carol.near" }), { exists: true, hasLedgerBalance: false, code: null });
  assert.deepEqual(await ok<RecipientInfo>(ledger, "ledger.recipientInfo", { accountId: "nobody.near" }), { exists: false, hasLedgerBalance: false, code: null });
  assert.deepEqual(await ok<RecipientInfo>(ledger, "ledger.recipientInfo", { accountId: "trip.near" }), { exists: true, hasLedgerBalance: false, code: CONTRACT_CODE }, "an account that runs a contract says which");
  for (const bad of ["Bob.near", "a", "bob..near", "bob.near.", "-bob.near", "bob near", ""]) {
    assert.equal(await problem(ledger, "ledger.recipientInfo", { accountId: bad }), "ledger.recipient.invalid", bad);
  }
});

test("a method the ledger doesn't have yet is a Problem", async () => {
  assert.equal(await problem(setup().ledger, "ledger.nope"), "ledger.method.unknown");
});

test("listeners hear ledger.balancesChanged when a balance moves, and polling stops when they leave", async () => {
  const holdings: Holdings = { ledger: { [USDC]: "1000000" } };
  const chain = fakeNear(ME, holdings);
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain, apis: createApis(replayFetch()), pollMs: 5, readCall: ran });
  let heard = 0;
  const stop = ledger.on("ledger.balancesChanged", () => heard++);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(heard, 0, "nothing moved");
  holdings.ledger![USDC] = "2000000";
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(heard, 1);
  stop();
  holdings.ledger![USDC] = "3000000";
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(heard, 1, "no one listens, so no more reads");
});

// Sending the same coin out.

const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const args = (r: { actions: unknown[] }) => (r.actions[0] as { args: Record<string, unknown> }).args;

test("withdraw home: the receiver gets the amount exactly, the bridge fee is on top, and it's followed until it lands", async () => {
  const replay: ReplayOptions = { withdrawals: {} };
  const core = fakeCore({ accountId: ME });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "5000000" } }), apis: createApis(replayFetch(replay)), trackMs: 5, readCall: ran });
  const heard: Movement[] = [];
  ledger.on<{ movement: Movement }>("ledger.movementUpdated", (e) => heard.push(e.movement));
  const m = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC_SOL, amount: "1", toAddress: SOL_ADDR, chain: "sol" });
  assert.equal(core.signed.length, 1);
  assert.deepEqual(args(core.signed[0]), { token: USDC_SOL.slice(7), receiver_id: USDC_SOL.slice(7), amount: "1030000", memo: `WITHDRAW_TO:${SOL_ADDR}` }, "1 USDC + the bridge's 0.03 fee leaves the ledger");
  assert.deepEqual([m.kind, m.status, m.amount, m.from, m.to], ["withdraw", "moving", "1", USDC_SOL, `${SOL_ADDR} on Solana`]);
  replay.withdrawals!["tx1"] = [{ status: "COMPLETED", data: { transfer_tx_hash: "solTx123" } }];
  await new Promise((r) => setTimeout(r, 40));
  const done = heard.at(-1)!;
  assert.equal(done.status, "done");
  assert.ok(done.explorerUrls.includes("https://solscan.io/tx/solTx123"), "the Solana transaction is linked");
  const listed = await ok<Movement[]>(ledger, "ledger.activity");
  assert.equal(listed[0].status, "done", "activity shows the movement as landed");
});

test("withdraw refuses before signing: a wrong address, a wrong chain, too little, too much, an unsupported memo", async () => {
  const { ledger, core } = setup({ holdings: { ledger: { [USDC_SOL]: "1020000", [BNB]: "1000000000000000000" } } });
  const w = (o: Record<string, unknown>) => problem(ledger, "ledger.withdraw", { tokenId: USDC_SOL, amount: "1", toAddress: SOL_ADDR, chain: "sol", ...o });
  assert.equal(await w({ toAddress: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" }), "ledger.address.invalid");
  assert.equal(await w({ chain: "base" }), "ledger.route.unavailable", "Solana USDC only goes home to Solana");
  assert.equal(await w({ amount: "0.0000001" }), "ledger.amount.invalid");
  assert.equal(await w({ amount: "abc" }), "ledger.amount.invalid");
  assert.equal(await w({}), "ledger.balance.low", "1 + 0.03 fee is more than 1.02");
  assert.equal(await w({ amount: "0.5", memo: "123" }), "ledger.memo.unsupported", "Solana takes no memo");
  assert.equal(await problem(ledger, "ledger.withdraw", { tokenId: BNB, amount: "0.1", toAddress: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", chain: "bsc" }), "ledger.route.unavailable", "HOT coins don't go home in V1");
  assert.equal(core.signed.length, 0, "nothing was signed");
});

test("withdraw below the bridge's minimum is refused with the minimum in the words", async () => {
  const { ledger } = setup({ holdings: { ledger: { [SOL]: "100000000" } } });
  const r = await ledger.call("ledger.withdraw", { tokenId: SOL, amount: "0.001", toAddress: SOL_ADDR, chain: "sol" });
  assert.ok("problem" in r && r.problem.code === "ledger.amount.below-minimum");
  assert.match((r as { problem: { whatHappened: string } }).problem.whatHappened, /0\.00125 SOL/);
});

test("a NEAR coin to a NEAR account: storage is paid first if the receiver has none, then one withdraw", async () => {
  const { ledger, core } = setup({ holdings: { ledger: { [USDC]: "5000000" } } });
  const m = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC, amount: "2", toAddress: "newbie.near", chain: "near" });
  assert.deepEqual(core.signed.map((r) => [r.receiverId, (r.actions[0] as { method: string }).method]), [[USDC.slice(7), "storage_deposit"], ["intents.near", "ft_withdraw"]]);
  assert.equal(core.requests.length, 1, "both steps on one sheet (fix/safe-steps-one-faceid, 7 Nov)");
  assert.deepEqual(args(core.signed[1]), { token: USDC.slice(7), receiver_id: "newbie.near", amount: "2000000" }, "no msg, so a refusal comes back");
  assert.equal(m.status, "done");
});

test("NEAR to a NEAR account is plain NEAR from the account, never wrapped NEAR out of the ledger", async () => {
  const { ledger, core } = setup({ holdings: { nearYocto: 2n * NEAR }, others: { "bob.near": { nearYocto: NEAR } } });
  await ok(ledger, "ledger.withdraw", { tokenId: "near", amount: "0.5", toAddress: "bob.near", chain: "near" });
  assert.deepEqual(core.signed[0], { receiverId: "bob.near", actions: [{ kind: "transfer", yocto: (NEAR / 2n).toString() }], why: "Send 0.5 NEAR to bob.near", from: "wallet" });
  assert.equal(await problem(ledger, "ledger.withdraw", { tokenId: "near", amount: "1.96", toAddress: "bob.near", chain: "near" }), "ledger.balance.low", "the fee reserve isn't spendable");
});

test("Send all the NEAR balances shows goes through on chain: the Send's own gas, taken up front, still leaves the storage covered", async () => {
  // The sandbox (nearcore 2.13.4, protocol 86, 1 Nov): an account holding 6.913389871 NEAR with 6,609 bytes; Send of all
  // its spendable NEAR with only 0.05 NEAR kept failed LackBalanceForState, 0.00133 short. NEAR takes the prepaid gas up
  // front at 1e9 yocto a gas unit (50 Tgas: 0.0509 NEAR with the conversion fee) and the contract's record of the payment
  // added 40 bytes. NEAR's rule, after the transfer and while the gas is out: balance >= storage.
  const balance = 6_913_389_871_330_040_500_000_000n;
  const bytes = 6_609n;
  const onChain = (sent: bigint, gas: bigint) => balance - sent - (gas * 1_000_000_000n + 908_893_467_222_000_000_000n) >= (bytes + 40n) * 10n ** 19n;
  const { ledger, core } = setup({ holdings: { nearYocto: balance, storageBytes: bytes }, others: { "bob.near": { nearYocto: NEAR } } });
  const row = (await ok<Balance[]>(ledger, "ledger.balances")).find((r) => r.tokenId === "near")!;
  await ok(ledger, "ledger.withdraw", { tokenId: "near", amount: row.amount, toAddress: "bob.near", chain: "near" });
  const sent = BigInt((core.signed[0]!.actions[0] as { yocto: string }).yocto);
  assert.equal(sent, balance - bytes * 10n ** 19n - FEE_RESERVE_YOCTO, "all of it: the row's amount, to the yocto");
  assert.equal(FEE_RESERVE_YOCTO, upfrontYocto(core.signed), "the reserve is exactly what this Send takes up front, with the slack");
  assert.ok(onChain(sent, 50_000_000_000_000n), "it goes through: the account keeps its storage while the gas is out");
  assert.ok(!onChain(balance - bytes * 10n ** 19n - 50_000_000_000_000_000_000_000n, 50_000_000_000_000n), "control: the old 0.05 NEAR reserve fails here, as it did on the sandbox");
  assert.equal(await problem(ledger, "ledger.withdraw", { tokenId: "near", amount: (Number(row.amount) + 0.000001).toFixed(6), toAddress: "bob.near", chain: "near" }), "ledger.balance.low", "a hair more is refused before the sheet");
  // NEAR into someone's NEAR Intents balance carries more gas (a wrap and ft_transfer_call): it keeps that much back, so
  // all of the row is refused with a plain answer, never sent to fail; what its room allows goes.
  const into = setup({ holdings: { nearYocto: 3n * NEAR }, others: { "carol.near": { nearYocto: NEAR } } });
  const all = (await ok<Balance[]>(into.ledger, "ledger.balances")).find((r) => r.tokenId === "near")!;
  assert.equal(await problem(into.ledger, "ledger.transfer", { tokenId: "near", amount: all.amount, toAccountId: "carol.near" }), "ledger.balance.low");
  const room = 3n * NEAR - upfrontYocto([{ actions: [{ kind: "call", method: "storage_deposit", args: {}, depositYocto: "0", gas: "10000000000000" }, { kind: "call", method: "near_deposit", args: {}, depositYocto: "0", gas: "10000000000000" }, { kind: "call", method: "ft_transfer_call", args: {}, depositYocto: "0", gas: "100000000000000" }] }]);
  assert.equal(room, 2_820_000_000_000_000_000_000_000n, "3 NEAR less the wrap-and-deposit's 170 Tgas up front and the slack");
  await ok(into.ledger, "ledger.transfer", { tokenId: "near", amount: "2.82", toAccountId: "carol.near" });
  assert.equal(into.core.signed.length, 1, "what its room allows goes");
});

test("transfer inside the ledger carries the memo, and coins sent to the account go straight into the receiver's balance", async () => {
  const { ledger, core } = setup({ holdings: { ledger: { [USDC_SOL]: "3000000" }, account: { [USDC]: "4000000" } } });
  const m = await ok<Movement>(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "2.5", toAccountId: "bob.near", memo: "split 2/4", label: "Dinner" });
  assert.deepEqual(args(core.signed[0]), { receiver_id: "bob.near", token_id: USDC_SOL, amount: "2500000", approval: null, memo: "split 2/4" });
  assert.deepEqual([m.kind, m.status, m.label], ["transfer", "done", "Dinner"]);
  await ok(ledger, "ledger.transfer", { tokenId: USDC, amount: "4", toAccountId: "bob.near" });
  assert.equal(core.signed[1].receiverId, USDC.slice(7));
  assert.deepEqual(args(core.signed[1]), { receiver_id: "intents.near", amount: "4000000", msg: "bob.near" }, "one transaction on the coin's own contract (D14)");
  assert.equal(await problem(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: ME }), "ledger.recipient.self");
  assert.equal(await problem(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "Bob" }), "ledger.recipient.invalid");
});

const BILL = '{"bill":"3"}';
const share = { tokenId: USDC_SOL, amount: "30", toAccountId: "trip.near", memo: "Dinner", msg: BILL, label: "Trip: Dinner" };
const kept = (units: bigint): CallResult => ({ kind: "kept", units });

test("a transfer with a msg is one mt_transfer_call, and what the receiver kept says how it ended", async () => {
  const reads: [string, string][] = [];
  const answers: CallResult[] = [kept(30_000_000n), kept(0n), { kind: "failed" }, kept(10_000_000n)];
  const { ledger, core } = setup({ holdings: { ledger: { [USDC_SOL]: "200000000" } }, readCall: async (tx, signer) => (reads.push([tx, signer]), answers.shift()!) });
  const paid = await ok<Movement>(ledger, "ledger.transfer", share);
  const a = core.signed[0].actions[0] as { method: string; gas: string };
  assert.deepEqual([core.signed[0].receiverId, a.method, a.gas], ["intents.near", "mt_transfer_call", "150000000000000"]);
  assert.deepEqual(args(core.signed[0]), { receiver_id: "trip.near", token_id: USDC_SOL, amount: "30000000", approval: null, memo: "Dinner", msg: BILL });
  assert.deepEqual([paid.status, paid.amount, paid.label], ["done", "30", "Trip: Dinner"]);
  assert.deepEqual(reads[0], ["tx1", ME], "read from the transaction this account signed");

  assert.equal((await ok<Movement>(ledger, "ledger.transfer", share)).status, "refunded", "the receiver sent it straight back");
  const refused = await ok<Movement>(ledger, "ledger.transfer", share);
  assert.deepEqual([refused.status, refused.problem?.code], ["problem", "ledger.send.failed"]);
  const part = await ok<Movement>(ledger, "ledger.transfer", share);
  assert.deepEqual([part.status, part.problem?.code, part.problem?.whatHappened], ["problem", "ledger.transfer.part-returned", "trip.near kept 10 USDC and sent the rest back."]);
  const rows = await ok<Movement[]>(ledger, "ledger.activity");
  assert.deepEqual(rows.map((m) => m.status).sort(), ["done", "problem", "problem", "refunded"], "kept on the device as they ended");
});

test("a share whose receipts show a refused step is never done; other sends trust the core, which reads every receipt", async () => {
  const reads: string[] = [];
  const t = setup({ holdings: { ledger: { [USDC_SOL]: "90000000" } }, readCall: async (tx) => (reads.push(tx), { kind: "failed" }) });
  const m = await ok<Movement>(t.ledger, "ledger.transfer", share);
  assert.deepEqual([m.status, m.problem?.code, m.problem?.whatHappened], ["problem", "ledger.send.failed", "NEAR didn't take it. Your coins never left your Safe."]);
  const plain = await ok<Movement>(t.ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" });
  assert.deepEqual([plain.status, reads], ["done", ["tx1"]], "a plain transfer isn't read again");
  const partly = { code: "security.send.partly", whatHappened: "Your account sent it, but a later step didn't work. Some of it may not have arrived.", money: { state: "needs-you", where: "x" }, next: { kind: "nothing", label: "OK" } } as const;
  const { ledger } = setup({ core: { sign: partly }, holdings: { ledger: { [USDC_SOL]: "90000000" } } });
  assert.equal(await problem(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" }), "security.send.partly", "the core's own words, never done");
});

test("a msg transfer comes from the ledger only, and an empty msg is still a transfer_call", async () => {
  const { ledger, core } = setup({ holdings: { account: { [USDC]: "40000000" }, nearYocto: 5n * NEAR }, readCall: async () => kept(1_000_000n) });
  assert.equal(await problem(ledger, "ledger.transfer", { ...share, tokenId: USDC }), "ledger.balance.low", "a NEAR coin on the account isn't moved in first");
  assert.equal(await problem(ledger, "ledger.transfer", { ...share, tokenId: "near", amount: "1" }), "ledger.balance.low");
  assert.equal(core.signed.length, 0, "nothing signed");
  const { ledger: l2, core: c2 } = setup({ holdings: { ledger: { [USDC_SOL]: "1000000" } }, readCall: async () => kept(1_000_000n) });
  await ok(l2, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near", msg: "" });
  assert.equal((c2.signed[0].actions[0] as { method: string }).method, "mt_transfer_call");
  assert.equal(args(c2.signed[0]).msg, "");
});

test("a share whose receipts can't be read yet is 'moving', then settles; never readable, it says so", async () => {
  let n = 0;
  const { ledger } = setup({ trackMs: 1, holdings: { ledger: { [USDC_SOL]: "90000000" } }, readCall: async () => (++n >= 3 ? kept(0n) : null) });
  const settled = update(ledger, (x) => x.status !== "moving");
  const m = await ok<Movement>(ledger, "ledger.transfer", share);
  assert.equal(m.status, "moving");
  assert.deepEqual([(await settled).status, n], ["refunded", 3]);

  let tries = 0;
  const { ledger: never } = setup({ trackMs: 1, holdings: { ledger: { [USDC_SOL]: "90000000" } }, readCall: async () => (tries++, null) });
  const gaveUp = update(never, (x) => x.status === "problem");
  await ok<Movement>(never, "ledger.transfer", share);
  const lost = await gaveUp;
  assert.deepEqual([lost.problem?.code, tries], ["ledger.send.unread", 31], "asked at once, then 30 more times, then says it can't see");
});

test("a share the protection holds is read from the transaction that finally sends it", async () => {
  const reads: string[] = [];
  const core = fakeCore({ accountId: ME, sign: "waiting" });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "90000000" } }), apis: createApis(replayFetch()), readCall: async (tx) => (reads.push(tx), kept(0n)) });
  const m = await ok<Movement>(ledger, "ledger.transfer", share);
  assert.deepEqual([m.status, reads.length], ["waiting", 0], "nothing has moved, so nothing to read");
  const ended = update(ledger, (x) => x.id === m.id);
  core.emit("account.waiting.ended", { id: m.held!.id, ended: "ran", txHash: "ranLater", explorerUrl: "https://nearblocks.io/txns/ranLater" });
  const row = await ended;
  assert.deepEqual([row.status, row.held, reads], ["refunded", undefined, ["ranLater"]]);
});

test("quotePay, same coin: amountIn = amountOut + fee, echoed exactly; pay signs it; a different coin is refused", async () => {
  const { ledger, core } = setup({ holdings: { ledger: { [USDC_SOL]: "5000000" } } });
  const to = { kind: "chain", chain: "sol", address: SOL_ADDR };
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: USDC_SOL, toTokenId: USDC_SOL, to, amountOut: "4.2" });
  assert.deepEqual([q.amountIn, q.amountInExpected, q.amountOut, q.refundTo, q.to], ["4.23", "4.23", "4.2", ME, to]);
  assert.match(q.feeNote, /0\.03 USDC/);
  assert.equal(core.signed.length, 0, "a quote signs nothing");
  const m = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id, label: "Kiosk" });
  assert.deepEqual([m.kind, m.label, args(core.signed[0]).amount], ["pay", "Kiosk", "4230000"]);
  assert.equal(await problem(ledger, "ledger.pay", { quoteId: q.id }), "ledger.quote.expired", "a quote is used once");
  assert.equal(await problem(ledger, "ledger.quotePay", { fromTokenId: USDC, toTokenId: USDC_SOL, to, amountOut: "1" }), "ledger.quote.unavailable");
});

test("a quote says what the protection will do with it, as the sheet will; a price that can't wait reads as wait", async () => {
  const to = { kind: "chain", chain: "sol", address: SOL_ADDR };
  const quote = (describe?: CoreOptions["describe"]) =>
    ok<PayQuote>(setup({ core: { describe }, holdings: { ledger: { [USDC_SOL]: "5000000" } } }).ledger, "ledger.quotePay", { fromTokenId: USDC_SOL, toTokenId: USDC_SOL, to, amountOut: "4.2" });
  const held = { level: "wait" as const, waitSeconds: 86400, text: "This waits 24 hours before it's sent." };
  assert.deepEqual((await quote(held)).protection, held);
  assert.equal((await quote({ level: "faceid", waitSeconds: 0, text: "Sent at once." })).protection?.level, "faceid");
  const cantWait = { code: "security.quote.cant-wait", whatHappened: "A payment this big has to wait, but its price lasts only about a minute, so we stopped.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } as const;
  assert.deepEqual((await quote(cantWait)).protection, { level: "wait", waitSeconds: 0, text: cantWait.whatHappened }, "never offered as Face ID");
  assert.equal((await quote()).protection, undefined, "no protection contract, or not readable: left out, and the sheet still says it");
});

test("pay after the quote ran out is refused", async () => {
  let t = Date.parse("2026-10-25T09:00:00Z");
  const core = fakeCore({ accountId: ME });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "5000000" } }), apis: createApis(replayFetch()), now: () => t, readCall: ran });
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: USDC_SOL, toTokenId: USDC_SOL, to: { kind: "chain", chain: "sol", address: SOL_ADDR }, amountOut: "1" });
  t += 61_000;
  assert.equal(await problem(ledger, "ledger.pay", { quoteId: q.id }), "ledger.quote.expired");
  assert.equal(core.signed.length, 0);
});

test("grade 02h, H6: a quote on NEAR itself lasts ten minutes, and pay() has the core read its words at once, beside its own reads", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  let t = Date.parse("2026-11-02T06:00:00Z");
  const inner = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const order: string[] = [];
  const core: Bridge = { on: inner.on.bind(inner), call: <T,>(m: string, p?: Record<string, unknown>) => (order.push(m), inner.call<T>(m, p)) };
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran, now: () => t });
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to: { kind: "chain", chain: "near", address: "guest-book.testnet" }, amountOut: "0.01" });
  // The quote too: a plain NEAR send's words are read ahead, before the coin list and the account are read (wNEAR,
  // Pay's name for NEAR, the same), and the account's ready state is kept, not asked again.
  order.length = 0;
  await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: "nep141:wrap.near", toTokenId: "nep141:wrap.near", to: { kind: "chain", chain: "near", address: "guest-book.testnet" }, amountOut: "0.01" });
  assert.deepEqual(order.filter((m) => m === "tx.describe" || m === "account.nearPrice" || m === "account.state"), ["tx.describe", "account.nearPrice", "tx.describe"], order.join(" "));
  t += 5 * 60_000;
  order.length = 0;
  await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id });
  assert.equal(inner.signed.length, 1, "five minutes on, still paid");
  assert.ok(order.indexOf("tx.describe") >= 0 && order.indexOf("tx.describe") < order.indexOf("tx.request"), order.join(" "));
  assert.ok(order.indexOf("account.state") > order.indexOf("tx.describe"), `asked before the ledger's own reads: ${order.join(" ")}`);
  t += 11 * 60_000;
  const q2 = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to: { kind: "chain", chain: "near", address: "guest-book.testnet" }, amountOut: "0.01" });
  t += 11 * 60_000;
  assert.equal(await problem(ledger, "ledger.pay", { quoteId: q2.id }), "ledger.quote.expired");
});

test("a no on the approval sheet is ledger.signature.declined; a core Problem comes through as it is", async () => {
  const declined = setup({ core: { sign: "declined" }, holdings: { ledger: { [USDC_SOL]: "5000000" } } });
  assert.equal(await problem(declined.ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" }), "ledger.signature.declined");
  const refused = setup({ core: { sign: { code: "security.balance.low-coin", whatHappened: "x", money: { state: "safe", where: "y" }, next: { kind: "nothing", label: "OK" } } }, holdings: { ledger: { [USDC_SOL]: "5000000" } } });
  assert.equal(await problem(refused.ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" }), "security.balance.low-coin");
  assert.deepEqual(await ok<Movement[]>(declined.ledger, "ledger.activity"), [], "nothing is remembered when nothing moved");
});

test("sending waits for the backup words, like receiving", async () => {
  const { ledger } = setup({ core: { stage: "needs-backup" }, holdings: { ledger: { [USDC_SOL]: "5000000" } } });
  assert.equal(await problem(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" }), "security.backup.needed");
});

test("activity lists the deposits the bridge has seen, dated when first seen, with a Problem for a failed one", async () => {
  const deposits = [
    { tx_hash: "solDep1", chain: "sol:mainnet", near_token_id: USDC_SOL.slice(7), amount: "5000000", address: "x", status: "COMPLETED" },
    { tx_hash: "solDep2", chain: "sol:mainnet", near_token_id: "sol.omft.near", amount: "400000", address: "x", status: "PENDING" },
    { tx_hash: "solDep3", chain: "sol:mainnet", near_token_id: "sol.omft.near", amount: "1", address: "x", status: "FAILED" },
  ];
  const { ledger } = setup({ replay: { deposits } });
  const rows = await ok<Movement[]>(ledger, "ledger.activity");
  const byTx = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([byTx["deposit:solDep1"].status, byTx["deposit:solDep1"].amount, byTx["deposit:solDep1"].from], ["done", "5", "sol"]);
  assert.equal(byTx["deposit:solDep2"].status, "moving");
  assert.equal(byTx["deposit:solDep3"].problem?.code, "ledger.deposit.failed");
  assert.ok(byTx["deposit:solDep1"].explorerUrls[0].includes("solscan.io/tx/solDep1"));
  const again = await ok<Movement[]>(ledger, "ledger.activity");
  assert.equal(again.find((r) => r.id === "deposit:solDep1")!.startedAtIso, byTx["deposit:solDep1"].startedAtIso, "the first-seen time stays");
});

test("with the account contract, paying a receiver's storage and the send are ONE approval (execute_many)", async () => {
  const chain = fakeNear(ME, { ledger: { [USDC]: "5000000" }, nearYocto: 2n * NEAR });
  chain.accounts.get(ME)!.codeHash = ACCOUNT_POLICY.codeHashBase58;
  const { ledger, core } = setup({ chain });
  await ok(ledger, "ledger.withdraw", { tokenId: USDC, amount: "2", toAddress: "newbie.near", chain: "near" });
  assert.equal(core.signed.length, 1, "one approval");
  const [one] = core.signed;
  assert.equal(one.receiverId, USDC.slice(7));
  assert.equal((one.actions[0] as { method: string }).method, "storage_deposit");
  assert.deepEqual(one.then?.map((t) => [t.receiverId, (t.actions[0] as { method: string }).method]), [["intents.near", "ft_withdraw"]]);
  assert.equal(one.why, "Send 2 USDC to newbie.near");
});

// Held requests (D17) and converting.

test("a send the account's protection holds is 'waiting' with its hold, never done, and isn't followed yet", async () => {
  const { ledger, fetch } = setup({ core: { sign: "waiting" }, holdings: { ledger: { [USDC_SOL]: "5000000" } } });
  const m = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC_SOL, amount: "1", toAddress: SOL_ADDR, chain: "sol" });
  assert.equal(m.status, "waiting");
  assert.deepEqual(m.held, { id: "held-1", readyAtIso: "2026-10-26T09:00:00.000Z", needsSecondDevice: false });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetch.calls.filter((c) => c.body?.method === "withdrawal_status").length, 0, "nothing to follow until it's sent");
  assert.equal((await ok<Movement[]>(ledger, "ledger.activity"))[0].status, "waiting");
});

const OPEN = { intents: true, nearOrigin: true };
const USDT = "nep141:usdt.tether-token.near";
function convertSetup(o: { routes?: { intents: boolean; nearOrigin: boolean }; holdings?: Holdings; replay?: ReplayOptions; sign?: CoreOptions["sign"]; readCall?: ReadCall }) {
  const core = fakeCore({ accountId: ME, sign: o.sign });
  const fetch = replayFetch(o.replay);
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, o.holdings ?? {}), apis: createApis(fetch), routes: o.routes ?? OPEN, trackMs: 5, readCall: o.readCall ?? ran });
  return { core, fetch, ledger };
}

test("converting stays shut until the test proof opens a route", async () => {
  const { ledger } = setup({ holdings: { ledger: { [USDC]: "5000000" } } });
  const r = await ledger.call("ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" });
  assert.ok("problem" in r && r.problem.code === "ledger.quote.unavailable");
});

test("route A: a dry quote to show, then a real one, funded by mt_transfer of exactly amountIn, followed until delivered", async () => {
  const { ledger, core, fetch } = convertSetup({ routes: { intents: true, nearOrigin: false }, holdings: { ledger: { [USDC]: "5000000" } }, replay: { statuses: ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"] } });
  const q = await ok<Quote>(ledger, "ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" });
  assert.deepEqual([q.amountIn, q.amountOut, q.minOut, q.etaSeconds], ["1", "1.000948", "0.995943", 10]);
  assert.match(q.feeNote, /^Fees about \$0\.00 \(0\.00%\)/, "dollars next to percent");
  assert.equal(core.signed.length, 0, "a quote signs nothing");
  assert.equal(fetch.calls.find((c) => c.url.endsWith("/quote"))!.body.dry, true);
  const heard: Movement[] = [];
  ledger.on<{ movement: Movement }>("ledger.movementUpdated", (e) => heard.push(e.movement));
  const m = await ok<Movement>(ledger, "ledger.convert", { quoteId: q.id });
  const real = fetch.calls.filter((c) => c.url.endsWith("/quote"))[1].body;
  assert.deepEqual([real.dry, real.depositType, real.refundTo, real.refundType, real.recipient, real.recipientType], [false, "INTENTS", ME, "INTENTS", ME, "INTENTS"]);
  assert.deepEqual(args(core.signed[0]), { receiver_id: QUOTE_ADDRESS, token_id: USDC, amount: "1000000", approval: null });
  assert.deepEqual([m.kind, m.status, m.from, m.to, m.amount], ["convert", "moving", USDC, USDT, "1"]);
  assert.ok(fetch.calls.some((c) => c.url.endsWith("/deposit/submit")), "1Click is told about the deposit");
  // wait on the state, never a fixed time (a loaded parallel run took longer than 60 ms): up to 5 s
  for (let i = 0; i < 250 && heard.at(-1)?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heard.at(-1)!.status, "done");
  assert.equal(await problem(ledger, "ledger.convert", { quoteId: q.id }), "ledger.quote.expired", "a quote is used once");
});

test("route B from the ledger: 1Click's NEAR address gets its storage, then an ft_withdraw (no msg)", async () => {
  const { ledger, core, fetch } = convertSetup({ routes: { intents: false, nearOrigin: true }, holdings: { ledger: { "nep141:wrap.near": (10n ** 24n).toString() } } });
  const q = await ok<Quote>(ledger, "ledger.quoteConvert", { from: "nep141:wrap.near", to: USDC, amount: "0.2" });
  await ok(ledger, "ledger.convert", { quoteId: q.id });
  assert.equal(fetch.calls.filter((c) => c.url.endsWith("/quote"))[1].body.depositType, "ORIGIN_CHAIN");
  assert.deepEqual(core.signed.map((r) => [r.receiverId, (r.actions[0] as { method: string }).method]), [["wrap.near", "storage_deposit"], ["intents.near", "ft_withdraw"]]);
  assert.deepEqual(args(core.signed[1]), { token: "wrap.near", receiver_id: QUOTE_ADDRESS, amount: "200000000000000000000000" });
});

test("route B from NEAR on the account: one wrap.near transaction pays the quote; the account's own storage step only while it isn't set up on wrap.near", async () => {
  for (const [what, holdings, want] of [
    ["not set up", { nearYocto: 2n * NEAR, unregistered: ["wrap.near"] }, ["storage_deposit", "storage_deposit", "near_deposit", "ft_transfer"]],
    ["set up already: left out", { nearYocto: 2n * NEAR }, ["storage_deposit", "near_deposit", "ft_transfer"]],
    ["its read failed: kept", { nearYocto: 2n * NEAR, storageReadFails: true }, ["storage_deposit", "storage_deposit", "near_deposit", "ft_transfer"]],
  ] as const) {
    const { ledger, core } = convertSetup({ routes: { intents: true, nearOrigin: true }, holdings: holdings as Holdings });
    const q = await ok<Quote>(ledger, "ledger.quoteConvert", { from: "near", to: USDC, amount: "0.2" });
    await ok(ledger, "ledger.convert", { quoteId: q.id });
    assert.equal(core.signed.length, 1, what);
    assert.equal(core.signed[0].receiverId, "wrap.near", what);
    assert.deepEqual(core.signed[0].actions.map((a) => (a as { method: string }).method), want, what);
  }
});

test("convert refuses if the real quote promises less than the one shown; nothing is signed", async () => {
  const { ledger, core } = convertSetup({ holdings: { ledger: { [USDC]: "5000000" } }, replay: { worse: true } });
  const q = await ok<Quote>(ledger, "ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" });
  assert.equal(await problem(ledger, "ledger.convert", { quoteId: q.id }), "ledger.quote.expired");
  assert.equal(core.signed.length, 0);
});

test("convert: a coin no open route takes, too little, a refund, a failure, and a held one", async () => {
  const hot = convertSetup({ routes: { intents: false, nearOrigin: true }, holdings: { ledger: { [BNB]: (10n ** 18n).toString() } } });
  assert.equal(await problem(hot.ledger, "ledger.quoteConvert", { from: BNB, to: USDC, amount: "0.1" }), "ledger.quote.unavailable", "route B takes only NEAR's own coins");
  const poor = convertSetup({ holdings: { ledger: { [USDC]: "500000" } } });
  assert.equal(await problem(poor.ledger, "ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" }), "ledger.balance.low");
  for (const [end, status, code] of [["REFUNDED", "refunded", undefined], ["FAILED", "problem", "ledger.convert.failed"]] as const) {
    const c = convertSetup({ holdings: { ledger: { [USDC]: "5000000" } }, replay: { statuses: [end] } });
    const heard: Movement[] = [];
    c.ledger.on<{ movement: Movement }>("ledger.movementUpdated", (e) => heard.push(e.movement));
    await ok(c.ledger, "ledger.convert", { quoteId: (await ok<Quote>(c.ledger, "ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" })).id });
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual([heard.at(-1)!.status, heard.at(-1)!.problem?.code], [status, code]);
  }
  const held = convertSetup({ holdings: { ledger: { [USDC]: "5000000" } }, sign: "waiting" });
  const m = await ok<Movement>(held.ledger, "ledger.convert", { quoteId: (await ok<Quote>(held.ledger, "ledger.quoteConvert", { from: USDC, to: USDT, amount: "1" })).id });
  assert.equal(m.status, "waiting");
  assert.ok(!held.fetch.calls.some((c) => c.url.endsWith("/deposit/submit")), "1Click isn't told about a deposit that hasn't happened");
});

test("a held withdraw that this phone sends later is followed like any other; a cancelled one says nothing moved", async () => {
  const core = fakeCore({ accountId: ME, sign: "waiting" });
  const replay: ReplayOptions = { withdrawals: { sentLater: [{ status: "COMPLETED", data: { transfer_tx_hash: "solTx9" } }] } };
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "9000000" } }), apis: createApis(replayFetch(replay)), trackMs: 5, readCall: ran });
  const heard: Movement[] = [];
  ledger.on<{ movement: Movement }>("ledger.movementUpdated", (e) => heard.push(e.movement));
  const a = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC_SOL, amount: "1", toAddress: SOL_ADDR, chain: "sol" });
  const b = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC_SOL, amount: "2", toAddress: SOL_ADDR, chain: "sol" });
  core.emit("account.waiting.ended", { id: a.held!.id, ended: "ran", txHash: "sentLater", explorerUrl: "https://nearblocks.io/txns/sentLater" });
  core.emit("account.waiting.ended", { id: b.held!.id, ended: "cancelled", txHash: "", explorerUrl: "" });
  await new Promise((r) => setTimeout(r, 60));
  const rows = await ok<Movement[]>(ledger, "ledger.activity");
  const ra = rows.find((m) => m.id === a.id)!, rb = rows.find((m) => m.id === b.id)!;
  assert.deepEqual([ra.status, ra.held, ra.explorerUrls.includes("https://solscan.io/tx/solTx9")], ["done", undefined, true], "sent, then followed until it landed");
  assert.deepEqual([rb.status, rb.problem?.code], ["problem", "ledger.hold.cancelled"]);
});

test("on an account that can't chain steps, a held first step that runs later never reads as done: the rest wasn't sent", async () => {
  const core = fakeCore({ accountId: ME, sign: "waiting" });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC]: "5000000" } }), apis: createApis(replayFetch()), readCall: ran });
  const m = await ok<Movement>(ledger, "ledger.withdraw", { tokenId: USDC, amount: "2", toAddress: "newbie.near", chain: "near" });
  assert.deepEqual([m.status, core.signed.length], ["waiting", 1], "the storage step was held; the withdraw was never sent");
  // the audit's C2 (7 Nov): one sheet for both; the core's hold on step 1 drops the rest (unsent), so the end below is the truth
  assert.deepEqual(core.requests.map((r) => r.apart), [true]);
  const ended = update(ledger, (x) => x.id === m.id);
  core.emit("account.waiting.ended", { id: m.held!.id, ended: "ran", txHash: "storageRan", explorerUrl: "" });
  const row = await ended;
  assert.deepEqual([row.status, row.problem?.code], ["problem", "ledger.hold.part-sent"]);
  // the audit's C2 MUST (7 Nov): never a Done-only dead end; one choice, the Send's own sheet again (a new Face ID)
  assert.deepEqual(row.problem?.next, { kind: "open", label: "Finish the move", screen: "money/send" });
  assert.deepEqual([row.problem?.money, row.problem?.more], [{ state: "safe", where: "in your Safe" }, "Step 1: Done. The rest: Not sent."]);
});

test("a hold ended on another device is settled from the account's history when activity is read", async () => {
  const core = fakeCore({ accountId: ME, sign: "waiting", waitingStatus: { "held-1": { state: "declined" } } });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "5000000" } }), apis: createApis(replayFetch()), readCall: ran });
  await ok(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" });
  const [m] = await ok<Movement[]>(ledger, "ledger.activity");
  assert.deepEqual([m.status, m.problem?.code], ["problem", "ledger.hold.declined"]);
});

test("J3 C1: a coin we can't receive is named in words on its Problem, never by its id ('near on near' reached the demo)", async () => {
  const { ledger } = setup();
  const words = async (params: Record<string, unknown>) => {
    const r = await ledger.call("ledger.depositAddress", params);
    assert.ok("problem" in r && r.problem.code === "ledger.token.unsupported", JSON.stringify(params));
    return r.problem.more ?? "";
  };
  assert.equal(await words({ chain: "near", token: SOL }), "SOL on NEAR");
  assert.equal(await words({ chain: "near", token: "nep141:some-new-token.near" }), "That coin on NEAR");
  assert.equal(await words({ chain: "sol", token: USDC }), "USDC on Solana");
  for (const more of [await words({ chain: "near", token: BNB }), await words({ chain: "sol", token: "near" })]) assert.doesNotMatch(more, /nep\d{3}:|\.omft\.near|\bnear on\b/);
});

test("D85: a pay asked to go privately with a quote that isn't Private's is refused, never paid from the main balance", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet", activity: [] });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: ran });
  const to = { kind: "chain", chain: "near", address: "guest-book.testnet" };
  const q = await ok<PayQuote>(ledger, "ledger.quotePay", { fromTokenId: NATIVE_NEAR, toTokenId: NATIVE_NEAR, to, amountOut: "0.01" });
  const r = await ledger.call("ledger.pay", { quoteId: q.id, confidential: true });
  assert.ok("problem" in r && r.problem.code === "ledger.private.unavailable", JSON.stringify(r));
  assert.equal(core.signed.length, 0, "nothing was asked to be signed");
  // control: the same quote without the flag pays (the guard is the flag, nothing else)
  const m = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id });
  assert.equal(m.to, "guest-book.testnet");
  assert.ok(core.signed.length > 0, "control: a pay does ask for a signature");
});
