// A kept trade's coin back from Ref's lost and found (the audit's MUST (1), 7 Nov): the NEAR coin wallet's signer allows EXACTLY
// v2.ref-finance.near claim_lostfound { token_id } with 1 yocto, the kept trade's coin, and nothing else new; built only
// while Ref holds some of it for the wallet at an agreed block, and the wallet has the coin's own account. Controls pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Block, Chain } from "./chain.ts";
import { REF_EXCHANGE_ID, WNEAR } from "./near-trade.ts";
import * as rhea from "./near-rhea.ts";
import * as sign from "./near-trade-sign.ts";
import { serialize, type CoreAction, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";

const secret = new Uint8Array(32).fill(7);
const WALLET = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
const PK = sign.nearPublicKey(secret);
const COIN = "blackdragon.tkn.near";
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const claimTx = (token: string) => (rhea as unknown as { rheaClaimTx: (t: string) => { receiverId: string; actions: CoreAction[] } }).rheaClaimTx(token);
const unsigned = (b: { receiverId: string; actions: CoreAction[] }): UnsignedTx => ({ signerId: WALLET, publicKey: PK, nonce: 5n, receiverId: b.receiverId, blockHash: "11111111111111111111111111111111", actions: b.actions });
const decoded = (t: UnsignedTx) => decodeTransaction(serialize(t));
const call = (t: UnsignedTx) => t.actions[0] as Extract<CoreAction, { kind: "call" }>;
const RULE = { rhea: "claim", token: COIN } as unknown as rhea.RheaRule;

test("the claim is exactly Ref's claim_lostfound, 1 yocto, { token_id } alone, the kept trade's coin (control)", () => {
  const t = unsigned(claimTx(COIN));
  assert.equal(t.receiverId, REF_EXCHANGE_ID);
  assert.equal(t.actions.length, 1);
  assert.equal(call(t).method, "claim_lostfound");
  assert.equal(call(t).depositYocto, 1n);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(call(t).args)), { token_id: COIN });
  assert.equal(rhea.rheaBytesRefusal(decoded(t), WALLET, RULE), null, "control");
});

test("a claim with another receiver, method, deposit, coin, any extra arg, a second action or another signer: refused", () => {
  const t = unsigned(claimTx(COIN));
  const c = call(t);
  const bad: [string, UnsignedTx][] = [
    ["another receiver", { ...t, receiverId: "evil.near" }],
    ["another method", { ...t, actions: [{ ...c, method: "withdraw" }] }],
    ["the owner's method", { ...t, actions: [{ ...c, method: "withdraw_owner_token" }] }],
    ["no deposit", { ...t, actions: [{ ...c, depositYocto: 0n }] }],
    ["more deposit", { ...t, actions: [{ ...c, depositYocto: 2n }] }],
    ["another coin", { ...t, actions: [{ ...c, args: enc({ token_id: "other.near" }) }] }],
    ["an extra arg", { ...t, actions: [{ ...c, args: enc({ token_id: COIN, amount: "1" }) }] }],
    ["an account named", { ...t, actions: [{ ...c, args: enc({ token_id: COIN, account_id: "evil.near" }) }] }],
    ["no args", { ...t, actions: [{ ...c, args: enc({}) }] }],
    ["a second action", { ...t, actions: [c, { kind: "transfer", yocto: 1n }] }],
    ["another signer", { ...t, signerId: "someone.near" }],
  ];
  for (const [why, x] of bad) assert.ok(rhea.rheaBytesRefusal(decoded(x), WALLET, RULE), why);
  // nothing else is new: a claim's bytes signed under any other rule are refused, and a withdraw under the claim's
  for (const r of [{ rhea: "withdraw", amount: 1n }, { rhea: "roomBack", amount: 1n }, { rhea: "room" }] as rhea.RheaRule[]) assert.ok(rhea.rheaBytesRefusal(decoded(t), WALLET, r), r.rhea);
  assert.ok(rhea.rheaBytesRefusal(decoded(unsigned(rhea.rheaWithdrawTx(1n))), WALLET, RULE));
});

function chainOf(o: { held?: unknown; reg?: unknown } = {}): Chain {
  const block: Block = { hash: "11111111111111111111111111111111", height: 100 };
  const views: Record<string, unknown> = {
    [`${REF_EXCHANGE_ID}.get_lostfound_token`]: o.held === undefined ? "5000" : o.held,
    [`${COIN}.storage_balance_of`]: o.reg === undefined ? { total: "1", available: "0" } : o.reg,
    [`${COIN}.ft_metadata`]: { decimals: 18, symbol: "BLACKDRAGON" },
  };
  const asked: unknown[] = [];
  return {
    network: "mainnet", asked,
    commonBlock: async () => block,
    accessKey: async () => ({ handle: PK, nonce: 41n, permission: { kind: "full" } }),
    view: async (contract: string, method: string, args: unknown) => { asked.push([contract, method, args]); return views[`${contract}.${method}`] ?? null; },
  } as unknown as Chain;
}
const build = (c: Chain, token = COIN) => (sign as unknown as { buildRheaClaim: (c: Chain, w: string, pk: string, t: string) => Promise<sign.NearBuilt & { held: bigint }> }).buildRheaClaim(c, WALLET, PK, token);

test("the claim is built only while Ref holds some of the coin for the wallet at the agreed block, and signs only as a claim (controls)", async () => {
  const c = chainOf();
  const b = await build(c);
  assert.equal(b.held, 5000n);
  assert.equal(b.usd, 0, "only 1 yocto leaves the wallet: nothing on the caps");
  assert.deepEqual((c as unknown as { asked: unknown[] }).asked.find((x) => (x as string[])[1] === "get_lostfound_token"), [REF_EXCHANGE_ID, "get_lostfound_token", { account_id: WALLET, token_id: COIN }]);
  assert.ok(sign.signNearBuilt(b, WALLET, secret, RULE).signedTx, "control");
  assert.throws(() => sign.signNearBuilt(b, WALLET, secret, { rhea: "claim", token: "other.near" } as unknown as rhea.RheaRule), /isn't your coin coming back/);
  await assert.rejects(build(chainOf({ held: "0" })), /holds none/);
  await assert.rejects(build(chainOf({ held: null })), /holds none/);
  // no coin account: Ref's transfer would fail again, so the coin's account first (Trade opens it, then claims)
  await assert.rejects(build(chainOf({ reg: null })), (e: Error & { code?: string }) => e.code === "near.coin.unregistered");
  assert.notEqual(WNEAR, COIN);
});
