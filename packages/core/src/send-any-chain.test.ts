// Home's Send (the Home plan §1.3, E3, E4; D128): from a wallet or the Safe to ANY address on any covered chain, through
// the pocket on the way. Leg 1 brings the coin into the pocket (privateQuoteIn `through`); leg 2 pays out any coin on any
// chain 1Click pays, covered by leg 1's own signed minimum in the same coin. The pocket's $100 is gone from this path;
// the quote relay's own limit stays and is said by name.
import { rawInSheet } from "./testing/no-raw.ts";
import { test } from "node:test";
import { honestPage } from "./testing/honest-payee.ts";
import assert from "node:assert/strict";
import { base64 } from "./sol/bytes.ts";
import type { EvmChain } from "./evm.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const SOL_IN = "nep141:sol.omft.near";
const HOOD_IN = "nep141:hood.omft.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BNB = "nep245:v2_1.omni.hot.tg:56_11111111111111111111";
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const OUT = "d".repeat(64);
const NONCE = base64(new Uint8Array(32).fill(3));
const EVM_PAYEE = "0x12345678901234567890123456789012345678ab";
const SOL_PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";

interface Leg2 { coin: string; dest: string; recipient: string; recipientType?: string; amountIn: string; minOut: string; usd: string }

async function setup(o: { leg1Usd?: string; refuse?: string; said?: string; approve?: boolean } = {}) {
  /** what 1Click says of a leg 1's address: waiting for money, unless a test says it has seen some */
  const seen = { status: "PENDING_DEPOSIT" };
  const shown: PlainWords[] = [];
  const quoted = new Map<string, any>();
  let n = 0;
  let leg2: Leg2 | null = null;
  const relay: FloatRelay = {
    quote: async (req) => {
      if (o.refuse) throw Object.assign(new Error(o.said ?? "A private send goes up to $10,000."), { refused: true, code: o.refuse });
      const outside = req.originAsset !== USDC;
      const depositAddress = outside ? (req.originAsset === HOOD_IN ? `0x${"ab".repeat(19)}${(16 + n++).toString(16)}` : `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAW${String.fromCharCode(65 + n++)}A`) : `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  let pocket = "";
  const privateStatus = async (a: string) => {
    if (a === OUT && leg2) {
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
        quoteRequest: { dry: false, originAsset: leg2.coin, destinationAsset: leg2.dest, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: leg2.recipient, recipientType: leg2.recipientType ?? "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", swapType: "EXACT_INPUT", confidentiality: "basic" },
        quote: { depositAddress: OUT, amountIn: leg2.amountIn, amountInUsd: leg2.usd, minAmountOut: leg2.minOut, amountOut: leg2.minOut, deadline: DEADLINE },
      }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    return { status: seen.status, quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: o.leg1Usd ?? "5.10", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sent: string[] = [];
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async (tx: string) => (sent.push(tx), true), status: async () => ["ok", "ok"] } as unknown as SolChain;
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 0n }), nonce: async () => 7, tokenBalance: async () => 0n, token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 23_300n, send: async (_c: string, signed: string) => (sent.push(signed), true), receipt: async () => ["ok", "ok"],
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? `0x${(10n ** 21n).toString(16)}` : `0x${"0".repeat(64)}`),
  } as unknown as EvmChain;
  const said: [string, unknown][] = [];
  const w = honestPage(new SubWallets({ vault: new MemoryVault(), sol, evm, approve: async (words) => (shown.push(words), o.approve !== false), emit: (e: string, p: unknown) => void said.push([e, p]), quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } }), privateStatus);
  const p = await w.create("private", "near");
  pocket = p.address;
  await w.create("trade", "sol");
  await w.create("trade", "hood");
  const payload = (coin: string, amount: string) => ({
    message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [`imt:${MINTER}:${coin}`]: amount } }], signer_id: pocket }),
    nonce: NONCE,
    recipient: "intents.far",
  });
  /** leg 2 as 1Click would sign it: EXACT_INPUT of exactly leg 1's minimum, unless `amountIn` says otherwise */
  const pay = (l: Partial<Leg2> & Pick<Leg2, "coin" | "dest" | "recipient">, leg1: { minAmountOut: string }) => {
    leg2 = { amountIn: leg1.minAmountOut, minOut: "1000", usd: "5.00", ...l };
    return { payload: payload(leg2.coin, leg2.amountIn) };
  };
  return { w, shown, sent, pay, pocket: p, seen, said };
}

test("E3: one wallet sends to any chain 1Click pays: SOL wallet → BNB Chain, SOL wallet → a NEAR account, Robinhood wallet → Solana, → Base; each to an outside payee asks Face ID once (QA, 5 Nov)", async () => {
  const cases = [
    { from: "sol", coin: SOL_IN, l: { dest: BNB, recipient: EVM_PAYEE, minOut: "8000000000000000" } },
    { from: "sol", coin: SOL_IN, l: { dest: "nep141:wrap.near", recipient: "alice.near", minOut: "1200000000000000000000000" } },
    { from: "hood", coin: HOOD_IN, l: { dest: SOL_IN, recipient: SOL_PAYEE, minOut: "40000000" } },
    { from: "hood", coin: HOOD_IN, l: { dest: "nep141:base.omft.near", recipient: EVM_PAYEE, minOut: "1000000000000000" } },
  ] as const;
  for (const c of cases) {
    const s = await setup();
    const leg1 = await s.w.privateQuoteIn(c.coin, c.from === "sol" ? "50000000" : "2000000000000000", true, true);
    const r = (await s.w.hiddenFromRow(c.from, leg1.depositAddress, OUT, s.pay({ coin: c.coin, ...c.l }, leg1), "tag-for-this-quote-0001")) as any;
    assert.deepEqual(s.shown.map((x) => [x.tap, x.lines[0]]), [[undefined, `To ${c.l.recipient}`]], `${c.from} → ${c.l.dest}: one Face ID sheet, the full address`);
    assert.equal(r.leg1.status, "done");
    assert.ok(r.signedData?.signature, "leg 2 signed, handed back for after leg 1 lands");
    assert.equal(s.sent.length, 1, "leg 1 sent from the wallet");
  }
});

test("E3: the join holds for any destination: a leg 2 that takes more than leg 1's signed minimum is refused, nothing sent (control: exactly the minimum goes)", async () => {
  const s = await setup();
  const leg1 = await s.w.privateQuoteIn(SOL_IN, "50000000", true, true);
  // security review M2: leg 1's own status tag comes back with it, so the wallet can read what arrived through the relay
  assert.equal(leg1.statusTag, "tag-for-this-quote-0001");
  const over = (BigInt(leg1.minAmountOut) + 1n).toString();
  await assert.rejects(s.w.hiddenFromRow("sol", leg1.depositAddress, OUT, s.pay({ coin: SOL_IN, dest: BNB, recipient: EVM_PAYEE, amountIn: over }, leg1)), (e: any) => /may bring less than the payment needs/.test(e.problem.more));
  assert.deepEqual([s.shown.length, s.sent.length], [0, 0]);
  const ok = (await s.w.hiddenFromRow("sol", leg1.depositAddress, OUT, s.pay({ coin: SOL_IN, dest: BNB, recipient: EVM_PAYEE }, leg1))) as any;
  assert.equal(ok.leg1.status, "done");
});

test("D128: a Send over the pocket's $10,000 passes the core when the relay allows it; the cap stays on a plain move in (control: the same leg without `through` is refused)", async () => {
  const s = await setup({ leg1Usd: "12500.00" });
  const leg1 = await s.w.privateQuoteIn(SOL_IN, "2500000000", true, true);
  const r = (await s.w.hiddenFromRow("sol", leg1.depositAddress, OUT, s.pay({ coin: SOL_IN, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, usd: "12400.00", minOut: "100000000000000000" }, leg1))) as any;
  assert.equal(r.leg1.status, "done", "a $12,500 send goes");
  assert.ok(r.signedData?.signature);
  const plain = await setup({ leg1Usd: "12500.00" });
  await assert.rejects(plain.w.privateQuoteIn(SOL_IN, "2500000000", true), (e: any) => /A private send goes up to \$10,000/.test(e.problem.more), "control: a move in that stays is still held to $10,000");
});

test("D128: a Send's leg 1 never counts toward any other move in, and is never an Add on its way (control: an Add's leg counts, and is listed)", async () => {
  const s = await setup({ leg1Usd: "9000.00" });
  await s.w.privateQuoteIn(SOL_IN, "900000000", true, true);
  s.seen.status = "PROCESSING";
  assert.deepEqual(await s.w.privateAddsOnWay(), [], "a send's leg 1 isn't money arriving");
  s.seen.status = "PENDING_DEPOSIT";
  await s.w.privateQuoteIn(SOL_IN, "900000001", true);
  s.seen.status = "PROCESSING";
  const adds = await s.w.privateAddsOnWay();
  assert.equal(adds.length, 1, "control: an Add on its way is listed");
  s.seen.status = "PENDING_DEPOSIT";
  // the Add above ($9,000, counted) now fills the pocket's $10,000: a second plain one is refused, a Send's leg still goes
  await assert.rejects(s.w.privateQuoteIn(SOL_IN, "900000002", true), (e: any) => /Your private balance holds at most \$10,000/.test(e.problem.more));
  await s.w.privateQuoteIn(SOL_IN, "900000003", true, true);
});

test("the relay's own limit is said as the relay's, never as 1Click's no (control: another refusal stays 1Click's)", async () => {
  const big = await setup({ refuse: "quotes.request.too-big" });
  await assert.rejects(big.w.privateQuoteIn(SOL_IN, "50000000", true, true), (e: any) => e.problem.more === "ZeroFee's price server takes up to $10,000 a send. Nothing moved.");
  // security review L6: the figure is the relay's own, from its answer, never one kept in the core
  const raised = await setup({ refuse: "quotes.request.too-big", said: "A private send goes up to $25,000." });
  await assert.rejects(raised.w.privateQuoteIn(SOL_IN, "50000000", true, true), (e: any) => e.problem.more === "ZeroFee's price server takes up to $25,000 a send. Nothing moved.");
  const other = await setup({ refuse: "quotes.request.refused" });
  await assert.rejects(other.w.privateQuoteIn(SOL_IN, "50000000", true, true), (e: any) => /^NEAR Intents said no\. Nothing moved\./.test(e.problem.more));
});

test("E4: privatePay joined to the Safe's leg 1 (inDeposit): over the pocket's $10,000 goes, no sheet; leg 1 is marked paid as it is signed, so no second payment joins it", async () => {
  const s = await setup({ leg1Usd: "12000.00" });
  const leg1 = await s.w.privateQuoteIn(USDC, "300000000", false, true);
  const ask = s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, usd: "11990.00", minOut: "3100000000" }, leg1);
  const r = (await s.w.privatePay(s.pocket.id, OUT, ask, "Send $300", "tag-for-this-quote-0001", leg1.depositAddress)) as any;
  assert.ok(r.signedData?.signature);
  assert.equal(s.shown.length, 0, "no sheet: the Safe's own sheet is the one for leg 1");
  await assert.rejects(s.w.privatePay(s.pocket.id, OUT, ask, "again", "tag-for-this-quote-0001", leg1.depositAddress), (e: any) => /wasn't priced here/.test(e.problem.more), "one payment per leg 1");
  // control: without inDeposit the same $11,990 payment is held to the pocket's $10,000
  const t = await setup({ leg1Usd: "12000.00" });
  const l1 = await t.w.privateQuoteIn(USDC, "300000000", false, true);
  await assert.rejects(t.w.privatePay(t.pocket.id, OUT, t.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, usd: "11990.00" }, l1), "x", "tag-for-this-quote-0001"), (e: any) => /up to \$10,000/.test(e.problem.more));
});

test("E4: the join against the Safe's leg 1 refuses a bigger payment, another coin, a leg 1 that isn't a Send's, and a refusal marks nothing (control: the right payment then joins, once)", async () => {
  const s = await setup();
  const leg1 = await s.w.privateQuoteIn(USDC, "10000000", false, true);
  const over = s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: (BigInt(leg1.minAmountOut) + 1n).toString() }, leg1);
  await assert.rejects(s.w.privatePay(s.pocket.id, OUT, over, "x", "tag-for-this-quote-0001", leg1.depositAddress), (e: any) => /may bring less than the payment needs/.test(e.problem.more));
  const coin = s.pay({ coin: "nep141:wrap.near", dest: SOL_IN, recipient: SOL_PAYEE, amountIn: "1000" }, leg1);
  await assert.rejects(s.w.privatePay(s.pocket.id, OUT, coin, "x", "tag-for-this-quote-0001", leg1.depositAddress), (e: any) => /may bring less/.test(e.problem.more), "never the pocket's other coin");
  assert.equal(s.shown.length, 0, "no sheet for any of them");
  const notSend = await setup();
  const kept = await notSend.w.privateQuoteIn(USDC, "10000000", false);
  await assert.rejects(notSend.w.privatePay(notSend.pocket.id, OUT, notSend.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, kept), "x", "tag-for-this-quote-0001", kept.depositAddress), (e: any) => /wasn't priced here/.test(e.problem.more), "a plain move in is never a Send's leg 1");
  // the refusals above left leg 1 unpaid: the right payment still joins it (control), and only once
  const ask = s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, leg1);
  assert.ok(((await s.w.privatePay(s.pocket.id, OUT, ask, "x", "tag-for-this-quote-0001", leg1.depositAddress)) as any).signedData);
  await assert.rejects(s.w.privatePay(s.pocket.id, OUT, ask, "x", "tag-for-this-quote-0001", leg1.depositAddress), (e: any) => /wasn't priced here/.test(e.problem.more), "never a second payment on one leg 1");
  assert.equal(s.shown.length, 0);
});

test("QA's MUST (5 Nov): a Move's Private leg is the core's own record: the pocket's share it signed (`send`) joins the Safe's leg 2 to the same payee in the same coin, read by leg 1's address, once (controls: another payee, no share, or a refused join: none)", async () => {
  const s = await setup();
  const share = s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: "12500000", usd: "12.50" }, { minAmountOut: "12500000" });
  await s.w.privatePay(s.pocket.id, OUT, share, "Move", "tag-for-this-quote-0001", undefined, true);
  const leg1 = await s.w.privateQuoteIn(USDC, "20000000", false, true);
  assert.equal(s.w.privateLeg(leg1.depositAddress), null, "nothing before leg 2 joins");
  await s.w.privatePay(s.pocket.id, OUT, s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, leg1), "Move", "tag-for-this-quote-0001", leg1.depositAddress);
  // the ruling (the audit and the copy review, 5 Nov): leg 2's own signed amountIn and its payee beside the share; `own` is ownPayee's word
  assert.deepEqual(s.w.privateLeg(leg1.depositAddress), { tokenId: USDC, payUnits: "19800000", recipient: SOL_PAYEE, own: false, toTokenId: SOL_IN, units: "12500000" });
  assert.equal(s.w.privateLeg("f".repeat(64)), null, "only that move in's address");
  // controls: the share went to another payee; no share at all; a join that was refused records nothing
  const other = await setup();
  await other.w.privatePay(other.pocket.id, OUT, other.pay({ coin: USDC, dest: SOL_IN, recipient: "So11111111111111111111111111111111111111112", amountIn: "12500000", usd: "12.50" }, { minAmountOut: "12500000" }), "Move", "tag-for-this-quote-0001", undefined, true);
  const o1 = await other.w.privateQuoteIn(USDC, "20000000", false, true);
  await other.w.privatePay(other.pocket.id, OUT, other.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, o1), "Move", "tag-for-this-quote-0001", o1.depositAddress);
  assert.equal(other.w.privateLeg(o1.depositAddress)?.units, undefined, "another payee: no Private share");
  const none = await setup();
  const n1 = await none.w.privateQuoteIn(USDC, "20000000", false, true);
  await none.w.privatePay(none.pocket.id, OUT, none.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, n1), "Move", "tag-for-this-quote-0001", n1.depositAddress);
  assert.deepEqual(none.w.privateLeg(n1.depositAddress), { tokenId: USDC, payUnits: "19800000", recipient: SOL_PAYEE, own: false, toTokenId: SOL_IN }, "no share: leg 2 alone, no Private share");
  // the person's own SOL wallet as the payee: ownPayee says so
  const mine = await setup();
  const solOwn = (await mine.w.list()).find((x: any) => x.kind === "trade" && x.chain === "sol")!.address;
  const m1 = await mine.w.privateQuoteIn(USDC, "20000000", false, true);
  await mine.w.privatePay(mine.pocket.id, OUT, mine.pay({ coin: USDC, dest: SOL_IN, recipient: solOwn }, m1), "Move", "tag-for-this-quote-0001", m1.depositAddress);
  assert.equal(mine.w.privateLeg(m1.depositAddress)?.own, true);
  const bad = await setup();
  await bad.w.privatePay(bad.pocket.id, OUT, bad.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: "12500000", usd: "12.50" }, { minAmountOut: "12500000" }), "Move", "tag-for-this-quote-0001", undefined, true);
  const b1 = await bad.w.privateQuoteIn(USDC, "20000000", false, true);
  await assert.rejects(bad.w.privatePay(bad.pocket.id, OUT, bad.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: (BigInt(b1.minAmountOut) + 1n).toString() }, b1), "Move", "tag-for-this-quote-0001", b1.depositAddress));
  assert.equal(bad.w.privateLeg(b1.depositAddress), null);
});

test("the pocket's own share of a Send (`send`): over the pocket's $10,000 goes; audit C1: over the one cap it asks first (decision C, 4 Nov: to an outside payee, Face ID), and a no signs nothing; still never with no price (control: an ordinary pocket payment is still held to $10,000)", async () => {
  const s = await setup();
  const ask = s.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "180000000", usd: "12000.00", minOut: "60000000000000000" }, { minAmountOut: "180000000" });
  const r = (await s.w.privatePay(s.pocket.id, OUT, ask, "Send", "tag-for-this-quote-0001", undefined, true)) as any;
  assert.ok(r.signedData?.signature);
  assert.deepEqual(s.shown.map((x) => [x.title, x.lines[0], x.tap, x.asker]), [["Send from Private", `To ${EVM_PAYEE}`, undefined, "wallet"]], "asked once, Face ID: the payee isn't one of the person's wallets (QA, 5 Nov: at any amount)");
  const no = await setup({ approve: false });
  const noAsk = no.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "180000000", usd: "12000.00", minOut: "60000000000000000" }, { minAmountOut: "180000000" });
  await assert.rejects(no.w.privatePay(no.pocket.id, OUT, noAsk, "Send", "tag-for-this-quote-0001", undefined, true), (e: any) => e.problem.code === "security.send.declined" && e.problem.money.where === "in Private", "a no signs nothing, and is the person's no (QA's lap: never \"ZeroFee said no\")");
  // D128: no cap on a Send, but a price is still a must
  for (const usd of ["", "1e5"]) {
    const n = await setup();
    const priceless = n.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "180000000", usd, minOut: "60000000000000000" }, { minAmountOut: "180000000" });
    await assert.rejects(n.w.privatePay(n.pocket.id, OUT, priceless, "Send", "tag-for-this-quote-0001", undefined, true), (e: any) => e.problem.code === "security.subwallet.refused" && /no price/.test(e.problem.more), JSON.stringify(usd));
  }
  const t = await setup();
  await assert.rejects(t.w.privatePay(t.pocket.id, OUT, t.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: "180000000", usd: "12000.00" }, { minAmountOut: "180000000" }), "x", "tag-for-this-quote-0001"), (e: any) => /up to \$10,000/.test(e.problem.more));
});

test("decision C (product decision, 4 Nov): a Send from the private balance past the cap asks Face ID only for an outside payee; to the person's own wallet it stays one tap, and a wallet whose key was shown counts as outside", async () => {
  const big = (recipient: string) => ({ coin: USDC, dest: "nep141:eth.omft.near", recipient, amountIn: "180000000", usd: "12000.00", minOut: "60000000000000000" });
  const s = await setup();
  const mine = (await s.w.list()).find((x) => x.chain === "hood")!;
  await s.w.privatePay(s.pocket.id, OUT, s.pay(big(mine.address), { minAmountOut: "180000000" }), "Send", "tag-for-this-quote-0001", undefined, true);
  assert.deepEqual(s.shown.map((x) => x.tap), [true], "the person's own wallet: one tap");
  // the same wallet in other letters is still theirs
  await s.w.privatePay(s.pocket.id, OUT, s.pay(big(mine.address.toUpperCase().replace(/^0X/, "0x")), { minAmountOut: "180000000" }), "Send", "tag-for-this-quote-0001", undefined, true).catch(() => undefined);
  assert.ok(s.shown.slice(1).every((x) => x.tap === true), "other letter case: still one tap");
  // its key shown: it counts as outside from now on
  await s.w.export(mine.id);
  s.shown.length = 0;
  await s.w.privatePay(s.pocket.id, OUT, s.pay(big(mine.address), { minAmountOut: "180000000" }), "Send", "tag-for-this-quote-0001", undefined, true);
  assert.deepEqual(s.shown.map((x) => x.tap), [undefined], "a wallet whose key was shown: Face ID");
});

test("QA's SHOULD: the pocket's own share of a Send to the person's own wallet, under the cap: no sheet (D143), signed", async () => {
  const s = await setup();
  const mine = (await s.w.create("browser", "hood")).address;
  const ask = s.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: mine, amountIn: "3000000", usd: "3.00", minOut: "1000000000000000" }, { minAmountOut: "3000000" });
  const r = (await s.w.privatePay(s.pocket.id, OUT, ask, "Send", "tag-for-this-quote-0001", undefined, true)) as any;
  assert.ok(r.signedData?.signature, "signed");
  assert.equal(s.shown.length, 0, "their own wallet, $3: no sheet");
  // control: the same to an outside payee asks Face ID
  const t = await setup();
  const out = t.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "3000000", usd: "3.00", minOut: "1000000000000000" }, { minAmountOut: "3000000" });
  await t.w.privatePay(t.pocket.id, OUT, out, "Send", "tag-for-this-quote-0001", undefined, true);
  assert.deepEqual(t.shown.map((x) => x.tap), [undefined], "outside: one Face ID sheet");
});

test("QA's MUST 1 (5 Nov, a Send's fill): the payout is bound to its move in when the pocket's payment joins it, as 1Click signed its quote (the payee in full, the coin, what leaves Private, what they get), read by that move in's address only, once (controls: another address, before the join, a refused join: none)", async () => {
  const s = await setup();
  const leg1 = await s.w.privateQuoteIn(USDC, "20000000", false, true);
  assert.equal(s.w.sendPayout(leg1.depositAddress), null, "nothing before the payment joins");
  await s.w.privatePay(s.pocket.id, OUT, s.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE }, leg1), "Send", "tag-for-this-quote-0001", leg1.depositAddress);
  const bound = s.w.sendPayout(leg1.depositAddress);
  assert.ok(bound, "bound");
  assert.deepEqual([bound!.recipient, bound!.originAsset, bound!.destinationAsset, bound!.amountIn], [SOL_PAYEE, USDC, SOL_IN, leg1.minAmountOut]);
  assert.match(bound!.amountOut, /^\d+$/);
  assert.equal(s.w.sendPayout("f".repeat(64)), null, "only that move in's address");
  const bad = await setup();
  const b1 = await bad.w.privateQuoteIn(USDC, "20000000", false, true);
  await assert.rejects(bad.w.privatePay(bad.pocket.id, OUT, bad.pay({ coin: USDC, dest: SOL_IN, recipient: SOL_PAYEE, amountIn: (BigInt(b1.minAmountOut) + 1n).toString() }, b1), "Send", "tag-for-this-quote-0001", b1.depositAddress));
  assert.equal(bad.w.sendPayout(b1.depositAddress), null, "a refused join binds nothing");
});

test("the audit's Send audit M9 (7 Nov): a Send Private pays whole says job.signed with its own key once its Face ID signed, before 1Click's answer; a no, no key, a bad key, a Move's leg, or no send: never [before: no job.signed]", async () => {
  const KEY = "home-send-0123456789abcdef01234567";
  const s = await setup();
  const ask = s.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "5000000", usd: "5.00", minOut: "1000" }, { minAmountOut: "5000000" });
  const r = (await s.w.privatePay(s.pocket.id, OUT, ask, "Send", "tag-for-this-quote-0001", undefined, true, undefined, undefined, undefined, KEY)) as any;
  assert.ok(r.signedData?.signature);
  assert.equal(s.shown.length, 1, "its Face ID first (an outside payee)");
  assert.deepEqual(s.said.filter(([e]) => e === "job.signed"), [["job.signed", { jobKey: KEY }]], "once, with its own key, after the yes");
  const no = await setup({ approve: false });
  const noAsk = no.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "5000000", usd: "5.00", minOut: "1000" }, { minAmountOut: "5000000" });
  await assert.rejects(no.w.privatePay(no.pocket.id, OUT, noAsk, "Send", "tag-for-this-quote-0001", undefined, true, undefined, undefined, undefined, KEY));
  assert.equal(no.said.filter(([e]) => e === "job.signed").length, 0, "control: a no signs nothing, says nothing");
  for (const key of [undefined, "short", "has spaces in it, sixteen+"]) {
    const c = await setup();
    const a = c.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "5000000", usd: "5.00", minOut: "1000" }, { minAmountOut: "5000000" });
    await c.w.privatePay(c.pocket.id, OUT, a, "Send", "tag-for-this-quote-0001", undefined, true, undefined, undefined, undefined, key);
    assert.equal(c.said.filter(([e]) => e === "job.signed").length, 0, `control: key ${String(key)}`);
  }
  const plain = await setup();
  const pa = plain.pay({ coin: USDC, dest: "nep141:eth.omft.near", recipient: EVM_PAYEE, amountIn: "5000000", usd: "5.00", minOut: "1000" }, { minAmountOut: "5000000" });
  await plain.w.privatePay(plain.pocket.id, OUT, pa, "Send", "tag-for-this-quote-0001", undefined, undefined, undefined, undefined, undefined, KEY).catch(() => undefined);
  assert.equal(plain.said.filter(([e]) => e === "job.signed").length, 0, "control: not a Send's own share (no send)");
});
