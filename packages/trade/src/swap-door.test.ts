// Home's Swap of a coin inside one wallet (swap-door.ts): every route kind, priced from a recorded Jupiter quote
// (sol/fixtures/jup-quote.json: 0.1 SOL → CARDS), with its controls. Only Wallet and the shell may ask; one tap is one
// swap; a coin → coin swap buys with the least its sale surely brought, and only after the sale landed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSwapDoor, SWAP_QUOTE_KEEP_MS } from "./swap-door.ts";
import { ProblemError } from "@zerofee/core/problem";
import type { Prepared, Quote, Amount, Side, ChainId } from "./types.ts";
import type { TradeRecord, TradeService } from "./service.ts";

const JUP = JSON.parse(readFileSync(new URL("./sol/fixtures/jup-quote.json", import.meta.url), "utf8")) as { inAmount: string; outAmount: string; otherAmountThreshold: string; swapUsdValue: string; outputMint: string; routePlan: { swapInfo: { label: string } }[] };
const CARDS = JUP.outputMint, BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SOL_USD = Number(JUP.swapUsdValue) / (Number(JUP.inAmount) / 1e9);

function fakeSvc(o: { failSell?: boolean | "unconfirmed"; refuse?: string; buyDrop?: number; refuseBuyAfter?: number; buyThrows?: "plain" | "safe" } = {}) {
  const asked: { side: Side; chain: ChainId; coin: string; amount: Amount }[] = [];
  const traded: string[] = [];
  const quoteOf = (side: Side, chain: ChainId, coin: string, amount: Amount): Quote => {
    // the recorded quote, scaled: a buy pays SOL for the coin, a sale the reverse at the same price
    const usd = "usd" in amount ? amount.usd : "raw" in amount ? (Number(amount.raw) / 1e9) * SOL_USD : 50;
    const per = Number(JUP.outAmount) / Number(JUP.inAmount);                       // coin units per lamport
    const lamports = BigInt(Math.round((usd / SOL_USD) * 1e9));
    const minShare = Number(JUP.otherAmountThreshold) / Number(JUP.outAmount);
    const getRaw = side === "buy" ? BigInt(Math.floor(Number(lamports) * per)) : lamports;
    return { side, chain, coin, symbol: coin === CARDS ? "CARDS" : "BONK", decimals: 6, payRaw: (side === "buy" ? lamports : BigInt(Math.floor(Number(lamports) * per))).toString(), payUsd: usd, getRaw: getRaw.toString(), getUsd: usd * 0.99, getMinRaw: BigInt(Math.floor(Number(getRaw) * minShare)).toString(), feeRaw: "5000", feeUsd: 0.001, route: JUP.routePlan[0]!.swapInfo.label === "Manifest" ? "Jupiter" : "Jupiter", slippageBps: 100, expiresAt: Date.now() + 20_000 } as Quote;
  };
  const svc = {
    async positions() { return [{ chain: "sol", coin: BONK, symbol: "BONK", decimals: 5, raw: "123400000", costUsd: 10, realizedUsd: 0, valueUsd: 12.34 }, { chain: "hood", coin: "0x" + "a".repeat(40), symbol: "X", decimals: 18, raw: "1", costUsd: 1, realizedUsd: 0 }, { chain: "sol", coin: CARDS, symbol: "CARDS", decimals: 6, raw: "0", costUsd: 0, realizedUsd: 0 }]; },
    async quote(side: Side, chain: ChainId, coin: string, amount: Amount): Promise<Prepared> {
      if (o.refuseBuyAfter !== undefined && side === "buy" && asked.filter((a) => a.side === "buy").length >= o.refuseBuyAfter) throw new ProblemError({ code: "trade.thin", whatHappened: "Too little CARDS trades right now.", money: { state: "safe", where: "in your wallet" }, next: { kind: "nothing", label: "Go back" } });
      if (o.refuse) throw new ProblemError({ code: "trade.thin", whatHappened: o.refuse, money: { state: "safe", where: "in your wallet" }, next: { kind: "nothing", label: "Go back" } });
      asked.push({ side, chain, coin, amount });
      const q = quoteOf(side, chain, coin, amount);
      // the price moving between the sheet and the tap: the buy's fresh floor this many units lower
      if (o.buyDrop && side === "buy" && asked.filter((a) => a.side === "buy").length > 1) q.getMinRaw = (BigInt(q.getMinRaw) - BigInt(o.buyDrop)).toString();
      return { key: `k${asked.length}`, at: Date.now(), quote: q, steps: [], ready: async () => undefined };
    },
    async trade(p: Prepared): Promise<TradeRecord> {
      traded.push(`${p.quote.side} ${p.quote.coin}`);
      if (o.buyThrows && p.quote.side === "buy") throw o.buyThrows === "plain" ? new Error("socket hang up") : new ProblemError({ code: "trade.refused", whatHappened: "Jupiter said no.", money: { state: "safe", where: "in your wallet" }, next: { kind: "nothing", label: "Go back" } });
      const status = o.failSell && p.quote.side === "sell" ? (o.failSell === "unconfirmed" ? "unconfirmed" : "failed") : "done";
      return { id: `r${traded.length}`, kind: p.quote.side, chain: p.quote.chain, coin: p.quote.coin, symbol: p.quote.symbol, status, amountUsd: p.quote.payUsd, hashes: [`h${traded.length}`], startedAt: 0, timing: { tapAt: 100, landedAt: 900 } } as TradeRecord;
    },
  } as unknown as TradeService;
  return { svc, asked, traded };
}

const door = (o: Parameters<typeof fakeSvc>[0] = {}, now = () => 1_000) => { const f = fakeSvc(o); let n = 0; return { ...f, d: createSwapDoor({ svc: () => f.svc, now, newId: () => `q${++n}` }) }; };

test("SOL → a coin (a buy) and a coin → SOL (a sale): one leg each, priced from the recorded Jupiter quote, at least its floor", async () => {
  const { d, asked, traded } = door();
  const buy = await d.call<{ id: string; legs: unknown[]; getMinRaw: string; getRaw: string; about: boolean; getSymbol: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: "native", get: CARDS, usd: 10 });
  assert.ok("ok" in buy);
  assert.deepEqual(buy.ok.legs, [{ side: "buy", route: "Jupiter", symbol: "CARDS" }]);
  assert.equal(buy.ok.about, false, "one leg: its own floor, 'at least'");
  assert.ok(BigInt(buy.ok.getMinRaw) < BigInt(buy.ok.getRaw) && BigInt(buy.ok.getMinRaw) > 0n);
  assert.equal(buy.ok.getSymbol, "CARDS");
  const sell = await d.call<{ legs: { side: string }[]; getSymbol: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: "native", all: true });
  assert.ok("ok" in sell);
  assert.equal(sell.ok.legs[0]!.side, "sell");
  assert.equal(sell.ok.getSymbol, "", "a sale gets the chain's own coin");
  assert.deepEqual(asked.map((a) => [a.side, a.coin, a.amount]), [["buy", CARDS, { usd: 10 }], ["sell", BONK, { fraction: 1 }]], "Max of a coin is all of it");
  const went = await d.call<{ legs: { status: string; hashes: string[]; landedMs: number }[] }>("spending.swap.go", { caller: "wallet", id: buy.ok.id });
  assert.ok("ok" in went);
  assert.deepEqual(went.ok.legs.map((l) => [l.status, l.hashes, l.landedMs]), [["done", ["h1"], 800]]);
  assert.deepEqual(traded, [`buy ${CARDS}`], "control: the sale's quote was never traded");
});

test("a coin → another coin: a sale, then a buy with the least the sale surely brought, only after it landed", async () => {
  const { d, asked, traded } = door();
  const q = await d.call<{ id: string; legs: { side: string }[]; about: boolean }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q);
  assert.deepEqual(q.ok.legs.map((l) => l.side), ["sell", "buy"]);
  assert.equal(q.ok.about, true, "two legs: 'about', priced again at the tap");
  const saleMin = asked[0] && (await (async () => (await fakeSvc().svc.quote("sell", "sol", BONK, { usd: 10 })).quote.getMinRaw)());
  assert.deepEqual(asked[1]!.amount, { raw: saleMin }, "the buy is sized at the sale's floor");
  const went = await d.call<{ legs: unknown[] }>("spending.swap.go", { caller: "wallet", id: q.ok.id });
  assert.ok("ok" in went);
  assert.deepEqual(traded, [`sell ${BONK}`, `buy ${CARDS}`]);
  assert.deepEqual(asked.at(-1)!.amount, { raw: saleMin }, "the tap's buy: the same floor, quoted fresh");
});

test("a sale that doesn't land buys nothing (control for the two-leg order)", async () => {
  const { d, traded } = door({ failSell: true });
  const q = await d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q);
  const went = await d.call<{ legs: { status: string }[] }>("spending.swap.go", { caller: "wallet", id: q.ok.id });
  assert.ok("ok" in went);
  assert.deepEqual(went.ok.legs.map((l) => l.status), ["failed"]);
  assert.deepEqual(traded, [`sell ${BONK}`]);
});

test("one tap, one swap: the same id twice goes once; an old id is refused with Try again", async () => {
  let t = 1_000;
  const { d, traded } = door({}, () => t);
  const q = await d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "hood", pay: "native", get: "0x" + "b".repeat(40), usd: 5 });
  assert.ok("ok" in q);
  assert.ok("ok" in (await d.call("spending.swap.go", { caller: "wallet", id: q.ok.id })));
  const again = await d.call("spending.swap.go", { caller: "wallet", id: q.ok.id });
  assert.ok("problem" in again && again.problem.code === "spending.swap.old" && again.problem.next.kind === "retry");
  assert.equal(traded.length, 1);
  const q2 = await d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "hood", pay: "native", get: "0x" + "b".repeat(40), usd: 5 });
  assert.ok("ok" in q2);
  t += SWAP_QUOTE_KEEP_MS + 1;
  await d.call("spending.swap.quote", { caller: "wallet", chain: "sol", pay: "native", get: CARDS, usd: 3 });   // sweeps
  assert.ok("problem" in (await d.call("spending.swap.go", { caller: "wallet", id: q2.ok.id })), "a quote past its keep is gone");
});

test("only Wallet and the shell ask; only Solana and Robinhood; real addresses; two different coins", async () => {
  const { d, traded } = door();
  for (const caller of ["browser", "social", "chat", "agent", "trade", "x"]) {
    const r = await d.call("spending.swap.quote", { caller, chain: "sol", pay: "native", get: CARDS, usd: 10 });
    assert.ok("problem" in r && /not-allowed/.test(r.problem.code), caller);
  }
  assert.ok("ok" in (await d.call("spending.swap.quote", { chain: "sol", pay: "native", get: CARDS, usd: 10 })), "control: the shell's own call names no caller");
  const bad = [
    { chain: "near", pay: "native", get: "usdt.tether-token.near", usd: 10 },
    { chain: "bsc", pay: "native", get: "0x" + "c".repeat(40), usd: 10 },
    { chain: "sol", pay: "native", get: "0x" + "c".repeat(40), usd: 10 },
    { chain: "hood", pay: "native", get: CARDS, usd: 10 },
    { chain: "sol", pay: "native", get: "native", usd: 10 },
    { chain: "sol", pay: BONK, get: BONK, usd: 10 },
    { chain: "sol", pay: "native", get: CARDS, usd: 0 },
    { chain: "sol", pay: "native", get: CARDS, usd: "ten" },
  ];
  for (const p of bad) { const r = await d.call("spending.swap.quote", { caller: "wallet", ...p }); assert.ok("problem" in r && /invalid/.test(r.problem.code), JSON.stringify(p)); }
  assert.ok("problem" in (await d.call("spending.swap.sell", { caller: "wallet" })), "a method not listed");
  assert.equal(traded.length, 0);
});

test("held: the chain's coins with a balance, their dollars when priced; an exchange's refusal comes back in its own words", async () => {
  const { d } = door();
  const h = await d.call<{ address: string; usd?: number }[]>("spending.swap.held", { caller: "wallet", chain: "sol" });
  assert.ok("ok" in h);
  assert.deepEqual(h.ok.map((x) => [x.address, x.usd]), [[BONK, 12.34]], "control: CARDS at 0 and Robinhood's coin are left out");
  const thin = door({ refuse: "Too little BONK trades to sell $10 now." }).d;
  const r = await thin.call("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: "native", usd: 10 });
  assert.ok("problem" in r && r.problem.whatHappened === "Too little BONK trades to sell $10 now.");
});

test("find: Trade's own market for the picker (a search, or trending with nothing typed), that chain's coins only, reads only", async () => {
  const asked: string[] = [];
  const row = (chain: string, i: number) => ({ chain, address: `${chain}${i}`, symbol: `C${i}`, name: `Coin ${i}`, logoUrl: i === 0 ? "https://x/l.png" : undefined, priceUsd: 1, liquidityUsd: 5 });
  const market = {
    search: async (q: string) => (asked.push(`search ${q}`), [row("hood", 0), ...Array.from({ length: 50 }, (_, i) => row("sol", i))]),
    trending: async (c?: string) => (asked.push(`trending ${c}`), [row(c ?? "sol", 0), row("bsc", 1)]),
  };
  const f = fakeSvc();
  const d = createSwapDoor(() => ({ svc: f.svc, market: market as never }));
  const s = await d.call<{ chain: string; logoUrl?: string; priceUsd?: number }[]>("spending.swap.find", { caller: "wallet", chain: "sol", q: "  bonk " });
  assert.ok("ok" in s);
  assert.equal(s.ok.length, 40, "at most FIND_MAX rows");
  assert.ok(s.ok.every((r) => r.chain === "sol" && !("priceUsd" in r)), "only Solana's, only what the picker draws");
  const t = await d.call<{ chain: string; logoUrl?: string }[]>("spending.swap.find", { caller: "wallet", chain: "hood", q: "" });
  assert.ok("ok" in t);
  assert.deepEqual(t.ok, [{ chain: "hood", address: "hood0", symbol: "C0", name: "Coin 0", logoUrl: "https://x/l.png" }]);
  assert.deepEqual(asked, ["search bonk", "trending hood"]);
  assert.ok("problem" in (await d.call("spending.swap.find", { caller: "browser", chain: "sol", q: "x" })), "control: only Wallet asks");
  assert.ok("problem" in (await d.call("spending.swap.find", { caller: "wallet", chain: "bsc", q: "x" })), "BNB isn't in the tray");
  assert.equal(f.traded.length, 0);
});

test("QA's MUST: a coin → coin buy whose fresh floor is under the one the sheet showed never goes; the sale stands, said", async () => {
  const { d, traded } = door({ buyDrop: 1 });
  const q = await d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q);
  const went = await d.call<{ legs: { status: string }[]; stopped?: { code: string; whatHappened: string } }>("spending.swap.go", { caller: "wallet", id: q.ok.id });
  assert.ok("ok" in went);
  assert.deepEqual(traded, [`sell ${BONK}`], "no second trade");
  assert.deepEqual(went.ok.legs.map((l) => l.status), ["done"], "leg 1 is said done");
  assert.deepEqual(went.ok.stopped, { code: "spending.swap.priceMoved", whatHappened: "The price moved. Your SOL is in your wallet." });
  const same = door({ buyDrop: 0 });
  const q2 = await same.d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q2);
  const ok = await same.d.call<{ stopped?: unknown }>("spending.swap.go", { caller: "wallet", id: q2.ok.id });
  assert.ok("ok" in ok && !ok.ok.stopped && same.traded.length === 2, "control: the same floor buys");
});

test("after a sale landed, a buy the exchange refuses is said with the sale standing; a sale still unconfirmed buys nothing", async () => {
  const r = door({ refuseBuyAfter: 1 });
  const q = await r.d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q);
  const went = await r.d.call<{ legs: unknown[]; stopped?: { whatHappened: string } }>("spending.swap.go", { caller: "wallet", id: q.ok.id });
  assert.ok("ok" in went && went.ok.legs.length === 1);
  assert.equal(went.ok.stopped?.whatHappened, "Too little CARDS trades right now. Your SOL is in your wallet.");
  const u = door({ failSell: "unconfirmed" });
  const q2 = await u.d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
  assert.ok("ok" in q2);
  const w2 = await u.d.call<{ legs: { status: string }[] }>("spending.swap.go", { caller: "wallet", id: q2.ok.id });
  assert.ok("ok" in w2);
  assert.deepEqual(w2.ok.legs.map((l) => l.status), ["unconfirmed"]);
  assert.deepEqual(u.traded, [`sell ${BONK}`], "nothing bought on a sale not yet confirmed");
});

test("QA's SHOULD: a throw from the buy's trade may come after it was sent, so it stays checking; only a 'safe' refusal says the SOL is in the wallet", async () => {
  const run = async (o: Parameters<typeof door>[0]) => {
    const x = door(o);
    const q = await x.d.call<{ id: string }>("spending.swap.quote", { caller: "wallet", chain: "sol", pay: BONK, get: CARDS, usd: 10 });
    assert.ok("ok" in q);
    const w = await x.d.call<{ legs: { side: string; status: string }[]; stopped?: { whatHappened: string } }>("spending.swap.go", { caller: "wallet", id: q.ok.id });
    assert.ok("ok" in w);
    return w.ok;
  };
  const plain = await run({ buyThrows: "plain" });
  assert.deepEqual([plain.legs.map((l) => `${l.side} ${l.status}`), plain.stopped], [["sell done", "buy unconfirmed"], undefined], "never 'price moved' after a send");
  const safe = await run({ buyThrows: "safe" });
  assert.deepEqual([safe.legs.length, safe.stopped?.whatHappened], [1, "Jupiter said no. Your SOL is in your wallet."], "control: a refusal before sending is said");
});
