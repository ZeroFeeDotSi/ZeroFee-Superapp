// Speed (4 Nov: Robinhood Chain and BNB Chain taps spent 0.6 to 3 s on the core's reads, Solana's 2 to 7 ms):
// subwallet.preflight makes Trade's own BNB Chain or Robinhood Chain transaction's NETWORK READS ahead of the tap (the
// nonce, the two-node test run, the trade's reads, the prices), kept for one signTx of those exact bytes and that coin
// within PREFLIGHT_MS. Never a verdict: every check of signEvm runs again at the tap on those reads. A sale's swap is
// preflighted after its approve, as the tap runs it. Controls: none, stale, other bytes, another caller: read in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unsignedEvmTx } from "./evm.ts";
import type { EvmCall, EvmChain, EvmSimulated } from "./evm.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { PREFLIGHT_MS, SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const V2 = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const ONE = 10n ** 18n;

const w = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "")).padStart(64, "0");
const tx = (to: string, value: bigint, data: string, nonce = 0) => unsignedEvmTx({ chainId: 56, nonce, tip: 1_000_000_000n, fee: 3_000_000_000n, gas: 300_000n, to, value, data });
const approve = (spender: string, amount: bigint) => `0x095ea7b3${w(spender)}${w(amount)}`;
/** swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, CAKE], to, deadline) */
const v2Buy = (min: bigint, to: string) => `0xb6f9de95${w(min)}${w(0x80n)}${w(to)}${w(2_000_000_000n)}${w(2n)}${w(WBNB)}${w(CAKE)}`;
/** swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, min, [CAKE, WBNB], to, deadline) */
const v2Sell = (amountIn: bigint, min: bigint, to: string) => `0x791ac947${w(amountIn)}${w(min)}${w(0xa0n)}${w(to)}${w(2_000_000_000n)}${w(2n)}${w(CAKE)}${w(WBNB)}`;

/**
 * Trade's BNB Chain wallet on nodes that count every read. Their test run is the chain's: a buy brings 1,000,000 CAKE; a
 * sale brings 0.1 BNB only when it runs after its approve (alone it reverts: no allowance). CAKE is $0.06 (1,000 = $60).
 */
async function setup(o: { gasUsed?: bigint } = {}) {
  let reads = 0;
  const runs: EvmCall[][] = [];
  const evm = {
    nonce: async () => (reads++, 0),
    head: async () => (reads++, { number: 100n, hash: "0x01" }),
    simulate: async (_c: string, calls: EvmCall[]): Promise<EvmSimulated> => {
      reads++;
      runs.push(calls);
      const last = calls.at(-1)!;
      const base = { agreed: true, balance: ONE, ...(o.gasUsed !== undefined ? { gasUsed: o.gasUsed } : {}) };
      if (last.to === CAKE) return { ...base, ok: true, coinsIn: new Map() };
      if (last.value > 0n) return { ...base, ok: true, coinsIn: new Map([[CAKE, 1_000_000n * ONE]]) };
      return calls.length > 1 && calls[0]!.to === CAKE ? { ...base, ok: true, nativeIn: ONE / 10n, coinsIn: new Map([[CAKE, -1000n * ONE]]) } : { ...base, ok: false };
    },
    tokenBalance: async () => (reads++, 1_000_000n * ONE),
    token: async (_c: string, t: string) => (reads++, t === CAKE ? { symbol: "CAKE", decimals: 18 } : undefined),
    ponsCurve: async () => (reads++, null),
  } as unknown as EvmChain;
  const shown: PlainWords[] = [];
  const vault = new MemoryVault();
  const wallets = new SubWallets({
    vault, sol: {} as SolChain, evm,
    usdPrice: async () => (reads++, 600),
    marketPrice: async () => (reads++, 0.06),
    approve: async (words) => (shown.push(words), false), emit: () => {},
  });
  const t = await wallets.create("trade", "bsc");
  const sign = (b64: string, app: string | null = "trade", coin: string = CAKE) => wallets.signTx(t.id, b64, "", coin, "Trade", undefined, app ?? undefined);
  return { wallets, t, vault, shown, runs, sign, reads: () => reads };
}

const signed = (r: unknown) => typeof r === "object" && r !== null && "signedTx" in r;

test("a preflighted BNB Chain buy signs at the tap with zero network calls and no sheet (control: with no preflight the tap reads the chain)", async () => {
  const s = await setup();
  const buy = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, s.t.address));
  assert.deepEqual(await s.wallets.preflight(s.t.id, buy, "trade", undefined, undefined, CAKE), { ok: true });
  const before = s.reads();
  assert.ok(signed(await s.sign(buy)));
  assert.equal(s.reads() - before, 0, "no network call at the tap");
  assert.equal(s.shown.length, 0);
  // control: no preflight (a second use of the same one, or a fresh core) reads
  const at = s.reads();
  await s.sign(buy).catch(() => undefined);
  assert.ok(s.reads() > at, "used once: a second tap reads in full");
  const cold = await setup();
  const b = cold.reads();
  assert.ok(signed(await cold.sign(tx(V2, ONE / 10n, v2Buy(900_000n * ONE, cold.t.address)))));
  assert.ok(cold.reads() > b, "control: no preflight, the tap reads");
});

test("a stale preflight, other bytes, another coin, another caller: the tap reads and checks in full; a preflight with a site keeps nothing", async () => {
  const s = await setup();
  const buy = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, s.t.address));
  // stale: past PREFLIGHT_MS
  assert.deepEqual(await s.wallets.preflight(s.t.id, buy, "trade", undefined, undefined, CAKE), { ok: true });
  const real = Date.now;
  const late = real() + PREFLIGHT_MS + 1;
  Date.now = () => late;
  try {
    const at = s.reads();
    assert.ok(signed(await s.sign(buy)));
    assert.ok(s.reads() > at, "stale: read in full");
  } finally {
    Date.now = real;
  }
  // other bytes: a preflighted fair buy never stands for one with a 1-unit floor, which is checked and refused
  assert.deepEqual(await s.wallets.preflight(s.t.id, tx(V2, ONE / 10n, v2Buy(900_000n * ONE, s.t.address), 1), "trade", undefined, undefined, CAKE), { ok: true });
  const at = s.reads();
  await assert.rejects(s.sign(tx(V2, ONE / 10n, v2Buy(1n, s.t.address), 1)), (e: any) => /minimum is far under what it gets\./i.test(e.problem?.more));
  assert.ok(s.reads() > at, "other bytes: read in full");
  // another coin told with the same bytes; another caller (ZeroFee's own screens, another app)
  for (const [app, coin] of [["trade", WBNB], [null, CAKE], ["browser", CAKE]] as const) {
    const c = await setup();
    const b = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, c.t.address));
    assert.deepEqual(await c.wallets.preflight(c.t.id, b, "trade", undefined, undefined, CAKE), { ok: true });
    const r = c.reads();
    await c.sign(b, app, coin).catch(() => undefined);
    assert.ok(c.reads() > r, `${app ?? "no app"} / ${coin}: not shared`);
  }
  // only Trade's own calls are preflighted
  const n = await setup();
  const b = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, n.t.address));
  assert.deepEqual(await n.wallets.preflight(n.t.id, b, "trade", { origin: "https://pancakeswap.finance" }, undefined, CAKE), { ok: false });
  assert.deepEqual(await n.wallets.preflight(n.t.id, b, "browser", undefined, undefined, CAKE), { ok: false });
});

test("a sale's approve and swap are preflighted together: the swap's test run runs after the approve, and the tap signs both with zero network calls (controls: the swap preflighted alone, or tapped before its approve, is read and checked in full)", async () => {
  const s = await setup();
  const ap = tx(CAKE, 0n, approve(V2, 1000n * ONE), 0);
  const sw = tx(V2, 0n, v2Sell(1000n * ONE, (ONE / 10n) * 9n / 10n, s.t.address), 1);
  const [a, b] = await Promise.all([s.wallets.preflight(s.t.id, ap, "trade", undefined, undefined, CAKE), s.wallets.preflight(s.t.id, sw, "trade", undefined, undefined, CAKE, [ap])]);
  assert.deepEqual([a, b], [{ ok: true }, { ok: true }]);
  const swapRun = s.runs.find((r) => r.at(-1)!.to === V2)!;
  assert.deepEqual(swapRun.map((c) => c.to), [CAKE, V2], "the swap was test-run after its approve");
  const before = s.reads();
  assert.ok(signed(await s.sign(ap)), "the approve");
  assert.ok(signed(await s.sign(sw)), "the swap");
  assert.equal(s.reads() - before, 0, "no network call at the tap, for either step");
  assert.equal(s.shown.length, 0);

  // control: the swap preflighted alone (its test run reverts): the approve's signing drops it, and the tap runs it again
  // after the approve, in full
  const alone = await setup();
  const ap2 = tx(CAKE, 0n, approve(V2, 1000n * ONE), 0), sw2 = tx(V2, 0n, v2Sell(1000n * ONE, (ONE / 10n) * 9n / 10n, alone.t.address), 1);
  await alone.wallets.preflight(alone.t.id, ap2, "trade", undefined, undefined, CAKE);
  assert.deepEqual(await alone.wallets.preflight(alone.t.id, sw2, "trade", undefined, undefined, CAKE), { ok: true });
  assert.ok(signed(await alone.sign(ap2)));
  const at = alone.reads();
  assert.ok(signed(await alone.sign(sw2)));
  assert.ok(alone.reads() > at, "read in full");
  assert.deepEqual(alone.runs.at(-1)!.map((c) => c.to), [CAKE, V2]);

  // control: the swap tapped before its approve was signed: its kept run (after the approve) isn't this tap's; checked in
  // full on its own, its test run reverts, and nothing is signed
  const early = await setup();
  const ap3 = tx(CAKE, 0n, approve(V2, 1000n * ONE), 0), sw3 = tx(V2, 0n, v2Sell(1000n * ONE, (ONE / 10n) * 9n / 10n, early.t.address), 0 + 1);
  await early.wallets.preflight(early.t.id, sw3, "trade", undefined, undefined, CAKE, [ap3]);
  const e0 = early.reads();
  await assert.rejects(early.sign(sw3), (e: any) => /^Its test run didn't go through/.test(e.problem?.more));
  assert.ok(early.reads() > e0);

  // control: another signature from the wallet in between (not the approve) drops the swap's preflight, even when the
  // approve itself is signed after it (its test run would match again)
  const other = await setup();
  const ap4 = tx(CAKE, 0n, approve(V2, 1000n * ONE), 0), sw4 = tx(V2, 0n, v2Sell(1000n * ONE, (ONE / 10n) * 9n / 10n, other.t.address), 1);
  await other.wallets.preflight(other.t.id, sw4, "trade", undefined, undefined, CAKE, [ap4]);
  assert.ok(signed(await other.sign(tx(CAKE, 0n, approve(V2, 999n * ONE), 0))), "a different approve");
  assert.ok(signed(await other.sign(ap4)), "then the approve itself");
  const o0 = other.reads();
  await other.sign(sw4).catch(() => undefined);
  assert.ok(other.reads() > o0, "dropped: read in full");
});

test("never a cached verdict: the one cap and M6's gas rule run again at the tap on the preflight's reads", async () => {
  // the cap: the day already full when the preflighted buy is tapped: the one-tap sheet, nothing read
  const s = await setup();
  const buy = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, s.t.address));
  assert.deepEqual(await s.wallets.preflight(s.t.id, buy, "trade", undefined, undefined, CAKE), { ok: true });
  await s.vault.put("hot-spent", new TextEncoder().encode(JSON.stringify({ all: [[Date.now(), 480]] })));
  const before = s.reads();
  assert.deepEqual(await s.sign(buy), { declined: true });
  assert.equal(s.shown.at(-1)!.warnings[0]?.text, "It's past $500 in a day, so ZeroFee asks you.");
  assert.equal(s.reads() - before, 0);
  // M6: a gas limit far over the kept test run's gas is refused at the tap (control: within it, signed above)
  const g = await setup({ gasUsed: 50_000n });
  const b = tx(V2, ONE / 10n, v2Buy(900_000n * ONE, g.t.address));
  assert.deepEqual(await g.wallets.preflight(g.t.id, b, "trade", undefined, undefined, CAKE), { ok: true });
  const at = g.reads();
  await assert.rejects(g.sign(b), (e: any) => /^It sets a network fee limit far above what its test run used/.test(e.problem?.more));
  assert.equal(g.reads() - at, 0);
});
