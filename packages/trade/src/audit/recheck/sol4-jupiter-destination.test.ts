// RECHECK (fix review, e72eddd) of SOL-4: checkJupiterSwap (sol/jupiter.ts:149) reads the route instruction's terms
// (in_amount, quoted_out, slippage, fee) but never its ACCOUNTS. A route built by a misbehaving or compromised Jupiter API
// whose output account is someone else's passes: the wallet's coins (a buy) or the sale's wSOL (a sell) are paid there.
// Asserts the correct behaviour (refused); FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkJupiterSwap, JUP_PROGRAM } from "../../sol/jupiter.ts";
import { ataOf, PROGRAM } from "../../sol/keys.ts";
import { decodeTx, decompile, lookupTableAddresses } from "../../sol/tx.ts";

const rec = JSON.parse(readFileSync(new URL("../../sol/fixtures/jup-routes.json", import.meta.url), "utf8"));
const ATTACKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ROUTE = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];

test("RT-1 (SOL-4 variant): a recorded Jupiter route whose output account is the attacker's is refused", () => {
  let checked = 0;
  for (const r of rec.routes) {
    const t = decodeTx(r.swap.swapTransaction);
    const tables = t.lookups.map((l: { table: string }) => ({ key: l.table, addresses: lookupTableAddresses(Buffer.from(r.alts[l.table], "base64")) }));
    const ixs = decompile(t, tables).instructions;
    const o = { owner: rec.owner, inAmount: BigInt(r.quote.inAmount), quotedOut: BigInt(r.quote.outAmount), bps: r.quote.slippageBps };
    checkJupiterSwap(ixs, o);                                                   // control: the route as Jupiter built it passes
    const evil = ATTACKER && ataOf(ATTACKER, r.quote.outputMint, PROGRAM.token);
    const own = ataOf(rec.owner, r.quote.outputMint, PROGRAM.token);
    const swapped = ixs.map((i) => {
      if (i.programId !== JUP_PROGRAM) return i;
      const isRoute = ROUTE.every((x, k) => i.data[k] === x);
      // route: [3] user destination; shared_accounts_route: [6] destination token account. Any key that is the wallet's own
      // output account is pointed at the attacker's instead
      const at = i.keys.findIndex((k) => k.pubkey === own);
      const idx = at >= 0 ? at : isRoute ? 3 : 6;
      return { ...i, keys: i.keys.map((k, n) => (n === idx ? { ...k, pubkey: evil } : k)) };
    });
    assert.throws(() => checkJupiterSwap(swapped, o), undefined, `route ${r.quote.outputMint.slice(0, 6)}: paying the swap's output to someone else's account is signed`);
    checked++;
  }
  assert.equal(checked, 2);
});
