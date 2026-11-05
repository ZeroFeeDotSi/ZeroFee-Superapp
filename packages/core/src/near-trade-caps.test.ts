// Review L6 (3 Nov): a NEAR coin trade through the core's own door: within D143's caps it signs with no sheet; past $100
// a tap, past $500 a day, or with no price, the one-tap sheet asks (naming the coin and the amounts, L5) and a no signs
// nothing; two asks at once both sign, with different nonces; a coin's account opens once a day at most (M2); shut, none.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes } from "@fastnear/utils";
import type { Block, Chain } from "./chain.ts";
import { NEAR_GATE, REF_EXCHANGE_ID, WNEAR, type NearTradeAsk } from "./near-trade.ts";
import type { PlainWords } from "./signer.ts";
import type { EvmChain } from "./evm.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { decodeTransaction } from "./tx-decode.ts";
import { MemoryVault } from "./vault.ts";

const COIN = "blackdragon.tkn.near";
const NEAR = 10n ** 24n;
before(() => { NEAR_GATE.open = true; });
after(() => { NEAR_GATE.open = false; });

/** Two agreeing nodes: a deep plain pool (1 NEAR = 4 coins of 24 places, the coin $1 and NEAR $4: fair both ways). */
function chain(o: { coinReg?: boolean } = {}): Chain {
  const block: Block = { hash: "11111111111111111111111111111111", height: 1 };
  return {
    network: "mainnet",
    commonBlock: async () => block,
    accessKey: async (_a: string, pk: string) => ({ handle: pk, nonce: 41n, permission: { kind: "full" } }),
    view: async (c: string, m: string, args: Record<string, unknown>) => {
      if (c === REF_EXCHANGE_ID && m === "get_pool") return { pool_kind: "SIMPLE_POOL", token_account_ids: [COIN, WNEAR], amounts: [String(10n ** 32n), String(100_000n * NEAR)] };
      if (c === REF_EXCHANGE_ID && m === "get_return") return String(args.token_in === WNEAR ? BigInt(String(args.amount_in)) * 4n : BigInt(String(args.amount_in)) / 4n);
      if (m === "ft_metadata") return { decimals: 24, symbol: "BLACKDRAGON" };
      if (m === "storage_balance_of") return c === COIN && o.coinReg === false ? null : { total: "1" };
      if (m === "storage_balance_bounds") return { min: "1250000000000000000000" };
      if (m === "ft_balance_of") return c === WNEAR ? "0" : String(1000n * NEAR);
      return null;
    },
  } as unknown as Chain;
}

function setup(o: { coinUsd?: number | null; answer?: boolean; coinReg?: boolean } = {}) {
  const shown: PlainWords[] = [];
  const w = new SubWallets({
    vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, near: chain(o), emit: () => {},
    usdPrice: async (c) => (c === "near" ? 4 : 150),
    tokenPrice: async (t) => (o.coinUsd === null ? null : { usd: o.coinUsd ?? 1, decimals: 24 }),
    approve: async (words) => (shown.push(words), o.answer ?? true),
  });
  return { w, shown };
}
const buyOf = (near: bigint): NearTradeAsk => ({ side: "buy", coin: COIN, poolId: 4276, amountIn: String(near), minOut: String((near * 4n * 98n) / 100n) });
const nonceOf = (signedTx: string) => decodeTransaction(base64ToBytes(signedTx).slice(0, -65)).nonce;

test("within the caps: signed with no sheet (a $20 buy)", async () => {
  const { w, shown } = setup();
  const r = await w.nearTrade(buyOf(5n * NEAR));
  assert.ok("signedTx" in r);
  assert.equal(shown.length, 0);
});

test("past $100 a tap: the one-tap sheet names the coin, what goes in and the least back; a no signs nothing (control: a yes signs)", async () => {
  const no = setup({ answer: false });
  const r = await no.w.nearTrade(buyOf(30n * NEAR));   // $120
  assert.deepEqual(r, { declined: true });
  assert.equal(no.shown.length, 1);
  assert.equal(no.shown[0]!.title, "Buy BLACKDRAGON with 30 NEAR");
  assert.ok(no.shown[0]!.lines.some((l) => /At least 117\.6 BLACKDRAGON back/.test(l)), no.shown[0]!.lines.join(" | "));
  assert.ok(no.shown[0]!.warnings.some((x) => /over \$100/.test(x.text)));
  const yes = setup();
  assert.ok("signedTx" in (await yes.w.nearTrade(buyOf(30n * NEAR))));
  assert.equal(yes.shown.length, 1);
});

test("a sale's sheet says it as a sale: the coins, for NEAR, the least NEAR back", async () => {
  const { w, shown } = setup({ answer: false });
  await w.nearTrade({ side: "sell", coin: COIN, poolId: 4276, amountIn: String(480n * NEAR), minOut: String(118n * NEAR) });   // $120
  assert.equal(shown[0]!.title, "Sell 480 BLACKDRAGON for NEAR");
  assert.ok(shown[0]!.lines.some((l) => /At least 118 NEAR back/.test(l)));
});

test("no price for the coin: the sheet asks, even for $1 (control: priced, none)", async () => {
  const { w, shown } = setup({ coinUsd: null, answer: false });
  assert.deepEqual(await w.nearTrade(buyOf(NEAR / 4n)), { declined: true });
  assert.ok(shown[0]!.warnings.some((x) => /price couldn't be read/.test(x.text)));
});

test("past $500 in a day: the sixth $96 buy asks (control: the first five didn't)", async () => {
  const { w, shown } = setup({ answer: false });
  for (let i = 0; i < 5; i++) assert.ok("signedTx" in (await w.nearTrade(buyOf(24n * NEAR))));
  assert.equal(shown.length, 0);
  assert.deepEqual(await w.nearTrade(buyOf(24n * NEAR)), { declined: true });
  assert.ok(shown[0]!.warnings.some((x) => /past \$500/.test(x.text)));
});

test("two asks at once: both signed, one after the other, with different nonces (control: one alone takes the chain's next)", async () => {
  const { w } = setup();
  const [a, b] = await Promise.all([w.nearTrade(buyOf(NEAR)), w.nearTrade(buyOf(2n * NEAR))]);
  assert.ok("signedTx" in a && "signedTx" in b);
  const n = [nonceOf(a.signedTx), nonceOf(b.signedTx)].sort();
  assert.deepEqual(n, [42n, 43n]);
  const one = setup();
  const c = await one.w.nearTrade(buyOf(NEAR));
  assert.equal("signedTx" in c && nonceOf(c.signedTx), 42n);
});

test("M2: a coin's account opens at most once a day (control: the first one opens)", async () => {
  const { w } = setup({ coinReg: false });
  assert.ok("signedTx" in (await w.nearRegister(COIN, 4276)));
  await assert.rejects(w.nearRegister(COIN, 4276), (e: { problem?: { more?: string } }) => /opened today/.test(e.problem?.more ?? ""));
  await assert.rejects(w.nearRegister(COIN), (e: { problem?: { code?: string } }) => e.problem?.code === "security.request.invalid", "a coin's account needs its pool");
});

test("shut (every phone until the test run): no NEAR coin trade or account is signed (control: open, above)", async () => {
  const { w } = setup();
  NEAR_GATE.open = false;
  try {
    await assert.rejects(w.nearTrade(buyOf(NEAR)), (e: { problem?: { more?: string } }) => /open soon/.test(e.problem?.more ?? ""));
    await assert.rejects(w.nearRegister(COIN, 4276), (e: { problem?: { more?: string } }) => /open soon/.test(e.problem?.more ?? ""));
  } finally { NEAR_GATE.open = true; }
});
