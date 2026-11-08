// Builder 25, item 2 (audit 19's J8 item 4): a site wallet before its first read showed "…" (site-wallet.ts walletView,
// SiteWalletApp's `settling`, Your wallets' "Looking…" and total "…"). Now: the kept figure with "As of 2:41 PM", else
// "Reading" with who reads it ("Solana is reading GMGN's wallet."), never an ellipsis. Fails on main 437575a59.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingWallet } from "@zerofee/core/spending";
import { shortTime } from "@zerofee/core/clock";
import { walletView, READING, readingWho } from "./site-wallet.ts";
import { words, yourWallets } from "./your-wallets.ts";

const NOW = Date.parse("2026-11-08T07:41:00Z");
const AT = Date.parse("2026-11-08T07:30:00Z");

test("the wallet page's first read: its kept figure with its time, else Reading with who reads it", () => {
  const kept = walletView({ site: "gmgn", name: "GMGN", read: "first", kept: { usd: 4.2, at: AT }, now: NOW });
  assert.equal(kept.dollars, "$4.20");
  assert.equal(kept.asOf, `As of ${shortTime(AT)}`, "a kept figure always says when it was read");
  const none = walletView({ site: "gmgn", name: "GMGN", read: "first", now: NOW });
  assert.equal(none.dollars, "Reading");
  assert.equal(none.asOf, "Solana is reading GMGN's wallet.");
  assert.equal(READING, "Reading");
  assert.equal(readingWho("pump.fun"), "Solana is reading pump.fun's wallet.");
  for (const v of [kept, none]) assert.doesNotMatch(JSON.stringify(v), /…|\.\.\./);
});

test("Your wallets' first read: Reading, never Looking… or a lone …", () => {
  const w = { id: "j", role: "site", site: "pump", network: "sol", current: true, unread: true, address: "A", label: "" } as unknown as SpendingWallet;
  const first = yourWallets({ list: [], read: "first" });
  assert.equal(first.total, "Reading");
  const card = yourWallets({ list: [w], read: "first" }).money[0]!;
  assert.equal(card.dollars, "Reading");
  assert.equal(words.looking, "Reading");
  assert.equal(words.reading, "Solana is reading your site wallets.");
  assert.doesNotMatch(JSON.stringify(words), /…/);
});

test("the pages draw no ellipsis while reading", () => {
  for (const f of ["./SiteWalletApp.tsx", "./YourWallets.tsx", "./site-wallet.ts", "./your-wallets.ts", "./SocialHub.tsx"]) {
    const code = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    assert.doesNotMatch(code, /"…"|Looking…/, f);
  }
  // the hub's tile before its first read with nothing kept: Reading, never a blank figure
  assert.match(readFileSync(new URL("./SocialHub.tsx", import.meta.url), "utf8"), /usd\(keptHub\(\)\[r\.site\]!\.usd\) : READING\)/);
});
