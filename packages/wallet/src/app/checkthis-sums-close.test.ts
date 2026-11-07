// J2-1 (D, MUST) and J2-2 (the copy review's walk, 8 Nov; the audit's ruling and test rule): every Check-this sheet's sums close, and they
// are the core's own plan. The walk: the Move page showed Safe -$40.00 / Private -$15.63 while its sheet said "From your
// Safe · $60.00", "Stays in Private · about $4.37" (no From Private row); the core folds Private's $15.63 share into one
// $60 fill (move-plan.ts moveSplit), so the page drew a split the core doesn't run. Send said "Your Safe sends · $30.00"
// for $25 with a sentence; Safe Swap had no fee line.
// Two checks per sheet: the flows (audit: Safe signed + Private net out = destinations + fees + Private net in, to the cent,
// from the core's plan) and the visible rows (every From row = every gets row + Fee + "Private keeps the rest").
// Fails on 9b41a3dc0: the page's fillOf ran its own split (-$40 / -$15.63), the sheets had no Fee row at $0 and said
// "Stays in Private" / "Your Safe sends" rows that don't close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveFillBlock, moveSheet, moveSplitUsd } from "@zerofee/core/move-plan";
import { sendFillWords } from "@zerofee/core/send-fill";
import type { IntentsFacts, QuoteFacts, SendPayout } from "@zerofee/core/intents";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { fillLegs, fillOf, type Leg, type SafeCoinRow } from "./screens/move-split.ts";

const USDC_C = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", USDC = `nep141:${USDC_C}`;
const SOL = "nep141:sol.omft.near";
const c = (usd: number) => BigInt(Math.round(usd * 100));
const $c = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;
/** A row's dollars in cents: its first dollar figure ("about" and the coin in front dropped; "(about $24.75)" read from the
 *  brackets; "gets · about $50.50, at least $49.99" its $50.50, the audit's ruling (c)). */
const cents = (l: string) => { const m = /\$([\d,]+\.\d{2})/.exec(l); return m ? Math.round(Number(m[1]!.replace(/,/g, "")) * 100) : NaN; };
/** The visible rows' check: every From row = every gets row + the Fee row + what Private keeps, to the cent. */
function rowsClose(lines: readonly string[], why: string) {
  const rows = lines.filter((l) => / · /.test(l));
  const sum = (re: RegExp) => rows.filter((l) => re.test(l)).reduce((n, l) => n + cents(l), 0);
  const from = sum(/^From /), gets = sum(/^(.* gets|They get|You get) · /), fee = sum(/^Fees? · /), rest = sum(/^Private keeps the rest · /);
  assert.ok(from > 0, `${why}: a From row: ${lines.join(" | ")}`);
  assert.ok(rows.some((l) => /^Fees? · /.test(l)), `${why}: a Fee row on every Check-this: ${lines.join(" | ")}`);
  assert.ok(!rows.some((l) => /^(Stays in Private|Your Safe sends) · /.test(l)), `${why}: retired rows: ${lines.join(" | ")}`);
  assert.equal(from, gets + fee + rest, `${why}: ${lines.join(" | ")}`);
  return { from, gets, fee, rest, priv: sum(/^From Private · /), safe: sum(/^From your Safe · /) };
}

test("J2-1: the walk's Move ($55.63 to SOL, Private $15.63 of USDC): the page, the core's plan and the sheet show ONE split, Safe -$60.00 and Private +$4.37, and the rows close (fails on 9b41a3dc0: the page said -$40.00 / -$15.63)", () => {
  // the page: the sliders' legs as the walk had them, the Safe's and Private's USDC
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 40 }, { from: "private", to: "sol", usd: 15.63 }];
  const coins: SafeCoinRow[] = [{ tokenId: USDC, symbol: "USDC", amount: "5254.15", usd: "5254.15" }, { tokenId: USDC, symbol: "USDC", amount: "15.63", usd: "15.63", held: "private" }];
  const pays = fillLegs(legs, fillOf(legs, coins));
  const pageSafe = -Math.round((pays.legs.filter((l) => l.from === "safe").reduce((n, l) => n + l.usd, 0) + pays.extra) * 100);
  const pagePrivate = Math.round(pays.privateUsd * 100);
  // the core's plan (what subwallets.movePlan signs: the one fill and each part)
  const plan = moveSplitUsd([55.63], 15.63, { safeHas: 5254.15 });
  assert.equal(plan.fill, 60, "control: the core folds Private's share into one $60 fill");
  assert.deepEqual(plan.parts.map((p) => [p.fromPrivate, p.viaFill]), [[0, 55.63]]);
  // flows (audit): Safe signed + Private net out = destinations + fees + Private net in, from the plan
  for (const fee of [0n, 7n]) {
    const fill = c(plan.fill), brought = fill - fee;
    const parts = plan.parts.map((p) => ({ wallet: "your SOL wallet", priv: c(p.fromPrivate), pay: c(p.viaFill) }));
    const s = moveSheet(parts, fill, $c, { brought });
    const moved = parts.reduce((n, p) => n + p.priv + p.pay, 0n), net = brought - moved;
    assert.equal(fill + (net < 0n ? -net : 0n), moved + fee + (net > 0n ? net : 0n), "the flows close");
    const r = rowsClose(s.lines, `Move, fee ${fee}`);
    // the sheet's rows ARE the plan: the Safe's row is the fill it signs, the gets row the part, Private its net change
    assert.equal(BigInt(r.safe), fill);
    assert.equal(BigInt(r.gets), c(55.63));
    assert.equal(BigInt(r.rest - r.priv), net);
    if (fee === 0n) {
      assert.deepEqual(s.lines.slice(0, 4), ["Your SOL wallet gets · $55.63", "From your Safe · $60.00", "Private keeps the rest · about $4.37", "Fee · $0.00"]);
      // the page's per-place change equals the sheet's (the Sim's fill lands whole)
      assert.equal(pageSafe, -r.safe, "the page's Safe change is the sheet's From your Safe");
      assert.equal(pagePrivate, r.rest - r.priv, "the page's Private change is the sheet's Private row");
    }
  }
  assert.deepEqual([pageSafe, pagePrivate], [-6000, 437], "the page: Safe -$60.00, Private +$4.37");
});

test("J2-1: Private pays out on net only when the core's plan takes it (past the buffer): From Private by the net figure, no rest row; the rows close (control: under the buffer it folds)", () => {
  const plan = moveSplitUsd([510], 495, { safeHas: 5000 });
  const parts = plan.parts.map((p) => ({ wallet: "your SOL wallet", priv: c(p.fromPrivate), pay: c(p.viaFill) }));
  const s = moveSheet(parts, c(plan.fill), $c, { brought: c(plan.fill) });
  const r = rowsClose(s.lines, "past the buffer");
  assert.equal(r.priv, 49000, "Private's $495 out, $5 of the fill kept: $490 on net");
  assert.equal(r.rest, 0);
  const two = moveSplitUsd([8.39, 101.48], 20, { safeHas: 5000 });
  const tp = two.parts.map((p, i) => ({ wallet: i ? "your NEAR wallet" : "your SOL wallet", priv: c(p.fromPrivate), pay: c(p.viaFill) }));
  const ts = moveSheet(tp, c(two.fill), $c, { brought: c(two.fill) - 30n });
  rowsClose(ts.lines, "a two-wallet Move with Private's own part");
});

const facts = { tokens: new Map([[USDC_C, { symbol: "USDC", decimals: 6 }], ["sol.omft.near", { symbol: "SOL", decimals: 9 }]]) } as unknown as IntentsFacts;
const leg1 = (amountIn: string, amountOut = amountIn) => ({ originAsset: USDC, destinationAsset: USDC, amountIn, amountOut }) as unknown as QuoteFacts;
const payout = (amountIn: string, outUsd: string, recipient = "alice.near") => ({ originAsset: USDC, amountIn, destinationAsset: SOL, recipient, recipientType: "DESTINATION_CHAIN", amountInUsd: (Number(amountIn) / 1e6).toFixed(2), amountOutUsd: outUsd }) as unknown as SendPayout;

test("J2-2: the core's Send sheet ($25 stepped to $30): \"Send $25.00 to alice.near\", From your Safe · $30.00 = they get + Fees + Private keeps the rest, no why sentence; the flows close from the signed quotes (fails on 9b41a3dc0: \"Your Safe sends\", a why line)", () => {
  for (const [inUnits, outUnits, pay, outUsd] of [["30000000", "30000000", "25000000", "24.75"], ["30000000", "29700000", "25000000", "24.75"], ["25000000", "25000000", "25000000", "24.75"]] as const) {
    const w = sendFillWords(leg1(inUnits, outUnits), payout(pay, outUsd), facts)!;
    assert.equal(w.title, "Send $25.00 to alice.near");
    const lines = [`They get · 0.2432 SOL (about ${w.gets})`, ...w.lines];
    const r = rowsClose(lines, `Send ${inUnits}/${outUnits}`);
    assert.ok(!w.lines.some((l) => /a little more|round sum/.test(l)), w.lines.join(" | "));
    // flows: the Safe's signed amountIn + Private net out = the payee's dollars + every fee + Private net in
    const safe = Number(inUnits) / 1e4, brought = Number(outUnits) / 1e4, paid = Number(pay) / 1e4, got = Math.round(Number(outUsd) * 100);
    const fees = (safe - brought) + (paid - got), net = brought - paid;
    assert.equal(safe + Math.max(0, -net), got + fees + Math.max(0, net), "the flows close");
    assert.deepEqual([r.safe, r.gets, r.fee, r.rest], [safe, got, fees, Math.max(0, net)], "the rows are the flows");
  }
  // control: a long address keeps "from your Safe" in the title (it is in full on the To row)
  assert.equal(sendFillWords(leg1("30000000"), payout("25000000", "24.75", "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK"), facts)!.title, "Send $25.00 from your Safe");
});

test("J2-1/J2-2 in the Sim, the sheets the walk shot: Move $55.63 (Private $15.63), Send $25 to bob.near, Safe Swap $300 of USDC for SOL: every Check-this closes, and its From your Safe is what left the Safe", async () => {
  const run = async (privateUsdc: string, call: (m: ReturnType<typeof createMockBridge>) => Promise<unknown>) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: privateUsdc, near: "0" } });
    const seen: { title: string; lines: string[] }[] = [];
    mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => { seen.push(a.words); void mock.call("approval.answer", { id: a.id, approve: true }); });
    const safeUsdc = async () => { const r = await mock.call<{ tokenId: string; held?: string; amount: string }[]>("ledger.balances", {}); return "ok" in r ? Math.round(Number(r.ok.find((b) => b.tokenId === USDC && b.held === "ledger")?.amount ?? 0) * 100) : NaN; };
    const before = await safeUsdc();
    const r = await call(mock);
    assert.ok(r && typeof r === "object" && "ok" in r, JSON.stringify(r));
    return { words: seen[0]!, safeOut: before - (await safeUsdc()) };
  };
  const move = await run("15.63", (m) => m.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd: 55.63 }], app: "wallet" }));
  assert.equal(move.words.title, "Move $55.63 to your SOL wallet");
  const mr = rowsClose(move.words.lines, "Sim Move");
  // the audit's ruling (c), 8 Nov: the wallet gets what its quote gives (the Sim's simSwapCost: $55.63 less 0.4 % and $0.30), the
  // rest of the part is the Fee's
  assert.deepEqual([mr.safe, mr.gets, mr.fee, mr.rest, mr.priv], [6000, 5511, 52, 437, 0], move.words.lines.join(" | "));
  assert.equal(move.safeOut, mr.safe, "From your Safe is what left the Safe");
  const swap = await run("0", (m) => m.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd: 300 }], app: "wallet", swap: true }));
  const sr = rowsClose(swap.words.lines, "Sim Swap");
  // J2-2: the form's fee and the sheet's are one figure from one source (the Sim's swapCost, as the form asks it)
  const form = await createMockBridge({ latencyMs: 0 }).call<{ arrivesUsd: number; feeUsd: number }>("subwallet.float.swapCost", { from: "safe", to: "sol", usd: "300.00", app: "wallet" });
  assert.ok("ok" in form, JSON.stringify(form));
  assert.deepEqual([sr.safe, sr.gets, sr.fee, sr.rest], [35000, Math.round(form.ok.arrivesUsd * 100), Math.round(form.ok.feeUsd * 100), 5000], swap.words.lines.join(" | "));
  assert.match(swap.words.lines[0]!, /^You get · about \d+(\.\d{1,4})? SOL \(about \$298\.50\)$/, swap.words.lines.join(" | "));
  assert.equal(swap.safeOut, sr.safe);
  const send = await run("0", (m) => m.call("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: "25", to: { kind: "ledger", accountId: "bob.near" }, fill: true }));
  assert.equal(send.words.title, "Send $25.00 to bob.near");
  const dr = rowsClose(send.words.lines, "Sim Send");
  assert.equal(dr.safe, send.safeOut, "From your Safe is what left the Safe");
});

test("J2-2 on the core's sheet: a Safe Swap of one part says \"You get · about 1.42 SOL (about $298.50)\" from the payout's signed quote, and its fee joins the fill's in the one Fee row; the rows close (controls: no quote dollars, the gets row as before; a Move keeps its gets row)", () => {
  const say = $c, SOLW = "So1aWa11et1111111111111111111111111111111111";
  const base = { own: new Map([[SOLW, "your SOL wallet"]]), sameCoin: true, unit: (u: bigint) => u / 10_000n, say, safe: 35000n, sent: 350_000_000n, brought: 34993n, origin: USDC, symbolOf: (t: string) => (t === SOL ? "SOL" : undefined), swapOf: " of USDC", coinSay: (t: string, units: string) => (t === SOL ? `${Number(units) / 1e9} SOL` : undefined) };
  const part = { recipient: SOLW, own: true, units: "0", payUnits: "300000000", toTokenId: SOL, outUnits: "1420000000", outUsd: "298.50" };
  const w = moveFillBlock({ ...base, parts: [part], swap: true })!;
  assert.equal(w.title, "Swap $300.00 of USDC for SOL");
  assert.deepEqual(w.lines.slice(0, 4), ["You get · about 1.42 SOL (about $298.50)", "From your Safe · $350.00", "Private keeps the rest · about $49.93", "Fee · about $1.57"]);
  rowsClose(w.lines, "core Swap");
  const bare = moveFillBlock({ ...base, parts: [{ ...part, outUsd: undefined }], swap: true })!;
  assert.equal(bare.lines[0], "Your SOL wallet gets · $300.00", "control: no quote dollars, the row as before");
  assert.equal(moveFillBlock({ ...base, parts: [part], swap: false })!.lines[0], "Your SOL wallet gets · $300.00", "control: a Move");
});
