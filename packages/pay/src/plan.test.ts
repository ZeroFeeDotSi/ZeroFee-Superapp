import { test } from "node:test";
import assert from "node:assert/strict";
import type { Balance } from "@zerofee/wallet/types.ts";
import { sourcesFor, type PayTarget } from "./plan.ts";
import { RECORDED_TOKENS } from "./testing/recorded-tokens.ts";

const token = (assetId: string) => RECORDED_TOKENS.find((t) => t.assetId === assetId)!;
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const row = (tokenId: string, amount: string, held: "ledger" | "account", extra: Partial<Balance> = {}): Balance => {
  const t = RECORDED_TOKENS.find((x) => x.assetId === tokenId);
  return { tokenId, symbol: t?.symbol ?? "NEAR", name: "", icon: "", chain: t?.chain ?? "near", amount, usd: amount, bridged: tokenId.includes("omft"), held, listed: true, ...extra };
};
const toFriend = (amount: string): PayTarget => ({ to: { kind: "ledger", accountId: "alex.near" }, token: token(USDC_NEAR), amount, notes: [] });

test("a coin in two places pays from one of them, never the two added together", () => {
  const both = [row(USDC_NEAR, "3", "ledger"), row(USDC_NEAR, "5", "account")];
  const four = sourcesFor(toFriend("4"), both);
  assert.equal(four.length, 1, "one choice for the coin; the ledger picks the place that covers it");
  assert.equal(four[0].payTokenId, USDC_NEAR);
  assert.deepEqual(sourcesFor(toFriend("6"), both), [], "3 here and 5 there don't make 6");
});

test("a coin on the account never pays out to another network", () => {
  const target: PayTarget = { to: { kind: "chain", chain: "sol", address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" }, token: token(USDC_SOL), amount: "4", notes: [] };
  assert.deepEqual(sourcesFor(target, [row(USDC_SOL, "10", "account")]), []);
  assert.equal(sourcesFor(target, [row(USDC_SOL, "10", "ledger")]).length, 1);
});

test("a coin the ledger can't name never pays, whatever it calls itself", () => {
  const fake = row(USDC_NEAR, "1000", "account", { tokenId: "nep141:usdc.scam.near", symbol: "USDC", listed: false });
  assert.deepEqual(sourcesFor(toFriend("4"), [fake], undefined, { anyCoin: true }), []);
});

test("native NEAR on the account pays a NEAR code to a NEAR account, spent as the wrapped-NEAR coin S3 sends", () => {
  const target: PayTarget = { to: { kind: "chain", chain: "near", address: "shop.near" }, token: token("nep141:wrap.near"), amount: "3", notes: [] };
  const s = sourcesFor(target, [row("near", "10", "account")]);
  assert.equal(s.length, 1);
  assert.equal(s[0].payTokenId, "nep141:wrap.near");
  assert.equal(s[0].sameCoin, true);
  assert.deepEqual(sourcesFor({ ...target, to: { kind: "ledger", accountId: "alex.near" } }, [row("near", "10", "account")]), [], "not into a ledger: that needs wrapping first");
});

test("NEAR in two places: the row the person picked is the one that pays, never refused as 'not a source' (grade 02h, H3)", () => {
  const target: PayTarget = { to: { kind: "chain", chain: "near", address: "zf-sample-dana.testnet" }, token: token("nep141:wrap.near"), amount: "0.01", notes: [] };
  const both = [row("nep141:wrap.near", "312.4", "ledger"), row("near", "12.5", "account")];
  assert.equal(sourcesFor(target, both).length, 1, "still one choice for the coin");
  assert.equal(sourcesFor(target, both)[0].balance.tokenId, "nep141:wrap.near", "nothing picked: the bigger place");
  const picked = sourcesFor(target, both, "near");
  assert.equal(picked.length, 1);
  assert.equal(picked[0].balance.tokenId, "near", "Send's own NEAR, the one its screen offered");
  assert.equal(picked[0].payTokenId, "nep141:wrap.near");
});

test("a tiny price written as '1e-7' is no price, never a crash that leaves Pay waiting", () => {
  const target: PayTarget = { to: { kind: "ledger", accountId: "alex.near" }, token: { ...token(USDC_NEAR), symbol: "TINY", priceUsd: "1e-7" }, amount: "5", notes: [] };
  assert.doesNotThrow(() => sourcesFor(target, [row(USDC_NEAR, "10", "ledger")], undefined, { anyCoin: true }));
});
