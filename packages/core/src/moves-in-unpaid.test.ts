// Mainnet 2 Nov: two moves in to Spending's reserve were never paid (fm-NdRTspLxdUypr5db8FG2YQ from Solana,
// fm-ICsp-aDxAzo2d2Rnqxbo7A from Robinhood Chain): pending, submitted false, no paidTx, 1Click PENDING_DEPOSIT, the money
// still in the wallets, and "moving" until 1Click's 3-day deadline. Robinhood Chain's nodes refused a fixed 21,000 gas
// ("gas required exceeds allowance (21000)": a plain transfer needs 23,237 to 23,331 while its L1 price is on), the
// payment's error was thrown away, and nothing ended a move no node took before 1Click's own deadline. Fixed here:
// the nodes' own gas, the reason kept on the move, and a move provably never paid ends past OUR 10 minutes and a grace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVM_CHAIN_ID, RpcEvmChain, signEvmTx, unsignedEvmTx, type EvmChain } from "./evm.ts";
import { parseTx } from "./evm/wire.ts";
import type { FloatRelay } from "./float-moves.ts";
import { fromBase64 } from "./sol/bytes.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { RpcSolChain, type SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const GWEI = 10n ** 9n;
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const EVM_DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const PLAIN_GAS = 23_300n;
const key = (n: number) => `trade-job-${String(n).padStart(8, "0")}`;
const MIN = 60_000;

/** ZeroFee's relay in front of 1Click, honest, signed by the test key; 1Click's deadline is 3 days, as on mainnet. */
function relay() {
  const quotes = new Map<string, { req: any; deadline: string }>();
  const r: FloatRelay = {
    quote: async (req) => {
      const depositAddress = req.originAsset.includes("sol") ? SOL_DEPOSIT : EVM_DEPOSIT;
      const deadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: "0", deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => ({}),
    submitIntent: async () => ({}),
    status: async (d) => {
      const q = quotes.get(d);
      if (!q) return null;
      const sol = q.req.originAsset.includes("sol");
      const minAmountOut = String(Math.floor((Number(q.req.amount) / (sol ? 1e9 : 1e18)) * (sol ? 150 : 3000) * 0.98 * 1e6));
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: q.req, quote: { depositAddress: d, amountIn: q.req.amount, minAmountOut, deadline: q.deadline } }) };
    },
  };
  return r;
}

const realNow = Date.now;
const later = async <T,>(ms: number, run: () => Promise<T>): Promise<T> => {
  Date.now = () => realNow() + ms;
  try {
    return await run();
  } finally {
    Date.now = realNow;
  }
};

async function core(o: { sol?: Partial<SolChain>; evm?: Partial<EvmChain>; relay?: FloatRelay } = {}) {
  const sent: string[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true,
    simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }),
    lookupTables: async () => [],
    latestBlockhash: async () => "11111111111111111111111111111111",
    balance: async () => 400_005_000n,
    send: async (s) => (sent.push(s), true),
    ...o.sol,
  };
  const evm = {
    nonce: async () => 3,
    estimateGas: async () => PLAIN_GAS,
    fees: async () => ({ tip: GWEI / 1000n, maxFee: GWEI / 50n }),
    read: async () => "0x" + (10n ** 16n).toString(16),
    send: async (_c: string, s: string) => (sent.push(s), true),
    ...o.evm,
  } as unknown as EvmChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm, floatRelay: o.relay ?? relay(), mainAccount: async () => "kim.near", usdPrice: async (c) => (c === "sol" ? 150 : 3000), approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  await w.create("trade", "near");
  await w.create("trade", "sol", 0);
  await w.create("trade", "hood", 0);
  return { w, sent };
}

// ---- 1. Robinhood Chain's gas, through the real two-node reader (RpcEvmChain) against stand-in nodes.

/** The two Robinhood Chain nodes: a plain transfer needs PLAIN_GAS; less is refused in their words. */
function hoodNodes(o: { estimates?: [bigint, bigint]; bases?: bigint[] } = {}) {
  const sent: string[] = [];
  let feeReads = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const second = String(url).includes("drpc") ? 1 : 0;
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    const refuse = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message } }));
    switch (method) {
      case "eth_getTransactionCount": return reply("0x3");
      case "eth_getBlockByNumber": {
        const bases = o.bases ?? [GWEI / 100n];
        const base = bases[Math.min(Math.floor(feeReads++ / 2), bases.length - 1)]!;
        return reply({ baseFeePerGas: "0x" + base.toString(16) });
      }
      case "eth_maxPriorityFeePerGas": return reply("0x" + (GWEI / 1000n).toString(16));
      case "eth_getBalance": return reply("0x" + (10n ** 16n).toString(16));
      case "eth_estimateGas": return reply("0x" + (o.estimates ?? [23_237n, PLAIN_GAS])[second]!.toString(16));
      case "eth_sendRawTransaction": {
        const gas = parseTx(params[0]).gas;
        if (gas < PLAIN_GAS) return refuse(`gas required exceeds allowance (${gas})`);
        sent.push(params[0]);
        return reply("0x" + "ab".repeat(32));
      }
      default: return refuse(`unexpected ${method}`);
    }
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = real) };
}

async function hoodCore() {
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: new RpcEvmChain() as EvmChain, floatRelay: relay(), mainAccount: async () => "kim.near", usdPrice: async () => 3000, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  await w.create("trade", "near");
  await w.create("trade", "hood", 0);
  return w;
}

test("control: the stand-in Robinhood Chain nodes refuse a plain transfer at a fixed 21,000 gas, in their own words", async () => {
  const n = hoodNodes();
  try {
    const bytes = fromBase64(unsignedEvmTx({ chainId: EVM_CHAIN_ID.hood, nonce: 3, tip: 1n, fee: GWEI, gas: 21_000n, to: EVM_DEPOSIT, value: 1n, data: "0x" }));
    const signed = signEvmTx(bytes, new Uint8Array(32).fill(1));
    await assert.rejects(new RpcEvmChain().send("hood", signed), /gas required exceeds allowance \(21000\)/);
  } finally {
    n.restore();
  }
});

test("a move in from Robinhood Chain pays with the two nodes' gas (the higher, a fifth more), never a fixed 21,000; \"all\" and its fee fit in the wallet", async () => {
  const n = hoodNodes();
  try {
    const w = await hoodCore();
    const m = await w.floatIn("hood", 0, "all", key(1));
    assert.ok(!("declined" in m));
    assert.deepEqual([m.status, m.where, m.reason], ["pending", "in-flight", undefined]);
    assert.equal(n.sent.length >= 1, true, "a node took it");
    const t = parseTx(n.sent[0]!);
    assert.equal(t.gas, (PLAIN_GAS * 6n) / 5n);
    assert.ok(t.value + t.gas * t.maxFeePerGas <= 10n ** 16n, "what's sent and the most its fee can be fit in the wallet");
  } finally {
    n.restore();
  }
});

test("Robinhood Chain: the fee rises a little between the check and the send: \"all\" still goes, inside the room it kept", async () => {
  // base fee 0.01 gwei at the check, 0.011 gwei at the send (+10%): inside the 25% kept back
  const n = hoodNodes({ bases: [GWEI / 100n, (GWEI * 11n) / 1000n] });
  try {
    const w = await hoodCore();
    const m = await w.floatIn("hood", 0, "all", key(2));
    assert.ok(!("declined" in m) && m.where === "in-flight", (m as any).reason);
    const t = parseTx(n.sent[0]!);
    assert.ok(t.value + t.gas * t.maxFeePerGas <= 10n ** 16n);
  } finally {
    n.restore();
  }
});

test("Robinhood Chain: a fee that doubles before the send is read once more, then refused plainly: nothing sent, the reason kept", async () => {
  const n = hoodNodes({ bases: [GWEI / 100n, GWEI / 50n] });
  try {
    const w = await hoodCore();
    const m = await w.floatIn("hood", 0, "all", key(3));
    assert.ok(!("declined" in m));
    // never signed: it ends at once, the money in the wallet, its reason kept (product decision, 5 Nov: never "on its way")
    assert.deepEqual([m.status, m.where], ["failed", "chain"]);
    assert.equal(n.sent.length, 0);
    assert.match(m.reason ?? "", /^Didn't go: Robinhood Chain's fee is very high.* · the money is still in your Robinhood Chain wallet$/);
  } finally {
    n.restore();
  }
});

test("Robinhood Chain: an estimate past 100,000 gas for a plain transfer is refused before anything is asked", async () => {
  const n = hoodNodes({ estimates: [90_000n, 90_000n] });
  try {
    const w = await hoodCore();
    await assert.rejects(w.floatIn("hood", 0, "all", key(4)), (e: any) => e.problem?.code === "security.subwallet.refused" && /would cost far more in fees than it should/.test(e.problem.more));
    assert.equal(n.sent.length, 0);
  } finally {
    n.restore();
  }
});

// ---- 2. A transfer no node took says why (it was thrown away).

test("a payment no node takes keeps the nodes' own words on the move, for Activity and the logs", async () => {
  const { w } = await core({ evm: { send: async () => { throw new Error("neither node took it: gas required exceeds allowance (21000)"); } } });
  const m = await w.floatIn("hood", 0, "5000000000000000", key(10));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.status, m.where], ["pending", "chain"]);
  assert.equal(m.reason, "Not sent from your Robinhood Chain wallet: neither node took it: gas required exceeds allowance (21000)");
  assert.equal((await w.floatMove(m.id)).reason, m.reason, "kept");
});

// ---- 3. A move in no node took ends once it provably never landed, past our 10 minutes and a grace.

const refusing = { send: async () => { throw new Error("neither node took it"); } };
// The wallet as the nodes say it LATER (after the clock moves): when the transfer is made, 3 sent and nothing waiting (the
// core now reads what is waiting before it numbers a transfer, 3 Nov, so the later state must not leak into that read).
const evmAccounts = (wallet: { latest: number; pending: number } | null, deposit: bigint | null) => ({
  account: async (_c: string, a: string) => {
    if (a.toLowerCase() === EVM_DEPOSIT) return [deposit === null ? null : { latest: 1, pending: 1, balance: deposit }, { latest: 1, pending: 1, balance: deposit ?? 0n }];
    if (Date.now() - realNow() < MIN) return [{ latest: 3, pending: 3, balance: 10n ** 16n }, { latest: 3, pending: 3, balance: 10n ** 16n }];
    return [wallet && { ...wallet, balance: 10n ** 16n }, { latest: wallet?.latest ?? 3, pending: wallet?.pending ?? 3, balance: 10n ** 16n }];
  },
});

test("Robinhood Chain: unpaid, the nonce unmoved and the deposit address empty: still \"moving\" at 15 minutes, then it didn't go, the money in the wallet, and asked again it pays", async () => {
  let refuse = true;
  const { w, sent } = await core({ evm: { ...evmAccounts({ latest: 3, pending: 3 }, 0n), send: async (_c: string, s: string) => { if (refuse) throw new Error("neither node took it"); sent.push(s); return true; } } });
  const m = await w.floatIn("hood", 0, "all", key(20));
  assert.ok(!("declined" in m) && m.where === "chain");
  assert.equal((await later(15 * MIN, () => w.floatMove(m.id))).status, "pending", "inside our 10 minutes and the grace it may still be sent");
  const ended = await later(21 * MIN, () => w.floatMove(m.id));
  assert.deepEqual([ended.status, ended.where, ended.reason], ["failed", "chain", "Didn't go · the money is still in your Robinhood Chain wallet"]);
  // the planner asks again (a new key): the wallet's money goes this time
  refuse = false;
  const again = await w.floatIn("hood", 0, "all", key(21));
  assert.ok(!("declined" in again) && again.where === "in-flight");
  assert.equal(sent.length, 1);
});

test("Robinhood Chain: anything uncertain keeps an unpaid move open (nonce moved, something waiting, money at the deposit address, a node silent)", async () => {
  const cases: [string, ReturnType<typeof evmAccounts>][] = [
    ["the wallet sent another since", evmAccounts({ latest: 4, pending: 4 }, 0n)],
    // re-review M: a count below its number is a gap the transfer could still land across, never "didn't go"
    ["a gap below its number", evmAccounts({ latest: 2, pending: 2 }, 0n)],
    ["a transaction of the wallet's still waiting", evmAccounts({ latest: 3, pending: 4 }, 0n)],
    ["the deposit address holds money", evmAccounts({ latest: 3, pending: 3 }, 1n)],
    ["a node didn't answer about the wallet", evmAccounts(null, 0n)],
    ["a node didn't answer about the deposit address", evmAccounts({ latest: 3, pending: 3 }, null)],
  ];
  for (const [what, accounts] of cases) {
    const { w } = await core({ evm: { ...accounts, ...refusing } });
    const m = await w.floatIn("hood", 0, "all", key(22));
    assert.ok(!("declined" in m));
    assert.equal((await later(30 * MIN, () => w.floatMove(m.id))).status, "pending", what);
  }
  const { w } = await core({ evm: refusing });
  const m = await w.floatIn("hood", 0, "all", key(23));
  assert.ok(!("declined" in m));
  assert.equal((await later(30 * MIN, () => w.floatMove(m.id))).status, "pending", "nodes that can't be asked: open");
});

test("Robinhood Chain: a transfer a node took is never ended by this rule", async () => {
  const { w } = await core({ evm: evmAccounts({ latest: 3, pending: 3 }, 0n) });
  const m = await w.floatIn("hood", 0, "all", key(24));
  assert.ok(!("declined" in m) && m.where === "in-flight");
  assert.equal((await later(30 * MIN, () => w.floatMove(m.id))).status, "pending");
});

test("Robinhood Chain: a move made before this fix (nothing kept of its transfer) ends when nothing of the wallet's waits and the deposit address is empty", async () => {
  // the nonce couldn't be read when it paid, so nothing was signed or kept: as a move kept by the old code looks
  const { w } = await core({ evm: { ...evmAccounts({ latest: 7, pending: 7 }, 0n), nonce: async () => { throw new Error("no answer"); } } });
  const m = await w.floatIn("hood", 0, "all", key(25));
  assert.ok(!("declined" in m) && m.where === "chain");
  assert.equal((await later(21 * MIN, () => w.floatMove(m.id))).status, "failed");
});

const solProof = (o: { expired?: boolean; unused?: boolean }) => ({ blockhashExpired: async () => o.expired ?? true, unused: async () => o.unused ?? true });

test("Solana: unpaid, its blockhash expired on both nodes and the deposit address never used: it didn't go, the money in the wallet", async () => {
  const { w } = await core({ sol: { ...solProof({}), send: async () => { throw new Error("neither node took it: Blockhash not found"); } } });
  const m = await w.floatIn("sol", 0, "all", key(30));
  assert.ok(!("declined" in m));
  assert.equal(m.reason, "Not sent from your Solana wallet: neither node took it: Blockhash not found");
  // signed with a kept blockhash: open until 2 minutes on (product decision, 5 Nov: 20 minutes of "Leaving your SOL wallet"),
  // then ended on the chain's word alone (the blockhash expired on both nodes, the deposit address untouched)
  assert.equal((await later(1 * MIN, () => w.floatMove(m.id))).status, "pending");
  const ended = await later(3 * MIN, () => w.floatMove(m.id));
  assert.deepEqual([ended.status, ended.where, ended.reason], ["failed", "chain", "Didn't go · the money is still in your Solana wallet"]);
});

test("Solana: a blockhash still valid, a deposit address with history, or past the nodes' history: it stays open", async () => {
  for (const [what, proof, at] of [["the blockhash is still valid", solProof({ expired: false }), 21 * MIN], ["the deposit address has a transaction", solProof({ unused: false }), 21 * MIN], ["21 hours on, past what a node's history surely holds", solProof({}), 21 * 60 * MIN]] as const) {
    const { w } = await core({ sol: { ...proof, send: async () => false } });
    const m = await w.floatIn("sol", 0, "all", key(31));
    assert.ok(!("declined" in m));
    assert.equal((await later(at, () => w.floatMove(m.id))).status, "pending", what);
  }
});

test("Solana: a move that never got a blockhash (made before this fix, or both nodes refused one) ends on the deposit address alone", async () => {
  let expiredAsked = 0;
  const { w, sent } = await core({ sol: { blockhashExpired: async () => (expiredAsked++, false), unused: async () => true, latestBlockhash: async () => { throw new Error("the two Solana nodes didn't agree on a recent blockhash (asked 3 times)"); } } });
  const m = await w.floatIn("sol", 0, "all", key(32));
  assert.ok(!("declined" in m));
  assert.equal(sent.length, 0, "nothing signed");
  assert.match(m.reason ?? "", /didn't agree on a recent blockhash/);
  assert.equal((await later(21 * MIN, () => w.floatMove(m.id))).status, "failed");
  assert.equal(expiredAsked, 0, "no blockhash to ask about");
});

// ---- 4. Solana's blockhash for the core's own transfer: a node a few slots behind no longer refuses it.

function solNodes(o: { first: string[]; second: string[] | "silent"; newest: [string, number][] }) {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const second = String(url).includes("pocket") ? 1 : 0;
    if (second && o.second === "silent") return new Response("{}", { status: 503 });
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "getLatestBlockhash") return reply({ value: { blockhash: o.newest[second]![0], lastValidBlockHeight: o.newest[second]![1] } });
    if (method === "isBlockhashValid") {
      asked.push(params[0]);
      return reply({ value: (second ? (o.second as string[]) : o.first).includes(params[0]) });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: `unexpected ${method}` } }));
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}

test("Solana: the older of the two nodes' newest blockhashes, which both know, never the leader's newest the other hasn't seen", async () => {
  const H1 = "HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh1", H2 = "HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh2";
  const n = solNodes({ first: [H1, H2], second: [H1], newest: [[H2, 210], [H1, 200]] });
  try {
    assert.equal(await new RpcSolChain().latestBlockhash(), H1);
  } finally {
    n.restore();
  }
  // the signing path's check (speed, 3 Nov): the node ahead saying the leader's newest is valid decides at once; the node
  // behind saying no doesn't refuse it any more (the old rule refused it here: both had to say yes)
  const c = solNodes({ first: [H1, H2], second: [H1], newest: [[H2, 210], [H1, 200]] });
  try {
    assert.equal(await new RpcSolChain().blockhashValid(H2), true);
    // control: one neither node knows is refused
    assert.equal(await new RpcSolChain().blockhashValid("HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh3"), false);
  } finally {
    c.restore();
  }
});

test("Solana: a node that doesn't answer doesn't block the core's own transfer; one that refuses every time does, in words", async () => {
  const H1 = "HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh1";
  const n = solNodes({ first: [H1], second: "silent", newest: [[H1, 200], [H1, 200]] });
  try {
    assert.equal(await new RpcSolChain().latestBlockhash(), H1);
    assert.equal(await new RpcSolChain().blockhashExpired(H1), false, "a silent node can't prove a blockhash expired");
    assert.equal(await new RpcSolChain().unused(SOL_DEPOSIT), false, "nor that an address was never used");
  } finally {
    n.restore();
  }
  const r = solNodes({ first: [H1], second: [], newest: [[H1, 200], [H1, 200]] });
  try {
    await assert.rejects(new RpcSolChain().latestBlockhash(), /didn't agree on a recent blockhash/);
    assert.equal(r.asked.length, 6, "asked 3 times, on both nodes");
  } finally {
    r.restore();
  }
});

// ---- 5. Audit of 045f88c0: a refresh racing the move's own transfer never ends a move that may be paid (a double pay
// when the planner asks again).

const gate = () => {
  let open!: () => void;
  let reached = false;
  const p = new Promise<void>((r) => (open = r));
  return { wait: () => ((reached = true), p), open: () => open(), get reached() { return reached; } };
};
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), "reached");
};

test("a refresh that read the move before its transfer was kept never writes over it: the paid move stays paid, never ended unpaid", async () => {
  // control on the old code: the refresh's older copy (no nonce kept, not submitted) landed over the paid move, and 21
  // minutes on, the nonce gone up and the deposit address swept with 1Click's status still PENDING_DEPOSIT, it "didn't go"
  const nonce = gate(), status = gate();
  const r = relay();
  const honest = r.status;
  let slow = false;
  r.status = async (d, t) => {
    const v = await honest(d, t);
    if (slow) await status.wait();
    return v;
  };
  const { w, sent } = await core({ relay: r, evm: { ...evmAccounts({ latest: 4, pending: 4 }, 0n), nonce: async () => (await nonce.wait(), 3) } });
  const paying = w.floatIn("hood", 0, "all", key(40));
  await until(() => nonce.reached);
  slow = true;
  const refreshing = w.floatMove(`fm-${key(40)}`);
  await until(() => status.reached);
  nonce.open();
  const m = await paying;
  assert.ok(!("declined" in m) && m.where === "in-flight");
  status.open();
  await refreshing;
  slow = false;
  assert.equal(sent.length, 1);
  assert.equal((await w.floatMove(m.id)).where, "in-flight", "the transfer kept");
  assert.equal((await later(21 * MIN, () => w.floatMove(m.id))).status, "pending", "a move a node took is never ended unpaid");
});

test("a transfer still being made when a refresh comes past 20 minutes: never ended unpaid under it, and never signed past our price's 10 minutes", async () => {
  // control on the old code: the refresh ended it while the transfer was made, and the transfer then went: failed AND paid
  const nonce = gate(), asked = gate();
  let late = false;
  const accounts = evmAccounts({ latest: 3, pending: 3 }, 0n);
  const { w, sent } = await core({
    evm: { account: async (c: string, a: string) => (late && (await asked.wait()), accounts.account(c, a)), nonce: async () => (await nonce.wait(), 3) },
  });
  const paying = w.floatIn("hood", 0, "all", key(41));
  await until(() => nonce.reached);
  Date.now = () => realNow() + 21 * MIN;
  try {
    late = true;
    let done = false;
    const refreshing = w.floatMove(`fm-${key(41)}`).finally(() => (done = true));
    await until(() => asked.reached || done);
    nonce.open();
    const m = await paying;
    asked.open();
    late = false;
    const after = await refreshing;
    assert.equal(sent.length, 0, "nothing signed past our price's 10 minutes");
    assert.ok(!("declined" in m));
    assert.match(m.reason ?? "", /price ran out before it was signed/);
    assert.equal(after.status, "pending", "not ended while its transfer was being made");
    // nothing was sent, so the next refresh may prove it unpaid
    assert.equal((await w.floatMove(m.id)).status, "failed");
  } finally {
    Date.now = realNow;
  }
});

// ---- k-trade re-test (4 Nov): a leg that failed kept its 1Click deposit address only in the vault.

test("k-trade re-test: a move names its 1Click deposit address on its proof from the moment 1Click gave it, before any status read (Activity's Swap order)", async () => {
  const quiet = relay();
  // 1Click's status answers the quote's check once, then never again (the relay down, a 429): no status read sets the proof
  let asked = 0;
  const { w } = await core({ relay: { ...quiet, status: async (d, t) => (asked++ === 0 ? quiet.status(d, t) : null) }, evm: { send: async () => { throw new Error("neither node took it"); } } });
  const m = await w.floatIn("hood", 0, "5000000000000000", key(11));
  assert.ok(!("declined" in m));
  assert.equal((await w.floatMove(m.id)).proof?.deposit, EVM_DEPOSIT, "the one move");
  assert.equal((await w.floatMoveList()).find((x) => x.id === m.id)?.proof?.deposit, EVM_DEPOSIT, "the list");
});

test("product decision (5 Nov, $2.60 SOL wallet -> Safe, no transaction for 33 minutes): a transfer never signed (no node to sign with) ends at once, its reason and where the money is kept; control: one signed and refused stays open until the chain says so", async () => {
  const { w, sent } = await core({ sol: { blockhashExpired: async () => true, unused: async () => true, latestBlockhash: async () => { throw new Error("no Solana node answered"); } } });
  const m = await w.floatIn("sol", 0, "all", key(40));
  assert.ok(!("declined" in m));
  assert.equal(sent.length, 0, "nothing signed");
  assert.deepEqual([m.status, m.where, m.reason], ["failed", "chain", "Didn't go: no Solana node answered · the money is still in your Solana wallet"]);
  // control: signed with a blockhash and refused by the nodes: it may still land until that blockhash expires
  const c = await core({ sol: { ...solProof({ expired: false }), send: async () => false } });
  const m2 = await c.w.floatIn("sol", 0, "all", key(41));
  assert.ok(!("declined" in m2));
  assert.equal(m2.status, "pending");
  assert.equal((await later(3 * MIN, () => c.w.floatMove(m2.id))).status, "pending", "its blockhash still valid: open");
});
