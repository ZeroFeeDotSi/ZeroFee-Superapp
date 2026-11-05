// B4's quote vectors (src/quote/tests.rs): 1Click's signing scheme (SDK 0.1.26 quoteHash: Ed25519 over the text
// base58(sha256(sorted-key JSON))) applied with a TEST key from a fixed seed, so a test can sign broken quotes. 1Click's
// own key signs only b4-live-quote.json (a live quote, 5 Nov 2026). Run: node tests/fixtures/b4-quotes.mjs > tests/fixtures/b4-quotes.json
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (b) => { let n = BigInt("0x" + (Buffer.from(b).toString("hex") || "0")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x) break; s = "1" + s; } return s; };
const keyOf = (fill) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, fill)]), format: "der", type: "pkcs8" });
const TEST = keyOf(7), OTHER = keyOf(8);
const pub = createPublicKey(TEST).export({ format: "der", type: "spki" }).subarray(12).toString("hex");
const stable = (o) => "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";
const signText = (text, key = TEST) => "ed25519:" + b58(sign(null, Buffer.from(b58(createHash("sha256").update(text).digest())), key));

const T0 = "2026-11-05T12:00:00.000Z";
const base = {
  dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:coin-not-in-band.near", depositType: "INTENTS",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "1000", refundTo: "me.near",
  refundType: "INTENTS", recipient: "me.near", recipientType: "INTENTS", amountIn: "1000", amountInFormatted: "0.001", amountInUsd: "30.500000000000",
  minAmountIn: "1000", amountOut: "30400000", amountOutFormatted: "30.4", amountOutUsd: "30.39", minAmountOut: "30100000",
  depositAddress: "e80205e4052c30ae65998fa9a4d11d4b3f40754e6a41213de0565594be0de014", deadline: "2026-11-05T12:10:00.000Z",
  timeWhenInactive: "2026-11-05T12:10:00.000Z", timeEstimate: 12, refundFee: "0", withdrawFee: "0", timestamp: T0,
};
const v = (fields, drop = []) => { const o = { ...base, ...fields }; for (const k of drop) delete o[k]; const signed = stable(o); return { signed, signature: signText(signed) }; };
const valid = v({});
const out = {
  test_key_hex: pub,
  valid,
  over_limit: v({ amountInUsd: "60", amountOutUsd: "59.7" }),
  recipient_other: v({ recipient: "thief.near" }),
  refund_other: v({ refundTo: "thief.near" }),
  recipient_type: v({ recipientType: "DESTINATION_CHAIN" }),
  refund_type: v({ refundType: "ORIGIN_CHAIN" }),
  deadline_soon: v({ deadline: "2026-11-05T12:01:00.000Z" }),
  referral: v({ referral: "someone" }),
  custom_msg: v({ customRecipientMsg: "hi" }),
  virtual_chain: v({ virtualChainRecipient: "x" }),
  unknown_field: v({ appFees: "x" }),
  dry: v({ dry: true }, ["depositAddress", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"]),
  dry_with_address: v({ dry: true }),
  origin_chain: v({ depositType: "ORIGIN_CHAIN" }),
  zero_usd: v({ amountInUsd: "0.0000000" }),
  bad_usd: v({ amountInUsd: "1e3" }),
  bad_time: v({ timestamp: "2026-11-05 12:00:00Z" }),
  forged: { signed: valid.signed, signature: signText(valid.signed, OTHER) },
  altered: { signed: valid.signed.replace('"amountInUsd":"30.5', '"amountInUsd":"0.5'), signature: valid.signature },
  duplicate_key: (() => { const signed = valid.signed.replace('{"amount":', '{"recipient":"thief.near","amount":'); return { signed, signature: signText(signed) }; })(),
  // round 4 (the audit's conditions): J re-serialized keeps 1Click's signature but not its bytes; dollars at a fraction of a cent
  reordered: { signed: JSON.stringify({ ...base }), signature: valid.signature },
  spaced: { signed: valid.signed.replaceAll('","', '", "'), signature: valid.signature },
  usd_round_up: v({ amountInUsd: "30.5000001" }),
  usd_tenth_cent: v({ amountInUsd: "0.0010000000001" }),
  // round 4 (B4-1): at least 98% back, at most 100 bps slippage
  skim: v({ amountOutUsd: "29.8899999" }),
  out_98: v({ amountOutUsd: "29.89" }),
  slippage_101: v({ slippageTolerance: 101 }),
  slippage_float: v({ slippageTolerance: 99.5 }),
  no_out_usd: v({}, ["amountOutUsd"]),
  usdc_sale: v({ originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", destinationAsset: "nep141:wrap.near", amount: "30500000", amountIn: "30500000" }),
};
console.log(JSON.stringify(out, null, 1));
