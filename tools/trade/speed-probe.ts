// The trade path's speed, dry (no money): a real Solana buy is built and timed step by step, as the tap runs it, and
// NEVER sent. Nothing here can move money: the wallet is someone else's public address that just traded on PumpSwap
// (so it holds SOL and the build passes the engine's own balance check), and the "signature" is a throwaway key's over
// the message, timed only; it isn't that wallet's signature, so no node would take it.
//   node tools/trade/speed-probe.ts                     a coin and a wallet from PumpSwap's latest trade
//   node tools/trade/speed-probe.ts <mint> <wallet>     a coin and a public wallet of your choice
// Steps (ms): quote (the engine's prepare: pool, route, blockhash, fee) · proof (ready(): the engine's own test run) ·
// core reads at signing (the blockhash check, first valid node wins, beside the core's own test run) · sign (local).
// Tap to signed = proof + core + sign (the quote is ready before the tap: the Buy sheet re-quotes while it is open).
// Cold: the core's reads run at the tap (no preflight). Warm: Trade's quote, once proven, had the core check these exact
// bytes ahead (subwallet.preflight, the same reads); the tap then waits for the proven quote and the kept check (both
// done), looks it up by the bytes' sha256 and only signs. Each run times both on its own fresh quote.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { RpcSolChain } from "../../packages/core/src/solana.ts";
import { decodeTx } from "../../packages/core/src/sol/wire.ts";
import { createSolChain } from "../../packages/trade/src/sol/chain.ts";
import { PROGRAM } from "../../packages/trade/src/sol/keys.ts";

const NODE = "https://solana-rpc.publicnode.com";
const WSOL = "So11111111111111111111111111111111111111112";
const rpc = async (method: string, params: unknown[]) => {
  const r = await fetch(NODE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
  const b = (await r.json()) as { result?: any; error?: unknown };
  if (b.error) throw new Error(JSON.stringify(b.error).slice(0, 200));
  return b.result;
};

/** The fee payer and the coin of one of PumpSwap's latest buys: a wallet that holds SOL, and a coin with a live pool. */
async function latestPumpSwapTrade(): Promise<{ mint: string; wallet: string }> {
  const sigs: { signature: string; err: unknown }[] = await rpc("getSignaturesForAddress", [PROGRAM.pumpAmm, { limit: 25 }]);
  for (const s of sigs.filter((x) => !x.err)) {
    const t = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null);
    const key = t?.transaction?.message?.accountKeys?.[0];
    const payer = key?.signer ? key.pubkey : undefined;
    const mint = (t?.meta?.postTokenBalances ?? []).filter((b: any) => b.owner === payer).map((b: any) => b.mint).find((m: string) => m && m !== WSOL);
    if (!payer || !mint) continue;
    // a person's plain wallet (owned by the System Program) with some SOL in it now, not a program's relayer
    const acct = (await rpc("getAccountInfo", [payer, { encoding: "base64", commitment: "confirmed" }]).catch(() => null))?.value;
    if (acct?.owner === "11111111111111111111111111111111" && BigInt(acct.lamports ?? 0) > 50_000_000n) return { mint, wallet: payer };
  }
  throw new Error("no recent PumpSwap trade with a funded wallet found; pass <mint> <wallet>");
}

const ms = (t0: number) => Math.round(performance.now() - t0);
const [argMint, argWallet] = process.argv.slice(2);
const { mint, wallet } = argMint && argWallet ? { mint: argMint, wallet: argWallet } : await latestPumpSwapTrade();
const solUsd = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`).then((r) => r.json() as Promise<any>).then((j) => Number(j?.[WSOL]?.usdPrice) || 150, () => 150);
console.log(`coin ${mint}\nwallet ${wallet} (public, read only)\nSOL $${solUsd.toFixed(2)}`);

const chain = createSolChain({ owner: wallet, solUsd: async () => solUsd });
const core = new RpcSolChain();
const runs: Record<string, number>[] = [];
for (let i = 0; i < 3; i++) {
  const row: Record<string, number> = {};
  let t = performance.now();
  const p = await chain.prepare("buy", mint, { usd: 0.5 });
  row.quote = ms(t);
  t = performance.now();
  await p.ready();
  row.proof = ms(t);
  const tx = p.steps[0]!.tx;
  t = performance.now();
  const [valid, sim] = await Promise.all([
    (async () => { const t1 = performance.now(); const v = await core.blockhashValid(decodeTx(tx).blockhash); row.blockhash = ms(t1); return v; })(),
    (async () => { const t1 = performance.now(); const s = await core.simulate(tx, wallet, []); row.coreTest = ms(t1); return s; })(),
  ]);
  row.core = ms(t);
  t = performance.now();
  ed25519.sign(decodeTx(tx).message, ed25519.utils.randomSecretKey());
  row.sign = ms(t);
  row.tapToSigned = row.proof + row.core + row.sign;
  // warm: a fresh quote, proven and checked by the core before the tap (what the sheet does while it is open)
  const q = await chain.prepare("buy", mint, { usd: 0.5 });
  await q.ready();
  const wtx = q.steps[0]!.tx;
  const kept = Promise.all([core.blockhashValid(decodeTx(wtx).blockhash), core.simulate(wtx, wallet, [])]);
  const [wValid, wSim] = await kept;
  const tap = performance.now();
  await q.ready();
  await kept;
  sha256(new TextEncoder().encode(wtx));
  ed25519.sign(decodeTx(wtx).message, ed25519.utils.randomSecretKey());
  row.warmTapToSigned = Math.round((performance.now() - tap) * 10) / 10;
  console.log(`run ${i + 1}: ${p.quote.route} · valid ${valid}/${wValid} · test run ${sim.ok ? "ok" : "failed"}/${wSim.ok ? "ok" : "failed"} (${sim.servers}/${wSim.servers} server)`, row);
  runs.push(row);
}
const median = (k: string) => runs.map((r) => r[k]!).sort((a, b) => a - b)[1];
console.log(`median ms: quote ${median("quote")} · proof ${median("proof")} · core ${median("core")} (blockhash ${median("blockhash")}, test run ${median("coreTest")}) · sign ${median("sign")} · tap to signed: cold ${median("tapToSigned")}, warm (preflight) ${median("warmTapToSigned")}`);
console.log("Not sent. Send and landing add a node round trip plus one slot or two (Solana confirms in about 0.4-0.8 s).");
