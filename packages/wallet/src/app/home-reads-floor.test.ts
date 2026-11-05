// Review H1 (3 Nov): the product rule, enforced. One node's answer may make the Safe's figure go up or confirm it, never
// go down: a lower one-node figure waits for two nodes at one block. A money sheet's figures are only ever agreed reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Balance } from "../types.ts";
import { below, heldToFloor, startHomeReads, type HomeSink } from "./home-reads.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const USDC = "nep141:usdc";
const row = (amount: string, agreed = false): Balance => ({ tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount, bridged: false, held: "ledger", listed: true, ...(agreed ? { agreed: true as const } : {}) });

/** A ledger whose screen reads answer `shown` in turn (one node's), and whose agreed read answers `agreed`. */
function ledger(o: { shown: Balance[][]; agreed: Balance[]; kept?: Balance[] }) {
  const asked: string[] = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  let i = 0;
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (method === "ledger.balances") {
        asked.push(p.shown ? "shown" : "agreed");
        return { ok: (p.shown ? o.shown[Math.min(i++, o.shown.length - 1)] : o.agreed) as T };
      }
      if (method === "device.store.get") return { ok: { value: p.key === "last-balances" && o.kept ? JSON.stringify(o.kept) : null } as T };
      if (method === "account.state") return { ok: { stage: "ready" } as T };
      return { ok: [] as T };
    },
    on<T>(event: string, h: (p: T) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(h as (p: unknown) => void);
      handlers.set(event, set);
      return () => set.delete(h as (p: unknown) => void);
    },
  };
  const emit = (event: string) => handlers.get(event)?.forEach((h) => h({}));
  const shown: string[] = [];
  const sink: HomeSink = { balances: (r) => "ok" in r && shown.push(r.ok.map((b) => b.amount).join(",")), activity() {}, positions() {}, spending() {}, held() {}, wallets() {}, nearCoins() {}, pocket() {} };
  return { bridge, asked, emit, shown, sink };
}

test("H1: node A said 2.5 (agreed), node B now says 1.0 first: Home keeps 2.5 until two nodes say 1.0 (control: then it shows 1.0)", async () => {
  const l = ledger({ shown: [[row("2.5", true)], [row("1.0")]], agreed: [row("1.0")] });
  const r = startHomeReads(l.bridge, l.sink, { coalesceMs: 1 });
  await sleep(10);
  assert.deepEqual(l.shown, ["2.5"]);
  r.refresh(["safe"]);
  await sleep(20);
  assert.equal(l.shown[1], "2.5", "one node's lower figure is never shown");
  assert.ok(l.asked.includes("agreed"), "two nodes at one block are asked to settle it");
  // control: the agreed read said 1.0, so 1.0 is shown
  assert.equal(l.shown.at(-1), "1.0");
  r.stop();
});

test("H1: the first one-node answer can't go below the copy two nodes agreed on this phone (control: a higher one shows at once)", async () => {
  const low = ledger({ kept: [row("2.5", true)], shown: [[row("1.0")]], agreed: [row("2.5")] });
  // the kept copy loads with the first reads; give it a turn before the Safe's answer is taken
  const r = startHomeReads(low.bridge, low.sink, { coalesceMs: 1 });
  await sleep(20);
  assert.ok(!low.shown.includes("1.0"), `never 1.0: ${low.shown.join(" / ")}`);
  r.stop();
  const high = ledger({ kept: [row("2.5", true)], shown: [[row("3.0")]], agreed: [row("3.0")] });
  const h = startHomeReads(high.bridge, high.sink, { coalesceMs: 1 });
  await sleep(20);
  assert.equal(high.shown[0], "3.0", "up on one node's word: shown at once");
  h.stop();
});

test("H1: a money sheet's Safe is only ever the agreed read (control: Home's is the screen's read)", async () => {
  const m = ledger({ shown: [[row("9.9")]], agreed: [row("2.5")] });
  const r = startHomeReads(m.bridge, m.sink, { coalesceMs: 1, money: true });
  await sleep(10);
  assert.deepEqual(m.asked, ["agreed"]);
  assert.deepEqual(m.shown, ["2.5"]);
  r.stop();
  const h = ledger({ shown: [[row("9.9")]], agreed: [row("2.5")] });
  const hr = startHomeReads(h.bridge, h.sink, { coalesceMs: 1 });
  await sleep(10);
  assert.equal(h.asked[0], "shown");
  hr.stop();
});

test("H1: a confirmation that failed reads two nodes at one block once", async () => {
  const l = ledger({ shown: [[row("2.5", true)]], agreed: [row("2.4")] });
  const r = startHomeReads(l.bridge, l.sink, { coalesceMs: 1 });
  await sleep(10);
  l.emit("ledger.balancesUnconfirmed");
  l.emit("ledger.balancesUnconfirmed");
  await sleep(10);
  assert.equal(l.asked.filter((a) => a === "agreed").length, 1);
  assert.equal(l.shown.at(-1), "2.4");
  r.stop();
});

test("H1: the floor itself (heldToFloor, below)", () => {
  const floor = new Map([[`${USDC}|ledger`, row("2.5", true)]]);
  assert.deepEqual(heldToFloor([row("1")], floor).rows.map((r) => r.amount), ["2.5"]);
  assert.equal(heldToFloor([], floor).heldBack, true, "a coin one node leaves out is held too");
  assert.deepEqual(heldToFloor([row("1", true)], floor).rows.map((r) => r.amount), ["1"], "agreed lower: shown");
  assert.ok(below("0.000001", "2.5") && !below("2.50", "2.5") && below("2.4999999999999999999999", "2.5"));
});

test("H1 re-check: with nothing agreed yet (the first open after an update), one node's first answer is held, never shown or kept; two nodes settle it (control: an agreed answer is shown and kept)", async () => {
  const kept: boolean[] = [];
  const l = ledger({ shown: [[]], agreed: [row("2.5")] });
  const sink: HomeSink = { ...l.sink, balances: (r, agreed) => "ok" in r && (l.shown.push(r.ok.map((b) => b.amount).join(",")), kept.push(agreed === true)) };
  const r = startHomeReads(l.bridge, sink, { coalesceMs: 1 });
  await sleep(20);
  assert.ok(!l.shown.includes(""), `one node's empty answer was never shown: ${JSON.stringify(l.shown)}`);
  assert.deepEqual(l.shown, ["2.5"], "what two nodes said is");
  assert.deepEqual(kept, [true], "and only that is marked to be kept on the phone");
  r.stop();
});

test("the crawl (4 Nov, Move said \"Safe $0\" over a $15.81 Safe): a one-node rise is shown at once and agreed again, so a money sheet starts on it (control: the same figure asks nothing)", async () => {
  const up = ledger({ shown: [[row("0", true)], [row("15.81")]], agreed: [row("15.81")] });
  const r = startHomeReads(up.bridge, up.sink, { coalesceMs: 1 });
  await sleep(10);
  r.refresh(["safe"]);
  await sleep(20);
  assert.equal(up.shown[1], "15.81", "up on one node's word: shown at once");
  assert.ok(up.asked.includes("agreed"), `the rise is agreed again: ${up.asked.join(",")}`);
  r.stop();
  const same = ledger({ shown: [[row("2.5", true)], [row("2.5")]], agreed: [row("2.5")] });
  const s = startHomeReads(same.bridge, same.sink, { coalesceMs: 1 });
  await sleep(10);
  s.refresh(["safe"]);
  await sleep(20);
  assert.ok(!same.asked.includes("agreed"), `control: ${same.asked.join(",")}`);
  s.stop();
});
