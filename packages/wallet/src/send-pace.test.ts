// D137 follow-up (3 Nov): a Send's leg 1 is asked about every second for its first 30 s, then every 3 s, one ask at a
// time, so the payment starts about a second after leg 1 lands (it was every 10 s). On mocked timers: no network, no
// wall clock.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createSendJobs, followPace, type SendJob } from "./send-job.ts";

const job: SendJob = { id: "send-pace-1", inDeposit: "in-dep", outDeposit: "out-dep", signedData: { signed: true }, coinId: "nep141:usdc", leg2In: "100", coin: "USDC", startedAtIso: "2026-11-03T08:00:00.000Z" };

async function rig() {
  const asked: number[] = [], paid: number[] = [];
  let landed = false, hang: (() => void) | null = null, hangNext = false;
  const kv = new Map<string, string>();
  const sj = createSendJobs({
    apis: {
      status: (async (dep: string) => {
        if (dep !== "in-dep") return { status: "PENDING_DEPOSIT" };
        asked.push(Date.now());
        if (hangNext) { hangNext = false; await new Promise<void>((r) => { hang = r; }); }
        return landed ? { status: "SUCCESS", swapDetails: { amountOut: "150" } } : { status: "PENDING" };
      }) as never,
      submitIntent: (async () => { paid.push(Date.now()); return {}; }) as never,
    },
    relayed: "relay",
    remember: async () => {}, note: async () => {}, forget: async () => {},
    loadMovements: async () => [{ id: job.id, status: "moving" }] as never,
    emit: () => {}, stored: async (k) => kv.get(k), store: async (k, v) => kv.set(k, v),
    serially: (f) => f(), iso: () => new Date(Date.now()).toISOString(), now: () => Date.now(), trackMs: undefined,
  });
  return { sj, asked, paid, land: () => { landed = true; }, hangOnce: () => { hangNext = true; }, release: () => hang?.() };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const run = async (ms: number) => { for (let t = 0; t < ms; t += 100) { mock.timers.tick(100); await flush(); } };

test("followPace: every second for the first 30 s, then every 3 s (control: never the old 10 s)", () => {
  assert.equal(followPace(0), 1_000);
  assert.equal(followPace(29_999), 1_000);
  assert.equal(followPace(30_000), 3_000);
  assert.equal(followPace(3_600_000), 3_000);
});

test("D137 follow-up: leg 1 asked about every second for 30 s, then every 3 s; the payment goes within about a second of leg 1 landing; one ask at a time, never a burst (control: the old 10 s pace asks 3 times in 30 s)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-11-03T08:00:00Z") });
  try {
    const r = await rig();
    await r.sj.start(job);
    await run(30_000);
    assert.ok(r.asked.length >= 28 && r.asked.length <= 30, `about once a second for 30 s: ${r.asked.length} (the old 10 s pace: 3)`);
    const fast = r.asked.length;
    await run(30_000);
    assert.ok(r.asked.length - fast >= 9 && r.asked.length - fast <= 11, `then every 3 s: ${r.asked.length - fast} in 30 s`);
    // one ask at a time: a slow answer (5 s) holds the next one back, never piling asks up
    r.hangOnce();
    await run(3_000);
    const held = r.asked.length;
    await run(5_000);
    assert.equal(r.asked.length, held, "no second ask while one is unanswered");
    r.release(); await flush();
    // leg 1 lands: the payment goes on the next ask, within the 3 s pace (and within 1 s in the first 30 s, below)
    r.land();
    await run(3_100);
    assert.equal(r.paid.length, 1, "paid once leg 1 landed");
    assert.ok(r.paid[0]! - r.asked.at(-1)! < 100, "in the same step that read it landed");
  } finally {
    mock.timers.reset();
  }
});

test("D137 follow-up: leg 1 landing in the first 30 s is paid within about a second", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-11-03T08:00:00Z") });
  try {
    const r = await rig();
    await r.sj.start(job);
    await run(12_000);
    r.land();
    const at = Date.now();
    await run(1_100);
    assert.equal(r.paid.length, 1);
    assert.ok(r.paid[0]! - at <= 1_100, `paid ${r.paid[0]! - at} ms after leg 1 landed`);
  } finally {
    mock.timers.reset();
  }
});
