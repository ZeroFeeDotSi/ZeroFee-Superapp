// Send S3 (the Send review, 5 Nov): an address on ANY chain 1Click pays that Send can check is reached, privately through
// NEAR Confidential, landing as that chain's own coin; when an address fits several chains, "Which network?" asks.
// Controls: a broken checksum and a chain whose address needs a memo reach nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SNAPSHOT_TOKENS } from "./catalogue-snapshot.ts";
import { NO_TYPO_CHECK, cantSendTo, noTypoCheck, routeLines, sendNetworks, validSendAddress } from "./send-reach.ts";
import { readFileSync } from "node:fs";
import { EVM_SEND_TO, LANDS_AS, OTHER_SEND_TO } from "./send-to.ts";

const at = (address: string) => sendNetworks({ kind: "address", chain: null, candidates: [], address });

test("every chain Send reaches lands as that chain's own coin, as 1Click lists it (the catalogue's own id)", () => {
  for (const [chain, l] of Object.entries(LANDS_AS)) {
    const t = SNAPSHOT_TOKENS.find((x) => x.assetId === l.tokenId);
    assert.ok(t, `${chain}: ${l.tokenId} is 1Click's`);
    assert.equal(t!.blockchain, chain === "near" ? "near" : chain, chain);
    assert.equal(t!.contractAddress === undefined || chain === "near", true, `${chain}: the chain's own coin, not a token`);
  }
  assert.deepEqual(routeLines("btc"), ["Public on Bitcoin."]);
  assert.deepEqual(routeLines("pol"), ["Public on Polygon."]);
});

test("an address's own shape and checksum pick its chain; one that fits several asks which", () => {
  assert.deepEqual(at("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"), ["btc"]);
  assert.deepEqual(at("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"), ["btc"]);
  assert.deepEqual(at("LXmteg8PyzybHdrywScarTEfieHWJbpAHy"), ["ltc"]);
  assert.deepEqual(at("0x7d06e272b5305a4b9D40e872C7950D3437547e3D"), [], "a 0x address with a broken checksum is never taken for Aptos");
  assert.deepEqual(at("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L"), ["doge"]);
  assert.deepEqual(at("TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"), ["tron"]);
  assert.deepEqual(at(`0x${"ab".repeat(32)}`), ["sui", "aptos"], "Sui and Aptos share a shape: asked");
  assert.deepEqual(at("0x7D06e272b5305a4b9D40e872C7950D3437547e3D"), [...EVM_SEND_TO], "a 0x address: every EVM chain, asked");
  assert.deepEqual(at("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"), ["sol"]);
  // controls: a typo in a checksum reaches nothing; nor does a chain left out (a memo, a reserve)
  assert.deepEqual(at("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx"), []);
  assert.deepEqual(at("TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU8"), []);
  assert.deepEqual(at("rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv"), [], "XRP: not reached");
  assert.equal(cantSendTo({ kind: "address", chain: "xrp", candidates: ["xrp"], address: "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv" }, () => "XRP Ledger"), "ZeroFee can't send to XRP Ledger yet.");
  assert.equal(validSendAddress("near", "alice.near"), false, "a NEAR account is checked by NEAR's own rule, not here");
  assert.equal(validSendAddress("btc", "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"), false);
  assert.ok(OTHER_SEND_TO.every((c) => !EVM_SEND_TO.includes(c)));
});

test("QA's MUST: a segwit address is v0 with bech32 (20 or 32 bytes) or v1 with bech32m (32 bytes), nothing else", async () => {
  const { validReceiveAddress } = await import("./addresses.ts");
  // refused: each would lose the coins (anyone can spend, or a typo gets through)
  for (const [a, why] of [
    ["bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5uyze8n", "v0 with a bech32m checksum"],
    ["bc1pqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqm2l7p3", "v1 with an old bech32 checksum"],
    ["bc1pqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h64j2c", "v1 with a 20-byte program"],
    ["bc19qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqfnaxts", "version 5"],
  ]) {
    assert.deepEqual(at(a!), [], why);
    assert.equal(validReceiveAddress("btc", a!), false, `Receive's check too: ${why}`);
  }
  // accepted: P2WPKH, P2WSH, taproot (and BIP-173/350's own vectors), Litecoin's P2WPKH
  for (const a of ["bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5fcj4z3", "bc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqyp0mu0", "bc1pqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqwk0jyn",
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"]) assert.deepEqual(at(a), ["btc"], a);
  assert.deepEqual(at("ltc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5dyg36p"), ["ltc"]);
  // SHOULD (a): the QR form (all capitals) is read, and paid in lower case
  assert.deepEqual(at("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"), ["btc"]);
  const { payeeOf } = await import("./app/money/send-sources.ts");
  assert.deepEqual(payeeOf({ recipient: { kind: "address", chain: null, candidates: [], address: " BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4 " }, network: "btc" }), { kind: "chain", chain: "btc", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" });
  assert.deepEqual(at("bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), [], "mixed case is never read");
  // SHOULD (c): a 3… address is P2SH on Bitcoin and on Litecoin: asked
  assert.deepEqual(at("35MNGPgm2ywdvBZkC1J64ByH2jmWx9oSUw"), ["btc", "ltc"]);
});

test("QA's SHOULD: a first payment to an address with no checksum says a typo loses it (controls: EIP-55, Bitcoin, Solana)", () => {
  assert.equal(noTypoCheck(`0x${"ab".repeat(32)}`, "sui"), true);
  assert.equal(noTypoCheck(`0x${"ab".repeat(32)}`, "aptos"), true);
  assert.equal(noTypoCheck("0x7d06e272b5305a4b9d40e872c7950d3437547e3d", "eth"), true, "lower case skips EIP-55");
  assert.equal(noTypoCheck("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "base"), false, "control: EIP-55 mixed case is checked");
  assert.equal(noTypoCheck("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "btc"), false, "control: bech32 has its checksum");
  assert.equal(noTypoCheck("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", "sol"), false);
  assert.equal(noTypoCheck("0x7d06e272b5305a4b9d40e872c7950d3437547e3d", null), false, "no network picked yet: nothing said");
  assert.equal(NO_TYPO_CHECK, "This address has no typo check. One wrong letter loses the money for good.");
  const form = readFileSync(new URL("./app/money/SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /\{isNew && who\.recipient\.kind === "address" && noTypoCheck\(who\.recipient\.address, network\) && <span className="zf-small" data-testid="send-no-check">\{NO_TYPO_CHECK\}<\/span>\}/);
});

test("a reached chain's address that fails its check says the address has a mistake, not that the chain is closed", () => {
  const r = (chain: string, address: string) => ({ kind: "address" as const, chain, candidates: [chain], address });
  assert.equal(cantSendTo(r("btc", "bc1pqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqm2l7p3"), () => "Bitcoin"), "This Bitcoin address has a mistake. Check each letter.");
  assert.equal(cantSendTo(r("tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU8"), () => "Tron"), "This Tron address has a mistake. Check each letter.");
  // controls: a chain Send doesn't reach keeps its own words; a good address says nothing
  assert.equal(cantSendTo(r("xrp", "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv"), () => "XRP Ledger"), "ZeroFee can't send to XRP Ledger yet.");
  assert.equal(cantSendTo(r("btc", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), () => "Bitcoin"), null);
});
