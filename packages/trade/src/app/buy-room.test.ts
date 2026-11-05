// webd-money2 crawl (4 Nov): the Buy sheet said "$0.14 to spend" on a $1.15 SOL wallet (the planner's flat $1 reserve),
// yet the $0.50 buy went through. The figure is what the Solana engine really keeps (payOf), at the wallet's own price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOL_BUY_KEEP_LAMPORTS, buyRoomUsd } from "./buy-room.ts";
import { BASE_FEE, PRIO_RESERVE, TOKEN22_RENT, TOKEN_RENT, payOf } from "../sol/context.ts";

test("a $1.15 SOL wallet (0.012 SOL) can spend about $0.85, never $0.14 (control: the planner's figure was $0.14)", () => {
  const room = buyRoomUsd({ chain: "sol", nativeUsd: 1.15, readyUsd: 0.14, nativeAmount: "0.012" });
  assert.ok(room > 0.8 && room < 0.9, String(room));
  assert.equal(buyRoomUsd({ chain: "sol", nativeUsd: 1.15, readyUsd: 0.14 }), 0.14, "control: unread amount keeps the ready figure");
  assert.equal(buyRoomUsd({ chain: "hood", nativeUsd: 5, readyUsd: 4.7, nativeAmount: "0.0015" }), 4.7, "control: EVM chains keep their reserve");
  assert.equal(buyRoomUsd({ chain: "sol", nativeUsd: 0.2, readyUsd: 0, nativeAmount: "0.002" }), 0, "never below zero");
});

test("the keep is payOf's own (two fee reserves, a Token-2022 account's rent, the wSOL account's rent); a buy of all of it goes, a cent more doesn't", () => {
  assert.equal(BigInt(SOL_BUY_KEEP_LAMPORTS), 2n * (BASE_FEE + PRIO_RESERVE) + TOKEN22_RENT + TOKEN_RENT);
  const bal = 12_000_000n, solUsd = 1.15 / 0.012;
  const room = buyRoomUsd({ chain: "sol", nativeUsd: 1.15, readyUsd: 0.14, nativeAmount: "0.012" });
  const o = { bal, held: 0n, solUsd, rentNew: TOKEN22_RENT, wsolRent: TOKEN_RENT, symbol: "X" };
  assert.ok(payOf("buy", { usd: room }, o) > 0n, "the room is buyable");
  assert.throws(() => payOf("buy", { usd: room + 0.05 }, o), /Not enough SOL/, "control: past it the engine refuses");
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const walletUsd = side === "buy" \? \(chainView \? buyRoomUsd\(chainView\) : wallet\.value\?\.nativeUsd\) : undefined;/);
  assert.match(sheet, /const ready = chainView \? buyRoomUsd\(chainView\) :/);
});
