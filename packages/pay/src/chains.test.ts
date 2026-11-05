import { test } from "node:test";
import assert from "node:assert/strict";
import { EVM_CHAINS, chainByEvmId, chainsForAddress, evmChecksumOk, isNamedNearAccount, isNearAccount } from "./chains.ts";

test("each address is recognised for the chains it can be on", () => {
  assert.deepEqual(chainsForAddress("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"), ["sol"]);
  assert.deepEqual(chainsForAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), ["sol"]);
  assert.deepEqual(chainsForAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"), ["btc"]);
  assert.deepEqual(chainsForAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT"), ["btc"]);
  assert.deepEqual(chainsForAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), ["tron"]);
  assert.deepEqual(chainsForAddress("alex.near"), ["near"]);
  assert.deepEqual(chainsForAddress("alex.zerofee.near"), ["near"]);
  assert.deepEqual(chainsForAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"), ["xrp"]);
  assert.deepEqual(chainsForAddress("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"), ["stellar"]);
  assert.deepEqual(chainsForAddress("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"), ["ton"]);
});

test("an EVM address fits every EVM chain, so the code must say which", () => {
  const all = chainsForAddress("0x2527D02599Ba641c19FEa793cD0F167589a0f10D");
  assert.deepEqual(all, EVM_CHAINS.map((c) => c.id));
  assert.ok(all.includes("base") && all.includes("eth") && all.includes("gnosis"));
});

test("a mistyped EVM checksum is caught", () => {
  assert.ok(evmChecksumOk("0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
  assert.ok(evmChecksumOk("0x2527d02599ba641c19fea793cd0f167589a0f10d"), "all lower carries no checksum");
  assert.ok(!evmChecksumOk("0x2527D02599Ba641c19FEa793cD0F167589a0F10D"), "one letter's case flipped");
  assert.deepEqual(chainsForAddress("0x2527D02599Ba641c19FEa793cD0F167589a0F10D"), []);
});

test("NEAR names follow NEAR's rules", () => {
  assert.ok(isNearAccount("alex.near"));
  assert.ok(isNearAccount("a".repeat(64).replace(/a/g, "f")), "64-hex implicit account");
  assert.ok(!isNearAccount("Alex.near"), "upper case");
  assert.ok(!isNearAccount("alex..near"));
  assert.ok(!isNearAccount("a"));
  assert.ok(!isNamedNearAccount("alex"), "a top-level name isn't something a person types to pay");
});

test("EIP-155 ids map to the right chain", () => {
  assert.equal(chainByEvmId(8453)?.id, "base");
  assert.equal(chainByEvmId(1)?.id, "eth");
  assert.equal(chainByEvmId(100)?.id, "gnosis");
  assert.equal(chainByEvmId(999_999), undefined);
});
