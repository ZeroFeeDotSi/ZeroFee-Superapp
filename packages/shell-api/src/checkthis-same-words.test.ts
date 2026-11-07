// The Sim's "Check this" for a Move's fill and the real core's say the same words for the same plan (the copy review's
// words, 7 Nov; the brief: the core and the Sim say the same words from the same core fields). The Sim's figures (its
// leg, Private's share of it, the Safe's step, the plan's parts) go to the real core as its own record and bytes would
// carry them, and the two sheets' titles and blocks must match, line for line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "@zerofee/core/intents";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const units = (usd: number) => String(Math.round(usd * 100) * 10_000);

/** The Sim's sheet for a Move from Private, and its own figures (what Private holds, the Safe's step). */
async function simSheet(privateUsdc: string, parts: { wallet: string; usd: number }[], swap = false) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: privateUsdc, near: "0" } });
  const seen: PlainWords[] = [];
  mock.on<{ id: string; words: PlainWords }>("approval.needed", (a) => { seen.push(a.words); void mock.call("approval.answer", { id: a.id, approve: true }); });
  const r = await mock.call("ledger.moveFromPrivate", { parts, app: "trade", ...(swap ? { swap: true } : {}) });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(seen.length, 1, "one Safe sheet");
  return seen[0]!;
}

/** The real core's sheet for the same Move: the Safe's step in the bytes, Private's share and the payment as the core's
 *  own record of the leg, the plan as the call carries it. */
async function coreSheet(o: { stepUsd: number; privUsd: number; payUsd: number; payee: string; plan: number[]; swap?: boolean; toTokenId?: string; parts?: { to: string; privUsd: number; payUsd: number }[]; out?: { units: string; usd: string }; /** each wallet's legs' quotes in cents (the audit's ruling (c)), by recipient */ got?: ReadonlyMap<string, { got: string; least: string }> }) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === `nep141:${USDC}` ? "900000000" : "0") });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("sol.omft.near", "omft", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const step = units(o.stepUsd);
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon },
    quote: { depositAddress: DEPOSIT, amountIn: step, minAmountOut: step, amountOut: step, deadline: soon },
  }) };
  // the one fill's parts, as the core's own plan keeps them (subwallets privateLeg `move`; the audit's ruling, 7 Nov)
  const move = (o.parts ?? [{ to: o.payee, privUsd: o.privUsd, payUsd: o.payUsd }]).map((p) => ({ recipient: p.to, own: true, units: units(p.privUsd), payUnits: units(p.payUsd), toTokenId: o.toTokenId ?? "nep141:sol.omft.near", ...(o.out ? { outUnits: o.out.units, outUsd: o.out.usd } : {}), ...(o.got?.get(p.to) ? { gotCents: o.got.get(p.to)!.got, leastCents: o.got.get(p.to)!.least } : {}) }));
  const leg = { tokenId: `nep141:${USDC}`, ...(o.privUsd > 0 ? { units: units(o.privUsd) } : {}), payUnits: units(o.payUsd), recipient: o.payee, own: true, toTokenId: o.toTokenId ?? "nep141:sol.omft.near", move };
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async () => true, oneClick: async (a) => (a === DEPOSIT ? quote : null), quoteKey: TEST_QUOTE_KEY, privateLeg: async () => leg, ownWallets: async () => new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"], [FLOAT, TRADING_BALANCE]]) });
  return signer.describe({ receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token: USDC, receiver_id: DEPOSIT, amount: step }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true, ...(o.plan.length > 1 ? { movePlan: o.plan.map(units) } : {}), ...(o.swap ? { moveSwap: true } : {}) } as TxRequest);
}

const block = (w: PlainWords) => [w.title, ...w.lines.slice(0, w.lines.indexOf("Anyone can see the Safe's part.") + 1)];

test("the Sim and the core say the same words for the same plan: the copy review's two-part Move ($148.25 to the SOL wallet, $12.75 to the NEAR wallet, Private $12.75), a one-part Move with Private's share in it, and the Swap; controls: the old Sim lines (\"The other $X follows\", \"Then NEAR Confidential pays\") and Together are gone", async () => {
  // Private holds $12.75, the Move $161.00: short $148.25, the Safe's step $200 (fillStepUsd); the SOL leg is the fill's
  const cases = [
    { priv: "12.75", parts: [{ wallet: "sw-trade-sol", usd: 148.25 }, { wallet: "near", usd: 12.75 }], core: { stepUsd: 200, privUsd: 0, payUsd: 148.25, payee: SOLW, plan: [148.25, 12.75], parts: [{ to: SOLW, privUsd: 0, payUsd: 148.25 }, { to: FLOAT, privUsd: 12.75, payUsd: 0 }] } },
    // one part, Private's $12.50 under the buffer: folded whole (the audit's R2), a $40 step, Private's share staying
    { priv: "12.5", parts: [{ wallet: "sw-trade-sol", usd: 30 }], core: { stepUsd: 40, privUsd: 0, payUsd: 30, payee: SOLW, plan: [30] } },
    // one part, Private's $495 in it (past the buffer): Private pays its share, the Safe a $20 step over the $15 rest
    { priv: "495", parts: [{ wallet: "sw-trade-sol", usd: 510 }], core: { stepUsd: 20, privUsd: 495, payUsd: 15, payee: SOLW, plan: [510] } },
    // one part, Private empty: a $10 step for $6.00, $4.00 stays
    { priv: "", parts: [{ wallet: "sw-trade-sol", usd: 6 }], core: { stepUsd: 10, privUsd: 0, payUsd: 6, payee: SOLW, plan: [6] } },
  ];
  for (const c of cases) {
    for (const swap of [false, true]) {
      const sim = block(await simSheet(c.priv, c.parts, swap));
      // J2-2: a Swap of one part says what the payout's quote gives; the core reads it from leg 2's signed quote, so its
      // fixture carries the very figures the Sim's quote gave (the coin amount and its dollars)
      const got = /^You get · about ([\d.]+) SOL \(about \$([\d.]+)\)$/.exec(sim[1] ?? "");
      const out = got ? { units: String(Math.round(Number(got[1]) * 1e9)), usd: got[2]! } : undefined;
      assert.equal(!!got, swap && c.parts.length === 1 && c.core.privUsd === 0, `${JSON.stringify(c.parts)} swap ${swap}: ${sim.join(" | ")}`);
      // the audit's ruling (c), 8 Nov: a Move's wallet says what its legs' quotes give; the core reads them from leg 2's signed
      // quote (subwallets planLeg, quoteGot), so its fixture carries the Sim's quote figures, wallet by wallet
      const RECIPIENT: Record<string, string> = { "Your SOL wallet": SOLW, "Your NEAR wallet": FLOAT };
      const gotRows = sim.map((l) => /^(Your \S+ wallet) gets · about \$([\d.]+), at least \$([\d.]+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
      const gotMap = new Map(gotRows.map((m) => [RECIPIENT[m[1]!]!, { got: String(Math.round(Number(m[2]) * 100)), least: String(Math.round(Number(m[3]) * 100)) }]));
      assert.equal(gotRows.length > 0, !got, `a wallet says its quotes; a Swap of one part its own row: ${sim.join(" | ")}`);
      const core = block(await coreSheet({ ...c.core, swap, ...(out ? { out } : {}), ...(gotMap.size ? { got: gotMap } : {}) }));
      assert.deepEqual(sim, core, `${JSON.stringify(c.parts)} swap ${swap}`);
      assert.ok(!sim.some((l) => /follows in a second step|Then NEAR Confidential pays|Together/.test(l)), sim.join(" | "));
    }
  }
  const first = block(await simSheet("12.75", cases[0]!.parts));
  // the copy review's layout (7 Nov): the person's action, every wallet, Private's own part on its row (was "Your Safe adds $148.25 to this $161.00 Move", the NEAR wallet unsaid)
  // fix/move-row-truth (QA's rule, the copy review's words, 7 Nov): no sources line; the rows right under the title
  assert.deepEqual(first.slice(0, 1), ["Move $161.00 to your SOL and NEAR wallets"]);
  // the audit's ruling (c), 8 Nov: each wallet what its legs' quotes give, at least their minAmountOut; what they keep the Fee's
  // (the NEAR wallet's leg a same-coin move: whole, 99 % promised)
  assert.deepEqual(first.slice(1, 6), ["Your SOL wallet gets · about $147.36, at least $145.88", "Your NEAR wallet gets · about $12.75, at least $12.62", "From your Safe · $200.00", "Private keeps the rest · about $39.00", "Fee · about $0.89"]);
  assert.equal(block(await simSheet("12.5", cases[1]!.parts, true))[0], "Swap $30.00 of USDC for SOL");
  assert.equal(block(await simSheet("12.5", cases[1]!.parts))[0], "Move $30.00 to your SOL wallet", "control: a one-leg Move keeps its title");
});

test("J3 (the copy review's walk, 7 Nov), the diagnosis as a test: the Sim's Swap from the Safe that Private covers whole raises no sheet (D143), and its receipt says why (W1); one Private can't cover raises the Safe's one sheet", async () => {
  const { receiptPrivate } = await import("./job-start.ts");
  const sheets = async (privateUsdc: string, usd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: privateUsdc, near: "0" } });
    let n = 0;
    mock.on<{ id: string }>("approval.needed", (a) => { n++; void mock.call("approval.answer", { id: a.id, approve: true }); });
    const r = await mock.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd }], app: "trade", swap: true });
    assert.ok("ok" in r, JSON.stringify(r));
    return n;
  };
  assert.equal(await sheets("25", 10), 0, "the walk's $10 Swap with Private's $25: Private pays it whole, no Safe signature");
  assert.equal(await sheets("5", 10), 1, "control: Private short, the Safe's one sheet comes");
  const rows: [boolean, boolean | undefined, string | null][] = [
    [true, false, "From Private, so no Face ID."],
    [true, true, null],
    [true, undefined, null],
    [false, false, null],
  ];
  for (const [safeRoute, signs, want] of rows) assert.equal(receiptPrivate(safeRoute, signs), want, `${safeRoute} ${signs}`);
});
