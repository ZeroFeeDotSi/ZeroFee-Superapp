// QA's real-money lap (5 Nov): the Safe gave at most $2.29 of $10.06 per Move and no line said
// why. The reason (one coin per move, or the wallets' limit) is said under the Safe's row as soon as its slider moves (copy review,
// 5 Nov), not only at its lowest. The fill is open now, so the Safe's own largest coin counts (the gate's $0 is gone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVE_WORDS, safeCoinMost, safeKeeps, type PlaceNow } from "./move-split.ts";

test("the Safe's reason is shown once its slider moves; the words say which limit holds (control: a Safe that can give it all says nothing)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /x\.place === "safe" && !r\.still && \(v <= r\.floor \+ 0\.004 \|\| Math\.abs\(v - \(start\.safe \?\? 0\)\) >= 0\.005\) && keeps && <p className="zf-small wl-mv-hint" data-testid="move-safe-keeps">/);
  // the lap's Safe: NEAR $8.00 and USDC $2.05; one coin pays a Move
  const coins = [{ tokenId: "near", amount: "3.6", usd: "8.00", symbol: "NEAR" }, { tokenId: "nep141:usdc", amount: "2.05", usd: "2.05", symbol: "USDC" }];
  const most = safeCoinMost(coins);
  assert.ok(most > 7.5 && most < 8, `its NEAR, less the Move's fee room: ${most}`);
  const now: PlaceNow[] = [{ place: "safe", usd: 10.05, lo: 10.05 - most }, { place: "sol", usd: 0, lo: 0 }];
  assert.equal(safeKeeps(now, { coinUsd: most, roomUsd: 100, capUsd: "100" }), MOVE_WORDS.safeKeepsCoin(`$${(10.05 - most).toFixed(2)}`), "one coin per move");
  assert.equal(safeKeeps(now.map((p) => (p.place === "safe" ? { ...p, lo: 7.76 } : p)), { coinUsd: most, roomUsd: 2.29, capUsd: "5" }), MOVE_WORDS.safeKeepsCap("$7.76", "$5"), "the wallets' limit");
  assert.equal(safeKeeps([{ place: "safe", usd: 8, lo: 0 }], { coinUsd: 8, roomUsd: 100, capUsd: "100" }), null, "control: it can give it all");
});
