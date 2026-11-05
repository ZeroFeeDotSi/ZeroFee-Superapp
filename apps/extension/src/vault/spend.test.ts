import { test } from "node:test";
import assert from "node:assert/strict";
import type { NodeAnswer, SolRpc } from "@zerofee/trade/sol/rpc.ts";
import { BLOCKHASH } from "@zerofee/trade/sol/testing/replay.ts";
import { buildTx, transfer } from "@zerofee/trade/sol/tx.ts";
import { simulatedSpend, StaleBlockhash } from "./spend.ts";

const owner = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const fake = (given: Record<string, NodeAnswer[]>): SolRpc & { asked: unknown[][] } => {
  const answers = { isBlockhashValid: recent, ...given };
  const asked: unknown[][] = [];
  return {
    asked,
    call: async () => { throw new Error("not used"); },
    askNodes: async (method, params, max) => { asked.push([method, params, max]); return answers[method] ?? []; },
  };
};
const TX = buildTx(owner, BLOCKHASH, [transfer(owner, owner, 1n)]);
const recent: NodeAnswer[] = [{ ok: true, value: { context: { slot: 1 }, value: true } }, { ok: true, value: { context: { slot: 1 }, value: true } }];
const bal = (n: number): NodeAnswer => ({ ok: true, value: { context: { slot: 1 }, value: n } });
const sim = (lamports: number, err: unknown = null): NodeAnswer => ({ ok: true, value: { context: { slot: 1 }, value: { err, accounts: [{ lamports }] } } });

test("the spend is the balance now minus the balance after the simulation, asked of two nodes", async () => {
  const rpc = fake({ getBalance: [bal(1_000_000_000), bal(1_000_000_000)], simulateTransaction: [sim(900_000_000), sim(900_000_000)] });
  assert.equal(await simulatedSpend(rpc, TX, owner), 100_000_000n);
  assert.deepEqual(rpc.asked.map((a) => [a[0], a[2]]), [["isBlockhashValid", 2], ["getBalance", 2], ["simulateTransaction", 2]]);
  assert.deepEqual((rpc.asked[0]![1] as unknown[])[0], BLOCKHASH);
  const simParams = rpc.asked[2]![1] as [string, { sigVerify: boolean; accounts: { addresses: string[] } }];
  assert.equal(simParams[1].sigVerify, false);
  assert.deepEqual(simParams[1].accounts.addresses, [owner]);
});

test("nodes that disagree can only make the spend look bigger", async () => {
  const rpc = fake({ getBalance: [bal(1_000_000_000), bal(1_200_000_000)], simulateTransaction: [sim(950_000_000), sim(800_000_000)] });
  assert.equal(await simulatedSpend(rpc, TX, owner), 400_000_000n);
});

test("a sell brings SOL in: the spend is negative", async () => {
  const rpc = fake({ getBalance: [bal(1_000_000_000)], simulateTransaction: [sim(1_300_000_000)] });
  assert.equal(await simulatedSpend(rpc, TX, owner), -300_000_000n);
});

test("no usable answer, or a failing simulation, is an error, never a guess", async () => {
  await assert.rejects(simulatedSpend(fake({ getBalance: [bal(1)], simulateTransaction: [{ ok: false, error: "down" }] }), TX, owner));
  await assert.rejects(simulatedSpend(fake({ getBalance: [bal(1)], simulateTransaction: [sim(0, { InstructionError: [0, "Custom"] })] }), TX, owner));
  await assert.rejects(simulatedSpend(fake({ getBalance: [], simulateTransaction: [sim(0)] }), TX, owner));
});

test("a blockhash any node calls old is refused, so nothing signed can be sent later", async () => {
  const old: NodeAnswer[] = [{ ok: true, value: { context: { slot: 1 }, value: true } }, { ok: true, value: { context: { slot: 1 }, value: false } }];
  await assert.rejects(simulatedSpend(fake({ isBlockhashValid: old, getBalance: [bal(1)], simulateTransaction: [sim(0)] }), TX, owner), StaleBlockhash);
  await assert.rejects(simulatedSpend(fake({ isBlockhashValid: [], getBalance: [bal(1)], simulateTransaction: [sim(0)] }), TX, owner), /recent/);
});
