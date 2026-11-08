// Builder 22's item 5 (8 Nov; b20's open edge on audit 12's S7): the NEAR page said "Up to 238.5275 NEAR can go in one
// sell." under "You hold 253.0275 NEAR" with no why. Now the line says where the rest sits, in one grade-5 sentence, from
// the same read as the figure (balance-parts readSafeHeld `rest`: Private's rows, NEAR staked with validators); the
// figure is said once. Fails on main: no `rest`, the line has no why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountOf } from "@zerofee/wallet/app/format.ts";
import { readSafeHeld } from "@zerofee/wallet/app/balance-parts.ts";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { NATIVE_COPY as W } from "./words.ts";

function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, ""); return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length); };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

const NEAR = "nep141:wrap.near";
const bridgeOf = (o: { pocket: string | null; staked: string | null }): Bridge => ({
  call<T>(method: string): Promise<BridgeResult<T>> {
    const ok = (v: unknown) => Promise.resolve({ ok: v as T });
    if (method === "ledger.balances") return ok([{ tokenId: NEAR, symbol: "NEAR", amount: "238.527539", usd: "1056.68" }]);
    if (method === "ledger.tokens") return ok([{ assetId: NEAR, symbol: "NEAR", priceUsd: "4.43" }]);
    if (method === "earn.positions") return ok(o.staked ? [{ poolId: "p.poolv1.near", name: "P", staked: o.staked, unstaked: "0", canWithdraw: false }] : []);
    if (method === "ledger.private") return ok(o.pocket ? { available: true, rows: [{ tokenId: NEAR, symbol: "NEAR", amount: o.pocket, usd: "64.24" }] } : { available: false, rows: [] });
    if (method === "account.state") return ok({ kid: false });
    return ok(null);
  },
  on: () => () => {},
});

test("sell-why-b22: the cap line says where the rest is, one grade-5 sentence, the figure once", () => {
  const amt = amountOf("238.527539", "NEAR", 24);
  const lines = [W.sellPart(amt, "NEAR", ["private"]), W.sellPart(amt, "NEAR", ["staked"]), W.sellPart(amt, "NEAR", ["private", "staked"])];
  assert.deepEqual(lines, [
    "Up to 238.5275 NEAR can go in one sell. The rest is in Private.",
    "Up to 238.5275 NEAR can go in one sell. The rest is staked.",
    "Up to 238.5275 NEAR can go in one sell. The rest is in Private and staked.",
  ]);
  for (const l of lines) {
    assert.ok(fkGrade(l) <= 5, `${fkGrade(l).toFixed(1)}: ${l}`);
    assert.equal((l.match(/\d[\d.,]*/g) ?? []).length, 1, `one figure: ${l}`);
  }
  assert.equal(W.sellPart(amt, "NEAR"), "Up to 238.5275 NEAR can go in one sell.", "nothing known: the cap alone, never a guess");
});

test("sell-why-b22: readSafeHeld says where the rest sits, from the same reads as the figure", async () => {
  assert.deepEqual((await readSafeHeld(bridgeOf({ pocket: "14.5", staked: null }), NEAR))?.rest, ["private"]);
  assert.deepEqual((await readSafeHeld(bridgeOf({ pocket: null, staked: "10" }), NEAR))?.rest, ["staked"]);
  assert.deepEqual((await readSafeHeld(bridgeOf({ pocket: "14.5", staked: "10" }), NEAR))?.rest, ["private", "staked"]);
  assert.equal((await readSafeHeld(bridgeOf({ pocket: null, staked: null }), NEAR))?.rest, undefined, "all of it sells: no rest");
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("W.sellPart(amountOf(held!, symbol, row?.decimals), symbol, figure?.rest)"));
});
