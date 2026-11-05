// The web wallet's private Send (QA's real path for WEB_SEND_OPEN, 5 Nov; the HARD RULE: every money move
// through NEAR Confidential): ONE confidential 1Click quote from the SOL wallet straight to the payee, no pocket. The
// core asks it itself, reads back what 1Click signed, shows the outside sheet (the web: the password with Approve), and
// only then pays that quote's address. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { webAllows } from "./web-wallet.ts";

const SOL = "nep141:sol.omft.near";
const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEADLINE = new Date(Date.now() + 3_600_000).toISOString();

async function setup(o: { approve?: boolean; held?: bigint; signed?: (req: any) => any; status?: string; own?: boolean } = {}) {
  const shown: PlainWords[] = [];
  const asked: any[] = [];
  const hints: string[] = [];
  const relay: FloatRelay = {
    quote: async (req) => (asked.push(req), { quote: { depositAddress: DEPOSIT }, zerofeeStatusTag: "tag-for-this-quote-0001" }),
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
    submitDeposit: async (_a, hash) => void hints.push(hash),
  };
  const privateStatus = async (a: string) => {
    const req = asked.at(-1);
    if (a !== DEPOSIT || !req) return null;
    const quoteRequest = o.signed ? o.signed(req) : req;
    return { status: o.status ?? "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "9.20", amountOut: "49000000", amountOutUsd: "9.00", minAmountOut: "48500000", deadline: DEADLINE } }) };
  };
  const sent: string[] = [];
  const sol = {
    balance: async () => o.held ?? 10n ** 9n,
    latestBlockhash: async () => "11111111111111111111111111111111",
    send: async (tx: string) => (sent.push(tx), true),
    status: async () => ["ok", "ok"],
  } as unknown as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as any, approve: async (words) => (shown.push(words), o.approve !== false), emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } });
  const mine = await w.create("trade", "sol");
  const other = o.own ? (await w.create("browser", "sol")).address : PAYEE;
  return { w, shown, asked, sent, hints, mine, payee: other };
}

test("one confidential quote, the core's own: SOL wallet to the payee, refunded to the wallet; the outside sheet with the full address, what they get and the fee; then exactly that address is paid", async () => {
  const { w, shown, asked, sent, hints, mine, payee } = await setup();
  const r = await w.sendPrivate("sol", payee, SOL, "0.05", "wallet");
  assert.equal(asked.length, 1, "ONE quote, no pocket");
  assert.deepEqual(
    [asked[0].originAsset, asked[0].depositType, asked[0].destinationAsset, asked[0].recipient, asked[0].recipientType, asked[0].refundTo, asked[0].refundType, asked[0].swapType, asked[0].amount, asked[0].confidentiality, asked[0].dry],
    [SOL, "ORIGIN_CHAIN", SOL, PAYEE, "DESTINATION_CHAIN", mine.address, "ORIGIN_CHAIN", "EXACT_INPUT", "50000000", "basic", false],
  );
  assert.equal(shown.length, 1, "the outside sheet, once (the web: the password with Approve)");
  assert.equal(shown[0]!.tap, undefined, "never one tap");
  assert.deepEqual(shown[0]!.lines, [`To ${PAYEE}`, "They get about $9.00", "Network fees · about $0.20", "Public on Solana."]);
  assert.equal(shown[0]!.amount, "0.05 SOL");
  assert.equal(sent.length, 1, "the wallet paid 1Click's address");
  assert.equal(r.sent.status, "done");
  assert.equal(r.depositAddress, DEPOSIT);
  assert.equal(hints.length, 1, "the transaction handed to 1Click");
  assert.deepEqual(await w.sendPrivateStatus(DEPOSIT), { status: "PENDING_DEPOSIT" }, "its status by the core's own tag");
  await assert.rejects(w.sendPrivateStatus("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWZ"), "control: an address it never quoted");
});

test("a No on the sheet sends nothing (control: a yes sends)", async () => {
  const no = await setup({ approve: false });
  assert.equal((await no.w.sendPrivate("sol", no.payee, SOL, "0.05", "wallet")).sent.status, "declined");
  assert.equal(no.sent.length, 0);
});

test("what 1Click signed must be what the core asked: a changed payee, refund, coin, amount or a public quote is refused before any sheet (control: the honest quote goes)", async () => {
  const cases: [string, (r: any) => any][] = [
    ["payee", (r) => ({ ...r, recipient: "7xKXtgZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZgAsU" })],
    ["refund", (r) => ({ ...r, refundTo: "7xKXtgZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZgAsU" })],
    ["coin", (r) => ({ ...r, destinationAsset: "nep141:eth.omft.near" })],
    ["public", (r) => ({ ...r, confidentiality: "public" })],
    ["into a balance", (r) => ({ ...r, recipientType: "INTENTS" })],
  ];
  for (const [why, signed] of cases) {
    const s = await setup({ signed });
    await assert.rejects(s.w.sendPrivate("sol", s.payee, SOL, "0.05", "wallet"), (e: any) => /(?:isn't the one asked for|priced it differently than asked)/.test(e.problem.more), why);
    assert.deepEqual([s.shown.length, s.sent.length], [0, 0], `${why}: no sheet, nothing sent`);
  }
  const paid = await setup({ status: "SUCCESS" });
  await assert.rejects(paid.w.sendPrivate("sol", paid.payee, SOL, "0.05", "wallet"), (e: any) => /(?:isn't the one asked for|priced it differently than asked)/.test(e.problem.more), "an address already paid");
  const ok = await setup();
  assert.equal((await ok.w.sendPrivate("sol", ok.payee, SOL, "0.05", "wallet")).sent.status, "done", "control");
});

test("refused before any price: another app, a chain with no wallet coin, a short wallet, a 64-hex payee, another coin (controls: Wallet's own, enough SOL)", async () => {
  const s = await setup({ held: 50_900_000n });
  await assert.rejects(s.w.sendPrivate("sol", s.payee, SOL, "0.05", "chat"), (e: any) => e.problem.code === "security.request.not-allowed");
  await assert.rejects(s.w.sendPrivate("bsc", s.payee, SOL, "0.05", "wallet"), (e: any) => /only from your SOL wallet/.test(e.problem.more));
  await assert.rejects(s.w.sendPrivate("sol", s.payee, SOL, "0.05", "wallet"), (e: any) => e.problem.code === "security.balance.low-coin", "50M + 1M room is more than 50.9M");
  await assert.rejects(s.w.sendPrivate("sol", "a1".repeat(32), SOL, "0.05", "wallet"), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(s.w.sendPrivate("sol", s.payee, "nep141:btc.omft.near", "0.05", "wallet"), (e: any) => e.problem.code === "security.request.invalid", "SOL to BTC: the same coin only");
  await assert.rejects(s.w.sendPrivate("sol", s.payee, "nep141:hood.omft.near", "0.05", "wallet"), (e: any) => e.problem.code === "security.request.invalid", "SOL to ETH (RH)");
  assert.equal(s.asked.length, 0, "no price asked");
  const enough = await setup({ held: 51_000_000n });
  assert.equal((await enough.w.sendPrivate("sol", enough.payee, SOL, "0.05", "wallet")).sent.status, "done", "control: just enough");
});

test("to the person's own other wallet: the one cap, no outside sheet under it (control: an outside payee asks)", async () => {
  const own = await setup({ own: true });
  assert.equal((await own.w.sendPrivate("sol", own.payee, SOL, "0.05", "wallet")).sent.status, "done");
  assert.equal(own.shown.length, 0, "$9.20 is under the cap: no sheet");
});

test("the web wallet's door lets only Wallet's own private Send through, from SOL or ETH (RH) (controls: another app, BNB Chain)", () => {
  assert.equal(webAllows("subwallet.sendPrivate", { app: "wallet", chain: "sol" }), true);
  assert.equal(webAllows("subwallet.sendPrivate", { app: "wallet", chain: "hood" }), true);
  assert.equal(webAllows("subwallet.sendPrivate", { app: "trade", chain: "sol" }), false);
  assert.equal(webAllows("subwallet.sendPrivate", { app: "wallet", chain: "bsc" }), false);
  assert.equal(webAllows("subwallet.sendPrivate.status", { app: "wallet" }), true);
  assert.equal(webAllows("subwallet.sendPrivate.status", { app: "chat" }), false);
});

test("decision A through the web door (QA's privacy review, 5 Nov): a private Send to an outside address shows the core's sheet with the password, at any amount; Approve with none or a wrong one is refused and nothing moves; the right one pays. Control: the person's own SOL wallet, under the cap, no sheet and no password", async () => {
  const { DemoCore } = await import("./demo-core.ts");
  const { FakeChain } = await import("./testing/fake-chain.ts");
  const { WORDS, PASSWORD, until } = await import("./testing/web-core.ts");
  const real = globalThis.fetch;
  const asked: any[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v0/quote")) { asked.push(JSON.parse(String(init!.body))); return new Response(JSON.stringify({ quote: { depositAddress: DEPOSIT }, zerofeeStatusTag: "tag-for-this-quote-0001" }), { status: 201 }); }
    if (u.includes("/v0/status?")) { const req = asked.at(-1); return new Response(JSON.stringify({ status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: DEPOSIT, amountIn: req.amount, amountInUsd: "9.20", amountOut: "49000000", amountOutUsd: "9.00", minAmountOut: "48500000", deadline: DEADLINE } }) }), { status: 200 }); }
    if (u.endsWith("/v0/deposit/submit")) return new Response("{}", { status: 200 });
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  try {
    const sent: string[] = [];
    const sol = { balance: async () => 10n ** 10n, latestBlockhash: async () => "11111111111111111111111111111111", send: async (tx: string) => (sent.push(tx), true), status: async () => ["ok", "ok"] } as unknown as SolChain;
    let tries = 0;
    const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => new Uint8Array(), secretsInMemory: true, sol, quoteKey: TEST_QUOTE_KEY, privateQuotes: "https://relay.zerofee.example", nativeUsd: async (c) => (c === "sol" ? 184 : null), webWallet: { passwordOk: async (p) => (tries++, p === PASSWORD) } });
    const sheets: { id: string; words: PlainWords; password?: boolean }[] = [];
    core.on<{ id: string; words: PlainWords; password?: boolean }>("approval.needed", (e) => sheets.push(e));
    const okr = (r: any) => { if ("problem" in r) throw new Error(r.problem.code); return r.ok; };
    okr(await core.call("account.web.import", { words: WORDS }));
    const go = core.call<{ sent: { status: string } }>("subwallet.sendPrivate", { app: "wallet", chain: "sol", to: PAYEE, toTokenId: SOL, amount: "0.05" }); // $9.20, under the cap
    await until(() => sheets.length === 1);
    assert.equal(sheets[0]!.password, true, "the web's sheet asks the password");
    assert.deepEqual(sheets[0]!.words.lines, [`To ${PAYEE}`, "They get about $9.00", "Network fees · about $0.20", "Public on Solana."]);
    const none = await core.call("approval.answer", { id: sheets[0]!.id, approve: true });
    assert.equal("problem" in none && none.problem.code, "security.web.password", "Approve with no password: refused");
    const wrong = await core.call("approval.answer", { id: sheets[0]!.id, approve: true, password: "wrong password here" });
    assert.equal("problem" in wrong && wrong.problem.code, "security.web.password", "a wrong one: refused");
    assert.equal(sent.length, 0, "nothing moved before the right password");
    okr(await core.call("approval.answer", { id: sheets[0]!.id, approve: true, password: PASSWORD }));
    assert.equal(okr(await go).sent.status, "done");
    assert.equal(sent.length, 1, "the right password: paid");
    // control: the person's own SOL wallet, under the cap: no sheet, no password
    const own = okr(await core.call("account.web.status")).wallets.find((w: any) => w.wallet === "sol").address;
    const before = tries;
    assert.equal(okr(await core.call("subwallet.sendPrivate", { app: "wallet", chain: "sol", to: own, toTokenId: SOL, amount: "0.05" })).sent.status, "done");
    assert.deepEqual([sheets.length, tries - before, sent.length], [1, 0, 2], "own wallet: sent with no sheet and no password");
  } finally {
    globalThis.fetch = real;
  }
});
