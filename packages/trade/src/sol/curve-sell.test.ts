// A pump.fun curve coin bought must be sold back down the same curve (k-trade real-money run, 4 Nov): DemWifHat
// (Hjge…cpump), a mayhem-mode curve, went to Jupiter both ways; its sell got "Solana didn't answer", then a Jupiter sheet
// that asked and ran out of time. On mainnet (4 Nov, simulated from the holding wallet, nothing sent) pump.fun's own program
// took the v3 sell of all 455,962.98 coins on that curve and paid exactly the curve maths' quote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase64 } from "./bytes.ts";
import { readStruct } from "./codec.ts";
import { createSolEngine } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { ataOf, PROGRAM } from "./keys.ts";
import { PUMP_LAYOUT } from "./layouts.ts";
import { replay, TEST_OWNER, type Row } from "./testing/replay.ts";

const pump = JSON.parse(readFileSync(new URL("./fixtures/sol-pump.json", import.meta.url), "utf8"));
const PUMPE: string = pump.coins.pumpfun.mint, CURVE: string = pump.coins.pumpfun.curve;
/** BondingCurve.is_mayhem_mode: 8 (discriminator) + 5 u64 + complete (1) + creator (32), as PUMP_LAYOUT says. */
const MAYHEM_AT = 8 + 5 * 8 + 1 + 32;

function rowsWithMayhem(): Record<string, Row> {
  const rows = { ...pump.rows };
  const b = fromBase64(rows[CURVE].data);
  b[MAYHEM_AT] = 1;
  rows[CURVE] = { ...rows[CURVE], data: Buffer.from(b).toString("base64") };
  return rows;
}

/** An engine on the captured PUMPE curve. `failReads`: so many reads of the curve that no node answers first. Jupiter is counted. */
function setup(o: { rows: Record<string, Row>; failReads?: number }) {
  const program = o.rows[PUMPE]!.owner;
  const raw = replay({ rows: o.rows, mint: PUMPE, coinProgram: program, coinAta: ataOf(TEST_OWNER, PUMPE, program), held: 455_962_983_299n });
  let fails = o.failReads ?? 0;
  const curveRead = (m: string, p?: unknown[]) => m === "getMultipleAccounts" && (p?.[0] as string[]).includes(CURVE);
  const rpc = {
    ...raw,
    call: (m: string, p?: unknown[]) => (curveRead(m, p) && fails > 0 ? (fails--, Promise.reject(new Error("HTTP 429"))) : raw.call(m, p)),
    askNodes: (m: string, p: unknown[], n: number, x?: any) => (curveRead(m, p) && fails > 0 ? (fails--, Promise.resolve([{ ok: false as const, error: "HTTP 429" }, { ok: false as const, error: "timeout" }])) : raw.askNodes(m, p, n, x)),
  };
  const jup: string[] = [];
  const fetch = (async (u: string) => { jup.push(String(u)); return new Response(JSON.stringify({ error: "No routes found", errorCode: "NO_ROUTES_FOUND" }), { status: 400 }); }) as unknown as typeof globalThis.fetch;
  const clock = { t: 1_700_000_000_000 };
  const engine = createSolEngine({ rpc: rpc as any, owner: TEST_OWNER, solUsd: async () => pump.solUsd, meta: async () => ({ symbol: "DemWifHat" }), now: () => clock.t, fetch });
  return { engine, jup, clock, fail: (n: number) => { fails = n; } };
}

test("a pump.fun mayhem-mode curve coin is bought and sold on the curve itself, named, never on Jupiter", async () => {
  const rows = rowsWithMayhem();
  assert.equal(readStruct(PUMP_LAYOUT, "BondingCurve", fromBase64(rows[CURVE]!.data)).is_mayhem_mode, true, "the fixture's curve is in mayhem mode");
  const { engine, jup } = setup({ rows });
  const sell = await engine.prepare("sell", PUMPE, { fraction: 1 });
  assert.equal(sell.quote.route, "pump.fun");
  assert.equal(sell.quote.symbol, "DemWifHat");
  assert.equal(sell.quote.payRaw, "455962983299");
  assert.equal(sell.quote.closesAccount, true);
  const buy = await engine.prepare("buy", PUMPE, { usd: 1.5 });
  assert.equal(buy.quote.route, "pump.fun");
  assert.deepEqual(jup, [], "Jupiter was never asked");
});

test("a curve read no node answered is read again: the sell stays on the curve, not on Jupiter", async () => {
  const { engine, jup } = setup({ rows: pump.rows, failReads: 1 });
  const sell = await engine.prepare("sell", PUMPE, { fraction: 1 });
  assert.equal(sell.quote.route, "pump.fun");
  assert.deepEqual(jup, [], "Jupiter was never asked");
});

test("a coin known to be on the pump.fun curve whose read fails twice says Solana didn't answer; it never switches venue silently", async () => {
  const { engine, jup, clock, fail } = setup({ rows: pump.rows });
  assert.equal((await engine.prepare("sell", PUMPE, { fraction: 0.5 })).quote.route, "pump.fun");
  clock.t += 5_000;                                                            // past the pool read's 1 s window
  fail(1_000);
  await assert.rejects(engine.prepare("sell", PUMPE, { fraction: 1 }), (e: unknown) => e instanceof TradeError && e.kind === "node");
  assert.deepEqual(jup, [], "Jupiter was never asked");
});
