// Product decision, 3 Nov: pump.fun and GMGN are apps of their own; each opens on its wallet page (walletView), and a pump.fun or
// GMGN address typed or linked in the Browser hands off to that app (readAddress → "site", the hub's openApp).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import { goAddress, readAddress } from "./address.ts";
import type { HubRow } from "./hub-state.ts";
import { SLOW_MS, groupAddress, proofUrl, shortAddress, walletView, type SiteBack } from "./site-wallet.ts";

const ADDR = "So1ana1111111111111111111111111111111111111";
const row = (sol: number | null, more: Partial<HubRow> = {}): HubRow => ({
  site: "pump", name: "pump.fun", usd: sol, solUsd: sol, wallet: "sw-site-pump-sol", address: ADDR,
  wallets: [{ network: "sol", usd: sol, id: "sw-site-pump-sol", address: ADDR }], ...more,
});
const NOW = Date.parse("2026-11-03T12:00:00Z");
const add = (id: string, usd: string, status: SpendingActivity["status"], at: string, more: Partial<SpendingActivity> = {}): SpendingActivity => ({ id, kind: "ready", usd, status, shown: true, atIso: at, words: "", site: "pump", ...more });

test("the wallet page: its dollars, its coins, its address, Add and Take out, and the one big Open", () => {
  const v = walletView({ site: "pump", name: "pump.fun", row: row(12.4), read: "ok", now: NOW });
  assert.equal(v.dollars, "$12.40");
  assert.deepEqual(v.coins, [{ network: "sol", name: "Solana", symbol: "SOL", dollars: "$12.40", native: true }]);
  assert.equal(v.address, ADDR);
  assert.equal(v.canAdd, true);
  assert.equal(v.canTakeOut, true);
  assert.equal(v.open, "Open pump.fun");
  assert.deepEqual(v.lines, []);
  // control: under $2, Take out is off (it would mostly go on fees); $0.00 still lists its Solana coin
  const empty = walletView({ site: "pump", name: "pump.fun", row: row(0, { wallets: [] }), read: "ok", now: NOW });
  assert.equal(empty.canTakeOut, false);
  assert.deepEqual(empty.coins.map((c) => c.dollars), ["$0.00"]);
  assert.equal(walletView({ site: "gmgn", name: "GMGN", read: "first", now: NOW }).open, "Open GMGN");
  // GMGN: an empty Base wallet ("0 ETH", no price) is no coin; one holding some is, with what it holds
  const base = (holds: string) => ({ network: "base", usd: null, holds, id: "sw-site-gmgn-base", address: "0xb" });
  const gmgn = (holds: string) => walletView({ site: "gmgn", name: "GMGN", row: { ...row(0), site: "gmgn", name: "GMGN", wallets: [{ network: "sol", usd: 0, id: "s", address: ADDR }, base(holds)] }, read: "ok", now: NOW }).coins;
  assert.deepEqual(gmgn("0 ETH").map((c) => `${c.name} ${c.dollars}`), ["Solana $0.00"]);
  // builder 25 (J8): a Base wallet holding some is no coin row in V1 either (core app-chains.ts): its Solana one shows
  assert.deepEqual(gmgn("0.0012 ETH").map((c) => `${c.name} ${c.dollars}`), ["Solana $0.00"], "no Base row in V1");
});

test("never $0.00 for a wallet it can't see; before the first read, no money buttons", () => {
  const first = walletView({ site: "pump", name: "pump.fun", read: "first", now: NOW });
  assert.equal(first.dollars, "Reading", "builder 25 (item 2): the word, never an ellipsis");
  assert.equal(first.canAdd, false);
  assert.equal(first.canTakeOut, false);
  const failed = walletView({ site: "pump", name: "pump.fun", row: row(null), read: "failed", now: NOW });
  assert.equal(failed.dollars, "Can't see it now");
  assert.match(failed.lines.join("\n"), /Solana didn't answer\. This is from the last look\./);
  // control: the same row read fine
  assert.equal(walletView({ site: "pump", name: "pump.fun", row: row(3), read: "ok", now: NOW }).dollars, "$3.00");
});

test("an Add on its way: Add waits, the line says so; slow after three minutes, said plainly at the bottom", () => {
  const on = walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", moving: { usd: 10, sinceMs: NOW - 30_000 }, now: NOW });
  assert.equal(on.canAdd, false, "never a second Add while one is on its way");
  assert.deepEqual(on.lines, ["$10.00 is on its way. NEAR takes 3–4 minutes."], "no row for it yet: the line, naming who moves it, never \"About a minute\"");
  const slow = walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", moving: { usd: 10, sinceMs: NOW - SLOW_MS - 1 }, now: NOW });
  assert.deepEqual(slow.lines, ["NEAR is slow right now. $10.00 is still on its way."]);
  // a normal Add takes NEAR 3–4 minutes (5 Nov): at 4 minutes it is not "slow" (control)
  assert.deepEqual(walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", moving: { usd: 10, sinceMs: NOW - 4 * 60_000 }, now: NOW }).lines, ["$10.00 is on its way. NEAR takes 3–4 minutes."]);
});

test("its last moves: Adds from Spending's record and Take outs from the core's, its own site only, newest first", () => {
  const adds = [
    add("a1", "10.00", "done", "2026-11-03T10:00:00Z"),
    add("a2", "5.00", "failed", "2026-11-03T11:00:00Z", { note: "It stopped in Spending. It's safe there." }),
    add("a3", "7.00", "on-its-way", "2026-11-03T11:30:00Z", { site: "gmgn" }),
    add("a4", "3.00", "on-its-way", "2026-11-03T11:40:00Z", { of: "a1" }),
  ];
  const backs: SiteBack[] = [{ back: { id: "b1", status: "done", usd: 4, site: "pump", startedAtIso: "2026-11-03T11:50:00Z" }, home: { status: "done" } }];
  const v = walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", adds, backs, now: NOW });
  assert.deepEqual(v.moves.map((m) => [m.title, m.detail, m.state]), [
    ["Take out $4.00", "It's in your Safe.", "done"],
    ["Add $5.00", "It stopped in Spending. It's safe there.", "failed"],
    ["Add $10.00", "It's in this wallet.", "done"],
  ]);
  // control: GMGN's page lists GMGN's move only
  assert.deepEqual(walletView({ site: "gmgn", name: "GMGN", read: "ok", adds, backs, now: NOW }).moves.map((m) => m.id), ["a3"]);
});

test("the address: short in its row, whole in groups of four on the QR sheet, provable on Solscan", () => {
  assert.equal(shortAddress(ADDR), "So1ana…111111", "six and six (Sim test)");
  assert.equal(groupAddress("abcdefghij"), "abcd efgh ij");
  assert.equal(proofUrl(ADDR), `https://solscan.io/account/${ADDR}`);
});

test("pump.fun or GMGN typed or linked in the Browser hands off to its own app; other sites stay in the Browser", async () => {
  const listed = ["pump", "gmgn"];
  assert.deepEqual(readAddress("pump.fun", listed), { kind: "site", site: "pump" });
  assert.deepEqual(readAddress("https://pump.fun/coin/abc", listed), { kind: "site", site: "pump" });
  assert.deepEqual(readAddress("http://gmgn.ai/sol/token/x", listed), { kind: "site", site: "gmgn" });
  assert.deepEqual(readAddress("GMGN.AI", listed), { kind: "site", site: "gmgn" });
  // controls: another site opens as a page; a look-alike host is never pump.fun
  assert.equal(readAddress("app.rhea.finance", listed).kind, "url");
  assert.equal(readAddress("pump.fun.evil.example", listed).kind, "url");
  for (const phone of [true, false]) {
    const did: string[] = [];
    const r = await goAddress("pump.fun", { listed, phone, onSite: (s) => did.push(`app ${s}`), onLine: (l) => did.push(`line ${l}`), openTab: (u) => did.push(`tab ${u}`), openSite: async (u) => (did.push(`window ${u}`), { opened: "wallet" as const }) });
    assert.equal(r, "site");
    assert.deepEqual(did, ["app pump"], phone ? "on the phone" : "on the web");
  }
  // the Browser's hand-off: the site's own app (the shell's landing opens "site:pump"), its tiles gone from the start page
  const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");
  assert.match(hub, /const onSiteId = \(id: string\) => shell\.openApp\("social", id\);/);
  assert.match(hub, /const tiles = rows\.filter\(\(r\) => !ownApp\(r\.site\)\);/);
  assert.doesNotMatch(hub, /bridge\.on<[^>]*>\("device\.site\.signin"/, "its sign-in task is its own app's, never published twice");
  assert.match(readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8"), /bridge\.on<\{ host\?: string; state\?: string \}>\("device\.site\.signin"/);
});

test("each move links its own transaction (Activity's proof): an Add its landing, a Take out its start; never a made-up link", () => {
  const sig = "5".repeat(64);
  const end = { chain: "sol", hash: sig, url: `https://solscan.io/tx/${sig}` };
  const adds = [add("a1", "10.00", "done", "2026-11-03T10:00:00Z", { proof: { start: { chain: "near", hash: "x".repeat(44), url: "https://nearblocks.io/txns/x" }, end } })];
  const backs: SiteBack[] = [{ back: { id: "b1", status: "pending", usd: 4, site: "pump", startedAtIso: "2026-11-03T11:00:00Z", proof: { start: end } } }];
  const v = walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", adds, backs, now: NOW });
  assert.deepEqual(v.moves.map((m) => m.url), [`https://solscan.io/tx/${sig}`, `https://solscan.io/tx/${sig}`]);
  // controls: no proof, no link; a link to another host is dropped, never shown
  const none = walletView({ site: "pump", name: "pump.fun", row: row(1), read: "ok", adds: [add("a2", "1.00", "done", "2026-11-03T10:00:00Z", { proof: { end: { chain: "sol", hash: sig, url: "https://evil.example/tx" } } }), add("a3", "1.00", "done", "2026-11-03T09:00:00Z")], now: NOW });
  assert.deepEqual(none.moves.map((m) => m.url), [undefined, undefined]);
  // the Browser opens a handed-over link only when it is an explorer's page
  const hub = readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8");
  assert.match(hub, /if \(!link \|\| !browser \|\| handed\.current === shell\.requestSeq \|\| !proofUrlOk\(link\)\) return;/);
  // Sim pass (4 Nov): the Sim's addresses are made up, so its wallet page shows no explorer link at all
  const page = readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8");
  assert.match(page, /const explorer = !simPage\(\);/);
  assert.match(page, /\{explorer && m\.url && <button className="sw-view"/);
  assert.match(page, /\{explorer && v\.address && <button className="sw-proof"/);
  // control: no other explorer button is left unguarded
  assert.equal((page.match(/view\(proofUrl|view\(m\.url/g) ?? []).length, 2);
});

test("every coin a site wallet holds, from the core: the network's coin first, priced in dollars; no price shows the amount, never $0.00; an empty coin is left out (control: without the core's list, the wallet's own coin as before)", async () => {
  const { coinAmount, coinsFromCore, walletView } = await import("./site-wallet.ts");
  assert.equal(coinAmount("1234500000", 9), "1.2345");
  assert.equal(coinAmount("1000000", 6), "1");
  assert.equal(coinAmount("5", 9), "0.000000".slice(0, 0) + "0");
  assert.equal(coinAmount("abc", 9), "?");
  const rows = coinsFromCore([{ network: "sol", coins: [
    { token: "native", symbol: "SOL", name: "Solana", decimals: 9, amount: "250000000", usd: 37.5 },
    { token: "DezX", symbol: "BONK", name: "Bonk", decimals: 5, amount: "123456789", usd: null },
    { token: "Zero", symbol: "ZERO", decimals: 6, amount: "0", usd: 0 },
  ] }]);
  assert.deepEqual(rows, [
    { network: "sol", name: "Solana", symbol: "SOL", dollars: "$37.50", native: true },
    { network: "sol", name: "Bonk", symbol: "BONK", dollars: "1234.56789 BONK" },
  ]);
  // UI audit 5 Nov: the network's own coin is named by its network ("Solana" over "SOL", never "SOL" over "SOL")
  assert.equal(coinsFromCore([{ network: "sol", coins: [{ token: "native", symbol: "SOL", name: "SOL", decimals: 9, amount: "1", usd: 1 }] }])[0]!.name, "Solana");
  assert.equal(coinsFromCore([{ network: "sol", coins: [{ token: "native", symbol: "SOL", decimals: 9, amount: "1", usd: 1 }] }])[0]!.name, "Solana");
  assert.equal(coinsFromCore([{ network: "sol", coins: [{ token: "DezX", symbol: "BONK", decimals: 5, amount: "1", usd: 1 }] }])[0]!.name, "BONK", "control: another coin keeps its own name");
  // the audit (spoofing on a money screen): native is the core's token mark, never the symbol. An airdropped mint
  // calling itself "SOL" with no name keeps its own symbol and gets no native mark (so the page gives it its letter disc,
  // never Solana's name or logo)
  const fake = coinsFromCore([{ network: "sol", coins: [{ token: "FakeSo1Mint1111111111111111111111111111111", symbol: "SOL", decimals: 9, amount: "1", usd: null }] }])[0]!;
  assert.equal(fake.name, "SOL");
  assert.equal(fake.native, undefined);
  assert.equal(coinsFromCore([{ network: "sol", coins: [{ token: "native", symbol: "SOL", decimals: 9, amount: "1", usd: 1 }] }])[0]!.native, true, "control: the real native coin is marked");
  const swa = readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8");
  assert.match(swa, /\{c\.native \? <img className="sw-row__logo" src=\{logoUrl\(c\.network\)\}/);
  assert.doesNotMatch(swa, /NATIVE\[c\.network\] === c\.symbol/);
  const row = { site: "pump", name: "pump.fun", usd: 37.5, wallet: "w1", wallets: [{ network: "sol", usd: 37.5, id: "w1", address: "So1" }] } as never;
  const base = { site: "pump", name: "pump.fun", row, read: "ok" as const, now: 0 };
  assert.deepEqual(walletView({ ...base, coins: [{ network: "sol", coins: [{ token: "native", symbol: "SOL", decimals: 9, amount: "250000000", usd: 37.5 }, { token: "DezX", symbol: "BONK", decimals: 5, amount: "100000", usd: 2 }] }] }).coins.map((c) => c.symbol), ["SOL", "BONK"]);
  assert.deepEqual(walletView(base).coins.map((c) => c.symbol), ["SOL"], "control: no list from the core, the wallet's own coin");
});

test("the total is every coin's dollars (independent UI grade: never $0.00 above a $2.47 coin); a coin with no price is left out and said so (control: no list, the wallet's own dollars)", async () => {
  const { walletView } = await import("./site-wallet.ts");
  // the big number is the wallet's one figure (spending.wallets counts its coins, site-one-figure.test.ts): $2.47 here
  const row = { site: "pump", name: "pump.fun", usd: 2.47, wallet: "w1", wallets: [{ network: "sol", usd: 0, id: "w1", address: "So1" }] } as never;
  const base = { site: "pump", name: "pump.fun", row, read: "ok" as const, now: 0 };
  const sol = { token: "native", symbol: "SOL", decimals: 9, amount: "1", usd: 0 };
  const bonk = { token: "DezX", symbol: "BONK", decimals: 5, amount: "100000", usd: 2.47 };
  const odd = { token: "Odd", symbol: "ODD", decimals: 6, amount: "5000000", usd: null };
  const a = walletView({ ...base, coins: [{ network: "sol", coins: [sol, bonk] }] });
  assert.equal(a.dollars, "$2.47");
  assert.equal(a.totalNote, undefined);
  const b = walletView({ ...base, coins: [{ network: "sol", coins: [sol, bonk, odd] }] });
  assert.equal(b.dollars, "$2.47");
  assert.equal(b.totalNote, "Plus coins with no price.");
  assert.equal(walletView({ ...base, coins: [{ network: "sol", coins: [odd] }] }).totalNote, "Your coins have no price yet.");
  assert.equal(walletView(base).dollars, "$2.47", "control: no list from the core, the same one figure");
});

test("an Add's job is its row in Moves on the frame \"Job created.\" shows, never \"Nothing yet\" while Spending's row is read; then one row, Spending's (controls: another site's job, a job that ended, and the page's own wiring)", () => {
  const job = { id: "starting-1", title: "Add $10.00 to your pump.fun wallet", state: "pending", startedAt: NOW, usd: "$10.00" };
  const v = walletView({ site: "pump", name: "pump.fun", row: row(0), read: "ok", now: NOW, adds: [], jobs: [job] });
  assert.deepEqual(v.moves.map((m) => [m.title, m.state]), [["Add $10.00", "moving"]], "the job's row at once");
  // Spending's row for it read: one row, its own
  const add = { id: "mv-1", kind: "top-up", usd: "10.00", words: "Add $10.00 to your pump.fun wallet", status: "on-its-way", shown: true, atIso: new Date(NOW).toISOString(), site: "pump" } as SpendingActivity;
  const both = walletView({ site: "pump", name: "pump.fun", row: row(0), read: "ok", now: NOW, adds: [add], jobs: [job] });
  assert.deepEqual(both.moves.map((m) => m.id), ["mv-1"], "one move, one row");
  // controls
  assert.equal(walletView({ site: "pump", name: "pump.fun", row: row(0), read: "ok", now: NOW, jobs: [{ ...job, title: "Add $10.00 to your GMGN wallet" }] }).moves.length, 0, "another site's job");
  assert.equal(walletView({ site: "pump", name: "pump.fun", row: row(0), read: "ok", now: NOW, jobs: [{ ...job, state: "failed" }] }).moves.length, 0, "a job that ended");
  const page = readFileSync(new URL("./SiteWalletApp.tsx", import.meta.url), "utf8");
  assert.match(page, /return st\.subscribe\(\(\) => setJobs\(st\.list\(\)\)\);/, "the page re-draws on the job's publish, the same frame");
  assert.match(page, /now: Date\.now\(\), coins, jobs, \.\.\.\(kept \? \{ kept \} : \{\}\), solanaDown \}\);/);
});
