// Reads an account's ledger the way the app does: balances on two NEAR nodes at one final block, a deposit address from
// the NEAR Intents bridge, and the deposits the bridge has seen. Free: nothing is signed or sent, and no key is needed.
//
//   node tools/wallet/read.ts <account.near>            balances (in NEAR Intents, and on the account itself)
//   node tools/wallet/read.ts <account.near> <chain>    also the deposit address for a network (sol, base, btc, near …)
//                                                       and the deposits the bridge has seen there
//
// Used in the mainnet proof (tools/wallet/PROOF.md) to watch a deposit arrive.
import { createApis } from "../../packages/wallet/src/apis.ts";
import { Catalogue } from "../../packages/wallet/src/catalogue.ts";
import { fromUnits } from "../../packages/wallet/src/amount.ts";
import { createLedgerService } from "../../packages/wallet/src/ledger.ts";
import type { Balance, DepositAddress } from "../../packages/wallet/src/types.ts";
import { chain as near, printBalances, toolCore } from "./kit.ts";

const [accountId, chain] = process.argv.slice(2);
if (!accountId) {
  console.log("Usage: node tools/wallet/read.ts <account.near> [chain]");
  process.exit(1);
}
const apis = createApis();
const ledger = createLedgerService({ bridge: toolCore(accountId), chain: near, apis });

const balances = await ledger.call<Balance[]>("ledger.balances");
if ("problem" in balances) {
  console.log(`Balances: ${balances.problem.code}: ${balances.problem.whatHappened}`);
  process.exitCode = 1;
} else printBalances(accountId, balances.ok);

if (chain) {
  const a = await ledger.call<DepositAddress>("ledger.depositAddress", { chain });
  if ("problem" in a) {
    console.log(`Deposit address: ${a.problem.code}: ${a.problem.whatHappened}`);
    process.exitCode = 1;
  } else {
    console.log(`\nTo receive on ${chain}:`);
    console.log(`   address  ${a.ok.address}`);
    if (a.ok.memo) console.log(`   memo     ${a.ok.memo}   (always include it)`);
    console.log(`   at least ${a.ok.minAmount} (${a.ok.token})`);
    console.log(`   ${a.ok.note ?? ""}`);
  }
  const cat = new Catalogue(await apis.tokens(), await apis.supportedTokens());
  const bridgeChain = cat.network(chain)?.bridgeChain;
  if (bridgeChain) {
    const seen = await apis.recentDeposits(accountId, bridgeChain);
    console.log(`\nDeposits the bridge has seen on ${chain}: ${seen.length === 0 ? "none yet" : ""}`);
    for (const d of seen) {
      const coin = cat.coin(`nep141:${d.near_token_id}`) ?? [...cat.coins.values()].find((c) => c.assetId.endsWith(d.near_token_id));
      const amount = coin ? `${fromUnits(d.amount, coin.decimals)} ${coin.symbol}` : `${d.amount} (smallest units) of ${d.near_token_id}`;
      console.log(`   ${d.status.padEnd(10)} ${amount}   tx ${d.tx_hash}`);
    }
  }
}
