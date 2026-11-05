import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { unsignedEvmTx } from "./evm.ts";
import type { EvmChain } from "./evm.ts";
import { toHex } from "./evm/wire.ts";
import { eip191Hash, eip712Hash, messageBytes, readSignIn, readTypedData, readableText } from "./sign-message.ts";
import type { PlainWords } from "./signer.ts";
import { base64, fromBase58, fromBase64, utf8 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { APP_STORE_NAME } from "./app-store.ts";

/** EIP-712's own example (eips.ethereum.org/EIPS/eip-712, Example.js). */
const MAIL = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    Person: [{ name: "name", type: "string" }, { name: "wallet", type: "address" }],
    Mail: [{ name: "from", type: "Person" }, { name: "to", type: "Person" }, { name: "contents", type: "string" }],
  },
  primaryType: "Mail",
  domain: { name: "Ether Mail", version: "1", chainId: 1, verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" },
  message: { from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" }, to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" }, contents: "Hello, Bob!" },
};

test("EIP-712: the standard's own example hashes to its published digest, also with EIP712Domain left out (ethers)", () => {
  assert.equal(toHex(eip712Hash(readTypedData(MAIL))), "0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2");
  const { EIP712Domain: _, ...types } = MAIL.types;
  assert.equal(toHex(eip712Hash(readTypedData(JSON.stringify({ ...MAIL, types })))), "0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2");
  // The standard's signature with its key keccak256("cow").
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(eip712Hash(readTypedData(MAIL)), keccak_256(utf8("cow")), { prehash: false, format: "recovered" }), "recovered");
  assert.equal(27 + sig.recovery!, 28);
  assert.equal(sig.r, 0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9dn);
  assert.equal(sig.s, 0x07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b91562n);
});

test("EIP-712: a missing field, a wrong type or a number out of range isn't hashed", () => {
  const bad = (message: object) => () => eip712Hash(readTypedData({ ...MAIL, message: { ...MAIL.message, ...message } }));
  assert.throws(bad({ contents: 5 }), /isn't text/);
  assert.throws(bad({ to: { name: "Bob" } }), /Person.wallet is missing/);
  assert.throws(bad({ to: { name: "Bob", wallet: "0x12" } }), /isn't an address/);
  assert.throws(() => eip712Hash(readTypedData({ types: { A: [{ name: "n", type: "uint8" }] }, primaryType: "A", domain: {}, message: { n: 256 } })), /doesn't fit in uint8/);
  assert.throws(() => readTypedData({ ...MAIL, primaryType: "Nope" }), /don't define Nope/);
});

test("EIP-191 personal_sign hashes the prefixed message; hex is bytes, anything else is text", () => {
  assert.equal(toHex(eip191Hash(messageBytes("Hello World"))), "0xa1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2");
  assert.deepEqual(messageBytes("0x48656c6c6f20576f726c64"), utf8("Hello World"));
  assert.equal(readableText(utf8("line one\nline two")), "line one\nline two");
  assert.equal(readableText(new Uint8Array([1, 0, 2])), null, "control bytes aren't words");
  assert.equal(readableText(utf8("pay ‮evil")), null, "a right-to-left override hides what the words say");
});

test("a sign-in message is read, and one that only looks like it isn't", () => {
  const text = "app.example.com wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n\nSign in to Example.\n\nURI: https://app.example.com\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: 2026-10-26T00:00:00Z\nExpiration Time: 2026-10-27T00:00:00Z";
  assert.deepEqual(readSignIn(text, "Ethereum"), { domain: "app.example.com", address: "0x1111111111111111111111111111111111111111", statement: "Sign in to Example.", uri: "https://app.example.com", chainId: "1", expires: "2026-10-27T00:00:00Z" });
  assert.equal(readSignIn("just a message", "Ethereum"), null);
  assert.throws(() => readSignIn("app.example.com wants you to sign in with your Ethereum account: 0x11", "Ethereum"), /standard way/);
});

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SPENDER = "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad";

function setup() {
  const shown: PlainWords[] = [];
  let answer = true;
  const evm = { token: async (_c: string, t: string) => (t === USDC ? { symbol: "USDC", decimals: 6 } : undefined) } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async (w) => (shown.push(w), answer), emit: () => {} });
  return { wallets, shown, say: (yes: boolean) => (answer = yes) };
}
const SITE = { origin: "https://app.example.com" };
const b64 = (text: string) => base64(utf8(text));
const signer = (digest: Uint8Array, signature: string) => {
  const b = fromBase64(signature);
  assert.equal(b.length, 65);
  const sig = secp256k1.Signature.fromBytes(b.subarray(0, 64), "compact").addRecoveryBit(b[64] - 27);
  return toHex(keccak_256(sig.recoverPublicKey(digest).toBytes(false).subarray(1)).subarray(12));
};
/** D143: what a hot key's checks don't pass is refused, named, and nothing is signed. */
const notSigned = (why: RegExp) => (e: any) => e.problem?.code === "security.subwallet.refused" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);
/** notSigned, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const notSignedTrade = (why: RegExp) => (e: any) => e.problem?.code === "security.trade.not-signed" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);
/** A plain sign-in (EIP-4361 / Sign In With Solana), fresh now. */
const signInText = (chain: "Ethereum" | "Solana", domain: string, address: string, o: { chainId?: string; extra?: string } = {}) =>
  `${domain} wants you to sign in with your ${chain} account:\n${address}\n\nSign in to Example.\n\nURI: https://${domain}\nVersion: 1${o.chainId ? `\nChain ID: ${o.chainId}` : ""}\nNonce: abc12345\nIssued At: ${new Date().toISOString()}${o.extra ?? ""}`;

test("personal_sign (audit C1: from the site's own wallet): a plain sign-in only for the site that asked and this wallet, and the signature is this wallet's; anything else is refused (D143)", async () => {
  const { wallets, shown } = setup();
  const w = await wallets.siteFor(SITE, "base");
  const siwe = (domain: string, address: string, extra = "") => signInText("Ethereum", domain, address, { chainId: "8453", extra });

  const refused = async (m: string, origin: string, why: RegExp) => assert.rejects(wallets.signMessage(w.id, b64(m), { origin }, "Browser"), notSigned(why), String(why));
  // another site's page never reaches this site's wallet; a sign-in for another site is refused on this one
  await assert.rejects(wallets.signMessage(w.id, b64(siwe("app.example.com", w.address)), { origin: "https://evil.example" }, "Browser"), (e: any) => e.problem.more === "This wallet approves only for app.example.com.");
  await refused(siwe("evil.example", w.address), SITE.origin, /not app\.example\.com/);
  await refused(siwe("app.example.com", "0x2222222222222222222222222222222222222222"), SITE.origin, /names another wallet/);
  await refused(siwe("app.example.com", w.address, "\nExpiration Time: 2020-01-01T00:00:00Z"), SITE.origin, /expired/);
  await refused(siwe("app.example.com", w.address).replace("Chain ID: 8453", "Chain ID: 1"), SITE.origin, /another network, not this wallet's/);
  await refused("app.example.com wants you to sign in with your Ethereum account:", SITE.origin, /standard way/);
  await refused(siwe("app.example.com", w.address).replace("Sign in to Example.", "Sign in and approve a transfer"), SITE.origin, /more than signing in/);
  await refused(siwe("app.example.com", w.address).replace(/Issued At: .*/, "Issued At: 2026-10-26T00:00:00Z"), SITE.origin, /isn't fresh/);
  await assert.rejects(wallets.signMessage(w.id, base64(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0])), SITE, "Browser"), notSigned(/can't read what app\.example\.com asked to sign/));
  await assert.rejects(wallets.signMessage(w.id, b64("hi"), SITE, "Browser"), notSigned(/words that aren't a sign-in/));
  for (const site of [undefined, "https://app.example.com", { origin: "http://app.example.com" }, { origin: "https://app.example.com/path" }, { origin: "https://user@app.example.com" }]) {
    await assert.rejects(wallets.signMessage(w.id, b64("hi"), site, "Browser"), (e: any) => e.problem.code === "security.request.invalid", JSON.stringify(site));
  }
  await assert.rejects(wallets.signMessage(w.id, "not base64!", SITE, "Browser"), (e: any) => e.problem.code === "security.request.invalid");

  // control: the plain, fresh sign-in for this site and this wallet is signed, by this wallet, with no sheet
  const good = siwe("app.example.com", w.address);
  const r = await wallets.signMessage(w.id, b64(good), SITE, "Browser");
  assert.equal(r.signedIn, true);
  assert.equal(signer(eip191Hash(utf8(good)), r.signature), w.address);
  assert.equal(shown.length, 0);
});

test("typed data is never signed (D143): read first, so another network or a bad shape says so; otherwise refused, named", async () => {
  const { wallets, shown } = setup();
  const w = await wallets.siteFor(SITE, "base");
  const permit = (chainId: number, value: string) => ({
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC },
    message: { owner: w.address, spender: SPENDER, value, nonce: 0, deadline: 1_793_000_000 },
  });
  const moves = notSigned(/^This site asked for an approval ZeroFee won't give without a check\. Nothing was signed\.$/);
  await assert.rejects(wallets.signTypedData(w.id, permit(8453, "5000000"), SITE), moves);
  await assert.rejects(wallets.signTypedData(w.id, permit(8453, ((1n << 256n) - 1n).toString()), SITE), moves);
  // the chain is checked first: another network's says so (control: the same Permit on Base is refused only as above)
  await assert.rejects(wallets.signTypedData(w.id, permit(1, "1"), SITE), (e: any) => /another network, not this wallet's/.test(e.problem.more));
  await assert.rejects(wallets.signTypedData(w.id, { ...permit(8453, "1"), message: { ...permit(8453, "1").message, value: "x" } }, SITE), (e: any) => e.problem.code === "security.subwallet.refused" && !/move your coins/.test(e.problem.more), "a bad shape says its own reason");

  const single = {
    types: { PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }], PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] },
    primaryType: "PermitSingle",
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
    message: { details: { token: USDC, amount: ((1n << 160n) - 1n).toString(), expiration: 281474976710655, nonce: 0 }, spender: SPENDER, sigDeadline: 1_793_000_000 },
  };
  await assert.rejects(wallets.signTypedData(w.id, single, SITE), moves);
  assert.equal(shown.length, 0, "no sheet");
});

test("the card's wallet: a Safe transaction or anything typed is never signed; it answers Gnosis Pay only (control: Gnosis Pay's plain sign-in is signed)", async () => {
  const { wallets, shown } = setup();
  const card = await wallets.create("pay", "gnosis");
  const GP = { origin: "https://app.gnosispay.com" };
  const safeTx = (operation: number) => ({
    types: { SafeTx: ["to:address", "value:uint256", "data:bytes", "operation:uint8", "safeTxGas:uint256", "baseGas:uint256", "gasPrice:uint256", "gasToken:address", "refundReceiver:address", "nonce:uint256"].map((x) => ({ name: x.split(":")[0], type: x.split(":")[1] })) },
    primaryType: "SafeTx",
    domain: { chainId: 100, verifyingContract: "0x6ffb4efabb44261dfd5732e146d85b6e83f3a4e2" },  // generated sample
    message: { to: "0x00000000000000000000000000000000000000aa", value: "1000000000000000000", data: "0x", operation, safeTxGas: 0, baseGas: 0, gasPrice: 0, gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000", nonce: 3 },
  });
  const moves = notSigned(/^This site asked for an approval ZeroFee won't give without a check\. Nothing was signed\.$/);
  await assert.rejects(wallets.signTypedData(card.id, safeTx(0), GP), moves);
  await assert.rejects(wallets.signTypedData(card.id, safeTx(1), GP), moves);
  await assert.rejects(wallets.signTypedData(card.id, { ...MAIL, domain: { ...MAIL.domain, chainId: 100 } }, GP), moves);
  await assert.rejects(wallets.signTypedData(card.id, safeTx(0), SITE), (e: any) => /signs only for Gnosis Pay/.test(e.problem.more), "the card's wallet answers no other site");
  const gpSignIn = signInText("Ethereum", "app.gnosispay.com", card.address, { chainId: "100" });
  await assert.rejects(wallets.signMessage(card.id, b64(gpSignIn), { origin: "https://app.gnosispay.com.evil.example" }, "Browser"), (e: any) => /signs only for Gnosis Pay/.test(e.problem.more));
  const r = await wallets.signMessage(card.id, b64(gpSignIn), GP, "Browser");
  assert.equal(r.signedIn, true);
  assert.equal(signer(eip191Hash(utf8(gpSignIn)), r.signature), card.address);
  assert.equal(shown.length, 0);
});

test("Solana signs a plain sign-in only (bytes that aren't words could be a transaction; plain text is no sign-in); the private balance never signs for a site", async () => {
  const { wallets, shown } = setup();
  const sol = await wallets.siteFor(SITE, "sol");
  await assert.rejects(wallets.signMessage(sol.id, b64("Sign in to Example: nonce 123"), SITE, "Browser"), notSigned(/words that aren't a sign-in/));
  await assert.rejects(wallets.signMessage(sol.id, base64(new Uint8Array([1, 0, 1, 2, 3])), SITE, "Browser"), notSigned(/could be a payment/));
  await assert.rejects(wallets.signMessage(sol.id, b64(`evil.example wants you to sign in with your Solana account:\n${sol.address}\n\nURI: https://evil.example\nVersion: 1`), SITE, "Browser"), notSigned(/not app.example.com/));
  await assert.rejects(wallets.signTypedData(sol.id, MAIL, SITE), (e: any) => e.problem.code === "security.request.invalid");
  // control: the plain sign-in for this site and wallet is signed
  const text = signInText("Solana", "app.example.com", sol.address);
  const r = await wallets.signMessage(sol.id, b64(text), SITE, "Browser");
  assert.equal(r.signedIn, true);
  assert.ok(ed25519.verify(fromBase64(r.signature), utf8(text), fromBase58(sol.address)));
  // audit C1: Solana's shared wallet signs nothing for a site, not even a plain sign-in: only the site's own wallet does
  const chain = await wallets.create("chain", "sol");
  await assert.rejects(wallets.signMessage(chain.id, b64(signInText("Solana", "app.example.com", chain.address)), SITE, "Browser"), (e: any) => e.problem.more === "This site can use only its own wallet.");
  const pocket = await wallets.create("private", "near");
  await assert.rejects(wallets.signMessage(pocket.id, b64(signInText("Solana", "app.example.com", pocket.address)), SITE, "Browser"), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(shown.length, 0);
});

test("a site's plain send off BNB Chain and Robinhood Chain, from its own wallet, fails its outcome check, so it asks on the sheet (decision C: unpriced and outside, Face ID), the cause first, and a no signs nothing (D143 refinement, audit C1; controls: the same send from the person's own flow is refused, named; the site on the shared wallet is refused); the card's wallet answers no other site first", async () => {
  const shown: PlainWords[] = [];
  const evm = { nonce: async () => 0, simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 18n, coinsIn: new Map() }), token: async () => undefined } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async (w) => (shown.push(w), false), emit: () => {} });
  const tx = (chainId: number) => unsignedEvmTx({ chainId, nonce: 0, tip: 1n, fee: 2n, gas: 21000n, to: "0x00000000000000000000000000000000000000aa", value: 1n, data: "0x" });
  /** Asked once, the cause its first warning; then forgotten. */
  const askedFor = (cause: string, faceId: boolean) => {
    assert.equal(shown.length, 1, "the approve sheet asked");
    assert.equal(shown[0]!.warnings[0]?.text?.replace(/\.$/, ""), `${cause}, so ZeroFee asks you`);
    // decision C (product decision, 4 Nov): a send to an outside address with no dollar figure (no price here) counts as past the cap
    assert.equal(shown[0]!.tap, faceId ? undefined : true, faceId ? "a send out, unpriced: Face ID" : "a send out inside the cap: one tap");
    shown.length = 0;
  };
  const own = await wallets.siteFor(SITE, "base");
  assert.deepEqual(await wallets.signTx(own.id, tx(8453), undefined, undefined, "Browser", SITE), { declined: true });
  askedFor("It sends ETH out of the wallet", true); // no ETH price here
  // controls: the same send from the person's own flow is refused by name, never asked; the site on the shared wallet is refused
  const w = await wallets.create("browser", "base");
  await assert.rejects(wallets.signTx(w.id, tx(8453), undefined, undefined, "Browser", undefined, "browser"), notSignedTrade(/^It sends ETH out of the wallet\./));
  await assert.rejects(wallets.signTx(w.id, tx(8453), undefined, undefined, "Browser", SITE), (e: any) => e.problem.more === "This site can use only its own wallet.");
  const card = await wallets.create("pay", "gnosis");
  await assert.rejects(wallets.signTx(card.id, tx(100), undefined, undefined, "Pay", SITE), (e: any) => /signs only for Gnosis Pay/.test(e.problem.more));
  assert.equal(shown.length, 0, "another site: refused before anything is asked");
  // control: on Gnosis Pay's own page the card's wallet gets past the site check to the outcome rule, which asks
  assert.deepEqual(await wallets.signTx(card.id, tx(100), undefined, undefined, "Pay", { origin: "https://app.gnosispay.com" }), { declined: true });
  askedFor("It sends xDAI out of the wallet", false); // 1 wei of xDAI, a dollar each: inside the cap
  await assert.rejects(wallets.signTx(w.id, tx(8453), undefined, undefined, "Browser", { origin: "javascript:alert(1)" }), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal(shown.length, 0);
});

test("audit C1: Solana's shared wallet, and an older one, sign no site's sign-in; the site's own wallet signs a plain sign-in only when Browser's engine asks (control: ZeroFee's own screens are refused)", async () => {
  const { wallets, shown } = setup();
  const sol = await wallets.create("chain", "sol");
  const old = await wallets.create("browser", "sol");
  for (const w of [sol, old]) {
    await assert.rejects(wallets.signMessage(w.id, b64(signInText("Solana", "app.example.com", w.address)), SITE, APP_STORE_NAME), (e: any) => e.problem.more === "This site can use only its own wallet.");
  }
  const own = await wallets.siteFor(SITE, "sol");
  await assert.rejects(wallets.signMessage(own.id, b64(signInText("Solana", "app.example.com", own.address)), SITE), notSigned(/Only a site's own window signs you in/));
  assert.equal((await wallets.signMessage(own.id, b64(signInText("Solana", "app.example.com", own.address)), SITE, APP_STORE_NAME)).signedIn, true);
  assert.equal(shown.length, 0);
});
