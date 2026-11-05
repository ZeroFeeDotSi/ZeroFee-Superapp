import { test } from "node:test";
import assert from "node:assert/strict";
import { askRefusal, askStart, createTradeAsks, shellAsk, tradeAsks, type TradeAsk, type TradeEnd } from "./trade-ask.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const buy: TradeAsk = { side: "buy", chain: "sol", address: MINT, usd: 25, from: "agentzero" };

test("an ask names its coin by chain and address, never a symbol; amounts in range (controls: a sane buy and sale pass)", () => {
  assert.equal(askRefusal(buy), null, "control: a buy");
  assert.equal(askRefusal({ side: "sell", chain: "hood", address: "0x" + "a".repeat(40), pct: 50, from: "agentzero" }), null, "control: a sale");
  assert.match(askRefusal({ ...buy, address: "WIF" })!, /address/);
  assert.match(askRefusal({ ...buy, chain: "hood" })!, /address/, "a Solana mint on an EVM chain");
  assert.match(askRefusal({ ...buy, chain: "eth" as never })!, /chain/);
  assert.match(askRefusal({ ...buy, usd: 0 })!, /between/);
  assert.match(askRefusal({ ...buy, usd: 1e6 })!, /between/);
  assert.match(askRefusal({ ...buy, usd: Number.NaN })!, /between/);
  assert.match(askRefusal({ ...buy, pct: 50 })!, /dollars/);
  assert.match(askRefusal({ side: "sell", chain: "sol", address: MINT, pct: 150, from: "agentzero" })!, /percent/);
  assert.match(askRefusal({ side: "sell", chain: "sol", address: MINT, pct: 99.5, from: "agentzero" })!, /whole/, "never rounded up to Sell all");
  assert.match(askRefusal({ ...buy, usd: 0.001 })!, /between/, "under a cent would open at $0");
  assert.match(askRefusal({ ...buy, chain: "bsc", address: "0x" + "a".repeat(40) }, ["sol", "hood", "near"])!, /yet/, "a chain this build doesn't list");
  assert.equal(askRefusal({ ...buy, chain: "bsc", address: "0x" + "a".repeat(40) }, ["sol", "hood", "bsc", "near"]), null, "control: listed");
  assert.match(askRefusal({ ...buy, chain: "near", address: "nep141:eth.omft.near" })!, /address/);
  assert.equal(askRefusal({ ...buy, chain: "near", address: "eth.omft.near" }), null, "control: a NEAR token id");
  assert.match(askRefusal({ ...buy, from: "someone" as never })!, /AgentZero/);
  assert.match(askRefusal(null)!, /buy or sell/);
});

test("the page opens at the ask's amount: cents for a buy (rounded, never a cent lost), the percent for a sale", () => {
  assert.equal(askStart({ ...buy, usd: 12.349 }), "12.35");
  for (const [usd, shown] of [[0.29, "0.29"], [19.99, "19.99"], [4.35, "4.35"]] as const) assert.equal(askStart({ ...buy, usd }), shown, `floor read ${Math.floor(usd * 100) / 100}`);
  assert.equal(askStart({ side: "sell", chain: "sol", address: MINT, pct: 50, from: "agentzero" }), "50");
  assert.equal(askStart({ ...buy, usd: undefined }), undefined);
});

test("one ask at a time; Trade takes it once; each ask ends exactly once; a refused ask says why and is never taken", () => {
  const ch = createTradeAsks();
  const ends: [string, TradeEnd][] = [];
  assert.equal(ch.ask({ ...buy, address: "nope" }, (e) => ends.push(["bad", e])), false);
  assert.equal(ch.take(), null, "a refused ask is never taken");
  assert.equal(ends[0]![1].went, false);
  assert.ok(ends[0]![1].refused);
  assert.equal(ch.ask(buy, (e) => ends.push(["a", e])), true);
  assert.equal(ch.ask({ ...buy, usd: 5 }, (e) => ends.push(["b", e])), true);
  assert.deepEqual(ends[1], ["a", { went: false }], "a newer ask ends the older one");
  const t = ch.take()!;
  assert.equal(t.ask.usd, 5);
  assert.equal(ch.take(), null, "taken once");
  ch.end(t.seq, { went: true, tradeId: "r1", landedMs: 620 });
  ch.end(t.seq, { went: false });
  assert.deepEqual(ends.slice(2), [["b", { went: true, tradeId: "r1", landedMs: 620 }]], "only the first end counts");
});

test("an asker's callback that throws never breaks the channel", () => {
  const ch = createTradeAsks();
  ch.ask(buy, () => { throw new Error("boom"); });
  const t = ch.take()!;
  assert.doesNotThrow(() => ch.end(t.seq, { went: true }));
  assert.equal(ch.ask(buy), true, "control: the next ask still opens");
});

test("a newer ask is refused while an earlier ask's trade is on its way, never ending it (control: once it's over, a new ask opens)", () => {
  const ch = createTradeAsks();
  const ends: TradeEnd[] = [];
  ch.ask(buy, (e) => ends.push(e));
  const t = ch.take()!;
  ch.hold(t.seq, true);
  assert.equal(ch.ask({ ...buy, usd: 5 }, (e) => ends.push(e)), false);
  assert.match(ends[0]!.refused!, /still going/);
  assert.equal(ends.length, 1, "the trade on its way is not ended");
  ch.end(t.seq, { went: true, tradeId: "r" });
  assert.deepEqual(ends[1], { went: true, tradeId: "r" });
  assert.equal(ch.ask({ ...buy, usd: 5 }), true, "control: over, so a new ask opens");
});

test("Trade's page for an ask never keeps a press, takes no tap in its first moments, and compares addresses the market's way (source)", async () => {
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("../../trade/src/app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(filledBy && \(performance\.now\(\) - shownAt\.current < FILLED_GRACE_MS \|\| !canTap\(quote, intent, busy\)\)\) return;/);
  const app = readFileSync(new URL("../../trade/src/app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /normAddr\(coin\.chain, asked\.ask\.address\) === normAddr\(coin\.chain, coin\.address\)/);
  assert.match(app, /asked && !asked\.opened && !sheet && view\.ask === asked\.seq/, "opens only over no other page");
  assert.match(app, /if \(!onPage\) endAsk\(\{ went: false \}\);/, "every way off the page ends the ask");
  const host = readFileSync(new URL("../../../apps/web/src/shell/AppHost.tsx", import.meta.url), "utf8");
  const door = readFileSync(new URL("./trade-ask.ts", import.meta.url), "utf8");
  assert.match(door, /if \(from !== "agent" \|\| !onScreen\) return no\(/, "only AgentZero's own page, on screen");
  assert.match(host, /askTrade\(api\.current, ask, onEnd, app\.id, onScreen\.current\)/);
  assert.doesNotMatch(host, /__zfAsk|TEMP-WALK/, "no walk hook shipped");
});

test("Trade tells the channel the chains it lists; an ask for another is refused before any switch (control: unknown until Trade says, then a listed chain opens)", () => {
  const ch = createTradeAsks();
  const evm = { ...buy, chain: "bsc" as const, address: "0x" + "b".repeat(40) };
  assert.equal(ch.listed(), undefined);
  assert.equal(ch.ask(evm, undefined, ch.listed()), true, "control: unknown, Trade itself decides after the switch");
  ch.end(ch.take()!.seq, { went: false });
  ch.setListed(["sol", "hood", "near"]);
  const ends: TradeEnd[] = [];
  assert.equal(ch.ask(evm, (e) => ends.push(e), ch.listed()), false);
  assert.match(ends[0]!.refused!, /yet/);
  assert.equal(ch.ask(buy, undefined, ch.listed()), true, "control: a listed chain");
});

test("re-review: the asked trade stays on its way through the landed moment; Trade going away or a coin mismatch ends the ask; the shell reads 'on screen' at the ask (source)", async () => {
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("../../trade/src/app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /onBusy\?\.\(busy \|\| moment\?\.phase === "done" \|\| moment\?\.phase === "checking"\)/, "busy through the landed moment and the checking one (ui/trade-tap: an answer lost after the send is still the trade's)");
  assert.match(sheet, /if \(active\) shownAt\.current = performance\.now\(\);/, "the grace restarts when the page is seen");
  const app = readFileSync(new URL("../../trade/src/app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /useEffect\(\(\) => \(\) => \{ const a = askedNow\.current; if \(a\) tradeAsks\.end\(a\.seq, \{ went: false \}\); \}, \[\]\);/);
  assert.match(app, /endAsk\(\{ went: false, refused: "That isn't the coin AgentZero asked for\." \}\);/, "a mismatch never falls through to a plain page");
  assert.match(app, /address: normAddr\(a\.ask\.chain, a\.ask\.address\)/);
  const page = readFileSync(new URL("../../trade/src/app/screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.match(page, /!checksAnswered\) return;/, "waits for the chain's own sell check");
  const host = readFileSync(new URL("../../../apps/web/src/shell/AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /askTrade\(api\.current, ask, onEnd, app\.id, onScreen\.current\)/);
});

test("an end clears the hold (the only way an asked trade stops being on its way once it landed)", () => {
  const ch = createTradeAsks();
  ch.ask(buy);
  const t = ch.take()!;
  ch.hold(t.seq, true);
  assert.equal(ch.busyNow(), true);
  ch.end(t.seq, { went: true });
  assert.equal(ch.busyNow(), false);
  ch.hold(t.seq, true);
  assert.equal(ch.busyNow(), false, "an ended ask can't be held again");
});

test("the shell's door: only AgentZero's page, on screen, in a build showing Trade, switches to Trade (controls)", () => {
  const opened: string[] = [];
  const host = (shows: boolean) => ({ shows: () => shows, openApp: (id: string, tab?: string) => void opened.push(`${id}:${tab}`) });
  const ends: TradeEnd[] = [];
  shellAsk(host(true), buy, (e) => ends.push(e), "wallet", true);
  shellAsk(host(true), buy, (e) => ends.push(e), "agent", false);
  shellAsk(host(false), buy, (e) => ends.push(e), "agent", true);
  assert.equal(opened.length, 0);
  assert.deepEqual(ends.map((e) => e.went), [false, false, false]);
  shellAsk(host(true), { ...buy, from: "someone" as never }, (e) => ends.push(e), "agent", true);
  assert.deepEqual(opened, ["trade:ask"], "control: AgentZero on screen opens Trade; the shell sets from itself");
  tradeAsks.end(tradeAsks.take()!.seq, { went: false });
});

test("an ask never hangs: a sale of a coin not held ends as soon as the wallet is read, and any ask ends within ASK_READ_MS (source; AgentZero's rehearsal, 3 Nov: 45 s and no answer)", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../trade/src/app/screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(auto === "sell" && held\.value !== undefined && !holds\) \{ autoDone\.current = true; onAutoFail\?\.\(`You don't hold /);
  assert.match(page, /export const ASK_READ_MS = 12_000;/);
  assert.match(page, /setTimeout\(\(\) => \{\s*if \(autoDone\.current\) return;\s*autoDone\.current = true;\s*const r = askReads\.current;/);
});

test("a hold never lasts for ever: past HOLD_MAX_MS it is dropped and the next ask opens (AgentZero's no-hang audit, 3 Nov); under it, still refused (control)", async () => {
  const { HOLD_MAX_MS } = await import("./trade-ask.ts");
  let t = 1_000;
  const ch = createTradeAsks(() => t);
  ch.ask(buy);
  const first = ch.take()!;
  ch.hold(first.seq, true);
  t += HOLD_MAX_MS - 1;
  assert.equal(ch.ask({ ...buy, usd: 5 }), false, "control: still on its way, refused");
  t += 2;
  assert.equal(ch.busyNow(), false);
  assert.equal(ch.ask({ ...buy, usd: 5 }), true, "the lost hold no longer blocks");
});
