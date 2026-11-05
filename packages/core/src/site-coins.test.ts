// A site's own wallet's coins (product decision, 3 Nov: pump.fun's and GMGN's wallet pages listed SOL alone): every coin it holds,
// named from the chain and priced, read the way Trade reads its trading wallets. Display only, one node or the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOL, findProgramAddress } from "./solana.ts";
import { base64, fromBase58, utf8 } from "./sol/bytes.ts";
import { SOL_METADATA_PROGRAM, coinsMetaOn } from "./sol/coin-meta.ts";
import { COINS_MAX, TRANSFER_TOPIC, abiText, coinUsd, coinsIn, walletCoins, type CoinsDeps } from "./site-coins.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const PUMP = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const ODD = "So11111111111111111111111111111111111111112";
const WALLET = "BkmYSuocaSTWSaauAADwLVfL6udr6px3os5SwqGz7BBa";  // generated sample
const EVM_WALLET = "0x" + "ab".repeat(20);
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const NFT = "0x" + "77".repeat(20);

const sol = (o: Partial<CoinsDeps["sol"]> = {}): CoinsDeps => ({
  sol: { balance: async () => 1_500_000_000n, tokenAccounts: async () => [{ mint: BONK, amount: 100_000_000n }, { mint: BONK, amount: 23_456_700n }, { mint: PUMP, amount: 5_000_000_000n }, { mint: ODD, amount: 0n }, { mint: "Unread1111111111111111111111111111111111111", amount: 7n }], coinsMeta: async (m) => new Map(m.filter((x) => x === BONK || x === PUMP).map((x) => [x, x === BONK ? { decimals: 5, symbol: "BONK", name: "Bonk" } : { decimals: 6, symbol: "PUMPX", name: "Pump Example" }])), ...o },
  evm: { read: async () => { throw new Error("not EVM"); } },
  nativeUsd: async () => 150,
  prices: async (_c, coins) => new Map(coins.filter((c) => c === BONK).map((c) => [c, 0.00002])),
  listed: () => [],
  noted: async () => [],
});

test("Solana: SOL, then every coin the wallet holds (each mint once), named from the chain and priced; a coin with no price shows its amount, never $0; an empty or unreadable one is left out", async () => {
  const rows = await walletCoins(sol(), { id: "w", chain: "sol", address: WALLET });
  assert.deepEqual(rows[0], { token: "native", symbol: "SOL", decimals: 9, amount: "1500000000", usd: 225 });
  assert.deepEqual(rows.slice(1), [
    { token: BONK, symbol: "BONK", name: "Bonk", decimals: 5, amount: "123456700", usd: 0.02 },
    { token: PUMP, symbol: "PUMPX", name: "Pump Example", decimals: 6, amount: "5000000000", usd: null },
  ]);
  assert.ok(!rows.some((r) => r.token === ODD), "control: an empty account is no coin");
  assert.ok(!rows.some((r) => r.token.startsWith("Unread")), "control: a mint that can't be read isn't shown with a wrong amount");
  // controls: no token reader, SOL alone; the chain unreadable, an error (never an empty list as if it held nothing)
  assert.deepEqual((await walletCoins(sol({ tokenAccounts: undefined }), { id: "w", chain: "sol", address: WALLET })).map((r) => r.symbol), ["SOL"]);
  await assert.rejects(walletCoins(sol({ balance: async () => { throw new Error("down"); } }), { id: "w", chain: "sol", address: WALLET }));
  assert.equal(coinUsd(5_000_000_000n, 6, null), null);
  assert.equal(coinUsd(10n ** 24n, 18, 2), 2_000_000, "18 decimals");
});

/** An SPL mint account (82 bytes): decimals at 44, initialized at 45. */
const mintData = (decimals: number, init = 1) => { const b = new Uint8Array(82); b[44] = decimals; b[45] = init; return b; };
const borsh = (s: string) => { const t = utf8(s); const b = new Uint8Array(4 + t.length); b[0] = t.length; b.set(t, 4); return b; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
/** Metaplex's Metadata account: key 4, update authority, mint, then name and symbol. */
const metaplex = (name: string, symbol: string) => cat(Uint8Array.of(4), new Uint8Array(64), borsh(name), borsh(symbol));
/** A Token-2022 mint with its metadata extension (TLV type 19: authority, mint, name, symbol). */
const t22 = (decimals: number, name: string, symbol: string) => { const v = cat(new Uint8Array(64), borsh(name), borsh(symbol)); const head = mintData(decimals); const pad = new Uint8Array(165 - 82); return cat(head, pad, Uint8Array.of(1), Uint8Array.of(19, 0, v.length & 255, v.length >> 8), v); };

test("names from the chain, many coins in two reads: an SPL mint's decimals and Metaplex's name and symbol; a Token-2022 mint's own extension; the other node when one fails (controls: an uninitialized mint is left out; a symbol that isn't plain isn't said)", async () => {
  const pda = findProgramAddress([utf8("metadata"), fromBase58(SOL_METADATA_PROGRAM), fromBase58(BONK)], SOL_METADATA_PROGRAM);
  const pdaOdd = findProgramAddress([utf8("metadata"), fromBase58(SOL_METADATA_PROGRAM), fromBase58(ODD)], SOL_METADATA_PROGRAM);
  const accounts: Record<string, { owner: string; data: [string, string] } | null> = {
    [BONK]: { owner: SOL.token, data: [base64(mintData(5)), "base64"] },
    [PUMP]: { owner: SOL.token2022, data: [base64(t22(6, "Pump Example", "PUMPX")), "base64"] },
    [ODD]: { owner: SOL.token, data: [base64(mintData(9)), "base64"] },
    "Unread1111111111111111111111111111111111111": { owner: SOL.token, data: [base64(mintData(6, 0)), "base64"] },
    [pda]: { owner: SOL_METADATA_PROGRAM, data: [base64(metaplex("Bonk", "BONK")), "base64"] },
    [pdaOdd]: { owner: SOL_METADATA_PROGRAM, data: [base64(metaplex("Bad <b>name", "WAY TOO LONG SYMBOL")), "base64"] },
  };
  const asked: string[] = [];
  const rpc = async (u: string, method: string, params: unknown[]) => {
    asked.push(`${u} ${method}`);
    if (u === "a") throw new Error("first node down");
    return { value: (params[0] as string[]).map((k) => accounts[k] ?? null) };
  };
  const m = await coinsMetaOn(["a", "b"], rpc, [BONK, PUMP, ODD, "Unread1111111111111111111111111111111111111"]);
  assert.deepEqual(m.get(BONK), { decimals: 5, name: "Bonk", symbol: "BONK" });
  assert.deepEqual(m.get(PUMP), { decimals: 6, name: "Pump Example", symbol: "PUMPX" }, "Token-2022: the mint's own extension");
  assert.deepEqual(m.get(ODD), { decimals: 9 }, "control: a name and symbol that aren't plain aren't said");
  assert.equal(m.has("Unread1111111111111111111111111111111111111"), false, "control: an uninitialized mint is left out");
  assert.deepEqual(asked, ["a getMultipleAccounts", "b getMultipleAccounts", "b getMultipleAccounts"], "one node, the other when it fails: two reads in all");
});

test("an EVM wallet: its own coin, the coins ZeroFee lists there, and every coin its own transactions brought in (their receipts' Transfer logs), each named from the coin and priced where the relay has the chain (controls: an NFT's transfer and a transfer to someone else aren't coins of this wallet; Base has no price, its coins no dollars)", async () => {
  const me = "0x" + EVM_WALLET.slice(2).padStart(64, "0"), other = "0x" + "cd".repeat(20).padStart(64, "0");
  const receipt = { logs: [
    { address: CAKE, topics: [TRANSFER_TOPIC, other, me] },
    { address: NFT, topics: [TRANSFER_TOPIC, other, me, "0x01"] },
    { address: "0x" + "99".repeat(20), topics: [TRANSFER_TOPIC, me, other] },
    { address: CAKE, topics: [TRANSFER_TOPIC, other, me] },
  ] };
  assert.deepEqual(coinsIn(receipt, EVM_WALLET), [CAKE]);
  assert.deepEqual(coinsIn({ logs: "x" }, EVM_WALLET), [], "control: no logs, no coins");
  const enc = (s: string) => "0x" + (32).toString(16).padStart(64, "0") + s.length.toString(16).padStart(64, "0") + Buffer.from(s).toString("hex").padEnd(64, "0");
  const reads: string[] = [];
  const deps = (chain: string): CoinsDeps => ({
    sol: {},
    evm: { read: async (_c, method, params) => {
      reads.push(method);
      if (method === "eth_getBalance") return "0x" + (10n ** 17n).toString(16);
      const { to, data } = params[0] as { to: string; data: string };
      if (data.startsWith("0x70a08231")) return to === CAKE ? "0x" + (25n * 10n ** 18n).toString(16) : "0x0";
      if (data === "0x95d89b41") return enc("Cake");
      if (data === "0x06fdde03") return "0x" + Buffer.from("PancakeSwap Token").toString("hex").padEnd(64, "0");
      if (data === "0x313ce567") return "0x" + (18).toString(16).padStart(64, "0");
      throw new Error("unexpected");
    } },
    nativeUsd: async (c) => (c === "bsc" ? 600 : 3000),
    prices: async (_c, coins) => new Map(coins.map((c) => [c, 2])),
    listed: () => [{ token: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18 }],
    noted: async () => [CAKE],
  });
  const bsc = await walletCoins(deps("bsc"), { id: "w", chain: "bsc", address: EVM_WALLET });
  assert.deepEqual(bsc, [
    { token: "native", symbol: "BNB", decimals: 18, amount: (10n ** 17n).toString(), usd: 60 },
    { token: CAKE, symbol: "Cake", name: "PancakeSwap Token", decimals: 18, amount: (25n * 10n ** 18n).toString(), usd: 50 },
  ], "BNB, and CAKE (its own transaction brought it in); USDT listed but empty: left out");
  const base = await walletCoins(deps("base"), { id: "w", chain: "base", address: EVM_WALLET });
  assert.equal(base[1]!.usd, null, "control: Base has no relay price, so no dollars (never $0)");
  assert.equal(base[0]!.usd, 300);
});

test("ABI text: a dynamic string and an older coin's bytes32 read plainly (control: junk or markup isn't said)", () => {
  const dyn = "0x" + (32).toString(16).padStart(64, "0") + (4).toString(16).padStart(64, "0") + Buffer.from("BONK").toString("hex").padEnd(64, "0");
  assert.equal(abiText(dyn), "BONK");
  assert.equal(abiText("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
  assert.equal(abiText("0x" + Buffer.from("<script>").toString("hex").padEnd(64, "0")), null);
  assert.equal(abiText("0x12"), null);
  assert.equal(abiText(undefined), null);
  assert.ok(COINS_MAX >= 20);
});

test("the core's call: subwallet.coins, for a site's own wallet only, read like subwallet.balances (each app sees only its own), kept 15 s; a site wallet's EVM sends note the coins they bring in; the demo answers it (control: a trading wallet is refused)", async () => {
  const core = here("./demo-core.ts"), sw = here("./subwallets.ts");
  assert.match(core, /case "subwallet\.coins":\n\s+return this\.ready\(\)\.then\(\(\) => this\.ownKind\(p, true\)\)\.then\(\(\) => this\.subwallets\.coins\(p\.id, p\.fresh === true\)\);/);
  // test, MUST 9: a wallet whose figure just changed (a move landed) asks fresh, past the 15 s keep; control: kept otherwise
  assert.match(sw, /if \(!fresh && kept && Date\.now\(\) - kept\.at < COINS_KEPT_MS && Date\.now\(\) >= kept\.at\) return kept\.rows;/);
  assert.match(sw, /if \(!isSiteWallet\(w\)\) throw new ProblemError\(securityProblems\.requestInvalid\("coins are listed for a site's own wallet"\)\);/);
  assert.match(sw, /if \(isSiteWallet\(w\) && out\.status === "done"\) void this\.noteCoins\(w, sent\.hash\)/);
  assert.match(here("./read-deadline.ts"), /"subwallet\.coins",/, "a read: its own deadline, never a stall");
  const mock = createMockBridge({ latencyMs: 0 });
  const site = await mock.call<{ id: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "pump", app: "social" });
  assert.ok("ok" in site, JSON.stringify(site));
  const coins = await mock.call<{ symbol: string }[]>("subwallet.coins", { id: site.ok.id });
  assert.ok("ok" in coins && coins.ok.map((c) => c.symbol).join() === "SOL,BONK", JSON.stringify(coins));
  const trade = await mock.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol" });
  assert.ok("ok" in trade);
  assert.ok("problem" in (await mock.call("subwallet.coins", { id: trade.ok.id })), "control: a trading wallet's coins aren't this call's");
});
