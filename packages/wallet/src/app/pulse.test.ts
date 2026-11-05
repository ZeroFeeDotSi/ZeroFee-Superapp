// H-1, the pulse: what prices did to the coins today, never money in or out (QA's GO, 3 Nov). Every test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Balance, PrivatePocket } from "../types.ts";
import { dayOf, holdings, pulse, pulseLine, topLine, readKept, readPulse, remember, type Holding } from "./pulse.ts";

const DAY = "2026-11-03";
const h = (key: string, symbol: string, amount: number, price: number): Holding => ({ key, symbol, amount, usd: amount * price });
/** A day: the first read, then a later read, through remember (as Home does); the line after the later read. */
const day = (first: Holding[], later: Holding[]) => {
  const k1 = remember(null, first, DAY);
  const k2 = remember(k1, later, DAY);
  return pulseLine(pulse(k2, later));
};

test("prices up: \"Up $… today\" (one idea, HOME-VISUAL §3.4); down: \"Down\"; control: the same coins at the same price say nothing", () => {
  assert.equal(day([h("row:sol", "SOL", 2, 150)], [h("row:sol", "SOL", 2, 154.5)]), "Up $9.00 today");
  assert.equal(day([h("row:sol", "SOL", 2, 150)], [h("row:sol", "SOL", 2, 147)]), "Down $6.00 today");
  assert.equal(day([h("row:sol", "SOL", 2, 150)], [h("row:sol", "SOL", 2, 150)]), null, "flat: nothing");
  assert.equal(day([h("row:sol", "SOL", 2, 150)], [h("row:sol", "SOL", 2, 150.004)]), null, "under a cent is flat");
});

test("money in is never a gain: an Add of SOL at noon adds nothing; control: the same SOL held since morning with the same price rise is counted", () => {
  // morning 1 SOL at $150; noon the price is $160 and 10 SOL arrive; the evening price is $160
  const k1 = remember(null, [h("row:sol", "SOL", 1, 150)], DAY);
  const k2 = remember(k1, [h("row:sol", "SOL", 11, 160)], DAY);
  assert.equal(pulseLine(pulse(k2, [h("row:sol", "SOL", 11, 160)])), "Up $10.00 today", "only the morning coin's rise, never the 10 SOL that came in");
  // control: had all 11 been there since morning, the rise is 11 × $10
  assert.equal(day([h("row:sol", "SOL", 11, 150)], [h("row:sol", "SOL", 11, 160)]), "Up $110.00 today");
  // a coin that arrives today in a new place starts at its own price: nothing
  assert.equal(day([], [h("row:bsc", "BNB", 3, 600)]), null);
});

test("money out is never a loss: a Send of SOL leaves no line; control: the same drop in dollars from a price fall is a line", () => {
  assert.equal(day([h("row:sol", "SOL", 10, 150)], [h("row:sol", "SOL", 4, 150)]), null, "6 SOL sent, price flat: nothing");
  assert.equal(day([h("row:sol", "SOL", 10, 150)], []), null, "all of it sent: nothing");
  assert.equal(day([h("row:sol", "SOL", 10, 150)], [h("row:sol", "SOL", 10, 141)]), "Down $90.00 today");
});

test("dollar coins never move it (USDC's 1.0003 on $5,000 would be $1.50 of noise); control: a real coin with the same wobble does", () => {
  const safe = (symbol: string, usd: string): Balance => ({ tokenId: `t-${symbol}`, symbol, name: symbol, icon: "", chain: "near", amount: "5000", usd, bridged: false, held: "ledger", listed: true } as Balance);
  const at = (b: Balance[]) => holdings({ balances: b, pocket: null, spending: null, held: [] });
  assert.deepEqual(at([safe("USDC", "5000"), safe("USDT", "5000")]), []);
  assert.equal(at([safe("NEAR", "5000")]).length, 1, "control: NEAR is priced");
  const k = remember(remember(null, at([safe("USDC", "5000")]), DAY), at([safe("USDC", "5001.5")]), DAY);
  assert.equal(pulseLine(pulse(k, at([safe("USDC", "5001.5")]))), null);
});

test("every place and every chain counts (D111, never NEAR alone): the Safe, Hidden, each row's coin and coins held on a row", () => {
  const bal = (id: string, symbol: string, amount: string, usd: string): Balance => ({ tokenId: id, symbol, name: symbol, icon: "", chain: "near", amount, usd, bridged: false, held: "ledger", listed: true } as Balance);
  const pocket: PrivatePocket = { available: true, ready: true, defaultOn: true, rows: [bal("nep141:wrap.near", "NEAR", "10", "30")] };
  const spending = { networks: [
    { network: "sol", nativeAmount: "2", cashUsd: "300.00" }, { network: "hood", nativeAmount: "0.1", cashUsd: "350.00" }, { network: "bsc", nativeAmount: "1", cashUsd: "600.00" },
  ] } as unknown as SpendingStatus;
  const got = holdings({ balances: [bal("nep141:btc", "BTC", "0.01", "1000")], pocket, spending, held: [{ chain: "near", address: "rhea.tkn.near", symbol: "RHEA", amount: "100", usd: "5" }] });
  assert.deepEqual(got.map((x) => x.key), ["safe:nep141:btc", "hidden:nep141:wrap.near", "row:sol", "row:hood", "row:bsc", "held:near:rhea.tkn.near"]);
  assert.deepEqual(got.map((x) => x.symbol), ["BTC", "NEAR", "SOL", "ETH", "BNB", "RHEA"]);
  // control: Hidden not available on this phone is left out (as Home leaves it out)
  assert.ok(!holdings({ balances: [], pocket: { ...pocket, available: false }, spending: null, held: [] }).length);
});

test("a new day starts over; nothing read earlier today says nothing; control: the same prices on the same day say the move", () => {
  const morning = remember(null, [h("row:sol", "SOL", 2, 150)], "2026-11-02");
  const next = remember(morning, [h("row:sol", "SOL", 2, 160)], DAY);
  assert.equal(pulseLine(pulse(next, [h("row:sol", "SOL", 2, 160)])), null, "yesterday's price is not today's start");
  const same = remember(morning, [h("row:sol", "SOL", 2, 160)], "2026-11-02");
  assert.equal(pulseLine(pulse(same, [h("row:sol", "SOL", 2, 160)])), "Up $20.00 today");
  assert.equal(dayOf(new Date(2026, 10, 3, 23, 59)), "2026-11-03", "the phone's own date");
});

test("Home's line is one idea, the dollars; the coin that moved most is its own line (topLine), only when it moved the same way as the whole; control: when it did, it is named", () => {
  assert.equal(pulseLine({ usd: 5, top: { symbol: "SOL", pct: 12.4 } }), "Up $5.00 today", "never a second idea on Home's line");
  assert.equal(pulseLine({ usd: -1234.5 }), "Down $1,234.50 today");
  assert.equal(topLine({ usd: 5, top: { symbol: "SOL", pct: -2 } }), null);
  assert.equal(topLine({ usd: 5, top: { symbol: "SOL", pct: 0.04 } }), null);
  assert.equal(topLine({ usd: 5, top: { symbol: "SOL", pct: 12.4 } }), "SOL is up 12%", "control: it moved the whole's way");
});

test("kept on this device only, read back strictly; control: a good record reads back the same", async () => {
  assert.equal(readKept("not json"), null);
  assert.equal(readKept(JSON.stringify({ day: 3 })), null);
  assert.deepEqual(readKept(JSON.stringify({ day: DAY, first: { a: { p: -1, a: 1, f: 1 }, b: { p: 2, a: 1, f: 2 } } })), { day: DAY, first: { b: { p: 2, a: 1, f: 2 } } });
  const kept = new Map<string, string | null>();
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(m: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push(m);
      if (m === "device.store.get") return { ok: { value: kept.get(p.key as string) ?? null } as T };
      kept.set(p.key as string, p.value as string);
      return { ok: {} as T };
    },
    on: () => () => {},
  };
  const at = new Date(2026, 10, 3, 9);
  assert.equal(await readPulse(bridge, [h("row:sol", "SOL", 2, 150)], at), null, "the day's first read: nothing yet");
  assert.equal(await readPulse(bridge, [h("row:sol", "SOL", 2, 153)], at), "Up $6.00 today");
  assert.ok(calls.every((m) => m.startsWith("device.store.")), "nothing but the phone's own store");
  const sets = calls.filter((m) => m === "device.store.set").length;
  await readPulse(bridge, [h("row:sol", "SOL", 2, 153)], at);
  assert.equal(calls.filter((m) => m === "device.store.set").length, sets, "the same read again writes nothing");
  await readPulse(bridge, [h("row:sol", "SOL", 3, 153)], at);
  assert.equal(calls.filter((m) => m === "device.store.set").length, sets + 1, "control: a change is written");
  assert.doesNotMatch(kept.get("pulse.day")!, /address|0x|[1-9A-HJ-NP-Za-km-z]{32,}/, "no address kept");
});

test("Home shows the line only when every part is read, never as a tap; control: the gate names each part", () => {
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /const pulseReady = Boolean\(balances && settled && complete && !tradingPartial && held !== null\);/);
  assert.match(home, /<p className="wl-slot" [^>]*>\{slot\}<\/p>/, "a line, not a button: Home's ONE slot under the number (HOME-VISUAL §3.4)");
  assert.match(home, /const change = !hide && pulseText \?/, "hidden with every amount");
  // control: the line is never drawn only when there is text (that is what moved the four buttons)
  assert.doesNotMatch(home, /\{pulseText && <p/);
  assert.match(readFileSync(new URL("./wallet.css", import.meta.url), "utf8"), /\.wl-slot \{[^}]*min-height: var\(--slot-h\);/, "one line high even when empty, so the four buttons never move");
  assert.match(home, /import\("\.\.\/pulse\.ts"\)/, "loaded after Home's first paint");
  assert.doesNotMatch(home, /^import .*pulse/m, "control: never in Home's first load");
});
