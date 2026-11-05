// QA (5 Nov, real test): after AgentZero was funded, Home's total fell $21.01 → $18.93: AgentZero's
// $1.99 was counted nowhere. AgentZero's own wallet is now a row of Home's NEAR wallet ("AgentZero", as a site's wallet is
// a row of its chain's) and in Home's total, from the core's account.agent.balance; readBalanceParts (AgentZero's "What's
// my balance?", Trade's and Pay's totals) counts it the same way. Controls: no AgentZero wallet, the old figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBalanceParts } from "./BalanceTotal.ts";
import { balanceTotal } from "./format.ts";
import { askParts } from "./home-cache.ts";
import { agentRow, joinAgent, walletsWithAgent } from "./agent-row.ts";
import { tradingUsd } from "./trading.ts";

// the $18.93 is the NEAR wallet's (reserveUsd): the engine's figure past its parts is no money of its own (test, MUST 1)
const spending = { loaded: true, unread: false, totalUsd: "18.93", reserveUsd: "18.93", networks: [{ network: "sol", cashUsd: "0", coinsUsd: "0" }, { network: "hood", cashUsd: "0", coinsUsd: "0" }], onItsWay: [] };
const answers = (agent: unknown): Record<string, unknown> => ({
  "ledger.balances": { ok: [] }, "ledger.chains": { ok: [] }, "ledger.tokens": { ok: [] }, "earn.positions": { ok: [] },
  "ledger.private": { ok: { available: false, ready: false, rows: [], defaultOn: false } }, "account.state": { ok: { kid: false } },
  "spending.status": { ok: spending }, "trade.positions": { ok: [] }, "spending.wallets": { ok: [] }, "subwallet.float.balance": { ok: { tokens: [] } },
  "account.agent.balance": agent,
});
const bridgeWith = (agent: unknown) => {
  const asked: string[] = [];
  return { asked, b: { call: async (m: string) => (asked.push(m), answers(agent)[m] ?? { problem: { code: "x" } }), on: () => () => {} } as never };
};
const FUNDED = { ok: { usdcMicros: "1990000" } };

test("AgentZero's row: its USDC in dollars; none when there's no AgentZero wallet here; \"can't be read\" when NEAR didn't answer, never $0", () => {
  assert.deepEqual([agentRow(FUNDED)!.label, agentRow(FUNDED)!.role, agentRow(FUNDED)!.network, agentRow(FUNDED)!.cashUsd], ["AgentZero", "agent", "near", "1.99"]);
  assert.equal(agentRow({ ok: null }), null, "off, or no words on this phone");
  for (const code of ["security.bridge.not-allowed", "security.web.no-safe", "mock.unknown"]) assert.equal(agentRow({ problem: { code } }), null, code);
  // control: a read that failed is a row that can't be read (Home says "Updating", never $0)
  assert.equal(agentRow({ problem: { code: "security.nodes.unreachable" } })!.unread, true);
  assert.equal(agentRow(null)!.unread, true, "the bridge threw");
  assert.equal(agentRow({ ok: { usdcMicros: "not a number" } })!.unread, true);
});

test("Home's total counts AgentZero's $1.99 (the test's $18.93 → $20.92); control: no AgentZero wallet, $18.93 as before", async () => {
  // Home's first read asks AgentZero's balance with the wallets, in the same tick
  const { asked, b } = bridgeWith(FUNDED);
  const p = askParts(b);
  assert.ok(asked.includes("account.agent.balance") && asked.includes("spending.wallets"));
  const funded = await joinAgent(p.wallets, p.agent) as { ok: { label: string; cashUsd?: string }[] };
  assert.deepEqual(funded.ok.map((w) => [w.label, w.cashUsd]), [["AgentZero", "1.99"]], "Home's wallets list AgentZero's row");
  assert.equal(tradingUsd(spending as never, [], funded.ok as never).usd, "20.92");
  const n = askParts(bridgeWith({ ok: null }).b);
  const none = await joinAgent(n.wallets, n.agent) as { ok: unknown[] };
  assert.deepEqual(none.ok, [], "control: no row");
  assert.equal(tradingUsd(spending as never, [], none.ok as never).usd, "18.93");
});

test("\"What's my balance?\" is Home's figure: readBalanceParts counts AgentZero's wallet the same way (control: without it, $1.99 less)", async () => {
  const withAz = bridgeWith(FUNDED);
  const all = await readBalanceParts(withAz.b);
  assert.ok(withAz.asked.includes("account.agent.balance"));
  const home = balanceTotal([], [], [], null, tradingUsd(spending as never, [], [agentRow(FUNDED)!]).usd);
  assert.deepEqual(all, { usd: home, partial: false });
  assert.equal(home, "20.92");
  const none = await readBalanceParts(bridgeWith({ ok: null }).b);
  assert.equal(none!.usd, "18.93", "control");
});

test("joining never loses Spending's own list: AgentZero's read failing or refused leaves it as it was (plus a row that can't be read)", async () => {
  const site = { id: "s", role: "site", network: "sol", label: "pump.fun wallet", cashUsd: "5.00" };
  const callOf = (agent: () => Promise<unknown>, wallets: unknown = { ok: [site] }) => (m: string) => (m === "spending.wallets" ? Promise.resolve(wallets) : agent());
  const r = await walletsWithAgent<{ ok: { id: string; unread?: true }[] }>(callOf(() => Promise.reject(new Error("down"))));
  assert.deepEqual(r.ok.map((w) => [w.id, w.unread ?? false]), [["s", false], ["agentzero", true]]);
  const refused = await walletsWithAgent(callOf(() => Promise.resolve({ problem: { code: "security.bridge.not-allowed" } })));
  assert.deepEqual(refused, { ok: [site] });
  const failed = { problem: { code: "y" } };
  assert.equal(await walletsWithAgent(callOf(() => Promise.resolve(FUNDED), failed)), failed, "Spending's list unread stays unread");
});

test("Home shows AgentZero's row in its NEAR wallet, as it shows a site's in its chain; every later read of the wallets keeps it (control: the site rows still are)", () => {
  // rebased onto main's Safe | Hot Home: site wallets are Hot's own sections (safe-hot.ts siteSections), AgentZero's with them
  const home = readFileSync(new URL("./screens/safe-hot.ts", import.meta.url), "utf8");
  assert.match(home, /\(wallets \?\? \[\]\)\.filter\(\(w\) => w\.role === "site" \|\| w\.role === "agent"\)/);
  assert.match(readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8"), /const sites = siteSections\(wallets,/);
  const reads = readFileSync(new URL("./home-reads.ts", import.meta.url), "utf8");
  assert.match(reads, /\(asked \? joinAgent\(asked\.wallets as Promise<BridgeResult<SpendingWallet\[\]>>, asked\.agent \?\? bridge\.call\("account\.agent\.balance"\)\) : walletsWithAgent<BridgeResult<SpendingWallet\[\]>>\(\(m\) => bridge\.call\(m\)\)\)\.then\(\(w\) => \{\s*if \(live && "ok" in w && Array\.isArray\(w\.ok\)\) \{\s*sink\.wallets\(w\.ok\);/);
});
