// Builder 23, item 1 (audit 18 S18-4; "What A means": a down chain's wallet figure carries its "As of" time). Trenches'
// chip and Social trading's sites keep the last figure while Solana or Robinhood Chain is down, with one line naming who
// and the figure's time, in Home's Hot words ("As of 2:25 PM"). Fails on main 5d80fde2e (no keptLine, no readAt/kept).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCoreFloat } from "../float-core.ts";
import { keptLine } from "./chain-down.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const at = Date.UTC(2026, 10, 8, 14, 25);

test("keptLine: who is down, the wallet, the figure's time (grade 5, one idea a sentence)", () => {
  assert.equal(keptLine("sol", true, "SOL wallet is", at, "en-US").replace(/ /g, " "), `Solana is down. SOL wallet is as of ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at).replace(/ /g, " ")}.`);
  assert.match(keptLine("hood", true, "Robinhood wallet is", at, "en-US"), /^Robinhood Chain is down\. Robinhood wallet is as of \d{1,2}:\d\d\s?[AP]M\.$/u);
  assert.match(keptLine("sol", false, "Site wallets are", at, "en-US"), /^Solana didn't answer\. Site wallets are as of /);
  assert.doesNotMatch(keptLine("hood", true, "Robinhood wallet is", at), /…|BNB|Base/);
});

test("the float says when each chain last answered, and which chains show a kept figure", async () => {
  let t = at;
  let fail = false;
  const wallets = async () => [
    { id: "s1", chain: "sol" as const, current: true, nativeUsd: 144.37, coinsUsd: 0, ...(fail ? { unread: true as const } : {}) },
    { id: "h1", chain: "hood" as const, current: true, nativeUsd: 28.17, coinsUsd: 0 },
  ];
  const store = new Map<string, unknown>();
  const call = (async (m: string) => (m === "subwallet.float.balance" ? { usd: 10, asOfIso: new Date(t).toISOString() } : m === "subwallet.float.limits" ? { movesLeftToday: 5 } : [])) as never;
  const f = createCoreFloat({ call, wallets, nativeUsd: async () => 1, get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v), now: () => t, every: () => () => undefined });
  await f.refresh();
  let sol = f.snapshot().chains.find((c) => c.chain === "sol")!;
  assert.equal(sol.readAt, at);
  assert.equal(sol.kept, undefined);
  fail = true; t = at + 60_000;
  await f.refresh();
  const s = f.snapshot();
  sol = s.chains.find((c) => c.chain === "sol")!;
  const hood = s.chains.find((c) => c.chain === "hood")!;
  assert.equal(sol.kept, true, "the SOL wallet didn't answer: its figure is the kept one");
  assert.equal(sol.readAt, at, "kept from the read before");
  assert.equal(sol.nativeUsd, 144.37, "the last figure stands, never $0");
  assert.equal(hood.readAt, at + 60_000, "Robinhood answered now");
  assert.equal(hood.kept, undefined);
});

test("Trenches' strip and Social trading's list say the line (place: under the strip, under the list)", () => {
  const disc = read("./screens/Discover.tsx");
  assert.match(disc, /keptLine\(c, down, `\$\{c === "hood" \? "Robinhood" : CHAIN_SHORT\[c\]\} wallet is`, view\.readAt\)/);
  assert.match(disc, /data-testid="dc-as-of"/);
  const social = read("../../../browser/src/social/SocialTradingApp.tsx");
  assert.match(social, /data-testid="social-as-of"/);
  assert.match(social, /unread\.includes\(a\.id\) \? kept\[a\.id\]\?\.usd : figures\[a\.id\]/, "a site Solana can't read shows its kept figure");
});
