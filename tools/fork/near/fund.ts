// The NEAR mainnet copy's faucet: fake NEAR and fake USDC from test.near, to the app's set-up address or any account.
// Only the copy (127.0.0.1): nothing here can reach mainnet.
//   ZF_FORK_DIR=<dir> node tools/fork/near/fund.ts <account> [--near N] [--usdc N] [--safe-usdc N] [--safe-near N]
//     --near       NEAR on the account (a 64-hex set-up address is made by it, as on mainnet)
//     --usdc       USDC on the account itself (test.near pays its storage on the USDC contract, then mints)
//     --safe-usdc  USDC inside intents.near for the account (the Safe): minted to test.near, then deposited for it
//     --safe-near  wNEAR inside intents.near for the account (the Safe): test.near wraps NEAR and deposits it for it
//   With no amount: --near 10.
import { NEAR, TGAS, USDC, account, asRoot, fnCall, root, units, view } from "./lib.ts";

const [to, ...rest] = process.argv.slice(2);
if (!to || !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(to) || to.length < 2 || to.length > 64) throw new Error("usage: fund.ts <account> [--near N] [--usdc N] [--safe-usdc N] [--safe-near N]");
const opts: Record<string, string> = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i]!, v = rest[i + 1] ?? "";
  if (!["--near", "--usdc", "--safe-usdc", "--safe-near"].includes(k)) throw new Error(`unknown option ${k}`);
  units(v, 6);
  opts[k] = v;
}
if (!Object.keys(opts).length) opts["--near"] = "10";

/** test.near's storage on a coin contract for `who`, once. */
async function storage(contract: string, who: string) {
  const have = await view<unknown>(contract, "storage_balance_of", { account_id: who });
  if (have) return;
  const bounds = await view<{ min: string }>(contract, "storage_balance_bounds");
  await asRoot(contract, [fnCall("storage_deposit", { account_id: who, registration_only: true }, BigInt(bounds.min), 30n * TGAS)], `storage on ${contract} for ${who}`);
}
const mint = async (who: string, amount: bigint) => {
  await storage(USDC, who);
  await asRoot(USDC, [fnCall("mint", { to: who, amount: amount.toString() }, 0n, 30n * TGAS)], `mint ${amount} USDC units to ${who}`);
};
const intoSafe = async (coin: string, amount: bigint) => {
  await storage(coin, "intents.near");
  await asRoot(coin, [fnCall("ft_transfer_call", { receiver_id: "intents.near", amount: amount.toString(), msg: to }, 1n, 100n * TGAS)], `deposit into intents.near for ${to}`);
};

if (opts["--near"]) {
  await asRoot(to, [{ kind: "transfer", yocto: units(opts["--near"], 24) }], `send NEAR to ${to}`);
  console.log(`   ${opts["--near"]} NEAR -> ${to}`);
}
if (opts["--usdc"]) {
  if (!(await account(to))) throw new Error(`${to} doesn't exist yet: send it NEAR first (or wait for set-up)`);
  await mint(to, units(opts["--usdc"], 6));
  console.log(`   ${opts["--usdc"]} USDC -> ${to} (on the account)`);
}
if (opts["--safe-usdc"]) {
  const amount = units(opts["--safe-usdc"], 6);
  await mint(root.account_id, amount);
  await intoSafe(USDC, amount);
  console.log(`   ${opts["--safe-usdc"]} USDC -> ${to} (inside intents.near: the Safe)`);
}
if (opts["--safe-near"]) {
  const yocto = units(opts["--safe-near"], 24);
  await storage("wrap.near", root.account_id);
  await asRoot("wrap.near", [fnCall("near_deposit", {}, yocto, 30n * TGAS)], "wrap NEAR");
  await intoSafe("wrap.near", yocto);
  console.log(`   ${opts["--safe-near"]} wNEAR -> ${to} (inside intents.near: the Safe)`);
}
const safe = await view<string[]>("intents.near", "mt_batch_balance_of", { account_id: to, token_ids: [`nep141:${USDC}`, "nep141:wrap.near"] }).catch(() => null);
const a = await account(to);
console.log(`   ${to}: ${a ? (Number(BigInt(a.amount) / (NEAR / 10_000n)) / 10_000).toString() : "no account yet"} NEAR; Safe USDC ${safe ? Number(safe[0]) / 1e6 : "?"}, Safe wNEAR ${safe ? Number(BigInt(safe[1]!) / (NEAR / 10_000n)) / 10_000 : "?"}`);
