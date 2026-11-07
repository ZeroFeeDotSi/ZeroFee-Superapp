// the audit's MUST on T2-4 (8 Nov): the receipt's sale quote (held-net.ts heldNetQuote, TradeSheet's receipt) is a figure only:
// no core sign call, no core check of its bytes (no ready step), nothing sent, no record (so no place in the coin's
// queue). The control: the same kind of quote, readied and traded, does sign, so the counters see a signing.
// the audit's SHOULD with the copy review's words: the market line. the audit's note: an unseen trap coin's refusal names "Not for sale" and offers Go back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Bridge } from "@zerofee/shell-api";
import { createTradeService } from "../service.ts";
import type { ChainEngine, Fill, Prepared } from "../types.ts";
import { heldNetQuote, marketGapLine } from "./held-net.ts";
import { saleNetUsd } from "../trade-usd.ts";

function setup() {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const sends: string[] = [], calls: string[] = [], made: { p: Prepared; readied: number; side: string }[] = [];
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const k = ++n;
      const entry = { p: undefined as unknown as Prepared, readied: 0, side };
      entry.p = {
        key: `k${k}`, at: 0, ready: async () => { entry.readied++; },
        steps: [{ id: "swap", tx: btoa(`unsigned-${k}`), lastValidBlockHeight: 1000 }],
        quote: side === "buy"
          ? { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "250000000", payUsd: 25, getRaw: "7505000000", getUsd: 24.92, getMinRaw: "7280000000", feeRaw: "10000", feeUsd: 0.002, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 }
          : { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "7505000000", payUsd: 24.92, getRaw: "248500000", getUsd: 24.852, getMinRaw: "241000000", feeRaw: "10000", feeUsd: 0.002, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      made.push(entry);
      return entry.p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sends.push(tx); return `hash-${atob(tx)}`; },
    async status() { return "confirmed"; },
    async landed() { return "landed" as const; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const bridge: Bridge = { ...inner, call: (method: string, p?: unknown) => (calls.push(method), inner.call(method, p as never)) } as Bridge;
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "DOPE", priceUsd: 0.00332 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, sends, calls, made };
}
const signing = (calls: string[]) => calls.filter((m) => /sign|preflight|session\.start/i.test(m));

test("the audit's MUST: the receipt's sale quote makes no signing call, no core check (no ready step), sends nothing and books nothing; it is dropped with its bytes unsigned; control: the same quote traded does sign", async () => {
  const x = setup();
  const bought = await x.svc.trade(await x.svc.quote("buy", "sol", "DOPEmint", { usd: 25 }));
  assert.equal(bought.status, "done");
  await x.svc.checked();
  const held = (await x.svc.positions()).find((p) => p.coin === "DOPEmint");
  assert.equal(held?.raw, "7505000000");
  const before = { calls: [...x.calls], sends: x.sends.length, records: (await x.svc.activity()).length, made: x.made.length };

  const net = await heldNetQuote(x.svc.quote, "sol", "DOPEmint", held!.raw);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

  const sale = x.made.at(-1)!;
  assert.equal(x.made.length, before.made + 1, "one sale quote prepared");
  assert.equal(sale.side, "sell");
  assert.equal(net, saleNetUsd(sale.p.quote), "the figure is the Sell sheet's own function of it ($24.85)");
  assert.equal(net, 24.85);
  assert.deepEqual(signing(x.calls.slice(before.calls.length)), [], "no core sign call, no preflight of its bytes, no session");
  assert.equal(sale.readied, 0, "never made ready: the core is never asked to check it");
  assert.equal(x.sends.length, before.sends, "nothing sent");
  assert.equal((await x.svc.activity()).length, before.records, "no record, so no place in the coin's queue");
  assert.equal(atob(sale.p.steps[0]!.tx), `unsigned-${x.made.length}`, "its bytes stay unsigned");
  assert.equal((heldNetQuote.toString().match(/\bready\b|\btrade\(/g) ?? []).length, 0, "the receipt's path names no ready() and no trade()");
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  // the audit's T6 (8 Nov): through the one cached figure (heldNetOf), which asks exactly this path
  assert.match(sheet, /void heldNetOf\(svc\.quote, coin\.chain, coin\.address, heldRaw\)\.then\(\(net\) => \{/, "the receipt uses exactly this path");
  assert.match(readFileSync(new URL("./held-net.ts", import.meta.url), "utf8"), /\.then\(\(\) => heldNetQuote\(quote, chain, coin, raw\)\)/, "heldNetOf asks heldNetQuote");
  assert.doesNotMatch(sheet, /svc\.quote\("sell", coin\.chain, coin\.address, \{ fraction: 1 \}\)/, "never its own quote call");

  // control: a sale quote readied and traded does sign and send, so the counters above would have seen it
  const p = await x.svc.quote("sell", "sol", "DOPEmint", { fraction: 1 });
  const rec = await x.svc.trade(p);
  assert.equal(rec.status, "done");
  assert.ok(signing(x.calls.slice(before.calls.length)).some((m) => /signTx/.test(m)), "control: a real sale signs");
  assert.ok(x.sends.length > before.sends, "control: and sends");
});

test("the audit's SHOULD, the copy review's words: one mute line, \"About $0.07 under the market price.\" on a sale, \"About $0.08 over the market price.\" on a buy above market, from the quote's own figures (never a market read: Security's SHOULD); none under a cent; never \"fee\"", () => {
  // the walk's sale: 7,505 DOPE the quote values at $24.92; the Sell figure is $24.85 (24.852 less the $0.002 fee)
  const sell = { payUsd: 24.92, getUsd: 24.852, feeUsd: 0.002 };
  assert.equal(marketGapLine("sell", sell), "About $0.07 under the market price.");
  // a buy paying $25.00 for coins the quote values at $24.92
  const buy = { payUsd: 25, getUsd: 24.92, feeUsd: 0.002 };
  assert.equal(marketGapLine("buy", buy), "About $0.08 over the market price.");
  // controls: under a cent, the other way, a quote whose payUsd is its proceeds (Solana's own engines), or none: no line
  assert.equal(marketGapLine("sell", { ...sell, getUsd: 24.925 }), null, "a gap under a cent");
  assert.equal(marketGapLine("buy", { ...buy, getUsd: 25.1 }), null, "a buy under market says nothing");
  assert.equal(marketGapLine("sell", { payUsd: 24.85, getUsd: 24.85, feeUsd: 0.002 }), null, "the fee alone is under a cent");
  assert.equal(marketGapLine("sell", { ...sell, payUsd: 0 }), null);
  for (const l of [marketGapLine("sell", sell), marketGapLine("buy", buy)]) assert.doesNotMatch(l!, /fee/i, "never called a fee");
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const gapLine = q \? marketGapLine\(side, q\) : null;/, "from the prepared quote only");
  assert.match(sheet, /<\/button>\n\s*\{\/\*[^\n]*\*\/\}\n\s*\{gapLine && <p className="zf-small tp-gap" data-testid="trade-quote-gap">\{gapLine\}<\/p>\}/, "right under the figure's line");
  assert.doesNotMatch(readFileSync(new URL("./held-net.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /priceUsd|livePrice|market\./, "the line reads no market price");
  const css = readFileSync(new URL("./screens/sheet.css", import.meta.url), "utf8");
  assert.match(css, /\.tp-gap \{[^}]*color: var\(--mute\)/, "in mute");
});

test("the audit's note: an unseen trap coin's quote refusal names \"Not for sale\" and offers Go back, which closes the sheet; the row and the sheet mark it Not for sale; control: other coin refusals keep their own way on", async () => {
  const { tradeProblems } = await import("../trade-problems.ts");
  const p = tradeProblems.coinUnsellable("NOSELL");
  assert.equal(p.code, "trade.coin.unsellable");
  assert.match(p.whatHappened, /^Not for sale\. ZeroFee won't buy NOSELL\.$/);
  assert.equal(p.more, "Recent buyers couldn't sell it, so your money could get stuck. Nothing was spent.");
  assert.deepEqual(p.next, { kind: "nothing", label: "Go back" });
  assert.deepEqual(tradeProblems.coinFreezable("X").next, { kind: "open", label: "Find another coin", screen: "search" }, "control");
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(p\.next\.kind === "nothing"\) \{ onClose\(\); return; \}/, "Go back closes the sheet");
  assert.match(sheet, /<button className="zf-link" onClick=\{\(\) => \{[\s\S]{0,700}\}\}>\{quote\.problem\.next\.label\}<\/button>/, "its label on the sheet's one link");
  assert.match(sheet, /useEffect\(\(\) => markIfUnsellable\(quote\.problem\?\.code, coin\.chain, coin\.address\), /, "the sheet's refusal marks it");
  const { UNSELLABLE, markIfUnsellable, isNotForSale } = await import("./not-for-sale.ts");
  assert.equal(UNSELLABLE, p.code, "one code");
  markIfUnsellable("trade.coin.freezable", "bsc", "0xabc1");
  assert.equal(isNotForSale("bsc", "0xabc1"), false, "control: another refusal marks nothing");
  markIfUnsellable(p.code, "bsc", "0xabc1");
  assert.equal(isNotForSale("bsc", "0xabc1"), true);
  const list = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
  assert.match(list, /if \(e instanceof ProblemError\) markIfUnsellable\(e\.problem\.code, r\.chain, r\.address\);/, "the row's Buy refused: the row says Not for sale after");
});

test("the audit's note, the Sim: a sample trap coin's buy is refused at the quote as on chain (trade.coin.unsellable, so \"Not for sale\" and Go back); control: its sale and other coins still quote", async () => {
  const { createDemoEngine } = await import("../demo-engine.ts");
  const { SAMPLE_UNSELLABLE } = await import("../market/demo-samples.ts");
  const { problemOf } = await import("../trade-problems.ts");
  const trap = SAMPLE_UNSELLABLE.hood.address;
  const e = createDemoEngine({ chain: "hood", owner: "0x00000000000000000000000000000000000000a1", meta: async () => ({ symbol: "NOSELL", priceUsd: 0.0017, decimals: 18 }), nativeUsd: async () => 3000 } as never);
  const err = await e.prepare("buy", trap, { usd: 25 }).then(() => null, (x: unknown) => x);
  assert.ok(err, "refused at the quote");
  const p = problemOf(err, { symbol: "NOSELL", chain: "Robinhood Chain", coin: "ETH" });
  assert.equal(p.code, "trade.coin.unsellable");
  assert.equal(p.whatHappened, "Not for sale. ZeroFee won't buy NOSELL.");
  assert.deepEqual(p.next, { kind: "nothing", label: "Go back" });
  const ok = await e.prepare("buy", "0x00000000000000000000000000000000000000c0", { usd: 25 });
  assert.equal(ok.quote.side, "buy", "control: another coin quotes");
});
