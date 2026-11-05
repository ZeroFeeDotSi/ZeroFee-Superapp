// "Your wallets" (your-wallets.ts): every site wallet, its dollars and coins, which ones Move back, and the sweep list.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingWallet } from "@zerofee/core/spending";
import type { SiteCoin } from "./site-wallet.ts";
import { BACK_MIN_USD, keepLast, letterOf, nameOfSite, siteWalletsOf, words, yourWallets } from "./your-wallets.ts";

const w = (o: Partial<SpendingWallet>): SpendingWallet => ({ id: "x", role: "site", network: "sol", address: "Addr1111", label: "", current: true, inCap: false, keyExported: false, ...o }) as SpendingWallet;
const sol = (lamports: string, usd: number | null): SiteCoin => ({ token: "native", symbol: "SOL", decimals: 9, amount: lamports, usd });
const coin = (symbol: string, amount: string, decimals: number, usd: number | null): SiteCoin => ({ token: `mint-${symbol}`, symbol, name: symbol, decimals, amount, usd });

const LIST = [
  w({ id: "pump-sol", site: "pump", cashUsd: "8.20" }),
  w({ id: "gmgn-sol", site: "gmgn", cashUsd: "0.00" }),
  w({ id: "gmgn-bsc", site: "gmgn", network: "bsc", cashUsd: "3.00" }),
  w({ id: "ex-sol", site: "host:app.example.com", cashUsd: "0.00" }),
  w({ id: "foo-eth", site: "host:foo.xyz", network: "eth", holds: "0.0012 ETH" }),
  w({ id: "jup-sol", site: "jupiter", unread: true }),
  // never listed: AgentZero's pocket, a chain wallet, an older site wallet, a site wallet with no site
  w({ id: "pocket", site: "agentzero", cashUsd: "40.00" }),
  w({ id: "trade-sol", role: "chain", cashUsd: "99.00" }),
  w({ id: "pump-old", site: "pump", cashUsd: "50.00", current: false }),
  w({ id: "nosite", cashUsd: "5.00" }),
];
const COINS = { "pump-sol": [sol("41000000", 8.2), coin("BONK", "123456700000", 5, 2.47)], "ex-sol": [sol("0", 0)] };

test("every site wallet, by site: listed sites and per-host ones; never AgentZero's pocket, a chain wallet or an older one", () => {
  assert.deepEqual(siteWalletsOf(LIST).map((x) => x.id), ["pump-sol", "gmgn-sol", "gmgn-bsc", "ex-sol", "foo-eth", "jup-sol"]);
  const v = yourWallets({ list: LIST, coins: COINS, read: "ok" });
  // with money, largest first; a wallet that can't be read goes last but is never taken for an empty one
  assert.deepEqual(v.money.map((c) => [c.site, c.name, c.dollars]), [
    ["pump", "pump.fun", "$10.67"],
    ["gmgn", "GMGN", "$3.00"],
    ["host:foo.xyz", "foo.xyz", "0.0012 ETH"],
    ["jupiter", "Jupiter", "Looking…"],
  ]);
  assert.deepEqual(v.empty.map((c) => [c.site, c.name, c.dollars]), [["host:app.example.com", "app.example.com", "$0.00"]]);
  // a per-host wallet is named and lettered by its host
  assert.equal(v.empty[0]!.host, "app.example.com");
  assert.equal(v.empty[0]!.letter, "E");
  assert.equal(nameOfSite("host:pump.fun.example"), "pump.fun.example");
  assert.equal(letterOf("www.zebra.io"), "Z");
  // control: the same list read again with the pump.fun wallet emptied moves it to the empty group
  const after = yourWallets({ list: LIST.map((x) => (x.id === "pump-sol" ? { ...x, cashUsd: "0.00" } : x)), coins: { ...COINS, "pump-sol": [sol("0", 0)] }, read: "ok" });
  assert.deepEqual(after.empty.map((c) => c.site), ["pump", "host:app.example.com"]);
});

test("the total: every priced coin; a wallet that can't be read says so; only an empty first read is '…'", () => {
  const v = yourWallets({ list: LIST, coins: COINS, read: "ok" });
  assert.equal(v.total, "$13.67");
  assert.equal(v.totalNote, words.someUnseen);
  const seen = yourWallets({ list: LIST.filter((x) => x.id !== "jup-sol"), coins: COINS, read: "ok" });
  assert.equal(seen.total, "$13.67");
  assert.equal(seen.totalNote, words.noPrice, "foo.xyz's ETH has no price: said, never added as $0");
  assert.equal(yourWallets({ list: [], read: "first" }).total, "…");
  assert.equal(yourWallets({ list: [], read: "ok" }).total, "$0.00");
});

test("coins: priced in dollars; a coin with no price shows its amount, never $0.00; a wallet with only those leads with one", () => {
  const v = yourWallets({ list: [w({ id: "a", site: "host:a.io", cashUsd: "0.00" })], coins: { a: [sol("0", 0), coin("WIF", "5000000", 6, null)] }, read: "ok" });
  const a = v.money[0]!;
  assert.deepEqual(a.coins.map((c) => [c.symbol, c.value]), [["WIF", "5 WIF"]], "a zero SOL is not a coin it holds");
  assert.equal(a.dollars, "5 WIF");
  assert.notEqual(a.dollars, "$0.00");
  // priced and unpriced together: the dollars, and the note
  const b = yourWallets({ list: [w({ id: "b", site: "pump", cashUsd: "4.00" })], coins: { b: [sol("20000000", 4), coin("WIF", "1234567891", 6, null)] }, read: "ok" }).money[0]!;
  assert.equal(b.dollars, "$4.00");
  assert.equal(b.unpriced, true);
  assert.deepEqual(b.coins.map((c) => c.value), ["$4.00", "1,234.567891 WIF"]);
  // control: not read yet, a wallet shows its own coin as Spending read it
  const c = yourWallets({ list: [w({ id: "c", site: "pump", cashUsd: "6.50" })], read: "ok" }).money[0]!;
  assert.deepEqual(c.coins.map((x) => [x.name, x.value]), [["Solana", "$6.50"]]);
});

test("Move back to Safe: a carried network's own coin at $2 or more; the site's other wallets swept by the same sheet", () => {
  const v = yourWallets({ list: LIST, coins: COINS, read: "ok" });
  const by = Object.fromEntries([...v.money, ...v.empty].map((c) => [c.site, c]));
  assert.deepEqual(by.pump!.back, { wallet: "pump-sol", name: "pump.fun", also: [], usd: 8.2 });
  // GMGN's Solana is empty: its BNB wallet leads
  assert.deepEqual(by.gmgn!.back, { wallet: "gmgn-bsc", name: "GMGN", also: [], usd: 3 });
  assert.equal(by["host:foo.xyz"]!.back, undefined, "Ethereum isn't carried back");
  assert.deepEqual(by["host:foo.xyz"]!.notes, [words.staysOn("Ethereum")]);
  assert.equal(by.jupiter!.back, undefined, "an unread wallet has nothing to move");
  assert.equal(by["host:app.example.com"]!.back, undefined, "an empty one has nothing to move");
  // both networks with money: one sheet, Solana first, BNB swept with it
  const two = yourWallets({ list: [w({ id: "g-bsc", site: "gmgn", network: "bsc", cashUsd: "2.00" }), w({ id: "g-sol", site: "gmgn", cashUsd: "9.00" })], read: "ok" });
  assert.deepEqual({ ...two.money[0]!.back!, usd: 0 }, { wallet: "g-sol", name: "GMGN", also: ["g-bsc"], usd: 0 });
  // the $2 floor, both sides of it
  const at = (cash: string) => yourWallets({ list: [w({ id: "p", site: "pump", cashUsd: cash })], read: "ok" }).money[0]!;
  assert.equal(BACK_MIN_USD, 2);
  assert.equal(at("1.99").back, undefined);
  assert.deepEqual(at("1.99").notes, [words.tooSmall]);
  assert.deepEqual(at("2.00").back, { wallet: "p", name: "pump.fun", also: [], usd: 2 });
  assert.deepEqual(at("2.00").notes, []);
});

test("coins bought on a site: sold there first, said plainly; control: only its own coin says nothing", () => {
  const v = yourWallets({ list: LIST, coins: COINS, read: "ok" });
  const pump = v.money.find((c) => c.site === "pump")!;
  assert.deepEqual(pump.notes, [words.sellFirst("pump.fun", "SOL")]);
  assert.equal(pump.notes[0], "Take out moves SOL only. Sell your other coins on pump.fun first.");
  const plain = yourWallets({ list: LIST, coins: { ...COINS, "pump-sol": [sol("41000000", 8.2)] }, read: "ok" }).money.find((c) => c.site === "pump")!;
  assert.deepEqual(plain.notes, []);
});

test("a wallet the chain can't read keeps its last view; a fresh read replaces it (control)", () => {
  let last = keepLast({}, { "pump-sol": [sol("41000000", 8.2)] });
  last = keepLast(last, { "pump-sol": null });
  assert.deepEqual(last["pump-sol"], [sol("41000000", 8.2)]);
  const v = yourWallets({ list: [w({ id: "pump-sol", site: "pump", unread: true })], coins: last, failed: new Set(["pump-sol"]), read: "ok" }).money[0]!;
  assert.equal(v.dollars, "$8.20");
  assert.equal(v.stale, true);
  assert.deepEqual(v.notes, [words.lastLook]);
  // never seen at all, and the chain doesn't answer: "Can't see it now", never $0.00
  const never = yourWallets({ list: [w({ id: "n", site: "pump", unread: true })], failed: new Set(["n"]), read: "ok" }).money[0]!;
  assert.equal(never.dollars, words.cantSee);
  assert.equal(never.usd, null);
  // control: the next read that answers replaces the last view
  last = keepLast(last, { "pump-sol": [sol("0", 0)] });
  const fresh = yourWallets({ list: [w({ id: "pump-sol", site: "pump", cashUsd: "0.00" })], coins: last, read: "ok" });
  assert.deepEqual([fresh.money.length, fresh.empty[0]!.dollars, fresh.empty[0]!.stale], [0, "$0.00", false]);
});

test("Move everything back: every wallet that can move, largest first; nothing that can't", () => {
  const v = yourWallets({ list: [...LIST, w({ id: "orca-sol", site: "orca", cashUsd: "25.00" }), w({ id: "tiny", site: "kamino", cashUsd: "1.00" })], coins: COINS, read: "ok" });
  assert.deepEqual(v.sweep.map((b) => b.wallet), ["orca-sol", "pump-sol", "gmgn-bsc"]);
  // control: nothing with money, nothing to sweep
  assert.deepEqual(yourWallets({ list: [w({ id: "e", site: "pump", cashUsd: "0.00" })], read: "ok" }).sweep, []);
});

test("the words are short and plain", () => {
  assert.equal(words.allLine(1), "One wallet.");
  assert.equal(words.allLine(3), "3 wallets, one at a time.");
  assert.equal(words.allStopped(1, 3), "1 of 3 on their way. The others still have their money.");
  assert.equal(words.showEmpty(4), "Show empty (4)");
});

test("QA 4 Nov: the Move back button says what the sheet moves (Spending's own-coin dollars), not the card's total of every coin", async () => {
  const { words } = await import("./your-wallets.ts");
  assert.equal(words.backUsd("$9.70"), "Take out $9.70");
});
