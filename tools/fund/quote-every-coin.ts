// Real 1Click quotes for every coin "Add money to start" offers (packages/core/src/fund-start.ts FUND_COINS), and NO
// deposit: `node tools/fund/quote-every-coin.ts <out-dir>`. For each coin, the same two asks the core makes: the dry
// price (EXACT_OUTPUT, what a new account needs plus 5%), then the real quote (FLEX_INPUT, dry false, so 1Click signs a
// deposit address), checked by the core's own checkFundQuote. The recipient and refund addresses are made from a fresh
// random key each run and never kept: nobody holds them, and nothing is ever sent to the deposit addresses.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { FUND_ADDRESS_MS, FUND_COINS, checkFundQuote, coinText, dryAmountIn, fundRequest, fundTarget } from "../../packages/core/src/fund-start.ts";
import { base58 } from "../../packages/core/src/sol/bytes.ts";
import { quoteDeadline } from "../../packages/core/src/quote-deadline.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: node tools/fund/quote-every-coin.ts <out-dir>");
const NEED = 398_000_000_000_000_000_000_000n; // a new account by hash: 0.048 NEAR storage + 0.35 NEAR margin (demo-core.ts)
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fundAddress = hex(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
const solAddress = base58(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
const evmPub = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false);
const evmAddress = `0x${hex(keccak_256(evmPub.slice(1)).slice(-20))}`;
const ask = async (body: unknown) => {
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const rows: unknown[] = [];
for (const coin of FUND_COINS) {
  if (coin.id === "near") {
    rows.push({ coin: coin.id, network: coin.network, offered: true, route: "sent straight to the account's own address; no swap, no quote" });
    continue;
  }
  const refundTo = coin.chain === "sol" ? solAddress : evmAddress;
  const deadlineIso = quoteDeadline(Date.now(), FUND_ADDRESS_MS);
  const want = fundTarget(NEED);
  const dry = await ask(fundRequest({ coin, amount: want.toString(), swapType: "EXACT_OUTPUT", dry: true, refundTo, fundAddress, deadlineIso }));
  const amountIn = dryAmountIn(dry.body, coin, want);
  if (!amountIn) {
    rows.push({ coin: coin.id, network: coin.network, offered: false, dry: { status: dry.status, answer: dry.body } });
    console.log(`${coin.id.padEnd(9)} DROP  dry price refused (${dry.status}): ${JSON.stringify(dry.body).slice(0, 160)}`);
    continue;
  }
  const real = await ask(fundRequest({ coin, amount: amountIn, swapType: "FLEX_INPUT", dry: false, refundTo, fundAddress, deadlineIso }));
  let checked: string;
  let ok = false;
  try {
    const f = checkFundQuote(real.body, { coin, refundTo, fundAddress, needYocto: NEED, amountIn }, Date.now());
    ok = true;
    checked = `send ${coinText(f.amountIn, coin.decimals)} ${coin.symbol} ($${Number(f.amountInUsd).toFixed(2)}), at least ${coinText(real.body.quote.minAmountIn, coin.decimals)}; NEAR out at least ${coinText(f.minAmountOut, 24, "down")}`;
  } catch (e) {
    checked = `REFUSED by the core's check: ${(e as Error).message ?? e}`;
  }
  rows.push({ coin: coin.id, symbol: coin.symbol, network: coin.network, offered: ok, dry: dry.body, real: real.body, check: checked });
  console.log(`${coin.id.padEnd(9)} ${ok ? "OK  " : "DROP"}  ${checked}`);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "quotes.json"), JSON.stringify({ atIso: new Date().toISOString(), needYocto: NEED.toString(), note: "Real 1Click quotes, no deposit. Recipient and refund addresses from throwaway keys, never kept.", rows }, null, 2));
console.log(`saved ${join(out, "quotes.json")}`);
