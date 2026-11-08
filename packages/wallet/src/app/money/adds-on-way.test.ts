// The test mainnet test (3 Nov): money reached a one-time address and Home showed nothing for 10 minutes. The
// Adds are now read fast while money moves and on the idle round otherwise, all on the one scheduler, and the phone's push
// on its one-time SOL addresses tells the core the moment money lands. Each test has a control. No network: a fake bridge
// and a fake push.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { ADDS_FAST_MS, ADDS_IDLE_MS, ADD_WATCH_EVERY_MS, arrivingUsd, watchAddsOnWay, type AddOnWay } from "./adds-on-way.ts";

const ADDR = "AZR29XkdQ47dwmgyiQgh8Q812vfpjKbeDGowNPR7PrVP";  // generated sample

function fakeBridge(answer: { onWay: () => unknown[]; watch?: () => unknown[] }) {
  const calls: [string, unknown][] = [];
  const bridge = {
    call: async (method: string, params?: unknown) => {
      calls.push([method, params]);
      if (method === "subwallet.add.onWay") return { ok: answer.onWay() };
      if (method === "subwallet.private.addsOnWay") return { ok: [] };
      if (method === "subwallet.add.watch") return { ok: answer.watch?.() ?? [] };
      if (method === "subwallet.add.seen") return { ok: { seen: true } };
      return { ok: null };
    },
    on: () => () => {},
  } as unknown as Bridge;
  return { bridge, calls, reads: () => calls.filter(([m]) => m === "subwallet.add.onWay").length };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
/** The clock forward in 500 ms steps (each timer armed on the way fires in its own step). */
const tick = async (ms: number) => { for (let t = 0; t < ms; t += 500) { mock.timers.tick(500); await settle(); } };

test("reads: at once, then every 20 s while nothing moves; every 2 s while money is on its way (control: idle, no read at 2 s)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    let list: AddOnWay[] = [];
    const b = fakeBridge({ onWay: () => list });
    const stop = watchAddsOnWay(b.bridge, () => {});
    await settle();
    assert.equal(b.reads(), 1, "at once");
    await tick(ADDS_FAST_MS);
    assert.equal(b.reads(), 1, "control: nothing on its way, no read at 2 s");
    await tick(ADDS_IDLE_MS - ADDS_FAST_MS);
    assert.equal(b.reads(), 2, "the idle round");
    list = [{ key: "PrVPaa", tokenId: "nep141:sol.omft.near", chain: "sol", to: "wallet", stage: "arriving" }];
    await tick(ADDS_IDLE_MS);
    assert.equal(b.reads(), 3);
    await tick(ADDS_FAST_MS);
    await tick(ADDS_FAST_MS);
    assert.equal(b.reads(), 5, "money on its way: every 2 s");
    list = [{ ...list[0]!, stage: "landed" }];
    await tick(ADDS_FAST_MS);
    const at = b.reads();
    await tick(ADDS_FAST_MS * 3);
    assert.equal(b.reads(), at, "landed: back to the idle round");
    stop();
    await tick(ADDS_IDLE_MS * 2);
    assert.equal(b.reads(), at, "stopped: no more reads");
  } finally {
    mock.timers.reset();
  }
});

test("push: the core's open SOL addresses are watched, one line each; money seen tells the core and reads at once, then fast (control: the Robinhood entry isn't watched; a dropped one is closed)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 2_000_000 });
  try {
    let watch: unknown[] = [{ chain: "sol", address: ADDR }, { chain: "hood", address: "0x1111111111111111111111111111111111111111" }];
    const b = fakeBridge({ onWay: () => [], watch: () => watch });
    const lines = new Map<string, { change: () => void; stopped: boolean }>();
    const startPush = (address: string, change: () => void) => { const l = { change, stopped: false }; lines.set(address, l); return () => { l.stopped = true; }; };
    const stop = watchAddsOnWay(b.bridge, () => {}, { push: true, startPush });
    await settle();
    assert.deepEqual([...lines.keys()], [ADDR], "SOL only, one line for its address");
    const before = b.reads();
    lines.get(ADDR)!.change();
    await settle();
    assert.deepEqual(b.calls.find(([m]) => m === "subwallet.add.seen")?.[1], { address: ADDR }, "the core is told which address");
    assert.equal(b.reads(), before + 1, "and the Adds are read at once");
    await tick(ADDS_FAST_MS);
    assert.equal(b.reads(), before + 2, "then every 2 s, even before 1Click has a word of it");
    // the address is no longer open (seen, or used): its line closes on the next watch read
    watch = [];
    await tick(ADD_WATCH_EVERY_MS);
    assert.equal(lines.get(ADDR)!.stopped, true);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test("Home's total adds only the money in neither place yet (the core's onWayUsd), never an Add's whole amount again (control: landed or no figure, nothing)", () => {
  const a = { key: "k", tokenId: "t", chain: "sol" as const, to: "wallet" as const };
  assert.equal(arrivingUsd([{ ...a, stage: "arriving", usd: "150.00", onWayUsd: "150.00" }, { ...a, key: "j", stage: "forwarding", usd: "20.00", onWayUsd: "19.90" }]), 169.9);
  assert.equal(arrivingUsd([{ ...a, stage: "forwarding", usd: "150.00" }]), 0, "control: in the NEAR wallet's count, not added again");
  assert.equal(arrivingUsd([{ ...a, stage: "landed", usd: "150.00" }]), 0, "control: landed");
  assert.equal(arrivingUsd([{ ...a, stage: "arriving", onWayUsd: "-5" }]), 0, "control: no made-up figure");
});
