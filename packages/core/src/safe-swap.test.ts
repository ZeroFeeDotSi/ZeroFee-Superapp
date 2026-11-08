// The Safe's swap in place (safe-swap.ts): QA's condition 2, each refusal on its own, with its control. The quote
// is the core's own (asked through the relay), read back as 1Click SIGNED it for that deposit address, and held to the
// figure shown; only then is it kept for the Safe's sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSafeSwaps, SAFE_SWAP_DEADLINE_MS } from "./safe-swap.ts";
import { QUOTE_DEADLINE_STEP_MS } from "./quote-deadline.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR = "nep141:wrap.near";
const SAFE = "kim.near";
const DEP = "ab".repeat(32), OTHER = "cd".repeat(32);

function setup(o: { lie?: (req: Record<string, unknown>, q: Record<string, unknown>) => void; signedFor?: string; status?: string; minOut?: string; now?: () => number } = {}) {
  const asked: Record<string, unknown>[] = [];
  const relay = {
    quote: async (body: Record<string, unknown>) => (asked.push(body), { quote: { depositAddress: DEP }, zerofeeStatusTag: "t".repeat(20) }),
  };
  const status = async (dep: string) => {
    const req: Record<string, unknown> = { ...asked.at(-1)! };
    const q: Record<string, unknown> = { depositAddress: o.signedFor ?? dep, amountIn: req.amount, amountOut: "3000000000000000000000000", minAmountOut: o.minOut ?? "2970000000000000000000000", deadline: new Date(Date.now() + 5 * 60_000).toISOString(), timeEstimate: 10 };
    o.lie?.(req, q);
    return { status: o.status ?? "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: q }, new Date(o.now?.() ?? Date.now()).toISOString()) };
  };
  const swaps = createSafeSwaps({ relay, status, quoteKey: TEST_QUOTE_KEY, account: async () => SAFE, ...(o.now ? { now: o.now } : {}) });
  return { swaps, asked };
}
/** Refused, saying why (the Problem's own detail). */
const said = (p: Promise<unknown>, words: RegExp) => assert.rejects(p, (e: { problem?: { more?: string } }) => words.test(e.problem?.more ?? ""));
const ask = (s: ReturnType<typeof setup>, atLeast = "2900000000000000000000000") => s.swaps.quote(USDC, NEAR, "10000000", atLeast);

test("control: an INTENTS-to-INTENTS quote into the Safe, refunded there, asked confidentially, is kept for the Safe's sheet", async () => {
  const s = setup();
  const q = await ask(s);
  assert.equal(q.depositAddress, DEP);
  assert.equal(q.amountIn, "10000000");
  assert.equal(q.etaSeconds, 10, "1Click's own time");
  const b = s.asked[0]!;
  assert.deepEqual([b.depositType, b.recipientType, b.refundType, b.recipient, b.refundTo, b.confidentiality, b.dry], ["INTENTS", "INTENTS", "INTENTS", SAFE, SAFE, "basic", false]);
  assert.ok(await s.swaps.facts(DEP), "the sheet finds the signed quote for that address");
  assert.equal(await s.swaps.facts(OTHER), null, "and nothing for any other");
});

test("refused: the signed quote is for another deposit address than the one to pay", async () => {
  const s = setup({ signedFor: OTHER });
  await said(ask(s), /didn't sign/);
  assert.equal(await s.swaps.facts(DEP), null, "nothing kept");
});

test("refused: amountIn isn't the units asked", async () => {
  await said(ask(setup({ lie: (_r, q) => void (q.amountIn = "10000001") })), /different amount/);
});

// Privacy P7 (QA): the core asks 1Click for a deadline on a 5-minute mark (quoteDeadline), and its own "too
// old" cap leaves room for that one step. Fixed clocks across one window; 1Click signs back the deadline it was asked.
const W = Date.parse("2026-11-05T06:00:00.000Z"), MIN = 60_000;
const CLOCKS = [W + 1, W + 1_000, W + MIN, W + 2 * MIN + 30_000, W + 4 * MIN + 59_000, W + 5 * MIN - 1, W + 5 * MIN];
const echo = (r: Record<string, unknown>, q: Record<string, unknown>) => void (q.deadline = r.deadline);
test("the deadline asked is on a 5-minute mark, at least 10 min, under 15 min, and the honest signed quote passes at every clock (control: the old cap refused it)", async () => {
  const oldCap = (now: number) => now + SAFE_SWAP_DEADLINE_MS + 60_000;
  let oldRefused = 0;
  for (const at of CLOCKS) {
    const s = setup({ now: () => at, lie: echo });
    const q = await ask(s);
    const iso = s.asked[0]!.deadline as string, d = Date.parse(iso);
    assert.match(iso, /T\d\d:[0-5][05]:00\.000Z$/, `${new Date(at).toISOString()} → ${iso}`);
    assert.ok(d >= at + SAFE_SWAP_DEADLINE_MS && d < at + SAFE_SWAP_DEADLINE_MS + QUOTE_DEADLINE_STEP_MS, iso);
    assert.equal(q.deadlineIso, iso, "signed as asked, and kept");
    if (d > oldCap(at)) oldRefused++;
  }
  assert.ok(oldRefused >= 4, `the old cap (10 min + 60 s) refused the honest price at ${oldRefused} of ${CLOCKS.length} clocks`);
});

test("the cap: a price lasting exactly 10 min + one step + 60 s is signed; 1 ms longer is refused", async () => {
  const at = W + 1_000, cap = at + SAFE_SWAP_DEADLINE_MS + QUOTE_DEADLINE_STEP_MS + 60_000;
  const lasts = (ms: number) => (_r: Record<string, unknown>, q: Record<string, unknown>) => void (q.deadline = new Date(ms).toISOString());
  assert.ok(await ask(setup({ now: () => at, lie: lasts(cap) })));
  await said(ask(setup({ now: () => at, lie: lasts(cap + 1) })), /too old/);
});

test("refused: its deadline is past", async () => {
  await said(ask(setup({ status: "PROCESSING" })), /too old/);
});

test("refused: minAmountOut under the figure shown (control: equal passes)", async () => {
  // Send S8 (audit, 8 Nov): who (NEAR Intents), where the money is (your Safe), the next tap; never the bare "The price changed."
  await said(ask(setup({ minOut: "2899999999999999999999999" })), /^NEAR Intents priced it lower than you saw\. Nothing moved\. It's still in your Safe\. Swap again for a new price\.$/);
  assert.ok(await ask(setup({ minOut: "2900000000000000000000000" })));
});

test("refused: it pays or refunds anyone but the Safe, or isn't an INTENTS deposit", async () => {
  await said(ask(setup({ lie: (r) => void (r.recipient = "thief.near") })), /pays? into your Safe/);
  await said(ask(setup({ lie: (r) => void (r.refundTo = "thief.near") })), /refund/);
  await said(ask(setup({ lie: (r) => void (r.depositType = "ORIGIN_CHAIN") })), /kind of price/);
});
