// Security review 2 Nov of ee553670 (grade 02g, G11): a Solana or EVM wallet's sheet said in dollars only the native
// coin that leaves, so over a coin's transfer, an approval of ALL of a coin, or a test run in which a held coin falls,
// the sheet's first figure undersold it. D143 refinement (approval-policy.ts hotNeedsApproval, review H1): a site's
// request on a shared chain wallet, or one that fails a check, gets the approve sheet again, so its words matter again:
// the first warning says why it asks, and its dollars never undersell what leaves (none for a coin). A no signs nothing.
// Audit C1: a site asks only from its own wallet (subwallet.site.forHost); on a shared chain wallet it is refused.
// Controls: the same request from the person's own flow is refused by name, never asked; a known site's own wallet on
// its own page signs the fair trade with no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unsignedEvmTx } from "./evm.ts";
import type { EvmChain } from "./evm.ts";
import type { PlainWords } from "./signer.ts";
import { base58 } from "./sol/bytes.ts";
import { ownTokenAccount, solTransferTx } from "./solana.ts";
import type { SolChain, TokenChange } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { buy } from "./testing/pocket-tx.ts";

const SITE = { origin: "https://app.example.com" };
const ONE = 10n ** 18n;
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const V2 = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const TO = "0x00000000000000000000000000000000000000aa";
const word = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "")).padStart(64, "0");
const bsc = (to: string, value: bigint, data: string) => unsignedEvmTx({ chainId: 56, nonce: 0, tip: 1_000_000_000n, fee: 3_000_000_000n, gas: 100_000n, to, value, data });
/** swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, CAKE], to, deadline) */
const v2Buy = (min: bigint, to: string) => `0xb6f9de95${word(min)}${word(0x80n)}${word(to)}${word(2_000_000_000n)}${word(2n)}${word(WBNB)}${word(CAKE)}`;
/** D143: refused, named, nothing signed. */
const notSigned = (e: any) => e?.problem?.code === "security.subwallet.refused" && /Nothing was signed\.$/.test(e.problem.more);
/** notSigned, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const notSignedTrade = (e: any) => e?.problem?.code === "security.trade.not-signed" && /Nothing was signed\.$/.test(e.problem.more);
const ASKED_BY_SITE = "app.example.com isn't a site ZeroFee knows, so ZeroFee asks you.";
/** The one sheet asked since the last, its first warning matching `why` (a cause may end in a full stop or not); then forgotten. */
function sheetOf(shown: PlainWords[], why: RegExp): PlainWords {
  assert.equal(shown.length, 1, "the approve sheet asked once");
  const sheet = shown.pop()!;
  assert.match(sheet.warnings[0]?.text ?? "", why);
  return sheet;
}

async function evmWallet() {
  const shown: PlainWords[] = [];
  const evm = {
    // a fair fill: a buy of CAKE gets exactly its 1,000 minimum
    simulate: async () => ({ ok: true, agreed: true, balance: ONE, coinsIn: new Map([[CAKE, 1000n]]) }),
    nonce: async () => 0,
    tokenBalance: async () => 0n,
    token: async (_c: string, t: string) => (t === USDT ? { symbol: "USDT", decimals: 18 } : t === CAKE ? { symbol: "CAKE", decimals: 18 } : undefined),
    ponsCurve: async () => null,
  } as unknown as EvmChain;
  let answer = false;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => 600, approve: async (w) => (shown.push(w), answer), emit: () => {} });
  return { wallets, shown, w: await wallets.create("trade", "bsc"), say: (yes: boolean) => (answer = yes) };
}

test("G11, D143 refinement, audit C1: a site's plain send, coin transfer or approval of ALL of a coin on BNB Chain, from the site's own wallet, asks on the one-tap sheet, the cause first, its dollars never underselling it; a no signs nothing (controls: from the person's own flow each is refused; on the shared chain wallet a site is refused by name; the site's checked buy asks, and a yes signs)", async () => {
  const { wallets, shown, w, say } = await evmWallet();
  const own = await wallets.siteFor(SITE, "bsc");
  const send = bsc(TO, ONE / 10n, "0x");
  const transfer = bsc(USDT, 0n, `0xa9059cbb${word(TO)}${word(10_000n * ONE)}`);
  const all = bsc(USDT, 0n, `0x095ea7b3${word(TO)}${"f".repeat(64)}`);
  // a plain send: only BNB leaves, so its dollars are the BNB's (0.1003 BNB with the fee, at $600)
  assert.deepEqual(await wallets.signTx(own.id, send, undefined, undefined, undefined, SITE), { declined: true }, "a plain send");
  const s1 = sheetOf(shown, /^It sends coins out of the wallet, so ZeroFee asks you\.$/);
  assert.match(s1.amount ?? "", /\$60\.18/);
  assert.equal(s1.tap, true, "one tap, never Face ID");
  // 10,000 USDT sent: named as the coin, never a dollar figure for the gas alone
  assert.deepEqual(await wallets.signTx(own.id, transfer, undefined, undefined, undefined, SITE), { declined: true }, "10,000 USDT sent");
  const s2 = sheetOf(shown, /^It goes to an app ZeroFee doesn't know, so ZeroFee asks you\.$/);
  assert.equal(s2.title, "Send 10,000 USDT");
  assert.equal(s2.amount, undefined, "no dollars that undersell it");
  // ALL of the USDT allowed: said as all of it, with no dollar figure
  assert.deepEqual(await wallets.signTx(own.id, all, undefined, undefined, undefined, SITE), { declined: true }, "ALL of the USDT allowed");
  const s3 = sheetOf(shown, /^It goes to an app ZeroFee doesn't know, so ZeroFee asks you\.$/);
  assert.match(s3.title, /ALL of your USDT, with no limit/);
  assert.ok(s3.warnings.some((x) => /take all of this coin/.test(x.text)));
  assert.equal(s3.amount, undefined, "no dollars that undersell it");
  // audit C1: the site on the person's shared chain wallet is refused by name, never asked
  for (const t of [send, transfer, all]) {
    await assert.rejects(wallets.signTx(w.id, t, undefined, undefined, undefined, SITE), (e: any) => e?.problem?.more === "This site can use only its own wallet.");
  }
  // controls: the same three from the person's own flow are refused by name, never asked
  for (const [t, label] of [[send, "a plain send"], [transfer, "10,000 USDT sent"], [all, "ALL of the USDT allowed"]] as const) {
    await assert.rejects(wallets.signTx(w.id, t, undefined, undefined, undefined, undefined, "browser"), notSignedTrade, `${label}: own flow`);
  }
  assert.equal(shown.length, 0, "never asked in the person's own flow");
  // control: the site's checked buy on its own wallet asks (a site ZeroFee doesn't list), its dollars the BNB it spends; a yes signs
  say(true);
  assert.ok("signedTx" in (await wallets.signTx(own.id, bsc(V2, ONE / 10n, v2Buy(1000n, own.address)), undefined, undefined, undefined, SITE)));
  assert.match(sheetOf(shown, new RegExp(`^${ASKED_BY_SITE.replace(/\./g, "\\.")}$`)).amount ?? "", /\$60\.18/);
});

test("G11, D143 refinement, audit C1: a site's Solana request from its own wallet in which a held coin falls, or a plain SOL send, asks, the cause first; with a held coin falling its dollars never undersell it; a no signs nothing (controls: from the person's own flow each is refused; the site's fair buy asks on its own wallet, and pump.fun's own wallet on pump.fun signs it with no sheet)", async () => {
  const mint = base58(new Uint8Array(32).fill(41));
  let coins: (wallet: string) => TokenChange[] = () => [];
  const sol: SolChain = {
    blockhashValid: async () => true,
    lookupTables: async () => [],
    simulate: async (tx, wallet) => ({ ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_979_995_000n, tokens: [...fairCoins(tx), ...coins(wallet)] }),
  };
  const shown: PlainWords[] = [];
  let answer = true;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol, usdPrice: async () => 150, approve: async (w) => (shown.push(w), answer), emit: () => {} });
  const w = await wallets.create("trade", "sol");
  const own = await wallets.siteFor(SITE, "sol");
  const trade = buy(own.address, 3);
  // control: the site's fair pump.fun buy on its own wallet asks (a site ZeroFee doesn't list), its dollars the SOL it spends; a yes signs
  assert.ok("signedTx" in (await wallets.signTx(own.id, trade, undefined, undefined, undefined, SITE)));
  assert.match(sheetOf(shown, new RegExp(`^${ASKED_BY_SITE.replace(/\./g, "\\.")}$`)).amount ?? "", /\$3\.00/);
  answer = false;
  // the same bytes, while a coin the wallet holds falls in the test run: asked, the cause first, no dollar figure
  coins = (wallet) => [{ address: ownTokenAccount(wallet, mint), mint, before: 1_000_000_000n, after: 0n }];
  assert.deepEqual(await wallets.signTx(own.id, trade, undefined, undefined, undefined, SITE), { declined: true });
  const falls = sheetOf(shown, /spends a coin you hold/);
  assert.equal(falls.amount, undefined, "SOL alone would undersell it");
  assert.ok(falls.effect.some((r) => r.token !== "SOL" && r.after === "0"), "the falling coin has its own row, to 0");
  await assert.rejects(wallets.signTx(w.id, buy(w.address, 3), undefined, undefined, undefined, undefined, "browser"), (e: any) => notSignedTrade(e) && /spends a coin you hold/.test(e.problem.more), "own flow: refused");
  // a plain SOL send isn't a trade: asked with a site, refused in the person's own flow, coin or not
  const send = solTransferTx(own.address, base58(new Uint8Array(32).fill(42)), 200_000_000n, base58(new Uint8Array(32).fill(5)));
  const ownSend = solTransferTx(w.address, base58(new Uint8Array(32).fill(42)), 200_000_000n, base58(new Uint8Array(32).fill(5)));
  for (const fall of [true, false]) {
    if (!fall) coins = () => [];
    assert.deepEqual(await wallets.signTx(own.id, send, undefined, undefined, undefined, SITE), { declined: true });
    const asked = sheetOf(shown, /^It isn't one trade, so ZeroFee asks you\.$/);
    if (fall) assert.equal(asked.amount, undefined, "a held coin falls: no dollar figure");
    await assert.rejects(wallets.signTx(w.id, ownSend, undefined, undefined, undefined, undefined, "browser"), notSignedTrade, "own flow: refused");
  }
  assert.equal(shown.length, 0);
  // control: pump.fun's own wallet, on pump.fun's own page, signs the fair buy with no sheet
  const pump = await wallets.create("site", "sol", undefined, "pump");
  assert.ok("signedTx" in (await wallets.signTx(pump.id, buy(pump.address, 3), undefined, undefined, undefined, { origin: "https://pump.fun" })));
  assert.equal(shown.length, 0, "a known site's own wallet on its own page: no sheet");
});
