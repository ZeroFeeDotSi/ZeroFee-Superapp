// V4 Send: Hidden FROM the SOL row (subwallets.hiddenFromRow). Leg 1: the row's SOL into Hidden, by the core's own quote;
// leg 2: Hidden's payment, signed and handed back for the app to submit only once leg 1 lands. Leg 2 must be covered by
// leg 1's own signed minimum, in the same coin. D143: both are hot keys, so no sheet; Wallet's Hold is the act, and every
// check below is the gate.
import { test } from "node:test";
import { honestPage } from "./testing/honest-payee.ts";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base64 } from "./sol/bytes.ts";
import { unsignedEvmTx, type EvmChain } from "./evm.ts";
import { fromBase64, parseTx, toHex } from "./evm/wire.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const SOL_IN = "nep141:sol.omft.near";
const IMT_SOL = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${SOL_IN}`;
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OUT = "d".repeat(64);
const NONCE = base64(new Uint8Array(32).fill(3));

async function setup(o: { leg2In?: string; leg2Coin?: string; approve?: boolean; sent?: boolean; held?: bigint; seen?: (string | null)[]; ownPayee?: boolean } = {}) {
  const shown: PlainWords[] = [];
  let payeeAddress = PAYEE;
  const quoted = new Map<string, any>();
  let n = 0;
  const relay: FloatRelay = {
    quote: async (req) => {
      const depositAddress = `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWW${String.fromCharCode(65 + n++)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  let pocketAddress = "";
  const privateStatus = async (a: string) => {
    if (a === OUT) {
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
        quoteRequest: { dry: false, originAsset: o.leg2Coin ?? SOL_IN, destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", refundTo: pocketAddress, refundType: "CONFIDENTIAL_INTENTS", recipient: payeeAddress, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", swapType: "EXACT_OUTPUT", confidentiality: "basic" },
        quote: { depositAddress: OUT, amountIn: o.leg2In ?? "48000000", amountInUsd: "5.02", minAmountOut: "5000000", amountOut: "5000000", deadline: DEADLINE },
      }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "5.10", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sent: string[] = [];
  const sol = {
    balance: async () => o.held ?? 10n ** 9n,
    latestBlockhash: async () => "11111111111111111111111111111111",
    send: async (tx: string) => (sent.push(tx), o.sent !== false),
    status: async () => o.seen ?? ["ok", "ok"],
  } as unknown as SolChain;
  const w = honestPage(new SubWallets({ vault: new MemoryVault(), sol, evm: {} as any, approve: async (words) => (shown.push(words), o.approve !== false), emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } }), privateStatus);
  const pocket = await w.create("private", "near");
  pocketAddress = pocket.address;
  await w.create("trade", "sol");
  // the person's own other Solana wallet, its key never shown: a Send to it is theirs (ownPayee)
  if (o.ownPayee) payeeAddress = (await w.create("browser", "sol")).address;
  const leg1 = await w.privateQuoteIn(SOL_IN, "50000000", true);
  const payload = (coin = IMT_SOL, amount = o.leg2In ?? "48000000") => ({
    message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [o.leg2Coin ? `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${o.leg2Coin}` : coin]: amount } }], signer_id: pocket.address }),
    nonce: NONCE,
    recipient: "intents.far",
  });
  return { w, shown, sent, leg1, payload, pocket };
}

test("QA's ruling (5 Nov): to an outside payee, one Face ID sheet with the full address; leg 2 is signed and handed back and leg 1 is sent (control: a no is the person's no and sends nothing)", async () => {
  const { w, shown, sent, leg1, payload } = await setup();
  // H4 (audit 3 Nov): a payee other than the one the quote pays signs nothing and shows no sheet (the honest page below)
  await assert.rejects(w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }, "tag-for-this-quote-0001", undefined, { recipient: "7xKXtgZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZgAsU", recipientType: "DESTINATION_CHAIN", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" }), (e: any) => /pays someone you didn't pick/.test(e.problem.more));
  assert.equal(shown.length + sent.length, 0, "nothing shown, nothing sent");
  const r = (await w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }, "tag-for-this-quote-0001")) as any;
  assert.equal(shown.length, 1, "one sheet: the payee is outside");
  assert.equal(shown[0]!.tap, undefined, "Face ID, never one tap");
  assert.equal(shown[0]!.title, "Send from your SOL wallet");
  assert.equal(shown[0]!.lines[0], `To ${PAYEE}`, "the full address");
  assert.equal(shown[0]!.lines.at(-1), "Public on Solana.", "QA's filing, the copy review's words (5 Nov): the real outside sheet says where it's public");
  assert.equal(shown[0]!.amount, "0.05 SOL");
  // QA's lap (5 Nov): the wallet by its own name, never its kind
  assert.doesNotMatch(JSON.stringify(shown[0]), /Chain wallet/, "control: the stored kind label never reaches the sheet");
  assert.equal(sent.length, 1, "leg 1 sent");
  assert.equal(r.leg1.status, "done");
  assert.ok(r.signedData?.signature, "leg 2 signed, for the app to submit after leg 1 lands");
  const no = await setup({ approve: false });
  await assert.rejects(no.w.hiddenFromRow("sol", no.leg1.depositAddress, OUT, { payload: no.payload() }, "tag-for-this-quote-0001"), (e: any) => e.problem.code === "security.send.declined" && e.problem.whatHappened === "Nothing was sent." && /^in your .+/.test(e.problem.money.where));
  assert.equal(no.sent.length, 0, "control: a no sends nothing");
});

test("leg 1 short: a leg 2 that leg 1's own minimum can't cover is refused before any sheet; nothing signed or sent", async () => {
  // leg 1 brings at least 49.5M units (50M less 1 %); a leg 2 that takes 49.6M is refused
  const { w, shown, sent, leg1, payload } = await setup({ leg2In: "49600000" });
  await assert.rejects(w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }), (e: any) => /may bring less than the payment needs/.test(e.problem.more));
  assert.deepEqual([shown.length, sent.length], [0, 0]);
  // control: exactly the minimum goes
  const ok = await setup({ leg2In: "49500000" });
  assert.equal(((await ok.w.hiddenFromRow("sol", ok.leg1.depositAddress, OUT, { payload: ok.payload() })) as any).leg1.status, "done");
});

test("leg 2 in another coin than leg 1 brings (Hidden's other money by surprise) is refused", async () => {
  const usdc = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const { w, shown, leg1, payload } = await setup({ leg2Coin: usdc, leg2In: "5000000" });
  await assert.rejects(w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }), (e: any) => /may bring less/.test(e.problem.more));
  assert.equal(shown.length, 0);
});

test("a leg 1 this core didn't price, leg 1 not sent, a row short, and a double tap", async () => {
  const a = await setup();
  await assert.rejects(a.w.hiddenFromRow("sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWZ", OUT, { payload: a.payload() }), (e: any) => /wasn't priced here/.test(e.problem.more), "not priced here");
  assert.equal(a.sent.length, 0, "nothing sent for a leg 1 not priced here");
  const unsent = await setup({ sent: false });
  const u = (await unsent.w.hiddenFromRow("sol", unsent.leg1.depositAddress, OUT, { payload: unsent.payload() })) as any;
  assert.equal(u.leg1.status, "problem");
  assert.equal(u.signedData, undefined, "leg 1 never reached the network: leg 2 is never handed back");
  const poor = await setup({ held: 1000n });
  await assert.rejects(poor.w.hiddenFromRow("sol", poor.leg1.depositAddress, OUT, { payload: poor.payload() }), (e: any) => e.problem.code === "security.balance.low-coin");
  assert.equal(poor.sent.length, 0, "a short row sends nothing");
  const twice = await setup();
  const [one, two] = await Promise.allSettled([twice.w.hiddenFromRow("sol", twice.leg1.depositAddress, OUT, { payload: twice.payload() }), twice.w.hiddenFromRow("sol", twice.leg1.depositAddress, OUT, { payload: twice.payload() })]);
  assert.equal(one.status, "fulfilled");
  assert.ok(two.status === "rejected" && /one at a time/.test((two.reason as any).problem.more), "a double tap goes once");
  assert.equal(twice.sent.length, 1);
  // a SOL price never pays from ETH (RH) (its coin is the row's own), and a chain with no row is refused
  await assert.rejects(a.w.hiddenFromRow("hood", a.leg1.depositAddress, OUT, { payload: a.payload() }), (e: any) => /isn't the one asked for/.test(e.problem.more), "the SOL row's price, asked from Robinhood");
  await assert.rejects(a.w.hiddenFromRow("bsc", a.leg1.depositAddress, OUT, { payload: a.payload() }), (e: any) => /only from your SOL wallet or your Robinhood wallet/.test(e.problem.more));
});

test("review fixes: leg 2 only when leg 1 is done on both nodes; one quote address is paid once; room for Solana's fee", async () => {
  const slow = await setup({ seen: [null, null] });
  const r = (await slow.w.hiddenFromRow("sol", slow.leg1.depositAddress, OUT, { payload: slow.payload() })) as any;
  assert.equal(r.leg1.status, "problem", "unconfirmed");
  assert.equal(r.signedData, undefined, "leg 2 kept back: never handed out for a leg 1 not seen done");
  const once = await setup();
  await once.w.hiddenFromRow("sol", once.leg1.depositAddress, OUT, { payload: once.payload() });
  await assert.rejects(once.w.hiddenFromRow("sol", once.leg1.depositAddress, OUT, { payload: once.payload() }), (e: any) => /wasn't priced here/.test(e.problem.more), "the same address never paid twice");
  // 50M lamports leg 1 + 1M room: 50.9M held is short, 51M is enough (control)
  const thin = await setup({ held: 50_900_000n });
  await assert.rejects(thin.w.hiddenFromRow("sol", thin.leg1.depositAddress, OUT, { payload: thin.payload() }), (e: any) => e.problem.code === "security.balance.low-coin");
  const enough = await setup({ held: 51_000_000n });
  assert.equal(((await enough.w.hiddenFromRow("sol", enough.leg1.depositAddress, OUT, { payload: enough.payload() })) as any).leg1.status, "done");
});

// ETH (RH): the same design, leg 1 the row's ETH on Robinhood Chain (an EVM transfer the core builds, signs and
// sends itself after the one sheet), with room for the network's fee instead of Solana's.
const HOOD_IN = "nep141:hood.omft.near";
const IMT_HOOD = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${HOOD_IN}`;
const EVM_PAYEE = "0x12345678901234567890123456789012345678ab";
const LEG1 = 2_000_000_000_000_000n; // 0.002 ETH; 1Click's signed minimum 1 % under it: 1.98e15
const GAS = 27_960n; // the fake nodes' 23,300 and a fifth more
const ROOM = (GAS * 5_000_000n * 125n) / 100n; // at 0.005 gwei, FEE_ROOM over it

async function setupHood(o: { leg2In?: string; approve?: boolean; sent?: boolean; held?: bigint; seen?: ("ok" | "failed" | null)[]; fees?: () => { tip: bigint; maxFee: bigint }; deposit?: string; evm?: Partial<EvmChain>; pocketUsd?: () => Promise<number>; inUsd?: string; usdPrice?: number; ask?: (words: PlainWords) => Promise<boolean> } = {}) {
  const shown: PlainWords[] = [];
  const quoted = new Map<string, any>();
  let n = 0;
  const relay: FloatRelay = {
    quote: async (req) => {
      const depositAddress = o.deposit ?? `0x${"ab".repeat(19)}${(16 + n++).toString(16)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  let pocketAddress = "";
  const privateStatus = async (a: string) => {
    if (a === OUT) {
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
        quoteRequest: { dry: false, originAsset: HOOD_IN, destinationAsset: HOOD_IN, refundTo: pocketAddress, refundType: "CONFIDENTIAL_INTENTS", recipient: EVM_PAYEE, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", swapType: "EXACT_OUTPUT", confidentiality: "basic" },
        quote: { depositAddress: OUT, amountIn: o.leg2In ?? "1950000000000000", amountInUsd: "4.39", minAmountOut: "1900000000000000", amountOut: "1900000000000000", deadline: DEADLINE },
      }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: o.inUsd ?? "4.50", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sent: string[] = [];
  const reads: string[] = [];
  const evm: EvmChain = {
    simulate: async () => ({ ok: true, agreed: true, balance: 0n }),
    nonce: async () => 7,
    tokenBalance: async () => 0n,
    token: async () => undefined,
    ponsCurve: async () => null,
    fees: async () => o.fees?.() ?? { tip: 1_000_000n, maxFee: 5_000_000n },
    estimateGas: async () => 23_300n,
    send: async (_c, signed) => (sent.push(signed), o.sent !== false),
    receipt: async () => o.seen ?? ["ok", "ok"],
    read: async (_c, method) => (reads.push(method), method === "eth_getBalance" ? `0x${(o.held ?? 10n ** 18n).toString(16)}` : `0x${"0".repeat(64)}`),
    ...o.evm,
  };
  const w = honestPage(new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async (words) => (shown.push(words), o.ask ? o.ask(words) : o.approve !== false), emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: o.pocketUsd ?? (async () => 0), ...(o.usdPrice ? { usdPrice: async () => o.usdPrice! } : {}), confirm: { everyMs: 1, forMs: 5 } }), privateStatus);
  const pocket = await w.create("private", "near");
  pocketAddress = pocket.address;
  const row = await w.create("trade", "hood");
  const leg1 = await w.privateQuoteIn(HOOD_IN, LEG1.toString(), true);
  const payload = (amount = o.leg2In ?? "1950000000000000") => ({
    message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [IMT_HOOD]: amount } }], signer_id: pocket.address }),
    nonce: NONCE,
    recipient: "intents.far",
  });
  const go = () => w.hiddenFromRow("hood", leg1.depositAddress, OUT, { payload: payload() }, "tag-for-this-quote-0001") as Promise<any>;
  return { w, shown, sent, reads, leg1, payload, row, go };
}

test("Robinhood: 1Click's ETH on Robinhood Chain is an outside coin your private balance takes (OUTSIDE_CHAINS), its tokens only", async () => {
  const { leg1 } = await setupHood();
  assert.match(leg1.depositAddress, /^0x[0-9a-f]{40}$/);
  const { w } = await setupHood();
  await assert.rejects(w.privateQuoteIn("nep141:hoodx.omft.near", "1000", true), (e: any) => /can't come in through Private/.test(e.problem.more), "control: a chain name that only starts with hood");
});

test("Robinhood: an outside payee asks Face ID once (QA, 5 Nov); leg 2 is signed and handed back and leg 1 is the row's own EVM transfer", async () => {
  const { shown, sent, leg1, row, go } = await setupHood();
  const r = await go();
  assert.equal(shown.length, 1, "one sheet: the payee is outside");
  assert.equal(shown[0]!.tap, undefined, "Face ID");
  // QA's lap: "your Chain wallet", twice; the Robinhood wallet by its own name
  assert.equal(shown[0]!.title, "Send from your Robinhood wallet");
  assert.doesNotMatch(JSON.stringify(shown[0]), /Chain wallet/, "control: never the kind label");
  assert.equal(sent.length, 1, "leg 1 sent");
  const t = parseTx(fromBase64(sent[0]!));
  assert.deepEqual([t.chainId, t.nonce, t.to, t.value, t.data, t.gas, t.maxFeePerGas, t.maxPriorityFeePerGas], [4663, 7, leg1.depositAddress, LEG1, "0x", GAS, 5_000_000n, 1_000_000n], "Robinhood Chain, the core's nonce, gas and fees, exactly leg 1's ETH to 1Click's address, nothing else");
  // signed by the row's own wallet
  const unsigned = unsignedEvmTx({ chainId: 4663, nonce: 7, tip: 1_000_000n, fee: 5_000_000n, gas: GAS, to: leg1.depositAddress, value: LEG1, data: "0x" });
  const pub = new secp256k1.Signature(t.signature!.r, t.signature!.s).addRecoveryBit(t.signature!.yParity).recoverPublicKey(keccak_256(fromBase64(unsigned)));
  assert.equal(toHex(keccak_256(pub.toBytes(false).subarray(1)).subarray(12)), row.address);
  const hash = toHex(keccak_256(fromBase64(sent[0]!)));
  assert.deepEqual(r.leg1, { status: "done", txHash: hash, explorerUrl: `https://explorer.chain.robinhood.com/tx/${hash}` });
  assert.ok(r.signedData?.signature, "leg 2 signed, for the app to submit after leg 1 lands");
});

test("Robinhood: leg 1 short of leg 2 is refused before any sheet; exactly its signed minimum goes (control)", async () => {
  const short = await setupHood({ leg2In: "1980000000000001" });
  await assert.rejects(short.go(), (e: any) => /may bring less than the payment needs/.test(e.problem.more));
  assert.deepEqual([short.shown.length, short.sent.length], [0, 0]);
  const exact = await setupHood({ leg2In: "1980000000000000" });
  assert.equal((await exact.go()).leg1.status, "done");
});

test("Robinhood: leg 1 not taken, failed or unconfirmed: leg 2 is never handed back; a double tap goes once", async () => {
  for (const [o, code] of [[{ sent: false }, "security.subwallet.not-sent"], [{ seen: ["failed", "failed"] }, "security.subwallet.send-failed"], [{ seen: [null, null] }, "security.subwallet.unconfirmed"], [{ seen: ["ok", null] }, "security.subwallet.unconfirmed"]] as const) {
    const x = await setupHood(o as never);
    const r = await x.go();
    assert.equal(r.leg1.status, "problem", JSON.stringify(o));
    assert.equal(r.leg1.problem.code, code, JSON.stringify(o));
    assert.equal(r.signedData, undefined, `${JSON.stringify(o)}: leg 2 kept back`);
  }
  const twice = await setupHood();
  const [one, two] = await Promise.allSettled([twice.go(), twice.go()]);
  assert.equal(one.status, "fulfilled");
  assert.ok(two.status === "rejected" && /one at a time/.test((two.reason as any).problem.more), "a double tap goes once");
  assert.equal(twice.sent.length, 1);
  // control: leg 1 taken and seen done on both nodes, leg 2 is handed back
  const ok = await setupHood();
  const r = await ok.go();
  assert.equal(r.leg1.status, "done");
  assert.ok(r.signedData?.signature);
  // its address is paid once, even when the first send erred on this side
  const once = await setupHood({ sent: false });
  await once.go();
  await assert.rejects(once.go(), (e: any) => /wasn't priced here/.test(e.problem.more), "the same address never paid twice");
});

test("Robinhood: gas room. The row must hold leg 1 and its fee with FEE_ROOM over it, read before anything is signed (control: exactly enough goes)", async () => {
  const thin = await setupHood({ held: LEG1 + ROOM - 1n });
  await assert.rejects(thin.go(), (e: any) => e.problem.code === "security.balance.low-coin" && /ETH/.test(e.problem.whatHappened));
  assert.deepEqual([thin.shown.length, thin.sent.length], [0, 0], "a short row sends nothing");
  const none = await setupHood({ held: LEG1 - 1n });
  await assert.rejects(none.go(), (e: any) => e.problem.code === "security.balance.low-coin");
  const enough = await setupHood({ held: LEG1 + ROOM });
  assert.equal((await enough.go()).leg1.status, "done");
});

test("Robinhood: a fee past what ZeroFee pays there is refused before anything is signed; one that rose past the room after the check is never signed", async () => {
  const high = await setupHood({ fees: () => ({ tip: 1_000_000n, maxFee: 2_000_000_001n }) });
  await assert.rejects(high.go(), (e: any) => e.problem.code === "security.fee.high");
  assert.deepEqual([high.shown.length, high.sent.length], [0, 0]);
  // fees read for the room check, then twice more at signing (payPlain reads again once): risen past the room, nothing is signed
  let reads = 0;
  const rose = await setupHood({ fees: () => (reads++ === 0 ? { tip: 1_000_000n, maxFee: 5_000_000n } : { tip: 1_000_000n, maxFee: 6_500_000n }) });
  const r = await rose.go();
  assert.equal(rose.shown.length, 1, "the outside sheet came before the fee rose");
  assert.equal(rose.sent.length, 0, "never sent at a fee the row's room didn't cover");
  assert.equal(r.leg1.problem.code, "security.fee.high");
  assert.equal(r.signedData, undefined);
  // control: a fee that rose but stays inside the room goes
  let reads2 = 0;
  const inside = await setupHood({ fees: () => (reads2++ === 0 ? { tip: 1_000_000n, maxFee: 5_000_000n } : { tip: 1_000_000n, maxFee: 6_000_000n }) });
  assert.equal((await inside.go()).leg1.status, "done");
});

test("Robinhood: a deposit address that isn't an EVM one is never paid", async () => {
  const odd = await setupHood({ deposit: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
  await assert.rejects(odd.go(), (e: any) => /isn't the one asked for/.test(e.problem.more));
  assert.deepEqual([odd.shown.length, odd.sent.length], [0, 0]);
});

// ---- The EVM nonce and the paid-once mark (security review of the ETH (RH) wallet, 3 Nov, Lows 1 to 3)
const OTHER = "0x00000000000000000000000000000000000000aa";
const nonceOf = (b64: string) => parseTx(fromBase64(b64)).nonce;
/** Wallet's own Send of 1 wei from the row (sendPlain): since D143 the core's other own send through the wallet's turn
 *  (a site's sendCall is refused: a hot key never pays an outside address for a site). */
const plain = (w: SubWallets) => w.sendPlain("hood", OTHER, "0.000000000000000001", undefined, "ZeroFee", "wallet");

test("a transfer the core makes (payPlain) never forgets the wallet's earlier unlanded one: the next send takes the number after it", async () => {
  // A (Wallet's Send, nonce 7) is sent but hasn't landed; B (leg 1, payPlain, nonce 8) no node takes; C must be 8, never 7
  let calls = 0;
  const s = await setupHood({ seen: [null, null], evm: { send: async (_c, signed) => (calls++, sentLog.push(signed), calls !== 2) } });
  const sentLog: string[] = [];
  assert.equal((await plain(s.w)).status, "problem", "A: sent, not seen landed");
  const b = await s.go();
  assert.equal(b.leg1.problem.code, "security.subwallet.not-sent", "B: no node took it");
  await plain(s.w);
  assert.deepEqual(sentLog.map(nonceOf), [7, 8, 8], "C takes B's number, never A's");
});

test("after a restart (nothing in memory) a wallet with a transaction waiting that this core doesn't know of sends nothing until it lands: never replaced, never numbered past (control: nothing waiting)", async () => {
  const waiting = (pending: number, other: { latest: number; pending: number; balance: bigint } | null = { latest: 7, pending: 7, balance: 10n ** 18n }) => ({ account: async () => [{ latest: 7, pending, balance: 10n ** 18n }, other] });
  const held = await setupHood({ evm: waiting(8) });
  const r = await held.go();
  assert.equal(r.leg1.problem.code, "security.subwallet.refused");
  assert.match(r.leg1.problem.more, /A payment from this wallet is still waiting on Robinhood Chain\. Once it lands, try again\. Nothing was sent\./);
  assert.equal(r.signedData, undefined);
  await assert.rejects(plain(held.w), (e: any) => /still waiting on Robinhood Chain/.test(e.problem.more), "Wallet's own Send too, before anything is signed");
  assert.equal(held.sent.length, 0, "neither its number (a replacement) nor the one after it (a gap)");
  const none = await setupHood({ evm: waiting(7) });
  await none.go();
  assert.deepEqual(none.sent.map(nonceOf), [7], "control: nothing waiting, the next number");
  // the core's own unlanded one, which the nodes see waiting: the next number after it (in one run, nothing refused)
  const ownCalls = { n: 0 };
  const own = await setupHood({ seen: [null, null], evm: { account: async () => [{ latest: 7, pending: 7 + ownCalls.n, balance: 10n ** 18n }, { latest: 7, pending: 7 + ownCalls.n, balance: 10n ** 18n }] } });
  await plain(own.w);
  ownCalls.n = 1;
  await plain(own.w);
  assert.deepEqual(own.sent.map(nonceOf), [7, 8]);
  // a node that doesn't answer (either one): nothing is built or sent
  for (const ev of [{ account: async () => [null, null] }, waiting(7, null)]) {
    const silent = await setupHood({ evm: ev as never });
    assert.equal((await silent.go()).leg1.status, "problem");
    await assert.rejects(plain(silent.w), (e: any) => e.problem.code === "security.chain.unreachable" && e.problem.whatHappened === "Robinhood Chain didn't answer." && e.problem.service === "hood");
    assert.equal(silent.sent.length, 0);
  }
});

test("an address already paid from here is never priced again: its mark is never dropped by a new entry", async () => {
  const s = await setupHood({ deposit: `0x${"cd".repeat(20)}` });
  assert.equal((await s.go()).leg1.status, "done");
  await assert.rejects(s.w.privateQuoteIn(HOOD_IN, LEG1.toString(), true), (e: any) => /already paid/.test(e.problem.more));
  await assert.rejects(s.go(), (e: any) => /wasn't priced here/.test(e.problem.more));
  assert.equal(s.sent.length, 1);
});

test("the paid-once mark is never lost to a price written at the same moment: the address is paid once (control: one at a time)", async () => {
  let open: () => void = () => {};
  let hold: Promise<void> | null = null;
  let reached = false;
  const s = await setupHood({ pocketUsd: async () => { if (hold) { reached = true; await hold; } return 0; } });
  // a second price for Hidden starts and reads the list, then waits on Hidden's balance
  hold = new Promise<void>((r) => (open = r));
  const priced = s.w.privateQuoteIn(HOOD_IN, "1000000000000000", true);
  while (!reached) await new Promise((r) => setTimeout(r, 1));
  // meanwhile the send marks leg 1's address paid; then the price writes its list
  const first = s.go();
  await new Promise((r) => setTimeout(r, 20));
  open();
  hold = null;
  assert.equal((await first).leg1.status, "done");
  await priced;
  await assert.rejects(s.go(), (e: any) => /wasn't priced here/.test(e.problem.more), "the same address never paid twice");
  assert.equal(s.sent.length, 1);
});

test("a leg 1 never handed to a node stops counting toward Hidden's $100 at once, and is never paid from here (control: one a node may have taken keeps counting)", async () => {
  // leg 1 priced at $6,000: a second $6,000 price fits only once the first no longer counts (D132: $10,000)
  let reads = 0;
  const rose = await setupHood({ inUsd: "6000", fees: () => (reads++ === 0 ? { tip: 1_000_000n, maxFee: 5_000_000n } : { tip: 1_000_000n, maxFee: 6_500_000n }) });
  assert.equal((await rose.go()).leg1.problem.code, "security.fee.high", "refused by its fee after the yes: nothing signed, nothing handed");
  assert.equal(rose.sent.length, 0);
  await rose.w.privateQuoteIn(HOOD_IN, LEG1.toString(), true);
  await assert.rejects(rose.go(), (e: any) => /wasn't priced here/.test(e.problem.more), "its address is off the list: never paid from here");
  const handed = await setupHood({ inUsd: "6000", sent: false });
  assert.equal((await handed.go()).leg1.problem.code, "security.subwallet.not-sent");
  assert.equal(handed.sent.length, 1, "handed to the nodes");
  await assert.rejects(handed.w.privateQuoteIn(HOOD_IN, LEG1.toString(), true), (e: any) => /Your private balance holds at most \$10,000/.test(e.problem.more), "it may still land: it keeps counting");
});

test("one wallet, one send at a time (review L1): two of the core's own sends at once take different numbers; a send refused inside its turn frees it", async () => {
  // Wallet's Send reads its number, then waits on its gas estimate (inside its turn, before signing); leg 1 (payPlain)
  // asked at the same moment waits its turn and takes the next number (with no turn both would read 7)
  const t = await setupHood({ evm: { estimateGas: async (_c, call) => (call.to === OTHER ? await new Promise((r) => setTimeout(r, 30)) : undefined, 23_300n) } });
  const [call, leg] = await Promise.all([plain(t.w), t.go()]);
  assert.deepEqual([call.status, leg.leg1.status], ["done", "done"]);
  assert.deepEqual(t.sent.map(nonceOf).sort(), [7, 8], "never the same number twice");
  // a send that fails inside its turn (a node says something is waiting) never holds the wallet's next send back
  let asked = 0;
  const v = await setupHood({ evm: { account: async () => { const p = asked++ === 0 ? 9 : 7; return [{ latest: 7, pending: p, balance: 10n ** 18n }, { latest: 7, pending: 7, balance: 10n ** 18n }]; } } });
  const [x, y] = await Promise.allSettled([plain(v.w), v.go()]);
  const wentX = x.status === "fulfilled" && x.value.status === "done";
  const wentY = y.status === "fulfilled" && y.value.leg1.status === "done";
  assert.equal(Number(wentX) + Number(wentY), 1, JSON.stringify([x.status, y.status === "fulfilled" ? y.value.leg1 : y.reason]));
  assert.equal(v.sent.length, 1, "the one after the refused one went");
});

test("re-review M: a transaction signed outside the turn (Trade's own, a session's) never shares a number with the core's own send (control: the next number isn't refused for its number)", async () => {
  const at = (nonce: number) => unsignedEvmTx({ chainId: 4663, nonce, tip: 1_000_000n, fee: 5_000_000n, gas: 30_000n, to: "0x00000000000000000000000000000000000000bb", value: 5n, data: "0x" });
  // 1. the core's own send (Wallet's) holds 7 while a node takes it; a transaction built at 7 elsewhere is refused
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const s = await setupHood({ evm: { send: async (_c, signed) => (parseTx(fromBase64(signed)).to === OTHER ? await gate : undefined, true) } });
  const mine = plain(s.w);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.w.signTx(s.row.id, at(7), undefined, undefined, "Trade"), (e: any) => /Another payment from this wallet took its turn first/.test(e.problem.more));
  // control: the next number passes the number check (a plain send from Trade is then refused as no trade, D143: never
  // signed either way)
  await assert.rejects(s.w.signTx(s.row.id, at(8), undefined, undefined, "Trade"), (e: any) => e.problem.code === "security.trade.not-signed" && !/took its turn first/.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more));
  release();
  assert.equal((await mine).status, "done");
  // 2. the other one read first (its number 7, not signed yet); the core's own send reads 7 and holds it: the two never
  // both go at 7
  let open2: () => void = () => {};
  const paused = new Promise<void>((r) => (open2 = r));
  const t = await setupHood({ evm: { simulate: async (_c, calls) => (calls.at(-1)?.to === "0x00000000000000000000000000000000000000bb" ? await paused : undefined, { ok: true, agreed: true, balance: 0n }) } });
  const theirs = t.w.signTx(t.row.id, at(7), undefined, undefined, "Trade");
  await new Promise((r) => setTimeout(r, 20));
  const ours = plain(t.w);
  await new Promise((r) => setTimeout(r, 20));
  open2();
  const [a, b] = await Promise.allSettled([theirs, ours]);
  const signedAt7 = [a.status === "fulfilled" && "signedTx" in a.value ? 1 : 0, t.sent.filter((x) => nonceOf(x) === 7).length].reduce((m, n) => m + n, 0);
  assert.equal(signedAt7, 1, "exactly one transaction at 7");
  assert.ok(b.status === "fulfilled" && b.value.status === "done");
});

test("QA's ruling: a no on the outside sheet sends nothing and signs nothing, and says the wallet", async () => {
  const { w, shown, sent, leg1, payload } = await setup({ approve: false });
  await assert.rejects(w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }, "tag-for-this-quote-0001"), (e: any) => e.problem.code === "security.send.declined" && e.problem.money.where === "in your SOL wallet");
  assert.equal(shown.length, 1);
  assert.equal(sent.length, 0, "nothing sent");
});

test("QA's SHOULD: to the person's own wallet, D143 still holds: under the cap no sheet at all, leg 1 sent", async () => {
  const { w, shown, sent, leg1, payload } = await setup({ ownPayee: true });
  const r = (await w.hiddenFromRow("sol", leg1.depositAddress, OUT, { payload: payload() }, "tag-for-this-quote-0001")) as any;
  assert.equal(shown.length, 0, "their own wallet, $5: no sheet");
  assert.equal(sent.length, 1);
  assert.equal(r.leg1.status, "done");
});
