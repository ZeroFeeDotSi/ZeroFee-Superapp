// D119 landing 1: our Hyperliquid signatures are byte-for-byte the official Python SDK's (known answers from
// hyperliquid-python-sdk tests/signing_test.py, read 3 Nov 2026). A wrong field order, domain or source would fail here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex } from "../evm/wire.ts";
import { HL_TYPES, l1Digest, signDigest, userSignedDigest } from "./hl-sign.ts";

const KEY = fromHex("0x0123456789012345678901234567890123456789012345678901234567890123");
/** r and s as numbers (the SDK's own vectors drop leading zeros). */
const same = (got: { r: string; s: string; v: number }, r: string, s: string, v: number, what: string) =>
  assert.deepEqual([BigInt(got.r), BigInt(got.s), got.v], [BigInt(r), BigInt(s), v], what);

test("L1 action (the SDK's dummy action, nonce 0): mainnet and testnet match the Python SDK", () => {
  const action = { type: "dummy", num: 100000000000 }; // float_to_int_for_hashing(1000)
  same(signDigest(l1Digest(action, 0, false), KEY), "0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298", "0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8", 27, "mainnet");
  same(signDigest(l1Digest(action, 0, true), KEY), "0x542af61ef1f429707e3c76c5293c80d01f74ef853e34b76efffcb57e574f9510", "0x17b8b32f086e8cdede991f1e2c529f5dd5297cbe8128500e00cbaf766204a613", 28, "testnet");
});

test("control: a different nonce or the other network is a different signature", () => {
  const action = { type: "dummy", num: 100000000000 };
  assert.notEqual(signDigest(l1Digest(action, 1, true), KEY).r, signDigest(l1Digest(action, 0, true), KEY).r);
  assert.notEqual(signDigest(l1Digest(action, 0, false), KEY).r, signDigest(l1Digest(action, 0, true), KEY).r);
});

test("user-signed withdraw (the SDK's vector, testnet: Testnet / 0x66eee) matches the Python SDK; Mainnet is a different signature (control)", () => {
  const base = { signatureChainId: "0x66eee", destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1687816341423 };
  const t = HL_TYPES.withdraw3;
  same(signDigest(userSignedDigest({ hyperliquidChain: "Testnet", ...base }, t.primaryType, [...t.fields]), KEY), "0x8363524c799e90ce9bc41022f7c39b4e9bdba786e5f9c72b20e43e1462c37cf9", "0x58b1411a775938b83e29182e8ef74975f9054c8e97ebf5ec2dc8d51bfc893881", 28, "testnet withdraw");
  assert.notEqual(BigInt(signDigest(userSignedDigest({ hyperliquidChain: "Mainnet", ...base }, t.primaryType, [...t.fields]), KEY).r), BigInt("0x8363524c799e90ce9bc41022f7c39b4e9bdba786e5f9c72b20e43e1462c37cf9"));
});

test("an order (the SDK's: asset 1, buy 100 at 100, Gtc, nonce 0) matches the Python SDK on mainnet and testnet (review M3: the action we really send)", () => {
  const order = { type: "order", orders: [{ a: 1, b: true, p: "100", s: "100", r: false, t: { limit: { tif: "Gtc" } } }], grouping: "na" };
  same(signDigest(l1Digest(order, 0, false), KEY), "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e", "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e", 28, "mainnet order");
  same(signDigest(l1Digest(order, 0, true), KEY), "0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54", "0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5", 27, "testnet order");
});

test("landing 3: the main key's two money actions have the official field lists (the pinned SDK's own EIP-712 types); Mainnet signs differently from Testnet (control)", async () => {
  const { UsdClassTransferTypes, SpotSendTypes } = await import("@nktkas/hyperliquid/api/exchange");
  const theirs = (t: Record<string, readonly { name: string; type: string }[]>) => Object.entries(t).map(([k, v]) => [k, v.map((f) => [f.name, f.type])]);
  assert.deepEqual(theirs({ [HL_TYPES.usdClassTransfer.primaryType]: HL_TYPES.usdClassTransfer.fields }), theirs(UsdClassTransferTypes as never));
  assert.deepEqual(theirs({ [HL_TYPES.spotSend.primaryType]: HL_TYPES.spotSend.fields }), theirs(SpotSendTypes as never));
  const a = { signatureChainId: "0x66eee", amount: "12.5", toPerp: true, nonce: 1_760_000_000_000 };
  const t = HL_TYPES.usdClassTransfer;
  assert.notEqual(signDigest(userSignedDigest({ hyperliquidChain: "Mainnet", ...a }, t.primaryType, [...t.fields]), KEY).r, signDigest(userSignedDigest({ hyperliquidChain: "Testnet", ...a }, t.primaryType, [...t.fields]), KEY).r);
});
