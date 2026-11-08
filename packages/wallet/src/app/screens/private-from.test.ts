// D10 (audit 13, 8 Nov): Add to Private said "USDC · On NEAR · 1,247.12" with no unit, no "ready" and no why, while Home
// said 1,382.22 USDC. Now the row says its figure can go ("1,247.12 can go") and one line says the rest of Home's figure
// and where it is, so the two add up to Home's. Fails on main: no such line; the row's figure is bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canGoLabel, otherPartLine } from "./private-from.ts";
import { safeHeld } from "../format.ts";
import { grade } from "../../../../../tools/copy/voice.ts";
import type { Balance, Chain } from "../../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const row = (o: Partial<Balance>): Balance => ({ tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "0", usd: "0", bridged: false, held: "ledger", listed: true, ...o } as Balance);
const chains = [{ id: "near", name: "NEAR" }, { id: "sol", name: "Solana" }, { id: "base", name: "Base" }] as Chain[];
const from = row({ amount: "1247.12", usd: "1247.12" });
const safe = [from, row({ held: "account", amount: "60", usd: "60" }), row({ chain: "sol", bridged: true, amount: "42.1", usd: "42.1" }), row({ chain: "base", bridged: true, amount: "18", usd: "18" })];
const pocket = [row({ held: "private", amount: "15", usd: "15" })];

function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

test("D10: the row says its figure can go, and one line says the rest of Home's figure and where it is; the two add up to Home's [before: a bare 1,247.12]", () => {
  assert.equal(canGoLabel(from), "1,247.12 can go");
  const line = otherPartLine(from, safe, pocket, chains);
  assert.equal(line, "The other 135.10 USDC is in Private and on your account, Solana and Base.");
  const home = safeHeld([...safe, ...pocket], "USDC")!;
  assert.equal(home.amount, "1382.22", "Home's one figure");
  assert.ok(Math.abs(1247.12 + 135.1 - Number(home.amount)) < 1e-9, "the row and the line add up to Home's");
  assert.ok(fkGrade(line!) <= 5, `grade 5: ${fkGrade(line!).toFixed(1)}`);
  const g = grade("spine", line!);
  assert.ok(g.grade === "A" || g.grade === "B", `${g.grade} ${g.problems.join("; ")}`);
});

test("D10 controls: the place picked is all of the coin, no line; another coin's rows never count; a bare figure is gone from the row", () => {
  assert.equal(otherPartLine(from, [from], [], chains), null, "all of it here");
  const near = row({ tokenId: "near", symbol: "NEAR", amount: "300" });
  assert.equal(otherPartLine(from, [from, near], [], chains), null, "NEAR's rows are NEAR's");
  assert.equal(otherPartLine(from, [from, row({ chain: "sol", bridged: true, amount: "2" })], [], chains), "The other 2.00 USDC is on Solana.");
  const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
  assert.match(src, /<span className="wl-change">\{from \? canGoLabel\(from\) : ""\} <Down \/><\/span>/);
  assert.match(src, /\{otherLine && <p className="zf-small wl-place" data-testid="private-other">\{otherLine\}<\/p>\}/);
  assert.doesNotMatch(src, /wl-change">\{from \? amountOf\(from\.amount/, "control: never the bare figure");
});
