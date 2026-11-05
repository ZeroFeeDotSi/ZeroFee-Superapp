// The independent grade (3 Nov, w-n06 vs w-h07): Details said 324.9 NEAR $1,439.30 and 1,050.60 USDC where Home said
// 326.9 NEAR $1,448.16 and 1,081.51 USDC. Details counted the Safe's own coins; Home counted the pocket's under them too
// (D128). One source now: format.ts safeLines, read from the view Home shows, on Home, Details and the money sheets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lines, safeLines } from "./format.ts";
import type { Balance, PrivatePocket } from "../types.ts";

const row = (symbol: string, tokenId: string, amount: string, usd: string, held: Balance["held"] = "ledger"): Balance => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain: "near", amount, usd, bridged: false, held, listed: true });
const SAFE = [row("NEAR", "nep141:wrap.near", "324.9", "1439.30"), row("USDC", "nep141:usdc", "1050.60", "1050.60")];
const POCKET: PrivatePocket = { available: true, ready: true, defaultOn: true, rows: [row("NEAR", "nep141:wrap.near", "2", "8.86", "private"), row("USDC", "nep141:usdc", "30.91", "30.91", "private")] };

test("one Safe on every screen: its coins with the pocket's counted under them (control: the Safe's own coins alone are what Details said)", () => {
  const one = safeLines(SAFE, POCKET, [], []);
  const near = one.lines.find((l) => l.symbol === "NEAR")!, usdc = one.lines.find((l) => l.symbol === "USDC")!;
  assert.equal(near.amount, "326.9");
  assert.equal(near.usd, "1448.16");
  assert.equal(usdc.usd, "1081.51");
  const old = lines(SAFE, [], []);
  assert.equal(old.lines.find((l) => l.symbol === "NEAR")!.usd, "1439.30", "control: Details' old figure");
  assert.equal(safeLines(SAFE, { ...POCKET, available: false }, [], []).totalUsd, old.totalUsd, "control: a pocket not there adds nothing");
});

test("Home, Details and the money sheets read the Safe through safeLines, and Details reads the view Home shows (control: no screen builds its own)", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(src("./screens/Home.tsx"), /const safe = read && balances \? safeLines\(balances, pocket, chains, earning\) : null;/);
  const details = src("./screens/Details.tsx");
  assert.match(details, /const \{ bridge, kid, shown: view \} = useWallet\(\);\s*const \{ balances, chains, earning, pocket \} = view;/);
  assert.match(details, /const safe = balances \? safeLines\(balances, pocket, chains, earning\) : null;/);
  assert.doesNotMatch(details, /lines\(balances, chains, earning\)/, "control: Details' own count is gone");
  assert.match(src("./money/MoneyHost.tsx"), /const safeUsd = balances \? safeLines\(balances, pocket, chains, earning\)\.totalUsd : null;/);
});
