// Private money as fast as NEAR Intents allows (research 4 Nov, docs.near-intents.org signed-intent-execution): a swap
// inside the confidential balance is quote → generate-intent → signed by the float → submit-intent, with no deposit and no
// withdrawal, timed quote → settled on its own record; the core's own deposits, and an Add's deposit the push saw, are
// told to 1Click at once (deposit/submit through the relay, with the quote's tag). Every check has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { FloatGuard } from "./float.ts";
import { ADD_HINT_TXS, FLOAT_USDC, FloatMoves, SWAP_NOT_TAKEN, SWAP_UNANSWERED, type FloatMoveDeps, type FloatRelay } from "./float-moves.ts";
import { base64, utf8 } from "./sol/bytes.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const QTC = "nep141:qtc.omft.near";
const SOL = "nep141:sol.omft.near";
const TAG = "tag-for-this-quote-0001";
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const SIG = "5".repeat(88);
const FLOAT_SECRET = new Uint8Array(32).fill(3);
const FLOAT = Array.from(ed25519.getPublicKey(FLOAT_SECRET), (b) => b.toString(16).padStart(2, "0")).join("");

/** What 1Click pays out: QTC at $70 (12 places) for USDC, less 0.3 %; any other move, the same amount. */
const outOf = (req: any) => (req.destinationAsset === QTC ? String(BigInt(Math.floor(((Number(req.amount) / 1e6) * 0.997 / 70) * 1e12))) : req.amount);
/** 1Click behind the relay, as an honest one answers; every call is recorded by name. `refuseSubmit`: 1Click's own no. */
function relay(o: { refuseSubmit?: boolean; noAnswer?: { times: number } } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  const state = new Map<string, string>();
  let n = 0;
  const r: FloatRelay = {
    quote: async (req: any) => {
      calls.push({ name: "quote", args: [req] });
      const origin = req.depositType === "ORIGIN_CHAIN";
      const depositAddress = origin ? (req.originAsset === SOL ? SOL_DEPOSIT : `0x${String(n + 1).padStart(40, "a")}`) : (n + 1).toString(16).padStart(64, "d");
      n++;
      const deadline = new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: outOf(req), deadline }, zerofeeStatusTag: TAG };
    },
    generateIntent: async (signerId, depositAddress) => {
      calls.push({ name: "generateIntent", args: [signerId, depositAddress] });
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => {
      calls.push({ name: "submitIntent", args: [signed] });
      if (o.refuseSubmit) throw Object.assign(new Error("HTTP 400"), { refused: true });
      // 1Click's server trouble or a timeout: no answer, so nobody knows whether it ran
      if (o.noAnswer && o.noAnswer.times-- > 0) throw new Error("1Click didn't answer");
      return { intentHash: "h" };
    },
    submitDeposit: async (depositAddress, txHash, tag) => (calls.push({ name: "submitDeposit", args: [depositAddress, txHash, tag] }), {}),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const minAmountOut = String((BigInt(outOf(q.req)) * 99n) / 100n), minAmountIn = String((BigInt(q.req.amount) * 99n) / 100n);
      const quoteResponse = signedQuote({ quoteRequest: q.req, quote: { depositAddress, amountIn: q.req.amount, minAmountIn, minAmountOut, amountOut: outOf(q.req), deadline: q.deadline, timeEstimate: 20 } });
      const status = state.get(depositAddress) ?? "PENDING_DEPOSIT";
      return { status, quoteResponse, ...(status === "SUCCESS" ? { swapDetails: { amountIn: q.req.amount, amountOut: outOf(q.req) } } : {}) };
    },
  };
  const named = (name: string) => calls.filter((c) => c.name === name);
  return { r, calls, named, quotes, set: (dep: string, s: string) => state.set(dep, s) };
}

async function swapSetup(o: Parameters<typeof relay>[0] = {}) {
  const fake = relay(o);
  const vault = new MemoryVault();
  const w = new SubWallets({
    // no chain at all: an in-balance swap must never reach one (any call throws)
    vault, sol: {} as never, evm: {} as never, floatRelay: fake.r, mainAccount: async () => "kim.near",
    usdPrice: async () => 150, tokenPrice: async (t: string) => (t === QTC ? { usd: 70, decimals: 12, symbol: "QTC" } : null),
    approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY,
  } as never);
  await w.create("trade", "near");
  await vault.put("float-move-log", utf8(JSON.stringify({ base: { [FLOAT_USDC]: "50000000" }, kept: [] })));
  const held = async (t: string) => (await w.floatBalance()).tokens.find((x) => x.tokenId === t)?.amount ?? "0";
  return { w, held, ...fake };
}
const TRADE = { app: "trade" };

test("an in-balance swap: confidential in and out, quote → generate-intent → signed → submit-intent; never a deposit, a withdrawal or a chain; timed quote → settled", async () => {
  const s = await swapSetup();
  const m = await s.w.floatSwap("buy", QTC, "5000000", "0", "pf-swap-00000001", TRADE);
  assert.ok(!("declined" in m));
  const q = s.named("quote")[0]!.args[0] as any;
  assert.deepEqual([q.depositType, q.recipientType, q.refundType, q.dry], ["CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", false]);
  assert.deepEqual(s.calls.map((c) => c.name).filter((x) => x !== "status"), ["quote", "generateIntent", "submitIntent"], "the signed-intent path, in order");
  assert.equal(s.named("submitDeposit").length, 0, "no deposit: the money is already inside");
  assert.ok(s.named("quote").every((c) => (c.args[0] as any).recipientType !== "DESTINATION_CHAIN" && (c.args[0] as any).depositType !== "ORIGIN_CHAIN"), "no withdrawal, no deposit quote");
  assert.ok(m.timing && m.timing.submittedMs! >= m.timing.quotedMs, "quote and submit times kept");
  assert.equal(m.timing!.settledMs, undefined, "not settled yet");
  s.set([...s.quotes.keys()][0]!, "SUCCESS");
  const done = await s.w.floatMove(m.id);
  assert.equal(done.status, "done");
  assert.ok(done.timing!.settledMs! >= done.timing!.submittedMs!, "quote → submitted → settled, as the core read it");
  // read again: the first settled time stays
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await s.w.floatMove(m.id)).timing!.settledMs, done.timing!.settledMs);
  assert.equal(s.named("submitDeposit").length, 0);
});

test("a submit-intent 1Click refuses leaves the balance untouched and says so (control: one it takes is counted gone)", async () => {
  const bad = await swapSetup({ refuseSubmit: true });
  await assert.rejects(bad.w.floatSwap("buy", QTC, "5000000", "0", "pf-swap-00000002", TRADE), (e: any) => String(e.problem?.more ?? e.problem?.whatHappened).includes(SWAP_NOT_TAKEN));
  assert.equal(await bad.held(FLOAT_USDC), "50000000", "the USDC never left");
  const [moved] = await bad.w.floatMoveList();
  assert.deepEqual([moved!.status, moved!.reason], ["failed", SWAP_NOT_TAKEN]);
  // a later read never sends the dropped intent again
  await bad.w.floatMove(moved!.id);
  assert.equal(bad.named("submitIntent").length, 1);
  const ok = await swapSetup();
  await ok.w.floatSwap("buy", QTC, "5000000", "0", "pf-swap-00000003", TRADE);
  assert.equal(await ok.held(FLOAT_USDC), "45000000", "control: taken, counted gone");
});

function floatSetup(o: { depositTxs?: (chain: string, address: string) => Promise<string[]>; pay?: () => Promise<string | null>; relay?: Parameters<typeof relay>[0]; balances?: () => Promise<{ tokenId: string; amount: string }[]> } = {}) {
  const fake = relay(o.relay);
  const vault = new MemoryVault();
  const clock = { t: Date.now() };
  const held: { tokenId: string; amount: string }[] = [];
  const deps: FloatMoveDeps = {
    vault, guard: new FloatGuard(vault, () => clock.t), relay: fake.r, now: () => clock.t, quoteKey: TEST_QUOTE_KEY,
    usdPrice: async () => 150, tokenPrice: async (t: string) => (t === QTC ? { usd: 70, decimals: 12, symbol: "QTC" } : null),
    float: async () => ({ address: FLOAT, secret: async () => FLOAT_SECRET }),
    wallet: async () => ({ id: "trade-sol-abc123", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }),
    mainAccount: async () => "kim.near", spendable: async () => 10n ** 9n, pay: o.pay ?? (async () => null),
    confidentialBalances: o.balances ?? (async () => held),
    ...(o.depositTxs ? { depositTxs: o.depositTxs as never } : {}),
  };
  return { f: new FloatMoves(deps), clock, held, ...fake };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("Add: the push's deposit goes to 1Click at once with its tag, once; then arrived (1Click has the deposit) → usable (1Click SUCCESS, in the NEAR wallet) (control: no transaction found yet, nothing sent, asked again on the next push)", async () => {
  let found: string[] = [];
  const looked: string[] = [];
  const s = floatSetup({ depositTxs: async (chain, address) => (looked.push(`${chain}:${address}`), found) });
  const a = await s.f.addOutside("sol", "wallet", "pf-add-key-000001");
  assert.equal(await s.f.addSeen(a.depositAddress), true);
  await settle();
  assert.deepEqual(looked, [`sol:${SOL_DEPOSIT}`]);
  assert.equal(s.named("submitDeposit").length, 0, "control: no transaction yet, nothing sent");
  found = [SIG];
  await s.f.addSeen(a.depositAddress);
  await settle();
  assert.deepEqual(s.named("submitDeposit").map((c) => c.args), [[SOL_DEPOSIT, SIG, TAG]], "its own address, the transaction, the quote's tag");
  await s.f.addSeen(a.depositAddress);
  await settle();
  assert.equal(s.named("submitDeposit").length, 1, "once per Add");
  // arrived: 1Click has the deposit
  const t0 = s.clock.t;
  s.set(a.depositAddress, "KNOWN_DEPOSIT_TX");
  const arrived = (await s.f.addsOnWay())[0]!;
  assert.equal(arrived.stage, "arriving");
  assert.ok(arrived.at?.received !== undefined && arrived.at.private === undefined, "arrived, not usable yet");
  // usable: 1Click says SUCCESS, the coin is in the NEAR wallet's private balance
  s.clock.t += 6_000;
  s.set(a.depositAddress, "SUCCESS");
  s.held.push({ tokenId: SOL, amount: a.amountIn });
  const usable = (await s.f.addsOnWay())[0]!;
  assert.equal(usable.at?.private, t0 + 6_000);
  assert.ok(usable.at!.received! <= usable.at!.private!);
});

test("a move in: the core's own deposit transaction goes to 1Click at once with its quote's tag (control: a transfer no node took sends nothing)", async () => {
  const s = floatSetup({ pay: async () => SIG });
  const m = await s.f.in("sol", 0, "100000000", "pf-in-key-0000001");
  assert.ok(!("declined" in m));
  await settle();
  const [dep] = [...s.quotes.keys()];
  assert.deepEqual(s.named("submitDeposit").map((c) => c.args), [[dep, SIG, TAG]]);
  const none = floatSetup({ pay: async () => null });
  await none.f.in("sol", 0, "100000000", "pf-in-key-0000002");
  await settle();
  assert.equal(none.named("submitDeposit").length, 0);
});

test("review L1: dust sent after the real deposit can't hide it: the newest 3 transactions at the address go to 1Click, never more (control: one transaction, one hint)", async () => {
  const dust = (n: number) => String(n).repeat(88);
  const s = floatSetup({ depositTxs: async () => [dust(1), dust(2), SIG, dust(3)] });
  const a = await s.f.addOutside("sol", "wallet", "pf-add-key-000002");
  await s.f.addSeen(a.depositAddress);
  await settle();
  assert.equal(ADD_HINT_TXS, 3);
  assert.deepEqual(s.named("submitDeposit").map((c) => c.args[1]), [dust(1), dust(2), SIG], "the real deposit, behind two dust transfers, still goes");
  const one = floatSetup({ depositTxs: async () => [SIG] });
  const b = await one.f.addOutside("sol", "wallet", "pf-add-key-000003");
  await one.f.addSeen(b.depositAddress);
  await settle();
  assert.deepEqual(one.named("submitDeposit").map((c) => c.args[1]), [SIG]);
});

test("review L2: a submit-intent with no answer is never 'nothing moved': open, counted gone, sent again; past its deadline failed only once 1Click's balance was read and holds it (controls: an unread or short balance keeps it open; 1Click's SUCCESS ends it done)", async () => {
  const ask = async () => true;
  const start = async (balances?: () => Promise<{ tokenId: string; amount: string }[]>) => {
    const s = floatSetup({ relay: { noAnswer: { times: 99 } }, ...(balances ? { balances } : {}) });
    await s.f.balance(); // the count starts from 1Click's own
    return s;
  };
  const usdc = [{ tokenId: FLOAT_USDC, amount: "50000000" }];
  const s = await start(async () => usdc);
  const m = await s.f.swap("buy", QTC, "5000000", "0", "pf-swap-00000004", ask);
  assert.ok(!("declined" in m));
  assert.deepEqual([m.status, m.reason], ["pending", SWAP_UNANSWERED], "open, never 'nothing moved'");
  const usdcHeld = async () => (await s.f.balance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount;
  assert.equal(await usdcHeld(), "45000000", "counted gone while nobody knows");
  // before its deadline: sent again on each read, still open
  const tries = s.named("submitIntent").length;
  const again = await s.f.move(m.id);
  assert.equal(again.status, "pending");
  assert.equal(s.named("submitIntent").length, tries + 1, "sent again");
  const dep = [...s.quotes.keys()][0]!;
  const deadline = Date.parse(s.quotes.get(dep)!.deadline);
  // past its deadline: 1Click's balance read, the USDC still there: failed, nothing moved, counted back
  s.clock.t = deadline + 1;
  const before = s.named("submitIntent").length;
  const ended = await s.f.move(m.id);
  assert.deepEqual([ended.status, ended.reason], ["failed", SWAP_NOT_TAKEN]);
  assert.equal(s.named("submitIntent").length, before, "never sent past its deadline");
  assert.equal(await usdcHeld(), "50000000", "counted back");
  // controls: a balance read that fails, or shows less than the swap, keeps it open
  for (const [name, read] of [["unread", async () => { throw new Error("no"); }], ["short", async () => [{ tokenId: FLOAT_USDC, amount: "4999999" }]]] as const) {
    const c = await start(async () => usdc);
    const cm = await c.f.swap("buy", QTC, "5000000", "0", "pf-swap-00000005", ask);
    c.clock.t = Date.parse(c.quotes.get([...c.quotes.keys()][0]!)!.deadline) + 1;
    (c as any).f.d.confidentialBalances = read;
    assert.equal((await c.f.move((cm as any).id)).status, "pending", name);
  }
  // control: 1Click says it ran: done, and the waiting line goes
  const ran = await start(async () => usdc);
  const rm = await ran.f.swap("buy", QTC, "5000000", "0", "pf-swap-00000006", ask);
  ran.set([...ran.quotes.keys()][0]!, "SUCCESS");
  const done = await ran.f.move((rm as any).id);
  assert.deepEqual([done.status, done.reason], ["done", undefined]);
});
