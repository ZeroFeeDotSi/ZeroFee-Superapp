// W4 (QA's free-web acceptance, 5 Nov): the web Send, whole path from its ENTRY. The web Send sheet's one call
// (WebSendSheet.tsx go(): webSendGo with the shell's bridge, stamped "wallet" by forApps) runs into the REAL web core
// (DemoCore as the web wallet: password, no Safe), whose subwallet.sendPrivate asks 1Click's relay itself, reads back what
// 1Click SIGNED, shows its outside sheet with the password (decision A), and only then signs and sends the wallet's own
// payment to that quote's address. Never MockBridge. Each accepted path has tamper controls the core refuses before any
// sheet, and a wrong or missing password moves nothing. The only fakes are the network (1Click's relay, the chain nodes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoCore } from "@zerofee/core/demo-core";
import { forApps } from "@zerofee/core/bridge";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { PASSWORD, WORDS, TO_EVM } from "@zerofee/core/testing/web-core";
import { MemoryVault } from "@zerofee/core/vault";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import { base58, fromBase58, fromBase64 } from "@zerofee/core/sol/bytes";
import type { EvmChain } from "@zerofee/core/evm";
import type { PlainWords } from "@zerofee/core/signer";
import { ownTokenAccount, type SolChain } from "@zerofee/core/solana";
import { WEB_SEND_FROM, WEB_SEND_TOKENS, WEB_SEND_WORDS, webSendCoins, webSendFroms, webSendGo, webSendTokensOn, type WebSendFrom } from "./web-send.ts";

const SOL_PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const SOL_DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_DEPOSIT = "0x1111111111111111111111111111111111111111";
const THIEF_SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_ID = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const USDG_ID = "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near";
const DEADLINE = () => new Date(Date.now() + 3_600_000).toISOString();

type Sheet = { id: string; words: PlainWords; password?: boolean };
type Tamper = (req: Record<string, unknown>) => Record<string, unknown>;

/** The web core as the web build makes it (VITE_ZEROFEE_RELAY: privateQuotes), its relay and nodes faked at the network. */
async function webEntry(o: { tamper?: Tamper; badSignature?: boolean; answer?: "right" | "no"; signedDeposit?: string; tokens?: bigint; usd?: { in: string; out: string } } = {}) {
  const real = globalThis.fetch;
  const asked: Record<string, unknown>[] = [];
  const handed: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v0/quote")) {
      const req = JSON.parse(String(init!.body)) as Record<string, unknown>;
      asked.push(req);
      return new Response(JSON.stringify({ quote: { depositAddress: String(req.originAsset).startsWith("nep141:sol") ? SOL_DEPOSIT : EVM_DEPOSIT }, zerofeeStatusTag: "tag-for-this-quote-0001" }), { status: 201 });
    }
    if (u.includes("/v0/status?")) {
      const req = asked.at(-1)!;
      const dep = String(req.originAsset).startsWith("nep141:sol") ? SOL_DEPOSIT : EVM_DEPOSIT;
      const signedReq = o.tamper ? o.tamper(req) : req;
      const s = signedQuote({ quoteRequest: signedReq, quote: { depositAddress: o.signedDeposit ?? dep, amountIn: signedReq.amount, amountInUsd: o.usd?.in ?? "9.20", amountOut: String(req.amount), amountOutUsd: o.usd?.out ?? "9.00", minAmountOut: "1", deadline: DEADLINE() } });
      const body = o.badSignature ? { ...s, signature: s.signature.slice(0, -4) + "1111" } : s;
      return new Response(JSON.stringify({ status: "PENDING_DEPOSIT", quoteResponse: body }), { status: 200 });
    }
    if (u.endsWith("/v0/deposit/submit")) { handed.push(String(init?.body)); return new Response("{}", { status: 200 }); }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  const solSent: string[] = [], evmSent: string[] = [];
  // the token the wallet holds in its own associated account (tokenHeld reads only that one): 25 USDC, unless told
  const tokens = o.tokens ?? 25_000_000n;
  const sol = { balance: async () => 10n ** 10n, tokenAccounts: async (owner: string) => [{ mint: USDC_MINT, amount: tokens, account: ownTokenAccount(owner, USDC_MINT) }], latestBlockhash: async () => "11111111111111111111111111111111", send: async (tx: string) => (solSent.push(tx), true), status: async () => ["ok", "ok"] } as unknown as SolChain;
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 19n }), nonce: async () => 0, tokenBalance: async (_c: string, token: string) => (token === USDG ? tokens : 0n), token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, send: async (_c: string, signed: string) => (evmSent.push(signed), true),
    receipt: async () => ["ok", "ok"], read: async (_c: string, method: string) => (method === "eth_getBalance" ? `0x${(10n ** 19n).toString(16)}` : "0x0"),
  } as unknown as EvmChain;
  let tries = 0;
  const core = new DemoCore({
    chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => new Uint8Array(), secretsInMemory: true, sol, evm, quoteKey: TEST_QUOTE_KEY,
    privateQuotes: "https://relay.zerofee.example", nativeUsd: async (c) => (c === "sol" ? 184 : c === "hood" ? 3000 : null),
    webWallet: { passwordOk: async (p) => (tries++, p === PASSWORD) },
  });
  const sheets: Sheet[] = [];
  const answers: string[] = [];
  // the shell's web approval sheet: Approve with none, then a wrong password (both refused), then the person's answer
  core.on<Sheet>("approval.needed", (e) => {
    sheets.push(e);
    void (async () => {
      const none = await core.call("approval.answer", { id: e.id, approve: true });
      answers.push("problem" in none ? none.problem.code : "ok");
      const wrong = await core.call("approval.answer", { id: e.id, approve: true, password: "wrong password here" });
      answers.push("problem" in wrong ? wrong.problem.code : "ok");
      assert.deepEqual([solSent.length, evmSent.length], [0, 0], "nothing moved before the right password");
      const last = o.answer === "no" ? await core.call("approval.answer", { id: e.id, approve: false }) : await core.call("approval.answer", { id: e.id, approve: true, password: PASSWORD });
      answers.push("problem" in last ? last.problem.code : "ok");
    })();
  });
  const imp = await core.call("account.web.import", { words: WORDS });
  assert.ok("ok" in imp, JSON.stringify(imp));
  const status = await core.call<{ wallets: { wallet: string; address: string }[] }>("account.web.status");
  const own = (w: string) => ("ok" in status ? status.ok.wallets.find((x) => x.wallet === w)!.address : "");
  // the sheet's own bridge: the shell stamps Wallet's calls (forApps), exactly as WebSendSheet's bridge.call does
  const bridge = forApps(core, "wallet");
  const restore = () => { globalThis.fetch = real; };
  return { core, bridge, asked, handed, solSent, evmSent, sheets, answers, own, restore, tries: () => tries };
}

/** The web Send sheet's go(): webSendGo with the sheet's own call, ask and wallet (WebSendSheet.tsx); `from`: a token chip. */
const sheetGo = (e: Awaited<ReturnType<typeof webEntry>>, chain: "sol" | "hood", to: string, amount: string, from?: WebSendFrom) =>
  webSendGo({ call: (m, p) => e.bridge.call(m, p), ask: { chain, to, amount }, from: from ?? WEB_SEND_FROM.find((f) => f.chain === chain)!, usd: null });

/** The Solana payment the core signed: [1][64 sig][message: 3 header, key count, keys, blockhash, ix]; to = key 1, lamports last. */
function solPaid(signedB64: string): { to: string; lamports: bigint; signed: boolean } {
  const b = fromBase64(signedB64);
  const msg = b.subarray(65);
  const to = base58(msg.subarray(4 + 32, 4 + 64));
  const tail = msg.subarray(msg.length - 8);
  let lamports = 0n;
  for (let i = 7; i >= 0; i--) lamports = (lamports << 8n) | BigInt(tail[i]!);
  return { to, lamports, signed: b.subarray(1, 65).some((x) => x !== 0) };
}

test("W4 web Send entry, SOL: the sheet's one call -> the real web core's own confidential quote -> its sheet with the password (none and a wrong one refused, nothing moved) -> exactly 1Click's signed address paid, the amount as typed; the receipt says it", async () => {
  const e = await webEntry();
  try {
    const r = await sheetGo(e, "sol", SOL_PAYEE, "0.05");
    assert.ok("sent" in r, JSON.stringify(r));
    assert.equal(r.sent.line, WEB_SEND_WORDS.sent("0.05", "SOL"));
    assert.equal(r.sent.usd, WEB_SEND_WORDS.theyGet("9.00"), "what they get: 1Click's signed dollars");
    assert.equal(e.asked.length, 1, "ONE quote");
    const q = e.asked[0]!;
    assert.deepEqual([q.originAsset, q.destinationAsset, q.recipient, q.recipientType, q.refundTo, q.refundType, q.confidentiality, q.amount], ["nep141:sol.omft.near", "nep141:sol.omft.near", SOL_PAYEE, "DESTINATION_CHAIN", e.own("sol"), "ORIGIN_CHAIN", "basic", "50000000"], "NEAR Confidential, refunds to the person's own SOL wallet");
    assert.equal(e.sheets.length, 1, "the outside sheet, once");
    assert.equal(e.sheets[0]!.password, true, "decision A: the password on an outside send");
    assert.equal(e.sheets[0]!.words.lines[0], `To ${SOL_PAYEE}`, "the full payee");
    assert.deepEqual(e.answers, ["security.web.password", "security.web.password", "ok"], "Approve with none, then a wrong one: refused; the right one: paid");
    assert.equal(e.solSent.length, 1);
    const paid = solPaid(e.solSent[0]!);
    assert.deepEqual([paid.to, paid.lamports, paid.signed], [SOL_DEPOSIT, 50_000_000n, true], "signed, paying 1Click's signed address the amount typed");
    assert.equal(e.handed.length, 1, "the transaction handed to 1Click");
  } finally { e.restore(); }
});

test("W4 web Send entry, Robinhood: the same path from the Robinhood wallet; Robinhood Chain pays 1Click's signed address", async () => {
  const e = await webEntry();
  try {
    const r = await sheetGo(e, "hood", TO_EVM, "0.003");
    assert.ok("sent" in r, JSON.stringify(r));
    assert.equal(r.sent.line, WEB_SEND_WORDS.sent("0.003", "ETH"));
    const q = e.asked[0]!;
    assert.deepEqual([q.originAsset, q.destinationAsset, q.recipient, q.refundTo, q.confidentiality, q.amount], ["nep141:hood.omft.near", "nep141:hood.omft.near", TO_EVM, e.own("eth"), "basic", "3000000000000000"]);
    assert.equal(e.sheets.length, 1);
    assert.equal(e.sheets[0]!.password, true);
    assert.deepEqual(e.answers, ["security.web.password", "security.web.password", "ok"]);
    assert.equal(e.evmSent.length, 1, "one signed transaction");
    const raw = e.evmSent[0]!;
    const hex = /^0x/.test(raw) ? raw.slice(2).toLowerCase() : Array.from(fromBase64(raw), (b) => b.toString(16).padStart(2, "0")).join("");
    assert.ok(hex.includes(EVM_DEPOSIT.slice(2)), "it pays 1Click's signed address");
    assert.ok(hex.includes((3_000_000_000_000_000n).toString(16)), "the amount typed");
  } finally { e.restore(); }
});

test("W4 control: a relay that hands back a quote paying someone else, refunding elsewhere, public, into a balance, or another amount, or one 1Click never signed: refused by the real core before any sheet, nothing signed, and the sheet says nothing left the wallet", async () => {
  const cases: [string, { tamper?: Tamper; badSignature?: boolean }][] = [
    ["payee", { tamper: (r) => ({ ...r, recipient: THIEF_SOL }) }],
    ["refund", { tamper: (r) => ({ ...r, refundTo: THIEF_SOL }) }],
    ["public", { tamper: (r) => ({ ...r, confidentiality: "public" }) }],
    ["into a balance", { tamper: (r) => ({ ...r, recipientType: "INTENTS" }) }],
    ["amount", { tamper: (r) => ({ ...r, amount: "50000001" }) }],
    ["not 1Click's signature", { badSignature: true }],
  ];
  for (const [why, t] of cases) {
    const e = await webEntry(t);
    try {
      const r = await sheetGo(e, "sol", SOL_PAYEE, "0.05");
      // rule 8: what failed by name, where the money is by wallet name; never "that wallet" (fails on main). The lit Send
      // sits right under the line on the sheet, so no "Tap Send" (copy review, 5 Nov)
      assert.ok("line" in r, `${why}: ${JSON.stringify(r)}`);
      assert.equal(r.line, why === "not 1Click's signature" ? "NEAR Intents priced it differently than asked. Nothing moved. Your money is in your SOL wallet." : WEB_SEND_WORDS.refused("NEAR Intents priced it differently than asked. Nothing moved.", "SOL wallet"), why);
      assert.doesNotMatch(r.line!, /can't approve|that wallet/, why);
      assert.deepEqual([e.sheets.length, e.solSent.length, e.handed.length], [0, 0, 0], `${why}: no sheet, nothing signed or sent`);
    } finally { e.restore(); }
  }
  // control: the honest quote goes
  const ok = await webEntry();
  try { assert.ok("sent" in (await sheetGo(ok, "sol", SOL_PAYEE, "0.05"))); } finally { ok.restore(); }
});

test("W4 control: a No on the password sheet sends nothing and says so; another app's call (not Wallet's own Send) is refused before any price", async () => {
  const e = await webEntry({ answer: "no" });
  try {
    const r = await sheetGo(e, "sol", SOL_PAYEE, "0.05");
    assert.deepEqual(r, { line: WEB_SEND_WORDS.declined });
    assert.deepEqual([e.sheets.length, e.solSent.length], [1, 0]);
    const asked = e.asked.length;
    const trade = await forApps(e.core, "trade").call("subwallet.sendPrivate", { chain: "sol", to: SOL_PAYEE, toTokenId: "nep141:sol.omft.near", amount: "0.05" });
    assert.ok("problem" in trade, "Trade can't use Wallet's Send");
    assert.equal(e.asked.length, asked, "no price asked for it");
  } finally { e.restore(); }
});

test("W4 control: to the person's own SOL wallet, under the cap: no sheet and no password", async () => {
  const e = await webEntry();
  try {
    const before = e.tries();
    const r = await sheetGo(e, "sol", e.own("sol"), "0.05");
    assert.ok("sent" in r, JSON.stringify(r));
    assert.deepEqual([e.sheets.length, e.tries() - before, e.solSent.length], [0, 0, 1]);
  } finally { e.restore(); }
});


// W4, every coin held: the tokens the person holds that the core sends privately (hidden-coins.ts), each the same whole
// path from the web Send's entry: the chip webSendCoins makes from Home's read, the sheet's one call, the real web core's
// own confidential 1Click quote for that token (it lands as itself), 1Click's signed quote read back, the password sheet,
// then the token's own transfer to exactly 1Click's signed address (the wallet's coin pays only the fee).
const HELD = [{ chain: "sol", address: USDC_MINT, symbol: "USDC", amount: "25" }, { chain: "hood", address: USDG.toUpperCase().replace(/^0X/, "0x"), symbol: "USDG", amount: "25" }];
const chip = (id: string) => webSendCoins(HELD).find((f) => f.lands === id)!;
const hexOf = (raw: string) => (/^0x/.test(raw) ? raw.slice(2).toLowerCase() : Array.from(fromBase64(raw), (b) => b.toString(16).padStart(2, "0")).join(""));
const le64 = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("");

test("W4 web Send entry, an SPL token (USDC on Solana): its chip -> the real web core's confidential quote for USDC -> the password sheet -> USDC's own TransferChecked to 1Click's signed address, the amount typed", async () => {
  const e = await webEntry();
  try {
    const from = chip(USDC_ID);
    assert.deepEqual([from.chain, from.symbol, from.decimals, from.row, from.token], ["sol", "USDC", 6, "SOL wallet", true]);
    const r = await sheetGo(e, "sol", SOL_PAYEE, "2.5", from);
    assert.ok("sent" in r, JSON.stringify(r));
    assert.equal(r.sent.line, WEB_SEND_WORDS.sent("2.5", "USDC"));
    assert.equal(e.asked.length, 1, "ONE quote");
    const q = e.asked[0]!;
    assert.deepEqual([q.originAsset, q.destinationAsset, q.recipient, q.recipientType, q.refundTo, q.refundType, q.confidentiality, q.amount], [USDC_ID, USDC_ID, SOL_PAYEE, "DESTINATION_CHAIN", e.own("sol"), "ORIGIN_CHAIN", "basic", "2500000"], "NEAR Confidential, USDC lands as USDC, refunds to the SOL wallet");
    assert.equal(e.sheets.length, 1);
    assert.equal(e.sheets[0]!.password, true, "decision A");
    assert.deepEqual(e.answers, ["security.web.password", "security.web.password", "ok"]);
    assert.equal(e.solSent.length, 1);
    const hex = hexOf(e.solSent[0]!);
    assert.ok(hex.includes("0c" + le64(2_500_000n) + "06"), "TransferChecked of exactly 2.5 USDC (6 decimals)");
    const key = (a: string) => Array.from(fromBase58(a), (b) => b.toString(16).padStart(2, "0")).join("");
    assert.ok(hex.includes(key(SOL_DEPOSIT)) && hex.includes(key(USDC_MINT)), "to 1Click's signed address, USDC's own mint");
    assert.ok(hex.includes(key(ownTokenAccount(SOL_DEPOSIT, USDC_MINT))), "into 1Click's address's own USDC account");
  } finally { e.restore(); }
});

test("W4 web Send entry, an ERC-20 on Robinhood (USDG): its chip -> the confidential quote for USDG -> the password sheet -> USDG's transfer(1Click's signed address, amount) to its own contract, no ETH value", async () => {
  const e = await webEntry();
  try {
    const from = chip(USDG_ID);
    assert.deepEqual([from.chain, from.symbol, from.decimals, from.row], ["hood", "USDG", 6, "Robinhood wallet"]);
    const r = await sheetGo(e, "hood", TO_EVM, "3", from);
    assert.ok("sent" in r, JSON.stringify(r));
    assert.equal(r.sent.line, WEB_SEND_WORDS.sent("3", "USDG"));
    const q = e.asked[0]!;
    assert.deepEqual([q.originAsset, q.destinationAsset, q.recipient, q.refundTo, q.confidentiality, q.amount], [USDG_ID, USDG_ID, TO_EVM, e.own("eth"), "basic", "3000000"]);
    assert.deepEqual([e.sheets.length, e.sheets[0]!.password], [1, true]);
    assert.deepEqual(e.answers, ["security.web.password", "security.web.password", "ok"]);
    assert.equal(e.evmSent.length, 1);
    const hex = hexOf(e.evmSent[0]!);
    assert.ok(hex.includes(USDG.slice(2)), "sent to USDG's own contract");
    assert.ok(hex.includes("a9059cbb" + EVM_DEPOSIT.slice(2).padStart(64, "0") + (3_000_000n).toString(16).padStart(64, "0")), "transfer(1Click's signed address, exactly 3 USDG)");
  } finally { e.restore(); }
});

test("W4 token controls: a quote paying someone else, another amount, another coin, or another deposit address than 1Click signed: refused by the real core before any sheet, nothing signed; the line names the wallet the token is in", async () => {
  const cases: [string, "sol" | "hood", string, string, { tamper?: Tamper; signedDeposit?: string }][] = [
    ["payee (SPL)", "sol", USDC_ID, SOL_PAYEE, { tamper: (r) => ({ ...r, recipient: THIEF_SOL }) }],
    ["amount (SPL)", "sol", USDC_ID, SOL_PAYEE, { tamper: (r) => ({ ...r, amount: "2500001" }) }],
    ["coin (SPL priced as SOL)", "sol", USDC_ID, SOL_PAYEE, { tamper: (r) => ({ ...r, originAsset: "nep141:sol.omft.near", destinationAsset: "nep141:sol.omft.near" }) }],
    ["deposit (SPL)", "sol", USDC_ID, SOL_PAYEE, { signedDeposit: THIEF_SOL }],
    ["payee (ERC-20)", "hood", USDG_ID, TO_EVM, { tamper: (r) => ({ ...r, recipient: "0x2222222222222222222222222222222222222222" }) }],
    ["amount (ERC-20)", "hood", USDG_ID, TO_EVM, { tamper: (r) => ({ ...r, amount: "3000001" }) }],
    ["deposit (ERC-20)", "hood", USDG_ID, TO_EVM, { signedDeposit: "0x3333333333333333333333333333333333333333" }],
  ];
  for (const [why, chain, id, to, t] of cases) {
    const e = await webEntry(t);
    try {
      const r = await sheetGo(e, chain, to, chain === "sol" ? "2.5" : "3", chip(id));
      assert.ok("line" in r, `${why}: ${JSON.stringify(r)}`);
      assert.match(r.line!, new RegExp(`^NEAR Intents .*Nothing moved\\. Your money is in your ${chain === "sol" ? "SOL" : "Robinhood"} wallet\\.$`), why);
      assert.deepEqual([e.sheets.length, e.solSent.length, e.evmSent.length, e.handed.length], [0, 0, 0, 0], `${why}: no sheet, nothing signed or sent`);
    } finally { e.restore(); }
  }
});

test("W4 token controls: a token the wallet holds too little of stops before any price; a coin the core has no private route for is refused before any price and is never offered (no chip)", async () => {
  const short = await webEntry({ tokens: 1_000_000n });
  try {
    const r = await sheetGo(short, "sol", SOL_PAYEE, "2.5", chip(USDC_ID));
    assert.ok("line" in r && /USDC/.test(r.line!), JSON.stringify(r));
    assert.deepEqual([short.asked.length, short.sheets.length, short.solSent.length], [0, 0, 0], "nothing asked, nothing signed");
  } finally { short.restore(); }
  const e = await webEntry();
  try {
    // a held memecoin with no pinned route: no chip (rule 1); asked anyway, the core refuses it before any price
    const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    assert.equal(webSendCoins([{ chain: "sol", address: BONK, amount: "1000" }]).length, 0, "no chip for a coin with no private route");
    const r = await e.bridge.call("subwallet.sendPrivate", { chain: "sol", to: SOL_PAYEE, toTokenId: "nep141:sol-bonk.omft.near", amount: "1" });
    assert.ok("problem" in r);
    assert.equal(e.asked.length, 0, "no price asked");
    // a pinned token of the other chain is refused too (USDG from the SOL wallet)
    assert.ok("problem" in (await e.bridge.call("subwallet.sendPrivate", { chain: "sol", to: SOL_PAYEE, toTokenId: USDG_ID, amount: "1" })));
    assert.equal(e.asked.length, 0);
  } finally { e.restore(); }
});

test("W4 absent coins: the NEAR wallet's coins and BNB Chain's get no chip on the web Send (no route: NEAR_GATE shut, NEAR Intents refuses NEAR payouts; BNB_PROVEN false), and the sheet offers no NEAR or BNB wallet", async () => {
  assert.deepEqual(webSendCoins([{ chain: "near", address: "wrap.near", amount: "5" }, { chain: "near", address: "usdt.tether-token.near", amount: "5" }, { chain: "bsc", address: "0x55d398326f99059ff775485246999027b3197955", amount: "5" }]), []);
  assert.deepEqual(WEB_SEND_FROM.map((f) => f.chain), ["sol", "hood"]);
  // control: the pinned tokens held get their chip, an empty one doesn't
  assert.deepEqual(webSendCoins([...HELD, { chain: "sol", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", amount: "0" }]).map((f) => f.symbol), ["USDC", "USDG"]);
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const froms: WebSendFrom\[\] = webSendFroms\(WEB_SEND_TOKENS, held\);/);
  assert.doesNotMatch(sheet, /"near"|"bsc"|BNB/);
});

test("W4 chips from the real web core: subwallet.sendCoins reads the wallets' pinned tokens on the core's own nodes (USDC in the SOL wallet's own account, USDG on Robinhood Chain) and the sheet's From row gets their chips; controls: the switch off shows none, an empty wallet gives none, another app can't read it", async () => {
  const e = await webEntry();
  try {
    const r = await e.bridge.call<{ chain: string; address: string; symbol: string; amount: string }[]>("subwallet.sendCoins", {});
    assert.ok("ok" in r, JSON.stringify(r));
    assert.deepEqual(r.ok, [{ chain: "sol", address: USDC_MINT, symbol: "USDC", amount: "25" }, { chain: "hood", address: USDG, symbol: "USDG", amount: "25" }], "the core's own reads, as decimal text");
    const on = webSendFroms(true, r.ok);
    assert.deepEqual(on.map((f) => f.symbol), ["SOL", "ETH", "USDC", "USDG"], "a held USDC's chip appears");
    assert.equal(on[2]!.lands, USDC_ID);
    // control: the switch off (until the relay's case (h) takes tokens live): the wallets' own coins only
    assert.deepEqual(webSendFroms(false, r.ok).map((f) => f.symbol), ["SOL", "ETH"]);
    assert.equal(WEB_SEND_TOKENS, true, "on by default (launch A7: the relay's case (h) takes the pinned tokens live)");
    // control: another app's call is refused
    assert.ok("problem" in (await forApps(e.core, "trade").call("subwallet.sendCoins", {})));
  } finally { e.restore(); }
  // control: nothing held: no row, so no chip
  const none = await webEntry({ tokens: 0n });
  try {
    const r = await none.bridge.call<unknown[]>("subwallet.sendCoins", {});
    assert.deepEqual("ok" in r ? r.ok : r, []);
  } finally { none.restore(); }
});

test("W4 switch: on by default since the relay's deploy (launch A7); VITE_WEB_SEND_TOKENS=0 rolls it back: no read, no token chip", async () => {
  assert.equal(WEB_SEND_TOKENS, true, "a build that sets nothing: on");
  assert.deepEqual([webSendTokensOn(undefined), webSendTokensOn("1"), webSendTokensOn(""), webSendTokensOn("0")], [true, true, true, false], "only 0 turns it off");
  // the rollback: off, the From row is the wallets' own coins only, whatever is held
  assert.deepEqual(webSendFroms(webSendTokensOn("0"), [{ chain: "sol", address: USDC_MINT, amount: "25" }]).map((f) => f.symbol), ["SOL", "ETH"]);
  assert.deepEqual(webSendFroms(webSendTokensOn(undefined), [{ chain: "sol", address: USDC_MINT, amount: "25" }]).map((f) => f.symbol), ["SOL", "ETH", "USDC"], "control: on, the held USDC's chip");
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("./WebSendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(!WEB_SEND_TOKENS\) return;\n\s+let on = true;\n\s+void bridge\.call<[^>]+>\("subwallet\.sendCoins", \{\}\)/, "nothing is read while off");
  assert.doesNotMatch(sheet, /shown\?\.held|trade\.positions/, "never Trade's book of coins traded here");
  const src = readFileSync(new URL("./web-send.ts", import.meta.url), "utf8");
  assert.match(src, /export const WEB_SEND_TOKENS: boolean = webSendTokensOn\(import\.meta\.env\?\.VITE_WEB_SEND_TOKENS\);/);
});

// Launch A7 (QA's live dry quotes through the deployed relay's case (h), 5 Nov): SOL USDC at $5, $50 and $500.
// The web Send's whole path into the real web core's sendPrivate -> outsideSheet: what the sheet says BEFORE the password,
// from 1Click's signed dollars only, and the high-fee warning over 5 % (OUTSIDE_FEE_WARN) at $5 alone.
test("launch A7: the real quotes' sheet before the password: $5 says they get about $4.75, fees about $0.25 and the high-fee warning; $50 and $500 say theirs with no warning", async () => {
  const cases: [string, string, string, string, string, string | null][] = [
    ["5", "4.998665", "4.746213", "4.75", "0.25", "5.1% goes to fees. On a bigger send, fees are a smaller part."],
    ["50", "49.98665", "49.734201", "49.73", "0.26", null], // changed pin (the audit's M7): $49.99 = $49.73 + $0.26, the rows close
    ["500", "499.8665", "499.614051", "499.61", "0.26", null], // changed pin (the audit's M7): $499.87 = $499.61 + $0.26
  ];
  for (const [amount, inUsd, outUsd, get, fees, warn] of cases) {
    const e = await webEntry({ usd: { in: inUsd, out: outUsd }, tokens: 10n ** 9n, answer: "no" });
    try {
      const r = await sheetGo(e, "sol", SOL_PAYEE, amount, chip(USDC_ID));
      assert.deepEqual(r, { line: WEB_SEND_WORDS.declined }, `$${amount}: a No sends nothing`);
      assert.equal(e.sheets.length, 1, `$${amount}: the sheet, once`);
      const sheet = e.sheets[0]!;
      assert.equal(sheet.password, true, `$${amount}: the password is asked on this very sheet`);
      assert.deepEqual(sheet.words.lines, [`To ${SOL_PAYEE}`, `They get about $${get}`, `Fees · about $${fees}`, "NEAR Intents and the network keep this. ZeroFee takes nothing.", "Public on Solana."], `$${amount}: what they get and the fees, before the password`);
      assert.deepEqual((sheet.words.warnings ?? []).map((w) => w.text), warn ? [warn] : [], `$${amount}: ${warn ? "the high-fee warning" : "no warning"}`);
      assert.equal(sheet.words.amount, `${amount} USDC`);
      assert.equal(e.solSent.length, 0, `$${amount}: nothing signed on a No`);
    } finally { e.restore(); }
  }
});
