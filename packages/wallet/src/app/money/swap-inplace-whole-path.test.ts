// Home's Swap in place on the phone, whole path from the sheet's own calls. The sheet's route and units and runInplaceJob run
// into the REAL core's door (SubWallets and its FloatMoves), which asks the relay itself, reads back what 1Click SIGNED, signs
// ONE intent with the NEAR wallet's own key, and follows the move. Never MockBridge. The only fakes are the relay and the count
// of what the NEAR wallet holds. demo-core.test.ts holds which apps may call this door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Bridge } from "@zerofee/core/bridge";
import type { FloatRelay } from "@zerofee/core/float-moves";
import { nep413Hash } from "@zerofee/core/private-pocket";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import { base64, fromBase58, utf8 } from "@zerofee/core/sol/bytes";
import { SubWallets } from "@zerofee/core/subwallets";
import { MemoryVault } from "@zerofee/core/vault";
import { NEAR_CASH, nearOwnCoins } from "../near-coins.ts";
import type { PickCoin } from "./coin-pick.ts";
import { coinRoute, NEAR_IN_WALLET, type CoinRoute } from "./swap-coins.ts";
import { inplaceUnits, nearCash, nearHeldRows, resumeInplace, runInplaceJob, INPLACE_WORDS, type InplaceQuote, type InplaceRoute } from "./swap-inplace.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const WNEAR = "nep141:wrap.near";
const LIST = { symbol: "NEAR", decimals: 24, priceUsd: "4.43" };
/** What a buy of `amount` (USDC units) gets: NEAR at $4.43, 24 places, less 0.3 %. */
const buyOut = (amount: string) => ((BigInt(amount) * 10n ** 18n * 997n) / 4430n).toString();
/** What a sale of `amount` (NEAR units) gets, in USDC units, less 0.3 %. */
const sellOut = (amount: string) => ((BigInt(amount) * 4430n * 997n) / 10n ** 24n).toString();
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const key = (n: number) => `home-swap-${String(n).padStart(12, "0")}`;

async function phone(held: Record<string, string> = { [NEAR_CASH]: "50000000" }) {
  const asked: Record<string, any>[] = [];
  const submitted: { signature: string; payload: unknown }[] = [];
  const sheets: unknown[] = [];
  const quotes = new Map<string, { req: Record<string, any>; deadline: string }>();
  let state = "PENDING_DEPOSIT";
  const out = (req: Record<string, any>) => (req.originAsset === NEAR_CASH ? buyOut(req.amount) : sellOut(req.amount));
  const least = (req: Record<string, any>) => ((BigInt(out(req)) * 99n) / 100n).toString();
  const relay: FloatRelay = {
    quote: async (req: Record<string, any>) => {
      asked.push(req);
      if (req.dry) return { quote: { amountIn: req.amount, amountOut: out(req), minAmountOut: least(req), timeEstimate: 2 } };
      const depositAddress = (asked.length.toString(16) + "d".repeat(64)).slice(0, 64);
      const deadline = new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: out(req), deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId: string, depositAddress: string) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed: { signature: string; payload: unknown }) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress: string) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const signed = signedQuote({ quoteRequest: q.req, quote: { depositAddress, amountIn: q.req.amount, amountOut: out(q.req), minAmountOut: least(q.req), deadline: q.deadline } }, new Date(Date.now()).toISOString());
      return { status: state, quoteResponse: signed, swapDetails: { amountOut: out(q.req) } };
    },
  } as unknown as FloatRelay;
  const vault = new MemoryVault();
  const w = new SubWallets({
    vault, sol: {} as never, evm: {} as never, floatRelay: relay, mainAccount: async () => "kim.near",
    usdPrice: async () => 150, tokenPrice: async (t: string) => (t === WNEAR ? { usd: 4.43, decimals: 24, symbol: "NEAR" } : null),
    approve: async (words: unknown) => (sheets.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
  } as never);
  const float = await w.create("trade", "near");
  await vault.put("float-move-log", utf8(JSON.stringify({ base: held, kept: [] })));
  // the calls the sheet and the job make, as the core's door answers them to Wallet
  const answer = async (fn: () => Promise<unknown>) => { try { return { ok: await fn() }; } catch (e) { return { problem: (e as { problem?: unknown }).problem ?? { code: "x", whatHappened: String(e) } }; } };
  const bridge = {
    call: (method: string, p: Record<string, any> = {}) => answer(() => {
      switch (method) {
        case "subwallet.float.balance": return w.floatBalance();
        case "subwallet.float.swapQuote": return w.floatSwapQuote(p.side, p.coin, p.amount);
        case "subwallet.float.swap": return w.floatSwap(p.side, p.coin, p.amount, p.atLeast, p.key, { app: "wallet" });
        case "subwallet.float.move": return w.floatMove(p.id);
        case "subwallet.float.moves": return w.floatMoveList();
        default: throw new Error(`the path called ${method}`);
      }
    }),
  } as unknown as Bridge;
  return { bridge, asked, submitted, sheets, vault, near: float.address, set: (s: string) => (state = s) };
}

const CASH: PickCoin = { chain: "near", address: "near", symbol: "USDC", name: "Your NEAR wallet", place: "near" };
const inplace = (r: CoinRoute | { why: string }): InplaceRoute => { assert.ok("kind" in r && r.kind === "inplace", JSON.stringify(r)); return r as InplaceRoute; };
const never = () => false;
const tokensOf = async (b: Bridge) => { const r = await b.call<{ tokens: { tokenId: string; amount: string }[] }>("subwallet.float.balance"); assert.ok("ok" in r); return r.ok.tokens; };

test("the phone's Swap in place, whole path: the sheet's route, the core's dry price, one tap: ONE intent by the NEAR wallet's own key, no sheet, followed to its end, the coin in the balance", async () => {
  const e = await phone();
  const route = inplace(coinRoute(CASH, NEAR_IN_WALLET, never));
  assert.deepEqual(route, { kind: "inplace", source: "private", side: "buy", coin: WNEAR });
  const cash = nearCash(await tokensOf(e.bridge))!;
  assert.deepEqual(cash, { usd: 50, raw: "50000000" }, "the cash's one figure");
  const units = inplaceUnits("buy", 10, false, undefined, cash.raw)!;
  const dry = await e.bridge.call<InplaceQuote>("subwallet.float.swapQuote", { side: route.side, coin: route.coin, amount: units });
  assert.ok("ok" in dry, JSON.stringify(dry));
  assert.equal(e.submitted.length, 0, "a price signs nothing");
  const views: string[] = [];
  const result = await runInplaceJob({ bridge: e.bridge, tasks: undefined, rowId: `swap:${key(1)}`, route, units, q: dry.ok, key: key(1), tapMs: Date.now(), sleep: async () => { e.set("SUCCESS"); }, onView: (v) => views.push(v.state) });
  assert.equal(result, "done");
  assert.deepEqual(views, ["done"]);
  const real = e.asked.filter((q) => !q.dry);
  assert.equal(real.length, 1);
  assert.deepEqual([real[0]!.originAsset, real[0]!.depositType, real[0]!.destinationAsset, real[0]!.recipient, real[0]!.recipientType, real[0]!.refundTo, real[0]!.refundType], [NEAR_CASH, "CONFIDENTIAL_INTENTS", WNEAR, e.near, "CONFIDENTIAL_INTENTS", e.near, "CONFIDENTIAL_INTENTS"]);
  assert.equal(e.submitted.length, 1, "one signed intent");
  const s = e.submitted[0]!;
  assert.ok(ed25519.verify(fromBase58(s.signature.slice(8)), nep413Hash(s.payload as never), fromHex(e.near)), "signed by the NEAR wallet's own key");
  assert.equal(e.sheets.length, 0, "a hot key: no sheet");
  // the coin persists: in the balance Home reads, the move in the list Activity reads
  const after = await tokensOf(e.bridge);
  assert.equal(after.find((t) => t.tokenId === NEAR_CASH)?.amount, "40000000");
  assert.equal(nearOwnCoins(after, () => LIST).length, 1, "Home's row for it");
  assert.equal(nearHeldRows(after, () => LIST).length, 1, "and You pay's: it can be sold");
  const moves = await e.bridge.call<{ id: string; kind: string; status: string }[]>("subwallet.float.moves");
  assert.ok("ok" in moves && moves.ok.some((m) => m.id === `fm-${key(1)}` && m.kind === "swap" && m.status === "done"));
});

test("the phone's Swap in place, whole path: Max is every unit of the cash; a reload ends the job on the core's move; the coin sells whole back to cash", async () => {
  const e = await phone({ [NEAR_CASH]: "27999999" });
  const route = inplace(coinRoute(CASH, NEAR_IN_WALLET, never));
  const units = inplaceUnits("buy", 27.99, true, undefined, "27999999")!;
  assert.equal(units, "27999999");
  const dry = await e.bridge.call<InplaceQuote>("subwallet.float.swapQuote", { side: "buy", coin: route.coin, amount: units });
  assert.ok("ok" in dry);
  // the page goes right after the tap: the core has the move by the tap's key; the new page has only the job's row
  const m = await e.bridge.call<{ id: string; status: string }>("subwallet.float.swap", { side: "buy", coin: route.coin, amount: units, atLeast: dry.ok.minAmountOut, key: key(2) });
  assert.ok("ok" in m && m.ok.status === "pending", JSON.stringify(m));
  const ends: [string, string][] = [];
  const tasks = { update: () => true, end: (id: string, s: string) => (ends.push([id, s]), true) } as never;
  e.set("SUCCESS");
  assert.equal(await resumeInplace({ bridge: e.bridge, tasks, pending: [{ id: `swap:${key(2)}`, steps: [{ label: INPLACE_WORDS.step }], startedAt: Date.now() }], sleep: async () => undefined }), 1);
  assert.deepEqual(ends, [[`swap:${key(2)}`, "done"]]);
  const after = await tokensOf(e.bridge);
  assert.ok(!after.some((t) => t.tokenId === NEAR_CASH && BigInt(t.amount) > 0n), "not a unit of cash stranded");
  // the sale: all of the coin, back into the cash, and it really goes
  const coin = after.find((t) => t.tokenId === WNEAR)!;
  const [row] = nearHeldRows(after, () => LIST);
  const back = inplace(coinRoute(row!, CASH, never));
  assert.deepEqual([back.side, back.coin], ["sell", WNEAR]);
  const whole = inplaceUnits("sell", row!.heldUsd!, true, row!.held)!;
  assert.equal(whole, coin.amount, "every unit");
  const dryBack = await e.bridge.call<InplaceQuote>("subwallet.float.swapQuote", { side: "sell", coin: back.coin, amount: whole });
  assert.ok("ok" in dryBack, JSON.stringify(dryBack));
  e.set("PENDING_DEPOSIT");
  assert.equal(await runInplaceJob({ bridge: e.bridge, tasks: undefined, rowId: `swap:${key(3)}`, route: back, units: whole, q: dryBack.ok, key: key(3), tapMs: Date.now(), sleep: async () => { e.set("SUCCESS"); } }), "done");
  assert.ok(!(await tokensOf(e.bridge)).some((t) => t.tokenId === WNEAR && BigInt(t.amount) > 0n), "none of the coin left");
});

test("audit, 6 Nov, the real core: its last keep after it handed the swap on throws; the job follows the move in its record, one intent, to its end", async () => {
  const e = await phone();
  const route = inplace(coinRoute(CASH, NEAR_IN_WALLET, never));
  const units = inplaceUnits("buy", 10, false, undefined, "50000000")!;
  const dry = await e.bridge.call<InplaceQuote>("subwallet.float.swapQuote", { side: route.side, coin: route.coin, amount: units });
  assert.ok("ok" in dry, JSON.stringify(dry));
  const put = e.vault.put.bind(e.vault);
  let full = true, threw = 0;
  e.vault.put = async (k: string, v: Uint8Array) => {
    if (full && e.submitted.length > 0) { threw++; throw new Error("the disk is full"); }
    return put(k, v);
  };
  const views: string[] = [];
  const result = await runInplaceJob({ bridge: e.bridge, tasks: undefined, rowId: `swap:${key(7)}`, route, units, q: dry.ok, key: key(7), tapMs: Date.now(), sleep: async () => { full = false; e.set("SUCCESS"); }, onView: (v) => views.push(v.state) });
  assert.ok(threw > 0, "the core's keep did throw");
  assert.equal(result, "done", "followed, never ended on the throw");
  assert.ok(!views.includes("failed"));
  assert.equal(new Set(e.submitted.map((s) => s.signature)).size, 1, "one signed intent, whatever was sent again");
});
