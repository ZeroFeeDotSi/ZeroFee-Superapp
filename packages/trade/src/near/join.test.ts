// The joins, tested against the REAL core (oversight review, 2 Nov): Trade's service and NEAR engine on one side, the
// core's own SubWallets and FloatMoves on the other (no MockBridge, which copies the core's rules), and only 1Click faked
// at the core's relay, in the recorded shape (signed quotes, its deadline the asked one + 3 days). The price moves between
// the Buy sheet and the tap, as it does on mainnet.
//   join 1, Trade ↔ core: subwallet.float.balance / swapQuote / swap / move through a bridge to the core's own methods.
//   join 2, core ↔ 1Click: the relay's quote, generate-intent, status (signed) and submit-intent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { FLOAT_USDC, type FloatRelay } from "@zerofee/core/float-moves";
import { SubWallets } from "@zerofee/core/subwallets";
import { MemoryVault } from "@zerofee/core/vault";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import { base64, utf8 } from "@zerofee/core/sol/bytes";
import { createTradeService } from "../service.ts";
import { createNearEngine } from "./engine.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const QTC = "qtc.omft.near", TOKEN = `nep141:${QTC}`;

/** 1Click at the core's relay, with a price the test moves: `px` dollars a QTC (12 places), 0.3 % spread, 1 % slippage. */
function oneClick(o: { inflate?: number } = {}) {
  /** `hold`: 1Click takes the signed transfer but hasn't settled it yet (a slow fill, or the phone off line meanwhile). */
  const ctl = { hold: false, zero: false };
  const state = { px: 70 };
  const quotes = new Map<string, { req: any; out: bigint; deadline: string }>();
  let n = 0, last = "";
  /** A deposit 1Click has the signed transfer for: it settles at once (SUCCESS); before that it waits (PENDING_DEPOSIT). */
  const paid = new Set<string>();
  const outOf = (req: any): bigint => (req.originAsset === FLOAT_USDC
    ? BigInt(Math.floor(((Number(req.amount) / 1e6) * 0.997 / state.px) * 1e12))
    : BigInt(Math.floor((Number(req.amount) / 1e12) * state.px * 0.997 * 1e6)));
  const relay: FloatRelay = {
    quote: async (req) => {
      const out = !req.dry && ctl.zero ? 0n : outOf(req);
      if (req.dry) return { quote: { amountIn: req.amount, amountOut: out.toString(), minAmountOut: ((out * 99n) / 100n).toString() } };
      const depositAddress = (++n).toString(16).padStart(64, "d");
      quotes.set(depositAddress, { req, out, deadline: new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString() });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: out.toString() }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      last = depositAddress;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async () => (paid.add(last), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const signed = signedQuote({ quoteRequest: q.req, quote: { depositAddress, amountIn: q.req.amount, amountOut: q.out.toString(), minAmountOut: ((q.out * 99n) / 100n).toString(), deadline: q.deadline } });
      // a relay that lies about what arrived (unsigned): `inflate` times the signed amount out
      if (!paid.has(depositAddress) || ctl.hold) return { status: "PENDING_DEPOSIT", quoteResponse: signed };
      return { status: "SUCCESS", quoteResponse: signed, swapDetails: { amountOut: (q.out * BigInt(o.inflate ?? 1)).toString() } };
    },
  };
  return { relay, state, ctl };
}

/** The real core's SubWallets with $50 of USDC in Spending, a bridge to it as the app gets one (app "trade"), and Trade's service on it. */
async function joined(o: { inflate?: number; answer?: boolean; vault?: MemoryVault; store?: Map<string, string>; fake?: ReturnType<typeof oneClick>; now?: () => number; heldQtc?: string; slippageBps?: number } = {}) {
  const fake = o.fake ?? oneClick(o);
  const vault = o.vault ?? new MemoryVault();
  const sheets: string[] = [], lines: string[][] = [];
  const core = new SubWallets({
    vault, sol: {} as never, evm: {} as never, floatRelay: fake.relay, mainAccount: async () => "kim.near",
    usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600),
    tokenPrice: async (t) => (t === TOKEN ? { usd: fake.state.px, decimals: 12, symbol: "QTC" } : null),
    approve: async (w) => (sheets.push(w.title), lines.push(w.lines), o.answer ?? true), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
  });
  await core.create("trade", "near");
  if (!(await vault.get("float-move-log"))) await vault.put("float-move-log", utf8(JSON.stringify({ base: { [FLOAT_USDC]: "50000000", ...(o.heldQtc ? { [TOKEN]: o.heldQtc } : {}) }, kept: [] })));
  const store = o.store ?? new Map<string, string>();
  if (o.slippageBps !== undefined) store.set("trade.slippage", JSON.stringify(o.slippageBps));
  // the engine's own clock, moved by its waits (a slow fill is 60 s of its time, not of the test's)
  let clock = Date.now();
  const by = { app: "trade" };
  const route: Record<string, (p: any) => Promise<unknown>> = {
    "subwallet.list": async () => core.list(),
    "subwallet.float.balance": async () => core.floatBalance(),
    "subwallet.float.swapQuote": async (p) => core.floatSwapQuote(p.side, p.coin, p.amount),
    "subwallet.float.swap": async (p) => core.floatSwap(p.side, p.coin, p.amount, p.atLeast, p.key, by, p.session),
    "subwallet.float.move": async (p) => core.floatMove(p.id),
    "subwallet.session.start": async (p) => core.tradeSessionStart(p.perTxUsd, p.totalUsd, p.minutes, p.why, "Trade"),
    "device.store.get": async (p) => ({ value: store.get(p.key) ?? null }),
    "device.store.set": async (p) => (store.set(p.key, p.value), {}),
  };
  const bridge: Bridge = {
    call: async <T,>(m: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> => {
      const f = route[m];
      if (!f) return { problem: { code: "security.method.unknown", whatHappened: m, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } as Problem };
      try { return { ok: (await f(p)) as T }; } catch (e) { if (e instanceof ProblemError) return { problem: e.problem }; throw e; }
    },
    on: () => () => {},
  } as unknown as Bridge;
  const call = async <T,>(m: string, p: Record<string, unknown>): Promise<T> => { const r = await bridge.call<T>(m, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const svc = createTradeService({
    bridge, chains: [], nativeUsd: async () => 1, displayUsd: async () => 1,
    meta: async () => ({ symbol: "QTC", decimals: 12, priceUsd: fake.state.px, pools: [{ address: "nep141:a___nep141:b", dex: "near-intents" }] }),
    engineFor: (chain, owner) => { if (chain !== "near") throw new Error("NEAR only here"); return createNearEngine({ owner, call, meta: async () => ({ symbol: "QTC", decimals: 12, priceUsd: fake.state.px, pools: [{ address: "nep141:a___nep141:b", dex: "near-intents" }] }), now: () => clock, sleep: async (ms) => { clock += ms; } }); },
    sleep: async () => {},
    ...(o.now ? { now: o.now } : {}),
  });
  const held = async () => BigInt((await core.floatBalance()).tokens.find((t) => t.tokenId === TOKEN)?.amount ?? "0");
  return { svc, core, fake, sheets, lines, held, vault, store };
}

test("join: the price dips 1 % between the Buy sheet and the tap: it still fills, at no less than the sheet's least", async () => {
  const j = await joined();
  const p = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  j.fake.state.px = 70 * 1.01;                                       // QTC dearer: fewer coins for the same $5
  const rec = await j.svc.trade(p);
  assert.equal(rec.status, "done");
  assert.ok(BigInt(rec.fill!.got) >= BigInt(p.quote.getMinRaw), `got ${rec.fill!.got}, the sheet said at least ${p.quote.getMinRaw}`);
  assert.equal(rec.fill!.got, (await j.held()).toString(), "booked what the core holds");
  assert.equal(j.sheets.length, 0, "no sheet (D143: the NEAR wallet's swap never asks)");
  assert.ok(await j.svc.sessionEndsAt("near"), "the swap started Trade's session too");
});

test("join: a bigger dip refuses with the named line, nothing moved", async () => {
  const j = await joined();
  const p = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  j.fake.state.px = 70 * 1.06;
  await assert.rejects(j.svc.trade(p), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.price" && /NEAR Intents/.test(e.problem.whatHappened) && e.problem.money.state === "safe");
  assert.equal(await j.held(), 0n);
  assert.equal((await j.core.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount, "50000000", "Trading's cash as it was");
});

test("join: a relay claiming ten times the coins: the position books the core's clamped figure, P&L stays honest", async () => {
  const j = await joined({ inflate: 10 });
  const p = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  const rec = await j.svc.trade(p);
  const core = await j.held();
  assert.ok(core <= (BigInt(p.quote.getRaw) * 105n) / 100n, "the core never counts more than 1Click signed (+5 %)");
  assert.equal(rec.fill!.got, core.toString());
  const pos = (await j.svc.positions()).find((x) => x.coin === QTC)!;
  assert.equal(pos.raw, core.toString());
  assert.ok(pos.pnlUsd! < 0.1, `no fake gain: ${pos.pnlUsd}`);
});

test("join: a full sale back to Spending leaves no position and books the result in dollars", async () => {
  const j = await joined({ inflate: 10 });
  await j.svc.trade(await j.svc.quote("buy", "near", QTC, { usd: 5 }));
  const sale = await j.svc.quote("sell", "near", QTC, { fraction: 1 });
  const rec = await j.svc.trade(sale);
  assert.equal(rec.status, "done");
  assert.equal(await j.held(), 0n);
  assert.equal((await j.svc.positions()).filter((x) => x.coin === QTC && BigInt(x.raw) > 0n).length, 0, "no ghost position");
  assert.ok(rec.amountUsd > 4.8 && rec.amountUsd < 5, `sold for $${rec.amountUsd}`);
});

test("join: the price falls between sheet and tap: more coins, never less than the sheet said", async () => {
  const j = await joined();
  const p = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  j.fake.state.px = 70 * 0.97;
  const rec = await j.svc.trade(p);
  assert.equal(rec.status, "done");
  assert.ok(BigInt(rec.fill!.got) > BigInt(p.quote.getRaw), "more than the sheet's estimate");
});

test("join: amounts: under $1 refused, more than Spending's cash refused (Top up), all of the cash buys exactly that", async () => {
  const j = await joined();
  await assert.rejects(j.svc.quote("buy", "near", QTC, { usd: 60 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.short" && /\$50\.00/.test(e.problem.whatHappened));
  const tiny = await j.svc.quote("buy", "near", QTC, { usd: 0.5 });
  await assert.rejects(j.svc.trade(tiny), (e: unknown) => e instanceof ProblemError && e.problem.money.state === "safe");
  const all = await j.svc.quote("buy", "near", QTC, { max: true });
  assert.equal(all.quote.payRaw, "50000000");
  assert.equal((await j.svc.trade(all)).status, "done");
  assert.equal((await j.core.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount ?? "0", "0");
});

test("join (D143): a NEAR wallet swap never asks: someone who'd say no on a sheet is never shown one, and the swap goes", async () => {
  const j = await joined({ answer: false });
  const rec = await j.svc.trade(await j.svc.quote("buy", "near", QTC, { usd: 5 }));
  assert.equal(rec.status, "done");
  assert.equal(j.sheets.length, 0, "no sheet");
  assert.ok((await j.held()) > 0n, "the coin is in the NEAR wallet");
  assert.equal(typeof rec.filledInMs, "number", "no sheet in between: the wait from the tap is said");
});

test("join: a quote left past its time is priced again at the tap, and goes only if its least is still the sheet's", async () => {
  let t = Date.now();
  const j = await joined({ now: () => t });
  const p = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  t += 60_000;                                                         // the sheet sat open a minute
  const rec = await j.svc.trade(p);
  assert.equal(rec.status, "done");
  assert.ok(BigInt(rec.fill!.got) >= BigInt(p.quote.getMinRaw));
  const q = await j.svc.quote("buy", "near", QTC, { usd: 5 });
  t += 60_000; j.fake.state.px = 70 * 1.05;                             // and the price ran away meanwhile
  await assert.rejects(j.svc.trade(q), (e: unknown) => e instanceof ProblemError && /moved|too far/.test(e.problem.whatHappened));
});

test("join: off line or closed mid-flow: 1Click still finishing is 'unconfirmed'; the next open (cold start) finds it by its move and books it, never a second swap", async () => {
  const fake = oneClick();
  const vault = new MemoryVault(), store = new Map<string, string>();
  const a = await joined({ fake, vault, store });
  fake.ctl.hold = true;                                                // signed and handed over, then nothing comes back
  await assert.rejects(a.svc.trade(await a.svc.quote("buy", "near", QTC, { usd: 5 })), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.near.slow" && e.problem.money.state === "on-the-way");
  const swaps0 = (await a.core.floatMoveList()).filter((m) => m.kind === "swap").length;
  fake.ctl.hold = false;                                               // 1Click finished while the app was closed
  const b = await joined({ fake, vault, store });                      // a cold start on the same phone
  await b.svc.resume();
  const rec = (await b.svc.activity()).find((r) => r.chain === "near")!;
  assert.equal(rec.status, "done");
  assert.equal(rec.fill!.got, (await b.held()).toString());
  assert.equal((await b.core.floatMoveList()).filter((m) => m.kind === "swap").length, swaps0, "no second swap");
});

test("join (review M2): the position is what Spending holds of the coin by the core's own count, coins it held before included", async () => {
  const j = await joined({ heldQtc: "1000000000" });                  // 0.001 QTC already in Trading (a refund, an earlier trade)
  const rec = await j.svc.trade(await j.svc.quote("buy", "near", QTC, { usd: 5 }));
  assert.equal(rec.fill!.coinAfter, (await j.held()).toString(), "the core's count after the buy");
  const pos = (await j.svc.positions()).find((x) => x.coin === QTC)!;
  assert.equal(pos.raw, (await j.held()).toString(), "every QTC Trading holds, so Sell all sells it all");
});

test("join (review M1): a 2 % limit in Settings still trades NEAR coins, the least at 2 %; under 1Click's own 1 % it says so", async () => {
  const two = await joined({ slippageBps: 200 });
  const p = await two.svc.quote("buy", "near", QTC, { usd: 5 });
  assert.equal(p.quote.slippageBps, 200);
  assert.equal(p.quote.getMinRaw, ((BigInt(p.quote.getRaw) * 9800n) / 10000n).toString());
  two.fake.state.px = 70 * 1.005;
  assert.equal((await two.svc.trade(p)).status, "done");
  const half = await joined({ slippageBps: 50 });
  await assert.rejects(half.svc.quote("buy", "near", QTC, { usd: 5 }), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.slippage.over");
});

/** QTC worth `usd` at the fake's $70 a QTC (12 places), as Spending's count holds it. */
const qtcWorth = (usd: number) => BigInt(Math.round((usd / 70) * 1e12)).toString();
const cash = async (j: Awaited<ReturnType<typeof joined>>) => BigInt((await j.core.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount ?? "0");

test("join: a $0.90 whole position sells all: never stuck under the $1 floor, and Trade's sheet says most of it goes on fees", async () => {
  const j = await joined({ heldQtc: qtcWorth(0.9) });
  const sale = await j.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(sale.quote.payRaw, qtcWorth(0.9), "all of it");
  assert.equal(sale.quote.mostlyFees, true, "Trade's sheet says the fees line");
  const rec = await j.svc.trade(sale);
  assert.equal(rec.status, "done");
  assert.equal(await j.held(), 0n, "no coin left behind");
  assert.ok((await cash(j)) > 50_850_000n, "about $0.89 back in Trading's cash");
  assert.equal(j.sheets.length, 0, "no sheet of the core's (D143): Trade's own sheet is where the fees line is");
});

test("join: a partial sell under $1 still refuses by name, nothing moved; a whole one at $1 or more has no fees line", async () => {
  const j = await joined({ heldQtc: qtcWorth(1.8) });
  const half = await j.svc.quote("sell", "near", QTC, { fraction: 0.5 });
  assert.equal(half.quote.mostlyFees, undefined, "a part of a coin is never the small-sale case");
  await assert.rejects(j.svc.trade(half), (e: unknown) => e instanceof ProblemError && e.problem.code === "security.request.not-allowed" && /under \$1 would mostly go on fees/.test(e.problem.more ?? "") && e.problem.money.state === "safe");
  assert.equal(await j.held(), BigInt(qtcWorth(1.8)), "the coin as it was");
  assert.equal(await cash(j), 50_000_000n, "Trading's cash as it was");
  assert.equal(j.sheets.length, 0, "refused before any sheet");
  const all = await j.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(all.quote.mostlyFees, undefined, "$1.80: no fees line");
  assert.equal((await j.svc.trade(all)).status, "done");
  assert.equal(j.sheets.length, 0, "no sheet (D143)");
  assert.equal(await j.held(), 0n);
});

test("join: break rows of a small whole sale: the least ($0.05) and a $1 buy's whole coin both sell", async () => {
  const dust = await joined({ heldQtc: qtcWorth(0.05) });
  assert.equal((await dust.svc.trade(await dust.svc.quote("sell", "near", QTC, { fraction: 1 }))).status, "done");
  assert.equal(await dust.held(), 0n);
  // the finding itself: a $1 buy (worth a little under $1 once bought) sold back with Sell all
  const one = await joined();
  assert.equal((await one.svc.trade(await one.svc.quote("buy", "near", QTC, { usd: 1 }))).status, "done");
  const back = await one.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(back.quote.mostlyFees, true);
  assert.equal((await one.svc.trade(back)).status, "done");
  assert.equal(await one.held(), 0n, "nothing stuck");
});

test("review Low 2 (D143): inside an open Trade session a whole sale under $1 goes with no sheet, the fees line on Trade's own sheet; $1.80 has none", async () => {
  const j = await joined({ heldQtc: qtcWorth(0.9) });
  await j.core.tradeSessionStart(25, 100, 30, undefined, "Trade");
  const sale = await j.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(sale.quote.mostlyFees, true, "Trade's sheet says most of it goes on fees");
  assert.equal((await j.svc.trade(sale)).status, "done");
  assert.deepEqual([j.sheets.length, await j.held()], [0, 0n], "no sheet; nothing left behind");
  // control: a whole sale of $1.80 inside the same kind of session: no fees line, and no sheet either
  const k = await joined({ heldQtc: qtcWorth(1.8) });
  await k.core.tradeSessionStart(25, 100, 30, undefined, "Trade");
  const big = await k.svc.quote("sell", "near", QTC, { fraction: 1 });
  assert.equal(big.quote.mostlyFees, undefined);
  assert.equal((await k.svc.trade(big)).status, "done");
  assert.equal(k.sheets.length, 0);
});

test("review Low 1: a whole sale whose fair floor rounds to nothing still needs something back: a quote paying 0 is refused, the coin stays", async () => {
  const j = await joined({ heldQtc: qtcWorth(0.05) });
  j.fake.ctl.zero = true; // 1Click's real quote pays nothing back
  await assert.rejects(j.core.floatSwap("sell", TOKEN, qtcWorth(0.05), "0", "zero-quote-test-0001", { app: "trade" }), (e: unknown) => e instanceof ProblemError && e.problem.code === "security.subwallet.refused");
  assert.equal(await j.held(), BigInt(qtcWorth(0.05)), "the coin as it was");
  assert.equal(await cash(j), 50_000_000n);
});
