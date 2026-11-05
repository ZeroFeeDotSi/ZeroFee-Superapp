// What the chain says about a coin (onchain.ts), on accounts and eth_call answers read from mainnet on 27 Oct 2026
// (fixtures/chain-sol.json, chain-evm.json), replayed offline. Wallet v1's own cases keep their numbers: USELESS's Metaplex
// name, ANSEM's Token-2022 name, the Metaplex addresses of four mints, the PONS token read through plain eth_calls, an
// address that is no token, and PRICE SANITY's 100x line.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fx } from "./testing.ts";
import { decodeString, evmFacts, metadataPda, metaplexFields, MULTICALL3, saneVsMarket, solFacts, tokenMetadataOf, type EvmCall, type SolCall } from "./onchain.ts";
import { fromBase64, u64At } from "../sol/bytes.ts";

const SOL = fx("chain-sol");
const EVM = fx("chain-evm");
const SOL_USD = 200;

/** getMultipleAccounts answered from the captured accounts; an address not captured has no account. */
function solNode(log: string[] = []): SolCall {
  return async (method, params) => {
    log.push(method);
    if (method !== "getMultipleAccounts") throw new Error(`unexpected ${method}`);
    return { value: (params[0] as string[]).map((a) => SOL.accounts[a] ?? null) };
  };
}
/** eth_call answered from the captured calls (a revert where the node reverted); anything else throws, as a node would refuse it. */
function evmNode(log: string[] = []): EvmCall {
  return async (chain, method, params) => {
    const c = params[0] as { to: string; data: string };
    log.push(`${chain}:${c.to.toLowerCase()}:${c.data.slice(0, 10)}`);
    const hit = EVM.calls.find((x: any) => x.chain === chain && x.to.toLowerCase() === c.to.toLowerCase() && x.data === c.data);
    if (!hit || hit.error) throw new Error(hit?.error ?? "execution reverted");
    return hit.result;
  };
}

describe("Solana: name, symbol, decimals, supply and authorities from the chain (wallet v1's cases)", () => {
  it("the Metaplex metadata account of a mint is v1's: USELESS, ANSEM, COLLECTOOOR and PUMP (fixtures/sol-metadata.json there)", () => {
    assert.equal(metadataPda("Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk"), "BHMfPXBpZZnG62EsgUxQHrcEoraFyBmGeJpY8Qxbfqic");
    assert.equal(metadataPda("9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump"), "AHoZ487gCtSip4Gm277pmHhTwiYVv1yAP9spYETVMMJW");
    assert.equal(metadataPda("ESnW5ZbLmoEAg2QEMxnMsY9R3aS8Kw58HJacYURmpump"), "H78NLSPkWkMwvCWiCmqhk5aqXvGACv2AAGKtXekg8mue");
    assert.equal(metadataPda("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"), "D1N5pZfcAJ2moJopLPHYLJcWpPa7pfuZMQqKriULAYkm");
  });
  it("a classic mint: name and symbol from the Metaplex account; mint and freeze authority renounced (v1: USELESS COIN / USELESS / 6)", async () => {
    const log: string[] = [];
    const f = await solFacts(solNode(log), SOL.coins.USELESS, async () => SOL_USD);
    assert.deepEqual(log, ["getMultipleAccounts"], "one read: the mint, its metadata and its curve together");
    assert.equal(f?.name, "USELESS COIN"); assert.equal(f?.symbol, "USELESS"); assert.equal(f?.decimals, 6);
    assert.equal(f?.supply, 999078127239765n, "as read on 27 Oct (v1 read 999078206057338 on 21 Oct: some were burned since)");
    assert.deepEqual(f?.security, { mintAuthority: false, freezeAuthority: false });
    assert.equal(f?.priceUsd, undefined, "no launch curve, so no price from the chain");
    assert.equal(f?.pool, undefined);
  });
  it("a Token-2022 mint: name and symbol from its own tokenMetadata extension (v1: The Black Bull / ANSEM / 6)", async () => {
    const f = await solFacts(solNode(), SOL.coins.ANSEM, async () => SOL_USD);
    assert.equal(f?.name, "The Black Bull"); assert.equal(f?.symbol, "ANSEM"); assert.equal(f?.decimals, 6);
    assert.deepEqual(tokenMetadataOf(fromBase64(SOL.accounts[SOL.coins.ANSEM].data[0])), { name: "The Black Bull", symbol: "ANSEM" });
    assert.equal(tokenMetadataOf(fromBase64(SOL.accounts[SOL.coins.USELESS].data[0])), undefined, "a classic mint has no extensions");
  });
  it("a coin minutes old on its pump.fun curve: named, and priced by the curve's virtual reserves (v1's pumpCurvePrice); the curve is GeckoTerminal's pool", async () => {
    const f = await solFacts(solNode(), SOL.coins.GLYNX, async () => SOL_USD);
    assert.equal(f?.symbol, "GLYNX"); assert.equal(f?.name, "Ghost Lynx");
    // v1's own read of the same bytes: virtual token reserves u64 @8, virtual SOL reserves u64 @16; pump.fun coins have 6 decimals
    const curve = fromBase64(SOL.accounts["B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV"].data[0]);
    const v1 = (Number(u64At(curve, 16)) / 1e9 / (Number(u64At(curve, 8)) / 1e6)) * SOL_USD;
    assert.ok(v1 > 0 && Math.abs(f!.priceUsd! - v1) < 1e-15, `${f?.priceUsd} vs ${v1}`);
    assert.deepEqual(f?.pool, { address: "B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV", dex: "pump-fun" }, "GeckoTerminal's pump-fun pool of GLYNX is this curve");
    assert.equal(f?.venue, "pump.fun");
  });
  it("a pump.fun curve quoted in another coin (Microducks / NVDAx) gets no price from the chain: its reserves aren't SOL", async () => {
    const f = await solFacts(solNode(), SOL.coins.MICRODUCKS, async () => SOL_USD);
    assert.equal(f?.symbol, "Microducks");
    assert.equal(f?.priceUsd, undefined);
    assert.equal(f?.pool, undefined);
  });
  it("a pasted pool the engine trades is read as its coin, with the pool and GeckoTerminal's dex id (PumpSwap and Meteora DBC pools of ELUN)", async () => {
    const a = await solFacts(solNode(), SOL.coins.PUMPSWAP_ELUN, async () => SOL_USD);
    assert.equal(a?.address, SOL.coins.ELUN); assert.equal(a?.symbol, "ELUN"); assert.equal(a?.name, "ELUNCOIN");
    assert.deepEqual(a?.pool, { address: SOL.coins.PUMPSWAP_ELUN, dex: "pumpswap" });
    const b = await solFacts(solNode(), SOL.coins.DBC_ELUN, async () => SOL_USD);
    assert.equal(b?.address, SOL.coins.ELUN);
    assert.deepEqual(b?.pool, { address: SOL.coins.DBC_ELUN, dex: "meteora-dbc" }, "the engine's curve lookup reads a pool with this dex id");
  });
  it("not a coin: an account nobody has, a bonding curve (it doesn't store its mint), a string that is no address", async () => {
    assert.equal(await solFacts(solNode(), "11111111111111111111111111111112", async () => SOL_USD), undefined);
    assert.equal(await solFacts(solNode(), "B8YoA2QYkbVzvMHAa6RfNLcXLhjyUnvx6NhtPUJgC7BV", async () => SOL_USD), undefined);
    assert.equal(await solFacts(solNode(), "not-an-address", async () => SOL_USD), undefined);
  });
  it("a node that can't answer is an error, never 'no such coin'", async () => {
    await assert.rejects(solFacts(async () => { throw new Error("HTTP 429"); }, SOL.coins.GLYNX, async () => SOL_USD));
  });
  it("Metaplex strings: a length past the data is no answer, not garbage", () => {
    const data = new Uint8Array(70); new DataView(data.buffer).setUint32(65, 1_000, true);
    assert.equal(metaplexFields(data), undefined);
  });
});

describe("BNB Chain and Robinhood Chain: the token's own read, and a launchpad curve's price", () => {
  const usd = async (c: string) => EVM.nativeUsd[c] as number;
  it("a Pons curve coin minutes old (ASKMOSSIO): one Multicall3 call names it; the curve's reserves price it within 2% of GeckoTerminal's price read with it", async () => {
    const log: string[] = [];
    const f = await evmFacts(evmNode(log), "hood", "0x10281b68737F0E03BD38E53DE4C00C969E713BBB", usd);
    assert.deepEqual([f?.address, f?.symbol, f?.name, f?.decimals, f?.supply], ["0x10281b68737f0e03bd38e53de4c00c969e713bbb", "ASKMOSSIO", "AskMossio", 18, 10n ** 27n]);
    assert.equal(log.filter((l) => l.startsWith(`hood:${MULTICALL3}`)).length, 1, "decimals, supply, name and symbol in one call");
    assert.equal(f?.venue, "Pons curve");
    assert.ok(Math.abs(f!.priceUsd! / 0.000004525737904 - 1) < 0.02, `${f?.priceUsd}`);
  });
  it("a four.meme curve coin (DOGEDAY): the manager's last price, in BNB, within 2% of GeckoTerminal's", async () => {
    const f = await evmFacts(evmNode(), "bsc", "0x044d1bcd65297f94ad89c784aab9fc5d7c8cffff", usd);
    assert.deepEqual([f?.symbol, f?.name, f?.decimals], ["DOGEDAY", "Doge Day", 18]);
    assert.equal(f?.venue, "four.meme curve");
    assert.ok(Math.abs(f!.priceUsd! / 0.000003223756212 - 1) < 0.02, `${f?.priceUsd}`);
  });
  it("a coin on no launchpad curve (wiener, Uniswap v4): named, with no price from the chain", async () => {
    const f = await evmFacts(evmNode(), "hood", "0x8f58aae9ccf3dd29853a76bd3efd050698627777", usd);
    assert.deepEqual([f?.symbol, f?.name], ["wiener", "wienercoin"]);
    assert.equal(f?.priceUsd, undefined); assert.equal(f?.venue, undefined);
  });
  it("v1's PONS token through four plain eth_calls when a node refuses Multicall3 (decimals 18, supply 1e27, Pons / PONS)", async () => {
    const PONS = "0x39dbed3a2bd333467115de45665cc57f813c4571";
    const str = (s: string) => "0x" + "20".padStart(64, "0") + s.length.toString(16).padStart(64, "0") + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0");
    const call: EvmCall = async (_c, _m, params) => {
      const { to, data } = params[0] as { to: string; data: string };
      if (to === MULTICALL3) throw new Error("method not supported");
      if (to !== PONS) throw new Error("execution reverted");
      if (data === "0x313ce567") return "0x" + "12".padStart(64, "0");
      if (data === "0x18160ddd") return "0x" + (10n ** 27n).toString(16).padStart(64, "0");
      if (data === "0x06fdde03") return str("Pons");
      if (data === "0x95d89b41") return str("PONS");
      throw new Error("execution reverted");
    };
    const f = await evmFacts(call, "hood", PONS, async () => 2300, { price: false });
    assert.deepEqual([f?.symbol, f?.name, f?.decimals, f?.supply], ["PONS", "Pons", 18, 10n ** 27n]);
  });
  it("an address that is not a token is no coin, not an error (v1); with Multicall3 its decimals() comes back empty", async () => {
    assert.equal(await evmFacts(evmNode(), "bsc", "0x00001bcd65297f94ad89c784aab9fc5d7c8cffff", usd), undefined);
    assert.equal(await evmFacts(async () => "0x", "hood", "0x39dbed3a2bd333467115de45665cc57f813c4571", usd, { price: false }), undefined);
  });
  it("a token's name as an ABI string or the old bytes32 style", () => {
    assert.equal(decodeString("0x" + "4d4b520000000000000000000000000000000000000000000000000000000000"), "MKR");
    assert.equal(decodeString("0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + "50455045".padEnd(64, "0")), "PEPE");
    assert.equal(decodeString("0x"), undefined);
  });
});

describe("PRICE SANITY (v1, 21 Oct: a curve once read $145,989,877,618 for a $0.0000417 coin)", () => {
  it("v1's line: no market price is no opinion; more than 100x either way is not shown", () => {
    assert.equal(saneVsMarket(1e29, undefined), true);
    assert.equal(saneVsMarket(1.46e29, 0.0000417), false);
    assert.equal(saneVsMarket(0.0000412, 0.0000417), true);
    assert.equal(saneVsMarket(0.0000417 * 99, 0.0000417), true);
    assert.equal(saneVsMarket(0.0000417 / 101, 0.0000417), false);
    assert.equal(saneVsMarket(0, undefined), false, "no price at all is never a price");
  });
});
