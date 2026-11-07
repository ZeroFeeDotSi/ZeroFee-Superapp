// The hot wallets' derivation (hot-keys.ts) against the standards' own test vectors: BIP-32's vectors 1 and 2 (the
// extended private keys as bitcoin/bips bip-0032.mediawiki prints them) and SLIP-10's ed25519 vector 1 (satoshilabs/slips
// slip-0010.md), then ZeroFee's paths and passphrase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mnemonicToSeedSync } from "@scure/bip39";
import { bip32Secp256k1, HOT_PASSPHRASE, hotPath, hotRoot, hotSecret, slip10Ed25519 } from "./hot-keys.ts";
import { seedToWords } from "./recovery-words.ts";
import { fromBase58 } from "./sol/bytes.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
/** The private key inside a BIP-32 xprv (base58check: 4 version, 1 depth, 4 parent, 4 index, 32 chain code, 0x00 + 32 key, 4 check). */
const keyOf = (xprv: string) => hex(fromBase58(xprv).slice(46, 78));
const steps = (path: string) =>
  path === "m" ? [] : path.split("/").slice(1).map((s) => ({ index: Number(s.replace("H", "")), hardened: s.endsWith("H") }));

test("BIP-32 test vector 1: every chain's private key", () => {
  const seed = fromHex("000102030405060708090a0b0c0d0e0f");
  const chains: [string, string][] = [
    ["m", "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi"],
    ["m/0H", "xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7"],
    ["m/0H/1", "xprv9wTYmMFdV23N2TdNG573QoEsfRrWKQgWeibmLntzniatZvR9BmLnvSxqu53Kw1UmYPxLgboyZQaXwTCg8MSY3H2EU4pWcQDnRnrVA1xe8fs"],
    ["m/0H/1/2H", "xprv9z4pot5VBttmtdRTWfWQmoH1taj2axGVzFqSb8C9xaxKymcFzXBDptWmT7FwuEzG3ryjH4ktypQSAewRiNMjANTtpgP4mLTj34bhnZX7UiM"],
    ["m/0H/1/2H/2", "xprvA2JDeKCSNNZky6uBCviVfJSKyQ1mDYahRjijr5idH2WwLsEd4Hsb2Tyh8RfQMuPh7f7RtyzTtdrbdqqsunu5Mm3wDvUAKRHSC34sJ7in334"],
    ["m/0H/1/2H/2/1000000000", "xprvA41z7zogVVwxVSgdKUHDy1SKmdb533PjDz7J6N6mV6uS3ze1ai8FHa8kmHScGpWmj4WggLyQjgPie1rFSruoUihUZREPSL39UNdE3BBDu76"],
  ];
  for (const [path, xprv] of chains) assert.equal(hex(bip32Secp256k1(seed, steps(path))), keyOf(xprv), path);
});

test("BIP-32 test vector 2: every chain's private key", () => {
  const seed = fromHex("fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542");
  const chains: [string, string][] = [
    ["m", "xprv9s21ZrQH143K31xYSDQpPDxsXRTUcvj2iNHm5NUtrGiGG5e2DtALGdso3pGz6ssrdK4PFmM8NSpSBHNqPqm55Qn3LqFtT2emdEXVYsCzC2U"],
    ["m/0", "xprv9vHkqa6EV4sPZHYqZznhT2NPtPCjKuDKGY38FBWLvgaDx45zo9WQRUT3dKYnjwih2yJD9mkrocEZXo1ex8G81dwSM1fwqWpWkeS3v86pgKt"],
    ["m/0/2147483647H", "xprv9wSp6B7kry3Vj9m1zSnLvN3xH8RdsPP1Mh7fAaR7aRLcQMKTR2vidYEeEg2mUCTAwCd6vnxVrcjfy2kRgVsFawNzmjuHc2YmYRmagcEPdU9"],
    ["m/0/2147483647H/1", "xprv9zFnWC6h2cLgpmSA46vutJzBcfJ8yaJGg8cX1e5StJh45BBciYTRXSd25UEPVuesF9yog62tGAQtHjXajPPdbRCHuWS6T8XA2ECKADdw4Ef"],
    ["m/0/2147483647H/1/2147483646H", "xprvA1RpRA33e1JQ7ifknakTFpgNXPmW2YvmhqLQYMmrj4xJXXWYpDPS3xz7iAxn8L39njGVyuoseXzU6rcxFLJ8HFsTjSyQbLYnMpCqE2VbFWc"],
    ["m/0/2147483647H/1/2147483646H/2", "xprvA2nrNbFZABcdryreWet9Ea4LvTJcGsqrMzxHx98MMrotbir7yrKCEXw7nadnHM8Dq38EGfSh6dqA9QWTyefMLEcBYJUuekgW4BYPJcr9E7j"],
  ];
  for (const [path, xprv] of chains) assert.equal(hex(bip32Secp256k1(seed, steps(path))), keyOf(xprv), path);
});

test("SLIP-10 ed25519 test vector 1: every chain's private key", () => {
  const seed = fromHex("000102030405060708090a0b0c0d0e0f");
  const chains: [number[], string][] = [
    [[], "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"],
    [[0], "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3"],
    [[0, 1], "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2"],
    [[0, 1, 2], "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9"],
    [[0, 1, 2, 2], "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662"],
    [[0, 1, 2, 2, 1000000000], "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793"],
  ];
  for (const [path, key] of chains) assert.equal(hex(slip10Ed25519(seed, path)), key, `m/${path.join("'/")}`);
});

test("ZeroFee's paths: one per kind, chain and slot, the standard shape for each chain; the Extension's isn't made", () => {
  assert.equal(hotPath("trade", "sol", 3)!.path, "m/44'/501'/3'/0'");
  assert.equal(hotPath("browser", "sol")!.path, "m/44'/501'/16'/0'");
  assert.equal(hotPath("trade", "bsc", 2)!.path, "m/44'/60'/0'/0/2");
  assert.equal(hotPath("trade", "hood", 0)!.path, "m/44'/60'/1'/0/0");
  assert.equal(hotPath("browser", "eth")!.path, "m/44'/60'/18'/0/0");
  assert.equal(hotPath("pay", "gnosis")!.path, "m/44'/60'/36'/0/0");
  assert.equal(hotPath("trade", "near")!.path, "m/44'/397'/0'");
  assert.equal(hotPath("private", "near")!.path, "m/44'/397'/48'");
  // the NEAR coin wallet (Rhea trades, 3 Nov): its own place, one only
  assert.equal(hotPath("browser", "near")!.path, "m/44'/397'/16'");
  assert.equal(hotPath("browser", "near", 1), null);
  for (const [kind, chain] of [["extension", "sol"], ["private", "sol"], ["pay", "near"], ["trade", "doge"]]) assert.equal(hotPath(kind, chain), null, `${kind}/${chain}`);
  // Every wallet a person can have gets its own path.
  const all = [
    ...["sol", "bsc", "hood"].flatMap((c) => [0, 1, 2, 3, 4].map((s) => hotPath("trade", c, s)!.path)),
    hotPath("trade", "near")!.path, hotPath("private", "near")!.path, hotPath("browser", "near")!.path, hotPath("browser", "sol")!.path,
    ...["eth", "base", "gnosis", "arb"].map((c) => hotPath("browser", c)!.path), hotPath("pay", "gnosis")!.path, hotPath("pay", "sol")!.path,
  ];
  assert.equal(new Set(all).size, all.length);
});

test("the hot root is BIP-39's seed from the words with ZeroFee's passphrase, never the words' plain seed", () => {
  const words = new Uint8Array(32).fill(9);
  const mnemonic = seedToWords(words).join(" ");
  assert.equal(hex(hotRoot(words)), hex(mnemonicToSeedSync(mnemonic, HOT_PASSPHRASE)));
  assert.notEqual(hex(hotRoot(words)), hex(mnemonicToSeedSync(mnemonic)), "the words alone, as another wallet would read them, make other keys");
  const root = hotRoot(words);
  assert.equal(hex(hotSecret(root, "trade", "sol", 1)!), hex(slip10Ed25519(root, [44, 501, 1, 0])));
  assert.equal(hex(hotSecret(root, "trade", "bsc", 1)!), hex(bip32Secp256k1(root, steps("m/44H/60H/0H/0/1"))));
  assert.equal(hotSecret(root, "extension", "sol"), null);
});

test("end to end, the standard paths give the addresses other wallets show for BIP-39's test mnemonic (no passphrase)", async () => {
  const { evmAddress } = await import("./evm.ts");
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const { base58 } = await import("./sol/bytes.ts");
  const seed = mnemonicToSeedSync("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
  assert.equal(evmAddress(bip32Secp256k1(seed, steps("m/44H/60H/0H/0/0"))), "0x9858effd232b4033e47d90003d41ec34ecaeda94");
  assert.equal(base58(ed25519.getPublicKey(slip10Ed25519(seed, [44, 501, 0, 0]))), "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
});

test("SubWallets: with a hot root a new wallet comes from the words at its path; a restore finds used ones on the chains", async () => {
  const { SubWallets } = await import("./subwallets.ts");
  const { MemoryVault } = await import("./vault.ts");
  const { evmAddress } = await import("./evm.ts");
  const { solAddress } = await import("./solana.ts");
  const root = hotRoot(new Uint8Array(32).fill(5));
  const vault = new MemoryVault();
  await vault.put("hot-root", root);
  // Money on Solana slot 2 and a sent transaction on BNB slot 0; nothing anywhere else.
  const sol2 = solAddress(hotSecret(root, "trade", "sol", 2)!);
  const bsc0 = evmAddress(hotSecret(root, "trade", "bsc", 0)!);
  const sol = { balance: async (a: string) => (a === sol2 ? 1_000_000n : 0n) } as any;
  const evm = { nonce: async (_c: string, a: string) => (a === bsc0 ? 3 : 0), read: async () => "0x0", tokenBalance: async () => 0n } as any;
  const w = new SubWallets({ vault, sol, evm, approve: async () => true, emit: () => {} });
  const found = await w.rediscover(["trade", "private", "browser", "pay"]);
  assert.deepEqual(found.map((x) => `${x.kind}/${x.chain}/${x.slot ?? "-"}`).sort(), ["private/near/-", "trade/bsc/0", "trade/near/-", "trade/sol/2"]);
  assert.equal(found.find((x) => x.chain === "sol")!.address, sol2);
  assert.ok(found.every((x) => x.inWords));
  // Nothing asked for: nothing.
  const kid = new SubWallets({ vault, sol, evm, approve: async () => true, emit: () => {} });
  assert.deepEqual(await kid.rediscover([]), []);
  // No root (an older phone): nothing to find, and wallets are made on the phone as before.
  const plain = new SubWallets({ vault: new MemoryVault(), sol, evm, approve: async () => true, emit: () => {} });
  assert.deepEqual(await plain.rediscover(["trade"]), []);
  assert.equal((await plain.create("trade", "sol", 2)).inWords, undefined);
});

test("A12, H05: a restore re-finds every slot on every chain by any use: coins with 0 SOL, a known coin with no gas, any history", async () => {
  const { SubWallets } = await import("./subwallets.ts");
  const { MemoryVault } = await import("./vault.ts");
  const { evmAddress } = await import("./evm.ts");
  const { solAddress } = await import("./solana.ts");
  const root = hotRoot(new Uint8Array(32).fill(7));
  const vault = new MemoryVault();
  await vault.put("hot-root", root);
  const sol3 = solAddress(hotSecret(root, "trade", "sol", 3)!); // a coin, 0 SOL, no history read
  const site = solAddress(hotSecret(root, "browser", "sol", 0)!); // the sites' wallet: emptied, but used
  const bsc4 = evmAddress(hotSecret(root, "trade", "bsc", 4)!); // only USDT, never sent, no BNB
  const base = evmAddress(hotSecret(root, "browser", "base", 0)!); // only USDC on Base
  const card = evmAddress(hotSecret(root, "pay", "gnosis", 0)!); // only EURe
  const looked: string[] = [];
  const sol = {
    balance: async () => 0n,
    tokenAccounts: async (a: string) => (looked.push(a), a === sol3 ? [{ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: 5n }] : []),
    hasHistory: async (a: string) => a === site,
  } as any;
  const held: Record<string, bigint> = {
    [`bsc:${bsc4}:0x55d398326f99059ff775485246999027b3197955`]: 1n,
    [`base:${base}:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`]: 1n,
    [`gnosis:${card}:0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430`]: 1n,
  };
  const evm = {
    nonce: async () => 0,
    read: async (c: string) => { if (c === "hood") throw new Error("Robinhood Chain's nodes are down"); return "0x0"; },
    tokenBalance: async (c: string, t: string, a: string) => held[`${c}:${a}:${t}`] ?? 0n,
  } as any;
  const w = new SubWallets({ vault, sol, evm, approve: async () => true, emit: () => {} });
  const found = (await w.rediscover(["trade", "private", "browser", "pay"])).map((x) => `${x.kind}/${x.chain}/${x.slot ?? "-"}`).sort();
  assert.deepEqual(found, [
    "browser/base/-", "browser/sol/-", "pay/gnosis/-", "private/near/-",
    "trade/bsc/4",
    // Robinhood Chain couldn't be read: every slot is listed, never taken for empty
    "trade/hood/0", "trade/hood/1", "trade/hood/2", "trade/hood/3", "trade/hood/4",
    "trade/near/-", "trade/sol/3",
  ]);
  assert.equal(looked.length, 6, "all 5 Solana slots and the sites' wallet were looked at for token accounts");
  // Asked again (the chain is back), the same wallets come back, never a second copy.
  await w.rediscover(["trade", "private", "browser", "pay"]);
  assert.equal((await w.list()).length, found.length);
});
