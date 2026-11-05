// Meteora DBC, Meteora DAMM v2 and Raydium LaunchLab pools decode from their live bytes (fixtures/sol-curves.json,
// captured 21 Oct 2026), and their swap instructions have the account lists and data the live transactions have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase64, hex8 } from "./bytes.ts";
import { EXT, mintExtensions } from "./codec.ts";
import { CURVE, curveSwapIx, decodeCurvePool, launchlabPool } from "./curves.ts";
import { PROGRAM } from "./keys.ts";
import { TEST_OWNER } from "./testing/replay.ts";

const curves = JSON.parse(readFileSync(new URL("./fixtures/sol-curves.json", import.meta.url), "utf8"));
const bytes = (k: string) => fromBase64(curves.rows[k].data);
const row = (k: string) => ({ owner: curves.rows[k].owner, data: bytes(k) });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const BASE = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", QUOTE = "3Lc3SZcUxxbBLsCoHkk9RhJkovjWjRDHxEkLdCNXwAVN";

test("the pools decode from the chain's own bytes: on the curve, quoted in wSOL, vaults and configs where the live transactions have them", () => {
  const { launchlab, dbc } = curves.coins;
  assert.deepEqual(decodeCurvePool(launchlab.pool, row(launchlab.pool), launchlab.mint), {
    venue: "launchlab", pool: launchlab.pool, globalConfig: "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX", platformConfig: "4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4",
    baseVault: "3DNGzoTDM2WWqYYJUZmiPnsjWiZkpsqnx563LQjwxeQV", quoteVault: "4AmgQPaenc6fDNGPPm1GicJWc97qYYF6q37vcLPtmQhD", creator: decodeCurvePool(launchlab.pool, row(launchlab.pool), launchlab.mint)!.creator,
  });
  assert.equal(launchlabPool(launchlab.mint), launchlab.pool, "a LaunchLab pool is derivable: [pool, mint, wSOL]");
  const d = decodeCurvePool(dbc.pool, row(dbc.pool), dbc.mint)!;
  assert.equal(d.venue, "dbc");
  assert.equal(d.config, dbc.config);
  assert.equal(d.baseVault, "GQAF7DnpkvqNTmDsQZfqoMQJzvKhC7SnZ2Ddw2V1HwMN");
  assert.equal(d.quoteVault, "GaNCjNaYvuXw1AoobK6XWTjmuUTxVgSiVqztHbboQXgJ");
});

test("another coin's pool, a graduated DBC pool and a pool quoted in another coin are not ours", () => {
  const { launchlab, dbc } = curves.coins;
  assert.equal(decodeCurvePool(dbc.pool, row(dbc.pool), launchlab.mint), undefined);
  const migrated = bytes(dbc.pool).slice(); migrated[305] = 1;
  assert.equal(decodeCurvePool(dbc.pool, { owner: CURVE.dbc, data: migrated }, dbc.mint), undefined, "graduated: the AMM's now");
  assert.equal(decodeCurvePool(dbc.pool, row(dbc.pool), dbc.mint, () => "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), undefined, "a BONK-quoted curve");
  assert.equal(decodeCurvePool(dbc.pool, null, dbc.mint), undefined);
});

test("DBC swap2 exact in: 15 accounts + the instructions sysvar, no referral; data = discriminator, in, min out, mode 0", () => {
  const { dbc } = curves.coins;
  const b = curveSwapIx(decodeCurvePool(dbc.pool, row(dbc.pool), dbc.mint)!, "buy", TEST_OWNER, dbc.mint, PROGRAM.token, BASE, QUOTE, 5n, 4n);
  assert.equal(b.keys.length, 16);
  assert.equal(hex(b.data), "414b3f4ceb5b5b88" + "0500000000000000" + "0400000000000000" + "00");
  assert.equal(b.keys[3]!.pubkey, QUOTE, "buy: wSOL goes in");
  assert.equal(b.keys[9]!.pubkey, TEST_OWNER);
  assert.equal(b.keys[12]!.pubkey, CURVE.dbc, "no referral: the program id is the placeholder");
});

test("LaunchLab sell_exact_in: 18 accounts, the wallet signs first, share fee 0", () => {
  const { launchlab } = curves.coins;
  const s = curveSwapIx(decodeCurvePool(launchlab.pool, row(launchlab.pool), launchlab.mint)!, "sell", TEST_OWNER, launchlab.mint, PROGRAM.token, BASE, QUOTE, 7n, 6n);
  assert.equal(s.keys.length, 18);
  assert.equal(hex(s.data), "9527de9bd37c981a" + "0700000000000000" + "0600000000000000" + "0000000000000000");
  assert.deepEqual(s.keys[0], { pubkey: TEST_OWNER, isSigner: true, isWritable: true });
});

test("DAMM v2 (where DBC and bags coins land) decodes from its live bytes and sells with swap2 (14 accounts + the sysvar)", () => {
  const { damm2 } = curves.coins;
  const p = decodeCurvePool(damm2.pool, row(damm2.pool), damm2.mint)!;
  assert.equal(p.venue, "damm2");
  assert.equal(p.coinIsA, true);
  const s = curveSwapIx(p, "sell", TEST_OWNER, damm2.mint, PROGRAM.token, BASE, QUOTE, 9n, 8n);
  assert.equal(s.programId, CURVE.damm2);
  assert.equal(s.keys.length, 15);
  assert.equal(s.keys[2]!.pubkey, BASE, "sell: the coin goes in");
  assert.equal(s.keys[6]!.pubkey, damm2.mint, "token A = the coin");
  assert.equal(hex(s.data), "414b3f4ceb5b5b88" + "0900000000000000" + "0800000000000000" + "00");
  assert.equal(hex8(bytes(damm2.pool)), "f19a6d0411b16dbc");
});

test("Token-2022 extensions are read from the mint: a transfer fee (older 250, newer 300 bps) and a hook; a plain mint has none", () => {
  const tlv = (entries: [number, Uint8Array][]) => {
    const parts = entries.map(([t, v]) => { const h = new Uint8Array(4 + v.length); new DataView(h.buffer).setUint16(0, t, true); new DataView(h.buffer).setUint16(2, v.length, true); h.set(v, 4); return h; });
    const out = new Uint8Array(166 + parts.reduce((n, x) => n + x.length, 0));
    out[165] = 1;
    let o = 166; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const fee = new Uint8Array(108); new DataView(fee.buffer).setUint16(88, 250, true); new DataView(fee.buffer).setUint16(106, 300, true);
  const x = mintExtensions(tlv([[18, new Uint8Array(64)], [EXT.transferFeeConfig, fee], [EXT.transferHook, new Uint8Array(64)]]));
  assert.equal(x.transferFeeBps, 300);
  assert.deepEqual([...x.types].sort((a, b) => a - b), [1, 14, 18]);
  assert.equal(x.transferFeeAuthority, false, "no fee authority: its first 32 bytes are zero");
  const raisable = new Uint8Array(108); raisable.set([7], 0);
  assert.equal(mintExtensions(tlv([[EXT.transferFeeConfig, raisable]])).transferFeeAuthority, true, "a fee authority is set");
  assert.deepEqual(mintExtensions(new Uint8Array(82)), { types: new Set(), transferFeeBps: 0, transferFeeAuthority: false });
});
