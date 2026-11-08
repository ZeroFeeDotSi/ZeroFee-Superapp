// "Add money to start": the money path (delivery, refund, amounts) and the checklist, against a real 1Click quote and
// against the core end to end on a fake mainnet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toBase58 } from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import { forApps } from "./bridge.ts";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { FUND_COINS, FUND_EVERY_CHAIN, fundOffered, checkFundQuote, coinText, fundCoin, fundSteps, fundTarget, overBase, readSwap, shownUntil, type FundFacts, type FundOrder, type FundView } from "./fund-start.ts";
import { HOT_ROOT, hotRoot, hotSecret } from "./hot-keys.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { solAddress } from "./solana.ts";
import { SoftwareKey } from "./device-key.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { MemoryVault } from "./vault.ts";
import { seedToWords } from "./recovery-words.ts";

const mainnetWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const real = JSON.parse(readFileSync(new URL("./testing/fund-quote-sol.json", import.meta.url), "utf8"));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const SOL = fundCoin("sol")!;

// ── ZeroFee's pinned relay in front of 1Click, as the core reaches it (fetch to https://relay.test/), for the private
// route (3 Nov): a quote answers with a one-time address, status with the quote as asked, signed the way 1Click signs it.
// `lie` changes what the signed quote says; `status` sets an address's progress.
const RELAY = "https://relay.test/";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const relay = {
  asked: [] as any[],
  quotes: new Map<string, { req: any; deadline: string }>(),
  status: new Map<string, { status: string; details?: unknown }>(),
  lie: null as null | ((req: any) => any),
  n: 0,
  /** The Solana address the next quote gives. */
  nextSol: () => `Dep${B58[(relay.n + 1) % 58]}${"x".repeat(28)}`,
};
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    // 1Click's token list, recorded (wNEAR at $4): set-up's move on prices its NEAR here, at once since D137
    if (u.host === "1click.chaindefuser.com" && u.pathname === "/v0/tokens") return reply([{ assetId: "nep141:wrap.near", decimals: 24, symbol: "wNEAR", price: 4, priceUpdatedAt: new Date().toISOString() }]);
    if (u.host !== "relay.test") return realFetch(url, init);
    if (u.pathname === "/v0/quote") {
      const req = JSON.parse(String(init?.body));
      relay.asked.push(req);
      const depositAddress = req.depositType === "ORIGIN_CHAIN" ? (req.originAsset === SOL.assetId ? relay.nextSol() : `0x${(relay.n + 1).toString(16).padStart(40, "a")}`) : (relay.n + 1).toString(16).padStart(64, "d");
      relay.n++;
      const deadline = new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString();
      relay.quotes.set(depositAddress, { req, deadline });
      return reply({ quote: { depositAddress, amountIn: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" });
    }
    if (u.pathname === "/v0/status") {
      const dep = u.searchParams.get("depositAddress")!;
      const q = relay.quotes.get(dep);
      if (!q) return reply({ code: "quotes.status.unknown" }, 404);
      const req = relay.lie ? relay.lie(q.req) : q.req;
      const least = ((BigInt(q.req.amount) * 99n) / 100n).toString();
      const s = relay.status.get(dep);
      const quoteResponse = signedQuote({ quoteRequest: req, quote: { depositAddress: dep, amountIn: q.req.amount, minAmountIn: least, minAmountOut: least, amountOut: q.req.amount, deadline: q.deadline, timeEstimate: 22 } });
      return reply({ status: s?.status ?? "PENDING_DEPOSIT", quoteResponse, ...(s?.details ? { swapDetails: s.details } : {}) });
    }
    return reply({ intentHash: "h" });
  }) as typeof fetch;
}
/** The account's own confidential balance on NEAR (Trading's cash, the NEAR wallet), from its backup words. */
const floatOf = (words: Uint8Array) => Buffer.from(ed25519.getPublicKey(hotSecret(hotRoot(words), "trade", "near", 0)!)).toString("hex");

test("a real 1Click quote (2 Nov, FLEX_INPUT, no deposit) passes the core's check; any changed term, or another key, is refused", () => {
  const q = real.real;
  const at = Date.parse(q.timestamp) + 1000;
  const terms = { coin: SOL, refundTo: q.quoteRequest.refundTo, fundAddress: q.quoteRequest.recipient, needYocto: BigInt(real.needYocto), amountIn: q.quoteRequest.amount };
  const facts = checkFundQuote(q, terms, at);
  assert.equal(facts.recipient, terms.fundAddress);
  assert.ok(BigInt(facts.minAmountOut) >= BigInt(real.needYocto), "what comes out covers what the account needs");
  // The control: each term the core asked for, expected otherwise, refuses the very same signed quote.
  for (const over of [{ refundTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, { fundAddress: "ab".repeat(32) }, { coin: fundCoin("usdc-sol")! }, { needYocto: BigInt(q.quote.minAmountOut) + 1n }, { amountIn: "1" }]) {
    assert.throws(() => checkFundQuote(q, { ...terms, ...over }, at), (e: any) => e.problem?.code === "security.fund.price-refused", JSON.stringify(Object.keys(over)));
  }
  // A changed recipient breaks 1Click's signature: refused even when the core is told to expect it.
  const forged = { ...q, quoteRequest: { ...q.quoteRequest, recipient: "cd".repeat(32) } };
  assert.throws(() => checkFundQuote(forged, { ...terms, fundAddress: "cd".repeat(32) }, at));
  // Signed by any other key (the test key): refused.
  assert.throws(() => checkFundQuote(q, terms, at, TEST_QUOTE_KEY));
  // Past its signed deadline: not shown.
  assert.throws(() => checkFundQuote(q, terms, Date.parse(q.quote.deadline) + 1));
});

test("amounts read as a person reads them: never base units, what to send rounded up, what came back rounded down", () => {
  assert.equal(coinText(19060833n, 9), "0.01907");
  assert.equal(coinText(19060833n, 9, "down"), "0.01906");
  assert.equal(coinText(1816882n, 6), "1.81689");
  assert.equal(coinText(398_000_000_000_000_000_000_000n, 24), "0.398");
  assert.equal(coinText(12_345_678n * 10n ** 24n, 24), "12,345,678");
  assert.equal(fundTarget(100n), 105n);
  // D155: BNB Chain's own coin is a set-up coin in the test proof build (1Click's minimum there was $1,000 on 2 Nov:
  // its address is then refused, said on its row); never in a public build until its dust run passes
  assert.ok(FUND_COINS.every((c) => c.chain !== ("bsc" as string)), "the words' wallets' list has no BNB Chain");
  assert.ok(fundOffered(true).some((c) => c.chain === "bsc") && !fundOffered(false).some((c) => c.chain === "bsc"), "BNB Chain: the proof build only");
});

const order = (over: Partial<FundOrder> = {}): FundOrder => ({ coinId: "sol", depositAddress: "Dep", refundTo: "Ref", fundAddress: "aa".repeat(32), needYocto: "100", amountIn: "10", minAmountIn: "9", deadlineIso: new Date(Date.now() + 86_400_000).toISOString(), startedAtMs: Date.now(), ...over });
const facts = (over: Partial<FundFacts>): FundFacts => ({ order: order(), coin: SOL, swap: null, haveYocto: 0n, needYocto: 100n, stage: "needs-funding", opening: false, openFailed: false, rest: null, nowMs: Date.now(), ...over });
const view = (f: FundFacts) => {
  const { state, steps } = fundSteps(f);
  return `${state}: ${steps.map((s) => `${s.key}=${s.state}`).join(" ")}`;
};

test("the checklist ticks only from what was read: 1Click's status, the account's address, the core's stage", () => {
  assert.equal(view(facts({})), "waiting: seen=now near=todo open=todo");
  assert.equal(view(facts({ swap: { status: "KNOWN_DEPOSIT_TX" } })), "working: seen=done near=now open=todo");
  assert.equal(view(facts({ swap: { status: "PROCESSING" } })), "working: seen=done near=now open=todo");
  // 1Click says done, but the NEAR isn't at the address yet: "Changing it to NEAR" stays on until the chain shows it.
  assert.equal(view(facts({ swap: { status: "SUCCESS" }, haveYocto: 99n })), "working: seen=done near=now open=todo");
  assert.equal(view(facts({ swap: { status: "SUCCESS" }, haveYocto: 100n })), "opening: seen=done near=done open=now");
  assert.equal(view(facts({ swap: { status: "SUCCESS" }, haveYocto: 100n, openFailed: true })), "open-failed: seen=done near=done open=failed");
  assert.equal(view(facts({ stage: "needs-backup", haveYocto: null })), "done: seen=done near=done open=done");
  assert.equal(view(facts({ stage: "needs-backup", haveYocto: null, rest: { yocto: 5n, moved: false, moving: false } })), "opened: seen=done near=done open=done rest=todo");
  assert.equal(view(facts({ stage: "ready", haveYocto: null, rest: { yocto: 5n, moved: false, moving: false } })), "opened: seen=done near=done open=done rest=now");
  assert.equal(view(facts({ stage: "ready", haveYocto: null, rest: { yocto: 5n, moved: true, moving: false } })), "done: seen=done near=done open=done rest=done");
  // The plain failures.
  assert.equal(view(facts({ swap: { status: "INCOMPLETE_DEPOSIT" } })), "short: seen=failed near=todo open=todo");
  assert.equal(view(facts({ swap: { status: "REFUNDED", refunded: "9" } })), "refunded: seen=done near=failed open=todo");
  assert.equal(view(facts({ swap: { status: "FAILED" } })), "failed: seen=done near=failed open=todo");
  // D155: an address is shown a day (no hour's pressure); past it, expired
  assert.equal(view(facts({ order: order({ startedAtMs: Date.now() - 25 * 3_600_000 }) })), "expired: seen=now near=todo open=todo");
  // An unread address is not an empty one: nothing ticks, nothing fails.
  assert.equal(view(facts({ haveYocto: null })), "waiting: seen=now near=todo open=todo");
  // NEAR itself: seen, then open.
  const near = fundCoin("near")!;
  assert.equal(view(facts({ coin: near, order: order({ coinId: "near" }) })), "waiting: seen=now open=todo");
  assert.equal(view(facts({ coin: near, order: order({ coinId: "near" }), haveYocto: 40n })), "working: seen=failed open=todo");
  assert.equal(view(facts({ coin: near, order: order({ coinId: "near" }), haveYocto: 100n })), "opening: seen=done open=now");
  // The hour shown, never past 1Click's own signed deadline.
  assert.equal(shownUntil(order({ startedAtMs: 0, deadlineIso: new Date(60_000).toISOString() })), new Date(60_000).toISOString());
});

test("a status is believed only with the order's own signed terms: another recipient or refund, and the checklist doesn't move", () => {
  const o = order({ fundAddress: "aa".repeat(32), refundTo: solAddress(new Uint8Array(32).fill(3)), depositAddress: "DepositAddr1111111111111111111111", needYocto: "100", amountIn: "10" });
  const status = (over: Record<string, unknown> = {}, status = "PROCESSING") => ({
    status,
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, swapType: "FLEX_INPUT", slippageTolerance: 100, originAsset: SOL.assetId, depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:wrap.near", amount: "10", refundTo: o.refundTo, refundType: "ORIGIN_CHAIN", recipient: o.fundAddress, recipientType: "DESTINATION_CHAIN", deadline: o.deadlineIso, ...over },
      quote: { depositAddress: o.depositAddress, amountIn: "10", minAmountIn: "9", amountOut: "110", minAmountOut: "105", deadline: o.deadlineIso },
    }),
    swapDetails: { depositedAmount: "10", amountOut: "110", refundedAmount: "0" },
  });
  assert.deepEqual(readSwap(status(), o, Date.now(), TEST_QUOTE_KEY), { status: "PROCESSING", depositedIn: "10", amountOut: "110" });
  assert.equal(readSwap(status({ recipient: "bb".repeat(32) }), o, Date.now(), TEST_QUOTE_KEY), null);
  assert.equal(readSwap(status({ refundTo: "Attacker111111111111111111111111" }), o, Date.now(), TEST_QUOTE_KEY), null);
  assert.equal(readSwap(status({ recipientType: "INTENTS" }), o, Date.now(), TEST_QUOTE_KEY), null);
  assert.equal(readSwap(status(), o, Date.now()), null, "signed by another key than the one expected");
  assert.equal(readSwap(status({}, "SOMETHING_NEW"), o, Date.now(), TEST_QUOTE_KEY), null);
});

// ── The core, end to end on a fake mainnet ────────────────────────────────────────────────────────────────────────

/** The coins' own networks, as the deposit watcher reads them (J2): balances by address (and coin), or a read that fails. */
function networks() {
  const held = new Map<string, bigint>();
  let down = false;
  const at = (k: string) => {
    if (down) throw new Error("node down");
    return held.get(k) ?? 0n;
  };
  const sol = { balance: async (a: string) => at(a), tokenAccounts: async (a: string) => [...held].filter(([k]) => k.startsWith(`${a}|`)).map(([k, amount]) => (down ? (() => { throw new Error("node down"); })() : { mint: k.split("|")[1], amount })) };
  const evm = { tokenBalance: async (_c: string, token: string, a: string) => at(`${a}|${token}`), account: async (_c: string, a: string) => [{ latest: 0, pending: 0, balance: at(a) }, { latest: 0, pending: 0, balance: at(a) }] };
  return { held, sol: sol as any, evm: evm as any, down: (d: boolean) => (down = d) };
}

function phone(over: Partial<ConstructorParameters<typeof DemoCore>[0]> = {}) {
  const chain = new FakeChain("mainnet");
  chain.fund("near", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const asked: Record<string, any>[] = [];
  const statuses = new Map<string, unknown>();
  const net = networks();
  let deposit = 0;
  let want = 0n;
  const quoter = async (req: Record<string, any>) => {
    asked.push(req);
    if (req.swapType === "EXACT_OUTPUT") want = BigInt(req.amount);
    const amountIn = req.swapType === "EXACT_OUTPUT" ? "20000000" : req.amount;
    const out = want.toString();
    const minOut = ((want * 99n) / 100n).toString();
    const r = { quoteRequest: req, quote: { amountIn, minAmountIn: "19800000", amountInUsd: "1.90", amountOut: out, minAmountOut: minOut, timeEstimate: 22, ...(req.dry ? {} : { depositAddress: `Dep${++deposit}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`, deadline: new Date(Date.now() + 3 * 86_400_000).toISOString() }) } };
    return signedQuote(r);
  };
  // the pinned relay (the private route) and no confidential balance read (no 1Click sign-in in a unit test)
  const core = new DemoCore({ chain, vault, policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1, quoter, quoteKey: TEST_QUOTE_KEY, oneClick: async (d) => statuses.get(d) ?? null, nativeUsd: async () => 4, sheetPrices: false, sol: net.sol, evm: net.evm, fundStatusEveryMs: 0, privateQuotes: RELAY, intentsSalt: null, ...over });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  return { chain, vault, core, asked, statuses, net };
}

const settle = async (core: Bridge, until: (v: FundView) => boolean) => {
  for (let i = 0; i < 200; i++) {
    const v = ok(await core.call<FundView>("account.fund.status"));
    if (until(v)) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("the checklist never got there");
};

/** Words first (O-2a): the words shown and checked, as set-up's screens do before any money. Nothing when not due. */
async function checkWords(core: Bridge): Promise<void> {
  if (ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue !== true) return;
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
}

/** A record from before O-2a: an address asked for while the words still waited. Made here by the check's mark for the
 *  kept words planted for the one call, then taken away, so the words are due again with an address on record. (The
 *  one live way into "money before the words" today needs no address at all: NEAR sent straight to the setup address
 *  account.create returns, which no screen shows; review M, open with QA.) */
async function addressBeforeO2a(core: Bridge, vault: MemoryVault, coin: string): Promise<FundView> {
  const { sha256 } = await import("@noble/hashes/sha2.js");
  if (!(await vault.get("pending-words"))) ok(await core.call("recovery.words")); // the words are made when first shown
  await vault.put("words-checked-first", sha256((await vault.get("pending-words"))!));
  const v = ok(await core.call<FundView>("account.fund.start", { coin }));
  await vault.delete("words-checked-first");
  return v;
}

test("SOL opens the account the private way: a one-time address into the account's own confidential balance, refunds there too; no public quote names a wallet or the new account; then it opens by itself", async () => {
  const { chain, vault, core, asked, net } = phone();
  const funding = ok(await core.call<{ fundAddress: string; needYocto: string }>("account.create"));
  const coins = ok(await core.call<{ coins: { id: string }[] }>("account.fund.coins")).coins.map((c) => c.id);
  assert.deepEqual(coins, fundOffered().map((c) => c.id));
  // The words exist by this step, and the confidential balance is theirs: Trading's cash on NEAR from the very words
  // set-up will put on chain with the account (pending-words), so writing them down brings a refund back.
  const pending = await vault.get("pending-words");
  assert.ok(pending && pending.length === 32);
  assert.deepEqual(await vault.get(HOT_ROOT), hotRoot(pending!));
  const wallet = solAddress(hotSecret(hotRoot(pending!), "trade", "sol", 0)!);
  const float = floatOf(pending!);

  const from = relay.asked.length;
  const v = (await checkWords(core), ok(await core.call<FundView>("account.fund.start", { coin: "sol" }))); // O-2c: the words first, or nothing opens
  assert.equal(asked.length, 0, "nothing asked of 1Click's public API (the old route named the SOL wallet and the new account together)");
  assert.equal(relay.asked.length, from + 1, "one quote, through the pinned relay");
  const q = relay.asked.at(-1)!;
  assert.deepEqual(
    [q.dry, q.swapType, q.originAsset, q.destinationAsset, q.depositType, q.recipient, q.recipientType, q.refundTo, q.refundType, q.confidentiality],
    [false, "FLEX_INPUT", SOL.assetId, SOL.assetId, "ORIGIN_CHAIN", float, "CONFIDENTIAL_INTENTS", float, "CONFIDENTIAL_INTENTS", "basic"],
  );
  assert.ok(![q.recipient, q.refundTo].some((x) => x === wallet || x === funding.fundAddress), "neither the SOL wallet nor the new account is in the quote");
  // sized at the core's own prices (NEAR and SOL at $4 here) for what's needed plus 10 %, at 8 places
  const need = Math.ceil((Number(BigInt(funding.needYocto)) / 1e24) * 4 * 1.1 * 100) / 100;
  assert.equal(q.amount, String(Math.ceil((need / 4) * 1e8) * 10), `${q.amount} for $${need}`);
  assert.equal(v.refundTo, undefined, "no wallet's address to refund to");
  assert.deepEqual([v.state, v.deposit?.amount, v.deposit?.minimum], ["waiting", coinText(q.amount, 9), coinText(((BigInt(q.amount) * 99n) / 100n).toString(), 9)]);
  assert.ok(Date.parse(v.deposit!.untilIso) <= Date.now() + 24 * 3_600_000 + 1000, "a day shown (D155: no hour's pressure), never 1Click's three days");

  // Restarted: the same checklist, from the vault.
  core.close();
  const again = new DemoCore({ chain, vault, policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1, quoteKey: TEST_QUOTE_KEY, oneClick: async () => null, sheetPrices: false, nativeUsd: async () => 4, sol: net.sol, evm: net.evm, fundStatusEveryMs: 0, privateQuotes: RELAY, intentsSalt: null });
  const resumed = ok(await again.call<FundView>("account.fund.status"));
  assert.equal(resumed.deposit?.address, v.deposit?.address);

  // 1Click: it saw the SOL, then it landed in the confidential balance (the move on goes at once, D137, and is
  // float-add-outside.test.ts's); the chain shows the NEAR (a bit more than needed): the core opens the account itself.
  const dep = v.deposit!.address;
  relay.status.set(dep, { status: "KNOWN_DEPOSIT_TX" });
  assert.equal((await settle(again, (x) => x.state === "working")).steps.map((s) => s.state).join(), "done,now,todo");
  relay.status.set(dep, { status: "SUCCESS", details: { amountOut: q.amount } });
  assert.equal((await settle(again, (x) => x.state === "working")).steps.map((s) => s.state).join(), "done,now,todo", "landed, not yet NEAR: still changing");
  chain.fund(funding.fundAddress, `ed25519:${toBase58(Buffer.from(funding.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(funding.fundAddress)!.balance = BigInt(funding.needYocto) + 2n * 10n ** 24n; // 2 NEAR more than needed
  const done = await settle(again, (x) => x.state === "opened" || x.state === "done");
  assert.equal(ok(await again.call<{ stage: string }>("account.state")).stage, "ready", "words checked first: ready (O-2c)");
  assert.deepEqual([done.state, done.rest?.near, done.rest?.usd], ["opened", "2", "8.00"], "the rest beyond the opening, for Private");
  ok(await again.call("account.fund.note", { restMovementId: "private:abc" }));
  ok(await again.call("account.fund.note", { restMoved: true }));
  assert.equal(ok(await again.call<FundView>("account.fund.status")).state, "done");
  ok(await again.call("account.fund.note", { finished: true }));
  assert.equal(code(await again.call("account.fund.status")), "security.fund.not-opening");
  again.close();
});

test("a 1Click answer naming another recipient or refund is never shown; NEAR itself needs no swap; apps can't ask any of it", async () => {
  const { core } = phone();
  const funding = ok(await core.call<{ fundAddress: string }>("account.create"));
  await checkWords(core); // words first (O-2a)
  for (const lie of [(req: any) => ({ ...req, recipient: "ee".repeat(32) }), (req: any) => ({ ...req, refundType: "ORIGIN_CHAIN", refundTo: "So11111111111111111111111111111111111111112" })]) {
    relay.lie = lie;
    try {
      assert.equal(code(await core.call("account.fund.start", { coin: "sol" })), "security.subwallet.refused");
    } finally {
      relay.lie = null;
    }
  }
  assert.equal(code(await core.call("account.fund.start", { coin: "sol" })), "ok", "control: the honest quote is shown");
  assert.equal(code(await core.call("account.fund.start", { coin: "btc" })), "security.fund.coin-unknown");
  const near = ok(await core.call<FundView>("account.fund.start", { coin: "near" }));
  assert.deepEqual([near.deposit?.address, near.state, near.refundTo], [funding.fundAddress, "waiting", funding.fundAddress]);
  for (const m of ["account.fund.coins", "account.fund.start", "account.fund.status", "account.fund.note"]) assert.equal(code(await forApps(core, "wallet").call(m, { coin: "near" })), "security.bridge.not-allowed", m);
  core.close();
});

test("a browser keeps no words no one has seen (K-2): NEAR alone opens an account there", async () => {
  const { core, vault } = phone({ secretsInMemory: true });
  ok(await core.call("account.create"));
  assert.deepEqual(ok(await core.call<{ coins: { id: string }[] }>("account.fund.coins")).coins.map((c) => c.id), ["near"]);
  assert.equal(code(await core.call("account.fund.start", { coin: "sol" })), "security.fund.coin-unknown");
  assert.equal(await vault.get(HOT_ROOT), null);
  core.close();
});

// Security review, 2 Nov: an opening that stops after the named account is made carries on (never asks for the money
// again); NEAR that lands at the old setup address after the opening is swept into the account; "At least" opens it.
// Finding 1 (4 Nov, real money): it sat on "isn't open yet… Try again" for minutes while the chain showed the account
// open, until a reload. The chain decides now: the next status poll sees the account and the opening carries on.
for (const failAt of [2, 3]) {
  test(`an opening that stops at its transaction ${failAt} carries on by itself once the chain shows the account, never asking for the money again`, async () => {
    const { chain, core } = phone();
    const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
    await checkWords(core); // O-2c: the opening waits for the words
    ok(await core.call("account.fund.start", { coin: "near" }));
    let sends = 0;
    const send = chain.send.bind(chain) as (...a: unknown[]) => ReturnType<FakeChain["send"]>;
    (chain as unknown as { send: (...a: unknown[]) => unknown }).send = async (...a: unknown[]) => {
      if (++sends === failAt) throw new Error("node down");
      return send(...a);
    };
    chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
    chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
    const seen: string[] = [];
    const done = await settle(core, (x) => (seen.push(x.state), x.state === "done" || x.state === "opened"));
    assert.ok(!seen.includes("waiting"), "never back to asking for the money");
    assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready", "no Try again, no reload; words checked first (O-2c)");
    assert.equal(chain.sent.filter((tx) => tx.actions.some((a) => a.kind === "call" && a.method === "create_account")).length, 1, "one create");
    core.close();
  });
}

test("finding 1: a create that landed though its answer was lost opens the account, and the registrar is asked once", async () => {
  const { chain, core } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  await checkWords(core);
  ok(await core.call("account.fund.start", { coin: "near" }));
  let sends = 0;
  const send = chain.send.bind(chain) as (...a: unknown[]) => ReturnType<FakeChain["send"]>;
  (chain as unknown as { send: (...a: unknown[]) => unknown }).send = async (...a: unknown[]) => {
    const out = await send(...a);
    if (++sends === 1) throw new Error("the node took it, then timed out"); // landed on chain; the answer never came back
    return out;
  };
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  const seen: string[] = [];
  await settle(core, (x) => (seen.push(x.state), x.state === "done" || x.state === "opened"));
  assert.ok(chain.accounts.has(f.accountId));
  const creates = chain.sent.filter((tx) => tx.actions.some((a) => a.kind === "call" && a.method === "create_account"));
  assert.equal(creates.length, 1, "the registrar is never asked a second time");
  assert.ok(!seen.includes("waiting"), "never back to asking for the money");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  core.close();
});

// Finding 23 (4 Nov, real money): NEAR's nodes answering 429 stopped the opening on "Your account isn't open yet", and
// Try again went straight back into the same 429s. A busy network decided nothing: the core tries again by itself, spaced
// out, with "Opening your account" on screen meanwhile; the registrar is still asked once.
test("finding 23: an opening stopped by busy NEAR nodes carries on by itself, never showing 'isn't open yet'", async () => {
  const { chain, core } = phone({ fundBusyFirstMs: 5 });
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  await checkWords(core);
  ok(await core.call("account.fund.start", { coin: "near" }));
  let sends = 0;
  const send = chain.send.bind(chain) as (...a: unknown[]) => ReturnType<FakeChain["send"]>;
  (chain as unknown as { send: (...a: unknown[]) => unknown }).send = async (...a: unknown[]) => {
    if (++sends <= 2) throw new ProblemError(securityProblems.nodesUnreachable("busy")); // 429 everywhere, nothing sent
    return send(...a);
  };
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  const seen: string[] = [];
  await settle(core, (x) => (seen.push(x.state), x.state === "done" || x.state === "opened"));
  assert.ok(!seen.includes("open-failed"), "never 'isn't open yet' while the core will try again");
  assert.equal(chain.sent.filter((tx) => tx.actions.some((a) => a.kind === "call" && a.method === "create_account")).length, 1, "one create");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  core.close();
});

test("NEAR landing at the old setup address after the opening goes into the account; the kept key goes once every address ran out", async () => {
  const { chain, core, vault } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  // a record from before O-2a: these follow the opening itself, words after the money as then
  await checkWords(core); // O-2c: the opening waits for the words
  ok(await core.call<FundView>("account.fund.start", { coin: "sol" }));
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  await settle(core, (x) => x.stage === "ready");
  assert.equal(chain.accounts.has(f.fundAddress), false, "the opening emptied the setup address");
  assert.ok(await vault.get("fund-late-setup-key"), "its key is kept while a coin's address may still pay there");
  // A deposit to the older address, after the opening: 1Click pays the setup address, which comes back into being.
  const before = chain.accounts.get(f.accountId)!.balance;
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = 3n * 10n ** 24n;
  ok(await core.call("account.state"));
  for (let i = 0; i < 400 && chain.accounts.has(f.fundAddress); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(chain.accounts.has(f.fundAddress), false, "swept");
  assert.ok(chain.accounts.get(f.accountId)!.balance > before + 2n * 10n ** 24n, "into the account");
  core.close();
});

test("'At least' on the screen must still open the account: a quote whose least taken buys too little isn't shown", () => {
  const q = real.real;
  const at = Date.parse(q.timestamp) + 1000;
  const terms = { coin: SOL, refundTo: q.quoteRequest.refundTo, fundAddress: q.quoteRequest.recipient, needYocto: BigInt(real.needYocto), amountIn: q.quoteRequest.amount };
  checkFundQuote(q, terms, at);
  const buys = (BigInt(q.quote.minAmountOut) * BigInt(q.quote.minAmountIn)) / BigInt(q.quote.amountIn);
  assert.throws(() => checkFundQuote(q, { ...terms, needYocto: buys + 1n }, at));
});

// ── J2: words first, the deposit watcher, the live ETA ──────────────────────────────────────────────────────────────

test("words first (J2, B3): on the phone the words are shown and checked before any money; the account then opens ready", async () => {
  const { chain, vault, core } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  assert.equal(ok(await core.call<{ stage: string; wordsDue?: boolean }>("account.state")).wordsDue, true, "the words are due before the money");
  // The words shown are the very words kept for the account (its refund wallets come from them too).
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  assert.deepEqual(words, seedToWords((await vault.get("pending-words"))!));
  ok(await core.call("account.fund.coins"));
  assert.deepEqual(await vault.get(HOT_ROOT), hotRoot((await vault.get("pending-words"))!), "the wallets are these words' wallets");
  // O-2a: no address while the words wait (the core, not only the screens' order).
  assert.equal(code(await core.call("account.fund.start", { coin: "near" })), "security.fund.words-first");
  // A wrong word is caught, and nothing is marked.
  const wrong = words[1] === "abandon" ? "ability" : "abandon";
  assert.equal(code(await core.call("recovery.confirm", { positions: [1, 2, 3], words: [words[0], wrong, words[2]] })), "security.words.wrong");
  assert.equal(await vault.get("words-checked-first"), null);
  ok(await core.call("recovery.confirm", { positions: [5, 12, 24], words: [words[4], words[11], words[23]] }));
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, undefined, "done: the money is next");
  assert.equal(code(await core.call("recovery.words")), "security.stage.wrong", "once checked they can't be shown again (the check screen says so)");
  assert.equal(ok(await core.call<FundView>("account.fund.start", { coin: "near" })).wordsDone, true, "checked: the address is given");
  assert.equal(ok(await core.call<FundView>("account.fund.status")).wordsDone, true);
  assert.equal(chain.accounts.has(f.accountId), false, "nothing on chain yet: no money, no account");
  // The NEAR arrives: the account opens by itself, with the checked words' key, and is ready: no second words step.
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  const done = await settle(core, (x) => x.stage === "ready");
  assert.deepEqual([done.state, done.wordsDone], ["done", true]);
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  assert.equal(await vault.get("pending-words"), null, "the words leave the vault once their key is on chain");
  assert.equal(await vault.get("words-checked-first"), null);
  assert.deepEqual(ok(await core.call<{ matches: boolean }>("recovery.check", { words })), { matches: true }, "the key on chain is these words'");
  core.close();
});

test("O-2c (QA): NEAR that comes before the words are checked opens no account and waits at the setup address; checked, it opens ready (a check of other words never counts)", async () => {
  const { chain, vault, core } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  // The mark is for exactly the kept words: a mark for others (planted) is never "checked".
  await vault.put("words-checked-first", new Uint8Array(32).fill(7));
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, true, "control: a mark of other words doesn't count");
  await vault.delete("words-checked-first");
  // The NEAR comes first (sent straight to the setup address, or to an address from before O-2a).
  await addressBeforeO2a(core, vault, "near");
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  const waits = await settle(core, (x) => x.waitsForWords === true);
  assert.equal(waits.stage, "needs-funding");
  assert.equal(waits.deposit?.address, f.fundAddress, "review M: kept as a NEAR order, so the checklist shows (never the coins)");
  for (let i = 0; i < 5; i++) ok(await core.call("account.fund.status")); // reads again and again: still nothing opens
  const again = ok(await core.call<{ stage: string; wordsDue?: boolean }>("account.create"));
  assert.deepEqual([again.stage, again.wordsDue], ["needs-funding", true], "account.create doesn't open it either");
  assert.equal(chain.accounts.has(f.accountId), false, "no account before the words");
  assert.equal(chain.accounts.get(f.fundAddress)!.balance, BigInt(f.needYocto), "the NEAR waits where it was sent");
  // Control: checked, the account opens by itself, ready, with the same words' key.
  ok(await core.call("recovery.confirm", { positions: [2, 3, 4], words: words.slice(1, 4) }));
  await settle(core, (x) => x.stage === "ready");
  assert.ok(chain.accounts.has(f.accountId));
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  core.close();
});

test("words first on the phone's own words screen: checked there; its old 'Check later' (no positions) is never a check", async () => {
  let answer: "check" | "later" = "later";
  const { core, vault } = phone({
    showWords: async (w: string[]) => (answer === "later" ? { positions: [], words: [] } : { positions: [3, 9, 17], words: [w[2], w[8], w[16]] }),
  });
  ok(await core.call("account.create"));
  assert.equal(code(await core.call("recovery.backup")), "security.backup.declined", "no positions: nothing was checked");
  assert.equal(await vault.get("words-checked-first"), null);
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, true);
  answer = "check";
  ok(await core.call("recovery.backup"));
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, undefined);
  core.close();
});

test("words first is only where the words go on chain with the account: a browser (K-2) keeps the old order", async () => {
  const { core } = phone({ secretsInMemory: true });
  ok(await core.call("account.create"));
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, undefined);
  assert.equal(code(await core.call("recovery.words")), "security.stage.wrong", "no words before the account in a browser");
  core.close();
});

test("the deposit watcher (J2, B1): money at the address on its own network ticks 'seen' within one read, before 1Click says anything", async () => {
  const { core, net } = phone();
  ok(await core.call("account.create"));
  await checkWords(core); // words first (O-2a)
  const v = ok(await core.call<FundView>("account.fund.start", { coin: "sol" }));
  const dep = v.deposit!.address;
  const amount = BigInt(relay.asked.at(-1)!.amount);
  assert.equal(v.state, "waiting");
  // The SOL lands: the very next read says so (1Click still says nothing), with the live ETA from 1Click's estimate.
  net.held.set(dep, amount);
  const t0 = Date.now();
  const seen = ok(await core.call<FundView>("account.fund.status"));
  assert.equal(`${seen.state}: ${seen.steps.map((s) => `${s.key}=${s.state}`).join(" ")}`, "working: seen=done near=now open=todo");
  assert.equal(seen.arrived, coinText(amount, 9, "down"));
  const eta = Date.parse(seen.etaIso!) - t0;
  // 1Click's 22 s and the move on's half minute (D137: no private gap; control: the old 210 s gap would be 231 s)
  assert.ok(eta >= 51_000 && eta <= 53_500, `the ETA is 1Click's 22 s plus the move on, from when it was seen (${eta} ms)`);
  // 1Click sweeps the address: what was seen stays seen.
  net.held.set(dep, 0n);
  assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "working");
  // A node that can't be read never un-sees it, nor makes it up.
  net.down(true);
  assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "working");
  core.close();
});

test("the deposit watcher: less than the least is 'some arrived'; money already there at the start, or an unread network, is never 'seen'", async () => {
  {
    const { core, net } = phone();
    ok(await core.call("account.create"));
    await checkWords(core); // words first (O-2a)
    const dep = ok(await core.call<FundView>("account.fund.start", { coin: "sol" })).deposit!.address;
    net.held.set(dep, 5_000_000n);
    const short = ok(await core.call<FundView>("account.fund.status"));
    assert.deepEqual([short.state, short.steps[0].state], ["short", "failed"]);
    core.close();
  }
  {
    // Control: dust at the address before it was shown sets the start; only what comes after counts.
    const { core, net } = phone();
    ok(await core.call("account.create"));
    const next = relay.nextSol();
    net.held.set(next, 7n);
    await checkWords(core); // words first (O-2a)
    const dep = ok(await core.call<FundView>("account.fund.start", { coin: "sol" })).deposit!.address;
    assert.equal(dep, next);
    assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "waiting", "the 7 was there first");
    net.held.set(dep, 7n + BigInt(relay.asked.at(-1)!.amount));
    assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "working");
    core.close();
  }
  {
    const { core, net } = phone();
    ok(await core.call("account.create"));
    net.down(true);
    await checkWords(core); // words first (O-2a)
    ok(await core.call<FundView>("account.fund.start", { coin: "sol" }));
    assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "waiting", "unread is not empty, and not seen");
    core.close();
  }
});

// D123 (dead ends row 3): set-up offers each chain's own coin only, so the watcher is walked on what is offered (SOL, and
// ETH on Robinhood Chain as the chain's own coin); USDC and USDT are never given an address.
test("the deposit watcher reads each coin where it lives: SOL and Robinhood as their chains' own coins; USDC and USDT on Solana get no address", async () => {
  for (const [coin, key] of [["sol", (a: string) => a], ["hood-eth", (a: string) => a]] as const) {
    const { core, net } = phone();
    ok(await core.call("account.create"));
    await checkWords(core); // words first (O-2a)
    const dep = ok(await core.call<FundView>("account.fund.start", { coin })).deposit!.address;
    net.held.set(`${dep}|OtherCoin`, 99_000_000n);
    assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "waiting", `${coin}: another coin at the address isn't this one`);
    net.held.set(key(dep), BigInt(relay.asked.at(-1)!.amount));
    assert.equal(ok(await core.call<FundView>("account.fund.status")).state, "working", coin);
    core.close();
  }
  const { core } = phone();
  ok(await core.call("account.create"));
  await checkWords(core);
  for (const coin of ["usdc-sol", "usdt-sol"]) assert.equal(code(await core.call("account.fund.start", { coin })), "security.fund.coin-unknown", coin);
  core.close();
});

test("fundSteps: the watcher's word ticks seen and the change; 1Click's own word, once it has one, leads", () => {
  assert.equal(view(facts({ onChain: 10n })), "working: seen=done near=now open=todo");
  assert.equal(view(facts({ onChain: 3n })), "short: seen=failed near=todo open=todo");
  assert.equal(view(facts({ onChain: null })), "waiting: seen=now near=todo open=todo");
  assert.equal(view(facts({ onChain: 0n })), "waiting: seen=now near=todo open=todo");
  assert.equal(view(facts({ onChain: 10n, swap: { status: "REFUNDED" } })), "refunded: seen=done near=failed open=todo");
  assert.equal(view(facts({ onChain: 3n, swap: { status: "PROCESSING" } })), "working: seen=done near=now open=todo", "1Click took it");
  // Seen on chain stays seen past the hour (the address took it).
  assert.equal(view(facts({ onChain: 10n, order: order({ startedAtMs: Date.now() - 2 * 3_600_000 }) })), "working: seen=done near=now open=todo");
  assert.deepEqual(overBase(null, {}), { arrived: null });
  assert.deepEqual(overBase(5n, {}), { arrived: 0n, base: "5" });
  assert.deepEqual(overBase(12n, { baseUnits: "5" }), { arrived: 7n });
  assert.deepEqual(overBase(0n, { baseUnits: "5", seenUnits: "7" }), { arrived: 7n }, "swept: what was seen stays");
  assert.deepEqual(overBase(null, { baseUnits: "5", seenUnits: "7" }), { arrived: 7n });
});

test("words first, review L2 under O-2c: a check's mark written outside recovery.confirm (a race) still opens the waiting account ready, and the words are never shown again", async () => {
  const { chain, vault, core } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  await addressBeforeO2a(core, vault, "near");
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  await settle(core, (x) => x.waitsForWords === true);
  // The check's mark, for exactly the kept words, written while the money waited.
  const { sha256 } = await import("@noble/hashes/sha2.js");
  await vault.put("words-checked-first", sha256((await vault.get("pending-words"))!));
  await settle(core, (x) => x.stage === "ready");
  assert.equal(code(await core.call("recovery.words")), "security.stage.wrong", "not shown again");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  assert.equal(await vault.get("pending-words"), null);
  core.close();
});

test("D115 + D123: set-up offers each trading chain's own coin only (NEAR, SOL, Robinhood), never USDC or USDT, and only where the private route reaches (control: the full list holds them all, and the filter drops them)", () => {
  assert.equal(FUND_EVERY_CHAIN, false);
  assert.deepEqual(fundOffered().map((c) => c.id), ["near", "sol", "hood-eth"]);
  for (const id of ["usdc-sol", "usdt-sol", "eth", "base-eth", "arb-eth", "usdc-base", "usdc-eth", "usdc-arb", "usdt-eth"]) assert.ok(!fundOffered().some((c) => c.id === id), id);
  assert.ok(!fundOffered().some((c) => /BTC/.test(c.symbol)), "no Bitcoin");
  // control: the list itself still holds the tokens and the other chains (the filter is what drops them) ...
  assert.ok(["usdc-sol", "usdt-sol", "eth", "base-eth"].every((id) => FUND_COINS.some((c) => c.id === id)));
  // ... and D155 (the test proof build): every chain's own coin, Ethereum, Base and Arbitrum among them, through the
  // private route; a token never (setup-any-coin.test.ts has the whole list)
  assert.ok(["eth", "base-eth", "arb-eth", "btc"].every((id) => fundOffered(true).some((c) => c.id === id)));
  assert.ok(fundOffered(true).every((c) => !c.token), "never a token, switch on or off");
  assert.ok(fundOffered().every((c) => !c.token), "no token at all");
});

test("D115: a coin set-up doesn't offer now is never given an address (Ethereum, Base)", async () => {
  const { core } = phone();
  ok(await core.call("account.create"));
  await checkWords(core); // words first (O-2a)
  for (const coin of ["eth", "usdc-base", "btc"]) assert.ok("problem" in (await core.call("account.fund.start", { coin })), coin);
  core.close();
});

// ── O-2a (master plan row 16, QA 3 Nov): words first is the core's rule, not only the screens' order ─────────────────

test("O-2a: no address for any coin before the words are checked: nothing asked of 1Click, nothing kept; checked, it is given", async () => {
  const { core, vault, asked } = phone();
  ok(await core.call("account.create"));
  const coins = ok(await core.call<{ coins: { id: string }[] }>("account.fund.coins")).coins.map((c) => c.id);
  assert.ok(coins.length > 1, "the coins are still listed: reading them asks for no money");
  for (const coin of coins) {
    const r = await core.call("account.fund.start", { coin });
    assert.equal(code(r), "security.fund.words-first", coin);
    // The plain screen: what happened, no money involved, one step that leads to the words (App's "backup" → reroute).
    if ("problem" in r) assert.deepEqual([r.problem.money.state, r.problem.next], ["not-involved", { kind: "open", label: "Write down my words", screen: "backup" }]);
  }
  assert.equal(asked.length, 0, "no 1Click quote was asked");
  assert.equal(await vault.get("fund-orders"), null, "no order kept");
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, true, "the words are still due");
  // Control: a planted mark for other words unlocks nothing.
  await vault.put("words-checked-first", new Uint8Array(32).fill(7));
  assert.equal(code(await core.call("account.fund.start", { coin: "sol" })), "security.fund.words-first");
  await vault.delete("words-checked-first");
  // Control: checked, the same call gives the address.
  await checkWords(core);
  const v = ok(await core.call<FundView>("account.fund.start", { coin: "sol" }));
  assert.equal(v.state, "waiting");
  assert.ok(v.deposit?.address);
  core.close();
});

test("O-2a controls: a browser (no words before the account, K-2) is never asked for them; an address already on record is still read", async () => {
  const browser = phone({ secretsInMemory: true });
  ok(await browser.core.call("account.create"));
  assert.equal(ok(await browser.core.call<FundView>("account.fund.start", { coin: "near" })).state, "waiting", "a browser opens with NEAR, words after");
  browser.core.close();
  // A record from before O-2a: its address keeps being read, while a new one waits for the words.
  const { core, vault } = phone();
  ok(await core.call("account.create"));
  const before = await addressBeforeO2a(core, vault, "sol");
  assert.equal(ok(await core.call<{ wordsDue?: boolean }>("account.state")).wordsDue, true);
  assert.equal(ok(await core.call<FundView>("account.fund.status")).deposit?.address, before.deposit?.address);
  assert.equal(code(await core.call("account.fund.start", { coin: "near" })), "security.fund.words-first");
  core.close();
});

test("O-2a end to end (review L3): words checked, then SOL: a refund goes to the checked words' own confidential balance, the account opens ready", async () => {
  const { chain, vault, core } = phone();
  const funding = ok(await core.call<{ fundAddress: string; needYocto: string }>("account.create"));
  ok(await core.call("account.fund.coins"));
  const pending = (await vault.get("pending-words"))!;
  await checkWords(core);
  const v = ok(await core.call<FundView>("account.fund.start", { coin: "sol" }));
  const real = relay.asked.at(-1)!;
  assert.deepEqual([v.wordsDone, v.refundTo, real.refundTo, real.recipient], [true, undefined, floatOf(pending), floatOf(pending)], "refunds to the checked words' own confidential balance");
  const dep = v.deposit!.address;
  relay.status.set(dep, { status: "SUCCESS", details: { amountOut: real.amount } });
  chain.fund(funding.fundAddress, `ed25519:${toBase58(Buffer.from(funding.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(funding.fundAddress)!.balance = BigInt(funding.needYocto);
  const done = await settle(core, (x) => x.stage === "ready");
  assert.deepEqual([done.state, done.wordsDone], ["done", true]);
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready", "no second words step");
  assert.equal(code(await core.call("recovery.words")), "security.stage.wrong", "the checked words never show again");
  core.close();
});

test("O-2c review L: an opening begun before O-2c (stage creating, words unchecked) carries on, and its words are asked after (needs-backup), then ready", async () => {
  const { chain, vault, core } = phone();
  const f = ok(await core.call<{ fundAddress: string; needYocto: string; accountId: string }>("account.create"));
  ok(await core.call("recovery.words")); // the words exist (kept), not checked
  chain.fund(f.fundAddress, `ed25519:${toBase58(Buffer.from(f.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(f.fundAddress)!.balance = BigInt(f.needYocto);
  // A record from before O-2c: the opening began (the named account made) and stopped there, words never checked.
  // Made here the only way the core allows now: the check's mark for one call, its second transaction failing.
  const { sha256 } = await import("@noble/hashes/sha2.js");
  await vault.put("words-checked-first", sha256((await vault.get("pending-words"))!));
  let sends = 0;
  const send = chain.send.bind(chain) as (...a: unknown[]) => ReturnType<FakeChain["send"]>;
  (chain as unknown as { send: (...a: unknown[]) => unknown }).send = async (...a: unknown[]) => {
    if (++sends === 2) throw new Error("node down");
    return send(...a);
  };
  assert.equal(code(await core.call("account.create")), "security.account.create-failed");
  assert.ok(chain.accounts.has(f.accountId), "the named account was made: the opening began");
  await vault.delete("words-checked-first");
  (chain as unknown as { send: unknown }).send = send;
  // It carries on (never waits for words it began without), opens needing its words, then they are checked: ready.
  ok(await core.call("account.fund.note", { retry: true }));
  const v = await settle(core, (x) => x.stage === "needs-backup" || x.stage === "ready");
  assert.equal(v.stage, "needs-backup");
  assert.equal(v.waitsForWords, undefined);
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  core.close();
});
