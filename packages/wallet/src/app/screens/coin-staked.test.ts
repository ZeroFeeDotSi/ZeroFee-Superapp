// Dead ends row 7 (3 Nov, D116): a staked NEAR coin page had "Open Earn", which opened "That part of ZeroFee isn't in
// this build yet." (Earn is still being built; nothing else unstakes). The button is gone; one plain line says why the
// staked part can't be sent. Control: the old words and the Earn opener are gone from the page and from Wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grade } from "../../../../../tools/copy/voice.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("staked NEAR's coin page says one fact and opens nothing that isn't built", () => {
  const coin = src("./Coin.tsx");
  assert.match(coin, /export const STAKED_LINE = "Staked NEAR counts in your Safe\. You can't send it while it's staked\.";/);
  assert.match(coin, /\{STAKED_LINE\}/, "the page draws the line");
  assert.doesNotMatch(coin, /Open Earn|onEarn/, "no button to a part that isn't built");
  assert.doesNotMatch(src("../WalletApp.tsx"), /openApp\("earn"\)/, "Wallet opens no Earn from a coin");
  const g = grade("spine", "Staked NEAR counts in your Safe. You can't send it while it's staked.");
  assert.ok(g.grade === "A" || g.grade === "B", g.problems.join("; "));
});
