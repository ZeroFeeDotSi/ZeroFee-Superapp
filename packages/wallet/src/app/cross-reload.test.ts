// QA's Jobs hunt (5 Nov, B1): a reload 0.2 s after a $21 Move left Home's total $21 short while the move ran
// and for up to 60 s after it landed. The new page's first Safe read already showed the drop, so the move was keyed to
// it and counted nowhere. Money in flight counts once: never zero, never twice. The state now comes back with the page
// (cross-count.ts readKept/keptState, Home's own device.store). Controls: a page with nothing kept is $21 short.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus } from "@zerofee/core/spending";
import { CROSS_KEY, countOnce, keptState, newCrossState, readKept, type CrossState } from "./cross-count.ts";
import type { Balance } from "../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const safe = (usd: number): Balance[] => [{ tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: usd.toFixed(2), usd: usd.toFixed(2), bridged: false, held: "ledger", listed: true } as Balance];
const T0 = 1_700_000_000_000;
/** spending.status: before the tap, the $21 move on its way (the engine counts it at once), or landed ($20 in SOL, $0.60 in NEAR). */
const st = (phase: "before" | "going" | "landed"): SpendingStatus => ({
  loaded: true, totalUsd: phase === "going" ? "21.00" : phase === "landed" ? "20.60" : "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "470.00", ready: false, networks: [],
  onItsWay: phase === "going" ? [{ id: "mv-1", kind: "top-up", usd: "21.00", status: "on-its-way", shown: true, atIso: new Date(T0).toISOString(), words: "Moving $21.00 to your SOL wallet" }] : [],
  firstTopUp: false,
} as SpendingStatus);

/** A phone's device.store (Home's own), shared by the page before the reload and the one after. */
function phone() {
  const store = new Map<string, string>();
  const bridge = {
    call: async (method: string, p: Record<string, unknown>) => {
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } };
      if (method === "device.store.set") { store.set(String(p.key), String(p.value)); return { ok: {} }; }
      return { ok: null };
    },
    on: () => () => undefined,
  } as unknown as Bridge;
  return { store, bridge };
}
/** Home's total on one page: the Safe it shows and the wallets' figure counted once. */
const total = (s: CrossState, bridge: Bridge | null, rows: Balance[], status: SpendingStatus, nowMs: number) => {
  const v = countOnce({ balances: rows, spending: status, trading: status.totalUsd }, s, nowMs, bridge ? { bridge, view: "shown" } : undefined);
  return Math.round((Number(rows[0]!.usd) + Number(v.trading)) * 100) / 100;
};
/** The page after a reload, on the same phone. */
const reload = async (bridge: Bridge) => { await readKept(bridge); return newCrossState(keptState(bridge, "shown")); };

test("B1: a reload 0.2 s after a $21 Move: Home counts it once while it runs and after it lands (control: nothing kept, $21 short)", async () => {
  const { bridge, store } = phone();
  const before = newCrossState();
  // Home shows the Safe's $40 before the tap; the move is listed, the Safe's drop not read yet
  assert.equal(total(before, bridge, safe(40), st("before"), T0 - 5_000), 40);
  assert.equal(total(before, bridge, safe(40), st("going"), T0 + 100), 40);
  assert.ok(store.has(CROSS_KEY), "kept on the phone (Home's own device.store)");
  // the reload: the new page's first read already shows the Safe's drop
  const after = await reload(bridge);
  assert.equal(total(after, bridge, safe(19), st("going"), T0 + 1_500), 40, "in flight: once");
  assert.equal(total(after, bridge, safe(19), st("going"), T0 + 20_000), 40, "still once");
  assert.equal(total(after, bridge, safe(19), st("landed"), T0 + 25_000), 39.6, "landed: the wallets have it, no 60 s gap");
  // control: the same page with nothing kept (the old behaviour) keys the move to the dropped Safe
  const fresh = newCrossState();
  assert.equal(total(fresh, null, safe(19), st("going"), T0 + 1_500), 19, "control: $21 short");
  assert.equal(total(fresh, null, safe(19), st("landed"), T0 + 25_000), 19, "control: still short after it landed");
});

test("B1: a reload after the drop showed: the move's own key comes back (never twice, never zero)", async () => {
  const { bridge } = phone();
  const before = newCrossState();
  assert.equal(total(before, bridge, safe(40), st("before"), T0 - 5_000), 40);
  assert.equal(total(before, bridge, safe(40), st("going"), T0 + 100), 40);
  assert.equal(total(before, bridge, safe(19), st("going"), T0 + 3_000), 40, "the drop shown before the reload");
  const after = await reload(bridge);
  assert.equal(total(after, bridge, safe(19), st("going"), T0 + 10_000), 40);
  // a Safe held at the floor (the drop not agreed yet on the new page) is never counted twice either
  const held = await reload(bridge);
  assert.equal(total(held, bridge, safe(40), st("going"), T0 + 10_000), 40, "never twice");
});

test("B1: Home idle a minute, then a Move whose first sight already has the Safe's drop: once (control: an empty state is short)", () => {
  const s = newCrossState();
  assert.equal(total(s, null, safe(40), st("before"), T0 - 60_000), 40);
  assert.equal(total(s, null, safe(19), st("going"), T0 + 1_000), 40, "the Safe as last shown stays, however old");
  assert.equal(total(newCrossState(), null, safe(19), st("going"), T0 + 1_000), 19, "control");
});

test("B1: a damaged kept state is none (the page counts as before, nothing thrown)", async () => {
  const { bridge, store } = phone();
  store.set(CROSS_KEY, "{not json");
  const s = await reload(bridge);
  assert.equal(s.moves.size, 0);
  store.set(CROSS_KEY, JSON.stringify({ shown: JSON.stringify({ v: 1, seen: [{ rows: [["x", -1, 1]] }], moves: [["m", { way: "sideways", base: null, usd: 1 }]] }) }));
  const { bridge: b2, store: s2 } = phone();
  s2.set(CROSS_KEY, store.get(CROSS_KEY)!);
  const t = await reload(b2);
  assert.deepEqual([t.seen.length, t.moves.size], [0, 0]);
});
