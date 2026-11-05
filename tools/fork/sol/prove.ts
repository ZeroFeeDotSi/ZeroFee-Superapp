// The Solana copy's proof (tools/fork/sol/start.sh must be up): Trade's own Solana engine buys BONK for $5 and sells it
// all back on the copy, through Jupiter's stand-in (BONK's main pool is Raydium's AMM, which only Jupiter routes), signed
// with the copy's test wallet. Exit 0 only if both land. Loopback only: the copy's node and the stand-in.
//   node tools/fork/sol/prove.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createSolRpc } from "../../../packages/trade/src/sol/rpc.ts";
import { createSolEngine } from "../../../packages/trade/src/sol/engine.ts";
import { messageOf } from "../../../packages/trade/src/sol/tx.ts";
import { base58, fromBase64 } from "../../../packages/trade/src/sol/bytes.ts";
import { forkTable } from "../../../packages/core/src/fork.ts";
import { MINTS } from "./accounts.ts";

const HOME_DIR = process.env.FORK_SOL_HOME ?? join(homedir(), ".cache/zerofee-fork/sol");
const secret = Uint8Array.from(JSON.parse(readFileSync(join(HOME_DIR, "test-wallet.json"), "utf8")) as number[]);
const owner = base58(secret.slice(32));
const t = forkTable();
const rpc = createSolRpc({ nodes: [t.sol, t.sol.replace("127.0.0.1", "localhost")] });
// what the app's VITE_FORK=1 build asks (packages/trade/src/sol/jupiter.ts JUP), here by hand: node runs the release constants
const toCopy: typeof fetch = (u, init) => fetch(String(u).replace("https://lite-api.jup.ag", t.jup), init);
// SOL's dollar price only sizes the $5 here (a fixed figure: Jupiter's keyless host allows 5 calls in 10 s, kept for the trades)
const solUsd = async () => 150;
const engine = createSolEngine({ rpc, owner, solUsd, fetch: toCopy, graceMs: 5_000 });

async function trade(side: "buy" | "sell", amount: { usd: number } | { max: true }): Promise<boolean> {
  const p = await engine.prepare(side, MINTS.BONK, amount);
  await p.ready?.();
  const raw = fromBase64(p.steps[0]!.tx);
  raw.set(ed25519.sign(messageOf(p.steps[0]!.tx), secret.slice(0, 32)), 1);
  const sig: string = await rpc.call("sendTransaction", [Buffer.from(raw).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }]);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = (await rpc.call("getSignatureStatuses", [[sig]]))?.value?.[0];
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
      console.log(`${s.err ? "✗" : "✓"} ${side} BONK on the copy (${p.quote.route}): ${side === "buy" ? `$${amount && "usd" in amount ? amount.usd : ""} for ${p.quote.getRaw} raw BONK` : `all for ${p.quote.getRaw} lamports`}, ${sig.slice(0, 12)}…`);
      return !s.err;
    }
  }
  const st = (await rpc.call("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]))?.value?.[0];
  console.log(`✗ ${side} (${p.quote.route}): not confirmed in 10 s (${sig.slice(0, 12)}…, ${JSON.stringify(st)})`);
  return false;
}

const bought = await trade("buy", { usd: 5 });
engine.poolChanged(MINTS.BONK);
// Jupiter's keyless window (5 calls in 10 s): the sale's quote and build come after it
await new Promise((r) => setTimeout(r, 10_000));
const sold = bought && (await trade("sell", { max: true }));
process.exit(bought && sold ? 0 : 1);
