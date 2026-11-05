// Gap 5 (coverage audit, the review's ruling 4 Nov): a coin quoted in the chain's dollar coin (Robinhood Chain's PONS, $58.7M
// against USDG, no pool against ETH) trades in one UniversalRouter transaction through that middle coin. What Trade builds
// is read by the core's own decoder exactly, and judged by its session rule: only a pinned middle coin, paid to this
// wallet; any other shape is unreadable. Checked live 4 Nov, read-only (no key): PONS's buy and a real holder's sale through
// these very bytes pass every core check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abiEncode, encodeCall } from "./abi.ts";
import { CLASSIC, V4 } from "./chains.ts";
import { buildTwoHopBuy, buildTwoHopSell, CONTRACT_BALANCE, MIDS, ROUTER_SELF, v3Path, type HopRoute } from "./twohop.ts";
import { unsignedTx } from "./tx.ts";
import { decodeEvmTx } from "../../../core/src/evm/decode.ts";
import { evmSessionRefusal } from "../../../core/src/evm.ts";
import { MIDDLE_COINS } from "../../../core/src/evm/middle-coins.ts";
import { middleLeftRefusal } from "../../../core/src/subwallets.ts";

const WALLET = "0x332904f151c62a1d8d2ccf42014040473219ec55", PONS = "0x737df083d13e3dd623b1370925c736a5b19870bb", USDG = MIDS.hood[0]!.coin;  // generated sample
const WETH = CLASSIC.hood.weth;
const route: HopRoute = {
  mid: USDG,
  v3: { kind: "v3", address: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca", fee: 100, router: CLASSIC.hood.v3Router, name: "Uniswap v3" },
  v4: { id: "0xb3939d6c5dbac86e20b60ab26dde3881abbd29727be696ac1c1c58a589e0254e", key: { currency0: USDG, currency1: PONS, fee: 0, tickSpacing: 1, hooks: "0x0000000000000000000000000000000000000000" } },
};
const tx = (c: { to: string; data: string; value: bigint }) => unsignedTx({ chainId: 4663, nonce: 7, maxPriorityFeePerGas: 0n, maxFeePerGas: 10n ** 8n, gas: 400_000n, to: c.to, value: c.value, data: c.data });
/** USDG's deepest v3 tier against WETH on Robinhood Chain is 0.01 % (3,328 WETH, read 4 Nov): the route's own. */
const facts = { balances: new Map<string, bigint>(), ponsCurve: null, midDeepest: 100 };

test("Trade's middle coins are the core's pinned ones (USDG on Robinhood Chain, read on two nodes)", () => {
  for (const [chain, mids] of Object.entries(MIDS)) for (const m of mids) assert.ok(Object.hasOwn(MIDDLE_COINS[chain as "hood"], m.coin), `${chain} ${m.symbol}`);
  assert.equal(MIDDLE_COINS.hood[USDG], "USDG");
});

test("the two-hop buy and sale read back in the core exactly, and pass its session rule (paid to this wallet, through USDG)", () => {
  const b = decodeEvmTx(tx(buildTwoHopBuy("hood", route, PONS, 2n * 10n ** 14n, 2_000n, 1_800_000_000)));
  assert.equal(b.unreadable, undefined);
  assert.deepEqual(b.swaps.map((s) => [s.side, s.coin, s.inRaw, s.minOutRaw, s.path, s.midFee, s.hooks]), [["buy", PONS, String(2n * 10n ** 14n), "2000", [WETH, USDG, PONS], 100, "0x0000000000000000000000000000000000000000"]]);
  assert.equal(evmSessionRefusal(b, WALLET, "hood", facts, 1), null);
  const s = decodeEvmTx(tx(buildTwoHopSell("hood", route, PONS, WALLET, 5n * 10n ** 18n, 3_000n, 1_800_000_000)));
  assert.equal(s.unreadable, undefined);
  assert.deepEqual(s.swaps.map((x) => [x.side, x.coin, x.inRaw, x.minOutRaw, x.recipient, x.path]), [["sell", PONS, String(5n * 10n ** 18n), "3000", WALLET, [PONS, USDG, WETH]]]);
  assert.equal(evmSessionRefusal(s, WALLET, "hood", facts, 1), null);
  // control: the sale paid to someone else
  const other = decodeEvmTx(tx(buildTwoHopSell("hood", route, PONS, "0x" + "34".repeat(20), 5n * 10n ** 18n, 3_000n, 1_800_000_000)));
  assert.equal(evmSessionRefusal(other, WALLET, "hood", facts, 1), "It pays out to someone else.");
});

test("review L4: the middle hop is on the middle coin's deepest v3 tier, read on two nodes (controls: another tier; unread)", () => {
  const b = decodeEvmTx(tx(buildTwoHopBuy("hood", route, PONS, 2n * 10n ** 14n, 2_000n, 1_800_000_000)));
  assert.equal(evmSessionRefusal(b, WALLET, "hood", facts, 1), null, "0.01 %, the deepest");
  assert.equal(evmSessionRefusal(b, WALLET, "hood", { ...facts, midDeepest: 500 }, 1), "It doesn't trade on the middle coin's deepest pool.", "a thinner tier");
  assert.equal(evmSessionRefusal(b, WALLET, "hood", { ...facts, midDeepest: null }, 1), "It doesn't trade on the middle coin's deepest pool.", "unread");
});

test("an unlisted middle coin goes through another coin first: refused (control: USDG passes, above)", () => {
  const MID = "0x" + "77".repeat(20);
  const b = decodeEvmTx(tx(buildTwoHopBuy("hood", { ...route, mid: MID, v4: { ...route.v4, key: { ...route.v4.key, currency0: MID } } }, PONS, 2n * 10n ** 14n, 2_000n, 1_800_000_000)));
  assert.equal(b.unreadable, undefined);
  assert.equal(evmSessionRefusal(b, WALLET, "hood", facts, 1), "It goes through another coin first.");
});

// The decoder reads only the exact shapes: each change below is unreadable (no swap at all), never a looser trade
const UR = V4.hood.universalRouter, EXEC = "execute(bytes,bytes[],uint256)";
const V3_IN = ["address", "uint256", "uint256", "bytes", "bool", "uint256[]"];
const EXACT_IN = "(address,(address,uint24,int24,address,bytes)[],uint256[],uint128,uint128)";
function buyWith(o: { v3To?: string; payerIsUser?: boolean; settlePayer?: boolean; amountIn?: bigint; paths?: number; minHop?: bigint[]; v3MinHop?: bigint[]; take?: string; wrap?: bigint; value?: bigint; cmds?: string; extra?: string[] } = {}) {
  const amt = 2n * 10n ** 14n;
  const wrap = abiEncode(["address", "uint256"], [ROUTER_SELF, o.wrap ?? amt]);
  const v3 = abiEncode(V3_IN, [o.v3To ?? ROUTER_SELF, amt, 0n, v3Path(WETH, 100, USDG), o.payerIsUser ?? false, o.v3MinHop ?? []]);
  const settle = abiEncode(["address", "uint256", "bool"], [USDG, CONTRACT_BALANCE, o.settlePayer ?? false]);
  const key = [PONS, 0n, 1n, "0x0000000000000000000000000000000000000000", "0x"];
  const swap = abiEncode([EXACT_IN], [[USDG, new Array(o.paths ?? 1).fill(key), o.minHop ?? [], o.amountIn ?? 0n, 2_000n]]);
  const take = abiEncode(["address", "uint256"], [o.take ?? PONS, 2_000n]);
  const v4 = abiEncode(["bytes", "bytes[]"], ["0x0b070f", [settle, swap, take]]);
  return decodeEvmTx(tx({ to: UR, data: encodeCall(EXEC, [o.cmds ?? "0x0b0010", [wrap, v3, v4, ...(o.extra ?? [])], 1_800_000_000n]), value: o.value ?? amt }));
}
/** The two-hop sale as buildTwoHopSell makes it, with one field changed. */
function sellWith(o: { takeTo?: string; v3Amount?: bigint; value?: bigint; cmds?: string; extra?: string[]; hookData?: string } = {}) {
  const amt = 5n * 10n ** 18n;
  const swap = abiEncode([EXACT_IN], [[PONS, [[USDG, 0n, 1n, "0x0000000000000000000000000000000000000000", o.hookData ?? "0x"]], [], amt, 0n]]);
  const settle = abiEncode(["address", "uint256", "bool"], [PONS, amt, true]);
  const take = abiEncode(["address", "address", "uint256"], [USDG, o.takeTo ?? ROUTER_SELF, 0n]);
  const v4 = abiEncode(["bytes", "bytes[]"], ["0x070b0e", [swap, settle, take]]);
  const v3 = abiEncode(V3_IN, [ROUTER_SELF, o.v3Amount ?? CONTRACT_BALANCE, 3_000n, v3Path(USDG, 100, WETH), false, []]);
  const unwrap = abiEncode(["address", "uint256"], [WALLET, 3_000n]);
  return decodeEvmTx(tx({ to: UR, data: encodeCall(EXEC, [o.cmds ?? "0x10000c", [v4, v3, unwrap, ...(o.extra ?? [])], 1_800_000_000n]), value: o.value ?? 0n }));
}
/** A single-pool v4 buy as buildSwapCall makes it (TORCH-like: the native coin and PONS), its hook data set. */
function singleWith(hookData: string) {
  const amt = 2n * 10n ** 14n, key = ["0x0000000000000000000000000000000000000000", PONS, 3000n, 60n, "0x0000000000000000000000000000000000000000"];
  const swap = abiEncode(["((address,address,uint24,int24,address),bool,uint128,uint128,bytes)"], [[key, true, amt, 2_000n, hookData]]);
  const settle = abiEncode(["address", "uint256"], ["0x0000000000000000000000000000000000000000", amt]);
  const take = abiEncode(["address", "uint256"], [PONS, 2_000n]);
  return decodeEvmTx(tx({ to: UR, data: encodeCall(EXEC, ["0x10", [abiEncode(["bytes", "bytes[]"], ["0x060c0f", [swap, settle, take]])], 1_800_000_000n]), value: amt }));
}
test("the two-hop decoder reads only the exact shape (controls: each field changed is unreadable)", () => {
  assert.equal(buyWith().unreadable, undefined, "the shape itself reads");
  for (const [name, d] of [
    ["the v3 hop paid to the wallet, not kept by the router", buyWith({ v3To: WALLET })],
    ["the v3 hop paid by the wallet", buyWith({ payerIsUser: true })],
    ["the middle coin settled by the wallet", buyWith({ settlePayer: true })],
    ["the v4 hop of a set amount, not all the credit", buyWith({ amountIn: 5n })],
    ["two v4 pools", buyWith({ paths: 2 })],
    ["v4 per-hop floors", buyWith({ minHop: [1n] })],
    ["v3 per-hop floors", buyWith({ v3MinHop: [1n] })],
    ["the coin taken isn't the one swapped to", buyWith({ take: USDG })],
  ] as const) {
    assert.ok(d.unreadable, name);
    assert.equal(d.swaps.length, 0, name);
  }
});

// Review L6 (4 Nov): the sale's own shape, the commands around both shapes, and the buy's wrap, each changed: unreadable
test("the two-hop sale reads only the exact shape (controls: the sale itself reads; each field changed is unreadable)", () => {
  const ok = sellWith();
  assert.equal(ok.unreadable, undefined, "the shape itself reads");
  assert.deepEqual(ok.swaps.map((x) => [x.side, x.coin, x.recipient, x.path]), [["sell", PONS, WALLET, [PONS, USDG, WETH]]]);
  for (const [name, d] of [
    ["the middle coin TAKEn to a third party, not kept by the router", sellWith({ takeTo: "0x" + "34".repeat(20) })],
    ["the middle coin TAKEn to the wallet", sellWith({ takeTo: WALLET })],
    ["the v3 hop of a set amount, not all the router holds", sellWith({ v3Amount: 1_000n })],
    ["the native coin sent with a sale", sellWith({ value: 1n })],
    ["hook data on the sale's v4 hop", sellWith({ hookData: "0x01" })],
  ] as const) {
    assert.ok(d.unreadable, name);
    assert.equal(d.swaps.length, 0, name);
  }
  assert.equal(sellWith({ value: 1n }).unreadable, "a sell that also sends the native coin");
});

test("the two-hop shapes take no other command beside them, and no 0x80 (allow revert) flag (controls: both shapes read; a Permit2 permit beside the sale reads)", () => {
  const extra = abiEncode(["address", "uint256"], [ROUTER_SELF, 1n]);
  assert.equal(buyWith().unreadable, undefined);
  assert.equal(sellWith().unreadable, undefined);
  for (const [name, d] of [
    ["a second V4_SWAP after the buy", buyWith({ cmds: "0x0b001010", extra: [extra] })],
    ["an UNWRAP_WETH after the buy", buyWith({ cmds: "0x0b00100c", extra: [extra] })],
    ["a SWEEP (0x04) after the buy", buyWith({ cmds: "0x0b001004", extra: [extra] })],
    ["a TRANSFER (0x05) after the sale", sellWith({ cmds: "0x10000c05", extra: [extra] })],
    ["a WRAP_ETH before the sale", sellWith({ cmds: "0x0b10000c", extra: [extra] })],
    ["the buy's wrap flagged 0x8b", buyWith({ cmds: "0x8b0010" })],
    ["the buy's v3 hop flagged 0x80", buyWith({ cmds: "0x0b8010" })],
    ["the buy's v4 swap flagged 0x90", buyWith({ cmds: "0x0b0090" })],
    ["the sale's v4 swap flagged 0x90", sellWith({ cmds: "0x90000c" })],
    ["the sale's unwrap flagged 0x8c", sellWith({ cmds: "0x10008c" })],
    ["the shape's commands in another order", buyWith({ cmds: "0x000b10" })],
  ] as const) {
    assert.ok(d.unreadable, name);
    assert.equal(d.swaps.length, 0, name);
  }
});

test("the two-hop buy wraps exactly the native coin sent (controls: equal reads; one wei more or less, or none sent, is unreadable)", () => {
  const amt = 2n * 10n ** 14n;
  assert.equal(buyWith({ wrap: amt, value: amt }).unreadable, undefined, "control: the wrap is the value");
  for (const [name, d] of [
    ["a wrap of one wei more than sent", buyWith({ wrap: amt + 1n })],
    ["a wrap of one wei less than sent", buyWith({ wrap: amt - 1n })],
    ["a wrap of all the router holds (CONTRACT_BALANCE)", buyWith({ wrap: CONTRACT_BALANCE })],
    ["nothing sent, nothing wrapped", buyWith({ wrap: 0n, value: 0n })],
  ] as const) {
    assert.ok(d.unreadable, name);
    assert.equal(d.swaps.length, 0, name);
  }
});

test("review M1: a single-pool v4 swap with hook data is unreadable, as a two-hop's v4 hop is (control: no hook data reads)", () => {
  const ok = singleWith("0x");
  assert.equal(ok.unreadable, undefined);
  assert.deepEqual(ok.swaps.map((x) => [x.side, x.coin]), [["buy", PONS]]);
  for (const h of ["0x00", "0x01", "0x" + "ab".repeat(64)]) {
    const d = singleWith(h);
    assert.equal(d.unreadable, "v4 hook data the engine doesn't send", h);
    assert.equal(d.swaps.length, 0, h);
  }
});

test("the core's middle-coin rule: the wallet's balance of it unchanged on both nodes' runs (controls: some left; unread)", () => {
  const path = [WETH, USDG, PONS];
  assert.equal(middleLeftRefusal(path, { coinsIn: new Map([[PONS, 5n]]), coinsInHigh: new Map([[PONS, 5n]]) }), null);
  assert.equal(middleLeftRefusal(path, { coinsIn: new Map([[PONS, 5n], [USDG, 1n]]), coinsInHigh: new Map([[PONS, 5n], [USDG, 1n]]) }), "It leaves some of another coin in your wallet");
  assert.equal(middleLeftRefusal(path, { coinsIn: new Map([[PONS, 5n]]), coinsInHigh: new Map([[PONS, 5n], [USDG, 1n]]) }), "It leaves some of another coin in your wallet", "one node saw some left");
  assert.equal(middleLeftRefusal(path, { coinsIn: undefined, coinsInHigh: undefined }), "It leaves some of another coin in your wallet", "unread");
  assert.equal(middleLeftRefusal([WETH, PONS], { coinsIn: undefined, coinsInHigh: undefined }), null, "control: one hop needs no middle read");
});
