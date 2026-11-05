// Fake money for wallets on the mainnet copy (start.sh runs it for the test wallet): native coin by anvil_setBalance,
// and each chain's stable coins sent by a real holder the copy impersonates (anvil_impersonateAccount), so the coin's
// own balances and events are real ones. Loopback only.
//   node tools/fork/evm/fund.ts 0xabc… [0xdef…]          both chains (each that is running)
//   FORK_CHAINS=hood node tools/fork/evm/fund.ts 0xabc…    one chain
// Amounts (env): FORK_NATIVE_BSC (default 50 BNB), FORK_NATIVE_HOOD (5 ETH), FORK_STABLE (10000 of each stable).
import { FORK, forkUrl, balanceOfData, getPoolData, hexQ, receiptOf, richest, rpc, transferData, units, type ForkChain } from "./fork.ts";

const NATIVE_DEFAULT: Record<ForkChain, string> = { bsc: "50", hood: "5" };

async function up(chain: ForkChain): Promise<boolean> {
  try {
    return BigInt(await rpc(forkUrl(chain), "eth_chainId")) === BigInt(FORK[chain].chainId);
  } catch {
    return false;
  }
}

async function decimalsOf(url: string, token: string): Promise<number> {
  return Number(BigInt(await rpc(url, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"])));
}

async function balanceOf(url: string, token: string, who: string): Promise<bigint> {
  const r = await rpc(url, "eth_call", [{ to: token, data: balanceOfData(who) }, "latest"]);
  return r && r !== "0x" ? BigInt(r.slice(0, 66)) : 0n;
}

/** Who to impersonate for `need` of a coin: the richest of the listed hot wallets, the v4 PoolManager and the coin's v3
 *  pools against the wrapped native coin. */
async function holderOf(chain: ForkChain, token: string, need: bigint): Promise<string | null> {
  const s = FORK[chain], url = forkUrl(chain);
  const pools = await Promise.all(s.v3Fees.map(async (fee) => `0x${String(await rpc(url, "eth_call", [{ to: s.v3Factory, data: getPoolData(token, s.wrapped, fee) }, "latest"])).slice(-40)}`));
  const tried = [...s.holders, s.poolManager, ...pools.filter((p) => !/^0x0{40}$/.test(p))];
  const held = await Promise.all(tried.map(async (holder) => ({ holder, balance: await balanceOf(url, token, holder).catch(() => 0n) })));
  return richest(held, need);
}

/** The holder sends `amount` of `token` to `to`. Its native balance is lent for the gas and set back after, so a pool's
 *  own books are untouched. */
async function sendAs(url: string, holder: string, token: string, to: string, amount: bigint): Promise<void> {
  const had = BigInt(await rpc(url, "eth_getBalance", [holder, "latest"]));
  await rpc(url, "anvil_setBalance", [holder, hexQ(had + 10n ** 18n)]);
  await rpc(url, "anvil_impersonateAccount", [holder]);
  try {
    const price = BigInt(await rpc(url, "eth_gasPrice"));
    const hash = await rpc(url, "eth_sendTransaction", [{ from: holder, to: token, data: transferData(to, amount), gas: hexQ(200_000n), maxFeePerGas: hexQ(price * 2n), maxPriorityFeePerGas: "0x0" }]);
    const r = await receiptOf(url, hash);
    if (r?.status !== "0x1") throw new Error(`the transfer from ${holder} reverted`);
  } finally {
    await rpc(url, "anvil_stopImpersonatingAccount", [holder]);
    await rpc(url, "anvil_setBalance", [holder, hexQ(had)]);
  }
}

export async function fund(chain: ForkChain, wallet: string): Promise<string[]> {
  const s = FORK[chain], url = forkUrl(chain), said: string[] = [];
  const native = process.env[`FORK_NATIVE_${chain.toUpperCase()}`] ?? NATIVE_DEFAULT[chain];
  await rpc(url, "anvil_setBalance", [wallet, hexQ(units(native, 18))]);
  said.push(`${native} ${s.native}`);
  for (const c of s.stables) {
    const dec = await decimalsOf(url, c.token);
    const amount = units(process.env.FORK_STABLE ?? "10000", dec);
    const holder = await holderOf(chain, c.token, amount);
    if (!holder) { said.push(`no ${c.symbol} (no holder found with that much)`); continue; }
    await sendAs(url, holder, c.token, wallet, amount);
    said.push(`${Number(await balanceOf(url, c.token, wallet)) / 10 ** dec} ${c.symbol}`);
  }
  return said;
}

if (import.meta.main) {
  const wallets = process.argv.slice(2);
  if (!wallets.length || wallets.some((w) => !/^0x[0-9a-fA-F]{40}$/.test(w))) {
    console.error("usage: node tools/fork/evm/fund.ts 0x<wallet> [0x<wallet> …]");
    process.exit(2);
  }
  const chains = (process.env.FORK_CHAINS ?? "bsc,hood").split(",").filter((c): c is ForkChain => c === "bsc" || c === "hood");
  let failed = false;
  for (const chain of chains) {
    if (!(await up(chain))) { console.log(`${chain}: no copy on ${forkUrl(chain)} (start.sh first)`); failed = true; continue; }
    for (const w of wallets) {
      try { console.log(`${chain} ${w.toLowerCase()}: ${(await fund(chain, w.toLowerCase())).join(", ")}`); }
      catch (e) { console.log(`${chain} ${w}: ${(e as Error).message}`); failed = true; }
    }
  }
  process.exit(failed ? 1 : 0);
}
