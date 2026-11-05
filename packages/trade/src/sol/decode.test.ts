// The decoder against transactions that were really built: the old engine's (fixtures/sol-golden.json) and Jupiter's
// routes (fixtures/web3-alt-vectors.json). It must say the same venue, side, coin and amounts the quote said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64 } from "./bytes.ts";
import { decodeSolTx, KNOWN_PROGRAMS, KNOWN_ROUTE_PROGRAMS, solWords } from "./decode.ts";
import { TEST_OWNER } from "./testing/replay.ts";
import { buildTx, lookupTableAddresses, transfer, unsignedTx, ix } from "./tx.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const golden = load("sol-golden.json"), alt = load("web3-alt-vectors.json"), routes = load("jup-routes.json");

test("every transaction the old engine built reads back as its own quote: venue, side, coin, amount in, the floor", () => {
  const venue: Record<string, string> = { Raydium: "Raydium", "pump.fun": "pump.fun", PumpSwap: "PumpSwap", "Meteora DBC": "Meteora DBC", "Raydium LaunchLab": "Raydium LaunchLab", "Meteora DAMM v2": "Meteora DAMM v2" };
  let n = 0;
  for (const c of golden.cases.filter((x: any) => !x.error)) {
    const tx = c.sims.at(-1);                                                    // the real transaction (the last one simulated)
    const d = decodeSolTx(tx);
    assert.equal(d.feePayer, TEST_OWNER);
    assert.equal(d.signers, 1);
    assert.deepEqual(d.unknownPrograms, [], c.name);
    assert.equal(d.swaps.length, 1, c.name);
    const s = d.swaps[0]!;
    assert.deepEqual([s.venue, s.side, s.coin, s.inRaw, s.minOutRaw], [venue[c.quote.route], c.side, c.mint, c.quote.payRaw, c.quote.getMinRaw], c.name);
    assert.deepEqual(d.transfers, [], "wrapping SOL into the wallet's own account isn't a transfer out");
    if (c.quote.closesAccount) assert.ok(d.closes.includes(c.coinAta), `${c.name}: closes the coin account`);
    n++;
  }
  assert.equal(n, 13);
});

test("the round trip the engine simulates before a curve buy reads as a buy and a sell of the same coin", () => {
  const c = golden.cases.find((x: any) => x.name.startsWith("launchlab buy"));
  const d = decodeSolTx(c.sims[1]);
  assert.deepEqual(d.swaps.map((s) => s.side), ["buy", "sell"]);
  assert.equal(d.swaps[1]!.coin, c.mint);
});

test("real Jupiter routes with lookup tables: a buy of the route's coin, its amount in and its floor", () => {
  for (const [i, v] of alt.vectors.entries()) {
    const tables = Object.entries(v.alts as Record<string, string>).map(([k, data]) => ({ key: k, addresses: lookupTableAddresses(Buffer.from(data, "base64")) }));
    const d = decodeSolTx(v.swapTransaction, tables);
    const q = routes.routes[i].quote;
    assert.deepEqual(d.unknownPrograms, [], v.name);
    const s = d.swaps[0]!;
    assert.deepEqual([s.venue, s.side, s.coin, s.inRaw], ["Jupiter", "buy", q.outputMint, q.inAmount], v.name);
    assert.ok(Math.abs(Number(BigInt(s.minOutRaw) - BigInt(q.otherAmountThreshold))) <= 1, `${v.name}: the floor ${s.minOutRaw} vs ${q.otherAmountThreshold}`);
    assert.throws(() => decodeSolTx(v.swapTransaction), /lookup table/, "without its tables a route isn't guessed at");
    assert.ok(d.routePrograms.includes("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"), `${v.name}: the route's inner program (Orca Whirlpool) is named`);
    assert.ok(d.routeAccounts.length > d.routePrograms.length, "the rest are the route's accounts, for the core to check");
  }
});

test("anything else in the transaction is named: a program we don't know, SOL sent out", () => {
  const base = golden.cases.find((x: any) => x.name.startsWith("pump.fun buy $1 (PUMPE)"));
  const strange = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const tx = buildTx(TEST_OWNER, golden.blockhash, [ix(strange, [{ pubkey: TEST_OWNER, isSigner: true, isWritable: true }], [1, 2, 3]), transfer(TEST_OWNER, strange, 5_000_000n)]);
  const d = decodeSolTx(tx);
  assert.deepEqual(d.unknownPrograms, [strange]);
  assert.deepEqual(d.transfers, [{ to: strange, lamports: "5000000" }]);
  const w = solWords(d);
  assert.ok(w.lines.some((l) => /ZeroFee doesn't know/.test(l)));
  assert.ok(w.lines.some((l) => /Sends 0\.005 SOL/.test(l)));
  void base;
});

test("the words: plain, with the coin's name when the core knows it", () => {
  const c = golden.cases.find((x: any) => x.name.startsWith("pump.fun buy $1 (PUMPE)"));
  const w = solWords(decodeSolTx(c.sims.at(-1)), (m) => (m === c.mint ? { symbol: "PUMPE", decimals: 6 } : undefined));
  assert.equal(w.title, "Buy PUMPE with 0.009873617 SOL on pump.fun", "exact: what gets approved is never rounded");
  assert.equal(w.lines[0], "You get at least 320,764.812117 PUMPE");
  const sell = golden.cases.find((x: any) => x.name === "pump.fun sell all (closes the account)");
  const ws = solWords(decodeSolTx(sell.sims.at(-1)));
  assert.match(ws.title, /^Sell 86sf…E5ar, an unnamed coin \(amount \d+\) on pump\.fun$/);
  assert.ok(ws.lines.some((l) => /the small amount the network held comes back/.test(l)));
});

test("pure: the decoder imports only the two files that have no dependencies", () => {
  for (const f of ["decode.ts", "wire.ts", "bytes.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.ok(imports.every((p) => p === "./bytes.ts" || p === "./wire.ts"), `${f} imports ${imports.join(", ")}`);
  }
  assert.equal(Object.keys(KNOWN_PROGRAMS).length, 12);
  assert.equal(Object.keys(KNOWN_ROUTE_PROGRAMS).length, 5);
  void base64; void unsignedTx;
});

test("SOC-2: a plain SOL transfer shows the recipient's full address", () => {
  const strange = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const w = solWords(decodeSolTx(buildTx(TEST_OWNER, golden.blockhash, [transfer(TEST_OWNER, strange, 5_000_000n)])));
  assert.ok(w.lines.includes(`Sends 0.005 SOL to ${strange}`), w.lines.join(" | "));
});
