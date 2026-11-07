// QA (5 Nov, Sim): AgentZero's "What's my balance?" said $5,460.55 beside Home's $5,510.55; the $50 in the
// pump.fun and GMGN site wallets was left out. readBalanceTotal is now Home's own figure: the wallets' part is
// tradingUsd (every site wallet, NEAR coins), as home-cache.ts viewOf counts it. Controls: no site wallets, the old sum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBalanceTotal } from "./BalanceTotal.ts";
import { balanceTotal } from "./format.ts";
import { tradingUsd } from "./trading.ts";

// the $144.37 is the NEAR wallet's (reserveUsd): the engine's figure past its parts is no money of its own (test, MUST 1)
const spending = { loaded: true, unread: false, totalUsd: "144.37", reserveUsd: "144.37", networks: [{ network: "sol", cashUsd: "0", coinsUsd: "0" }, { network: "hood", cashUsd: "0", coinsUsd: "0" }], onItsWay: [] };
const sites = [
  { id: "sw-site-pump-sol", role: "site", network: "sol", cashUsd: "25.00", coinsUsd: "0" },
  { id: "sw-site-gmgn-sol", role: "site", network: "sol", cashUsd: "25.00", coinsUsd: "0" },
];
const bridgeWith = (wallets: unknown[]) => ({
  call: async (m: string) => ({
    ok: ({ "ledger.balances": [], "ledger.chains": [], "ledger.tokens": [], "earn.positions": [], "ledger.private": { available: false, ready: false, rows: [], defaultOn: false }, "account.state": { kid: false }, "spending.status": spending, "trade.positions": [], "spending.wallets": wallets } as Record<string, unknown>)[m],
  }),
  on: () => () => {},
}) as never;

test("the balance answer counts the site wallets, as Home does (control: without them, the $50 less the crawl saw)", async () => {
  const all = await readBalanceTotal(bridgeWith(sites));
  const home = balanceTotal([], [], [], null, tradingUsd(spending as never, [], sites as never).usd);
  assert.equal(all, home, "Home's own figure");
  assert.equal(Number(all), 194.37, "SOL $144.37 + pump.fun $25 + GMGN $25");
  const none = await readBalanceTotal(bridgeWith([]));
  assert.equal(Number(none), 144.37, "control: no site wallets, nothing added");
  assert.equal(Number(all) - Number(none), 50);
});

test("while the wallets aren't read, the figure is partial and screens wait for the whole one; control: read, it's whole", async () => {
  const { readBalanceParts } = await import("./BalanceTotal.ts");
  const unread = { call: async (m: string) => (m === "spending.status" ? { ok: { ...spending, loaded: false } } : (bridgeWith(sites) as { call: (m: string) => Promise<unknown> }).call(m)), on: () => () => {} } as never;
  assert.deepEqual(await readBalanceParts(unread), { usd: "0.00", partial: true, safeUsd: "0.00", privateUsd: "0.00", hotUsd: null }, "the Safe alone, marked partial");
  assert.equal((await readBalanceParts(bridgeWith(sites)))!.partial, false);
  // control (test, 5 Nov, preview 2w6ijfoh6: the Sim's answer had no figure): a wallet Home shows as "updating" leaves
  // the figure whole, as Home's own is; only Spending not read at all waits
  const updating = sites.map((w, i) => (i ? { ...w, unread: true } : w));
  assert.equal((await readBalanceParts(bridgeWith(updating)))!.partial, false);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./BalanceTotal.ts", import.meta.url), "utf8");
  assert.match(src, /if \(t\.partial && n < PARTIAL_READS\) timer = setTimeout\(\(\) => read\(n \+ 1\), PARTIAL_READ_MS\);\s*else setTotal\(t\);/, "useBalanceTotal reads again while partial");
  const sim = readFileSync(new URL("../../../../apps/web/src/agentzero/sim-chat.ts", import.meta.url), "utf8");
  assert.match(sim, /if \(t && !t\.partial\) return t\.usd;/, "the Sim's balance answer gives only the whole figure");
});
