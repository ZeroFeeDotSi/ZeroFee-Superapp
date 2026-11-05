// Audit (network and supply chain, 28 Oct 2026; kept here, FIXED): NF-17. The fix: a quote showing an app fee isn't the
// core's (intents.ts parseQuote; 1Click's own 20 bps to its fee account excepted), and a Trading move's price may be at most 3 % plus $0.50 from the core's own
// (float-moves.ts), which bounds a fee the relay adds and then hides. The auditor's text follows.
//
// NF-17 PoC: 1Click's quote signature doesn't cover `appFees` (quote-signature.ts lists the signed fields; appFees isn't
// one), and the core never looks at appFees. A relay that is compromised (the one actor the quote signature was added
// to stop, SECURITY-STUDY 4.13) can add an app fee to its own NEAR account on every Trading move it passes on: 1Click
// signs the quote, the core's checks pass, and the fee is taken from each move, up to the core's 10 % price tolerance
// (float-moves.ts MAX_OVER = 1.1), with no sheet inside the fee guard. FAILS today; passes once the core refuses a
// quote whose request carries an app fee it didn't ask for (or the price tolerance is tight enough to make it pointless).
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedBy1Click } from "./quote-signature.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { RpcEvmChain, type EvmChain } from "./evm.ts";
import type { FloatRelay } from "./float-moves.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const ATTACKER = "relay-owner.near";

test("control NF-17: an app fee added to a quote's request after 1Click signed it still verifies as 1Click's", () => {
  const req = { dry: false, swapType: "EXACT_INPUT", originAsset: "nep141:hood.omft.near", amount: "1", recipient: "f".repeat(64), refundTo: "f".repeat(64) };
  const signed = signedQuote({ quoteRequest: req, quote: { depositAddress: DEPOSIT, amountIn: "1", minAmountOut: "1" } });
  const withFee = { ...signed, quoteRequest: { ...signed.quoteRequest, appFees: [{ recipient: ATTACKER, fee: 800 }] } };
  assert.equal(signedBy1Click(withFee, TEST_QUOTE_KEY), true, "control: the signature doesn't cover appFees");
});

/** Honest Robinhood Chain nodes (both agree). */
function honestNodes() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    const result = ({ eth_getTransactionCount: "0x3", eth_getBlockByNumber: { baseFeePerGas: "0x989680" }, eth_maxPriorityFeePerGas: "0xf4240", eth_getBalance: "0x2386f26fc10000", eth_estimateGas: "0x5b04" /* 23,300: Robinhood Chain while its L1 price is on */, eth_sendRawTransaction: "0x" + "ab".repeat(32) } as Record<string, unknown>)[method];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return () => (globalThis.fetch = real);
}

/** A compromised relay: it forwards the core's request to 1Click with an app fee to its own account (8 %), so 1Click's signed
 *  minAmountOut is 8 % lower, and it hands the signed answer back as it is. */
function feeSkimmingRelay(feeBps = 800, hide = false, to = ATTACKER): FloatRelay & { asked: any[] } {
  const quotes = new Map<string, any>();
  const asked: any[] = [];
  return {
    asked,
    quote: async (req: any) => {
      const forwarded = { ...req, appFees: [{ recipient: to, fee: feeBps }] };
      asked.push(forwarded);
      const deadline = new Date(Date.now() + 86_400_000).toISOString();
      quotes.set(DEPOSIT, { req: forwarded, deadline });
      return { quote: { depositAddress: DEPOSIT, amountIn: req.amount, amountOut: "0", deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => ({}),
    submitIntent: async () => ({}),
    status: async (d: string) => {
      const q = quotes.get(d);
      const fair = (Number(q.req.amount) / 1e18) * 3000 * 1e6; // the core's own price: $3,000 an ETH
      const minAmountOut = String(Math.floor(fair * 0.995 * (1 - feeBps / 10_000))); // 1Click's 0.5 % less the app fee
      const signed = signedQuote({ quoteRequest: q.req, quote: { depositAddress: d, amountIn: q.req.amount, minAmountOut, deadline: q.deadline } });
      // `hide`: the relay hands back the request without the fee (the signature doesn't cover it, so it still checks).
      if (hide) delete (signed.quoteRequest as { appFees?: unknown }).appFees;
      return { status: "PENDING_DEPOSIT", quoteResponse: signed };
    },
  } as unknown as FloatRelay & { asked: any[] };
}

async function movedIn(relay: FloatRelay): Promise<boolean> {
  const w = new SubWallets({
    vault: new MemoryVault(), sol: {} as SolChain, evm: new RpcEvmChain() as EvmChain, floatRelay: relay, mainAccount: async () => "kim.near",
    usdPrice: async (c) => (c === "hood" ? 3000 : 150), approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY,
  });
  await w.create("trade", "near");
  await w.create("trade", "hood", 0);
  try {
    const m = await w.floatIn("hood", 0, "5000000000000000", "trade-job-00000003"); // 0.005 ETH, $15
    return !("declined" in m) && m.where === "in-flight";
  } catch {
    return false;
  }
}

test("NF-17: a 1 % app fee, inside the price bound, is refused because the quote shows it", async () => {
  const restore = honestNodes();
  try {
    assert.equal(await movedIn(feeSkimmingRelay(100)), false);
  } finally {
    restore();
  }
});

test("NF-17: an 8 % app fee the relay hides from the answer is refused by the price bound (3 % plus $0.50)", async () => {
  const restore = honestNodes();
  try {
    assert.equal(await movedIn(feeSkimmingRelay(800, true)), false);
    assert.equal(await movedIn(feeSkimmingRelay(0, true)), true, "control: the same move with no fee goes");
  } finally {
    restore();
  }
});

test("NF-17: 1Click's own fee (20 bps to its fee account, as live quotes carry it) is fine; more, or anyone else's, isn't", async () => {
  const restore = honestNodes();
  try {
    assert.equal(await movedIn(feeSkimmingRelay(20, false, "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd")), true);
    assert.equal(await movedIn(feeSkimmingRelay(21, false, "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd")), false);
    assert.equal(await movedIn(feeSkimmingRelay(20)), false, "the same fee to another account");
    // the partner-key fee account (2 Nov): the same 20 bps passes, more doesn't
    assert.equal(await movedIn(feeSkimmingRelay(20, false, "2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805")), true);
    assert.equal(await movedIn(feeSkimmingRelay(21, false, "2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805")), false);
  } finally {
    restore();
  }
});

test("NF-17b: a Trading move is never paid on a quote carrying an app fee the core didn't ask for", async () => {
  const restore = honestNodes();
  try {
    const relay = feeSkimmingRelay();
    const shown: unknown[] = [];
    const w = new SubWallets({
      vault: new MemoryVault(), sol: {} as SolChain, evm: new RpcEvmChain() as EvmChain, floatRelay: relay, mainAccount: async () => "kim.near",
      usdPrice: async (c) => (c === "hood" ? 3000 : 150), approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
    });
    await w.create("trade", "near");
    await w.create("trade", "hood", 0);
    let paid = false;
    try {
      const m = await w.floatIn("hood", 0, "5000000000000000", "trade-job-00000002"); // 0.005 ETH, $15
      paid = !("declined" in m) && m.where === "in-flight";
    } catch { /* refused: the fix */ }
    assert.equal(paid, false, `paid with no sheet (${shown.length} shown) on a quote whose request gives ${ATTACKER} 8 % of the move`);
  } finally {
    restore();
  }
});
