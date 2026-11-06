// TN2 (D74): a NEAR coin bought or sold inside Spending. The core asks 1Click itself for a confidential quote from and into
// the float (no public wallet, no Safe hop), holds it to its own floor and the person's least, signs as the float only
// what those checks pass (D143: the NEAR wallet is a hot key, so no sheet ever asks), and counts the coin in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58, utf8 } from "./sol/bytes.ts";
import type { PlainWords } from "./signer.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const QTC = "nep141:qtc.omft.near";
const key = (n: number) => `swap-key-${String(n).padStart(8, "0")}`;
/** QTC at $70, 12 places, as 1Click's list says it. */
const PRICES: Record<string, { usd: number; decimals: number; symbol: string }> = { [QTC]: { usd: 70, decimals: 12, symbol: "QTC" } };
/** What `usd` of QTC is, in its units, less 1Click's 0.3 %. */
const qtcFor = (usd: number) => BigInt(Math.floor((usd * 0.997 / 70) * 1e12));

function relay(o: { lie?: (req: any) => any; minOut?: (req: any) => string; status?: string; details?: (req: any) => unknown; deadlineMs?: number } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  let state = o.status ?? "PENDING_DEPOSIT";
  const out = (req: any) => (req.originAsset === FLOAT_USDC ? qtcFor(Number(req.amount) / 1e6) : BigInt(Math.floor((Number(req.amount) / 1e12) * 70 * 0.997 * 1e6))).toString();
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      if (req.dry) return { quote: { amountIn: req.amount, amountOut: out(req), minAmountOut: ((BigInt(out(req)) * 99n) / 100n).toString(), timeEstimate: 2 } };
      const depositAddress = (asked.length.toString(16) + "d".repeat(64)).slice(0, 64);
      // as recorded on 25 Oct: 1Click's signed deadline is the one asked for plus exactly 3 days
      const deadline = new Date(Date.parse(req.deadline) + (o.deadlineMs ?? 3 * 86_400_000)).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: out(req), deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      const minAmountOut = o.minOut?.(req) ?? ((BigInt(out(q.req)) * 99n) / 100n).toString();
      // stamped from Date.now (not new Date()), so a test that fixes the clock gets a quote signed at that clock
      const signed = signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.req.amount, amountOut: out(q.req), minAmountOut, deadline: q.deadline } }, new Date(Date.now()).toISOString());
      return { status: state, quoteResponse: signed, ...(o.details ? { swapDetails: o.details(q.req) } : { swapDetails: { amountOut: out(q.req) } }) };
    },
  };
  return { r, asked, submitted, set: (s: string) => (state = s) };
}

async function setup(o: Parameters<typeof relay>[0] = {}, answer = true, held: Record<string, string> = { [FLOAT_USDC]: "50000000" }, prices = PRICES) {
  const shown: PlainWords[] = [];
  const fake = relay(o);
  const vault = new MemoryVault();
  const w = new SubWallets({
    vault, sol: {} as never, evm: {} as never, floatRelay: fake.r, mainAccount: async () => "kim.near",
    usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600), tokenPrice: async (t) => prices[t] ?? null,
    approve: async (words) => (shown.push(words), answer), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
  });
  const float = await w.create("trade", "near");
  // the float's count as it stands: $50 of USDC (and whatever a test gives it)
  await vault.put("float-move-log", utf8(JSON.stringify({ base: held, kept: [] })));
  return { w, float, shown, vault, ...fake };
}
const TRADE = { app: "trade" };
const held = async (w: SubWallets, t: string) => (await w.floatBalance()).tokens.find((x) => x.tokenId === t)?.amount ?? "0";

test("buy: one confidential quote from Spending's USDC into Spending itself, signed as the float, no sheet (D143)", async () => {
  const { w, float, asked, submitted, shown, set } = await setup();
  const m = await w.floatSwap("buy", QTC, "5000000", "0", key(1), TRADE);
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.status, m.where], ["swap", "pending", "in-flight"]);
  const req = asked[0];
  assert.deepEqual(
    [req.dry, req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality],
    [false, FLOAT_USDC, "CONFIDENTIAL_INTENTS", QTC, "EXACT_INPUT", "5000000", float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS", "basic"],
  );
  assert.equal(submitted.length, 1);
  assert.ok(ed25519.verify(fromBase58(submitted[0].signature.slice(8)), nep413Hash(submitted[0].payload), fromHex(float.address)), "signed by the float's own key");
  // D143: the core's checks are the gate; no sheet asks
  assert.equal(shown.length, 0);
  // the USDC is counted gone once signed; the coin counts in once 1Click says it settled
  assert.equal(await held(w, FLOAT_USDC), "45000000");
  set("SUCCESS");
  const done = await w.floatMove(m.id);
  assert.deepEqual([done.status, done.where], ["done", "float"]);
  assert.equal(await held(w, QTC), qtcFor(5).toString());
});

test("sell: the coin for USDC back into Spending, signed as the float, no sheet", async () => {
  const { w, asked, submitted, shown } = await setup({}, true, { [FLOAT_USDC]: "0", [QTC]: "71000000000" });
  const m = await w.floatSwap("sell", QTC, "71000000000", "0", key(5), TRADE);
  assert.ok(!("declined" in m));
  assert.deepEqual([asked[0].originAsset, asked[0].destinationAsset, asked[0].recipient === asked[0].refundTo], [QTC, FLOAT_USDC, true]);
  assert.equal(submitted.length, 1);
  assert.equal(shown.length, 0);
  assert.equal(await held(w, QTC), "0", "the coin counted gone once signed");
});

test("a quote that isn't the one asked for, or pays too little, is never signed (control: the honest quote is)", async () => {
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["another recipient", { lie: (q) => ({ ...q, recipient: "e".repeat(64) }) }],
    ["refunds elsewhere", { lie: (q) => ({ ...q, refundTo: "e".repeat(64) }) }],
    ["another coin", { lie: (q) => ({ ...q, destinationAsset: "nep141:eth.omft.near" }) }],
    ["out of the public account", { lie: (q) => ({ ...q, depositType: "INTENTS" }) }],
    ["not confidential", { lie: (q) => ({ ...q, confidentiality: "none" }) }],
    ["another kind of price", { lie: (q) => ({ ...q, swapType: "FLEX_INPUT" }) }],
    ["a price that lasts longer than 1Click's own 3 days", { deadlineMs: 4 * 86_400_000 }],
    ["a far price", { minOut: () => qtcFor(3).toString() }],
  ];
  for (const [name, o] of cases) {
    const { w, submitted, shown } = await setup(o);
    await assert.rejects(w.floatSwap("buy", QTC, "5000000", "0", key(6), TRADE), (e: any) => e.problem?.code === "security.subwallet.refused", name);
    assert.equal(submitted.length, 0, name);
    assert.equal(shown.length, 0, `${name}: never on a sheet`);
    assert.equal(await held(w, FLOAT_USDC), "50000000", `${name}: nothing counted gone`);
  }
  // the person's own least is held too
  const { w } = await setup();
  await assert.rejects(w.floatSwap("buy", QTC, "5000000", qtcFor(5).toString(), key(7), TRADE), (e: any) => /too far/.test(e.problem?.more));
  // control: the honest quote, the same buy, is signed and counted
  const ok = await setup();
  await ok.w.floatSwap("buy", QTC, "5000000", "0", key(8), TRADE);
  assert.equal(ok.submitted.length, 1);
  assert.equal(await held(ok.w, FLOAT_USDC), "45000000");
});

test("refused before anything is asked: a coin's id, more than Spending holds, under $1, no price from 1Click, a key reused", async () => {
  const { w, asked } = await setup();
  for (const coin of ["qtc.omft.near", "nep141:QTC.near", "nep141:a..near", FLOAT_USDC, "nep245:v2_1.omni.hot.tg:56_x"]) await assert.rejects(w.floatSwap("buy", coin, "5000000", "0", key(9), TRADE), (e: any) => e.problem?.code === "security.request.invalid", coin);
  await assert.rejects(w.floatSwap("buy", QTC, "60000000", "0", key(10), TRADE), (e: any) => /cash/.test(e.problem?.more));
  await assert.rejects(w.floatSwap("buy", QTC, "900000", "0", key(11), TRADE), (e: any) => e.problem?.code === "security.request.not-allowed");
  await assert.rejects(w.floatSwap("buy", "nep141:nearly-993927.nearlytrade.near", "5000000", "0", key(12), TRADE), (e: any) => e.problem?.code === "security.partner.unreachable");
  await assert.rejects(w.floatSwap("sell", QTC, "1", "0", key(13), TRADE));
  assert.equal(asked.length, 0);
  const first = await w.floatSwap("buy", QTC, "5000000", "0", key(14), TRADE);
  assert.deepEqual(await w.floatSwap("buy", QTC, "5000000", "0", key(14), TRADE), first, "the same key: the same move");
  await assert.rejects(w.floatSwap("buy", QTC, "6000000", "0", key(14), TRADE), (e: any) => e.problem?.code === "security.request.invalid");
});

test("swapQuote: a dry quote of the same shape, nothing kept or signed", async () => {
  const { w, asked, submitted } = await setup();
  const q = await w.floatSwapQuote("buy", QTC, "5000000");
  assert.deepEqual([q.amountIn, q.amountOut, q.decimals, q.symbol, q.coinUsd, q.etaSeconds], ["5000000", qtcFor(5).toString(), 12, "QTC", 70, 2]);
  assert.equal(asked[0].dry, true);
  assert.equal(asked[0].recipientType, "CONFIDENTIAL_INTENTS");
  assert.equal(submitted.length, 0);
  assert.equal((await w.floatMoveList()).length, 0);
});

test("a refunded swap puts back what was paid; 1Click's FAILED leaves it in Spending", async () => {
  const { w, set } = await setup({ details: (req) => ({ refundedAmount: req.amount }) });
  const m = await w.floatSwap("buy", QTC, "5000000", "0", key(15), TRADE);
  set("REFUNDED");
  const back = await w.floatMove((m as { id: string }).id);
  assert.equal(back.status, "refunded");
  assert.equal(await held(w, FLOAT_USDC), "50000000");
  assert.equal(await held(w, QTC), "0");
});

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
}

test("review H1 (D143): with no session, Trade's swap starts one silently and says when it ends; the next swap starts none; a refused swap starts none", async () => {
  const S = { perTxUsd: 100, totalUsd: 500, minutes: 30 };
  // the relay lies on the $6 buy only (another recipient): its checks refuse it
  const { w, shown, submitted } = await setup({ lie: (q) => (q.amount === "6000000" ? { ...q, recipient: "e".repeat(64) } : q) }, true, { [FLOAT_USDC]: "50000000" });
  await assert.rejects(w.floatSwap("buy", QTC, "6000000", "0", key(19), TRADE, S), (e: any) => e.problem?.code === "security.subwallet.refused");
  assert.equal(submitted.length, 0);
  // control: the honest buy goes, and since the refused one started nothing, this one starts the session
  const first = await w.floatSwap("buy", QTC, "5000000", "0", key(20), TRADE, S);
  assert.ok(!("declined" in first) && typeof (first as { sessionEndsAtIso?: string }).sessionEndsAtIso === "string");
  assert.equal(submitted.length, 1);
  const next = await w.floatSwap("buy", QTC, "5000000", "0", key(21), TRADE, S);
  assert.ok(!("sessionEndsAtIso" in next), "a session already open: none started");
  assert.equal(shown.length, 0, "no sheet, no Face ID");
  // another app never gets a session from it
  const other = await setup();
  const o = await other.w.floatSwap("buy", QTC, "5000000", "0", key(23), { app: "browser" }, S);
  assert.ok(!("sessionEndsAtIso" in o));
  assert.equal(other.shown.length, 0);
});

test("review M1: two swaps at once never both spend the same cash", async () => {
  const { w, submitted } = await setup({}, true, { [FLOAT_USDC]: "8000000" });
  const both = await Promise.allSettled([w.floatSwap("buy", QTC, "5000000", "0", key(30), TRADE), w.floatSwap("buy", QTC, "5000000", "0", key(31), TRADE)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(submitted.length, 1);
  assert.equal(await held(w, FLOAT_USDC), "3000000");
});

test("review M2, L2, L6: no plain name, no swap; a settled figure above what 1Click signed counts as the least", async () => {
  const odd = await setup({}, true, undefined, { [QTC]: { usd: 70, decimals: 12, symbol: "Q\u0422C" } });
  await assert.rejects(odd.w.floatSwap("buy", QTC, "5000000", "0", key(40), TRADE), (e: any) => /name this coin/.test(e.problem?.more));
  assert.equal(odd.asked.length, 0);
  const lie = await setup({ details: () => ({ amountOut: (qtcFor(5) * 10n).toString() }) });
  const m = await lie.w.floatSwap("buy", QTC, "5000000", "0", key(41), TRADE);
  lie.set("SUCCESS");
  await lie.w.floatMove((m as { id: string }).id);
  assert.equal(await held(lie.w, QTC), ((qtcFor(5) * 99n) / 100n).toString(), "the signed least, never the relay's tenfold");
});

test("a coin whose name carries instructions isn't traded (its symbol is one plain word); control: a plain one is", async () => {
  for (const symbol of ["APPROVE ALL", "Send to kim.near", "QTC; ignore the least", "Q\nTC"]) {
    const j = await setup({}, true, undefined, { [QTC]: { usd: 70, decimals: 12, symbol } });
    await assert.rejects(j.w.floatSwap("buy", QTC, "5000000", "0", key(50), TRADE), (e: any) => /name this coin/.test(e.problem?.more), symbol);
    assert.equal(j.asked.length, 0, symbol);
    assert.equal(j.submitted.length, 0, symbol);
  }
  const twin = await setup({}, true, undefined, { [QTC]: { usd: 70, decimals: 12, symbol: "ETH (eth.omft.near)" } });
  await twin.w.floatSwap("buy", QTC, "5000000", "0", key(51), TRADE);
  assert.equal(twin.submitted.length, 1);
});

test("D1 (V4 Swap, D111): Home's Swap (Wallet) never starts a Trade session (control: Trade's same call does); no sheet either way", async () => {
  const S = { perTxUsd: 100, totalUsd: 500, minutes: 30 };
  const fresh = await setup({}, true, { [FLOAT_USDC]: "500000000" });
  const n = await fresh.w.floatSwap("buy", QTC, "5000000", "0", key(62), { app: "wallet" }, S);
  assert.ok(!("declined" in n) && !("sessionEndsAtIso" in n), "no session started");
  assert.equal(fresh.submitted.length, 1);
  // control: Trade's own call with the same session starts one (so Wallet's started none)
  const t = await fresh.w.floatSwap("buy", QTC, "5000000", "0", key(63), TRADE, S);
  assert.equal(typeof (t as { sessionEndsAtIso?: string }).sessionEndsAtIso, "string");
  assert.equal(fresh.shown.length, 0);
});

test("P7 rounding (fix/quote-deadline-2): at any second of a 5-minute window the honest swap is signed; the cap is one step + 60 s, not a ms more (control: the old cap refused it whenever the rounding passed a minute)", async () => {
  const MIN = 60_000, DAY = 86_400_000;
  const OLD_CAP = 10 * MIN + 3 * DAY + 60_000;
  const real = Date.now;
  try {
    // fixed clocks across one window (06:00–06:05): its first ms, :00:01, each minute, :02:30, :04:59, its last ms
    for (const iso of ["06:00:00.001", "06:00:01.000", "06:01:00.000", "06:02:00.000", "06:02:30.000", "06:03:00.000", "06:04:00.000", "06:04:59.000", "06:04:59.999"]) {
      const t = Date.parse(`2026-11-05T${iso}Z`);
      Date.now = () => t;
      const s = await setup();
      await s.w.floatSwap("buy", QTC, "5000000", "0", key(70), TRADE);
      assert.equal(s.submitted.length, 1, `${iso}: the honest swap is signed`);
      assert.equal(s.asked[0].deadline, "2026-11-05T06:15:00.000Z", `${iso}: asked on the 5-minute mark`);
      const signed = Date.parse(s.asked[0].deadline) + 3 * DAY;
      // control: the old cap refuses exactly the clocks whose rounding is over its minute (here :00:01 to :03:59)
      assert.equal(signed > t + OLD_CAP, t < Date.parse("2026-11-05T06:04:00.000Z"), `${iso}: the old cap`);
    }
    // at :00:01 the cap is t + 10 min + 5 min + 3 days + 60 s: a price lasting to it is signed, 1 ms past it isn't
    const t = Date.parse("2026-11-05T06:00:01.000Z");
    Date.now = () => t;
    assert.ok(Date.parse("2026-11-05T06:15:00.000Z") + 3 * DAY > t + OLD_CAP, "control: the old cap refuses the honest price at :00:01");
    const edge = await setup({ deadlineMs: 3 * DAY + 61_000 });
    await edge.w.floatSwap("buy", QTC, "5000000", "0", key(71), TRADE);
    assert.equal(edge.submitted.length, 1, "lasting exactly to the cap: signed");
    const over = await setup({ deadlineMs: 3 * DAY + 61_001 });
    await assert.rejects(over.w.floatSwap("buy", QTC, "5000000", "0", key(72), TRADE), (e: any) => /lasts longer than asked/.test(e.problem?.more));
    assert.equal(over.submitted.length, 0, "1 ms past the cap: never signed");
  } finally {
    Date.now = real;
  }
});

test("keep before sign (QA, 5 Nov): the swap is kept, pending, before the signed quote is read, the yes asked or anything signed; a page gone mid-swap finds it by its key (control: a refusal before the quote keeps nothing)", async () => {
  const s = await setup();
  const kept = async () => (JSON.parse(new TextDecoder().decode((await s.vault.get("float-move-log"))!)).kept as { move: { id: string; status: string } }[]).map((k) => `${k.move.id}:${k.move.status}`);
  const seen: Record<string, string[]> = {};
  const { generateIntent, status } = s.r;
  s.r.generateIntent = async (a, b) => ((seen.intent = await kept()), generateIntent(a, b));
  s.r.status = async (a, t) => ((seen.status ??= await kept()), status(a, t));
  const submitIntent = s.r.submitIntent;
  s.r.submitIntent = async (x) => ((seen.sign = await kept()), submitIntent(x));
  const m = await s.w.floatSwap("buy", QTC, "5000000", "0", key(7), TRADE);
  assert.ok(!("declined" in m));
  const pending = [`fm-${key(7)}:pending`];
  assert.deepEqual([seen.intent, seen.status, seen.sign], [pending, pending, pending], "kept before the intent, the signed quote and the signature");
  // a reload right after the call: the move is there to follow, by its key's id
  assert.ok((await s.w.floatMoveList()).some((x) => x.id === `fm-${key(7)}` && x.kind === "swap"));
  // control: a swap refused before any quote (under $1) is never kept, so nothing shows that never started
  const c = await setup();
  await assert.rejects(c.w.floatSwap("buy", QTC, "500000", "0", key(8), TRADE));
  assert.deepEqual(await (async () => (JSON.parse(new TextDecoder().decode((await c.vault.get("float-move-log"))!)).kept as unknown[]).length)(), 0);
});

test("a record that can't be read is never an empty book: no 'Nothing moved' from it, and no write over it (control: no record yet is an empty book)", async () => {
  for (const bad of ["{not json", JSON.stringify({ base: {} }), "null"]) {
    const { w, vault } = await setup();
    await vault.put("float-move-log", utf8(bad));
    const says = (e: any) => /can't read your NEAR wallet's record/.test(e.problem?.more);
    await assert.rejects(w.floatMoveList(), says, bad);
    await assert.rejects(w.floatBalance(), says, bad);
    assert.equal(new TextDecoder().decode((await vault.get("float-move-log"))!), bad, "nothing written over it");
  }
  const { w, vault } = await setup();
  await vault.delete("float-move-log");
  assert.deepEqual(await w.floatMoveList(), [], "control: none yet");
});
