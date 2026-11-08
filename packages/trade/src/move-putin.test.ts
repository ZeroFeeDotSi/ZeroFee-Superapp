// Move, put-in (FLOW-V4 §1): the Safe → one or more rows, ONE Approve naming every leg, then each leg on to that row's
// own wallet (SOL to Solana's, ETH to Robinhood's; NEAR stays in Spending's own balance), one Activity line per leg.
// §0 proof row (put-in): each row as a To; hidden (through NEAR Intents' confidential middle, the Approve's Add); BNB
// says it opens after its test; a NEAR-only path is never the only one (a SOL leg lands on Solana).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, moveLegs, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, readyGapMs, readyTrimPct, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(o: { bnbOpen?: boolean; balance?: (b: any) => any } = {}) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const asked: { method: string; params: Record<string, unknown> }[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "ledger.toTrading" || /^subwallet\.float\.(out|in|home)$/.test(method)) asked.push({ method, params });
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    return method === "subwallet.float.balance" && o.balance ? o.balance(r.ok) : r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const f = createCoreFloat({ offered: (c) => c !== "bsc" || o.bnbOpen === true, call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  return { f, svc, asked, later: (ms: number) => { t += ms; } };
}

test("one Approve names every leg: \"Move $25.00 from your Safe · SOL $15.00 · ETH on Robinhood $10.00\"; then SOL lands on Solana's wallet and ETH on Robinhood's, one Activity line each", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 25, legs: [{ network: "sol", usd: 15 }, { network: "hood", usd: 10 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  const approve = s.asked.filter((a) => a.method === "ledger.toTrading");
  assert.equal(approve.length, 1, "one Approve");
  // privacy audit (4 Nov): $25 is rounded up to the grid's $26 too (its rest stays hidden in the NEAR wallet)
  assert.equal(approve[0]!.params.label, "Move $26.00 from your Safe · SOL $15.00 · Robinhood $10.00");
  // the sheet's last line names where it ends (integration walk, 3 Nov), the app's words, never signed
  // audit H1: only what's true, never "privately" (an amount and time can still be matched)
  assert.equal(approve[0]!.params.onward, "it goes on to your SOL and Robinhood wallets. The rest stays in Private.");
  // D137: each leg goes on the moment the Add is in Trading, no gap
  await settle(); await s.f.refresh(); await s.f.refresh(); await settle(); await s.f.refresh();
  const outs = s.asked.filter((a) => a.method === "subwallet.float.out").map((a) => [a.params.chain, a.params.to]);
  assert.deepEqual(outs.sort(), [["hood", "sw-trade-hood"], ["sol", "sw-trade-sol"]], "each leg to its own chain's wallet");
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const legs = rows.ok.filter((a) => a.kind === "ready" && a.shown).map((a) => a.words);
  assert.equal(legs.length, 2, JSON.stringify(rows.ok.map((a) => a.words)));
  // no trim (D137): SOL's leg is its $15.00; ETH (RH)'s what the Add has left, with the moves' fee room (review L2)
  assert.ok(legs.some((w) => /^Moving \$15\.00 to Solana$|^Moved \$15\.00 to Solana$/.test(w)) && legs.some((w) => /to Robinhood Chain$/.test(w)), JSON.stringify(legs));
  // one move, one row (QA, 3 Nov): each leg names the Move it belongs to, so Activity folds them into its row
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.ok(add, "the Move's own row");
  assert.deepEqual(rows.ok.filter((a) => a.kind === "ready" && a.shown).map((a) => a.of), [r.ok.id, r.ok.id]);
  const { foldLegs } = await import("@zerofee/core/spending-fold");
  const one = foldLegs(rows.ok.filter((a) => a.shown));
  assert.equal(one.filter((a) => a.kind === "ready").length, 0, "no leg is a row of its own");
  assert.equal(one.find((a) => a.id === r.ok.id)!.legs!.length, 2);
});

test("D137: with no gap, a NEAR wallet read that doesn't show the Add yet never sizes its legs at $0.00: they wait for the read that does, then go at their figure (control: on that stale read, nothing goes)", async () => {
  // the NEAR wallet's figure held at what it was before the Add, as a read from before it landed (or a failed read's last)
  let hold = false, frozen: unknown;
  const s = await setup({ balance: (b) => (hold ? (frozen ??= b) : b) });
  hold = true; await s.f.refresh();                                          // the figure before the Add
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 25, legs: [{ network: "sol", usd: 15 }, { network: "hood", usd: 10 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  await settle(); await s.f.refresh(); await s.f.refresh(); await settle(); await s.f.refresh();
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 0, "control: nothing goes on a read that doesn't show the Add (before: two legs at $0.00)");
  hold = false;                                                              // the next read shows it
  await s.f.refresh(); await settle(); await s.f.refresh();
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const legs = rows.ok.filter((a) => a.kind === "ready" && a.shown).map((a) => a.words);
  assert.ok(legs.some((w) => /^Mov(ing|ed) \$15\.00 to Solana$/.test(w)) && legs.some((w) => /^Mov(ing|ed) \$\d+\.\d\d to Robinhood Chain$/.test(w)) && !legs.some((w) => /\$0\.00/.test(w)), JSON.stringify(legs));
});

test("Home's Swap from the Safe to the SOL wallet (spending.topUp with a coin named, one leg): the engine's words name the Swap and the person's own $25, and what the grid adds says its dollars (UI audit 5 Nov: \"Move $26.00\"); control: a plain Move keeps its words", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 25, swap: "USDC", legs: [{ network: "sol", usd: 25 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  const approve = s.asked.find((a) => a.method === "ledger.toTrading")!;
  const sent = Number(String(approve.params.amount));
  const rest = (sent - 25).toFixed(2);
  assert.equal(approve.params.onward, `it is a swap of $25.00 of USDC for SOL in your SOL wallet.${Number(rest) >= 0.01 ? ` $${rest} stays hidden in your NEAR wallet.` : ""}`);
  const { endsTitle } = await import("@zerofee/core/onward-ends");
  const sheet = endsTitle(`Move $${sent.toFixed(2)} (${sent.toFixed(2)} USDC) to your NEAR wallet`, `Wallet says: ${approve.params.onward}`)!;
  assert.equal(sheet.title, "Swap $25.00 of USDC for SOL", "the action and the amount the person chose");
  const c = await setup();
  await c.svc.call<SpendingActivity>("spending.topUp", { usd: 25, legs: [{ network: "sol", usd: 25 }] });
  assert.match(String(c.asked.find((a) => a.method === "ledger.toTrading")!.params.onward), /^it goes on to your SOL wallet\./, "control: a Move is a Move");
});

test("privacy audit (4 Nov): a $100 Move to the SOL wallet leaves the Safe as $110, the SOL wallet gets its $100, and the rest STAYS hidden in the NEAR wallet: no public step back to the Safe, so \"Safe out less Safe in\" never equals what the wallet got (control: $17.43 is rounded too, nothing goes home)", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 100, legs: [{ network: "sol", usd: 100 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  const approve = s.asked.find((a) => a.method === "ledger.toTrading")!;
  assert.equal(approve.params.label, "Move $110.00 from your Safe · SOL $100.00");
  assert.equal(approve.params.onward, "it goes on to your SOL wallet. The rest stays in Private.");
  for (let i = 0; i < 10; i++) { await settle(); await s.f.refresh(); }
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 1, "the leg to the SOL wallet");
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.home").length, 0, "before: the rest went home to the Safe in the same job, a public step");
  const kept = s.f.snapshot().reserveUsd;
  assert.ok(kept >= 7 && kept <= 10, `what the leg's own fee left of the $10 rest stays in the NEAR wallet: ${kept}`);
  const c = await setup();
  const two = await c.svc.call<SpendingActivity>("spending.topUp", { usd: 17.43, legs: [{ network: "sol", usd: 17.43 }] });
  assert.ok("ok" in two);
  assert.equal(c.asked.find((a) => a.method === "ledger.toTrading")!.params.label, "Move $18.00 from your Safe · SOL $17.43", "no $2 floor now nothing goes home");
  for (let i = 0; i < 10; i++) { await settle(); await c.f.refresh(); }
  assert.equal(c.asked.filter((a) => a.method === "subwallet.float.home").length, 0, "nothing goes home");
});

test("§0 put-in: NEAR as a To stays in Spending's own balance on NEAR (no chain leg); BNB as a To says it opens after its test, before any Approve", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 12, legs: [{ network: "near", usd: 12 }] });
  assert.ok("ok" in r);
  s.later(readyGapMs(r.ok.id) + 1); await settle(); await s.f.refresh(); await settle();
  assert.deepEqual(s.asked.filter((a) => a.method === "subwallet.float.out"), [], "NEAR's leg needs no move on");
  assert.equal(s.asked.find((a) => a.method === "ledger.toTrading")!.params.onward, undefined, "control: money that stays in the NEAR wallet names nothing further");
  const b = await setup();
  const no = await b.svc.call("spending.topUp", { usd: 10, legs: [{ network: "bsc", usd: 10 }] });
  assert.ok("problem" in no && no.problem.code === "spending.network.closed" && /BNB Chain/.test(no.problem.whatHappened), JSON.stringify(no));
  assert.equal(b.asked.filter((a) => a.method === "ledger.toTrading").length, 0, "no Approve");
});

test("the legs are read strictly before any sheet: a row once, $2 or more each, adding up to the whole; NEAR is one case, never the only one", () => {
  assert.deepEqual(moveLegs([{ network: "sol", usd: 15 }, { network: "hood", usd: 10 }], 25), [{ chain: "sol", usd: 15 }, { chain: "hood", usd: 10 }]);
  assert.deepEqual(moveLegs([{ network: "sol", usd: 5 }], 5), [{ chain: "sol", usd: 5 }], "a Solana row alone (D111: not a NEAR-only path)");
  for (const [legs, usd] of [
    [[{ network: "sol", usd: 15 }], 25], [[{ network: "sol", usd: 1.5 }], 1.5], [[{ network: "sol", usd: 5 }, { network: "sol", usd: 5 }], 10],
    [[{ network: "eth", usd: 5 }], 5], [[], 5], ["sol", 5], [[{ network: "sol", usd: "x" }], 5],
  ] as const) assert.throws(() => moveLegs(legs, usd), (e: unknown) => e instanceof ProblemError && e.problem.code === "spending.move.legs", JSON.stringify(legs));
});

test("review: a Move's legs never ride with a site's Add (the site path would send the whole again); Home's Swap may name the Safe's coin that pays them (the Home plan §1.4: the Safe's NEAR to SOL), only that coin", async () => {
  const s = await setup();
  const r = await s.svc.call("spending.topUp", { usd: 10, legs: [{ network: "sol", usd: 10 }], ready: "site-pump-sol-abc123" });
  assert.ok("problem" in r && r.problem.code === "security.request.invalid", JSON.stringify(r));
  assert.equal(s.asked.filter((a) => a.method === "ledger.toTrading").length, 0, "no Approve");
  const n = await s.svc.call("spending.topUp", { usd: 3, legs: [{ network: "sol", usd: 3 }], swap: "NEAR" });
  assert.ok("ok" in n, JSON.stringify(n));
  const paid = s.asked.filter((a) => a.method === "ledger.toTrading").map((a) => a.params.tokenId);
  assert.ok(paid.length === 1 && /^(near|nep141:wrap\.near)$/.test(String(paid[0])), `only the coin named pays: ${JSON.stringify(paid)}`);
});

test("D108: the core's Approve for a Move says Trading (its bytes know Spending's balance, never a row); Move's sheet names the rows first", async () => {
  const { describeQuote } = await import("@zerofee/core/intents") as never as { describeQuote?: unknown };
  void describeQuote;
  const { readFileSync } = await import("node:fs");
  const core = readFileSync(new URL("../../core/src/intents.ts", import.meta.url), "utf8");
  assert.match(core, /title: `Move \$\{paid\} to \$\{TRADING_BALANCE\}`/);
  const { moveRowsLine } = await import("@zerofee/wallet/app/screens/MoveSheet.tsx").catch(() => ({ moveRowsLine: null })) as { moveRowsLine: ((l: { to: string; usd: number }[]) => string) | null };
  if (moveRowsLine) {
    assert.equal(moveRowsLine([{ to: "sol", usd: 15 }]), "Then to your SOL row.");
    assert.equal(moveRowsLine([{ to: "sol", usd: 15 }, { to: "hood", usd: 10 }]), "Then to your SOL and ETH on Robinhood rows.");
  }
});

test("review Low: a leg that gets less than asked (the Add brought less than its legs) says what it got, on the Move's own row", async () => {
  const s = await setup();
  // two legs of $5 each: the second gets what the first left, with the moves' fee room (review L2); paid with NEAR, so
  // not rounded up to the inflow grid (only the Safe's USDC is), and the Add brings less than its legs
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, legs: [{ network: "sol", usd: 5 }, { network: "hood", usd: 5 }], swap: "NEAR" });
  assert.ok("ok" in r);
  await settle(); await s.f.refresh(); await s.f.refresh(); await settle(); await s.f.refresh();
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const move = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.match(move.note ?? "", /Robinhood Chain got \$\d+\.\d\d of \$5\.00\. The rest went on fees or is in your NEAR wallet/, JSON.stringify(move));
});

test("review Low: a leg caught mid-send when ZeroFee closed: its planned move goes and nothing more is said; one never planned says it stayed in Spending", async () => {
  const mk = async (jobs: unknown[], ageMs = 100_000) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 10 } });
    const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
    for (const chain of ["sol", "hood"]) await call("subwallet.create", { kind: "trade", chain });
    const t = 2_000_000;
    const row = { id: "move-crash-row-0001", kind: "add", usd: 10, status: "done", where: "reserve", at: t - ageMs, legsLandedAt: 0, legs: [{ chain: "sol", usd: 10, sendingAt: t - 50_000 }] };
    const store = new Map<string, unknown>([["float.adds.v1", [{ r: row, base: 0 }]], ["float.jobs.v1", jobs]]);
    const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); }, now: () => t, every: () => () => undefined, rng: () => 0.5 });
    await f.refresh(); await f.refresh();
    return f.snapshot().moves.find((m) => m.id === "move-crash-row-0001")!;
  };
  const never = await mk([]);
  assert.match(never.note ?? "", /^Solana: It didn't go on before ZeroFee closed\. That part is in your NEAR wallet$/, JSON.stringify(never));
  const want = Math.floor(10 * (1 - readyTrimPct("move-crash-row-0001-sol")) * 100) / 100;
  const planned = await mk([{ id: "leg-job-after-crash1", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: want, at: 2_000_000 - 40_000, state: "planned", asked: true }]);
  // control: the person's own later move to Solana, at another amount, is not this leg's
  const other = await mk([{ id: "own-move-after-crash", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: 50, at: 2_000_000 - 40_000, state: "planned", asked: true }]);
  assert.match(other.note ?? "", /didn't go on before ZeroFee closed/);
  // review: reopened more than a day later, a leg that went is still checked against the journal, never "it stayed"
  const late = await mk([{ id: "leg-job-after-crash2", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: want, at: 2_000_000 - 40_000, state: "planned", asked: true }], 30 * 3600_000);
  assert.equal(late.note, undefined, JSON.stringify(late));
  assert.equal(planned.note, undefined, "its move was planned: it goes with its own key, no note");
});
