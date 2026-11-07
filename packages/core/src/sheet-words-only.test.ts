// the audit's condition 1 on J2-1/J2-2 (8 Nov): the Check-this rows changed as words only. The same Move, Swap and Send fixtures
// run through the real core's sign path (DevSigner.request: describe, checkIntents, the sheet, signed and sent) give the
// very transaction the chain took on 9b41a3dc0, field for field (its sha-256 pinned from that commit), and a Send's pair
// hash is leg 2's own payload hash, which no sheet word reaches. The sheet's words differ; what is signed does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { PrivateLegRecord } from "./private-route.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const u = (usd: number) => String(Math.round(usd * 100) * 10_000);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** The transaction the chain took, every field but the signature (a post-quantum signature is randomized), hashed. */
const txHash = (tx: unknown) => hex(sha256(new TextEncoder().encode(JSON.stringify(tx, (k, v) => (k === "signature" ? undefined : typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? hex(v) : v)))));

/** One Move fill (or a Swap of one part) through the real sign path, a fixed key: what was signed and the sheet's words. */
async function signFill(safeUsd: number, parts: { to: string; privUsd: number; payUsd: number }[], swap = false) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.fromSeed(new Uint8Array(32).fill(7), "development");
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === `nep141:${USDC}` ? "900000000" : "0") });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("sol.omft.near", "omft", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const step = u(safeUsd);
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon, swapType: "EXACT_INPUT", confidentiality: "basic" },
    quote: { depositAddress: DEPOSIT, amountIn: step, minAmountOut: step, amountOut: String(Number(step) - 70_000), deadline: soon },
  }) };
  const toToken = swap ? "nep141:sol.omft.near" : `nep141:${USDC}`;
  const move = parts.map((p) => ({ recipient: p.to, own: true, units: u(p.privUsd), payUnits: u(p.payUsd), toTokenId: toToken }));
  const leg = { tokenId: `nep141:${USDC}`, payUnits: u(parts[0]!.payUsd), recipient: parts[0]!.to, own: true, toTokenId: toToken, move } as PrivateLegRecord;
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: async (a) => (a === DEPOSIT ? quote : null), quoteKey: TEST_QUOTE_KEY, privateLeg: async () => leg, ownWallets: async () => new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"], [FLOAT, TRADING_BALANCE]]) });
  const out = await signer.request({ receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token: USDC, receiver_id: DEPOSIT, amount: step }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true, ...(swap ? { moveSwap: true } : {}) } as TxRequest);
  return { out, sent: chain.sent, words: shown };
}

// sha-256 of each fixture's sent transaction, computed on 9b41a3dc0 (before J2-1/J2-2) with this very file
const BEFORE = {
  move: "b3b0606b743411395f332bc75225d787c8b547e0a2c7373f18dac834a7cf367a",
  swap: "95b3ed023b614de7f02a722603bd8d7ba352a56d52a1b65d4a447645c8553aaf",
  twoParts: "f288a817a291a8a6dd0a49c072a2a8303d1223d8e38658bcc07693ac2723bdd2",
};

test("the audit's condition 1: the Move, the Swap and a two-wallet Move sign the same transaction as on 9b41a3dc0; only the sheet's words changed (control: another amount is another transaction)", async () => {
  const runs = {
    move: await signFill(60, [{ to: SOLW, privUsd: 0, payUsd: 55.63 }]),
    swap: await signFill(350, [{ to: SOLW, privUsd: 0, payUsd: 300 }], true),
    twoParts: await signFill(150, [{ to: SOLW, privUsd: 0, payUsd: 101.48 }, { to: FLOAT, privUsd: 8.39, payUsd: 0 }]),
  };
  if (process.env.ZF_PRINT_TX) for (const [name, r] of Object.entries(runs)) console.log(`TX ${name} ${r.out.status} ${r.sent[0] ? txHash(r.sent[0]) : "none"}`);
  for (const [name, r] of Object.entries(runs)) {
    assert.equal(r.out.status, "done", `${name}: ${JSON.stringify(r.out).slice(0, 300)}`);
    assert.equal(r.sent.length, 1, name);
    assert.equal(txHash(r.sent[0]), BEFORE[name as keyof typeof BEFORE], `${name}: the signed transaction is 9b41a3dc0's`);
  }
  // the words did change (J2-1): the sheet the fixture saw has the new rows
  assert.ok(runs.move.words[0]!.lines.includes("Private keeps the rest · about $4.30"), runs.move.words[0]!.lines.join(" | "));
  const other = await signFill(70, [{ to: SOLW, privUsd: 0, payUsd: 55.63 }]);
  assert.notEqual(txHash(other.sent[0]), BEFORE.move, "control: another fill is another transaction");
});
