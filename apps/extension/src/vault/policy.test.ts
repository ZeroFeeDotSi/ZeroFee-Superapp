import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64, cat, fromBase64, u32le, u64le } from "@zerofee/trade/sol/bytes.ts";
import { ataOf, key, PROGRAM, WSOL } from "@zerofee/trade/sol/keys.ts";
import { BLOCKHASH, TEST_OWNER } from "@zerofee/trade/sol/testing/replay.ts";
import { buildTx, closeAccount, computeLimit, computePrice, createAtaIdempotent, ix, R, S, transfer, unsignedTx, W, WS, wrapSol, type Instruction } from "@zerofee/trade/sol/tx.ts";
import { checkSolTx, MAX_PRIORITY_LAMPORTS } from "./policy.ts";

const golden = JSON.parse(readFileSync(new URL("../../../../packages/trade/src/sol/fixtures/sol-golden.json", import.meta.url), "utf8"));
const owner = TEST_OWNER;
const stranger = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const mint = "EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump";
const ata = ataOf(owner, mint, PROGRAM.token);
const trade = { kind: "trade" } as const;
const tx = (ixs: Instruction[], payer = owner) => buildTx(payer, BLOCKHASH, ixs);
const refused = (txB64: string, purpose: Parameters<typeof checkSolTx>[2] = trade) => {
  const v = checkSolTx(txB64, owner, purpose);
  assert.equal(v.ok, false);
  return v.ok ? "" : v.why;
};

test("every swap the old engine signed passes: pump.fun, PumpSwap, CP-Swap, DBC, LaunchLab, DAMM v2", () => {
  const cases = golden.cases.filter((c: { message?: string }) => c.message);
  assert.equal(cases.length, 13);
  for (const c of cases) {
    const t = base64(unsignedTx(fromBase64(c.message)));
    assert.deepEqual(checkSolTx(t, owner, trade), { ok: true }, c.name);
    assert.equal(checkSolTx(t, stranger, trade).ok, false, `${c.name}, for another wallet`);
    assert.equal(checkSolTx(t, owner, { kind: "withdraw", to: stranger }).ok, false, `${c.name}, as a transfer home`);
  }
});

test("wrapping SOL into this wallet's own account passes; SOL to anyone else doesn't", () => {
  const wsol = ataOf(owner, WSOL, PROGRAM.token);
  assert.deepEqual(checkSolTx(tx([createAtaIdempotent(owner, owner, WSOL, PROGRAM.token), ...wrapSol(owner, wsol, 1_000n)]), owner, trade), { ok: true });
  assert.match(refused(tx([transfer(owner, stranger, 1n)])), /someone else/);
  assert.match(refused(tx([ix(PROGRAM.system, [WS(owner)], cat(u32le(1), key(stranger)))])), /only system instruction/); // assign
  const recentBlockhashes = "SysvarRecentB1ockHashes11111111111111111111";
  assert.match(refused(tx([ix(PROGRAM.system, [W(stranger), R(recentBlockhashes), S(owner)], u32le(4)), closeAccount(ata, owner)])), /only system instruction/); // a durable nonce
});

test("bringing money back: only a transfer to home, and nothing else", () => {
  const home = { kind: "withdraw", to: stranger } as const;
  assert.deepEqual(checkSolTx(tx([computePrice(10_000n), transfer(owner, stranger, 5_000n)]), owner, home), { ok: true });
  assert.match(refused(tx([transfer(owner, mint, 5_000n)]), home), /someone else/);
  assert.match(refused(tx([computePrice(10_000n)]), home), /must send to home/);
  assert.match(refused(tx([transfer(owner, stranger, 5_000n), ix(PROGRAM.pump, [WS(owner)], [1])]), home), /trades nothing/);
  assert.match(refused(tx([transfer(owner, stranger, 5_000n)])), /someone else/);       // home is not a trade's destination
});

test("token accounts: closed only back to this wallet; no transfer, allowance or authority change", () => {
  assert.deepEqual(checkSolTx(tx([closeAccount(ata, owner)]), owner, trade), { ok: true });
  assert.match(refused(tx([ix(PROGRAM.token, [W(ata), W(stranger), S(owner)], [9])])), /move or hand over/);
  assert.match(refused(tx([ix(PROGRAM.token, [W(ata), W(stranger), S(owner)], cat([3], u64le(1n)))])), /move or hand over/);
  assert.match(refused(tx([ix(PROGRAM.token, [W(ata), R(stranger), S(owner)], cat([4], u64le(1n)))])), /move or hand over/);
  assert.match(refused(tx([ix(PROGRAM.token, [W(ata), S(owner)], cat([6, 2, 1], key(stranger)))])), /move or hand over/);
  assert.match(refused(tx([ix(PROGRAM.token2022, [W(ata), W(stranger), S(owner)], cat([12], u64le(1n), [6]))])), /move or hand over/);
});

test("token accounts are opened only for this wallet", () => {
  assert.deepEqual(checkSolTx(tx([createAtaIdempotent(owner, owner, mint, PROGRAM.token)]), owner, trade), { ok: true });
  assert.match(refused(tx([createAtaIdempotent(owner, stranger, mint, PROGRAM.token)])), /someone else/);
});

test("only listed programs, and this wallet as the only signer and fee payer", () => {
  assert.match(refused(tx([ix(stranger, [W(owner)], [1])])), /isn't on the list/);
  assert.match(refused(tx([ix(PROGRAM.pump, [WS(owner), S(stranger)], [1])])), /only signer/);
  assert.match(refused(tx([ix(PROGRAM.pump, [WS(owner)], [1])], stranger)), /only signer/);
  assert.match(refused("not a transaction"), /can't be read/);
});

test("the priority fee has a cap", () => {
  assert.deepEqual(checkSolTx(tx([computeLimit(200_000), computePrice(100_000n), closeAccount(ata, owner)]), owner, trade), { ok: true });
  const over = (MAX_PRIORITY_LAMPORTS * 1_000_000n) / 200_000n + 1n;                     // microlamports per unit just over the cap
  assert.match(refused(tx([computeLimit(200_000), computePrice(over), closeAccount(ata, owner)])), /priority fee/);
  assert.match(refused(tx([computePrice(over), closeAccount(ata, owner)])), /priority fee/); // no limit: the default units count
  assert.match(refused(tx([ix(PROGRAM.computeBudget, [], [9])])), /compute-budget/);
});
