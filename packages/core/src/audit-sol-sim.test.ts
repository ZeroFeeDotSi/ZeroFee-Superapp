// Audit SOL-7 (money paths, Solana slice; its PoC, kept here and FIXED): a simulation answer with no post-balance for the
// wallet was read as "nothing leaves". Now it's not measured (ok false). And the simulation reads the wallet's token
// accounts it's asked about, before and after (audit SOL-1, SOL-2, SOL-3), on both nodes, which must agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain, SOL } from "./solana.ts";
import { base58, base64, cat, fromBase58, u64le } from "./sol/bytes.ts";

test("SOL-7: a simulation answer without the wallet's post-balance is not read as 'nothing leaves'", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const result = method === "getBalance" ? { value: 10_000_000_000 } : { value: { err: null, logs: [] } };   // no `accounts`
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  try {
    const s = await new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]).simulate("AA==", "wallet");
    const measuredZero = s.ok && s.agreed && s.lamportsBefore === s.lamportsAfter;
    assert.equal(measuredZero, false, `read as ok, agreed and 0 lamports out: ${JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  } finally { globalThis.fetch = real; }
});

const WALLET = base58(new Uint8Array(32).fill(7));
const tokenAccount = (mint: string, owner: string, amount: bigint) => ({ owner: SOL.token, lamports: 2_039_280, data: [base64(cat(fromBase58(mint), fromBase58(owner), u64le(amount), new Uint8Array(165 - 72))), "base64"] });

function nodes(answer: (url: string) => { pre: unknown[]; post: unknown[] }) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const a = answer(String(url));
    const result = method === "getBalance" ? { value: 10_000_000_000 } : method === "getMultipleAccounts" ? { value: a.pre } : { value: { err: null, accounts: [{ lamports: 9_999_995_000 }, ...a.post] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return () => (globalThis.fetch = real);
}

test("the simulation reads the wallet's coins before and after; one handed to someone else counts as emptied; the two nodes must agree", async () => {
  const coinX = base58(new Uint8Array(32).fill(21)), coinY = base58(new Uint8Array(32).fill(22)), other = base58(new Uint8Array(32).fill(9));
  const accX = base58(new Uint8Array(32).fill(31)), accY = base58(new Uint8Array(32).fill(32)), pool = base58(new Uint8Array(32).fill(33));
  const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]);
  let restore = nodes(() => ({
    pre: [tokenAccount(coinX, WALLET, 1000n), tokenAccount(coinY, WALLET, 50n), tokenAccount(coinX, other, 9n)],
    post: [tokenAccount(coinX, WALLET, 400n), tokenAccount(coinY, other, 50n), tokenAccount(coinX, other, 609n)],
  }));
  try {
    const s = await chain.simulate("AA==", WALLET, [accX, accY, pool]);
    assert.equal(s.ok && s.agreed, true);
    assert.deepEqual(s.tokens, [
      { address: accX, mint: coinX, before: 1000n, after: 400n },
      { address: accY, mint: coinY, before: 50n, after: 0n },
    ], "the pool's account isn't the wallet's; Y's account handed to someone else counts as emptied");
  } finally {
    restore();
  }
  restore = nodes((url) => ({ pre: [tokenAccount(coinX, WALLET, 1000n)], post: [tokenAccount(coinX, WALLET, url.includes("a.example") ? 400n : 900n)] }));
  try {
    assert.equal((await chain.simulate("AA==", WALLET, [accX])).agreed, false, "the nodes disagree on the coins");
  } finally {
    restore();
  }
});


// App Store review (30 Oct): an App Store app's transaction calls programs ZeroFee doesn't know, and the wallet signs it,
// so such a program can, inside its own instruction (where the bytes can't show it), give someone an allowance on the
// wallet's coins, hand a wrapped-SOL account's close to someone, or Assign the wallet itself to a program. None of those
// moves a balance in the test run, so each read "nothing leaves". The after-state now counts each as gone.
const u32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
/** A full SPL token account: delegate, is_native and close authority set when given. */
function richAccount(mint: string, owner: string, amount: bigint, o: { delegate?: string; delegated?: bigint; native?: boolean; closer?: string } = {}) {
  const opt = (k?: string) => (k ? cat(u32(1), fromBase58(k)) : new Uint8Array(36));
  const data = cat(fromBase58(mint), fromBase58(owner), u64le(amount), opt(o.delegate), [1], o.native ? cat(u32(1), u64le(2_039_280n)) : new Uint8Array(12), u64le(o.delegated ?? 0n), opt(o.closer));
  assert.equal(data.length, 165);
  return { owner: SOL.token, lamports: 2_039_280, data: [base64(data), "base64"] };
}

test("an allowance or a wrapped-SOL close handed to someone else in the test run counts as the coin leaving", async () => {
  const coinX = base58(new Uint8Array(32).fill(41)), thief = base58(new Uint8Array(32).fill(42));
  const accX = base58(new Uint8Array(32).fill(43)), accW = base58(new Uint8Array(32).fill(44)), accY = base58(new Uint8Array(32).fill(45));
  const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]);
  const restore = nodes(() => ({
    pre: [richAccount(coinX, WALLET, 1000n), richAccount(SOL.wsol, WALLET, 5_000n, { native: true }), richAccount(coinX, WALLET, 70n, { delegate: WALLET, delegated: 70n })],
    post: [
      richAccount(coinX, WALLET, 1000n, { delegate: thief, delegated: 600n }),
      richAccount(SOL.wsol, WALLET, 5_000n, { native: true, closer: thief }),
      richAccount(coinX, WALLET, 70n, { delegate: WALLET, delegated: 70n }),
    ],
  }));
  try {
    const s = await chain.simulate("AA==", WALLET, [accX, accW, accY]);
    assert.deepEqual(s.tokens, [
      { address: accX, mint: coinX, before: 1000n, after: 400n },
      { address: accW, mint: SOL.wsol, before: 5_000n, after: 0n },
      { address: accY, mint: coinX, before: 70n, after: 70n },
    ], "600 of X may be taken; the wrapped SOL can be closed away; an allowance to the wallet itself is nothing");
  } finally {
    restore();
  }
});

test("a wallet the test run hands to a program (System Assign inside another program) counts as all of it leaving", async () => {
  const real = globalThis.fetch;
  const evil = base58(new Uint8Array(32).fill(46));
  let owner = evil;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const result = method === "getBalance" ? { value: 10_000_000_000 } : { value: { err: null, accounts: [{ lamports: 9_999_995_000, owner }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  try {
    const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]);
    const s = await chain.simulate("AA==", WALLET);
    assert.equal(s.lamportsBefore - s.lamportsAfter, 10_000_000_000n, "the whole balance");
    owner = SOL.system;
    const plain = await chain.simulate("AA==", WALLET);
    assert.equal(plain.lamportsBefore - plain.lamportsAfter, 5_000n, "a wallet still the System program's: only the fee");
  } finally {
    globalThis.fetch = real;
  }
});

test("A12: a restore reads a wallet's token accounts (both token programs) and whether it has any history; the second node stands in", async () => {
  const coin = base58(new Uint8Array(32).fill(51)), other = base58(new Uint8Array(32).fill(52));
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    asked.push(`${new URL(u).host} ${method}${method === "getTokenAccountsByOwner" ? ` ${params[1].programId === SOL.token ? "token" : "token-2022"}` : ""}`);
    if (u.startsWith("https://a.")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "down" } }));
    const result = method === "getSignaturesForAddress" ? (params[0] === WALLET ? [{ signature: "s" }] : [])
      : { value: params[1].programId === SOL.token ? [{ account: tokenAccount(coin, WALLET, 0n) }, { account: tokenAccount(coin, other, 9n) }] : [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  try {
    const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]);
    assert.deepEqual(await chain.tokenAccounts(WALLET), [{ mint: coin, amount: 0n }], "an emptied coin account still shows the wallet was used; another owner's is never counted");
    assert.equal(await chain.hasHistory(WALLET), true);
    assert.equal(await chain.hasHistory(other), false);
    assert.ok(asked.includes("b.example getTokenAccountsByOwner token-2022"));
  } finally {
    globalThis.fetch = real;
  }
});

// The test real-money run, 3 Nov: the SOL wallet's sale of all its ANSEM (PumpSwap, the wSOL account closed in the same
// transaction) was refused, "It doesn't show what the sale brings back": the simulation floored SOL coming in at nothing.
function lamportNodes(after: (url: string) => number) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const result = method === "getBalance" ? { value: 21_037_706 } : { value: { err: null, accounts: [{ lamports: after(String(url)), owner: SOL.system }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return () => (globalThis.fetch = real);
}
test("a sale's SOL back is read as SOL back (the smaller of two nodes' payouts), never as nothing; a buy keeps the larger spend", async () => {
  const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"]);
  let restore = lamportNodes((u) => (u.includes("a.example") ? 32_100_000 : 32_000_000));
  try {
    const s = await chain.simulate("AA==", WALLET);
    assert.equal(s.ok && s.agreed, true);
    assert.equal(s.lamportsAfter, 32_000_000n, "the smaller payout of the two");
  } finally { restore(); }
  restore = lamportNodes(() => 32_100_000);
  try {
    assert.equal((await new RpcSolChain(["https://a.example"], ["https://a.example"]).simulate("AA==", WALLET)).lamportsAfter, 32_100_000n, "one server: its payout");
  } finally { restore(); }
  // control: a buy (SOL leaves) keeps the larger spend, as before
  restore = lamportNodes((u) => (u.includes("a.example") ? 10_000_000 : 10_500_000));
  try {
    assert.equal((await chain.simulate("AA==", WALLET)).lamportsAfter, 10_000_000n);
  } finally { restore(); }
  // control: two nodes far apart on a payout don't agree (1 SOL vs 2 SOL back)
  restore = lamportNodes((u) => (u.includes("a.example") ? 1_021_037_706 : 2_021_037_706));
  try {
    const s = await chain.simulate("AA==", WALLET);
    assert.equal(s.agreed, false);
    assert.equal(s.lamportsAfter, 1_021_037_706n, "and it keeps the smaller");
  } finally { restore(); }
});
