// The Solana copy's tools (tools/fork/sol): the copy is only ever this Mac's (every CLI call names it and the copy's own
// key, never the CLI's config, which may point at mainnet and a real key), and Jupiter's stand-in holds every quote to
// the pools the copy cloned and refuses a swap through an account the copy doesn't hold. No network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heldQuote, walletAccounts, PORT, COPY_RPC, DEXES } from "./jup.ts";
import { forkTable } from "../../../packages/core/src/fork.ts";
import { ataOf, PROGRAM } from "../../../packages/trade/src/sol/keys.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("the stand-in is the seam's \"jup\" entry and talks only to the copy's node", () => {
  assert.equal(`http://127.0.0.1:${PORT}`, forkTable().jup);
  assert.equal(COPY_RPC, forkTable().sol);
  assert.match(read("./jup.ts"), /\.listen\(PORT, "127\.0\.0\.1"/, "loopback only");
});

test("every quote is held to the copy's pools: one hop, the cloned DEXes (control: the asked amount and coins pass through)", () => {
  const u = new URL(heldQuote("?inputMint=A&outputMint=B&amount=7&slippageBps=50&restrictIntermediateTokens=true"));
  assert.equal(u.origin + u.pathname, "https://lite-api.jup.ag/swap/v1/quote");
  assert.equal(u.searchParams.get("onlyDirectRoutes"), "true");
  assert.equal(u.searchParams.get("dexes"), DEXES);
  assert.equal(u.searchParams.get("restrictIntermediateTokens"), null);
  for (const [k, v] of [["inputMint", "A"], ["outputMint", "B"], ["amount", "7"], ["slippageBps", "50"]]) assert.equal(u.searchParams.get(k), v);
});

test("only the wallet and its own coin accounts may be missing from the copy (control: a pool may not)", () => {
  const owner = "FZ9BFkJt1sTpcrjcNQ3KVa2PZ6AzXP2XwkGFiNbrSBEd", BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool = "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv";  // generated sample
  const own = walletAccounts(owner, [BONK, pool]);
  assert.ok(own.has(owner) && own.has(ataOf(owner, BONK, PROGRAM.token)) && own.has(ataOf(owner, BONK, PROGRAM.token2022)));
  assert.ok(!own.has(pool) && !own.has(BONK));
  assert.match(read("./jup.ts"), /const missing = all\.filter\(\(a, i\) => !rows\[i\] && !own\.has\(a\)\);\n  if \(missing\.length\) return null;/);
});

test("the scripts name the copy and its own key on every CLI call; nothing reads the CLI's config (control: they check their ports first)", () => {
  for (const f of ["./start.sh", "./fund.sh"]) {
    for (const line of code(f).split("\n").filter((l) => /"\$BIN\/(solana|spl-token)"/.test(l))) {
      assert.match(line, /--url "\$RPC"/, `${f}: ${line}`);
      assert.match(line, /--keypair "\$HOME_DIR\/faucet\.json"|--fee-payer "\$HOME_DIR\/faucet\.json"/, `${f}: ${line}`);
    }
  }
  assert.match(code("./fund.sh"), /^RPC=http:\/\/127\.0\.0\.1:8899$/m);
  const start = code("./start.sh");
  assert.match(start, /^RPC=http:\/\/127\.0\.0\.1:8899$/m);
  assert.match(start, /for port in 8899 8900 9900 8897; do/);
  assert.match(start, /--reset --quiet --ledger "\$HOME_DIR\/ledger" --rpc-port 8899 --faucet-port 9900 --bind-address 127\.0\.0\.1 --url "\$SOURCE"/);
  // stop.sh stops only what start.sh started, by its own pids and names
  const stop = code("./stop.sh");
  assert.match(stop, /grep -q solana-test-val/);
  assert.match(stop, /grep -q "fork\/sol\/jup\.ts"/);
  assert.doesNotMatch(stop, /pkill|killall/);
});
