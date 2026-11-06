// The Add (ledger.toTrading, TRADE-FLOAT §1 S7): dollars of USDC from the main balance into the Trading balance. The
// core quotes it itself (subwallet.float.quoteAdd: recipient and refunds the float, confidentially); the ledger pays it
// like toPrivate's route B, one ft_withdraw from intents.near of exactly amountIn to 1Click's deposit address.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createApis } from "./apis.ts";
import { ADD_QUOTE_MS, TRADING_USDC, checkAddQuote, createLedgerService, type AddQuote } from "./ledger.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch, type CoreOptions } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const ME = "kid.near";
const RELAY = "https://quotes.example";
const SERVER = `${RELAY}/v0`;
const T0 = Date.parse("2026-10-27T10:00:00.000Z");

/** 1Click's deposit address with its USDC storage already paid (the fake chain knows it). */
const REGISTERED = "3e".repeat(32);

function setup(o: { core?: CoreOptions; usdc?: string; wnear?: string; nearYocto?: bigint; storageBytes?: bigint; now?: () => number; relay?: boolean; status?: "SUCCESS" | "REFUNDED" | "FAILED" } = {}) {
  const now = o.now ?? (() => T0);
  const core = fakeCore({ accountId: ME, now, ...o.core });
  const fetch = replayFetch({ privateQuotes: SERVER, ...(o.status ? { privateStatus: o.status } : {}) });
  const ledger = createLedgerService({
    bridge: core,
    chain: fakeNear(ME, { ledger: { [TRADING_USDC]: o.usdc ?? "500000000", "nep141:wrap.near": o.wnear ?? "0" }, ...(o.nearYocto === undefined ? {} : { nearYocto: o.nearYocto, storageBytes: o.storageBytes ?? 0n }) }, { [REGISTERED]: { account: { [TRADING_USDC]: "0" } } }),
    apis: createApis(fetch),
    trackMs: 5,
    now,
    readCall: async () => ({ kind: "ran" }),
    ...(o.relay === false ? {} : { privateQuotes: RELAY }),
  });
  return { core, fetch, ledger };
}
const ok = async <T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> => {
  const r = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const problem = async (ledger: Bridge, method: string, params?: Record<string, unknown>) => {
  const r = await ledger.call(method, params);
  assert.ok("problem" in r, `${method} should be refused`);
  return r.problem;
};
const quote = (patch: Partial<AddQuote> = {}): AddQuote => ({ depositAddress: QUOTE_ADDRESS, amountIn: "10000000", minAmountOut: "10000000", deadlineIso: new Date(T0 + 10 * 60_000).toISOString(), ...patch });
const code = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ProblemError ? e.problem.code : String(e);
  }
};

test("the amount: dollars of USDC as text become smallest units as text, exactly; anything else is refused before the core is asked", async () => {
  const { ledger, core } = setup();
  await ok<Movement>(ledger, "ledger.toTrading", { amount: "10" });
  await ok<Movement>(ledger, "ledger.toTrading", { amount: "10.5" });
  await ok<Movement>(ledger, "ledger.toTrading", { amount: "2.000001" });
  assert.deepEqual(core.asked.map((a) => a.amount), ["10000000", "10500000", "2000001"]);
  for (const amount of ["", "ten", "1e3", "-5", "0", "10.0000001", 10, "10,5"]) {
    assert.equal((await problem(ledger, "ledger.toTrading", { amount })).code, "ledger.amount.invalid", `amount ${JSON.stringify(amount)}`);
  }
  assert.equal(core.asked.length, 3, "a bad amount never reaches the core");
});

test("under $2 the core refuses (security.request.not-allowed), and that Problem comes through in its own words", async () => {
  const { ledger, core } = setup();
  const p = await problem(ledger, "ledger.toTrading", { amount: "1.99" });
  assert.equal(p.code, "security.request.not-allowed");
  assert.match(p.whatHappened, /under \$2/);
  assert.equal(core.signed.length, 0, "nothing was signed");
});

test("checkAddQuote: another amount, a bad address or a malformed quote is security.quote.mismatch; a past deadline is expired; the deadline is cut to 30 minutes", () => {
  const wanted = 10_000_000n;
  assert.equal(code(() => checkAddQuote(quote(), wanted, T0)), null);
  assert.equal(code(() => checkAddQuote(quote({ amountIn: "10000001" }), wanted, T0)), "security.quote.mismatch", "a different amount");
  assert.equal(code(() => checkAddQuote(quote({ amountIn: "9999999" }), wanted, T0)), "security.quote.mismatch");
  assert.equal(code(() => checkAddQuote(quote({ depositAddress: "not-an-address" }), wanted, T0)), "security.quote.mismatch");
  assert.equal(code(() => checkAddQuote(quote({ depositAddress: QUOTE_ADDRESS.toUpperCase() }), wanted, T0)), "security.quote.mismatch", "1Click's NEAR address is lower-case hex");
  assert.equal(code(() => checkAddQuote(quote({ minAmountOut: "" }), wanted, T0)), "security.quote.mismatch");
  assert.equal(code(() => checkAddQuote({ ...quote(), amountIn: 10000000 as unknown as string }, wanted, T0)), "security.quote.mismatch", "units are text");
  assert.equal(code(() => checkAddQuote(quote({ deadlineIso: new Date(T0).toISOString() }), wanted, T0)), "ledger.quote.expired", "at the deadline");
  assert.equal(code(() => checkAddQuote(quote({ deadlineIso: new Date(T0 - 1).toISOString() }), wanted, T0)), "ledger.quote.expired");
  assert.equal(code(() => checkAddQuote(quote({ deadlineIso: "soon" }), wanted, T0)), "ledger.quote.expired");
  assert.equal(checkAddQuote(quote(), wanted, T0).deadlineMs, T0 + 10 * 60_000, "the core's own deadline when it's sooner");
  assert.equal(checkAddQuote(quote({ deadlineIso: new Date(T0 + 2 * 3600_000).toISOString() }), wanted, T0).deadlineMs, T0 + ADD_QUOTE_MS, "never good for more than 30 minutes");
});

test("a quote that doesn't match what was asked, or has run out, is refused before anything reaches the sheet", async () => {
  const mismatch = setup({ core: { quoteAdd: { amountIn: "9000000" } } });
  assert.equal((await problem(mismatch.ledger, "ledger.toTrading", { amount: "10" })).code, "security.quote.mismatch");
  assert.equal(mismatch.core.signed.length, 0, "nothing was signed");
  const late = setup({ core: { quoteAdd: { deadlineIso: new Date(T0 - 1000).toISOString() } } });
  assert.equal((await problem(late.ledger, "ledger.toTrading", { amount: "10" })).code, "ledger.quote.expired");
  assert.equal(late.core.signed.length, 0);
  const refused = setup({ core: { quoteAdd: { code: "security.subwallet.refused", whatHappened: "1Click's quote isn't the one asked for.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } });
  assert.equal((await problem(refused.ledger, "ledger.toTrading", { amount: "10" })).code, "security.subwallet.refused", "the core's own refusal comes through as it is");
});

test("the Add is paid like toPrivate's route B: one ft_withdraw from intents.near of exactly amountIn to the deposit address, then followed to done", async () => {
  const { ledger, core, fetch } = setup({ core: { quoteAdd: { depositAddress: REGISTERED } } });
  const done = new Promise<Movement>((resolve) => ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.status === "done" && resolve(movement)));
  const m = await ok<Movement>(ledger, "ledger.toTrading", { amount: "10", label: "Add $10.00 to Trading", caller: "trade" });
  assert.deepEqual([m.kind, m.from, m.to, m.amount, m.status, m.label, m.caller], ["trading", TRADING_USDC, "trading", "10", "moving", "Add $10.00 to Trading", "trade"]);
  assert.equal(m.id, "trading:tx1");
  assert.equal(core.signed.length, 1, "one approval: the address had storage already");
  const last = core.signed[0]!;
  const a = last.actions[0] as { method: string; args: Record<string, unknown> };
  assert.deepEqual([last.receiverId, a.method, a.args.token, a.args.receiver_id, a.args.amount, a.args.msg, last.why], ["intents.near", "ft_withdraw", TRADING_USDC.slice("nep141:".length), REGISTERED, "10000000", undefined, "Move 10 USDC to your NEAR wallet"]);
  assert.ok(!JSON.stringify(core.asked).includes(ME), "the quote never carries the main account's name");
  assert.deepEqual(core.asked, [{ amount: "10000000" }], "smallest units as text, and nothing else (the shell's forApps stamps the asking app)");
  const ended = await done;
  assert.deepEqual([ended.id, ended.kind, ended.status], [m.id, "trading", "done"]);
  assert.ok(!fetch.calls.some((c) => c.url.endsWith("/deposit/submit")), "P-4: no dead deposit notice through the relay");
  assert.ok(fetch.calls.some((c) => c.url.startsWith(`${SERVER}/status`)), "and followed through it");
  const activity = await ok<Movement[]>(ledger, "ledger.activity");
  assert.equal(activity[0]?.id, m.id, "it's in Activity");
});

test("a deposit address without storage gets it first: two approvals (storage, then the withdraw)", async () => {
  const { ledger, core } = setup();
  await ok<Movement>(ledger, "ledger.toTrading", { amount: "10" });
  assert.equal(core.signed.length, 2);
  assert.deepEqual(core.signed.map((r) => (r.actions[0] as { method: string }).method), ["storage_deposit", "ft_withdraw"]);
  const storage = core.signed[0]!.actions[0] as { args: { account_id: string }; depositYocto: string };
  assert.deepEqual([core.signed[0]!.receiverId, storage.args.account_id, storage.depositYocto], [TRADING_USDC.slice("nep141:".length), QUOTE_ADDRESS, "1250000000000000000000"], "the coin contract's own minimum, read on chain");
});

test("the job's states: held by the protection it waits (nothing moved); a no is declined; a refund ends refunded; too little USDC is refused before the core", async () => {
  const held = setup({ core: { sign: "waiting" } });
  const w = await ok<Movement>(held.ledger, "ledger.toTrading", { amount: "10" });
  assert.deepEqual([w.status, w.held?.id, w.kind], ["waiting", "held-1", "trading"]);
  assert.ok(!held.fetch.calls.some((c) => c.url === `${SERVER}/deposit/submit`), "1Click isn't told while nothing has moved");

  const no = setup({ core: { sign: "declined" } });
  assert.equal((await problem(no.ledger, "ledger.toTrading", { amount: "10" })).code, "ledger.signature.declined");

  const poor = setup({ usdc: "5000000" });
  assert.equal((await problem(poor.ledger, "ledger.toTrading", { amount: "10" })).code, "ledger.balance.low");
  assert.equal(poor.core.asked.length, 0, "the core isn't asked for a quote the balance can't pay");

  // 1Click sends it back (to the float, by the quote's own terms): the movement ends refunded, never done.
  const refunded = setup({ status: "REFUNDED" });
  const back = new Promise<Movement>((resolve) => refunded.ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.status !== "moving" && resolve(movement)));
  const m = await ok<Movement>(refunded.ledger, "ledger.toTrading", { amount: "10" });
  assert.equal(m.status, "moving");
  assert.equal((await back).status, "refunded");

  // 1Click's own no: a Problem, and the words say where the money is.
  const failed = setup({ status: "FAILED" });
  const ended = new Promise<Movement>((resolve) => failed.ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.status !== "moving" && resolve(movement)));
  await ok<Movement>(failed.ledger, "ledger.toTrading", { amount: "10" });
  const f = await ended;
  // a Top up's refund goes to Spending's cash (the Add quote's refundTo), never "your balance": its Spending row's words
  assert.deepEqual([f.status, f.problem?.code, f.problem?.money], ["problem", "ledger.topup.failed", { state: "on-the-way", where: "with NEAR Intents. It ends up in your NEAR wallet" }]);
  assert.equal(f.problem?.more, `NEAR Intents is still finishing it (its id: ${f.depositAddress}) · if not, the money comes back to your NEAR wallet`);
  assert.ok(f.depositAddress, "control: the id it names is the Top up's own deposit address");
  assert.doesNotMatch(`${f.problem?.whatHappened} ${f.problem?.more}`, /your Safe|conversion/, "never Convert's words");
});

test("1Click's FAILED for a Top up says the words its Spending row says (512f3d3f addEnd); a Convert's FAILED keeps its own", async () => {
  const { addEnd } = await import("../../trade/src/float-core.ts");
  const { walletProblems } = await import("./wallet-problems.ts");
  const dep = "3".repeat(64);
  const p = walletProblems.topUpFailed(dep);
  assert.equal(p.more, addEnd({ status: "problem", problem: { code: p.code }, depositAddress: dep }).note, "Wallet's Activity and Trading's row: one story");
  assert.match(walletProblems.convertFailed().more!, /back to your Safe/, "control: Convert's own refund comes back to the Safe");
});

test("who may ask: Wallet and Trade; Pay or any other app is refused before anything is read; a child's or unready account is refused by the core's state", async () => {
  const { ledger, core } = setup();
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "10", caller: "pay" })).code, "ledger.caller.refused");
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "10", caller: "browser" })).code, "ledger.caller.refused");
  assert.equal(core.asked.length, 0);
  const unready = setup({ core: { stage: "needs-backup" } });
  assert.equal((await problem(unready.ledger, "ledger.toTrading", { amount: "10" })).code, "security.backup.needed");
});

test("a label is the app's own words: too long or with a control character it's refused; kept to 60", async () => {
  const { ledger } = setup();
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "10", label: "x".repeat(81) })).code, "ledger.label.invalid");
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "10", label: "Add‮" })).code, "ledger.label.invalid");
  const m = await ok<Movement>(ledger, "ledger.toTrading", { amount: "10", label: `${"y".repeat(70)}` });
  assert.equal(m.label?.length, 60);
});

test("the Add paid in another coin of the main balance: the core quotes that coin (converted inside the Add), the ledger pays exactly that much of it", async () => {
  const WNEAR = "nep141:wrap.near";
  const { ledger, core } = setup({ wnear: "9000000000000000000000000" });
  const m = await ok<Movement>(ledger, "ledger.toTrading", { amount: "5", tokenId: WNEAR });
  assert.deepEqual(core.asked.at(-1), { amount: "5000000000000000000000000", tokenId: WNEAR }, "the coin's own smallest units, and which coin");
  const withdraw = core.signed.flatMap((r) => r.actions).find((a: any) => a.kind === "call" && a.method === "ft_withdraw") as any;
  assert.deepEqual([withdraw.args.token, withdraw.args.receiver_id, withdraw.args.amount], ["wrap.near", QUOTE_ADDRESS, "5000000000000000000000000"], "exactly the quote's amountIn, to its deposit address");
  assert.equal(core.signed.at(-1)!.why, "Move 5 NEAR to your NEAR wallet", "named as 1Click's list names it");
  assert.deepEqual([m.kind, m.from, m.to, m.amount], ["trading", WNEAR, "trading", "5"]);
  // USDC stays as it was: dollars, and no tokenId to the core.
  await ok<Movement>(ledger, "ledger.toTrading", { amount: "10" });
  assert.deepEqual(core.asked.at(-1), { amount: "10000000" });
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "20", tokenId: WNEAR })).code, "ledger.balance.low");
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "1", tokenId: "near" })).code, "ledger.balance.low", "no NEAR on the account: nothing to pay with");
  assert.equal((await problem(ledger, "ledger.toTrading", { amount: "1", tokenId: "wrap.near" })).code, "ledger.quote.unavailable", "only coins in the main balance");
});

const NEAR = 10n ** 24n;
/** A vault holding only NEAR on the account (nothing in NEAR Intents): 3 NEAR, 2,000 bytes of storage (0.02 NEAR). */
const nearOnly = (o: { core?: CoreOptions; nearYocto?: bigint } = {}) => setup({ usdc: "0", nearYocto: o.nearYocto ?? 3n * NEAR, storageBytes: 2_000n, ...(o.core ? { core: o.core } : {}) });

test("a vault with only NEAR on the account: balances shows it as the account's own NEAR, storage and the 0.06 NEAR fee reserve left out", async () => {
  const { ledger } = nearOnly();
  const rows = await ok<{ tokenId: string; symbol: string; held: string; amount: string; listed: boolean; usd?: string | null }[]>(ledger, "ledger.balances");
  const near = rows.filter((r) => r.tokenId === "near");
  assert.equal(near.length, 1);
  assert.deepEqual([near[0]!.symbol, near[0]!.held, near[0]!.listed, near[0]!.amount], ["NEAR", "account", true, "2.92"], "3 − 0.02 storage − 0.06 reserve");
  assert.ok(Number(near[0]!.usd) > 0, "priced as wNEAR, so Trade can offer it");
});

test("D146: Spending's engine (Trade's call) names the app that asked it, and the Safe's approval is asked as that app; only Trade's call may name one, and only an app Spending serves (controls)", async () => {
  const core = fakeCore({ accountId: ME, now: () => T0, quoteAdd: { depositAddress: REGISTERED } });
  const signedAs: string[] = [];
  const ledger = createLedgerService({
    bridgeFor: (caller) => ({ call: (m: string, p?: Record<string, unknown>) => { if (m === "tx.request") signedAs.push(caller); return core.call(m, p); }, on: (e: string, h: (p: unknown) => void) => core.on(e, h) }) as Bridge,
    chain: fakeNear(ME, { ledger: { [TRADING_USDC]: "500000000", "nep141:wrap.near": "0" } }, { [REGISTERED]: { account: { [TRADING_USDC]: "0" } } }),
    apis: createApis(replayFetch({ privateQuotes: SERVER })),
    trackMs: 5,
    now: () => T0,
    readCall: async () => ({ kind: "ran" }),
    privateQuotes: RELAY,
  });
  await ok(ledger, "ledger.toTrading", { amount: "10", caller: "trade", for: "browser" });
  await ok(ledger, "ledger.toTrading", { amount: "10", caller: "trade" });
  await ok(ledger, "ledger.toTrading", { amount: "10", caller: "wallet", for: "browser" });
  await ok(ledger, "ledger.toTrading", { amount: "10", caller: "trade", for: "pay" });
  assert.deepEqual(signedAs, ["browser", "trade", "wallet", "trade"]);
});

test("the Add paid with NEAR on the account: the core quotes wrap.near, and one transaction wraps exactly amountIn and sends it to the deposit address", async () => {
  const { ledger, core } = nearOnly({ core: { quoteAdd: { amountIn: "2500000000000000000000000" } } });
  const m = await ok<Movement>(ledger, "ledger.toTrading", { amount: "2.5", tokenId: "near", caller: "trade" });
  assert.deepEqual(core.asked, [{ amount: "2500000000000000000000000", tokenId: "nep141:wrap.near" }], "NEAR's 24 decimals, quoted as wNEAR (the only NEAR 1Click lists)");
  assert.equal(core.signed.length, 1, "one transaction, one sheet");
  const tx = core.signed[0]!;
  assert.equal(tx.receiverId, "wrap.near");
  const acts = tx.actions as { method: string; args: Record<string, unknown>; depositYocto: string }[];
  assert.deepEqual(acts.map((a) => a.method), ["storage_deposit", "storage_deposit", "near_deposit", "ft_transfer"], "its own storage, the deposit address's (none yet), wrap, pay");
  assert.deepEqual([acts[0]!.args.account_id, acts[1]!.args.account_id], [ME, QUOTE_ADDRESS]);
  assert.equal(acts[2]!.depositYocto, "2500000000000000000000000", "wraps exactly amountIn");
  assert.deepEqual([acts[3]!.args.receiver_id, acts[3]!.args.amount], [QUOTE_ADDRESS, "2500000000000000000000000"], "and sends exactly that to 1Click's deposit address");
  assert.ok(!core.signed.flatMap((r) => r.actions).some((a: any) => a.method === "ft_withdraw" || a.method === "mt_transfer"), "nothing taken out of NEAR Intents");
  assert.equal(tx.why, "Move 2.5 NEAR to your NEAR wallet");
  assert.deepEqual([m.kind, m.from, m.to, m.amount, m.status, m.caller], ["trading", "near", "trading", "2.5", "moving", "trade"]);

  // The deposit address already registered on wrap.near: no storage for it, still one transaction.
  const reg = nearOnly({ core: { quoteAdd: { depositAddress: REGISTERED, amountIn: "1000000000000000000000000" } } });
  await ok<Movement>(reg.ledger, "ledger.toTrading", { amount: "1", tokenId: "near" });
  assert.equal(reg.core.signed.length, 1);
  assert.deepEqual((reg.core.signed[0]!.actions as { method: string }[]).map((a) => a.method), ["storage_deposit", "near_deposit", "ft_transfer"]);
});

test("an Add of the account's NEAR keeps back its wrap's own gas while it's out (110 Tgas: 0.12 NEAR); a hair more, or too little NEAR, is ledger.balance.low with nothing asked or signed", async () => {
  // 3 − 0.02 storage − 0.12 (the wrap's 110 Tgas taken up front at 1e9 a gas unit, and the slack) = 2.86
  const all = nearOnly({ core: { quoteAdd: { amountIn: "2860000000000000000000000" } } });
  await ok<Movement>(all.ledger, "ledger.toTrading", { amount: "2.86", tokenId: "near" });
  assert.equal(all.core.signed.length, 1, "all it can take goes");

  const over = nearOnly();
  const p = await problem(over.ledger, "ledger.toTrading", { amount: "2.860001", tokenId: "near" });
  assert.equal(p.code, "ledger.balance.low");
  assert.deepEqual([over.core.asked.length, over.core.signed.length], [0, 0], "the core isn't asked and nothing moves");

  // 0.14 NEAR: storage (0.02) and the wrap's room (0.12) take it all.
  const poor = nearOnly({ nearYocto: 140_000_000_000_000_000_000_000n });
  assert.equal((await problem(poor.ledger, "ledger.toTrading", { amount: "0.001", tokenId: "near" })).code, "ledger.balance.low");
  assert.deepEqual([poor.core.asked.length, poor.core.signed.length], [0, 0]);
});

test("NEAR held as wNEAR in NEAR Intents doesn't pay an Add of the account's NEAR, and the account's NEAR doesn't pay a wNEAR Add", async () => {
  const intentsOnly = setup({ wnear: "9000000000000000000000000" });
  assert.equal((await problem(intentsOnly.ledger, "ledger.toTrading", { amount: "1", tokenId: "near" })).code, "ledger.balance.low");
  const accountOnly = nearOnly();
  assert.equal((await problem(accountOnly.ledger, "ledger.toTrading", { amount: "1", tokenId: "nep141:wrap.near" })).code, "ledger.balance.low");
  assert.deepEqual([intentsOnly.core.signed.length, accountOnly.core.signed.length], [0, 0]);
});

test("Home's Move (integration walk, 3 Nov): the Approve names where the money ends as the app's own words, never what is signed: the same request, byte for byte, with and without them (control: the words are on the request)", async () => {
  const strip = (r: Record<string, unknown>) => { const { onward, ...signed } = r; void onward; return signed; };
  const a = setup({ core: { quoteAdd: { depositAddress: REGISTERED } } });
  await ok<Movement>(a.ledger, "ledger.toTrading", { amount: "10", label: "Move $10.00 from your Safe · SOL $10.00", caller: "trade", onward: "it goes on to your SOL wallet, privately." });
  const b = setup({ core: { quoteAdd: { depositAddress: REGISTERED } } });
  await ok<Movement>(b.ledger, "ledger.toTrading", { amount: "10", label: "Move $10.00 from your Safe · SOL $10.00", caller: "trade" });
  assert.equal(a.core.signed.length, 1);
  assert.deepEqual(strip(a.core.signed[0] as unknown as Record<string, unknown>), strip(b.core.signed[0] as unknown as Record<string, unknown>), "what is signed is unchanged");
  assert.equal((a.core.signed[0] as unknown as { onward?: string }).onward, "it goes on to your SOL wallet, privately.", "control: the words ride on the request");
  assert.equal((b.core.signed[0] as unknown as { onward?: string }).onward, undefined);
});

// Finding 18 (real money, 4 Nov): the Top up's follow lived only in the page that paid it, so a reload left it "moving"
// for good (and Spending's Move on "Leaving your Safe"). A page that opens again follows it on, through the relay.
test("finding 18: a Top up still moving when its page went is followed again by the next page, to done", async () => {
  const first = setup({ core: { quoteAdd: { depositAddress: REGISTERED } }, status: "PENDING_DEPOSIT" as never });
  const m = await ok<Movement>(first.ledger, "ledger.toTrading", { amount: "10" });
  assert.equal(m.status, "moving");
  // the reload: the same phone's store, a new page whose relay now says SUCCESS
  const fetch = replayFetch({ privateQuotes: SERVER, privateStatus: "SUCCESS" });
  const again = createLedgerService({ bridge: first.core, chain: fakeNear(ME, { ledger: { [TRADING_USDC]: "500000000" } }, { [REGISTERED]: { account: { [TRADING_USDC]: "0" } } }), apis: createApis(fetch), trackMs: 5, now: () => T0, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY });
  const done = new Promise<Movement>((resolve) => again.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.id === m.id && movement.status === "done" && resolve(movement)));
  await ok<Movement[]>(again, "ledger.activity");
  assert.equal((await done).status, "done");
  assert.ok(fetch.calls.some((c) => c.url === `${SERVER}/status?depositAddress=${REGISTERED}`), "followed through the relay its quote came from");
  await ok<Movement[]>(again, "ledger.activity");
  assert.equal(fetch.calls.filter((c) => c.url.startsWith(`${SERVER}/status`)).length >= 1, true);
});
