// After the tap: broadcast, status (two nodes agree, or it's still pending), the fill read from the chain, holdings, the
// sweep back to the main balance, and a pool change. The fill cases are the old engine's (its live finding: the toast said
// the quote, 186.05, and the next Max sold 182.33: what the wallet really got).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCall } from "./abi.ts";
import { word } from "./bytes.ts";
import { KYBER_ROUTER, NATIVE } from "./chains.ts";
import { createEvmEngine, DROPPED_EXPIRE_MS } from "./engine.ts";
import { fillFromReceipt } from "./fill.ts";
import { SWAPPED_TOPIC } from "./kyber.ts";
import { TRANSFER } from "./launchpads.ts";
import { makeWorld, TEST_OWNER, TORCH, type World, kyberCapture, TORCH_META } from "./testing/world.ts";
import { parseTx, signedBytes } from "./tx.ts";
import { base64 } from "./bytes.ts";
const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));

const HASH = "0x" + "ab".repeat(32);
const BLOCK = 0x5a286db;
const tag = (n: number) => "0x" + n.toString(16);
function setup(w: Partial<World> = {}) {
  const x = makeWorld({ ky, ...w });
  const clock = { t: 1_800_000_000_000 };
  const engine = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2345.57, meta: async () => TORCH_META as never, rpc: x.rpc, fetch: x.fetch, now: () => clock.t });
  return { ...x, engine, clock };
}
const swapped = (spent: bigint, got: bigint, to = TEST_OWNER) => ({ address: KYBER_ROUTER, topics: [SWAPPED_TOPIC], data: "0x" + word("0x" + "11".repeat(20)) + word(NATIVE) + word(TORCH) + word(to) + word(spent) + word(got) });
const toWallet = (amount: bigint, from = "0x" + "22".repeat(20), to = TEST_OWNER) => ({ address: TORCH, topics: [TRANSFER, "0x" + word(from), "0x" + word(to)], data: "0x" + word(amount) });
const receipt = (logs: unknown[], status = "0x1") => ({ transactionHash: HASH, blockNumber: tag(BLOCK), status, gasUsed: "0x30d40", effectiveGasPrice: "0x" + (6n * 10n ** 7n).toString(16), logs });

test("fillFromReceipt: KyberSwap's Swapped event for this wallet gives spent and got; the fee is gasUsed x effectiveGasPrice; another receiver's event isn't ours", () => {
  const r = receipt([swapped(5n, 1234n)]);
  const f = fillFromReceipt(r, TEST_OWNER);
  assert.deepEqual([f.spentRaw, f.gotRaw, f.feeRaw, f.blockNumber], [5n, 1234n, 200_000n * 60_000_000n, BLOCK]);
  assert.equal(fillFromReceipt(receipt([swapped(5n, 1234n, "0x000000000000000000000000000000000000dead")]), TEST_OWNER).gotRaw, undefined);
});

test("a buy's figure is what the WALLET got: the coin balance after the swap's block minus before it (the log says 1000, the wallet got 980)", async () => {
  const s = setup({ receipts: { [HASH]: receipt([toWallet(1000n)]) }, coinAt: (t) => (t === tag(BLOCK) ? 5_980n : t === tag(BLOCK - 1) ? 5_000n : new Error("unexpected " + t)), nativeAt: () => 10n ** 16n });
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  const f = await s.engine.fill(p, HASH);
  assert.equal(f!.got, "980");
  assert.equal(f!.spent, String(parseTx(p.steps.at(-1)!.tx).value), "a buy spent its msg.value");
  assert.equal(f!.fee, String(200_000n * 60_000_000n));
  assert.equal(f!.coinAfter, "5980");
});

test("...what arrived is never more than the balance says: the smaller of the balance delta and the coin's own log; the log alone only when the balance can't be read, capped and marked as an estimate", async () => {
  const cases: [Parameters<typeof setup>[0]["coinAt"], string, boolean][] = [
    [(t: string) => (t === tag(BLOCK) ? 5_200n : 5_000n), "200", false],   // the coin logs 1000, the balance rose 200 (a coin that lies): 200
    [(t: string) => (t === tag(BLOCK) ? 6_200n : 5_000n), "1000", false],  // the balance rose 1200 (another transfer in that block): the log's 1000
    [() => new Error("node down"), "1000", true],                         // no balance: the log, marked "about"
  ];
  for (const [at, got, estimated] of cases) {
    const s = setup({ receipts: { [HASH]: receipt([toWallet(1000n)]) }, coinAt: at, nativeAt: () => 10n ** 16n });
    const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
    const f = (await s.engine.fill(p, HASH))!;
    assert.deepEqual([f.got, !!f.estimated], [got, estimated]);
  }
});

test("a sell's figure is the native coin that arrived (balance after - before + its own fee); the coins sent are its Transfer out of the wallet", async () => {
  const sold = 10n ** 18n;
  const s = setup({ tokenBal: sold, receipts: { [HASH]: receipt([toWallet(sold, TEST_OWNER, "0x" + "33".repeat(20))]) }, nativeAt: (t) => (t === tag(BLOCK) ? 10n ** 16n + 4n * 10n ** 14n : 10n ** 16n), coinAt: (t) => (t === tag(BLOCK) ? 0n : sold) });
  const p = await s.engine.prepare("sell", TORCH, { fraction: 1 });
  const f = await s.engine.fill(p, HASH);
  assert.equal(f!.got, String(4n * 10n ** 14n + 200_000n * 60_000_000n));
  assert.equal(f!.spent, String(sold));
  assert.equal(f!.nativeAfter, String(10n ** 16n + 4n * 10n ** 14n));
});

test("a reverted swap, or one no node has a receipt for, has no fill", async () => {
  const s = setup({ receipts: { [HASH]: receipt([toWallet(1000n)], "0x0") } });
  const p = await s.engine.prepare("buy", TORCH, { usd: 5 });
  assert.equal(await s.engine.fill(p, HASH), undefined);
  assert.equal(await s.engine.fill(p, "0x" + "cd".repeat(32)), undefined);
});

test("status: confirmed or failed only when two nodes agree; one node's receipt is still pending", async () => {
  const s = setup({ receipts: { [HASH]: receipt([]) } });
  assert.equal(await s.engine.status(HASH), "confirmed");
  assert.equal(await setup({ receipts: { [HASH]: receipt([], "0x0") } }).engine.status(HASH), "failed");
  const one = setup();
  let n = 0;
  const ask = one.rpc.askNodes;
  one.rpc.askNodes = async (m, p, max, o) => (m === "eth_getTransactionReceipt" ? [{ ok: true, value: n++ === 0 ? receipt([]) : null }, { ok: true, value: null }] : ask(m, p, max, o));
  assert.equal(await one.engine.status(HASH), "pending");
  const none = setup();
  none.rpc.askNodes = async () => [{ ok: false, error: "timed out", said: false }];
  assert.equal(await none.engine.status(HASH), "unknown");
});

test("status 'expired': two nodes know no receipt and no such transaction and its nonce was used by another; or it was dropped everywhere for 3 minutes with the nonce still free", async () => {
  const taken = setup({ nonce: 9 });
  assert.equal(await taken.engine.status(HASH, { id: "swap", tx: "", nonce: 7 }), "expired");
  const dropped = setup({ nonce: 7 });
  assert.equal(await dropped.engine.status(HASH, { id: "swap", tx: "", nonce: 7 }), "pending");
  dropped.clock.t += DROPPED_EXPIRE_MS + 1;
  assert.equal(await dropped.engine.status(HASH, { id: "swap", tx: "", nonce: 7 }), "expired");
  const known = setup({ nonce: 9, extra: (m) => (m === "eth_getTransactionByHash" ? { hash: HASH } : undefined) });
  assert.equal(await known.engine.status(HASH, { id: "swap", tx: "", nonce: 7 }), "pending", "a node still has it: never expired");
  assert.equal(await taken.engine.status(HASH), "pending", "without its step there is no nonce to judge by");
});

test("holdings: the native balance and the coins asked for (or seen), with their decimals; a lagging node's pre-trade balance is corrected", async () => {
  const s = setup({ tokenBal: 777n, balance: 10n ** 16n });
  const h = await s.engine.holdings([TORCH]);
  assert.deepEqual(h, { native: String(10n ** 16n), coins: [{ coin: TORCH, raw: "777", decimals: 18 }] });
  s.engine.memory.settle(`${TEST_OWNER}:${TORCH}`, 1_777n, s.clock.t);   // a buy just settled
  assert.equal((await s.engine.holdings([TORCH])).coins[0]!.raw, "1777", "the node one block behind is corrected");
  await s.engine.prepare("sell", TORCH, { fraction: 1 }).catch(() => undefined);
  assert.deepEqual((await s.engine.holdings()).coins.map((c) => c.coin), [TORCH], "a coin this engine traded is read without being named");
});

test("transfer out: exactly the amount, or 'all' leaving exactly the most the gas can cost; a plain send's gas, the next nonce, nothing else in it", async () => {
  const bal = 10n ** 16n;
  const s = setup({ balance: bal });
  const to = "0x" + "44".repeat(20);
  const p = await s.engine.transfer!(to, "123456789");
  const t = parseTx(p.steps[0]!.tx);
  assert.deepEqual([t.to, t.value, t.data, t.nonce, t.chainId, p.steps[0]!.id], [to, 123456789n, "0x", 7, 4663, "swap"]);
  assert.equal(t.gas, (0x30d40n * 125n + 99n) / 100n, "Robinhood: the estimate + 25 % (its L1 data units move)");
  const all = parseTx((await s.engine.transfer!(to, "all")).steps[0]!.tx);
  assert.equal(all.value + all.gas * all.maxFeePerGas, bal);
  await assert.rejects(s.engine.transfer!(to, String(bal)), (e: unknown) => (e as { kind?: string }).kind === "funds");
  await assert.rejects(setup({ balance: 0n }).engine.transfer!(to, "all"), (e: unknown) => (e as { reason?: string }).reason === "wallet-empty");
  await assert.rejects(s.engine.transfer!("0x1234", "1"));
});

test("poolChanged: the next quote reads the pool again instead of the 1.5 s reserves window", async () => {
  const PAIR = "0x" + "cd".repeat(20), TOKEN = "0x" + "ab".repeat(20);
  const x = makeWorld({ ky, chain: "bsc", balance: 10n ** 17n, v2: { pair: PAIR, token: TOKEN, rToken: 5_000_000n * 10n ** 18n, rWeth: 2_000n * 10n ** 18n }, extra: (m, p) => (m === "eth_call" && p[0]?.from ? "0x" : undefined) });
  const engine = createEvmEngine({ chain: "bsc", owner: TEST_OWNER, nativeUsd: async () => 600, meta: async () => TORCH_META as never, rpc: x.rpc, fetch: x.fetch, now: () => 1_800_000_000_000 });
  await engine.prepare("buy", TOKEN, { usd: 5 });
  const reserves = () => x.calls.filter((c) => c.method === "eth_call" && c.params[0].to === PAIR).length;
  const n = reserves();
  await engine.prepare("buy", TOKEN, { usd: 6 });
  assert.equal(reserves(), n, "inside the window: no read");
  engine.poolChanged(TOKEN);
  await engine.prepare("buy", TOKEN, { usd: 6 });
  assert.equal(reserves(), n + 1);
});

test("a step's approve is decodable as exactly approve(spender, amount): the signer's decoder sees the same", async () => {
  const s = setup({ tokenBal: 42n * 10n ** 18n });
  const p = await s.engine.prepare("sell", TORCH, { fraction: 1 });
  const ap = parseTx(p.steps[0]!.tx);
  assert.deepEqual(decodeCall("approve(address,uint256)", ap.data), [KYBER_ROUTER, 42n * 10n ** 18n]);
  // sent back signed, it is broadcast and its nonce is never handed out again
  await s.engine.send(base64(signedBytes(ap, { yParity: 0, r: 2n, s: 3n })));
  await s.engine.send(base64(signedBytes(parseTx(p.steps[1]!.tx), { yParity: 0, r: 2n, s: 3n })));
  s.clock.t += 1_000;
  assert.equal((await s.engine.prepare("buy", TORCH, { usd: 1 })).steps[0]!.nonce, 9);
});

test("whyFailed (TORCH, live: six sells reverted 'STF', an allowance refusal, and every one read 'price moved'): STF at the block before is 'refused', a floor revert 'moved', a replay that passes says nothing", async () => {
  const REVERTED = { status: "0x0", blockNumber: "0x5a286db", gasUsed: "0x1e770", logs: [] };
  const step = { id: "swap" as const, tx: base64(signedBytes({ chainId: 4663, nonce: 83, to: "0xcaf681a66d020601342297493863e78c959e5cb2", value: 0n, gas: 307_888n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, data: "0x5ae401dc" }, { yParity: 0, r: 1n, s: 1n })).slice(0), nonce: 83 };
  const unsignedStep = { ...step, tx: (await import("./tx.ts")).unsignedTx(parseTx(step.tx)) };
  const run = async (answer: (tag: string) => unknown) => {
    const tags: string[] = [];
    const s = setup({ receipts: { [HASH]: REVERTED }, extra: (m, p) => { if (m === "eth_call" && p[0]?.from) { tags.push(p[1]); return answer(p[1]); } return undefined; } });
    return { why: await s.engine.whyFailed(HASH, unsignedStep), tags };
  };
  const { ChainSaid } = await import("./rpc.ts");
  const stf = await run(() => new ChainSaid("execution reverted: STF", 3, "0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000035354460000000000000000000000000000000000000000000000000000000000"));
  assert.deepEqual(stf, { why: "refused", tags: ["0x5a286da"] });
  assert.equal((await run(() => new ChainSaid("execution reverted: Too little received", 3))).why, "moved");
  assert.equal((await run(() => "0x")).why, undefined);
  const gone = await run((t) => (t === "latest" ? new ChainSaid("execution reverted: STF", 3) : new ChainSaid("historical state ed01d684 is not available", -32000)));
  assert.deepEqual(gone, { why: "refused", tags: ["0x5a286da", "latest"] });
});
