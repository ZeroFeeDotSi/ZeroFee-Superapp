// D119 landing 1: the trade-only agent key. Made in the core, kept in the vault, approved once by the main key with an
// end date; it signs trading only, and any money-out action is refused before signing (Hyperliquid's own refusal is
// the testnet proof, tools/perps/testnet-proof.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { MemoryVault } from "../vault.ts";
import { HL_MAINNET, HL_TESTNET, PerpsAgent, approveAgentAction, signApproveAgent } from "./agent.ts";
import { HL_TYPES, hlAddress, l1Digest, userSignedDigest } from "./hl-sign.ts";

const recovers = (digest: Uint8Array, sig: { r: string; s: string; v: number }) =>
  `0x${new secp256k1.Signature(BigInt(sig.r), BigInt(sig.s)).addRecoveryBit(sig.v - 27).recoverPublicKey(digest).toHex(false)}`;
const addrOfPub = (pubHex: string) => pubHex; // compared through the same function below
/** Hyperliquid's meta, as much as the tests need (BTC: 5 size decimals, 40× at most; ETH: 4, 25×). */
const MARKETS = [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }];
const order = { type: "order", orders: [{ a: 0, b: true, p: "100", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }], grouping: "na" };

test("a new agent each time, kept in the core: only its address and end date go out", async () => {
  const vault = new MemoryVault();
  const agent = new PerpsAgent(vault, () => 1_700_000_000_000);
  const a = await agent.make();
  const b = await agent.make();
  assert.match(a.address, /^0x[0-9a-f]{40}$/);
  assert.notEqual(a.address, b.address, "never the same agent again");
  assert.equal(b.validUntilMs, 1_700_000_000_000 + 30 * 86_400_000);
  assert.deepEqual(Object.keys((await agent.current())!).sort(), ["address", "validUntilMs"]);
});

test("the agent signs an order (testnet), and the signature is the agent's own", async () => {
  const vault = new MemoryVault();
  const agent = new PerpsAgent(vault, () => 1_700_000_000_000);
  const { address } = await agent.make();
  const sig = await agent.signTrade(order, 1_700_000_000_001, MARKETS);
  const pub = recovers(l1Digest(order, 1_700_000_000_001, true), sig);
  const kept = (await vault.get("perps-agent-testnet.key.v1"))!;
  assert.equal(kept.length, 32, "the key kept as its raw bytes");
  assert.equal(hlAddress(kept), address);
  assert.ok(!new TextDecoder().decode((await vault.get("perps-agent-testnet.v1"))!).includes("secret"), "the record that may go out holds no key");
  assert.equal(pub, `0x${secp256k1.getPublicKey(kept, false).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`, "signed by the agent's key");
  void addrOfPub;
});

test("the agent never signs money out: withdraw3, usdSend, spotSend, sendAsset, approveAgent are refused before signing (control: an order signs)", async () => {
  const agent = new PerpsAgent(new MemoryVault(), () => 1_700_000_000_000);
  await agent.make();
  for (const type of ["withdraw3", "usdSend", "spotSend", "sendAsset", "approveAgent", "usdClassTransfer", "vaultTransfer"]) {
    await assert.rejects(agent.signTrade({ type, destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1" }, 1), (e: any) => e.problem?.code === "security.request.not-allowed" && /only trades/.test(e.problem.whatHappened), type);
  }
  assert.throws(() => agent.signUserAction("withdraw3"), (e: any) => /can't sign a withdrawal/.test(e.problem?.whatHappened ?? ""));
  assert.ok(await agent.signTrade(order, 2, MARKETS), "control: trading signs");
});

test("an agent past its end date signs nothing; none made, nothing to sign", async () => {
  let t = 1_700_000_000_000;
  const agent = new PerpsAgent(new MemoryVault(), () => t);
  await assert.rejects(agent.signTrade(order, 1, MARKETS), (e: any) => /aren't set up/.test(e.problem?.whatHappened ?? ""));
  await agent.make();
  t += 31 * 86_400_000;
  await assert.rejects(agent.signTrade(order, 2, MARKETS), (e: any) => /run out/.test(e.problem?.whatHappened ?? ""));
});

test("the main key's approval: testnet only, an end date of at most 180 days, signed by the main key", () => {
  const main = secp256k1.utils.randomSecretKey();
  const nonce = 1_700_000_000_000;
  assert.throws(() => approveAgentAction("0x5e9ee1089755c3435139848e47e6635505d5a13a", nonce + 181 * 86_400_000, nonce));
  assert.throws(() => approveAgentAction("0xNOT", nonce + 1, nonce));
  const action = approveAgentAction("0x5e9ee1089755c3435139848e47e6635505d5a13a", nonce + 30 * 86_400_000, nonce);
  assert.deepEqual([action.hyperliquidChain, action.signatureChainId, action.agentName], [HL_TESTNET.chain, "0x66eee", `zerofee valid_until ${nonce + 30 * 86_400_000}`]);
  const sig = signApproveAgent(action, main);
  const t = HL_TYPES.approveAgent;
  const pub = recovers(userSignedDigest(action, t.primaryType, [...t.fields]), sig);
  assert.equal(pub, `0x${secp256k1.getPublicKey(main, false).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`);
  // review M1: checked when it runs: a mainnet approval is never signed, whatever its type says
  for (const bad of [{ ...action, hyperliquidChain: "Mainnet" }, { ...action, signatureChainId: "0xa4b1" }, { ...action, type: "withdraw3" }]) {
    assert.throws(() => signApproveAgent(bad as typeof action, main), (e: any) => /Only an approval of the trading key on Hyperliquid's test network/.test(e.problem?.whatHappened ?? ""));
  }
  // landing 3: a mainnet approval signs only for HL_MAINNET; a testnet one is refused there (and the other way, above)
  const m = approveAgentAction("0x5e9ee1089755c3435139848e47e6635505d5a13a", nonce + 30 * 86_400_000, nonce, HL_MAINNET);
  assert.deepEqual([m.hyperliquidChain, m.signatureChainId], ["Mainnet", "0x66eee"]);
  assert.ok(signApproveAgent(m, main, HL_MAINNET));
  assert.throws(() => signApproveAgent(action, main, HL_MAINNET), (e: any) => /main network/.test(e.problem?.whatHappened ?? ""));
});

test("a damaged record is no agent (never a raw error); forget deletes both", async () => {
  const vault = new MemoryVault();
  await vault.put("perps-agent-testnet.v1", new TextEncoder().encode("{not json"));
  const agent = new PerpsAgent(vault, () => 1_700_000_000_000);
  assert.equal(await agent.current(), null);
  await agent.make();
  await agent.forget();
  assert.equal(await vault.get("perps-agent-testnet.key.v1"), null);
  assert.equal(await agent.current(), null);
});
