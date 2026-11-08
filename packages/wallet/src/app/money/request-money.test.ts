// Request money, inside Add (D123, D127): a chain's own coin, a one-time address from the core's own quote, a link and a
// QR; no Plain, no token. The payer's half (Send) keeps its rules: the link round trip, expiry, the target rules, and
// Home's line. Every test carries a control that would fail it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRequest, requestLink } from "@zerofee/pay/request";
import { prefillFromLink } from "@zerofee/pay/app/links.ts";
import { TokenDirectory } from "@zerofee/pay/tokens";
import { targetFor } from "@zerofee/pay/pay";
import { readPayCode } from "@zerofee/pay/codes/parse";
import type { Token } from "../../types.ts";
import { addOnWayLine, mergeAdds, rememberRequest, requestInLine, requestKeys } from "./adds-on-way.ts";
import { addressQr, overHidden, askOf, askLine, requestHint, ranOut, rowPays, REQUEST_RAN_OUT, REQUEST_WORDS, askedUsd, requestTarget, sameTarget, checkAsk, expiryWords, requestAmount, requestRows, requestLinkFor, unitsForUsd, tooMuch } from "./request-money.ts";

const tok = (assetId: string, chain: string, symbol: string, decimals: number, priceUsd: string, contract: string | null = null): Token => ({ assetId, chain, symbol, decimals, contract, priceUsd });
const SOL = tok("nep141:sol.omft.near", "sol", "SOL", 9, "150");
const HOOD = tok("nep141:hood.omft.near", "hood", "ETH", 18, "3000");
const NEAR = tok("nep141:wrap.near", "near", "NEAR", 24, "3", "wrap.near");
const BTC = tok("nep141:btc.omft.near", "btc", "BTC", 8, "100000");
const USDC_SOL = tok("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "sol", "USDC", 6, "1", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_NEAR = tok("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "near", "USDC", 6, "1", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
const ALL = [SOL, HOOD, NEAR, BTC, USDC_SOL, USDC_NEAR];
const dir = new TokenDirectory(ALL as never);

const SOL_ADDR = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const EVM_ADDR = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const BTC_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const NOW = Date.parse("2026-11-03T08:00:00Z");
const DAY = 86_400_000;
/** The core's answer to subwallet.add.quote for a request of $20. */
const quote = (o: Record<string, unknown> = {}) => ({ key: "add-sol-wallet-0123456789", chain: "sol", to: "wallet", depositAddress: SOL_ADDR, tokenId: SOL.assetId, symbol: "SOL", decimals: 9, amountIn: "133333330", minAmountIn: "131999996", untilIso: new Date(NOW + DAY).toISOString(), etaSeconds: 20, usd: "20.00", ...o });

test("D123: they pay in a chain's own coin only, SOL and Robinhood now: no USDC, no USDT, no Plain (control: the old token list has them)", () => {
  assert.deepEqual(requestRows().map((r) => `${r.chain}:${r.symbol}`), ["sol:SOL", "hood:ETH"]);
  assert.deepEqual(requestRows({ sol: true, hood: true, near: true, bsc: true }).map((r) => r.chain), ["sol", "hood", "near", "bsc"], "control: NEAR and BNB join with their switch");
  assert.ok(ALL.some((t) => t.symbol === "USDC"), "control: the coin list carries USDC");
  assert.ok(!requestRows().some((r) => /USD/.test(r.symbol)));
  // no Plain anywhere in the words; nothing about a row's own address
  assert.doesNotMatch(JSON.stringify(Object.values(REQUEST_WORDS).map((w) => (typeof w === "function" ? (w as (...a: string[]) => string)("0.13", "SOL", "SOL", "Good for 24 h") : w))), /Plain|your row|Hidden|Private|Spending|please|!/);
});

test("the dollars: none, under $3 (most would go on fees) or over $9,500 (room under the $10,000 one quote takes, D132) each say why the coins are off", () => {
  assert.equal(askLine(askedUsd("")), REQUEST_WORDS.typeFirst);
  assert.equal(askLine(askedUsd("2.99")), REQUEST_WORDS.tooLittle);
  assert.equal(askLine(askedUsd("9500.01")), REQUEST_WORDS.tooMuch);
  assert.equal(askLine(askedUsd("3")), null, "control: $3 asks");
  assert.equal(askLine(askedUsd("9500")), null, "control: $9,500 asks");
  assert.ok(tooMuch("9500.01") && !tooMuch("9500.00") && !tooMuch(null));
  assert.equal(askedUsd("$20"), "20.00");
  assert.equal(askedUsd("0"), null);
  assert.equal(askedUsd("1e3"), null);
});

test("someone else's target is refused: the request's address comes only from the core's own answer, fitted to its chain", () => {
  assert.ok(checkAsk(quote(), "sol", "20.00", NOW), "control: the core's real shape passes");
  assert.equal(checkAsk(quote({ depositAddress: EVM_ADDR }), "sol", "20.00", NOW), null, "an address on another chain");
  assert.equal(checkAsk(quote({ depositAddress: "alex.near" }), "sol", "20.00", NOW), null, "a NEAR account");
  assert.equal(checkAsk(quote(), "hood", "20.00", NOW), null, "another chain than asked");
  assert.equal(checkAsk(quote({ to: "safe" }), "sol", "20.00", NOW), null, "the Safe, not the wallet");
  assert.equal(checkAsk(quote({ usd: "200.00" }), "sol", "20.00", NOW), null, "other dollars");
  assert.equal(checkAsk(quote({ amountIn: "0" }), "sol", "20.00", NOW), null, "no amount");
  assert.equal(checkAsk(quote({ untilIso: new Date(NOW).toISOString() }), "sol", "20.00", NOW), null, "ran out");
  // the web demo's made-up address fits no chain: it passes only marked sample (the real core never marks one)
  const fake = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";
  assert.equal(checkAsk(quote({ depositAddress: fake }), "sol", "20.00", NOW), null);
  assert.ok(checkAsk(quote({ depositAddress: fake, sample: true }), "sol", "20.00", NOW), "control: marked sample");
  // and its link runs Pay's own checks with a stand-in of its chain: a bad amount is still refused
  const ok = requestLinkFor({ target: fake, coin: SOL, units: "133333330", usd: "20.00", hidden: true, untilMs: NOW + DAY, nowMs: NOW, sample: true });
  assert.ok("link" in ok && ok.link.includes(fake));
  assert.ok("problem" in requestLinkFor({ target: fake, coin: SOL, units: "133333330", usd: "20.00", hidden: true, untilMs: NOW + DAY, nowMs: NOW }), "control: unmarked, refused");
  assert.ok("problem" in requestLinkFor({ target: fake, coin: SOL, units: "1", usd: "20.00", hidden: true, untilMs: NOW + DAY, nowMs: NOW, sample: true }), "an amount that rounds to nothing");
});

test("the sheet's whole request: the core's address, a one-time link the payer's Send pays on Solana, never a NEAR account", () => {
  const q = checkAsk(quote(), "sol", "20.00", NOW)!;
  const l = requestLinkFor({ target: q.depositAddress, coin: { chain: "sol", assetId: q.tokenId, decimals: q.decimals }, units: q.amountIn, usd: "20.00", hidden: true, untilMs: Date.parse(q.untilIso), nowMs: NOW });
  assert.ok("link" in l);
  const read = readRequest(l.link, [], NOW);
  assert.ok(read && "ok" in read);
  assert.deepEqual([read.ok.to, read.ok.chain, read.ok.token, read.ok.amount, read.ok.hidden], [SOL_ADDR, "sol", SOL.assetId, "0.13333333", true]);
  const p = prefillFromLink(l.link, dir, "payer.near", NOW);
  assert.ok("ok" in p);
  assert.deepEqual(p.ok.recipient, { kind: "address", chain: "sol", candidates: ["sol"], address: SOL_ADDR });
  // Pay's own scan never pays it outside Send's guard and coin lock (control below: the old form still reads)
  const t = targetFor(readPayCode(l.link, { nowMs: NOW }), dir, {}, "payer.near");
  assert.ok("problem" in t && t.problem.code === "pay.code.unsupported");
  const old = prefillFromLink(requestLink({ to: "kim.near", amount: "5", token: USDC_NEAR.assetId }), dir, "payer.near", NOW);
  assert.ok("ok" in old && old.ok.recipient.kind === "ledger" && old.ok.request === undefined);
  // ETH (RH): the same, on Robinhood Chain, its QR naming that chain (EIP-681 @4663) with the exact amount
  const h = checkAsk(quote({ chain: "hood", depositAddress: EVM_ADDR, tokenId: HOOD.assetId, symbol: "ETH", decimals: 18, amountIn: "6666660000000000" }), "hood", "20.00", NOW);
  assert.ok(h);
  assert.equal(addressQr(h.depositAddress, "hood", h.amountIn), `ethereum:${EVM_ADDR}@4663?value=6666660000000000`);
  assert.equal(REQUEST_WORDS.ask("0.13333333", "SOL", "SOL", expiryWords(NOW + DAY, NOW)), "Send 0.13333333 SOL here. It goes to your SOL wallet. Good for 24 h.");
});
test("the link round trip: made by the sheet, read by the payer's Send with every field shown and nothing locked", () => {
  const units = unitsForUsd("20.00", SOL)!;
  const l = requestLinkFor({ target: SOL_ADDR, coin: SOL, units, usd: "20.00", note: "Dinner\u0000 at Kim's", hidden: true, untilMs: NOW + DAY, nowMs: NOW });
  assert.ok("link" in l);
  assert.equal(l.request.amount, "0.13333333");
  const p = prefillFromLink(l.link, dir, "payer.near", NOW);
  assert.ok("ok" in p);
  assert.deepEqual(p.ok.request, { chain: "sol", tokenId: SOL.assetId, amount: "0.13333333", usd: "20.00", exp: Math.floor((NOW + DAY - 30 * 60_000) / 1000), hidden: true });
  assert.equal(p.ok.note, "Dinner at Kim's");
  assert.equal(p.ok.ref, undefined, "no ref: Pay's fullyNamed never skips Send, so the amount is always shown and editable");
  // control: a link whose dollars and amount were changed together by hand reads back changed (the reader isn't echoing
  // the maker); one changed alone is refused (the figures check)
  const tampered = l.link.replace("amount=0.13333333", "amount=0.2").replace("usd=20.00", "usd=30.00");
  const t = prefillFromLink(tampered, dir, "payer.near", NOW);
  assert.ok("ok" in t && t.ok.request?.amount === "0.2" && t.ok.request.usd === "30.00");
  assert.ok("problem" in prefillFromLink(l.link.replace("amount=0.13333333", "amount=9"), dir, "payer.near", NOW));
});

test("the payer's amount: the link's own amount only when its dollars are kept and agree with the price; else the payer's dollars at the price", () => {
  const a = { tokenId: SOL.assetId, amount: "0.13333333", usd: "20.00" };
  assert.equal(requestAmount(a, USDC_NEAR.assetId, "20", 20, SOL), "0.13333333");
  assert.equal(requestAmount(a, USDC_NEAR.assetId, "10", 10, SOL), "0.06666667");
  assert.equal(requestAmount(a, SOL.assetId, "0.2", 30, SOL), "0.2");
  // the same coin rounded to the form's 6 places pays the link's exact amount (review L2); control: a real change stays
  assert.equal(requestAmount(a, SOL.assetId, "0.133333", 20, SOL), "0.13333333");
  // review H1: a link whose "$20" hides 1.3 SOL (~$195) delivers $20 of SOL, never 1.3; control: the honest link above
  assert.equal(requestAmount({ ...a, amount: "1.3" }, USDC_NEAR.assetId, "20", 20, SOL), "0.13333333");
  // and the payer's Send refuses such a link before it opens
  const lie = `zerofee:pay?v=1&to=${SOL_ADDR}&chain=sol&token=nep141%3Asol.omft.near&amount=1.3&usd=20.00&exp=${Math.floor((NOW + DAY) / 1000)}`;
  assert.equal((prefillFromLink(lie, dir, "payer.near", NOW) as { problem: { code: string } }).problem.code, "pay.request.invalid");
  assert.ok("ok" in prefillFromLink(lie.replace("amount=1.3", "amount=0.13333333"), dir, "payer.near", NOW), "control: the same link with its true amount opens");
  // control: no price for what pays (no dollars) sends nothing, never the coin amount read as another coin's
  assert.equal(requestAmount(a, USDC_NEAR.assetId, "20", null, SOL), null);
});

test("the payer's Send checks the end again when it sends, and keeps the lock for an EVM address typed in other letters", () => {
  const ask = { chain: "sol", tokenId: SOL.assetId, amount: "0.13333333", usd: "20.00", exp: Math.floor((NOW + 60_000) / 1000) };
  assert.ok("ok" in requestTarget(ask, USDC_NEAR.assetId, "20", 20, SOL_ADDR, dir, undefined, NOW), "control: before its end it pays");
  assert.deepEqual(requestTarget(ask, USDC_NEAR.assetId, "20", 20, SOL_ADDR, dir, undefined, NOW + 60_000), { line: REQUEST_RAN_OUT });
  assert.ok(ranOut(ask, NOW + 60_000) && !ranOut(ask, NOW));
  // a row checks the end too (control: before it, it pays)
  assert.deepEqual(rowPays(ask, "sol", "0.133333", dir, 20, NOW + 60_000), { line: REQUEST_RAN_OUT });
  assert.ok("amount" in rowPays(ask, "sol", "0.133333", dir, 20, NOW));
  const pre = { recipient: { kind: "address", address: EVM_ADDR }, request: ask };
  assert.equal(askOf(pre, { kind: "address", address: EVM_ADDR.toLowerCase() }), ask);
  assert.equal(askOf(pre, { kind: "address", address: SOL_ADDR }), null, "control: another address typed in drops the lock");
  // a row pays only its own coin, at the request's exact amount
  assert.deepEqual(rowPays(ask, "sol", "0.133333", dir, null, NOW), { amount: "0.13333333" });
  assert.deepEqual(rowPays(ask, "hood", "0.01", dir, null, NOW), { line: "This request asks for SOL. Pick another coin to pay with." });
  assert.ok(sameTarget(EVM_ADDR, EVM_ADDR.toLowerCase()));
  assert.ok(!sameTarget(SOL_ADDR, SOL_ADDR.toLowerCase()), "control: a Solana address is case-sensitive");
});

test("expiry: a link past its end is refused by name; the words say how long it is good for", () => {
  const units = unitsForUsd("20.00", SOL)!;
  // a Hidden link ends 30 min before 1Click's deadline (review M1), so a payment through Hidden still lands in time
  const l = requestLinkFor({ target: SOL_ADDR, coin: SOL, units, usd: "20.00", hidden: true, untilMs: NOW + 3_600_000, nowMs: NOW });
  assert.ok("link" in l);
  assert.ok("ok" in (readRequest(l.link, [], NOW + 1_799_000) ?? {}), "control: a second before its end it reads");
  assert.equal((readRequest(l.link, [], NOW + 1_800_000) as { problem: { code: string } }).problem.code, "pay.request.expired");
  assert.equal((prefillFromLink(l.link, dir, "payer.near", NOW + 2 * 3_600_000) as { problem: { code: string } }).problem.code, "pay.request.expired");
  // a link is good for a day at most, even when 1Click signs its address for longer
  const long = requestLinkFor({ target: SOL_ADDR, coin: SOL, units, usd: "20.00", hidden: true, untilMs: NOW + 4 * DAY, nowMs: NOW });
  assert.ok("request" in long && long.request.exp === Math.floor((NOW + DAY) / 1000));
  const plain = requestLinkFor({ target: SOL_ADDR, coin: SOL, units, usd: "20.00", hidden: false, untilMs: NOW + 3_600_000, nowMs: NOW });
  assert.ok("request" in plain && plain.request.exp === Math.floor((NOW + 3_600_000) / 1000), "control: a Plain link keeps its whole time");
  assert.equal(expiryWords(NOW + DAY, NOW), "Good for 24 h");
  assert.equal(expiryWords(NOW + 45 * 60_000, NOW), "Good for 45 min");
  assert.equal(expiryWords(NOW + 3 * DAY, NOW), "Good for 3 days");
  assert.equal(expiryWords(NOW - 1, NOW), "This ran out");
});

test("units are cut to what the line shows; no price, no units", () => {
  const u = unitsForUsd("20.00", NEAR)!;
  assert.match(u, /0{16}$/);
  assert.equal(unitsForUsd("20.00", { ...SOL, priceUsd: "0" }), null, "control: no price, no units");
  assert.equal(unitsForUsd("20.00", SOL), "133333330");
});

test("Home: an Add's line follows it by stage until it lands; a request's money says it came from a request; an older Add into Hidden keeps its line", () => {
  const base = { key: SOL_ADDR.slice(-6), tokenId: SOL.assetId, chain: "sol" as const, to: "wallet" as const };
  assert.deepEqual(addOnWayLine({ ...base, stage: "arriving", etaSeconds: 20 }, "SOL"), { title: "SOL is on its way to your SOL wallet.", detail: "About 20 s." });
  assert.deepEqual(addOnWayLine({ ...base, stage: "forwarding", amount: "150000000", usd: "22.5" }, "SOL"), { title: "0.15 SOL is going to your SOL wallet.", detail: "About $22.50." });
  // review M3: it waits on purpose; the line says when, from the core's own plan (control above: no plan time, its dollars)
  assert.deepEqual(addOnWayLine({ ...base, stage: "forwarding", amount: "150000000", usd: "22.5", etaSeconds: 1200 }, "SOL"), { title: "0.15 SOL is going to your SOL wallet.", detail: "Arrives in about 20 min." });
  assert.equal(addOnWayLine({ ...base, stage: "forwarding", etaSeconds: 45 }, "SOL").detail, "Arrives in about a minute.");
  assert.deepEqual(addOnWayLine({ ...base, stage: "landed", amount: "150000000" }, "SOL"), { title: "0.15 SOL landed in your SOL wallet.", detail: null });
  assert.equal(addOnWayLine({ ...base, chain: "hood", to: "safe", stage: "landed", amount: "10000000000000000" }, undefined).title, "0.01 ETH landed in your Safe.");
  assert.equal(addOnWayLine({ ...base, stage: "refunded" }, "SOL").title, "Your SOL came back to your NEAR wallet.");
  assert.deepEqual(addOnWayLine({ ...base, stage: "held", reason: "Under $2 stays there." }, "SOL"), { title: "Your SOL is in your NEAR wallet.", detail: "Under $2 stays there." });
  // control: an older Add into Hidden (no stage) keeps 1Click's signed dollars
  assert.equal(addOnWayLine({ key: "zzzzzz", tokenId: SOL.assetId, usd: "19.8", etaSeconds: 60 }, "SOL").title, "$19.80 of SOL is on its way.");
  // the merge: Add's jobs first, an older Add with the same key never twice
  assert.deepEqual(mergeAdds([{ ...base, stage: "arriving" }], [{ key: base.key, tokenId: SOL.assetId, usd: "1" }, { key: "zzzzzz", tokenId: SOL.assetId, usd: "2" }]).map((x) => x.key), [base.key, "zzzzzz"]);
  assert.deepEqual(mergeAdds({ problem: 1 }, null), [], "an answer that isn't a list is nothing");
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  rememberRequest(store, SOL_ADDR, NOW + DAY, NOW);
  const keys = requestKeys(store, NOW);
  assert.ok(keys.has(base.key));
  assert.deepEqual(requestInLine({ ...base, stage: "landed", amount: "133333330", usd: "20" }), { title: "$20.00 came in from a request.", detail: "0.1333 SOL landed in your SOL wallet." });
  assert.deepEqual(requestInLine({ key: base.key, tokenId: SOL.assetId, usd: "19.8", etaSeconds: 60 }), { title: "$19.80 came in from a request.", detail: "About 60 s." });   // audit H1: never "privately"
  // control: another Add's key isn't a request's, and a request past its end is forgotten
  assert.ok(!keys.has("zzzzzz"));
  assert.ok(!requestKeys(store, NOW + DAY + 1).has(base.key));
  assert.ok(!JSON.stringify([...mem.values()]).includes(SOL_ADDR), "the address itself is never kept");
});

test("review M2: an outside wallet's QR on an EVM chain names that chain (EIP-681, the core's own chain ids); Solana's stays the address", () => {
  assert.equal(addressQr(EVM_ADDR, "hood", "5000"), `ethereum:${EVM_ADDR}@4663?value=5000`);
  assert.equal(addressQr(EVM_ADDR, "bsc"), `ethereum:${EVM_ADDR}@56`);
  // control: a chain with no EVM id (Solana, Bitcoin) keeps the bare address, and so does a non-EVM address
  assert.equal(addressQr(SOL_ADDR, "sol", "5000"), SOL_ADDR);
  assert.equal(addressQr(BTC_ADDR, "btc"), BTC_ADDR);
  assert.equal(addressQr(EVM_ADDR, "bsc", "5000", "0x55d398326f99059ff775485246999027b3197955"), EVM_ADDR, "a token on an EVM chain: no native value");
});

test("review L3: a payer's dollars stop at what the Hidden request made room for, with one line; Plain has no such stop (control)", () => {
  const ask = { chain: "sol", tokenId: SOL.assetId, amount: "0.13333333", usd: "20.00", hidden: true };
  const line = "This request is for $20.00. Pay $20.00 or less.";
  assert.equal(overHidden(ask, 20), null);
  assert.deepEqual(requestTarget(ask, USDC_NEAR.assetId, "25", 25, SOL_ADDR, dir), { line });
  assert.deepEqual(rowPays(ask, "sol", "0.2", dir, 30), { line });
  assert.ok("ok" in requestTarget({ ...ask, hidden: false }, USDC_NEAR.assetId, "25", 25, SOL_ADDR, dir), "control: a Plain request takes more");
  // re-review High: in the request's own coin, the exact amount passes however the price moved (SOL up 50%), and more
  // than it stops with no price at all (control: a hair more is the line)
  assert.ok("amount" in rowPays(ask, "sol", "0.13333333", dir, 30));
  assert.ok("ok" in requestTarget(ask, SOL.assetId, "0.13333333", 30, SOL_ADDR, dir));
  assert.deepEqual(requestTarget(ask, SOL.assetId, "0.2", null, SOL_ADDR, dir), { line });
  assert.deepEqual(rowPays(ask, "sol", "0.1334", dir, null), { line });
});

test("the line under the coins says what's next (UI audit, 5 Nov: $12 typed, no coin, no hint); control: nothing typed, no nag; a refusal or an ask in flight wins", () => {
  assert.equal(requestHint("12", null, false), REQUEST_WORDS.pickCoin);
  assert.equal(requestHint("", null, false), null, "control: nothing typed, the keypad is the one thing to do");
  assert.equal(requestHint("1", null, false), REQUEST_WORDS.tooLittle, "control: coins off, it says why");
  assert.equal(requestHint("12", "1Click gave no address.", false), "1Click gave no address.");
  assert.equal(requestHint("12", null, true), REQUEST_WORDS.asking);
});
