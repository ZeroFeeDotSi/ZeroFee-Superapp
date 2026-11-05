// Security audit 4 Nov, finding 2 (and its review, items 1 and 2): after new backup words the core moves what the old
// private balance and NEAR wallet hold into the new ones. Until it has moved, that money is never invisible: Private's
// total counts it and its screen shows it with Try again; and each move is a row in Activity, "Moved $X from your old
// wallets to Private" (or to your NEAR wallet, for the old NEAR wallet's coins). Wording: Copywriter, batch 4.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import { balanceTotal, describe, oldWalletsLine, privateAllUsd } from "./app/format.ts";
import type { Movement, PrivatePocket, Token } from "./types.ts";

const ME = "kid.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const AT = "2026-11-04T12:00:00.000Z";

function setup(old: { moving: number; left: number; unread?: true; coins: { kind: string; tokenId: string; amount: string; state: string }[] } | null, moves: unknown[] = []) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "3000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const asked: string[] = [];
  const bridge: Bridge = {
    call: async <T>(method: string, p?: Record<string, unknown>): Promise<BridgeResult<T>> => {
      if (method === "subwallet.oldWords") return (asked.push(method), old ? { ok: old as T } : { problem: { code: "security.oneclick.unreachable", whatHappened: "No.", money: { state: "safe" }, next: { kind: "nothing", label: "OK" } } as never });
      if (method === "subwallet.oldWords.moves") return (asked.push(method), { ok: moves as T });
      if (method === "subwallet.oldWords.move") return (asked.push(method), { ok: (old ?? {}) as T });
      return core.call<T>(method, p);
    },
    on: core.on.bind(core),
  } as Bridge;
  const ledger = createLedgerService({ bridge, chain: fakeNear(ME, { ledger: {} }), apis: createApis(replayFetch({ privateQuotes: `${RELAY}/v0` })), routes: { intents: false, nearOrigin: true }, trackMs: 5, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY });
  return { ledger, asked };
}
const ok = async <T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> => {
  const r = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

test("review 2: what the old wallets hold is in Private's total and on its own rows, never in the rows Send spends from", async () => {
  const { ledger } = setup({ moving: 1, left: 1, coins: [{ kind: "private", tokenId: USDC, amount: "5000000", state: "moving" }, { kind: "trade", tokenId: USDC, amount: "2000000", state: "stuck" }] });
  const pocket = await ok<PrivatePocket>(ledger, "ledger.private", { caller: "wallet" });
  assert.deepEqual(pocket.rows.map((r) => r.amount), ["3"], "the new private balance's own rows: only what it holds");
  assert.deepEqual(pocket.oldWords?.rows.map((r) => r.amount), ["5", "2"]);
  assert.deepEqual([pocket.oldWords?.moving, pocket.oldWords?.stuck, pocket.oldWords?.left], [true, true, false]);
  assert.equal(Number(privateAllUsd(pocket)).toFixed(0), "10", "3 + 5 + 2 USDC, about $10");
  assert.equal(Number(balanceTotal([], [], [], pocket)).toFixed(0), "10", "Home's one total counts it too");
  // control: nothing in the old wallets, nothing extra
  const none = await ok<PrivatePocket>(setup({ moving: 0, left: 0, coins: [] }).ledger, "ledger.private", { caller: "wallet" });
  assert.equal(none.oldWords, undefined);
  // a read that failed is said, never an empty old wallet
  const unread = await ok<PrivatePocket>(setup(null).ledger, "ledger.private", { caller: "wallet" });
  assert.deepEqual([unread.oldWords?.rows.length, unread.oldWords?.unread], [0, true]);
});

test("review 2: Try again asks the core to move the old wallets' money now", async () => {
  const { ledger, asked } = setup({ moving: 0, left: 1, coins: [{ kind: "private", tokenId: USDC, amount: "5000000", state: "stuck" }] });
  await ok(ledger, "ledger.oldWordsMove", { caller: "wallet" });
  assert.ok(asked.includes("subwallet.oldWords.move"));
});

test("the old wallets' line says every state that is true at once, in the Copywriter's words", () => {
  assert.equal(oldWalletsLine({ moving: true, stuck: false, left: false }), "Moving to your new wallets.");
  assert.equal(oldWalletsLine({ moving: false, stuck: true, left: false }), "It didn't move yet.");
  assert.equal(oldWalletsLine({ moving: true, stuck: true, left: true }), "Moving to your new wallets. Some of it didn't move yet. Too small for the swap service to move. It stays there.");
  assert.equal(oldWalletsLine({ moving: false, stuck: false, left: false, unread: true }), "Not all of it loaded, so this total may be low.");
});

test("Activity: one row for each move from the old wallets, to Private or to the NEAR wallet, with its dollars (a failed try is no row)", async () => {
  const move = (id: string, kind: string, status: string, amount: string) => ({ id, kind, status, where: "in-flight", sent: { tokenId: USDC, amount }, expected: { tokenId: USDC, amount }, startedAtIso: AT, updatedAtIso: AT });
  const { ledger } = setup({ moving: 0, left: 0, coins: [] }, [move("pm-a", "private", "done", "5000000"), move("pm-b", "trade", "pending", "2000000"), move("pm-c", "private", "failed", "0")]);
  const rows = (await ok<Movement[]>(ledger, "ledger.activity", { caller: "wallet" })).filter((m) => m.from === "oldWords");
  assert.deepEqual(rows.map((m) => [m.id, m.status, m.amount, m.into ?? "private"]), [["oldwords:pm-a", "done", "5", "private"], ["oldwords:pm-b", "moving", "2", "near"]]);
  const tokens = new Map<string, Token>([[USDC, { assetId: USDC, chain: "near", symbol: "USDC", decimals: 6, contract: null }]]);
  assert.match(describe(rows[0]!, tokens, []).title, /^Moved \$\d+\.\d{2} from your old wallets to Private$/);
  assert.match(describe(rows[1]!, tokens, []).title, /^Moving \$\d+\.\d{2} from your old wallets to your NEAR wallet$/);
  // another app's Activity never lists them
  assert.equal((await ok<Movement[]>(ledger, "ledger.activity", { caller: "pay" })).filter((m) => m.from === "oldWords").length, 0);
});

test("Activity's words for a move from the old wallets: no price, the amount in its coin", () => {
  const tokens = new Map<string, Token>([[USDC, { assetId: USDC, chain: "near", symbol: "USDC", decimals: 6, contract: null }]]);
  const m: Movement = { id: "oldwords:x", kind: "private", status: "done", from: "oldWords", to: USDC, amount: "5", startedAtIso: AT, updatedAtIso: AT, explorerUrls: [] };
  assert.deepEqual(describe(m, tokens, []), { title: "Moved 5 USDC from your old wallets to Private", detail: "5 USDC" });
  assert.equal(describe({ ...m, usd: "5.004" }, tokens, []).title, "Moved $5.00 from your old wallets to Private");
});
