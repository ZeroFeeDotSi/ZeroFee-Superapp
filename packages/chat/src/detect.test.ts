// The chain detector (D55, BITCHAT-RESEARCH §5 and test T1): every chain, by checksum or decoded length; a broken
// checksum is "not an address"; an EVM address is a question (the picker) unless the network is said; NEAR's
// eth-implicit account is NEAR only "on near".
import { test } from "node:test";
import assert from "node:assert/strict";
import { chainFromWords, detect, evmChoices, validMoneroAddress } from "./detect.ts";

const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55's own example
const EVM_BAD = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"; // one letter's case changed
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC's mint, 32 bytes
const BTC_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BTC_TAPROOT = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297"; // BIP-350's example
const BTC_LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"; // the genesis block's
const ZEC = "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs";
const XMR = "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A"; // Monero's general fund
const NEAR_IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

const one = (a: string, on?: string) => {
  const r = detect(a, on);
  assert.ok("ok" in r && r.ok.kind === "one", `${a} ${on ?? ""}: ${JSON.stringify(r)}`);
  const { chain, address } = r.ok as { chain: string; address: string };
  return { chain, address };
};
const not = (a: string, on?: string) => {
  const r = detect(a, on);
  assert.ok("problem" in r, `${a} ${on ?? ""} should not be an address: ${JSON.stringify(r)}`);
  return r.problem.reason;
};

test("every chain by its own check", () => {
  assert.equal(one(SOL).chain, "sol");
  assert.equal(one(BTC_BECH32).chain, "btc");
  assert.equal(one(BTC_TAPROOT).chain, "btc");
  assert.equal(one(BTC_LEGACY).chain, "btc");
  assert.equal(one(ZEC).chain, "zec");
  assert.equal(one(XMR).chain, "xmr");
  assert.ok(validMoneroAddress(XMR));
  assert.equal(one("alice.near").chain, "near");
  assert.equal(one("shop.tg").chain, "near");
  assert.equal(one(NEAR_IMPLICIT).chain, "near");
});

test("a broken checksum or length is not an address, on every chain", () => {
  assert.match(not(EVM_BAD), /mistyped/);
  assert.match(not(BTC_BECH32.slice(0, -1) + "g"), /isn't an address/);
  not(BTC_LEGACY.slice(0, -1) + "b");
  not(ZEC.slice(0, -1) + (ZEC.endsWith("s") ? "t" : "s"));
  not(XMR.slice(0, -1) + "B");
  not("1".repeat(31)); // 31 bytes: not a Solana key
  not("z".repeat(45)); // too long for base58 32 bytes
  assert.match(not(NEAR_IMPLICIT.toUpperCase()), /lower case/);
  not("alice"); // a word with no dot is never an account
  not("0x1234");
});

test("an EVM address with no network is a question, never a guess", () => {
  const r = detect(EVM);
  assert.ok("ok" in r && r.ok.kind === "evm");
  assert.ok(r.ok.chains.includes("base") && r.ok.chains.includes("eth") && r.ok.chains.includes("arb"));
  assert.ok(!r.ok.chains.includes("near"), "NEAR's eth-implicit account is never offered for a bare 0x");
});

test("the network said settles EVM: on <word>, EIP-3770 base:0x…, ERC-681 ethereum:0x…@8453", () => {
  assert.deepEqual(one(EVM, "base"), { chain: "base", address: EVM });
  assert.equal(one(EVM, "BNB Chain").chain, "bsc");
  assert.equal(one(EVM, "arbitrum").chain, "arb");
  assert.equal(one(`base:${EVM}`).chain, "base");
  assert.equal(one(`arb1:${EVM}`).chain, "arb");
  assert.equal(one(`ethereum:${EVM}@8453`).chain, "base");
  assert.equal(one(`ethereum:${EVM}`).chain, "eth", "ERC-681 with no chain id is Ethereum");
  assert.match(not(`ethereum:${EVM}@8453`, "arbitrum"), /for Base, not Arbitrum/);
  assert.match(not(`ethereum:${EVM}@999999`), /network ZeroFee can't send on/);
  assert.match(not(`ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/transfer?address=${EVM}`), /more than a payment/);
});

test("NEAR's eth-implicit account is NEAR only on near; on near a 0x is that account in lower case", () => {
  assert.deepEqual(one(EVM, "near"), { chain: "near", address: EVM.toLowerCase() });
  assert.deepEqual(one(EVM.toLowerCase(), "near"), { chain: "near", address: EVM.toLowerCase() });
  assert.equal(detect(EVM.toLowerCase()).ok?.kind, "evm");
  assert.match(not(SOL, "near"), /isn't a NEAR account/);
  // Security review 2 Nov (Low): a mixed-case 0x with a broken checksum is a typo on NEAR too, never lower-cased into
  // some other eth-implicit account.
  assert.match(not(EVM_BAD, "near"), /mistyped/);
  assert.match(not(`near:${EVM_BAD}`), /mistyped/);
});

test("a network that doesn't fit the address is refused, plainly", () => {
  assert.match(not(SOL, "base"), /isn't a Base address/);
  assert.match(not(EVM, "solana"), /isn't a Solana address/);
  assert.match(not(EVM, "dogecoinz"), /doesn't know a network called "dogecoinz"/);
  assert.match(not("vitalik.eth"), /a \.eth address/);
  assert.equal(one("vitalik.eth", "near").chain, "near", "said NEAR: the person means the NEAR account");
  not(`${EVM} ${SOL}`);
});

test("chain words", () => {
  assert.equal(chainFromWords("Base"), "base");
  assert.equal(chainFromWords("  bnb   chain "), "bsc");
  assert.equal(chainFromWords("Ethereum"), "eth");
  assert.equal(chainFromWords("Solana"), "sol");
  assert.equal(chainFromWords("narnia"), null);
});

test("the picker: only networks where the coin is held; one is picked, several pick nothing", () => {
  const balances = [
    { chain: "base", symbol: "USDC", amount: "18" },
    { chain: "arb", symbol: "USDC", amount: "3" },
    { chain: "eth", symbol: "ETH", amount: "0.4" },
    { chain: "op", symbol: "USDC", amount: "0" },
    { chain: "pol", symbol: "USDC", amount: "9", listed: false },
    { chain: "sol", symbol: "USDC", amount: "42" },
  ];
  const evm = ["eth", "base", "arb", "op", "pol", "bsc"];
  assert.deepEqual(evmChoices(evm, balances, "USDC"), { chains: ["base", "arb"], picked: null });
  assert.deepEqual(evmChoices(evm, balances, "usdc"), { chains: ["base", "arb"], picked: null });
  assert.deepEqual(evmChoices(evm, balances, "ETH"), { chains: ["eth"], picked: "eth" });
  assert.deepEqual(evmChoices(evm, balances, "DAI"), { chains: [], picked: null });
  assert.deepEqual(evmChoices(evm, balances), { chains: ["eth", "base", "arb"], picked: null }, "send money: any coin held");
});
