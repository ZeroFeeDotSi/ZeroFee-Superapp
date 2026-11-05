// The ledger's mainnet proof, run by the operator with dust (tools/wallet/PROOF.md). Never run by a session.
//
//   node tools/wallet/proof.ts <name>.near wrap <near>                         put NEAR into NEAR Intents
//   node tools/wallet/proof.ts <name>.near convert-intents <usdc>              route A: a 1Click quote funded by mt_transfer
//   node tools/wallet/proof.ts <name>.near convert-near <near>                 route B: a 1Click quote paid on NEAR
//   node tools/wallet/proof.ts <name>.near withdraw <solana address> <usdc>    USDC home to Solana, exactly that amount
//   node tools/wallet/proof.ts <name>.near fund-bnb <bnb chain address> <usdc> native BNB to an address on BNB Chain,
//                                                                              through route A (no HOT-bridge withdraw)
//
// Every transaction is built by the ledger's own builders (packages/wallet/src/moves.ts), shown in the words decoded from
// its bytes, and signed only after you type "yes". Amounts above the dust caps are refused.
import { INTENTS } from "@zerofee/core/intents";
import type { TxOutcome, TxRequest } from "@zerofee/core/signer";
import { fromUnits, toUnits } from "../../packages/wallet/src/amount.ts";
import { validEvmAddress, validSolanaAddress } from "../../packages/wallet/src/addresses.ts";
import { QuoteRefused, createApis, type QuoteRequest } from "../../packages/wallet/src/apis.ts";
import { Catalogue } from "../../packages/wallet/src/catalogue.ts";
import { createLedgerService } from "../../packages/wallet/src/ledger.ts";
import { WRAP_STORAGE_YOCTO, mtTransfer, nearIntoLedger, registerOn, withdrawHome, withdrawToNear } from "../../packages/wallet/src/moves.ts";
import type { Balance } from "../../packages/wallet/src/types.ts";
import { chain, closeTerminal, loadAccount, nearblocks, printBalances, sleep, toolCore } from "./kit.ts";

const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const BNB = "nep245:v2_1.omni.hot.tg:56_11111111111111111111";
/** Dust caps: the whole test budget is shared by every session. */
const CAP = { near: "0.2", usdc: "5" };

const [accountId, step, ...rest] = process.argv.slice(2);
const usage = () => {
  console.log("Usage: node tools/wallet/proof.ts <name>.near wrap <near> | convert-intents <usdc> | convert-near <near> | withdraw <solana address> <usdc> | fund-bnb <bnb chain address> <usdc>");
  process.exit(1);
};
if (!accountId || !step) usage();

const signer = (() => {
  try {
    return loadAccount(accountId);
  } catch (e) {
    console.log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
})();
const apis = createApis();
const ledger = createLedgerService({ bridge: toolCore(accountId, signer), chain, apis });

const amount = (text: string | undefined, decimals: number, cap: string, unit: string): bigint => {
  const units = text ? toUnits(text, decimals) : null;
  if (units === null || units <= 0n) throw new Error(`"${text}" isn't an amount of ${unit}`);
  if (units > toUnits(cap, decimals)!) throw new Error(`${text} ${unit} is more than the ${cap} ${unit} dust cap for this proof`);
  return units;
};

async function balances(): Promise<Balance[]> {
  const r = await ledger.call<Balance[]>("ledger.balances");
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
}

async function inLedger(tokenId: string, decimals: number): Promise<bigint> {
  const row = (await balances()).find((b) => b.tokenId === tokenId && b.held === "ledger");
  return row ? toUnits(row.amount, decimals)! : 0n;
}

/** Ask for one signature. Returns the transaction hash, or null if it didn't happen (and says why). */
async function sign(request: TxRequest): Promise<string | null> {
  const outcome = await signer.request(request);
  return report(outcome);
}

function report(o: TxOutcome): string | null {
  if (o.status === "done") {
    console.log(`   ✓ landed: ${o.explorerUrl}`);
    return o.txHash;
  }
  if (o.status === "declined") console.log("   Not signed (you didn't type yes). Nothing moved.");
  else console.log(`   ✗ ${o.problem.code}: ${o.problem.whatHappened}${o.problem.more ? ` (${o.problem.more})` : ""}`);
  process.exitCode = 1;
  return null;
}

const quoteRequest = (o: Pick<QuoteRequest, "originAsset" | "depositType" | "destinationAsset" | "amount"> & Partial<QuoteRequest>): QuoteRequest => ({
  dry: false,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  refundTo: accountId,
  refundType: "INTENTS",
  recipient: accountId,
  recipientType: "INTENTS",
  deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
  ...o,
});

/** Pay a 1Click quote on NEAR (route B): storage for its address on wrap.near if needed, then ft_withdraw to it. */
async function payOnNear(to: string, amountIn: string, why: string): Promise<string | null> {
  const block = await chain.commonBlock();
  if ((await chain.view("wrap.near", "storage_balance_of", { account_id: to }, block)) === null) {
    console.log("   The deposit address can't hold NEAR yet, so first pay its storage on wrap.near (0.00125 NEAR):");
    if (!(await sign(registerOn({ contract: "wrap.near", accountId: to, yocto: WRAP_STORAGE_YOCTO, why: "Mainnet proof: let 1Click's address receive NEAR" })))) return null;
  }
  return sign(withdrawToNear({ contract: "wrap.near", receiverId: to, units: BigInt(amountIn), why }));
}

/** Watch 1Click's status for a deposit address until it ends, or 15 minutes pass. */
async function watchQuote(depositAddress: string, route: string): Promise<void> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 15 * 60_000) {
    const s = await apis.status(depositAddress).catch(() => null);
    const now = s?.status ?? "UNKNOWN";
    if (now !== last) console.log(`   ${String(Math.round((Date.now() - started) / 1000)).padStart(4)} s  1Click: ${now}`);
    last = now;
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(now)) {
      const far = (s?.swapDetails as { destinationChainTxHashes?: { hash?: string; explorerUrl?: string }[] } | undefined)?.destinationChainTxHashes ?? [];
      for (const t of far) console.log(`   delivered: ${t.explorerUrl || t.hash}`);
      break;
    }
    await sleep(5000);
  }
  console.log("");
  if (last === "SUCCESS") console.log(`RESULT: route ${route} WORKS. 1Click took the deposit and delivered.`);
  else if (last === "REFUNDED") console.log(`RESULT: route ${route}: 1Click saw the deposit and REFUNDED it to your NEAR Intents balance. Tell Wallet and Security.`);
  else if (last === "FAILED") console.log(`RESULT: route ${route}: 1Click says FAILED. Tell Wallet and Security.`);
  else console.log(`RESULT: route ${route}: no answer after 15 minutes (last status: ${last}). 1Click may not see this kind of deposit. Tell Wallet and Security; the coins are at ${depositAddress} inside NEAR Intents.`);
  printBalances(accountId, await balances());
}

try {
  if (step === "wrap") {
    const yocto = amount(rest[0], 24, CAP.near, "NEAR");
    console.log(`Putting ${fromUnits(yocto, 24)} NEAR into NEAR Intents (one transaction to wrap.near: storage, wrap, deposit).`);
    if (await sign(nearIntoLedger({ accountId, yocto, why: `Mainnet proof: put ${fromUnits(yocto, 24)} NEAR into NEAR Intents` }))) printBalances(accountId, await balances());
  } else if (step === "convert-intents") {
    const units = amount(rest[0], 6, CAP.usdc, "USDC");
    if ((await inLedger(USDC_SOL, 6)) < units) throw new Error(`Not enough Solana USDC in NEAR Intents yet. Do the deposit step first (tools/wallet/PROOF.md).`);
    const q = await apis.quote(quoteRequest({ originAsset: USDC_SOL, depositType: "INTENTS", destinationAsset: USDC_NEAR, amount: units.toString() }));
    const to = q.quote.depositAddress;
    if (!to) throw new Error("1Click gave no deposit address");
    console.log(`Route A: 1Click quote ${to}`);
    console.log(`   in:  ${fromUnits(q.quote.amountIn, 6)} USDC (Solana, from your NEAR Intents balance, by mt_transfer)`);
    console.log(`   out: at least ${fromUnits(q.quote.minAmountOut, 6)} USDC (NEAR) into your NEAR Intents balance; refunds to you there`);
    const tx = await sign(mtTransfer({ to, tokenId: USDC_SOL, units: BigInt(q.quote.amountIn), why: "Mainnet proof, route A: fund a 1Click quote" }));
    if (tx) {
      await apis.submitDeposit(tx, to, accountId);
      await watchQuote(to, "A (mt_transfer into a 1Click INTENTS quote)");
    }
  } else if (step === "convert-near") {
    const units = amount(rest[0], 24, CAP.near, "NEAR");
    if ((await inLedger(WNEAR, 24)) < units) throw new Error(`Not enough NEAR in NEAR Intents yet. Run the wrap step first.`);
    const q = await apis.quote(quoteRequest({ originAsset: WNEAR, depositType: "ORIGIN_CHAIN", destinationAsset: USDC_NEAR, amount: units.toString() }));
    const to = q.quote.depositAddress;
    if (!to) throw new Error("1Click gave no deposit address");
    console.log(`Route B: 1Click quote, paid on NEAR to ${to}`);
    console.log(`   in:  ${fromUnits(q.quote.amountIn, 24)} NEAR (from your NEAR Intents balance, by ft_withdraw)`);
    console.log(`   out: at least ${fromUnits(q.quote.minAmountOut, 6)} USDC (NEAR) into your NEAR Intents balance; refunds to you there`);
    const tx = await payOnNear(to, q.quote.amountIn, "Mainnet proof, route B: pay a 1Click quote on NEAR");
    if (tx) {
      await apis.submitDeposit(tx, to, INTENTS.account);
      await watchQuote(to, "B (ft_withdraw to a 1Click NEAR deposit address)");
    }
  } else if (step === "withdraw") {
    const [address, usdc] = rest;
    if (!address || !validSolanaAddress(address)) throw new Error(`"${address}" isn't a Solana address`);
    const units = amount(usdc, 6, CAP.usdc, "USDC");
    const coin = new Catalogue(await apis.tokens(), await apis.supportedTokens()).coin(USDC_SOL);
    if (!coin?.bridge) throw new Error("The bridge doesn't list Solana USDC right now");
    if (units < coin.bridge.minWithdraw) throw new Error(`The bridge's minimum is ${fromUnits(coin.bridge.minWithdraw, 6)} USDC`);
    const total = units + coin.bridge.withdrawFee;
    if ((await inLedger(USDC_SOL, 6)) < total) throw new Error(`Not enough Solana USDC in NEAR Intents for ${fromUnits(total, 6)}`);
    console.log(`Withdraw: exactly ${fromUnits(units, 6)} USDC should land at ${address} on Solana.`);
    console.log(`   The bridge's fee (${fromUnits(coin.bridge.withdrawFee, 6)} USDC) is on top, so ${fromUnits(total, 6)} leaves NEAR Intents.`);
    const tx = await sign(withdrawHome({ contract: USDC_SOL.slice("nep141:".length), address, units: total, why: "Mainnet proof: USDC home to Solana" }));
    if (tx) {
      const started = Date.now();
      let landed = false;
      while (!landed && Date.now() - started < 10 * 60_000) {
        await sleep(5000);
        const w = (await apis.withdrawalStatus(tx).catch(() => []))[0];
        const solTx = w?.data?.transfer_tx_hash;
        if (w?.status === "COMPLETED" && typeof solTx === "string") {
          console.log(`   ✓ on Solana after ${Math.round((Date.now() - started) / 1000)} s: https://solscan.io/tx/${solTx}`);
          console.log(`RESULT: check that exactly ${fromUnits(units, 6)} USDC arrived in your Solana wallet.`);
          landed = true;
        }
      }
      if (!landed) console.log(`No Solana transaction yet after 10 minutes. The bridge has it: ${nearblocks(tx)}. Run this again later, or tell Wallet.`);
      printBalances(accountId, await balances());
    }
  } else if (step === "fund-bnb") {
    // Route A (an INTENTS quote funded by mt_transfer): paid on NEAR (route B), 1Click asks at least $1,000 for BNB
    // Chain right now (dry quotes, 25 Oct), so BNB funding stands or falls with route A.
    const [address, usdc] = rest;
    if (!address || !validEvmAddress(address)) throw new Error(`"${address}" isn't a BNB Chain address`);
    const units = amount(usdc, 6, CAP.usdc, "USDC");
    if ((await inLedger(USDC_SOL, 6)) < units) throw new Error(`Not enough Solana USDC in NEAR Intents yet. Do the deposit step first.`);
    const q = await apis.quote(quoteRequest({ originAsset: USDC_SOL, depositType: "INTENTS", destinationAsset: BNB, amount: units.toString(), recipient: address, recipientType: "DESTINATION_CHAIN" }));
    const to = q.quote.depositAddress;
    if (!to) throw new Error("1Click gave no deposit address");
    console.log(`Fund BNB: 1Click quote ${to}`);
    console.log(`   in:  ${fromUnits(q.quote.amountIn, 6)} USDC (Solana, from your NEAR Intents balance, by mt_transfer)`);
    console.log(`   out: at least ${fromUnits(q.quote.minAmountOut, 18)} BNB to ${address} on BNB Chain; refunds to your NEAR Intents balance`);
    const tx = await sign(mtTransfer({ to, tokenId: USDC_SOL, units: BigInt(q.quote.amountIn), why: "Mainnet proof: BNB to a BNB Chain address through 1Click" }));
    if (tx) {
      await apis.submitDeposit(tx, to, accountId);
      await watchQuote(to, "A to BNB Chain (native BNB delivered by 1Click, no HOT-bridge withdraw)");
    }
  } else usage();
} catch (e) {
  console.log(`Stopped: ${e instanceof QuoteRefused ? `1Click said no: ${e.message}` : e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  closeTerminal();
}
