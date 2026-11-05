// The Solana copy's clone list (tools/fork/sol/start.sh): what Trade and Home read and call, found on mainnet with Trade's
// own derivations and layouts (packages/trade/src/sol), so the copy holds exactly the accounts the app's direct path asks
// for, and BONK's Jupiter route as the copy's stand-in holds it (jup.ts). Reads only (getMultipleAccounts on a public node); nothing is signed. It also writes the USDC mint with this copy's
// own faucet as its mint authority (the one change to a cloned account), so fake USDC can be minted to any wallet.
//   node tools/fork/sol/accounts.ts <faucet address> <test wallet> <out dir>   ->  <out dir>/clone.txt, <out dir>/usdc-mint.json
// clone.txt: one "program <id>", "program2 <id>" (a non-upgradeable program) or "account <address>" per line.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ammGlobalConfig, ataOf, bondingCurveOf, canonicalPumpSwapPool, cpmmConfigAddress, cpmmPoolAddress, eventAuthority, feeConfigOf, key, PROGRAM, pumpGlobal, WSOL } from "../../../packages/trade/src/sol/keys.ts";
import { readStruct } from "../../../packages/trade/src/sol/codec.ts";
import { AMM_FEE_CONFIG_SEED, AMM_LAYOUT, CPMM_LAYOUT, PUMP_FEE_CONFIG_SEED, PUMP_LAYOUT } from "../../../packages/trade/src/sol/layouts.ts";
import { fromBase64 } from "../../../packages/trade/src/sol/bytes.ts";
import { heldQuote, openSwap, reader, REAL_JUP, swapAccounts, walletAccounts } from "./jup.ts";

export const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  // a graduated pump.fun coin on its canonical PumpSwap pool (USOE, ~$5.9M in the pool on 4 Nov 2026); FORK_PUMP_MINT picks another
  PUMP: process.env.FORK_PUMP_MINT ?? "ZzfwVg6Bs3pwYtDXj68jR6g1kmwpHCGefxWvofnpump",
};
/** Programs Trade's Solana paths call, all upgradeable on mainnet but the Associated Token program. */
export const PROGRAMS = [PROGRAM.token, PROGRAM.token2022, PROGRAM.cpmm, PROGRAM.pump, PROGRAM.pumpAmm, PROGRAM.pumpFees, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"];
export const PROGRAMS_V2 = [PROGRAM.ata];

const SOURCE = process.env.FORK_SOL_SOURCE ?? "https://solana-rpc.publicnode.com";
type Row = { owner: string; data: Uint8Array; lamports: number; executable: boolean; rentEpoch: number; space: number; b64: string } | null;
async function read(addresses: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < addresses.length; i += 10) {
    const res = await fetch(SOURCE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addresses.slice(i, i + 10), { encoding: "base64" }] }) });
    const body = (await res.json()) as { result?: { value: any[] }; error?: unknown };
    if (!body.result) throw new Error(`mainnet read failed: ${JSON.stringify(body.error).slice(0, 200)}`);
    for (const v of body.result.value) out.push(v ? { owner: v.owner, data: fromBase64(v.data[0]), lamports: v.lamports, executable: v.executable, rentEpoch: v.rentEpoch, space: v.space, b64: v.data[0] } : null);
  }
  return out;
}

const want = new Set<string>();
const add = (...a: (string | undefined)[]) => a.forEach((x) => x && x !== "11111111111111111111111111111111" && want.add(x));

/** Raydium CP-Swap pools of a coin against WSOL, every fee tier that exists, with what a swap reads and calls. */
async function cpmmPools(mint: string): Promise<number> {
  const pools = Array.from({ length: 12 }, (_, i) => cpmmPoolAddress(cpmmConfigAddress(i), mint, WSOL));
  const rows = await read(pools);
  let n = 0;
  rows.forEach((r, i) => {
    if (!r || r.owner !== PROGRAM.cpmm) return;
    const p = readStruct(CPMM_LAYOUT, "PoolState", r.data);
    add(pools[i], p.amm_config, p.token_0_vault, p.token_1_vault, p.lp_mint, p.token_0_mint, p.token_1_mint, p.observation_key);
    n++;
  });
  return n;
}

async function pumpCoin(mint: string): Promise<string> {
  const curve = bondingCurveOf(mint), canon = canonicalPumpSwapPool(mint);
  const [cv, cp, g, gf, ag, af] = await read([curve, canon, pumpGlobal(), feeConfigOf(PUMP_FEE_CONFIG_SEED), ammGlobalConfig(), feeConfigOf(AMM_FEE_CONFIG_SEED)]);
  add(mint, curve, pumpGlobal(), feeConfigOf(PUMP_FEE_CONFIG_SEED), ammGlobalConfig(), feeConfigOf(AMM_FEE_CONFIG_SEED), eventAuthority(PROGRAM.pump), eventAuthority(PROGRAM.pumpAmm));
  if (g) { const s = readStruct(PUMP_LAYOUT, "Global", g.data); add(s.fee_recipient, ...(s.fee_recipients as string[]), ...(s.buyback_fee_recipients as string[])); }
  if (ag) { const s = readStruct(AMM_LAYOUT, "GlobalConfig", ag.data); add(...(s.protocol_fee_recipients as string[]), ...(s.buyback_fee_recipients as string[])); }
  void gf; void af;
  if (cv && cv.owner === PROGRAM.pump) {
    const s = readStruct(PUMP_LAYOUT, "BondingCurve", cv.data);
    if (!s.complete) { add(ataOf(curve, mint, PROGRAM.token), ataOf(curve, mint, PROGRAM.token2022), ataOf(curve, WSOL, PROGRAM.token)); return "on its pump.fun curve"; }
  }
  if (cp && cp.owner === PROGRAM.pumpAmm) {
    const p = readStruct(AMM_LAYOUT, "Pool", cp.data);
    add(canon, p.lp_mint, p.pool_base_token_account, p.pool_quote_token_account);
    for (const q of [ataOf(p.pool_base_token_account, WSOL, PROGRAM.token)]) add(q);
    return "graduated, on its PumpSwap pool";
  }
  return "not found on the curve or a canonical PumpSwap pool";
}

/** BONK's buy and sell as Trade's Jupiter path asks them, held to the copy's DEXes (jup.ts): every account, table and
 *  program the two swaps name, read from mainnet. Built for the copy's test wallet; nothing is signed or sent. */
async function jupiterRoute(mint: string, wallet: string): Promise<string> {
  const labels: string[] = [];
  for (const [inMint, outMint, amount] of [[WSOL, mint, "50000000"], [mint, WSOL, "1000000000000"]] as const) {
    const q = await (await fetch(heldQuote(`?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=300`))).json() as { routePlan?: { swapInfo: { label: string; ammKey: string } }[]; error?: string };
    if (!q.routePlan?.length) throw new Error(`Jupiter has no held route for ${mint}: ${q.error ?? "none"}`);
    labels.push(...q.routePlan.map((r) => `${r.swapInfo.label} ${r.swapInfo.ammKey}`));
    const swap = await (await fetch(`${REAL_JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteResponse: q, userPublicKey: wallet, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }) })).json() as { swapTransaction?: string; error?: string };
    if (!swap.swapTransaction) throw new Error(`Jupiter built no swap for ${mint}: ${swap.error ?? "none"}`);
    const s = await openSwap(swap.swapTransaction, reader(SOURCE));
    if (!s) throw new Error("a route table wasn't read from mainnet");
    const all = swapAccounts(s), own = walletAccounts(wallet, all);
    add(...all.filter((a) => !own.has(a)));
  }
  return [...new Set(labels)].join(", ");
}

async function main() {
  const [faucet, wallet, outDir] = process.argv.slice(2);
  if (!faucet || !wallet || !outDir) throw new Error("usage: node tools/fork/sol/accounts.ts <faucet address> <test wallet> <out dir>");
  key(faucet);
  key(wallet);
  add(MINTS.BONK);
  const bonk = await cpmmPools(MINTS.BONK);
  const usdc = await cpmmPools(MINTS.USDC);
  const pump = await pumpCoin(MINTS.PUMP);
  const jup = await jupiterRoute(MINTS.BONK, wallet);
  // USDC's mint, its authority swapped for the copy's faucet (the mint layout: COption tag u32, then the authority)
  const [m] = await read([MINTS.USDC]);
  if (!m) throw new Error("USDC's mint was not read");
  const data = Uint8Array.from(m.data);
  data.set([1, 0, 0, 0], 0);
  data.set(key(faucet), 4);
  writeFileSync(join(outDir, "usdc-mint.json"), JSON.stringify({ pubkey: MINTS.USDC, account: { lamports: m.lamports, data: [Buffer.from(data).toString("base64"), "base64"], owner: m.owner, executable: false, rentEpoch: 0, space: data.length } }));
  want.delete(MINTS.USDC);
  // only accounts that exist on mainnet can be cloned
  const list = [...want];
  const rows = await read(list);
  // sysvars are the copy's own, never cloned
  const accounts = list.filter((_, i) => rows[i] && !rows[i]!.executable && rows[i]!.owner !== "Sysvar1111111111111111111111111111111111111");
  // a program a route calls (Raydium's AMM): cloned as the loader it lives under
  const known = new Set([...PROGRAMS, ...PROGRAMS_V2, "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111"]);
  const more = list.filter((a, i) => rows[i]?.executable && !known.has(a) && !/Sysvar|NativeLoader/.test(rows[i]!.owner));
  const upgradeable = more.filter((a) => rows[list.indexOf(a)]!.owner === "BPFLoaderUpgradeab1e11111111111111111111111");
  const programs = [...PROGRAMS, ...upgradeable], programs2 = [...PROGRAMS_V2, ...more.filter((a) => !upgradeable.includes(a))];
  writeFileSync(join(outDir, "clone.txt"), [...programs.map((p) => `program ${p}`), ...programs2.map((p) => `program2 ${p}`), ...accounts.map((a) => `account ${a}`)].join("\n") + "\n");
  console.log(`clone list: ${programs.length + programs2.length} programs, ${accounts.length} accounts (BONK/SOL CP-Swap pools ${bonk}, USDC/SOL ${usdc}; pump.fun coin ${MINTS.PUMP} ${pump}; BONK through Jupiter: ${jup}); USDC mintable by the faucet`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
