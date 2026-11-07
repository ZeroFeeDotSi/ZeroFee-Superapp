// NEAR coins on Rhea (3 Nov): the core builds a NEAR coin trade from Trade's ask, reads what it is held to at one agreed
// block, decodes its own bytes again and holds them to the rules, and a send's answer is "landed" only when the swap
// used all it was given and the coin reached the wallet. Every check here has a control that passes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64 } from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Block, Chain, ChainKey } from "./chain.ts";
import { NEAR_GATE, NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR, sheetSymbol, nearAskRefusal, nearOutcome, nearTradeBytesRefusal, nearTradeTx, swapMsg, type NearTradeAsk } from "./near-trade.ts";
import { buildNearRegister, buildNearTrade, nearPublicKey, signNearBuilt } from "./near-trade-sign.ts";
import { serialize, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import { hotPath } from "./hot-keys.ts";

const secret = new Uint8Array(32).fill(7);
const WALLET = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
const PK = nearPublicKey(secret);
const COIN = "blackdragon.tkn.near";
const NEAR = 10n ** 24n;
const buy: NearTradeAsk = { side: "buy", coin: COIN, poolId: 4276, amountIn: String(NEAR / 4n), minOut: "970000000000000000000000" };
const sell: NearTradeAsk = { side: "sell", coin: COIN, poolId: 4276, amountIn: "1000000000000000000000000", minOut: "240000000000000000000000" };
/** The core's own prices: NEAR $4, the coin $1 (24 places): a buy of 0.25 NEAR for 1 coin, and a sale back, are fair. */
const P = { near: 4, coin: async () => 1 };

test("the NEAR coin wallet has a place of its own in the words: m/44'/397'/16', apart from the cash, the pocket and AgentZero", () => {
  assert.equal(hotPath("browser", "near")!.path, "m/44'/397'/16'");
  assert.deepEqual(new Set(["trade", "browser", "private", "agent"].map((k) => hotPath(k, "near")!.path)).size, 4);
  assert.equal(hotPath("browser", "near", 1), null, "one place only");
});

test("an ask is a trade's shape to the letter (controls: the two good asks)", () => {
  assert.equal(nearAskRefusal(buy), null);
  assert.equal(nearAskRefusal(sell), null);
  assert.match(nearAskRefusal({ ...buy, receiver: "evil.near" })!, /no receiver/);
  assert.match(nearAskRefusal({ ...buy, coin: WNEAR })!, /coin/);
  assert.match(nearAskRefusal({ ...buy, coin: REF_EXCHANGE_ID })!, /coin/);
  assert.match(nearAskRefusal({ ...buy, coin: "Not An Account" })!, /coin/);
  assert.match(nearAskRefusal({ ...buy, minOut: "0" })!, /least/);
  assert.match(nearAskRefusal({ ...buy, amountIn: "1e24" })!, /whole number/);
  assert.match(nearAskRefusal({ ...buy, poolId: 1.5 })!, /pool/);
  assert.match(nearAskRefusal({ ...buy, side: "swap" })!, /side/);
});

const tx = (a: NearTradeAsk, o: { wrapYocto: bigint; registerWnearYocto?: bigint }): UnsignedTx => {
  const b = nearTradeTx(a, { ...o, wallet: WALLET });
  return { signerId: WALLET, publicKey: PK, nonce: 5n, receiverId: b.receiverId, blockHash: "11111111111111111111111111111111", actions: b.actions };
};
const decoded = (t: UnsignedTx) => decodeTransaction(serialize(t));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

test("a buy is wrap.near's register, wrap and one 1-yocto ft_transfer_call to Rhea with the ask's own message; a sale is the coin's one call", () => {
  const t = tx(buy, { wrapYocto: NEAR / 4n, registerWnearYocto: 1_250_000_000_000_000_000_000n });
  assert.equal(t.receiverId, WNEAR);
  assert.deepEqual(t.actions.map((x) => (x.kind === "call" ? x.method : x.kind)), ["storage_deposit", "near_deposit", "ft_transfer_call"]);
  assert.equal(nearTradeBytesRefusal(decoded(t), WALLET, buy), null);
  assert.equal(JSON.parse(swapMsg(buy)).actions[0].min_amount_out, buy.minOut);
  const s = tx(sell, { wrapYocto: 0n });
  assert.equal(s.receiverId, COIN);
  assert.equal(nearTradeBytesRefusal(decoded(s), WALLET, sell), null);
  // a buy with its wNEAR already there wraps nothing
  assert.deepEqual(tx(buy, { wrapYocto: 0n }).actions.map((x) => (x.kind === "call" ? x.method : x.kind)), ["ft_transfer_call"]);
});

test("the bytes are held to the ask: another receiver, another message, a second action, a deposit, another signer: refused (control: the built one)", () => {
  const good = tx(buy, { wrapYocto: NEAR / 4n });
  assert.equal(nearTradeBytesRefusal(decoded(good), WALLET, buy), null, "control");
  const swap = good.actions[good.actions.length - 1]!;
  const withSwap = (args: unknown, deposit = 1n) => ({ ...good, actions: [...good.actions.slice(0, -1), { ...swap, args: enc(args), depositYocto: deposit } as typeof swap] });
  const msg = swapMsg(buy);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: "evil.near", amount: buy.amountIn, msg })), WALLET, buy)!, /swap on Rhea/);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: REF_EXCHANGE_ID, amount: "1", msg })), WALLET, buy)!, /swap on Rhea/);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: REF_EXCHANGE_ID, amount: buy.amountIn, msg: swapMsg({ ...buy, minOut: "1" }) })), WALLET, buy)!, /isn't the trade/);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: REF_EXCHANGE_ID, amount: buy.amountIn, msg: msg.replace('"force":0', '"force":0,"skip_unwrap_near":true') })), WALLET, buy)!, /isn't the trade/);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: REF_EXCHANGE_ID, amount: buy.amountIn, msg, memo: "x" })), WALLET, buy)!, /swap on Rhea/);
  assert.match(nearTradeBytesRefusal(decoded(withSwap({ receiver_id: REF_EXCHANGE_ID, amount: buy.amountIn, msg }, 2n)), WALLET, buy)!, /swap on Rhea/);
  assert.match(nearTradeBytesRefusal(decoded({ ...good, receiverId: "evil.near" }), WALLET, buy)!, /contract/);
  assert.match(nearTradeBytesRefusal(decoded({ ...good, signerId: "someone.near" }), WALLET, buy)!, /isn.t a payment from your NEAR coin wallet/);
  assert.match(nearTradeBytesRefusal(decoded({ ...good, actions: [{ kind: "transfer", yocto: 1n }, ...good.actions] }), WALLET, buy)!, /doesn't need/);
  assert.match(nearTradeBytesRefusal(decoded({ ...good, actions: [{ kind: "call", method: "near_deposit", args: enc({}), gas: 1n, depositYocto: NEAR }, ...good.actions.slice(1)] }), WALLET, buy)!, /wraps more/);
  assert.match(nearTradeBytesRefusal(decoded({ ...good, actions: [{ kind: "call", method: "storage_deposit", args: enc({ account_id: "evil.near", registration_only: true }), gas: 1n, depositYocto: 1n }, ...good.actions] }), WALLET, buy)!, /isn't this wallet's/);
  const s = tx(sell, { wrapYocto: 0n });
  assert.match(nearTradeBytesRefusal(decoded({ ...s, actions: [...s.actions, ...s.actions] }), WALLET, sell)!, /more than one swap/);
  // a register: the coin's own storage_deposit for this wallet, at most 0.01 NEAR
  const reg = (deposit: bigint, account = WALLET) => decoded({ ...good, receiverId: COIN, actions: [{ kind: "call", method: "storage_deposit", args: enc({ account_id: account, registration_only: true }), gas: 1n, depositYocto: deposit }] });
  assert.equal(nearTradeBytesRefusal(reg(1_250_000_000_000_000_000_000n), WALLET, { register: COIN, maxYocto: NEAR_STORAGE_MAX_YOCTO }), null, "control");
  assert.match(nearTradeBytesRefusal(reg(NEAR), WALLET, { register: COIN, maxYocto: NEAR_STORAGE_MAX_YOCTO })!, /coin account/);
  assert.match(nearTradeBytesRefusal(reg(1n, "evil.near"), WALLET, { register: COIN, maxYocto: NEAR_STORAGE_MAX_YOCTO })!, /coin account/);
});

// ── the outcome ──
const b64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const event = (from: string, to: string, amount: string) => `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: from, new_owner_id: to, amount }] })}`;
const answer = (used: string, out: { token: string; amount: string } | null, failure = false) => ({
  status: { SuccessValue: b64(JSON.stringify(used)) },
  receipts_outcome: [
    { outcome: { executor_id: REF_EXCHANGE_ID, logs: ["Swapped …"], status: { SuccessValue: "" } } },
    ...(out ? [{ outcome: { executor_id: out.token, logs: [event(REF_EXCHANGE_ID, WALLET, out.amount)], status: failure ? { Failure: {} } : { SuccessValue: "" } } }] : []),
  ],
});

test("landed only when the swap used all of it and the coin reached the wallet, at least the least (controls: a buy and a sale that landed)", () => {
  assert.deepEqual(nearOutcome(answer(buy.amountIn, { token: COIN, amount: "980000000000000000000000" }), buy, WALLET), { landed: true, got: 980000000000000000000000n });
  assert.deepEqual(nearOutcome(answer(sell.amountIn, { token: WNEAR, amount: String(NEAR / 4n) }), sell, WALLET), { landed: true, got: NEAR / 4n });
  assert.deepEqual(nearOutcome(answer("0", null), buy, WALLET), { refunded: true }, "Rhea refused the swap: the wNEAR went back");
  // pins changed (the audit's MUST, 7 Nov): on a success, a part used, an unreadable answer and a line under the least were
  // "failed"; our read is off there, never the trade: unproven, the balance decides
  assert.deepEqual(nearOutcome(answer("1", null), buy, WALLET), { unproven: true, used: 1n }, "part used: unproven, never failed, the chain's own figure carried");
  assert.deepEqual(nearOutcome({ status: { SuccessValue: "!!" }, receipts_outcome: [] }, buy, WALLET), { unproven: true }, "an answer that can't be read: unproven, never failed");
  // used in full, no transfer line: the wallet's balance on two nodes decides (review M3; Trade's engine reads it), never landed
  assert.deepEqual(nearOutcome(answer(buy.amountIn, null), buy, WALLET), { unproven: true }, "used, but no line says the coin reached the wallet");
  assert.deepEqual(nearOutcome(answer(buy.amountIn, { token: COIN, amount: "1" }), buy, WALLET), { unproven: true }, "a line under the least on a success: unproven, never failed");
  assert.deepEqual(nearOutcome(answer(buy.amountIn, { token: "copy.near", amount: "980000000000000000000000" }), buy, WALLET), { unproven: true }, "another contract's log never counts: never landed on it");
  // pin changed (the audit's MUST, 7 Nov): the transfer's own receipt failed with the input used: the input WAS spent and Ref kept
  // the coin on its side: unproven, kept (was "failed": "nothing was bought" and Try again, a second buy)
  assert.deepEqual(nearOutcome(answer(buy.amountIn, { token: COIN, amount: "980000000000000000000000" }, true), buy, WALLET), { unproven: true, kept: true }, "the transfer's own receipt failed, the input used: kept, never failed");
  assert.ok("failed" in nearOutcome({ status: { Failure: { ActionError: {} } } }, buy, WALLET)!);
  assert.equal(nearOutcome({ status: "Started" }, buy, WALLET), null, "not executed yet");
});

// ── the build, against two nodes that agree (a stub) ──
function chainOf(o: { pool?: unknown; ret?: string; wnear?: string; wnearReg?: unknown; coinReg?: unknown; held?: string; key?: ChainKey | null; bounds?: unknown }): Chain {
  const block: Block = { hash: "11111111111111111111111111111111", height: 100 };
  const views: Record<string, unknown> = {
    [`${REF_EXCHANGE_ID}.get_pool`]: o.pool ?? { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], amounts: [String(10n ** 30n), String(1000n * NEAR)] },
    [`${COIN}.ft_metadata`]: { decimals: 24, symbol: "BLACKDRAGON" },
    [`${REF_EXCHANGE_ID}.get_return`]: o.ret ?? "1000000000000000000000000",
    [`${WNEAR}.ft_balance_of`]: o.wnear ?? "0",
    [`${WNEAR}.storage_balance_of`]: o.wnearReg === undefined ? { total: "1", available: "0" } : o.wnearReg,
    [`${COIN}.storage_balance_of`]: o.coinReg === undefined ? { total: "1", available: "0" } : o.coinReg,
    [`${COIN}.ft_balance_of`]: o.held ?? "1000000000000000000000000",
    [`${COIN}.storage_balance_bounds`]: o.bounds ?? { min: "1250000000000000000000", max: null },
  };
  return {
    network: "mainnet",
    commonBlock: async () => block,
    accessKey: async () => (o.key === undefined ? { handle: PK, nonce: 41n, permission: { kind: "full" } } : o.key),
    view: async (contract: string, method: string) => views[`${contract}.${method}`] ?? null,
  } as unknown as Chain;
}

test("a buy is built at one block from the pool's own answer, wraps only what isn't wrapped, and signs (control); each refusal by name", async () => {
  const b = await buildNearTrade(chainOf({ wnear: String(NEAR / 10n) }), WALLET, PK, buy, P);
  assert.equal(b.tx.nonce, 42n);
  const wrap = b.tx.actions.find((x) => x.kind === "call" && x.method === "near_deposit");
  assert.equal(wrap && wrap.kind === "call" ? wrap.depositYocto : 0n, NEAR / 4n - NEAR / 10n, "only what isn't wNEAR yet");
  const s = signNearBuilt(b, WALLET, secret, buy);
  assert.ok(s.signedTx.length > 100 && s.hash.length > 30);
  await assert.rejects(buildNearTrade(chainOf({ pool: { pool_kind: "STABLE_SWAP", token_account_ids: [COIN, WNEAR] } }), WALLET, PK, buy, P), /doesn't trade this coin/);
  await assert.rejects(buildNearTrade(chainOf({ pool: { pool_kind: "SIMPLE_POOL", token_account_ids: ["copy.near", WNEAR] } }), WALLET, PK, buy, P), /doesn't trade this coin/);
  await assert.rejects(buildNearTrade(chainOf({ ret: "900000000000000000000000" }), WALLET, PK, buy, P), /price moved/, "the least is over the pool's answer");
  await assert.rejects(buildNearTrade(chainOf({ ret: "2000000000000000000000000" }), WALLET, PK, buy, P), /over 5% less/, "a least far under the pool's answer");
  await assert.rejects(buildNearTrade(chainOf({ coinReg: null }), WALLET, PK, buy, P), (e: Error & { code?: string }) => e.code === "near.coin.unregistered");
  await assert.rejects(buildNearTrade(chainOf({ key: null }), WALLET, PK, buy, P), /no NEAR yet/);
  await assert.rejects(buildNearTrade(chainOf({ key: { handle: PK, nonce: 1n, permission: { kind: "function-call", receiverId: "x.near", methods: [], allowanceYocto: null } } }), WALLET, PK, buy, P), /can't sign/);
  const first = await buildNearTrade(chainOf({ wnearReg: null }), WALLET, PK, buy, P);
  assert.equal(first.tx.actions[0]!.kind === "call" && first.tx.actions[0]!.method, "storage_deposit", "a first buy registers the wallet on wrap.near");
});

test("a sale: what the wallet holds, its wNEAR account there, at the pool's answer; signing holds the key to the wallet (controls)", async () => {
  const b = await buildNearTrade(chainOf({ ret: String(NEAR / 4n) }), WALLET, PK, sell, P);
  assert.equal(b.valueYocto, NEAR / 4n, "the pool's answer");
  assert.equal(b.usd, 1, "the cap is charged at the larger of the coin's market value in ($1) and what comes back ($1)");
  assert.ok(signNearBuilt(b, WALLET, secret, sell).signedTx);
  await assert.rejects(buildNearTrade(chainOf({ ret: String(NEAR / 4n), held: "1" }), WALLET, PK, sell, P), /doesn't hold/);
  await assert.rejects(buildNearTrade(chainOf({ ret: String(NEAR / 4n), wnearReg: null }), WALLET, PK, sell, P), (e: Error & { code?: string }) => e.code === "near.wnear.unregistered");
  assert.throws(() => signNearBuilt(b, WALLET, new Uint8Array(32).fill(8), sell), /key doesn't match/);
  assert.throws(() => signNearBuilt(b, WALLET, secret, { ...sell, minOut: "1" }), /isn't the trade/, "signed only for its own ask");
});

test("a coin's account: its own bound, at most 0.00125 NEAR; one already there is refused (controls)", async () => {
  const b = await buildNearRegister(chainOf({ coinReg: null }), WALLET, PK, COIN, 4276, 4);
  assert.ok(signNearBuilt(b, WALLET, secret, { register: COIN }).signedTx);
  await assert.rejects(buildNearRegister(chainOf({}), WALLET, PK, COIN, 4276, 4), /already/);
  await assert.rejects(buildNearRegister(chainOf({ coinReg: null, bounds: { min: String(NEAR) } }), WALLET, PK, COIN, 4276, 4), /too much/);
});

// ── who may ask: Trade (and ZeroFee's own screens) only; no other app sees the NEAR coin wallet ──
import { readFileSync } from "node:fs";
import { DemoCore } from "./demo-core.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

test("only Trade asks for a NEAR coin trade or sees its wallet; Browser, Apps and Chat get neither (control: Trade)", async () => {
  const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
  const chain = new FakeChain();
  NEAR_GATE.open = true;
  after(() => { NEAR_GATE.open = false; });
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: [{ up_to: null, level: "FaceId" }], watchIntervalMs: 60_000 });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  await core.call("account.create");
  const w = await core.call<{ words: string[] }>("recovery.words");
  const words = "ok" in w ? w.ok.words : [];
  await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] });
  const code = (r: { ok?: unknown; problem?: { code: string } }) => ("problem" in r && r.problem ? r.problem.code : "ok");
  for (const app of ["browser", "social", "chat", "wallet"]) {
    assert.equal(code(await core.call("subwallet.near.trade", { app, ask: buy }) as never), "security.request.not-allowed", app);
    assert.equal(code(await core.call("subwallet.near.register", { app, coin: COIN }) as never), "security.request.not-allowed", app);
    assert.equal(code(await core.call("subwallet.near.wallet", { app }) as never), "security.request.not-allowed", app);
  }
  const made = await core.call<{ id: string; address: string }>("subwallet.near.wallet", { app: "trade" });
  assert.ok("ok" in made && /^[0-9a-f]{64}$/.test(made.ok.address), "control: Trade gets it");
  const listed = async (app: string) => { const r = await core.call<{ id: string }[]>("subwallet.list", { app }); return "ok" in r ? r.ok.map((w) => w.id) : []; };
  assert.ok((await listed("trade")).includes(made.ok.id));
  assert.ok(!(await listed("browser")).includes(made.ok.id), "Browser never sees it");
  assert.ok(!(await listed("social")).includes(made.ok.id), "nor the apps in Apps");
  // review L4: nor may another app make it (control: Trade's own, above)
  assert.equal(code(await core.call("subwallet.create", { app: "browser", kind: "browser", chain: "near" }) as never), "security.request.not-allowed");
  // an ask that isn't a trade's shape never reaches the chain
  assert.equal(code(await core.call("subwallet.near.trade", { app: "trade", ask: { ...buy, receiver: "x.near" } }) as never), "security.request.invalid");
});

// ── the review's findings (3 Nov), each with its control ──

test("H1: a pool whose NEAR isn't 20x the trade's is too thin, on a buy and on a sale (control: the deep pool above)", async () => {
  const thin = { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], amounts: [String(10n ** 30n), String(4n * NEAR)] };
  await assert.rejects(buildNearTrade(chainOf({ pool: thin }), WALLET, PK, buy, P), /too thin/);
  await assert.rejects(buildNearTrade(chainOf({ pool: thin, ret: String(NEAR / 4n) }), WALLET, PK, sell, P), /too thin/);
  assert.ok(await buildNearTrade(chainOf({ pool: { ...thin, amounts: [String(10n ** 30n), String(5n * NEAR)] } }), WALLET, PK, buy, P), "control: exactly 20x");
});

test("H1: valued at the core's own market price, never the pool's answer alone: a skewed pool is refused with no sheet on a sale and on a buy (controls: fair)", async () => {
  // the coin is worth $1 at the market, the pool gives back 0.2 NEAR ($0.80): 80 %, under 85 %
  await assert.rejects(buildNearTrade(chainOf({ ret: String(NEAR / 5n) }), WALLET, PK, { ...sell, minOut: "190000000000000000000000" }, P), /much less than the coin is worth/);
  // a dust pool's own price: its 0.0025 NEAR for the whole bag, while the market says $1
  await assert.rejects(buildNearTrade(chainOf({ ret: String(NEAR / 400n) }), WALLET, PK, { ...sell, minOut: String(NEAR / 410n) }, P), /much less than the coin is worth/);
  // a buy: 0.25 NEAR ($1) for coins worth $0.50 at the market
  await assert.rejects(buildNearTrade(chainOf({ ret: String(NEAR / 2n) }), WALLET, PK, { ...buy, minOut: String((NEAR * 48n) / 100n) }, P), /much less of the coin/);
  // the market price taken from the core, never the pool: a fair sale at 0.25 NEAR goes, charged at $1
  assert.equal((await buildNearTrade(chainOf({ ret: String(NEAR / 4n) }), WALLET, PK, sell, P)).usd, 1);
  // and charged at the LARGER side: the coin $1, what comes back $1.20 (a rise since the market read)
  assert.equal((await buildNearTrade(chainOf({ ret: String((NEAR * 3n) / 10n) }), WALLET, PK, { ...sell, minOut: String((NEAR * 29n) / 100n) }, P)).usd, 1.2);
});

test("H1: no market price for the coin (or for NEAR): no dollars, so the one-tap sheet asks (control: priced)", async () => {
  assert.equal((await buildNearTrade(chainOf({ ret: String(NEAR / 4n) }), WALLET, PK, sell, { near: 4, coin: async () => null })).usd, null);
  assert.equal((await buildNearTrade(chainOf({}), WALLET, PK, buy, { near: null, coin: async () => 1 })).usd, null);
  assert.equal((await buildNearTrade(chainOf({}), WALLET, PK, buy, P)).usd, 1);
});

test("speed (5 Nov): NEAR's price is read beside the block and the views, never before them; its answer still sizes the caps (controls: a plain number; a price that fails is no price)", async () => {
  const order: string[] = [];
  let release!: (v: number) => void;
  const slow = new Promise<number>((r) => (release = r));
  const base = chainOf({});
  const chain = { ...base, commonBlock: async () => { order.push("block"); return base.commonBlock(); } } as unknown as Chain;
  const built = buildNearTrade(chain, WALLET, PK, buy, { near: slow.then((v) => { order.push("price"); return v; }), coin: P.coin });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ["block"], "the block is asked while the price is still on its way");
  release(4);
  assert.equal((await built).usd, 1, "the price that came sizes it");
  assert.equal((await buildNearTrade(chainOf({}), WALLET, PK, buy, P)).usd, 1, "control: a number as before");
  assert.equal((await buildNearTrade(chainOf({}), WALLET, PK, buy, { near: Promise.reject(new Error("down")), coin: P.coin })).usd, null, "a failed read: no dollars, so the sheet asks");
});

test("M2: a coin's account opens only for a coin Rhea trades in a plain pool against NEAR; wNEAR's needs none (controls)", async () => {
  await assert.rejects(buildNearRegister(chainOf({ coinReg: null }), WALLET, PK, COIN, undefined, 4), /coin Rhea trades/);
  await assert.rejects(buildNearRegister(chainOf({ coinReg: null, pool: { pool_kind: "SIMPLE_POOL", token_account_ids: ["copy.near", WNEAR] } }), WALLET, PK, COIN, 4276, 4), /coin Rhea trades/);
  await assert.rejects(buildNearRegister(chainOf({ coinReg: null, bounds: { min: "1250000000000000000001" } }), WALLET, PK, COIN, 4276, 4), /too much/, "a hair over 0.00125 NEAR");
  assert.ok((await buildNearRegister(chainOf({ coinReg: null }), WALLET, PK, COIN, 4276, 4)).tx, "control");
});

test("M3: wrap.near's plain transfer line counts (mainnet HV5jNuVr…: a Rhea sale paid in wNEAR, never unwrapped); no line at all is unproven, never landed or failed", () => {
  const plain = { status: { SuccessValue: b64(JSON.stringify(sell.amountIn)) }, receipts_outcome: [{ outcome: { executor_id: WNEAR, status: { SuccessReceiptId: "x" }, logs: [`Transfer 250000000000000000000000 from ${REF_EXCHANGE_ID} to ${WALLET}`] } }] };
  assert.deepEqual(nearOutcome(plain, sell, WALLET), { landed: true, got: NEAR / 4n });
  const toSomeoneElse = { ...plain, receipts_outcome: [{ outcome: { executor_id: WNEAR, status: { SuccessReceiptId: "x" }, logs: [`Transfer 250000000000000000000000 from ${REF_EXCHANGE_ID} to evil.near`] } }] };
  assert.deepEqual(nearOutcome(toSomeoneElse, sell, WALLET), { unproven: true }, "another account's transfer never counts");
  const fromElsewhere = { ...plain, receipts_outcome: [{ outcome: { executor_id: WNEAR, status: { SuccessReceiptId: "x" }, logs: [`Transfer 250000000000000000000000 from evil.near to ${WALLET}`] } }] };
  assert.deepEqual(nearOutcome(fromElsewhere, sell, WALLET), { unproven: true }, "only Ref's transfer to the wallet");
});

test("re-review L: one receipt's transfer is counted once when a coin writes both the plain line and the NEP-297 event (control: either alone counts)", () => {
  const both = { status: { SuccessValue: b64(JSON.stringify(sell.amountIn)) }, receipts_outcome: [{ outcome: { executor_id: WNEAR, status: { SuccessReceiptId: "x" }, logs: [`Transfer 250000000000000000000000 from ${REF_EXCHANGE_ID} to ${WALLET}`, `EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: REF_EXCHANGE_ID, new_owner_id: WALLET, amount: "250000000000000000000000" }] })}`] } }] };
  assert.deepEqual(nearOutcome(both, sell, WALLET), { landed: true, got: NEAR / 4n }, "0.25, never 0.5");
});

test("re-review L: a coin naming itself a listed coin on another contract is 'this coin' on the sheet (controls: the listed one itself, a plain name)", () => {
  assert.equal(sheetSymbol("USDC", "fake-usdc.near"), "this coin");
  assert.equal(sheetSymbol("near", "copy.near"), "this coin", "any case");
  assert.equal(sheetSymbol("RHEA", "token.rhealab.near"), "RHEA", "the listed coin itself");
  assert.equal(sheetSymbol("BLACKDRAGON", COIN), "BLACKDRAGON");
  assert.equal(sheetSymbol(undefined, COIN), "this coin");
});

test("re-review M: a trade's build reads the coin-out balance at its agreed block, given back with the bytes (buy: the coin; sale: wNEAR)", async () => {
  const b = await buildNearTrade(chainOf({}), WALLET, PK, buy, P);
  assert.equal(b.beforeOut, String(NEAR), "the coin's ft_balance_of at the build block");
  const s2 = await buildNearTrade(chainOf({ ret: String(NEAR / 4n), wnear: "7" }), WALLET, PK, sell, P);
  assert.equal(s2.beforeOut, "7", "wNEAR's");
});
