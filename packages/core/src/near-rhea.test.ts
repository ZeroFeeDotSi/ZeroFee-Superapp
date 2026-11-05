// NEAR coins under 2 s (near-rhea.ts): a trade is ONE swap call on the wallet's own Rhea balance; "Ready NEAR for trading"
// puts the wallet's NEAR into its own Rhea account; Put away takes it back out. The core builds each, decodes its own bytes
// again and holds them to the rule; anything else is refused. Every check has a control that passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Block, Chain } from "./chain.ts";
import { NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR, type NearTradeAsk } from "./near-trade.ts";
import { RHEA_COIN_ROOM_YOCTO, RHEA_HELD_LINE, RHEA_ROOM_YOCTO, rheaBytesRefusal, rheaDepositTx, rheaRoomBackTx, rheaRoomTx, rheaSwapArgs, rheaSwapTx, rheaWithdrawTx } from "./near-rhea.ts";
import { buildRheaAdd, buildRheaSwap, buildRheaWithdraw, nearPublicKey, rheaAccountOf, signNearBuilt } from "./near-trade-sign.ts";
import { serialize, type CoreAction, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";

const secret = new Uint8Array(32).fill(7);
const WALLET = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
const PK = nearPublicKey(secret);
const COIN = "blackdragon.tkn.near";
const NEAR = 10n ** 24n;
const buy: NearTradeAsk = { side: "buy", coin: COIN, poolId: 4276, amountIn: String(NEAR / 4n), minOut: "970000000000000000000000" };
const sell: NearTradeAsk = { side: "sell", coin: COIN, poolId: 4276, amountIn: "1000000000000000000000000", minOut: "240000000000000000000000" };
const P = { near: 4, coin: async () => 1 };
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const unsigned = (b: { receiverId: string; actions: CoreAction[] }, signerId = WALLET): UnsignedTx => ({ signerId, publicKey: PK, nonce: 5n, receiverId: b.receiverId, blockHash: "11111111111111111111111111111111", actions: b.actions });
const decoded = (t: UnsignedTx) => decodeTransaction(serialize(t));
const call = (t: UnsignedTx, i = 0) => t.actions[i] as Extract<CoreAction, { kind: "call" }>;
const withArgs = (t: UnsignedTx, args: unknown, o: { method?: string; deposit?: bigint } = {}): UnsignedTx => ({ ...t, actions: [{ ...call(t), args: enc(args), ...(o.method ? { method: o.method } : {}), ...(o.deposit !== undefined ? { depositYocto: o.deposit } : {}) }] });

test("a trade is ONE swap call on Rhea, 1 yocto, the ask's own action and nothing else (controls: a buy and a sale)", () => {
  for (const a of [buy, sell]) {
    const t = unsigned(rheaSwapTx(a));
    assert.equal(t.receiverId, REF_EXCHANGE_ID);
    assert.equal(t.actions.length, 1);
    assert.equal(call(t).method, "swap");
    assert.equal(call(t).depositYocto, 1n);
    assert.equal(rheaBytesRefusal(decoded(t), WALLET, { rhea: "swap", ask: a }), null, "control");
  }
  const args = JSON.parse(rheaSwapArgs(buy));
  assert.deepEqual(args, { actions: [{ pool_id: 4276, token_in: WNEAR, token_out: COIN, amount_in: buy.amountIn, min_amount_out: buy.minOut }] });
  assert.deepEqual(JSON.parse(rheaSwapArgs(sell)).actions[0].token_in, COIN);
});

test("the swap's bytes are held to the ask: another least, a second action, a referral, another pool, a deposit, another contract or signer: refused", () => {
  const good = unsigned(rheaSwapTx(buy));
  const r = { rhea: "swap" as const, ask: buy };
  const act = JSON.parse(rheaSwapArgs(buy)).actions[0];
  assert.equal(rheaBytesRefusal(decoded(good), WALLET, r), null, "control");
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [{ ...act, min_amount_out: "1" }] })), WALLET, r)!, /isn't the trade/);
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [act, { ...act, pool_id: 9 }] })), WALLET, r)!, /isn't the trade/, "a second hop");
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [act], referral_id: "evil.near" })), WALLET, r)!, /isn't the trade/, "a referral takes a cut");
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [{ ...act, pool_id: 9 }] })), WALLET, r)!, /isn't the trade/);
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [act] }, { deposit: NEAR })), WALLET, r)!, /one swap/);
  assert.match(rheaBytesRefusal(decoded(withArgs(good, { actions: [act] }, { method: "swap_by_output" })), WALLET, r)!, /one swap/);
  assert.match(rheaBytesRefusal(decoded({ ...good, receiverId: "evil.near" }), WALLET, r)!, /contract/);
  assert.match(rheaBytesRefusal(decoded({ ...good, signerId: "someone.near" }), WALLET, r)!, /your NEAR coin wallet/);
  assert.match(rheaBytesRefusal(decoded({ ...good, actions: [...good.actions, { kind: "transfer", yocto: 1n }] }), WALLET, r)!, /more than one/);
  // a withdraw signed in a swap's place is never a swap
  assert.match(rheaBytesRefusal(decoded(unsigned(rheaWithdrawTx(1n))), WALLET, r)!, /one swap/);
});

test("Ready NEAR for trading: the wallet's room on Rhea (exactly 0.05 NEAR, its own account) and its NEAR in with msg \"\" (controls)", () => {
  const room = unsigned(rheaRoomTx(WALLET));
  assert.equal(rheaBytesRefusal(decoded(room), WALLET, { rhea: "room" }), null, "control");
  assert.equal(call(room).depositYocto, RHEA_ROOM_YOCTO);
  assert.match(rheaBytesRefusal(decoded(withArgs(room, { account_id: "evil.near", registration_only: false })), WALLET, { rhea: "room" })!, /room/, "someone else's account");
  assert.match(rheaBytesRefusal(decoded(withArgs(room, { account_id: WALLET, registration_only: false }, { deposit: 10n * NEAR })), WALLET, { rhea: "room" })!, /room/, "more than the room");

  const amount = NEAR;
  const dep = unsigned(rheaDepositTx(amount, { wrapYocto: amount / 2n, registerWnearYocto: NEAR_STORAGE_MAX_YOCTO, wallet: WALLET }));
  const r = { rhea: "deposit" as const, amount };
  assert.equal(dep.receiverId, WNEAR);
  assert.deepEqual(dep.actions.map((x) => (x.kind === "call" ? x.method : x.kind)), ["storage_deposit", "near_deposit", "ft_transfer_call"]);
  assert.equal(rheaBytesRefusal(decoded(dep), WALLET, r), null, "control");
  const last = dep.actions.length - 1;
  const withLast = (args: unknown) => ({ ...dep, actions: [...dep.actions.slice(0, last), { ...call(dep, last), args: enc(args) }] });
  assert.match(rheaBytesRefusal(decoded(withLast({ receiver_id: REF_EXCHANGE_ID, amount: amount.toString(), msg: JSON.stringify({ force: 0, actions: [] }) })), WALLET, r)!, /going into Rhea/, "a swap message in a deposit");
  assert.match(rheaBytesRefusal(decoded(withLast({ receiver_id: "evil.near", amount: amount.toString(), msg: "" })), WALLET, r)!, /going into Rhea/);
  assert.match(rheaBytesRefusal(decoded(withLast({ receiver_id: REF_EXCHANGE_ID, amount: "2", msg: "" })), WALLET, r)!, /going into Rhea/);
  assert.match(rheaBytesRefusal(decoded({ ...dep, actions: [{ kind: "call", method: "near_deposit", args: enc({}), gas: 1n, depositYocto: 2n * NEAR }, call(dep, last)] }), WALLET, r)!, /wraps more/);
  assert.match(rheaBytesRefusal(decoded({ ...dep, actions: [{ kind: "transfer", yocto: 1n }, call(dep, last)] }), WALLET, r)!, /doesn't need/);
  assert.match(rheaBytesRefusal(decoded({ ...dep, receiverId: COIN }), WALLET, r)!, /contract/);
});

test("Put away's first step: the wallet's wNEAR out of Rhea to itself, never unwrapped, exactly the amount (controls)", () => {
  const w = unsigned(rheaWithdrawTx(NEAR));
  const r = { rhea: "withdraw" as const, amount: NEAR };
  assert.equal(rheaBytesRefusal(decoded(w), WALLET, r), null, "control");
  assert.match(rheaBytesRefusal(decoded(withArgs(w, { token_id: COIN, amount: NEAR.toString(), unregister: false, skip_unwrap_near: true })), WALLET, r)!, /coming back/);
  assert.match(rheaBytesRefusal(decoded(withArgs(w, { token_id: WNEAR, amount: NEAR.toString(), unregister: true, skip_unwrap_near: true })), WALLET, r)!, /coming back/);
  assert.match(rheaBytesRefusal(decoded(withArgs(w, { token_id: WNEAR, amount: "1", unregister: false, skip_unwrap_near: true })), WALLET, r)!, /coming back/);
  assert.match(rheaBytesRefusal(decoded(withArgs(w, { token_id: WNEAR, amount: NEAR.toString(), unregister: false, skip_unwrap_near: true, receiver_id: "evil.near" })), WALLET, r)!, /coming back/);
});

// ── the builds, against two nodes that agree (a stub) ──
function chainOf(o: { deposits?: Record<string, string> | null; storage?: unknown; ret?: string; balance?: bigint; wnear?: string; wnearReg?: unknown } = {}): Chain {
  const block: Block = { hash: "11111111111111111111111111111111", height: 100 };
  const views: Record<string, unknown> = {
    [`${REF_EXCHANGE_ID}.get_pool`]: { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], amounts: [String(10n ** 30n), String(1000n * NEAR)] },
    [`${COIN}.ft_metadata`]: { decimals: 24, symbol: "BLACKDRAGON" },
    [`${REF_EXCHANGE_ID}.get_return`]: o.ret ?? "1000000000000000000000000",
    [`${REF_EXCHANGE_ID}.get_deposits`]: o.deposits === undefined ? { [WNEAR]: String(NEAR), [COIN]: "2000000000000000000000000" } : o.deposits ?? {},
    [`${REF_EXCHANGE_ID}.get_user_storage_state`]: o.storage === undefined ? { deposit: String(RHEA_ROOM_YOCTO), usage: "3980000000000000000000" } : o.storage,
    [`${WNEAR}.ft_balance_of`]: o.wnear ?? "0",
    [`${WNEAR}.storage_balance_of`]: o.wnearReg === undefined ? { total: "1", available: "0" } : o.wnearReg,
  };
  return {
    network: "mainnet",
    commonBlock: async () => block,
    account: async () => ({ balanceYocto: o.balance ?? 2n * NEAR, storageBytes: 200n }),
    accessKey: async () => ({ handle: PK, nonce: 41n, permission: { kind: "full" } }),
    view: async (contract: string, method: string) => views[`${contract}.${method}`] ?? null,
  } as unknown as Chain;
}

test("a swap is built at one block from the wallet's Rhea balance and the pool's own answer, and signs only as its own ask (control)", async () => {
  const b = await buildRheaSwap(chainOf(), WALLET, PK, buy, P);
  assert.equal(b.tx.receiverId, REF_EXCHANGE_ID);
  assert.equal(b.tx.nonce, 42n);
  assert.equal(b.beforeOut, "2000000000000000000000000", "the coin out's Rhea balance at the block");
  assert.equal(b.usd, 1, "the cap is charged as before");
  assert.ok(signNearBuilt(b, WALLET, secret, { rhea: "swap", ask: buy }).signedTx.length > 100);
  assert.throws(() => signNearBuilt(b, WALLET, secret, { rhea: "swap", ask: { ...buy, minOut: "1" } }), /isn't the trade/);
  assert.throws(() => signNearBuilt(b, WALLET, secret, buy), /contract a NEAR trade doesn't use/, "never signed by the earlier shape's rule");
  const s = await buildRheaSwap(chainOf({ ret: String(NEAR / 4n) }), WALLET, PK, sell, P);
  assert.equal(s.beforeOut, String(NEAR));
});

test("a swap is refused by name: never readied, Rhea's balance short, no room for a new coin; the same pool and price checks as before (controls)", async () => {
  await assert.rejects(buildRheaSwap(chainOf({ storage: null, deposits: null }), WALLET, PK, buy, P), (e: Error & { code?: string }) => e.code === "near.rhea.unregistered");
  await assert.rejects(buildRheaSwap(chainOf({ deposits: { [WNEAR]: "1" } }), WALLET, PK, buy, P), /less than this buy/);
  await assert.rejects(buildRheaSwap(chainOf({ deposits: { [WNEAR]: String(NEAR) }, ret: String(NEAR / 4n) }), WALLET, PK, sell, P), /doesn't hold/);
  // a new coin with too little room: Trade tops it up (code), never a swap Ref would refuse
  const tight = { deposit: "5000000000000000000000", usage: String(5_000_000_000_000_000_000_000n - RHEA_COIN_ROOM_YOCTO + 1n) };
  await assert.rejects(buildRheaSwap(chainOf({ deposits: { [WNEAR]: String(NEAR) }, storage: tight }), WALLET, PK, buy, P), (e: Error & { code?: string }) => e.code === "near.rhea.room");
  assert.ok(await buildRheaSwap(chainOf({ deposits: { [WNEAR]: String(NEAR), [COIN]: "0" }, storage: tight }), WALLET, PK, buy, P), "control: a coin it held before has its room");
  await assert.rejects(buildRheaSwap(chainOf({ ret: "900000000000000000000000" }), WALLET, PK, buy, P), /price moved/);
  await assert.rejects(buildRheaSwap(chainOf({ ret: "2000000000000000000000000" }), WALLET, PK, buy, P), /over 5% less/);
});

test("Ready NEAR: room first when there's none (nonce n), then all it can move in (nonce n+1), past its storage and gas; with room, one deposit (controls)", async () => {
  const first = await buildRheaAdd(chainOf({ storage: null, deposits: null, wnearReg: null, wnear: String(NEAR / 10n) }), WALLET, PK, "all");
  assert.ok(first.room && first.deposit);
  assert.equal(first.room!.tx.nonce, 42n);
  assert.equal(first.deposit!.tx.nonce, 43n);
  // 2 NEAR less its storage (200 bytes), the 0.05 it keeps, the room, wNEAR's account and the 1 yocto; plus its 0.1 wNEAR
  const want = 2n * NEAR - (200n * 10n ** 19n + 50_000_000_000_000_000_000_000n + RHEA_ROOM_YOCTO + NEAR_STORAGE_MAX_YOCTO + 1n) + NEAR / 10n;
  assert.equal(first.amount, want);
  assert.equal(signNearBuilt(first.room!, WALLET, secret, { rhea: "room" }).hash.length > 30, true);
  assert.ok(signNearBuilt(first.deposit!, WALLET, secret, { rhea: "deposit", amount: want }).signedTx);
  assert.throws(() => signNearBuilt(first.deposit!, WALLET, secret, { rhea: "deposit", amount: want + 1n }), /going into Rhea/);
  const again = await buildRheaAdd(chainOf(), WALLET, PK, NEAR / 2n);
  assert.equal(again.room, undefined, "room already there");
  assert.equal(again.deposit!.tx.nonce, 42n);
  const roomOnly = await buildRheaAdd(chainOf({ storage: { deposit: "5000000000000000000000", usage: "4000000000000000000000" } }), WALLET, PK, 0n);
  assert.ok(roomOnly.room && !roomOnly.deposit, "\"0\": only the room for a new coin");
  await assert.rejects(buildRheaAdd(chainOf(), WALLET, PK, 3n * NEAR), /doesn't have that much/);
});

test("Put away's withdraw: at most the wallet's wNEAR in Rhea, to its own wNEAR account (controls)", async () => {
  const b = await buildRheaWithdraw(chainOf(), WALLET, PK, NEAR / 2n);
  assert.ok(signNearBuilt(b, WALLET, secret, { rhea: "withdraw", amount: NEAR / 2n }).signedTx);
  await assert.rejects(buildRheaWithdraw(chainOf(), WALLET, PK, 2n * NEAR), /less than that/);
  await assert.rejects(buildRheaWithdraw(chainOf({ wnearReg: null }), WALLET, PK, NEAR / 2n), (e: Error & { code?: string }) => e.code === "near.wnear.unregistered");
});

test("Rhea's account read: balances kept (a held coin at 0 too), room = paid less used; none: not open (controls)", () => {
  const a = rheaAccountOf({ [WNEAR]: "5", [COIN]: "0", bad: "x" }, { deposit: "100", usage: "40" });
  assert.deepEqual(a, { open: true, deposits: { [WNEAR]: 5n, [COIN]: 0n }, roomYocto: 60n });
  assert.deepEqual(rheaAccountOf(null, null), { open: false, deposits: {}, roomYocto: 0n });
});

// ── the doors (near-coin.ts), against a stateful stub of NEAR: what each send does to the wallet and its Rhea account ──
import { base64ToBytes } from "@fastnear/utils";
import { NEAR_GATE } from "./near-gate.ts";
import { nearCoinBalance, nearPay, nearRheaAdd, nearSpendable, type NearCoinCtx } from "./near-coin.ts";

function world(o: { rheaTakes?: boolean; inRhea?: bigint; native?: bigint; open?: boolean } = {}) {
  const s = { native: o.native ?? 2n * NEAR, wnear: 0n, inRhea: o.inRhea ?? 0n, open: o.open ?? false, wnearReg: false, roomOut: 0n };
  const sent: { receiver: string; methods: string[] }[] = [];
  const block: Block = { hash: "11111111111111111111111111111111", height: 100 };
  const chain = {
    network: "mainnet",
    commonBlock: async () => block,
    account: async () => ({ balanceYocto: s.native, storageBytes: 200n }),
    accessKey: async () => ({ handle: PK, nonce: 41n + BigInt(sent.length), permission: { kind: "full" } }),
    view: async (contract: string, method: string) => {
      const k = `${contract}.${method}`;
      if (k === `${REF_EXCHANGE_ID}.get_deposits`) return s.open ? { [WNEAR]: String(s.inRhea) } : {};
      if (k === `${REF_EXCHANGE_ID}.get_user_storage_state`) return s.open ? { deposit: String(RHEA_ROOM_YOCTO - s.roomOut), usage: "3980000000000000000000" } : null;
      if (k === `${WNEAR}.ft_balance_of`) return String(s.wnear);
      if (k === `${WNEAR}.storage_balance_of`) return s.wnearReg ? { total: "1" } : null;
      return null;
    },
    send: async (signed: string) => {
      const bytes = base64ToBytes(signed);
      const d = decodeTransaction(bytes.slice(0, bytes.length - 65));
      const calls = d.actions.map((a) => (a.kind === "call" ? a : null)!);
      sent.push({ receiver: d.receiverId, methods: calls.map((c) => c.method) });
      let value: string | null = null;
      for (const c of calls) {
        const args = JSON.parse(new TextDecoder().decode(c.args));
        if (c.method === "storage_deposit" && d.receiverId === REF_EXCHANGE_ID) { s.open = true; s.native -= c.depositYocto; }
        if (c.method === "storage_deposit" && d.receiverId === WNEAR) { s.wnearReg = true; s.native -= c.depositYocto; }
        if (c.method === "near_deposit") { s.native -= c.depositYocto; s.wnear += c.depositYocto; }
        if (c.method === "ft_transfer_call") {
          const amt = BigInt(args.amount);
          if (o.rheaTakes !== false) { s.wnear -= amt; s.inRhea += amt; }
          value = btoa(JSON.stringify(o.rheaTakes === false ? "0" : String(amt)));
        }
        if (c.method === "withdraw") { const amt = BigInt(args.amount); s.inRhea -= amt; s.wnear += amt; }
        if (c.method === "storage_withdraw") { const amt = BigInt(args.amount); s.roomOut += amt; s.native += amt; }
        if (c.method === "ft_transfer") { s.wnear -= BigInt(args.amount); }
      }
      return { status: "done", value };
    },
  } as unknown as Chain;
  let turns = 0;
  const c: NearCoinCtx = {
    o: { near: chain, vault: { get: async () => null, put: async () => {} } as never, approve: async () => true },
    nonces: new Map(),
    turn: async (_k, run) => { turns++; return run(); },
    wallet: async () => ({ id: "w", address: WALLET }),
    find: async () => ({ id: "w", address: WALLET }),
    secret: async () => secret,
    priceSoon: async () => 4,
    capGate: async () => null,
  };
  return { c, s, sent, turns: () => turns };
}

test("Ready NEAR for trading (the door): the room, then the NEAR in, sent in order with rising nonces; Rhea's balance holds it; Home's total counts it (controls)", async () => {
  NEAR_GATE.open = true;
  try {
    const w = world();
    const r = await nearRheaAdd(w.c, "all");
    assert.equal(r.hashes.length, 2);
    assert.deepEqual(w.sent.map((x) => x.receiver), [REF_EXCHANGE_ID, WNEAR]);
    assert.deepEqual(w.sent[1]!.methods, ["storage_deposit", "near_deposit", "ft_transfer_call"]);
    assert.equal(w.s.inRhea, BigInt(r.amount));
    const bal = await nearCoinBalance(w.c);
    assert.equal(bal.rheaYocto, r.amount, "its NEAR on Rhea is the wallet's, never missing");
    assert.equal(BigInt(bal.nearYocto) + BigInt(bal.wnearYocto) + BigInt(bal.rheaYocto) + RHEA_ROOM_YOCTO + NEAR_STORAGE_MAX_YOCTO, 2n * NEAR, "every yocto accounted for");
    // again: no room this time, nothing left to move but what landed since
    w.s.native += NEAR;
    const again = await nearRheaAdd(w.c, "all");
    assert.equal(again.hashes.length, 1, "control: room already there");
    // Rhea refuses the deposit (ft_transfer_call used 0): said, never "ready"
    const no = world({ rheaTakes: false });
    await assert.rejects(nearRheaAdd(no.c, "all"), (e: { problem?: { more?: unknown } }) => /Rhea didn.t take it/.test(String(e.problem?.more)));
    await assert.rejects(nearRheaAdd(w.c, "1e24"), (e: { problem?: { code: string } }) => e.problem?.code === "security.request.invalid" || /invalid/.test(e.problem?.code ?? ""));
  } finally { NEAR_GATE.open = false; }
  await assert.rejects(nearRheaAdd(world().c, "all"), (e: { problem?: { more?: unknown } }) => /open soon/.test(String(e.problem?.more)), "the gate shut: refused");
});

test("Put away: the wallet's NEAR on Rhea comes out first (withdraw, as wNEAR), then the payment; spendable counts it; none taken when the wallet has enough (control)", async () => {
  NEAR_GATE.open = true;
  try {
    const w = world({ open: true, inRhea: NEAR, native: 100_000_000_000_000_000_000_000n });
    w.s.wnearReg = true;
    const can = await nearSpendable(w.c);
    assert.ok(can >= NEAR, "spendable counts Rhea's NEAR");
    const to = "b".repeat(64);
    await nearPay(w.c, to, NEAR / 2n);
    assert.deepEqual(w.sent.map((x) => x.methods.at(-1)), ["withdraw", "ft_transfer"]);
    // the wallet's own free NEAR (0.1 less its storage, the gas it keeps, two accounts' room, 3 yocto: the ft_transfer's,
    // the Rhea withdraw's and the room back's) went first
    const free = 100_000_000_000_000_000_000_000n - (200n * 10n ** 19n + 50_000_000_000_000_000_000_000n + 2n * NEAR_STORAGE_MAX_YOCTO + 3n);
    assert.equal(w.s.inRhea, NEAR - (NEAR / 2n - free), "only what the wallet lacked came out");
    const rich = world({ open: true, inRhea: NEAR, native: 5n * NEAR });
    rich.s.wnearReg = true;
    await nearPay(rich.c, to, NEAR / 2n);
    assert.deepEqual(rich.sent.map((x) => x.methods.at(-1)), ["ft_transfer"], "control: the wallet had enough, Rhea untouched");
  } finally { NEAR_GATE.open = false; }
});

test("the audit's SHOULD: Put away of all its NEAR brings Rhea's room back too (storage_withdraw, the unused part, to the wallet); a part Put away leaves it (control)", async () => {
  NEAR_GATE.open = true;
  try {
    const ROOM_FREE = RHEA_ROOM_YOCTO - 3_980_000_000_000_000_000_000n;
    const w = world({ open: true, inRhea: NEAR, native: 100_000_000_000_000_000_000_000n });
    w.s.wnearReg = true;
    const bal = await nearCoinBalance(w.c);
    assert.equal(bal.line, RHEA_HELD_LINE, "while ready: the NEAR wallet's line says where it is");
    assert.equal(bal.line, "Ready to trade: held in Rhea's exchange");
    assert.equal(bal.roomYocto, ROOM_FREE.toString(), "the room's unused part is the wallet's");
    const all = await nearSpendable(w.c);
    const to = "c".repeat(64);
    await nearPay(w.c, to, all);
    assert.deepEqual(w.sent.map((x) => x.methods.at(-1)), ["withdraw", "storage_withdraw", "ft_transfer"], "its NEAR out of Rhea, then the room back, then the payment");
    assert.equal(w.s.inRhea, 0n);
    assert.equal(w.s.roomOut, ROOM_FREE, "the room came back to the wallet");
    const after = await nearCoinBalance(w.c);
    assert.equal(after.line, undefined, "control: nothing on Rhea, no line");
    // control: a Put away of part of it leaves the room (the existing Put away test's ["withdraw", "ft_transfer"] too)
    const part = world({ open: true, inRhea: NEAR, native: 100_000_000_000_000_000_000_000n });
    part.s.wnearReg = true;
    await nearPay(part.c, to, NEAR / 2n);
    assert.ok(!part.sent.some((x) => x.methods.includes("storage_withdraw")), "part: the room stays for the next trade");
    assert.equal(part.s.roomOut, 0n);
  } finally { NEAR_GATE.open = false; }
});

test("the room's way back is exactly Ref's storage_withdraw of the amount read, 1 yocto, the wallet's own; anything else refused (controls)", () => {
  const amt = 46_020_000_000_000_000_000_000n;
  const t = unsigned(rheaRoomBackTx(amt));
  const r = { rhea: "roomBack" as const, amount: amt };
  assert.equal(rheaBytesRefusal(decoded(t), WALLET, r), null, "control");
  assert.match(rheaBytesRefusal(decoded(withArgs(t, { amount: "1" })), WALLET, r)!, /room coming back/, "another amount");
  assert.match(rheaBytesRefusal(decoded(withArgs(t, { amount: amt.toString(), receiver_id: "evil.near" })), WALLET, r)!, /room coming back/, "an extra key");
  assert.match(rheaBytesRefusal(decoded(withArgs(t, { amount: amt.toString() }, { method: "storage_unregister" })), WALLET, r)!, /room coming back/, "another method");
  assert.match(rheaBytesRefusal(decoded(withArgs(t, { amount: amt.toString() }, { deposit: 0n })), WALLET, r)!, /room coming back/, "no yocto");
  assert.match(rheaBytesRefusal(decoded(unsigned(rheaRoomBackTx(amt), "evil.near")), WALLET, r)!, /isn't a payment from your NEAR coin wallet/, "another signer");
  assert.match(rheaBytesRefusal(decoded(unsigned(rheaWithdrawTx(amt))), WALLET, r)!, /room coming back/, "a withdraw in its place");
});
