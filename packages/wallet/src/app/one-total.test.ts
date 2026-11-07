// the copy review's A2-3 and J2-5 (8 Nov, the Sim): set-up said $5,515.49, Home Safe $5,288.01 + Hot $172.54, the Move sheet "All your
// wallets $5,460.55" with Safe $5,254.15. One total everywhere: Home's two pills added. These read the three screens'
// figures from ONE set of reads (the Sim's own figures) and need them equal; each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBalanceParts } from "./balance-parts.ts";
import { balanceTotal, safeLines } from "./format.ts";
import { tradingUsd } from "./trading.ts";
import { moveHead, oneTotal, OUTSIDE_WORDS, privateOfLine, safeRowFigure } from "./one-total.ts";
import { placesNow, totalOf } from "./screens/move-split.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Balance, PrivatePocket } from "../types.ts";

const row = (tokenId: string, symbol: string, amount: string, usd: string, held: Balance["held"]): Balance => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", amount, usd, bridged: false, held, listed: true });
// the Sim's start, as the walk read it (base 0518e6948): the Safe $5,254.15 of its own, Private $33.86 inside Home's Safe pill
const SAFE = [row("nep141:wrap.near", "NEAR", "326.9", "1448.16", "ledger"), row("usdc", "USDC", "3805.99", "3805.99", "ledger")];
const POCKET: PrivatePocket = { available: true, ready: true, rows: [row("usdc", "USDC", "25", "25", "private"), row("nep141:wrap.near", "NEAR", "2", "8.86", "private")], defaultOn: false };
const SPENDING = { loaded: true, unread: false, totalUsd: "172.54", reserveUsd: "0.00", cashUsd: "172.54", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "327.46", ready: true, firstTopUp: false, onItsWay: [],
  networks: [{ network: "sol", name: "Solana", cashUsd: "144.37", coinsUsd: "0.00", readyUsd: "143.37" }, { network: "hood", name: "Robinhood Chain", cashUsd: "28.17", coinsUsd: "0.00", readyUsd: "27.86" }, { network: "bsc", name: "BNB Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0.00", closed: true }] };
const WALLETS = [
  { id: "sw-trade-sol", role: "chain", network: "sol", label: "Solana wallet", cashUsd: "144.37", coinsUsd: "0.00" },
  { id: "sw-site-pump-sol", role: "site", site: "pump", network: "sol", label: "pump.fun wallet", cashUsd: "25.00", coinsUsd: "2.47" },
  { id: "sw-site-gmgn-sol", role: "site", site: "gmgn", network: "sol", label: "GMGN wallet", cashUsd: "25.00", coinsUsd: "2.47" },
  { id: "sw-site-gmgn-base", role: "site", site: "gmgn", network: "base", label: "GMGN wallet", holds: "0 ETH" },
];
const bridge = (spending: unknown = SPENDING, wallets: unknown[] = WALLETS) => ({
  call: async (m: string) => {
    const r = ({ "ledger.balances": SAFE, "ledger.chains": [], "ledger.tokens": [], "earn.positions": [], "ledger.private": POCKET, "account.state": { kid: false }, "spending.status": spending, "trade.positions": [], "spending.wallets": wallets, "account.agent.balance": null, "subwallet.float.balance": { tokens: [] } } as Record<string, unknown>)[m];
    return r === undefined ? { problem: { code: "mock.unknown" } } : { ok: r };
  },
  on: () => () => {},
}) as never;

test("A2-3: set-up, Home and the Move sheet show ONE total from the same reads: $5,515.49 (control: the Move sheet's own places sum, the $5,460.55 53 saw)", async () => {
  // Home: its Safe pill (Private inside it) + its Hot pill (home-cache.ts viewOf: tradingUsd over the same reads)
  const hot = tradingUsd(SPENDING as never, [], WALLETS as never, []);
  const safePill = balanceTotal(SAFE, [], [], POCKET);
  assert.equal(safePill, "5288.01", "Home's Safe pill");
  assert.equal(hot.usd, "227.48", "Home's Hot pill: SOL $144.37 + ETH (RH) $28.17 + pump.fun $27.47 + GMGN $27.47");
  const home = (Number(safePill) + Number(hot.usd)).toFixed(2);
  // set-up (DemoMoneyIn: useBalanceParts → balance-parts.ts)
  const setup = await readBalanceParts(bridge());
  assert.deepEqual(setup, { usd: "5515.49", partial: false, safeUsd: "5288.01", privateUsd: "33.86", hotUsd: "227.48" });
  assert.equal(setup!.usd, home, "set-up = Home");
  // the Move sheet (MoveSheet.tsx: its places, then moveHead over oneTotal)
  const places = placesNow({ safeUsd: Number(safeLines(SAFE, POCKET, []).totalUsd), safeMostUsd: 0, privateUsd: 33.86, privateMostUsd: 0, networks: SPENDING.networks, reserveUsd: SPENDING.reserveUsd });
  assert.equal(totalOf(places), 5460.55, "control: the places alone, the headline 53 saw");
  assert.deepEqual(places.filter((p) => p.place === "safe" || p.place === "private").map((p) => p.usd), [5254.15, 33.86], "Safe $5,254.15 · Private $33.86: Private named beside the Safe");
  const all = oneTotal({ balances: SAFE, chains: [], earning: [], pocket: POCKET, trading: hot.usd, tradingPartial: hot.partial });
  const head = moveHead(all, totalOf(places), WALLETS as never);
  assert.equal(head.total.toFixed(2), home, "the Move sheet's headline = Home");
  assert.deepEqual(head.outside, { usd: 54.94, names: ["pump.fun", "GMGN"] }, "the still row: what Move doesn't take, by name (GMGN once)");
  assert.equal(OUTSIDE_WORDS.title, "Not moved");
  assert.equal(OUTSIDE_WORDS.line(head.outside!.names), "pump.fun and GMGN wallets stay where they are.");
  assert.equal(OUTSIDE_WORDS.line(["pump.fun"]), "pump.fun wallet stays where it is.");
  assert.equal(OUTSIDE_WORDS.line([OUTSIDE_WORDS.coins]), "Coins in your wallets stay where they are.");
  // the copy review's B+ (8 Nov): one figure per name. Home's Safe pill, set-up's "Safe" and the Move sheet's Safe row are one number
  const moveSafe = safeRowFigure(places.find((p) => p.place === "safe")!.usd, places.find((p) => p.place === "private")!.usd);
  assert.deepEqual([safePill, setup!.safeUsd, moveSafe.toFixed(2)], ["5288.01", "5288.01", "5288.01"], "every screen's Safe figure is the same");
  assert.equal(Math.round((totalOf(places) + head.outside!.usd) * 100) / 100, head.total, "the rows add up to the headline");
  // controls: Hot not whole yet, the headline is the places' sum as before, no still row; nothing outside, no row
  assert.deepEqual(moveHead(oneTotal({ balances: SAFE, chains: [], earning: [], pocket: POCKET, trading: hot.usd, tradingPartial: true }), totalOf(places), WALLETS as never), { total: 5460.55, outside: null });
  assert.deepEqual(moveHead("5460.55", totalOf(places), []), { total: 5460.55, outside: null });
  assert.deepEqual(moveHead("5470.55", totalOf(places), []).outside, { usd: 10, names: [OUTSIDE_WORDS.coins] }, "coins held in the wallets, said as such");
});

test("A2-3: the Move sheet's headline is drawn from moveHead(oneTotal(…)), never the places' own sum; its money logic keeps the places", () => {
  const src = readFileSync(new URL("./screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const shown = x\.place === "safe" \? safeRowFigure\(own, privShown\) : own, was = x\.place === "safe" \? safeRowFigure\(said\(start\), start\.private \?\? 0\) : said\(start\);/, "the Safe row says Home's Safe figure, before and after");
  assert.match(src, /\{x\.place === "private" && <span className="wl-mv-now" data-testid="move-private-of">\{privateOfLine\(\)\}<\/span>\}/, "Private's row says how it counts");
  assert.match(src, /const headLive = moveHead\(oneTotal\(\{ balances, chains, earning, pocket, trading, tradingPartial \}\), totalOf\(live\), wallets\);/);
  assert.match(src, /if \(frozen === null\) outsideHeld\.current = headLive\.outside;/, "held from the tap on (D140)");
  assert.match(src, /<p className="wl-mv-total" data-testid="move-total" aria-label=\{`\$\{MOVE_WORDS\.head\}: \$\{usdShort\(headline\)\}`\}>\{usdShort\(headline\)\}<\/p>/);
  assert.match(src, /const block = allStill && total >= 2 \? MOVE_WORDS\.still : moveBlock\(legs, total, HOME_PROOF, now\);/, "control: what can move is still the places' own sum");
});

test("A2-3: set-up waits while Spending hasn't named the SOL and ETH (RH) wallets (it said $5,342.95, Home said Updating…); controls: named, whole; a site's unread wallet, whole", async () => {
  // the Sim's first answer after set-up's engine start (read in a debug walk of 0518e6948): loaded, no wallet named yet
  const early = { ...SPENDING, totalUsd: "0.00", cashUsd: "0.00", networks: [] };
  const r = await readBalanceParts(bridge(early));
  assert.equal(r!.partial, true, "no SOL or ETH (RH) row yet: partial");
  assert.equal(r!.usd, "5342.95", "the figure set-up showed in a run on 0518e6948 (the Safe and the sites, no trade wallets)");
  assert.equal((await readBalanceParts(bridge()))!.partial, false, "control: both named, whole");
  const unreadSite = WALLETS.map((w) => (w.role === "site" ? { ...w, unread: true } : w));
  assert.equal((await readBalanceParts(bridge(SPENDING, unreadSite)))!.partial, false, "control: a site's unread wallet never holds set-up back (as Home counts without it)");
});

test("A2-3: a site's wallet made after Home read its wallets makes Home read them again (Hot said $172.54 without the sites); control: asking again for the same wallet says nothing", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  const heard: unknown[] = [];
  m.on("ledger.balancesChanged", (p) => heard.push(p));
  const made = await m.call("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" });
  assert.ok("ok" in made, JSON.stringify(made));
  assert.deepEqual(heard, [{ parts: ["spending"] }], "Home's spending part (spending.wallets) is read again");
  await m.call("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" });
  assert.equal(heard.length, 1, "control: the same wallet again, no new read");
  const reads = readFileSync(new URL("./home-reads.ts", import.meta.url), "utf8");
  assert.match(reads, /bridge\.on<\{ parts\?: unknown \} \| undefined>\("ledger\.balancesChanged", \(p\) => \{/, "Home hears it, by part");
});

test("A2-3: Home's reads started at boot go stale when the money changes before Home opens (the Sim makes the sites' wallets during set-up); control: nothing changed, Home takes them", async () => {
  const { kickEarly, takeHomeReads } = await import("./home-keep.ts");
  const make = () => {
    const subs = new Map<string, ((p: unknown) => void)[]>();
    let asked = 0;
    const b = { call: async (m: string) => { if (m === "spending.status") asked += 1; return { problem: { code: "mock.unknown" } }; }, on: (e: string, h: (p: unknown) => void) => { subs.set(e, [...(subs.get(e) ?? []), h]); return () => subs.set(e, (subs.get(e) ?? []).filter((x) => x !== h)); } };
    return { b: b as never, emit: (e: string) => (subs.get(e) ?? []).forEach((h) => h({})), asked: () => asked, listeners: (e: string) => (subs.get(e) ?? []).length };
  };
  const changed = make();
  kickEarly(changed.b, 1_000);
  const early = changed.asked();
  changed.emit("ledger.balancesChanged");
  takeHomeReads(changed.b, 2_000);
  assert.equal(changed.asked(), early + 1, "a change came: Home asks again");
  assert.equal(changed.listeners("ledger.balancesChanged"), 0, "and stops listening");
  const still = make();
  kickEarly(still.b, 1_000);
  const before = still.asked();
  takeHomeReads(still.b, 2_000);
  assert.equal(still.asked(), before, "control: nothing changed, the early reads are Home's");
});

test("J2-5: Move's cap line is the person's rule, and names no place it isn't changed in (the cap lives on the NEAR wallet's top-up, not Protection)", () => {
  const split = readFileSync(new URL("./screens/move-split.ts", import.meta.url), "utf8");
  assert.match(split, /safeKeepsCap: \(usd: string, cap: string\) => `\$\{usd\} stays in your Safe\. Your rule: wallets hold up to \$\{cap\} in all\.`/);
  const spending = readFileSync(new URL("./screens/Spending.tsx", import.meta.url), "utf8");
  assert.match(spending, /onClick=\{onCap\}>Your NEAR wallet holds up to \{wholeDollars\(status\.capUsd\)\} · Change<\/button>/, "where it really changes");
});

test("the audit's MUST (8 Nov): Private under the Safe's total is 'counted in' it, never 'part of your Safe' or under its Face ID; a browser says nothing to approve (control: the phone's words)", () => {
  assert.equal(privateOfLine(true), "Counted in your Safe's total. No Face ID.");
  assert.equal(privateOfLine(false), "Counted in your Safe's total. Nothing to approve.");
  const screens = ["./one-total.ts", "./screens/MoveSheet.tsx", "./money/send-cap.ts", "../../../../apps/web/src/gallery/demo-money-in.ts", "../../../../apps/web/src/gallery/DemoMoneyIn.tsx"]
    .map((f) => [f, readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")] as const);
  for (const [f, src] of screens) {
    assert.doesNotMatch(src, /part of your Safe/i, `${f}: Private is never "part of your Safe"`);
    assert.doesNotMatch(src, /Private[^\n]{0,80}(protected|guarded) by Face ID|Face ID protects[^\n]{0,40}Private/i, `${f}: never Private under Face ID`);
  }
  const setup = readFileSync(new URL("../../../../apps/web/src/gallery/DemoMoneyIn.tsx", import.meta.url), "utf8");
  assert.match(setup, /data-testid="demo-money-private">\{privateOfLine\(\)\}<\/p>/, "set-up's parts line says it too");
});
