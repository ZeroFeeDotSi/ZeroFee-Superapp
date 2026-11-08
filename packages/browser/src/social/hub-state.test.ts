// Social trading's rows and its last-read paint (hub-state.ts), and its background set-up (prepare.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingWallet } from "@zerofee/core/spending";
import { readFileSync } from "node:fs";
import { LANDING_MS, SPENDING_FILLS, fundedLine, goesTo, hubRows, solOf, landing, notCarried, pickable, readHub, readLanding, readPick, saveHub, saveLanding, savePick, tileTap, type HubRow } from "./hub-state.ts";
import { prepareSites } from "./prepare.ts";
import { TAKES_OUT, stays, takeOutAlso, tooSmall } from "./take-out.ts";

const w = (o: Partial<SpendingWallet>): SpendingWallet => ({ id: "x", role: "site", network: "sol", address: "Addr1111", label: "", current: true, inCap: false, keyExported: false, ...o }) as SpendingWallet;

test("the rows: pump.fun and GMGN first, always; another site only while its wallet holds money; never a chain wallet or an older one", () => {
  const rows = hubRows([
    w({ id: "site-gmgn-sol-a", site: "gmgn", cashUsd: "4.20" }),
    w({ id: "site-jupiter-sol-a", site: "jupiter", cashUsd: "12.00" }),
    w({ id: "site-orca-sol-a", site: "orca", cashUsd: "0.00" }),
    w({ id: "site-pump-sol-old", site: "pump", cashUsd: "50.00", current: false }),
    w({ id: "trade-sol-a", role: "chain", cashUsd: "99.00" }),
    w({ id: "site-gmgn-base-a", site: "gmgn", network: "base", cashUsd: "7.00" }),
  ]);
  // ST13: GMGN's tile is ONE number, its wallets together; builder 25 (J8): on the app's chains only (core app-chains.ts),
  // so GMGN's Base $7.00 is never in it (V1: SOL, NEAR and Robinhood); its Add fills the Solana one
  assert.deepEqual(rows.map((r) => [r.site, r.usd, r.wallet ?? null]), [["pump", 0, null], ["gmgn", 4.2, "site-gmgn-sol-a"], ["jupiter", 12, "site-jupiter-sol-a"]]);
  // a wallet that can't be read is no figure, never $0
  assert.equal(hubRows([w({ id: "site-pump-sol-a", site: "pump", unread: true })])[0]!.usd, null);
});

test("the last read paints at once: only sites and dollars are kept, never an address or an id; unreadable storage is 'not read yet'", () => {
  const box = new Map<string, string>();
  const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
  saveHub([{ site: "pump", name: "pump.fun", usd: 9.7, wallet: "site-pump-sol-a", address: "SecretlyPublicAddr" }], store);
  const kept = [...box.values()].join("");
  assert.doesNotMatch(kept, /site-pump-sol-a|SecretlyPublicAddr/);
  assert.deepEqual(readHub(store), [{ site: "pump", name: "pump.fun", usd: 9.7 }]);
  assert.deepEqual(readHub({ getItem: () => "{nonsense" }).map((r) => [r.site, r.usd]), [["pump", null], ["gmgn", null]]);
  assert.deepEqual(readHub({ getItem: () => JSON.stringify({ rows: [{ site: "evil", usd: 1 }] }) }).map((r) => r.site), ["pump", "gmgn"], "a site ZeroFee doesn't know is dropped");
});

test("prepareSites makes every wallet of pump.fun and GMGN the core has (ST13: GMGN's Solana and Base), Solana first, and asks for nothing that moves money", async () => {
  const asked: [string, Record<string, unknown>][] = [];
  const bridge = { call: async (m: string, p: Record<string, unknown> = {}) => (asked.push([m, p]), { ok: { id: `site-${p.siteId}-${p.chain}-a` } }), on: () => () => {} } as never;
  assert.deepEqual(await prepareSites(bridge), ["site-pump-sol-a", "site-gmgn-sol-a", "site-gmgn-base-a"]);
  assert.deepEqual(asked, [["subwallet.create", { kind: "site", chain: "sol", siteId: "pump" }], ["subwallet.create", { kind: "site", chain: "sol", siteId: "gmgn" }], ["subwallet.create", { kind: "site", chain: "base", siteId: "gmgn" }]]);
});

test("ST13: the tile's one number; an unread wallet Spending fills makes it unknown, an unread or unpriced wallet it doesn't fill never does", () => {
  const gmgn = (ws: Partial<SpendingWallet>[]) => hubRows(ws.map((o) => w({ site: "gmgn", ...o })))[1]!;
  assert.equal(gmgn([{ id: "s", cashUsd: "10.00" }, { id: "b", network: "base", holds: "0.0012 ETH" }]).usd, 10, "Base's ETH has no price: adds nothing");
  assert.equal(gmgn([{ id: "s", cashUsd: "10.00" }, { id: "b", network: "base", unread: true }]).usd, 10, "Base unread never blanks the tile");
  assert.equal(gmgn([{ id: "s", unread: true }, { id: "b", network: "base", holds: "0 ETH" }]).usd, null, "Solana unread: never a smaller number");
  assert.equal(gmgn([{ id: "s", cashUsd: "0.10" }, { id: "b", network: "base", cashUsd: "0.20" }]).usd, 0.1, "builder 25 (J8): Base's figure is never in it");
  assert.equal(gmgn([{ id: "s", cashUsd: "0.10", coinsUsd: "0.20" }]).usd, 0.3, "summed in cents");
  // review ST13 M1: SOL's price not read ("0.5 SOL", no dollars) is unknown, never $0.00 (no "empty" ask, no Add over money)
  const unpriced = gmgn([{ id: "s", holds: "0.5 SOL" }]);
  assert.deepEqual([unpriced.usd, unpriced.solUsd], [null, null]);
  assert.deepEqual(tileTap(unpriced, undefined, "ok"), { kind: "open" }, "it opens the site, never the money sheet");
  assert.equal(gmgn([{ id: "s", holds: "0 SOL" }]).usd, 0, "an empty Solana wallet with no price is still $0.00");
  // review ST13 M2: the Solana wallet's own dollars drive Take out, the window's pill and an Add landing
  const both = gmgn([{ id: "s", cashUsd: "0.00" }, { id: "b", network: "base", cashUsd: "7.00" }]);
  assert.deepEqual([both.usd, both.solUsd, solOf(both)], [0, 0, 0], "builder 25 (J8): GMGN's Base wallet isn't shown in V1");
  assert.equal(solOf({ site: "pump", name: "pump.fun", usd: 3 }), 3, "a row kept on the device (no solUsd yet): the tile's own");
  const t0 = 5_000_000;
  const a = landing([{ site: "gmgn", usd: "5" }], {}, [both], t0).moving;
  assert.equal(a.gmgn!.from, 0, "an Add's start is the Solana wallet's, not the sum");
});

test("ST13: the wallet sheet lists only the wallets with money, Solana first; builder 25 (J8): the app's chains only", () => {
  const r = (wallets: HubRow["wallets"]): HubRow => ({ site: "gmgn", name: "GMGN", usd: 0, wallet: "s", wallets });
  assert.equal(fundedLine(r([{ network: "base", usd: 2.4, id: "b", address: "0x" }, { network: "sol", usd: 10, id: "s", address: "A" }])), "Solana $10.00");
  assert.equal(fundedLine(r([{ network: "sol", usd: 0, id: "s", address: "A" }, { network: "base", usd: null, holds: "0 ETH", id: "b", address: "0x" }])), "", "nothing with money: no line");
  assert.equal(fundedLine(r([{ network: "sol", usd: 1234.5, id: "s", address: "A" }, { network: "base", usd: null, holds: "0.0012 ETH", id: "b", address: "0x" }])), "Solana $1,234.50");
});

test("ST13: the question shows only when two or more networks fill (the auditor's rule); the last pick is kept per site, Solana the first time", () => {
  assert.deepEqual(SPENDING_FILLS, ["sol"], "today Spending fills Solana only (BNB closed until D13; Base and Ethereum never filled)");
  assert.deepEqual(pickable("gmgn"), ["sol"], "so GMGN's sheet goes straight to Solana");
  assert.deepEqual(pickable("pump"), ["sol"]);
  // builder 25 (J8): V1 shows the app's chains only (core app-chains.ts): even a fill switched on for BNB asks nothing;
  // the question switches on by itself the day app-chains.ts lists a second chain GMGN trades on
  assert.deepEqual(pickable("gmgn", ["sol", "bsc"]), ["sol"]);
  assert.deepEqual(pickable("gmgn", ["bsc", "sol", "base", "eth"]), ["sol"]);
  const box = new Map<string, string>();
  const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
  assert.equal(readPick("gmgn", store, ["sol", "bsc"]), "sol", "the first time: Solana");
  savePick("gmgn", "bsc", store);
  assert.equal(readPick("gmgn", store, ["sol", "bsc"]), "sol", "a chain V1 doesn't show is never kept or read back");
  assert.equal(readPick("pump", store, ["sol", "bsc"]), "sol", "per site");
  assert.equal(readPick("gmgn", store, ["sol"]), "sol", "a pick that no longer fills is never read back");
  savePick("pump", "eth", store);
  assert.equal(box.get("zf.hub.pick.v1"), undefined, "a network the site doesn't trade on isn't kept (nor one V1 doesn't show)");
  assert.equal(readPick("gmgn", { getItem: () => "{nonsense" }, ["sol", "bsc"]), "sol");
});

test("ST13: the words: 'your GMGN Solana wallet', never 'chain'; a network Spending can't fill says what V1 does (web alone)", () => {
  assert.equal(goesTo("GMGN", "sol"), "Goes to your GMGN Solana wallet.");
  // builder 25 (J8, product decision, 8 Nov: no BNB in V1): the web line names no chain V1 doesn't show and no $1,000 limit. The
  // phone's window says its own (apps/ios HostRules.swift notCarriedLine), changed by its owner (handoff "## builder 25"),
  // so this pins the web string alone
  for (const c of ["bsc", "base", "eth"] as const) assert.equal(notCarried(c), "GMGN pays from its SOL wallet.", c);
  for (const s of [goesTo("GMGN", "sol"), notCarried("bsc"), notCarried("base")]) assert.doesNotMatch(s, /\bchain\b|BNB|Base|\$1,000/i);
  const view = readFileSync(new URL("../../../../apps/ios/ZeroFee/PartnerView.swift", import.meta.url), "utf8");
  assert.match(view, /title\.text = "AgentZero: your \\\(site\)\\\(network\.map \{ " \\\(\$0\)" \} \?\? ""\) wallet is empty\. Put money in\?"/);
  // the window's ask never over a network Spending can't fill
  assert.match(view, /if let c = WalletGate\.siteChain\(web\.url\), WalletGate\.notCarriedLine\(c\) != nil \{ return \}/);
});

test("a tile's tap opens the site, $0.00 included (product decision, 3 Nov: never a sheet first); on its way says the line", () => {
  const r = (o: Partial<HubRow>): HubRow => ({ site: "pump", name: "pump.fun", usd: 0, wallet: "w1", ...o });
  assert.deepEqual(tileTap(r({ usd: 0 }), undefined, "ok"), { kind: "open" }, "$0.00 opens the site; its window offers the top-up");
  assert.deepEqual(tileTap(r({ usd: 0.004 }), undefined, "ok"), { kind: "open" });
  assert.deepEqual(tileTap(r({ usd: 2.91 }), undefined, "ok"), { kind: "open" });
  assert.deepEqual(tileTap(r({ usd: 2.91 }), 3, "ok"), { kind: "line", line: "$3.00 is on its way to pump.fun. About a minute." });
  assert.deepEqual(tileTap(r({ usd: 0 }), 3, "ok"), { kind: "line", line: "$3.00 is on its way to pump.fun. About a minute." }, "never the money sheet twice");
  assert.deepEqual(tileTap(r({ wallet: undefined, usd: null }), undefined, "first"), { kind: "wait" }, "before the first read: no tap does anything");
  assert.deepEqual(tileTap(r({ usd: null }), undefined, "ok"), { kind: "open" }, "a wallet Solana couldn't read never locks you out");
  assert.deepEqual(tileTap(r({ wallet: undefined, usd: null }), undefined, "failed"), { kind: "open" });
});

test("ST1: an Add stays on its way until the site's wallet shows it (Spending's record can end first), never asked twice", () => {
  const row = (usd: number | null): HubRow[] => [{ site: "pump", name: "pump.fun", usd, wallet: "w1" }];
  const t0 = 1_000_000;
  const a = landing([{ site: "pump", usd: "10" }], {}, row(0), t0).moving;
  assert.deepEqual(a, { pump: { usd: 10, from: 0, sinceMs: t0 } });
  assert.deepEqual(landing([], a, row(0), t0 + 30_000), { moving: a, landed: [], stopped: {} }, "Spending's record ended, the wallet still shows $0.00: still on its way");
  assert.deepEqual(landing([], a, row(null), t0 + 30_000), { moving: a, landed: [], stopped: {} }, "an unread wallet: still on its way");
  assert.deepEqual(landing([], a, row(9.7), t0 + 40_000), { moving: {}, landed: ["pump"], stopped: {} }, "the wallet shows it: landed, and said");
  assert.deepEqual(landing([], a, row(0), t0 + LANDING_MS + 1), { moving: {}, landed: [], stopped: {} }, "after five minutes it stops saying so, and never says it landed (review M3)");
  const c = landing([{ site: "pump", usd: "3" }], {}, row(2), t0).moving;
  assert.deepEqual(landing([], c, row(2), t0 + 1000).moving, c, "a second Add to a wallet with money: it waits for more than it had");
  // review L1: a start never read has no baseline, so it can't say landed; the first read with dollars becomes it
  const d = landing([{ site: "pump", usd: "3" }], {}, null, t0).moving;
  assert.equal(d.pump!.from, null);
  assert.deepEqual(landing([], d, row(50), t0 + 1000).landed, [], "$50 already there isn't the Add landing");
  assert.equal(landing([{ site: "pump", usd: "3" }], d, row(50), t0 + 1000).moving.pump!.from, 50);
  // kept on the device across a relaunch
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveLanding(a, store);
  assert.deepEqual(readLanding(store, t0 + 1000), a);
  assert.deepEqual(readLanding(store, t0 + LANDING_MS + 1), {}, "an old record isn't read back");
  assert.deepEqual(readLanding(store, t0 - 1000), {}, "a record from the future (the clock went back) isn't either");
  assert.deepEqual(landing([], a, row(0), t0 - 1000), { moving: {}, landed: [], stopped: {} }, "re-review Low 1: a clock that went back never locks a site");
  assert.deepEqual(landing([], d, row(50), t0 + 1000).moving, {}, "re-review Low 2: no start read, record ended, money shows: shown, quietly");
  mem.set("zf.hub.landing.v1", JSON.stringify({ evil: { usd: 1, sinceMs: 1 }, pump: { usd: "x" } }));
  assert.deepEqual(readLanding(store, t0), {}, "only known sites and numbers");
});

test("ST13: one Take out sweeps every funded wallet it can move (BNB beside Solana); a network ZeroFee doesn't carry stays and is named", () => {
  const r = (wallets: HubRow["wallets"]): HubRow => ({ site: "gmgn", name: "GMGN", usd: 0, wallet: "s", wallets });
  assert.deepEqual(TAKES_OUT, ["sol", "bsc"]);
  assert.deepEqual(takeOutAlso(r([{ network: "sol", usd: 10, id: "s", address: "A" }, { network: "bsc", usd: 2.4, id: "b", address: "0x" }])), ["b"], "BNB is a second leg");
  assert.deepEqual(takeOutAlso(r([{ network: "sol", usd: 10, id: "s", address: "A" }, { network: "bsc", usd: 1.99, id: "b", address: "0x" }])), [], "under $2 a leg would go on fees: never a leg");
  assert.deepEqual(takeOutAlso(r([{ network: "bsc", usd: null, id: "b", address: "0x" }])), [], "an unread wallet is never a leg");
  assert.deepEqual(takeOutAlso(r([{ network: "base", usd: 7, id: "e", address: "0x" }])), [], "Base is never a leg");
  assert.deepEqual(stays(r([{ network: "base", usd: null, holds: "0.0012 ETH", id: "e", address: "0x" }, { network: "eth", usd: null, holds: "0 ETH", id: "f", address: "0x" }, { network: "bsc", usd: 2.4, id: "b", address: "0x" }])), ["base"], "Base with money stays and is said; an empty one isn't");
  // review L5: BNB with money under $2 is never swept and never silent
  assert.deepEqual(tooSmall(r([{ network: "sol", usd: 1, id: "s", address: "A" }, { network: "bsc", usd: 1.5, id: "b", address: "0x" }])), ["bsc"]);
  assert.deepEqual(tooSmall(r([{ network: "bsc", usd: 2.4, id: "b", address: "0x" }, { network: "bsc", usd: 0, id: "c", address: "0x" }])), []);
  // control: a row with no wallets read has nothing to sweep and nothing to say
  assert.deepEqual(takeOutAlso({ site: "pump", name: "pump.fun", usd: null }), []);
  assert.deepEqual(stays({ site: "pump", name: "pump.fun", usd: null }), []);
});

test("AgentZero's pocket (D90) is never a Social trading tile, holding money or not, read live or from the kept rows", () => {
  const rows = hubRows([w({ id: "site-agentzero-sol-a", site: "agentzero", cashUsd: "20.00" }), w({ id: "site-jupiter-sol-a", site: "jupiter", cashUsd: "12.00" })]);
  assert.deepEqual(rows.map((r) => r.site), ["pump", "gmgn", "jupiter"], "control: another site holding money is shown");
  const kept = { getItem: () => JSON.stringify({ rows: [{ site: "agentzero", usd: 20 }, { site: "pump", usd: 3 }] }) };
  assert.deepEqual(readHub(kept).map((r) => r.site), ["pump"]);
});
