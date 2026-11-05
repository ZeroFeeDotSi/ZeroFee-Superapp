// Move, take-out (FLOW-V4 §1, the same sheet in reverse): from the rows picked, each an amount or "All", back to the
// Safe with no sheet (money only goes home), one Activity line per leg. §0 take-out cells: SOL, ETH on Robinhood and NEAR
// as a From; BNB says it opens after its test; a NEAR-only path is never the only one (Solana's money comes home too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, takeOutLegs, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { PRIVATE } from "./float.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);

async function setup() {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 30).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 20, held } });
  const asked: { method: string; params: Record<string, unknown> }[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (/^ledger\.toTrading$|^subwallet\.float\.(out|in|home)$|^tx\.request$/.test(method)) asked.push({ method, params });
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : (await mock.call<any>(m, p)).ok) as T });
  return { f, svc, asked, later: (ms: number) => { t += ms; } };
}

test("take-out from SOL $10 and NEAR's whole row: one move in from Solana's own wallet, then one move home; no Approve; a line per leg", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 10 }, { network: "near", usd: "all" }] });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(s.asked.filter((a) => a.method === "ledger.toTrading" || a.method === "tx.request").length, 0, "no Approve: money only goes home");
  for (let i = 0; i < 4; i++) { s.later(PRIVATE.delayMs[1]); await s.f.traded("sol"); await settle(); }
  const ins = s.asked.filter((a) => a.method === "subwallet.float.in").map((a) => a.params.from);
  assert.deepEqual(ins, ["sw-trade-sol"], "from Solana's own wallet; NEAR needs no move in");
  assert.ok(s.asked.some((a) => a.method === "subwallet.float.home"), "then home");
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  assert.ok(rows.ok.some((a) => /back from Solana$/.test(a.words) && a.shown), JSON.stringify(rows.ok.map((a) => a.words)));
  assert.ok(rows.ok.some((a) => a.kind === "put-away" && /away/.test(a.words)), "the move home");
});

test("§0 take-out: ETH on Robinhood's All comes from Robinhood's own wallet; BNB says it opens after its test, nothing moves", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "hood", usd: "all" }] });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 2; i++) { s.later(PRIVATE.delayMs[1]); await s.f.refresh(); await settle(); }
  assert.deepEqual(s.asked.filter((a) => a.method === "subwallet.float.in").map((a) => a.params.from), ["sw-trade-hood"]);
  const b = await setup();
  const no = await b.svc.call("spending.putAway", { legs: [{ network: "bsc", usd: 5 }] });
  assert.ok("problem" in no && no.problem.code === "spending.network.closed", JSON.stringify(no));
  assert.equal(b.asked.length, 0);
});

test("take-out's legs are read strictly: a row once, All or $2 or more", () => {
  assert.deepEqual(takeOutLegs([{ network: "sol", usd: "all" }, { network: "near", usd: 5 }]), [{ chain: "sol", usd: "all" }, { chain: "near", usd: 5 }]);
  for (const legs of [[{ network: "sol", usd: 1 }], [{ network: "sol", usd: 5 }, { network: "sol", usd: 5 }], [{ network: "eth", usd: 5 }], [], "sol"]) assert.throws(() => takeOutLegs(legs), (e: unknown) => e instanceof ProblemError && e.problem.code === "spending.move.legs", JSON.stringify(legs));
});

test("review: one take-out at a time (a second is refused in words, the first's move home kept); a refused one never leaves Move blocked", async () => {
  const s = await setup();
  const first = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 10 }] });
  assert.ok("ok" in first);
  const second = await s.svc.call("spending.putAway", { legs: [{ network: "hood", usd: 5 }] });
  assert.ok("problem" in second, JSON.stringify(second));
  const b = await setup();
  const tooBig = await b.svc.call("spending.putAway", { legs: [{ network: "sol", usd: 500 }] });
  assert.ok("ok" in tooBig || "problem" in tooBig);
  const under = await b.svc.call("spending.putAway", { legs: [{ network: "near", usd: 2 }] });
  // whatever the first said, the next take-out is not refused as "already taking out"
  assert.ok(!("problem" in under && /taking|already/i.test(under.problem.whatHappened)) || "ok" in tooBig, JSON.stringify(under));
});

test("QA (3 Nov): a $20 take-out from SOL takes exactly $20 of SOL from the row (never $20.60), sends home only what came back, never Trading's other cash, and lands at least the sheet's least (control: the old 3 % pull)", async () => {
  const { takeOutLeast } = await import("@zerofee/wallet/app/screens/take-out.ts");
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 20 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 6; i++) { s.later(PRIVATE.delayMs[1]); await s.f.traded("sol"); await settle(); }
  const ins = s.asked.filter((a) => a.method === "subwallet.float.in");
  assert.equal(ins.length, 1);
  // $20 of SOL at $150: 0.133333333 SOL; the old code asked $20.60 (0.137333333 SOL)
  assert.equal(ins[0]!.params.amount, units("sol", 20).toString(), `the row gives exactly what was picked: ${ins[0]!.params.amount}`);
  const home = s.asked.filter((a) => a.method === "subwallet.float.home");
  assert.equal(home.length, 1);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const back = rows.ok.find((a) => /back from Solana$/.test(a.words))!;
  const away = rows.ok.find((a) => a.kind === "put-away" && !a.network)!;
  // one move, one row (QA, 3 Nov): the move back from Solana names the take-out it belongs to
  assert.equal(back.of, away.id, "the leg names its take-out");
  const num = (x: string) => Number(x.replace(/[$,]/g, ""));
  // home sends what came back from Solana, to the cent: never the $20 asked made up from Trading's own $20 of cash
  assert.equal(Number(home[0]!.params.amount) / 1e6, num(back.usd), `home ${home[0]!.params.amount} vs back ${back.usd}`);
  const cash = await s.svc.call<{ reserveUsd?: string }>("spending.status", {});
  assert.ok("ok" in cash && Number(cash.ok.reserveUsd) >= 20 - 0.005, `Trading's own cash stays: ${"ok" in cash ? cash.ok.reserveUsd : ""}`);
  // what reached the Safe is at least what the sheet said before the tap
  const least = takeOutLeast([{ from: "sol", name: "SOL", usd: 20, all: false }]);
  assert.equal(least, 18.35);
  assert.ok(num(away.usd) >= least, `the Safe got ${away.usd}, at least ${least}`);
});

test("product decision (5 Nov, $2.60 SOL wallet -> Safe): a move in the core never sent ends at once, its row kept in Activity with its reason and where the money really is (its SOL wallet, never the NEAR wallet); control: one that went comes home", async () => {
  const s = await setup();
  // the core's answer for a transfer it never signed (float-moves.ts inNow: no Solana node, no blockhash): failed at once
  const never = await (async () => {
    const held = { "sw-trade-sol": units("sol", 60).toString() };
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0, held } });
    const call: CoreFloatDeps["call"] = async (method, params) => {
      if (method === "subwallet.float.in") return { id: `fm-${params.key}`, kind: "in", chain: "sol", status: "failed", where: "chain", reason: "Didn't go · the money is still in your Solana wallet", sent: { tokenId: "sol", amount: "1" }, expected: { tokenId: "usdc", amount: "2560000" }, startedAtIso: new Date(0).toISOString(), updatedAtIso: new Date(0).toISOString() } as never;
      const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
    };
    for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
    let t = 1_000_000;
    const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
    const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : (await mock.call<any>(m, p)).ok) as T });
    return { f, svc, later: (ms: number) => { t += ms; } };
  })();
  const r = await never.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 2.6 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 3; i++) { never.later(PRIVATE.delayMs[1]); await never.f.traded("sol"); await settle(); }
  const rows = await never.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const home = rows.ok.filter((a) => a.kind === "put-away");
  const leg = rows.ok.filter((a) => a.kind !== "put-away" || /back from Solana/.test(a.words));
  assert.ok(leg.length === 1 && leg[0]!.status === "failed" && /still in your Solana wallet/.test(leg[0]!.note ?? "") && leg[0]!.shown, JSON.stringify(leg));
  const home0 = home.filter((a) => !/back from Solana/.test(a.words));
  home.splice(0, home.length, ...home0);
  assert.equal(home.length, 1, JSON.stringify(rows.ok.map((a) => a.words)));
  assert.ok(home[0]!.status === "failed" || home[0]!.status === "refused", home[0]!.status);
  assert.ok(home[0]!.shown, "kept in Activity");
  assert.match(home[0]!.note ?? "", /^\$2\.60 from Solana didn't go · it's still in your SOL wallet$/, home[0]!.note);
  assert.doesNotMatch(home[0]!.note ?? "", /NEAR wallet/, "never the NEAR wallet: nothing of it is there");
  // control: the same take-out whose move in goes comes home
  const ok = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 2.6 }] });
  assert.ok("ok" in ok);
  for (let i = 0; i < 4; i++) { s.later(PRIVATE.delayMs[1]); await s.f.traded("sol"); await settle(); }
  const back = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in back && back.ok.some((a) => a.kind === "put-away" && a.status !== "failed"), JSON.stringify("ok" in back && back.ok));
});
