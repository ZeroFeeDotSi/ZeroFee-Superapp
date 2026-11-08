// A Send of a wallet's TOKEN through NEAR Confidential (the Send review, 5 Nov; subwallets.hiddenFromRow with `coin`):
// leg 1 is the token's own transfer, built by the core from its pinned mint or contract (hidden-coins.ts), decoded back
// here and compared; the wallet's own coin pays only the fee. Controls: the wallet's own coin, as before, on each chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { honestPage } from "./testing/honest-payee.ts";
import { fromBase64 as solBytes } from "./sol/bytes.ts";
import { ata, decodeSolTx } from "./sol/decode.ts";
import { decodeTx, decompile } from "./sol/wire.ts";
import { SOL } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import type { EvmChain } from "./evm.ts";
import { fromBase64, parseTx } from "./evm/wire.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { HIDDEN_COINS, SOL_TOKEN_ACCOUNT_RENT, hiddenCoin } from "./hidden-coins.ts";
import { erc20TransferData, solTokenSendTx } from "./hidden-tx.ts";

const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDG_HOOD = "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const SOL_IN = "nep141:sol.omft.near";
const HOOD_IN = "nep141:hood.omft.near";
const imt = (c: string) => `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${c}`;
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OUT = "d".repeat(64);
const NONCE = Buffer.from(new Uint8Array(32).fill(3)).toString("base64");
/** The instructions as the chain reads them: program, accounts (with signer/writable), data. */
const ixsOf = (tx: string) => decompile(decodeTx(tx)).instructions.map((i) => ({ programId: i.programId, accounts: i.keys.map((k) => k.pubkey), meta: i.keys.map((k) => `${+k.isSigner}${+k.isWritable}`), data: [...i.data] }));

type O = { chain: "sol" | "hood"; coin?: string; quoteCoin?: string; leg1?: bigint; tokens?: bigint; native?: bigint; mint?: string; sent?: boolean; notAta?: boolean; elsewhere?: bigint };

async function setup(o: O) {
  const quoted = new Map<string, any>();
  let n = 0;
  const relay: FloatRelay = {
    quote: async (req) => {
      const depositAddress = o.chain === "sol" ? `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWW${String.fromCharCode(65 + n++)}` : `0x${"ab".repeat(19)}${(16 + n++).toString(16)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  const quoteCoin = o.quoteCoin ?? o.coin ?? (o.chain === "sol" ? SOL_IN : HOOD_IN);
  const leg1Units = o.leg1 ?? 5_000_000n;
  let pocketAddress = "";
  const privateStatus = async (a: string) => {
    if (a === OUT) {
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
        quoteRequest: { dry: false, originAsset: quoteCoin, destinationAsset: SOL_IN, refundTo: pocketAddress, refundType: "CONFIDENTIAL_INTENTS", recipient: PAYEE, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", swapType: "EXACT_INPUT", confidentiality: "basic" },
        quote: { depositAddress: OUT, amountIn: ((leg1Units * 99n) / 100n).toString(), amountInUsd: "4.95", minAmountOut: "30000000", amountOut: "30000000", deadline: DEADLINE },
      }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "5.00", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sent: string[] = [];
  const sol = {
    balance: async () => o.native ?? 10n ** 9n,
    tokenAccounts: async (owner: string) => [{ mint: o.mint ?? USDC_MINT, amount: o.tokens ?? 10n ** 9n, account: o.notAta ? "So11111111111111111111111111111111111111112" : ata(owner, o.mint ?? USDC_MINT, SOL.token) }, ...(o.elsewhere ? [{ mint: USDC_MINT, amount: o.elsewhere, account: "So11111111111111111111111111111111111111112" }] : [])],
    latestBlockhash: async () => "11111111111111111111111111111111",
    send: async (tx: string) => (sent.push(tx), o.sent !== false),
    status: async () => ["ok", "ok"],
  } as unknown as SolChain;
  const evm: EvmChain = {
    simulate: async () => ({ ok: true, agreed: true, balance: 0n }), nonce: async () => 7, token: async () => undefined, ponsCurve: async () => null,
    tokenBalance: async (_c: string, t: string) => (t === USDG ? o.tokens ?? 10n ** 9n : 0n),
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 52_000n,
    send: async (_c: string, signed: string) => (sent.push(signed), o.sent !== false), receipt: async () => ["ok", "ok"],
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? `0x${(o.native ?? 10n ** 18n).toString(16)}` : `0x${"0".repeat(64)}`),
  } as unknown as EvmChain;
  const w = honestPage(new SubWallets({ vault: new MemoryVault(), sol, evm, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } }), privateStatus);
  const pocket = await w.create("private", "near");
  pocketAddress = pocket.address;
  const row = await w.create("trade", o.chain);
  const leg1 = await w.privateQuoteIn(quoteCoin, leg1Units.toString(), true, true);
  const payload = { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [imt(quoteCoin)]: ((leg1Units * 99n) / 100n).toString() } }], signer_id: pocket.address }), nonce: NONCE, recipient: "intents.far" };
  const go = (coin = o.coin) => w.hiddenFromRow(o.chain, leg1.depositAddress, OUT, { payload }, "tag-for-this-quote-0001", undefined, undefined, coin) as Promise<any>;
  return { w, sent, leg1, row, go };
}

test("pinned coins: 1Click's own ids, each on its chain; Solana's are the classic Token program's (no Token-2022)", () => {
  for (const [id, c] of Object.entries(HIDDEN_COINS)) {
    assert.match(id, new RegExp(`^nep141:${c.chain}-[0-9a-fx]+\\.omft\\.near$`), id);
    if (c.chain === "hood") assert.equal(id, `nep141:hood-${c.address}.omft.near`, "the contract is the id's own");
    else assert.match(c.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
  assert.equal(hiddenCoin(USDC_SOL, "sol")?.address, USDC_MINT);
  assert.equal(hiddenCoin(USDC_SOL, "hood"), null, "a Solana coin is never paid from Robinhood Chain");
  assert.equal(hiddenCoin("nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near", "sol"), null, "sUSDC (Token-2022) left out");
  assert.equal(hiddenCoin("toString", "sol"), null);
});

test("Solana leg 1 decodes as exactly: make 1Click's token account (idempotent), then TransferChecked of the units", () => {
  const from = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", to = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWA";
  const tx = solTokenSendTx(from, to, USDC_MINT, 5_000_000n, 6, "11111111111111111111111111111111");
  assert.equal(solBytes(tx)[0], 1, "one signature");
  const ixs = ixsOf(tx);
  assert.equal(ixs.length, 2, "two instructions, nothing else");
  assert.equal(ixs[0]!.programId, SOL.ata);
  assert.deepEqual(ixs[0]!.data, [1], "CreateIdempotent");
  assert.deepEqual(ixs[0]!.accounts, [from, ata(to, USDC_MINT, SOL.token), to, USDC_MINT, SOL.system, SOL.token]);
  assert.deepEqual(ixs[0]!.meta, ["11", "01", "00", "00", "00", "00"], "only the payer signs; only the payer and the new account are written");
  assert.equal(ixs[1]!.programId, SOL.token);
  assert.deepEqual(ixs[1]!.accounts, [ata(from, USDC_MINT, SOL.token), USDC_MINT, ata(to, USDC_MINT, SOL.token), from]);
  assert.deepEqual(ixs[1]!.meta, ["01", "00", "01", "11"]);
  assert.deepEqual(ixs[1]!.data, [12, 0x40, 0x4b, 0x4c, 0, 0, 0, 0, 0, 6], "TransferChecked 5,000,000 at 6 places");
  // and the core's own reader (the one a session check uses) sees one token transfer, to 1Click's account, nothing unknown
  const d = decodeSolTx(tx);
  assert.equal(d.feePayer, from);
  assert.deepEqual(d.unknownPrograms, []);
  assert.deepEqual(d.transfers, [], "no SOL leaves by plain transfer");
  assert.deepEqual(d.tokenMoves.map((m) => [m.kind, m.account, m.to, m.amount, m.mint]), [["transfer", ata(from, USDC_MINT, SOL.token), ata(to, USDC_MINT, SOL.token), "5000000", USDC_MINT]]);
  assert.throws(() => solTokenSendTx(from, from, USDC_MINT, 1n, 6, "11111111111111111111111111111111"));
  assert.throws(() => solTokenSendTx(from, to, USDC_MINT, 0n, 6, "11111111111111111111111111111111"));
  assert.equal(erc20TransferData("0x" + "ab".repeat(20), 255n), `0xa9059cbb${"0".repeat(24)}${"ab".repeat(20)}${"0".repeat(62)}ff`);
});

test("SOL wallet's USDC: leg 1 is the token's transfer to 1Click's address; leg 2 handed back (control: SOL itself)", async () => {
  const t = await setup({ chain: "sol", coin: USDC_SOL });
  const r = await t.go();
  assert.equal(r.leg1.status, "done");
  assert.ok(r.signedData?.signature);
  assert.equal(t.sent.length, 1);
  const ixs = ixsOf(t.sent[0]!);
  assert.equal(ixs[1]!.programId, SOL.token);
  assert.deepEqual(ixs[1]!.accounts, [ata(t.row.address, USDC_MINT, SOL.token), USDC_MINT, ata(t.leg1.depositAddress, USDC_MINT, SOL.token), t.row.address]);
  const control = await setup({ chain: "sol", leg1: 50_000_000n });
  assert.equal((await control.go()).leg1.status, "done");
  assert.equal(ixsOf(control.sent[0]!)[0]!.programId, SOL.system, "the wallet's own coin: a plain transfer, as before");
});

test("SOL wallet's token: refused before anything is signed when the token, the fee room, the coin or the price is wrong", async () => {
  const short = await setup({ chain: "sol", coin: USDC_SOL, tokens: 4_999_999n });
  await assert.rejects(short.go(), (e: any) => e.problem.code === "security.balance.low-coin" && /USDC/.test(JSON.stringify(e.problem)));
  // QA (5 Nov): only the associated account pays (TransferChecked's source); USDC in another account never counts
  const notAta = await setup({ chain: "sol", coin: USDC_SOL, notAta: true });
  await assert.rejects(notAta.go(), (e: any) => e.problem.code === "security.balance.low-coin", "all of it in another account");
  const split = await setup({ chain: "sol", coin: USDC_SOL, tokens: 4_000_000n, elsewhere: 2_000_000n });
  await assert.rejects(split.go(), (e: any) => e.problem.code === "security.balance.low-coin", "4 in the associated account + 2 elsewhere is short of 5");
  const ataEnough = await setup({ chain: "sol", coin: USDC_SOL, tokens: 5_000_000n, elsewhere: 2_000_000n });
  assert.equal((await ataEnough.go()).leg1.status, "done", "control: the associated account alone holds the 5");
  assert.equal(notAta.sent.length + split.sent.length, 0);
  const otherMint = await setup({ chain: "sol", coin: USDC_SOL, mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" });
  await assert.rejects(otherMint.go(), (e: any) => e.problem.code === "security.balance.low-coin", "another mint's balance never counts");
  // the fee and 1Click's new token account: 1,000,000 + 2,039,280 lamports
  const thin = await setup({ chain: "sol", coin: USDC_SOL, native: 1_000_000n + SOL_TOKEN_ACCOUNT_RENT - 1n });
  await assert.rejects(thin.go(), (e: any) => e.problem.code === "security.balance.low-coin");
  const room = await setup({ chain: "sol", coin: USDC_SOL, native: 1_000_000n + SOL_TOKEN_ACCOUNT_RENT });
  assert.equal((await room.go()).leg1.status, "done", "control: exactly the room");
  // a SOL price asked as a USDC send, and a USDC price asked as a SOL send: the price isn't the one asked for
  const solPrice = await setup({ chain: "sol", quoteCoin: SOL_IN, coin: USDC_SOL });
  await assert.rejects(solPrice.go(), (e: any) => /isn't the one asked for/.test(e.problem.more));
  const usdcPrice = await setup({ chain: "sol", quoteCoin: USDC_SOL });
  await assert.rejects(usdcPrice.go(), (e: any) => /isn't the one asked for/.test(e.problem.more));
  // a coin not pinned (or pinned on the other chain) is refused by name
  const unpinned = await setup({ chain: "sol", coin: USDC_SOL });
  await assert.rejects(unpinned.go("nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near"), (e: any) => /Private can't take this yet/.test(e.problem.more));
  await assert.rejects(unpinned.go(USDG_HOOD), (e: any) => /Private can't take this yet/.test(e.problem.more));
  for (const x of [short, otherMint, thin, solPrice, usdcPrice, unpinned]) assert.equal(x.sent.length, 0, "nothing sent");
});

test("Robinhood wallet's USDG: leg 1 is the ERC-20's transfer(1Click's address, units), no ETH value (control: ETH itself)", async () => {
  const t = await setup({ chain: "hood", coin: USDG_HOOD });
  const r = await t.go();
  assert.equal(r.leg1.status, "done");
  assert.ok(r.signedData?.signature);
  const tx = parseTx(fromBase64(t.sent[0]!));
  assert.deepEqual([tx.chainId, tx.to, tx.value, tx.data], [4663, USDG, 0n, erc20TransferData(t.leg1.depositAddress, 5_000_000n)]);
  const short = await setup({ chain: "hood", coin: USDG_HOOD, tokens: 4_999_999n });
  await assert.rejects(short.go(), (e: any) => e.problem.code === "security.balance.low-coin");
  const noGas = await setup({ chain: "hood", coin: USDG_HOOD, native: 1n });
  await assert.rejects(noGas.go(), (e: any) => e.problem.code === "security.balance.low-coin", "no ETH for the fee");
  assert.equal(short.sent.length + noGas.sent.length, 0);
  const control = await setup({ chain: "hood", leg1: 2_000_000_000_000_000n });
  assert.equal((await control.go()).leg1.status, "done");
  const c = parseTx(fromBase64(control.sent[0]!));
  assert.deepEqual([c.to, c.value, c.data], [control.leg1.depositAddress, 2_000_000_000_000_000n, "0x"]);
});

test("the quote relay takes exactly the pinned coins as themselves (apps/quotes relay.mjs WALLET_TOKENS, a fixed copy)", async () => {
  const { readFileSync } = await import("node:fs");
  const relay = readFileSync(new URL("../../../apps/quotes/relay.mjs", import.meta.url), "utf8");
  const copy = /const WALLET_TOKENS = new Set\(\[([\s\S]*?)\]\);/.exec(relay)?.[1] ?? "";
  assert.deepEqual([...copy.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(), Object.keys(HIDDEN_COINS).sort());
});
