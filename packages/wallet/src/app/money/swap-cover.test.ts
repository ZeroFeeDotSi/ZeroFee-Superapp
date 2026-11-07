// T-F (the UI reviewer's walk, 6 Nov, B-9/B-10): Swap's promise before the tap and its result after it come from one
// rule (swap-cover.ts swapCover, the core's own coin pick): a table over USDC, NEAR (in NEAR Intents and on the account,
// both a cover since the audit's ruling, 6 Nov)
// and USDT, each with Private short and not short, the fill open and closed; the words of the refusal before the tap and
// of the one after it; and the sheet wired to both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SafeCoin } from "@zerofee/core/spending";
import { COVER_WORDS, coverLine, swapCover, swapRefusal } from "./swap-cover.ts";
import { swapStays, swapSub, type SwapRoute } from "./swap-corridor.ts";
import { privateShort } from "@zerofee/core/private-route";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const USDT = "nep141:usdt.tether-token.near";
const row = (tokenId: string, symbol: string, usd: number, held: string): SafeCoin => ({ tokenId, symbol, amount: String(usd), usd: usd.toFixed(2), held, listed: true });
// the Sim's sample Safe: USDC and wNEAR in NEAR Intents, NEAR on the account, USDT in NEAR Intents
const SAFE = [row(USDC, "USDC", 1385.6, "ledger"), row(WNEAR, "NEAR", 1383.93, "ledger"), row("near", "NEAR", 55.37, "account"), row(USDT, "USDT", 400, "ledger")];
const priv = (coin: string, usd: number) => [row(coin, coin === WNEAR ? "NEAR" : coin === USDT ? "USDT" : "USDC", usd, "private")];

test("swapCover, the table: each coin with Private short and not, the fill open; what Spending picks decides it", () => {
  const cases: [string, Parameters<typeof swapCover>[0], ReturnType<typeof swapCover>][] = [
    ["USDC, Private short: the Safe's USDC fills it", { coin: "USDC", usd: 25, safe: SAFE, pocket: priv(USDC, 5), fillOpen: true }, { kind: "cover" }],
    ["USDC, Private covers", { coin: "USDC", usd: 25, safe: SAFE, pocket: priv(USDC, 30), fillOpen: true }, { kind: "plain" }],
    ["NEAR, Private short (the reviewer's $8.86 of $25): the Safe's wNEAR in NEAR Intents fills it", { coin: "NEAR", usd: 25, safe: SAFE, pocket: priv(WNEAR, 8.86), fillOpen: true }, { kind: "cover" }],
    ["NEAR, Private covers", { coin: "NEAR", usd: 25, safe: SAFE, pocket: priv(WNEAR, 44.3), fillOpen: true }, { kind: "plain" }],
    ["NEAR, Private short, the Safe's NEAR only on the account: the real core takes that fill (audit, 6 Nov: real-core-paths T-F, fixed), so the Safe covers", { coin: "NEAR", usd: 25, safe: [row("near", "NEAR", 55.37, "account")], pocket: priv(WNEAR, 8.86), fillOpen: true }, { kind: "cover" }],
    ["NEAR, Private short, the account's NEAR plus Private bigger than NEAR Intents' (Spending picks the account): covered", { coin: "NEAR", usd: 25, safe: [row(WNEAR, "NEAR", 30, "ledger"), row("near", "NEAR", 40, "account")], pocket: priv(WNEAR, 8.86), fillOpen: true }, { kind: "cover" }],
    ["NEAR on the account, Private short, the fill closed: refused before the tap (control)", { coin: "NEAR", usd: 25, safe: [row("near", "NEAR", 55.37, "account")], pocket: priv(WNEAR, 8.86), fillOpen: false }, { kind: "refuse", privateUsd: 8.86 }],
    ["NEAR on the account too small to cover: left to the sheet's other refusals (control)", { coin: "NEAR", usd: 100, safe: [row("near", "NEAR", 55.37, "account")], pocket: priv(WNEAR, 8.86), fillOpen: true }, { kind: "plain" }],
    ["NEAR on the account, Private covers: Private pays, no fill", { coin: "NEAR", usd: 25, safe: [row("near", "NEAR", 55.37, "account")], pocket: priv(WNEAR, 30), fillOpen: true }, { kind: "plain" }],
    ["USDT, Private short: the Safe's USDT in NEAR Intents fills it", { coin: "USDT", usd: 25, safe: SAFE, pocket: priv(USDT, 5), fillOpen: true }, { kind: "cover" }],
    ["USDT, Private covers", { coin: "USDT", usd: 25, safe: SAFE, pocket: priv(USDT, 30), fillOpen: true }, { kind: "plain" }],
    ["NEAR, Private short, no Private row at all: the fill covers", { coin: "NEAR", usd: 25, safe: SAFE, pocket: [], fillOpen: true }, { kind: "cover" }],
  ];
  for (const [what, input, want] of cases) assert.deepEqual(swapCover(input), want, what);
});

test("swapCover, the fill closed: Private short is refused before the tap for every coin; Private covering is plain (control)", () => {
  for (const [coin, id] of [["USDC", USDC], ["NEAR", WNEAR], ["USDT", USDT]] as const) {
    assert.deepEqual(swapCover({ coin, usd: 25, safe: SAFE, pocket: priv(id, 8.86), fillOpen: false }), { kind: "refuse", privateUsd: 8.86 }, coin);
    assert.deepEqual(swapCover({ coin, usd: 25, safe: SAFE, pocket: priv(id, 25), fillOpen: false }), { kind: "plain" }, `${coin} control`);
  }
});

test("swapCover: nothing read yet promises nothing (null); a Safe that can't cover is left to the sheet's other refusals (plain)", () => {
  assert.equal(swapCover({ coin: "NEAR", usd: 25, safe: null, pocket: [], fillOpen: true }), null);
  assert.equal(swapCover({ coin: "NEAR", usd: 25, safe: SAFE, pocket: null, fillOpen: true }), null);
  assert.equal(swapCover({ coin: "NEAR", usd: 0, safe: SAFE, pocket: [], fillOpen: true }), null);
  assert.deepEqual(swapCover({ coin: "NEAR", usd: 5000, safe: SAFE, pocket: priv(WNEAR, 8.86), fillOpen: true }), { kind: "plain" });
});

test("the words before the tap: the cover line only when the Safe covers; refused, the reviewer's sub-line and no cover line; Private alone, no promise", () => {
  const sol: SwapRoute = { kind: "topup", coin: "NEAR", to: "sol" };
  assert.equal(swapStays(sol, 25, undefined, true, { kind: "cover" }), "$25.00 leaves Private. If Private is short, your Safe covers the rest.");
  assert.equal(swapStays(sol, 25, undefined, true, { kind: "plain" }), "$25.00 leaves Private.");
  assert.equal(swapStays(sol, 25, undefined, true, null), "$25.00 leaves Private.", "not read yet: no promise");
  assert.equal(swapStays(sol, 25, undefined, true, { kind: "refuse", privateUsd: 8.86 }), null);
  assert.equal(coverLine({ kind: "refuse", privateUsd: 8.86 }), "Private holds $8.86. Swap up to $8.86, or top up Private.");
  assert.equal(coverLine({ kind: "refuse", privateUsd: 1234.5 }), "Private holds $1,234.50. Swap up to $1,234.50, or top up Private.");
  assert.equal(coverLine({ kind: "cover" }), null);
  assert.equal(coverLine({ kind: "plain" }), null);
  // the sub-line slot: the refusal takes it over what arrives
  const short = coverLine({ kind: "refuse", privateUsd: 8.86 });
  assert.deepEqual(swapSub({ short, back: null, arrives: "About 0.16 SOL arrives. About 1 min.", part: null }), { id: "swap-short", text: short });
  assert.equal(swapSub({ short: null, back: null, arrives: "About 0.16 SOL arrives. About 1 min.", part: null })!.id, "swap-arrives", "control");
});

test("the screen after the tap, Private short (refused before anything is signed): the reviewer's headline, body and one lit Swap less; any other refusal as it is", () => {
  const p = swapRefusal(privateShort(8.86, 25));
  assert.deepEqual([p.whatHappened, p.more, p.next], [COVER_WORDS.title, COVER_WORDS.body, { kind: "nothing", label: "Swap less" }]);
  assert.deepEqual([COVER_WORDS.title, COVER_WORDS.body], ["Not enough in Private.", "Your money is safe. Nothing moved."]);
  assert.equal(p.next2, undefined, "one button");
  const other = { code: "ledger.balance.low", whatHappened: "You need 5 NEAR for this, with its fee.", money: { state: "safe" as const, where: "in your Safe" }, next: { kind: "nothing" as const, label: "OK" } };
  assert.equal(swapRefusal(other), other, "control");
});

test("the sheet: the button is off while Private is short with no cover, the sub-line slot carries Top up Private (Send's door, private/add), and every refusal passes swapRefusal", () => {
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const cover = route\?\.kind === "topup" && !block \? swapCover\(\{ coin: route\.coin, usd: amount,/);
  assert.match(sheet, /disabled=\{busy \|\| \(on\.tap === "swap" && \(nothing \|\| !!short \|\|/);
  assert.match(sheet, /if \(!pay \|\| !get \|\| !route \|\| busy \|\| block \|\| short\) return;/);
  assert.match(sheet, /sub\.id === "swap-short" && <> <button type="button" className="zf-link" onClick=\{\(\) => \{ onClose\(\); shell\.openApp\("wallet", "private\/add"\); \}\} data-testid="swap-top-up">\{TOP_UP_PRIVATE\}<\/button>/);
  assert.equal(sheet.match(/problem\(swapRefusal\(end\.(refused|problem)\), onUsd\)/g)?.length, 2);
  assert.match(sheet, /swapStays\(route, amount, sends, undefined, cover\)/);
});
