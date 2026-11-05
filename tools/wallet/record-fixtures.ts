// Records the answers the ledger's tests replay: 1Click's coin list and dry quotes, and the deposit bridge's coin table
// and deposit addresses. Free: reads only, nothing is signed or sent, no key is needed.
//
//   node tools/wallet/record-fixtures.ts
//
// Deposit addresses are asked for a public account (intents.near itself), never for anyone's own account.
import { mkdirSync, writeFileSync } from "node:fs";

const ONE_CLICK = "https://1click.chaindefuser.com/v0";
const BRIDGE = "https://bridge.chaindefuser.com/rpc";
const PUBLIC_ACCOUNT = "intents.near";
const out = new URL("../../packages/wallet/src/testing/fixtures/", import.meta.url);
mkdirSync(out, { recursive: true });

const save = (name: string, value: unknown) => {
  writeFileSync(new URL(name, out), JSON.stringify(value, null, 1) + "\n");
  console.log(`   saved ${name}`);
};

async function bridge(method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(BRIDGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method, params: [params] }),
  });
  return res.json();
}

async function dryQuote(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${ONE_CLICK}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dry: true, slippageTolerance: 50, deadline: new Date(Date.now() + 10 * 60_000).toISOString(), ...body }),
  });
  return { status: res.status, body: await res.json() };
}

const recordedAtIso = new Date().toISOString();
console.log(`Recording at ${recordedAtIso}`);

console.log("1. 1Click's coin list");
const tokens = await (await fetch(`${ONE_CLICK}/tokens`)).json();
save("oneclick-tokens.json", { recordedAtIso, tokens });

console.log("2. The deposit bridge's coin table");
save("bridge-supported-tokens.json", { recordedAtIso, response: await bridge("supported_tokens", {}) });

console.log("3. Deposit addresses for a public account, one chain of each kind");
const addresses: Record<string, unknown> = {};
for (const chain of ["sol:mainnet", "eth:8453", "eth:4663", "eth:56", "btc:mainnet", "tron:mainnet", "xrp:mainnet", "ton:mainnet", "stellar:mainnet"]) {
  addresses[`${chain} SIMPLE`] = await bridge("deposit_address", { account_id: PUBLIC_ACCOUNT, chain, deposit_mode: "SIMPLE" });
}
addresses["stellar:mainnet MEMO"] = await bridge("deposit_address", { account_id: PUBLIC_ACCOUNT, chain: "stellar:mainnet", deposit_mode: "MEMO" });
addresses["no-such-chain SIMPLE"] = await bridge("deposit_address", { account_id: PUBLIC_ACCOUNT, chain: "nope:mainnet", deposit_mode: "SIMPLE" });
save("bridge-deposit-addresses.json", { recordedAtIso, account: PUBLIC_ACCOUNT, addresses });

console.log("4. Recent deposits and a withdraw-fee estimate");
save("bridge-recent-deposits.json", { recordedAtIso, response: await bridge("recent_deposits", { account_id: PUBLIC_ACCOUNT }) });
save("bridge-withdrawal-estimate.json", {
  recordedAtIso,
  response: await bridge("withdrawal_estimate", {
    token: "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK",
    chain: "sol:mainnet",
  }),
});

console.log("5. Dry quotes (free pricing; no deposit address is given)");
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_NEAR = "nep141:usdt.tether-token.near";
save("oneclick-dry-quotes.json", {
  recordedAtIso,
  intentsToIntents: await dryQuote({
    swapType: "EXACT_INPUT", originAsset: USDC_NEAR, depositType: "INTENTS", destinationAsset: USDT_NEAR, amount: "1000000",
    refundTo: PUBLIC_ACCOUNT, refundType: "INTENTS", recipient: PUBLIC_ACCOUNT, recipientType: "INTENTS",
  }),
  nearOriginToIntents: await dryQuote({
    swapType: "EXACT_INPUT", originAsset: "nep141:wrap.near", depositType: "ORIGIN_CHAIN", destinationAsset: USDC_NEAR,
    amount: "200000000000000000000000", refundTo: PUBLIC_ACCOUNT, refundType: "INTENTS", recipient: PUBLIC_ACCOUNT, recipientType: "INTENTS",
  }),
  unknownAsset: await dryQuote({
    swapType: "EXACT_INPUT", originAsset: "nep141:no-such-coin.near", depositType: "INTENTS", destinationAsset: USDT_NEAR, amount: "1",
    refundTo: PUBLIC_ACCOUNT, refundType: "INTENTS", recipient: PUBLIC_ACCOUNT, recipientType: "INTENTS",
  }),
});
console.log("Done.");
