// the audit's ruling (c) on QA's finding (8 Nov): the Move's PLAN (before any quote) said "Arrives at least $48.43 /
// Fees at most $2.57" while its Check-this said "gets about $51.00" and "Fee · $0.00". The plan stays bounds; the sheet
// says the SIGNED figures: each wallet "gets · about $X" from leg 2's signed quote (its amountOutUsd), "at least $Y" from
// its minAmountOut, and "Fee · about $Z" with what the quotes keep. From the signed quotes, the sheet's fee is at most the
// plan's "at most" and its at-least at least the plan's "at least", one wallet and two, core and Sim. A quote past the
// bound heads the sheet with "Costs more than the plan said." and the real figures (the re-arm: approval-arm.test.ts).
// Fails on ae8e3f472 and 1e2123004: the sheet said the typed part ("gets · $51.00"), no at-least, no quote fee, no head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveFillBlock, moveSheet } from "@zerofee/core/move-plan";
import { walletLegLeastUsd } from "@zerofee/core/float-floors";
import * as route from "@zerofee/core/private-route";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { costRows, type Leg } from "./screens/move-split.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", SOL = "nep141:sol.omft.near";
const SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const HEAD = "Costs more than the plan said.";
const $c = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;
const c = (x: string) => Math.round(Number(x.replace(/,/g, "")) * 100);
const u6 = (usd: number) => String(Math.round(usd * 100) * 10_000);

/** The plan's bounds as the Move page says them, before any quote (costRows: "at least $X", "at most $Y"), in cents. */
function planOf(legs: Leg[]) {
  const rows = costRows(legs)!.rows;
  const least = /^at least \$([\d,.]+)$/.exec(rows[1]!.value), most = /^at most \$([\d,.]+)$/.exec(rows[2]!.value);
  assert.ok(least && most, JSON.stringify(rows));
  return { least: c(least[1]!), most: c(most[1]!) };
}
/** The sheet's signed figures: every wallet's "gets · about $X, at least $Y" and the Fee row, in cents. */
function sheetOf(lines: readonly string[]) {
  const gets = lines.map((l) => /^Your .+ wallet gets · about \$([\d,.]+), at least \$([\d,.]+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
  const fee = /^Fee · (?:about )?\$([\d,.]+)$/.exec(lines.find((l) => l.startsWith("Fee · ")) ?? "");
  assert.ok(gets.length && fee, `the signed rows: ${lines.join(" | ")}`);
  return { got: gets.reduce((n, m) => n + c(m[1]!), 0), least: gets.reduce((n, m) => n + c(m[2]!), 0), fee: c(fee[1]!), wallets: gets.length };
}

/** Leg 2's signed quote for a part (1Click's figures: amountIn the part, amountOut its coin, amountOutUsd, minAmountOut). */
const quote = (outUsd: number, slip = 0.01) => ({ amountOut: "1000000000", minAmountOut: String(Math.floor(1e9 * (1 - slip))), amountOutUsd: outUsd.toFixed(2) });
/** The core's one fill sheet from its plan's parts and each part's signed quote (subwallets planLeg keeps them by quoteGot). */
function coreSheet(parts: { to: string; usd: number; q: ReturnType<typeof quote> }[], stepUsd: number, broughtUsd = stepUsd) {
  const move = parts.map((p) => {
    const g = route.quoteGot(p.q);
    assert.ok(g, "a signed quote's dollars");
    return { recipient: p.to, own: true, units: "0", payUnits: u6(p.usd), toTokenId: SOL, gotCents: g.got.toString(), leastCents: g.least.toString() };
  });
  const sent = move.reduce((n, p) => n + BigInt(p.payUnits), 0n);
  return moveFillBlock({ parts: move, own: new Map([[SOLW, "your SOL wallet"], [FLOAT, "your NEAR wallet"]]), sameCoin: true, unit: (x) => x / 10_000n, say: $c, safe: BigInt(Math.round(stepUsd * 100)), sent: sent > BigInt(u6(stepUsd)) ? sent : BigInt(u6(stepUsd)), brought: BigInt(Math.round(broughtUsd * 100)), swap: false, origin: USDC, symbolOf: () => undefined, swapOf: " of USDC", dollar: true })!;
}

async function simSheet(parts: { wallet: string; usd: number }[], privateUsdc = "") {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, ...(privateUsdc ? { hiddenStart: { usdc: privateUsdc, near: "0" } } : {}) });
  const seen: { title: string; lines: string[] }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => { seen.push(a.words); void mock.call("approval.answer", { id: a.id, approve: true }); });
  const r = await mock.call("ledger.moveFromPrivate", { parts, app: "wallet" });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(seen.length, 1, "one Safe sheet");
  return seen[0]!;
}

test("the audit's ruling (c), core: from the signed quotes, a one-wallet and a two-wallet Move say what each wallet gets, about, and at least; the sheet's fee is at most the plan's and its at-least at least the plan's; no head (fails on ae8e3f472 and 1e2123004: \"gets · $51.00\", Fee $0.00)", () => {
  // one wallet: $51.00 to the SOL wallet, a $60 step, leg 2's quote gives $50.62, at least 99 % of it
  const one = coreSheet([{ to: SOLW, usd: 51, q: quote(50.62) }], 60, 59.97);
  assert.deepEqual(one.lines.slice(0, 4), ["Your SOL wallet gets · about $50.62, at least $50.11", "From your Safe · $60.00", "Private keeps the rest · about $8.97", "Fee · about $0.41"]);
  const p1 = planOf([{ from: "safe", to: "sol", usd: 51 }]), s1 = sheetOf(one.lines);
  assert.ok(s1.fee <= p1.most, `fee ${s1.fee} ≤ the plan's at most ${p1.most}`);
  assert.ok(s1.least >= p1.least, `at least ${s1.least} ≥ the plan's ${p1.least}`);
  assert.ok(!one.lines.includes(HEAD), "within the plan: no head");
  // two wallets: $101.48 to the SOL wallet, $8.39 to the NEAR wallet, a $150 step
  const two = coreSheet([{ to: SOLW, usd: 101.48, q: quote(100.9) }, { to: FLOAT, usd: 8.39, q: quote(8.36, 0.005) }], 150);
  const p2 = planOf([{ from: "safe", to: "sol", usd: 101.48 }, { from: "safe", to: "near", usd: 8.39 }]), s2 = sheetOf(two.lines);
  assert.equal(s2.wallets, 2, two.lines.join(" | "));
  assert.equal(two.title, "Move $109.87 to your SOL and NEAR wallets");
  assert.ok(s2.fee <= p2.most && s2.least >= p2.least, `${JSON.stringify(s2)} within ${JSON.stringify(p2)}`);
  assert.ok(!two.lines.includes(HEAD));
});

test("the audit's ruling (c), Sim: the same Moves from the Sim's own quote (simSwapCost) hold to the plan's bounds, one wallet and two (fails on ae8e3f472 and 1e2123004: no at-least, the typed figure)", async () => {
  for (const [parts, legs] of [
    [[{ wallet: "sw-trade-sol", usd: 51 }], [{ from: "safe", to: "sol", usd: 51 }]],
    [[{ wallet: "sw-trade-sol", usd: 51 }, { wallet: "near", usd: 20 }], [{ from: "safe", to: "sol", usd: 51 }, { from: "safe", to: "near", usd: 20 }]],
    // QA's reshoot (8 Nov): the walk's two-wallet Move headed "Costs more" from its NEAR wallet leg; that leg is USDC into
    // USDC (a same-coin move: whole, 99 % promised), right at the plan's 99 %, so never past it
    [[{ wallet: "sw-trade-sol", usd: 2.85 }, { wallet: "near", usd: 107.02 }], [{ from: "safe", to: "sol", usd: 2.85 }, { from: "safe", to: "near", usd: 107.02 }]],
  ] as [{ wallet: string; usd: number }[], Leg[]][]) {
    const w = await simSheet(parts);
    const p = planOf(legs), s = sheetOf(w.lines);
    assert.equal(s.wallets, parts.length, w.lines.join(" | "));
    assert.ok(s.fee <= p.most, `fee ${s.fee} ≤ ${p.most}: ${w.lines.join(" | ")}`);
    assert.ok(s.least >= p.least, `at least ${s.least} ≥ ${p.least}: ${w.lines.join(" | ")}`);
    assert.ok(!w.lines.includes(HEAD), w.lines.join(" | "));
  }
  // the walk's one wallet: $51.00 to the SOL wallet, Private empty
  assert.deepEqual((await simSheet([{ wallet: "sw-trade-sol", usd: 51 }])).lines.slice(0, 4), ["Your SOL wallet gets · about $50.50, at least $49.99", "From your Safe · $60.00", "Private keeps the rest · about $9.00", "Fee · about $0.50"]);
});

test("the audit's ruling (c): a signed quote past the plan's bound (it promises less than \"at least\", or keeps more than \"at most\") heads the sheet with \"Costs more than the plan said.\", then the real figures; core and Sim (fails on ae8e3f472 and 1e2123004: no head, the plan's figure)", async () => {
  // the core: leg 2 promises at least $45.00 for $51.00 (the plan: at least $48.71)
  const low = coreSheet([{ to: SOLW, usd: 51, q: quote(50, 0.1) }], 60);
  assert.equal(low.lines[0], HEAD, low.lines.join(" | "));
  assert.deepEqual(low.lines.slice(1, 5), ["Your SOL wallet gets · about $50.00, at least $45.00", "From your Safe · $60.00", "Private keeps the rest · about $9.00", "Fee · about $1.00"]);
  // the fee past "at most" alone (its at-least within): leg 1 keeps $1.00 of the $60 step, leg 2 gives $49.40 (at least
  // $48.90, over the plan's $48.71): $2.60 of fees, the plan said at most $2.29 (the audit's MUST: 99 % / 1.03 less the SOL leg's
  // $0.30 network fee, float-floors NETWORK_FEE_USD)
  const p = planOf([{ from: "safe", to: "sol", usd: 51 }]);
  assert.deepEqual(p, { least: 4871, most: 229 });
  const dear = coreSheet([{ to: SOLW, usd: 51, q: quote(49.4) }], 60, 59);
  const d = sheetOf(dear.lines);
  assert.ok(d.least >= p.least && d.fee > p.most, JSON.stringify(d));
  assert.deepEqual(dear.lines.slice(0, 5), [HEAD, "Your SOL wallet gets · about $49.40, at least $48.90", "From your Safe · $60.00", "Private keeps the rest · about $8.00", "Fee · about $2.60"]);
  // control: a quote right at the bound has no head
  const atBound = coreSheet([{ to: SOLW, usd: 51, q: { amountOut: "1000000000", minAmountOut: "1000000000", amountOutUsd: (p.least / 100).toFixed(2) } }], 60);
  assert.notEqual(atBound.lines[0], HEAD, atBound.lines.join(" | "));
  // the audit's MUST (8 Nov), the bound fixed, not the noise: a $5 Sim Move to the SOL wallet keeps $0.32 (0.4 % and the SOL
  // leg's $0.30, the same table), inside the plan's "at most $0.50": no head (was the head under the old bound)
  const sim = await simSheet([{ wallet: "sw-trade-sol", usd: 5 }]);
  const ps = planOf([{ from: "safe", to: "sol", usd: 5 }]), ss = sheetOf(sim.lines);
  assert.deepEqual(ps, { least: 450, most: 50 });
  assert.ok(ss.fee <= ps.most && ss.least >= ps.least, JSON.stringify(ss));
  assert.ok(!sim.lines.includes(HEAD), sim.lines.join(" | "));
  assert.deepEqual(sim.lines.slice(0, 4), ["Your SOL wallet gets · about $4.68, at least $4.63", "From your Safe · $10.00", "Private keeps the rest · about $5.00", "Fee · about $0.32"]);
});

test("the audit's SHOULD (8 Nov): a wallet-to-wallet part has no signed quote yet, so its least is the plan's own floor, said as the plan's: \"at least about $Y\" (a wallet with a quoted part and one from another wallet; a wallet with only the other's); the rows still close", () => {
  const cents = (usd: number) => BigInt(Math.floor(usd * 100 + 1e-6));
  // the walk's Move: $46.00 from the Safe to the SOL wallet (quote $45.53, at least $45.07), $3.64 from the ETH (RH) wallet to
  // it, and $5.00 from the ETH (RH) wallet to the NEAR wallet
  const s = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 4600n, got: 4553n, least: 4507n }], 5000n, $c, { others: [{ from: "your ETH (RH) wallet", to: "your SOL wallet", v: 364n }, { from: "your ETH (RH) wallet", to: "your NEAR wallet", v: 500n }] });
  const sol = 4507n + cents(walletLegLeastUsd(3.64, true, true)), near = cents(walletLegLeastUsd(5, true, false));
  assert.deepEqual(s.lines.slice(0, 2), [`Your SOL wallet gets · about $49.17, at least about ${$c(sol)}`, `Your NEAR wallet gets · about $5.00, at least about ${$c(near)}`]);
  assert.deepEqual([sol, near], [4799n, 432n], "the plan's floors: leastIn(99 %) / 1.03 on to a chain, leastIn(99 %) into the NEAR wallet");
  const fig = (re: RegExp) => s.lines.filter((l) => re.test(l)).reduce((n, l) => n + c(/\$([\d,.]+)/.exec(l)![1]!), 0);
  assert.equal(fig(/^From /), fig(/ gets · /) + fig(/^Fee · /) + fig(/^Private keeps the rest · /), s.lines.join(" | "));
  // control: a quoted part alone is its quote's own at-least, never "about"
  assert.equal(moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 4600n, got: 4553n, least: 4507n }], 5000n, $c).lines[0], "Your SOL wallet gets · about $45.53, at least $45.07");
});
