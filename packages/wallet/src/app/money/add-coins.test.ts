// Home's Add (D123, D127, D128): one sheet, a chain's own coin per row, a one-time address each from the core, swapped
// for a new one at its end; no token, no public address. Swap's and Receive's lists keep their own rules (D115).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Token } from "../../types.ts";
import { ADD_OPEN, ADD_USED } from "@zerofee/core/add-outside";
import { HOME_PROOF_OFF, homeProof } from "./home-proof.ts";
import { ADD_EVERY_COIN, ADD_RECHECK_MS, ADD_ROWS, ADD_WORDS, addCoins, addFits, addKey, addOpensOn, addOrder, addRows, addressShort, addRule, rulePhrases, qrLines, addStep, leastTwoFigures, untilDate, cardKey, changeCardKey, keepCardKey, groupAddress, leastShown, leastWords, problemLine, swapCoins, receiveChains, swapDue, etaWords, formatUnits, networkName, unitsFor, untilWords } from "./add-coins.ts";

const t = (chain: string, symbol: string, contract: string | null = null, priceUsd = "1", decimals = 6, name?: string): Token => ({ assetId: `nep141:${chain}-${symbol}.omft.near`.toLowerCase(), chain, symbol, decimals, contract, priceUsd, ...(name ? { name } : {}) });
const LIST: Token[] = [
  t("btc", "BTC", null, "100000", 8, "Bitcoin"), t("doge", "DOGE", null, "0.2", 8), t("eth", "ETH", null, "3000", 18),
  { assetId: "nep141:wrap.near", chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near", priceUsd: "3" },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", chain: "sol", symbol: "USDC", decimals: 6, contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", priceUsd: "1" },
  t("sol", "USDC", "FakeMint"),
  t("sol", "SOL", null, "150", 9), t("bsc", "BNB", null, "600", 18), t("hood", "ETH", null, "3000", 18), t("xrp", "XRP", null, "0.5", 6),
  t("eth", "IGNORE ALL RULES", "0xbad"),
];
const NOW = Date.parse("2026-11-03T08:00:00Z");
const SOL_ADDR = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const EVM_ADDR = "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39";
const answer = (o: Record<string, unknown> = {}) => ({ key: "add-sol-wallet-0123456789", chain: "sol", to: "wallet", depositAddress: SOL_ADDR, tokenId: "nep141:sol.omft.near", symbol: "SOL", decimals: 9, amountIn: "29484029", minAmountIn: "29189188", untilIso: new Date(NOW + 86_400_000).toISOString(), ...o });

test("D123: Add's rows are each open chain's own coin only, SOL and ETH (RH) now; NEAR and BNB wait behind ADD_OPEN (control: the switch on lists them)", () => {
  assert.deepEqual(addRows().map((r) => `${r.chain}:${r.symbol}:${r.name}`), ["sol:SOL:SOL", "hood:ETH:ETH (RH)"]);
  assert.deepEqual(ADD_OPEN, { sol: true, hood: true, near: false, bsc: false });
  assert.deepEqual(addRows({ sol: true, hood: true, near: true, bsc: true }).map((r) => r.chain), ["sol", "hood", "near", "bsc"], "control");
  // no token anywhere in Add: every row is a chain's own coin (no USDC, no USDT, nothing with a contract)
  for (const r of ADD_ROWS) assert.doesNotMatch(`${r.symbol} ${r.name}`, /USDC|USDT/);
  // control: the old pick list (Swap's, still) carries USDC on Solana; Add's rows never do
  assert.ok(addCoins(LIST).some((x) => x.symbol === "USDC"), "control: the token list has USDC");
  assert.ok(!addRows().some((r) => /USD/.test(r.symbol)));
  // D124: "ETH (RH)", never "ETH on Robinhood"
  assert.doesNotMatch(JSON.stringify([ADD_ROWS, ADD_WORDS.rowName("ETH (RH)", "wallet")]), /ETH on Robinhood/);
});

test("the QR sheet's address, whole and grouped in fours (address poisoning)", () => {
  assert.equal(groupAddress(EVM_ADDR), "0xAb 5e68 8E42 cE07 Fc83 e0AD 8ca0 486b 96a5 D53e 39");
  assert.equal(groupAddress(SOL_ADDR), "DezX AZ8z 7Pnr nRJj z3wX BoRg ixCa 6xjn B7Ya B1pP B263");
  assert.equal(groupAddress(EVM_ADDR).replace(/ /g, ""), EVM_ADDR, "grouping drops nothing");
});

test("the swap: before the address's end it stays, at or after its end (or an end nobody can read) a new one comes", () => {
  const until = new Date(NOW + 60_000).toISOString();
  assert.deepEqual(swapDue(until, NOW), { due: false, inMs: 60_000 }, "control: before its end it stays");
  assert.deepEqual(swapDue(until, NOW + 59_999), { due: false, inMs: 1 });
  assert.equal(swapDue(until, NOW + 60_000).due, true);
  assert.equal(swapDue(until, NOW + 3_600_000).due, true);
  assert.equal(swapDue("not a time", NOW).due, true);
  assert.equal(swapDue(new Date(NOW + 30 * 86_400_000).toISOString(), NOW).inMs, 2_147_000_000, "a timer never overflows");
  // each ask has its own key, so a swap is a new address (the same key gives the same one)
  const keys = new Set(Array.from({ length: 50 }, () => addKey("sol", "wallet")));
  assert.equal(keys.size, 50);
  for (const k of keys) assert.match(k, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(addKey("sol", "wallet", () => new Uint8Array(12)), addKey("sol", "wallet", () => new Uint8Array(12)), "control: the same bytes, the same key");
});

test("a row shows only the core's answer for that very row: its chain, its side, an address, a least, an end to come", () => {
  assert.ok(addFits(answer(), "sol", "wallet", NOW), "control: the core's shape passes");
  assert.equal(addFits(answer(), "hood", "wallet", NOW), null, "another chain");
  assert.equal(addFits(answer(), "sol", "safe", NOW), null, "another side");
  assert.equal(addFits(answer({ depositAddress: "kim.near" }), "sol", "wallet", NOW), null, "not an address");
  assert.equal(addFits(answer({ minAmountIn: "abc" }), "sol", "wallet", NOW), null);
  assert.equal(addFits(answer({ untilIso: new Date(NOW).toISOString() }), "sol", "wallet", NOW), null, "ran out");
  assert.equal(addFits(null, "sol", "wallet", NOW), null);
});

test("'At least' has at most 4 decimals and sending exactly it is always taken: the figure shown is never under the quote's least (control: rounded down, it would be)", () => {
  const places = (s: string) => (s.split(".")[1] ?? "").length;
  // FLEX_INPUT's least is 99% of the core's amount, so it has any tail; every one, on SOL (9) and ETH (RH) (18)
  for (let i = 0; i < 2000; i++) {
    for (const decimals of [9, 18]) {
      const amount = BigInt(1 + Math.floor(Math.random() * 1e6)) * 10n ** BigInt(decimals - 4);
      const min = ((amount * 99n) / 100n).toString();
      const shown = leastWords(min, decimals);
      assert.ok(places(shown) <= 4, `${shown}: at most 4 decimals`);
      const sent = BigInt(leastShown(min, decimals));
      assert.ok(sent >= BigInt(min), `${shown} is taken by a least of ${min}`);
      // and it is the 4-place figure as written: what the payer types is what the core sees
      assert.equal(formatUnits(sent.toString(), decimals), shown);
    }
  }
  // control: the same least rounded DOWN to 4 places would be under it, so an exact payment of that figure is refused
  const min = "29189188", down = (BigInt(min) / 10n ** 5n) * 10n ** 5n;
  assert.ok(down < BigInt(min), "control: 0.0291 SOL is under the least 0.029189188");
  assert.equal(leastWords(min, 9), "0.0292");
});

test("the words: short, the least rounded up (never under what the address takes), the end in the day's time", () => {
  // rule: at most 4 decimals of a coin, what the payer must send rounded UP
  assert.equal(leastWords("29189188", 9), "0.0292");
  assert.equal(leastWords("1265170000000000", 18), "0.0013", "ETH (RH)");
  assert.equal(leastWords("29200000", 9), "0.0292", "already 4 places: unchanged");
  assert.equal(ADD_WORDS.only("SOL", "Solana", "0.0292"), "Send only SOL on Solana, at least 0.0292 SOL.");
  assert.equal(ADD_WORDS.rowName("ETH (RH)", "wallet"), "ETH (RH) wallet");
  assert.equal(ADD_WORDS.rowName("SOL", "safe"), "Safe");
  assert.equal(ADD_WORDS.until("7 Nov, 4:15 pm", "wallet"), "Until 7 Nov, 4:15 pm.");
  assert.equal(ADD_WORDS.until("7 Nov, 4:15 pm", "safe"), "Lands in your Safe as USDC. Until 7 Nov, 4:15 pm.");
  const at = new Date(2026, 10, 3, 9, 0).getTime();
  assert.equal(untilWords(new Date(2026, 10, 3, 16, 15).toISOString(), at), "4:15 PM");
  assert.equal(untilWords(new Date(2026, 10, 4, 9, 0).toISOString(), at), "9:00 AM tomorrow");
  assert.equal(untilWords(new Date(2026, 10, 5, 9, 0).toISOString(), at), "Thu 9:00 AM", "control: two days on, the day's name");
  // copy F: no Hidden, no Private, no Spending, no "please", no "!", no raw ids; under 12 words where a person acts
  const all = Object.values(ADD_WORDS).map((w) => (typeof w === "function" ? (w as (...a: string[]) => string)("SOL", "Solana", "0.0292") : w));
  assert.ok(!/\bHidden\b|\bPrivate\b|Spending|[Pp]lease|!|nep141|omft|[Dd]eposit/.test(all.join(" ")), all.join(" | "));
  for (const w of [ADD_WORDS.ask, ADD_WORDS.retry, ADD_WORDS.copy, ADD_WORDS.copied, ADD_WORDS.qr, ADD_WORDS.close]) assert.ok(w.split(/\s+/).length < 12, w);
});

test("a refusal says the core's own line (its more), else its whatHappened; nothing, nothing", () => {
  assert.equal(problemLine({ whatHappened: "This wallet can't approve this, so ZeroFee said no.", more: "Ask for $3 or more. Under that, most goes on fees." }), "Ask for $3 or more. Under that, most goes on fees.");
  assert.equal(problemLine({ whatHappened: "1Click didn't answer, so ZeroFee stopped. Nothing was sent." }), "1Click didn't answer, so ZeroFee stopped. Nothing was sent.", "control: no more, whatHappened");
  assert.equal(problemLine(null), null);
});

// The sheets' own code: no public address (D127), no token, no Plain. A source scan, as code-gate.test.ts reads MoneyHost.
const here = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
const PUBLIC = [/["']spending\.wallets["']/, /["']ledger\.depositAddress["']/, /["']subwallet\.private\.quoteIn["']/, /screens\/Receive/, /\bPlain\b/, /USDC on Solana|USDT/];
const leaks = (src: string) => PUBLIC.filter((r) => r.test(src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[^]*?\*\//g, ""))).map(String);

test("L5 (review): an address past its end never stays on screen: the QR sheet closes at it, and a request that ran out shows one line and Ask for another (control: before its end, its words)", () => {
  const sheet = here("./AddSheet.tsx"), req = here("./RequestSheet.tsx");
  const qr = sheet.slice(sheet.indexOf("export function QrSheet("));
  assert.match(qr, /setTimeout\(onEnd, Math\.max\(0, swapDue\(a\.untilIso, Date\.now\(\)\)\.inMs\)\)/, "the QR page ends at its address's end");
  assert.match(qr, /<QrPage row=\{row\} to=\{to\} a=\{a\} onEnd=\{onClose\} /, "the QR sheet closes then");
  // owner's Bugs: (6 Nov): at its end the coin page shows the new address's QR (keyed by it), never the old, never "used up"
  assert.match(qr, /\{a \? <QrPage key=\{a\.depositAddress\} /, "the coin page's QR is its address's own: a renewed address draws a new QR");
  assert.match(req, /if \(made && now >= made\.untilMs\) \{[^]*W\.ranOut[^]*W\.again/, "ran out: one line and Ask for another");
  assert.match(req, /expiryWords\(made\.untilMs, now\)/, "control: before its end, its words worked out when shown");
  assert.doesNotMatch(req, /words: W\.ask\(/, "never words fixed when it was made");
});

test("D138 (product decision, 3 Nov): a row is its logo, its name and a QR icon; a tap copies; the address, the least and the end live on the QR sheet alone; the Safe is one row; the tab's card is the same row (control: the old row's letters are caught)", async () => {
  const sheet = here("./AddSheet.tsx"), card = here("./AddressCard.tsx");
  const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[^]*?\*\//g, "");
  const row = code(sheet.slice(sheet.indexOf("export function AddressRow("), sheet.indexOf("function useCopiedFades(")));
  const qr = code(sheet.slice(sheet.indexOf("export function QrSheet(")));
  // the copy review's row spec (6 Nov): the row shows its address's 6+6 (never the whole), no least, no end
  const rowOnly = /groupAddress|depositAddress\}|leastWords|untilWords|W\.only|W\.until|firstLast/;
  assert.doesNotMatch(row.slice(row.indexOf("return (")), rowOnly, "the row draws no whole address, no least, no end");
  assert.match(row, /setCopied\(true\);\s*void copy\(a\.depositAddress\)/, "Copy says Copied, then copies its one-time address");
  assert.match(row, /const one = why \?\? \(rule \? rule\.only : "\\u00a0"\);/, "the audit's MUST: line 2 is the rule, through the flash too");
  assert.match(row, /const two = why \? W\.tapQr : rule \? \(lit \? W\.rowCopied : rule\.until\) : "\\u00a0";/, "line 3 is its end; Copy's flash says Copied. there");
  for (const w of ["groupAddress(a.depositAddress)", "W.copy", "qrLines(a, row, to)", "{lines.only}", "{lines.until}"]) assert.ok(qr.includes(w), `the QR sheet: ${w}`);
  // desktop audit (5 Nov): one line of six and six with Copy beside it; the whole address in 4-groups only after a tap
  assert.match(qr, /<span className="wl-qrfull__addr wl-qrfull__addr--short" data-testid="qr-address">\{addressShort\(a\.depositAddress\)\}<\/span>/, "the short form is the line");
  assert.match(qr, /data-testid="qr-full-toggle">\{full \? W\.hideFull : W\.showFull\}<\/button>\s*\{full && <p className="wl-qrfull__addr wl-qrfull__addr--full" data-testid="qr-address-full">\{groupAddress\(a\.depositAddress\)\}<\/p>\}/, "the whole address only on Show full address");
  assert.match(qr, /className="zf-small wl-qrfull__label">\{W\.yourAddress\}/, "the label");
  assert.equal(ADD_WORDS.yourAddress, "Your address");
  assert.equal(ADD_WORDS.showFull, "Show full address");
  assert.equal(addressShort(SOL_ADDR), "DezXAZ…pPB263");
  assert.equal(addressShort(EVM_ADDR), "0xAb5e…D53e39");
  assert.equal(addressShort("short"), "short");
  assert.match(code(sheet.slice(sheet.indexOf("function AddOn("), sheet.indexOf("const QrGlyph"))), /const safeRow = [^;]*\?\? order\.safe;[^]*line\(safeRow, "safe"\)/, "the Safe is one row like the others (in the coin it was opened with, else the first)");
  assert.doesNotMatch(sheet, /wl-add-chip|W\.others|W\.once/, "no chips, no Other coins, no footer");
  assert.match(card, /<AddressRow [^>]*to="wallet" slot=\{wallet\} initialKey=\{key\}/, "the card is the same row");
  assert.match("<span className=\"wl-addrow-letters\">{firstLast(a.depositAddress).first}</span>", rowOnly, "control: the old row's letters are caught");
  const { REQUEST_WORDS } = await import("./request-money.ts");
  assert.equal(REQUEST_WORDS.linkShown("SOL"), "Your ZeroFee link, paid in SOL.");
  assert.doesNotMatch(REQUEST_WORDS.linkShown("SOL"), /\$/, "no dollars: the headline above says them");
});

test("D125: Add and Request's new route is on only in the test build (VITE_HOME_PROOF=1); off, Add is one line and Close, the card nothing, never an old public address (control: on, the rows)", () => {
  assert.equal(homeProof({ VITE_HOME_PROOF: "1" }), true, "control: the test build");
  for (const env of [undefined, {}, { VITE_HOME_PROOF: "0" }, { VITE_HOME_PROOF: "true" }, { VITE_HOME_PROOF: 1 }]) assert.equal(homeProof(env as never), false, JSON.stringify(env));
  assert.equal(homeProof(), false, "a test run (no build flag): off");
  assert.equal(HOME_PROOF_OFF, "Add opens after its first real test.");
  const sheet = here("./AddSheet.tsx");
  const off = sheet.slice(sheet.indexOf("export function AddSheet("), sheet.indexOf("function AddOn("));
  assert.match(off, /if \(!proof\) return <Sheet title=\{W\.title\} onClose=\{onClose\}>[^]*HOME_PROOF_OFF\}<\/p><\/Sheet>;/, "off: the one line; the corner's Close is the way out");
  assert.doesNotMatch(off, /<button/, "control: no second Close (product decision, 3 Nov)");
  assert.doesNotMatch(off, /bridge|subwallet|spending|ledger/, "off: nothing asked of the core, no address of any kind");
  assert.match(here("./AddressCard.tsx"), /return proof \? <Sealed wallet=\{wallet\} \/> : null;/, "off: no card");
});

test("H1 (review) + owner's Bugs: (6 Nov): a shown address is checked with the core and, the moment the core says it can take no more, a new one for the same row stands in its place (never \"used up\", never Change wallet); the card never relies on Home's on-the-way line (control: the old card read subwallet.add.onWay)", () => {
  const sheet = here("./AddSheet.tsx"), card = here("./AddressCard.tsx").replace(/^\s*\/\/.*$/gm, "");
  assert.match(sheet, /setInterval\([^]*?"subwallet\.add\.quote"[^]*?addStep\([^]*?renew\(\)[^]*?ADD_RECHECK_MS\)/, "the row asks the core about its own key every ADD_RECHECK_MS; its answer goes through addStep");
  assert.match(sheet, /const step = addStep\(r, row\.chain, to, Date\.now\(\), fresh\.current\);\n\s+if \("renew" in step\) return renew\(\);/, "a kept key the core refuses: a new one at once");
  assert.doesNotMatch(sheet, /ChangeSure|add-change|W\.change|W\.done|setDone/, "no Change wallet, no used-up state left in Add");
  assert.match("<ChangeSure name={name} />", /ChangeSure|add-change|W\.change|W\.done|setDone/, "control: the old sheet is caught");
  assert.doesNotMatch(card, /subwallet\.add\.onWay|onChange=/, "the card never decides from Home's line, and has no Change wallet");
  assert.match('void bridge.call("subwallet.add.onWay")', /subwallet\.add\.onWay/, "control: the old card's read is caught");
  assert.ok(ADD_RECHECK_MS <= 30_000, "a paid address leaves the screen within half a minute of the core seeing it");
});

// Owner's Bugs: (6 Nov, his phone): every Add row (Safe, SOL wallet, ETH (RH) wallet) read "This address is used up. Tap
// Change wallet for a new one.": each row's kept key had passed its shown day (ADD_SHOWN_MS), the core answered ADD_USED,
// and the row stopped there. One case per cause, each failing on main.
test("owner's Bugs: (6 Nov): the core's ADD_USED renews the row's address at once; a renewed key refused too is a failure, never a loop; a fitting answer shows; any other refusal says its own words", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  const ok = (chain: "sol" | "hood", to: "wallet" | "safe", untilMs = now + 3_600_000) => ({ ok: { key: "k", chain, to, depositAddress: chain === "sol" ? SOL_ADDR : EVM_ADDR, tokenId: "t", symbol: "S", decimals: 9, amountIn: "100", minAmountIn: "99", untilIso: new Date(untilMs).toISOString() } });
  const used = { problem: { code: ADD_USED, whatHappened: "That address was used or ran out. Here's a new one." } };
  const cases: [string, Parameters<typeof addStep>, string][] = [
    // the three rows on his phone: a kept key past its day; and one money reached
    ["Safe row, kept key past its day", [used, "sol", "safe", now, false], "renew"],
    ["SOL wallet row, kept key past its day", [used, "sol", "wallet", now, false], "renew"],
    ["ETH (RH) wallet row, kept key past its day", [used, "hood", "wallet", now, false], "renew"],
    ["a renewed key the core calls used too", [used, "sol", "wallet", now, true], "why"],
    ["control: a fitting address", [ok("sol", "wallet"), "sol", "wallet", now, false], "show"],
    ["control: a fitting Safe address", [ok("sol", "safe"), "sol", "safe", now, true], "show"],
    ["control: an answer for another row", [ok("hood", "wallet"), "sol", "wallet", now, false], "why"],
    ["control: an answer already past its end", [ok("sol", "wallet", now - 1), "sol", "wallet", now, false], "why"],
    ["control: another refusal", [{ problem: { code: "security.subwallet.refused", more: "Ask for $3 or more." } }, "sol", "wallet", now, false], "why"],
  ];
  for (const [name, args, want] of cases) assert.equal(Object.keys(addStep(...args))[0], want, name);
  assert.deepEqual(addStep({ problem: { code: "x", more: "Ask for $3 or more." } }, "sol", "wallet", now, false), { why: "Ask for $3 or more." });
  assert.deepEqual(addStep(used, "sol", "wallet", now, true), { why: ADD_WORDS.noAddress }, "never asked again in a loop");
  // no Add word says used up or Change wallet (the copy review's row spec: nothing on the row says either)
  const all = Object.values(ADD_WORDS).map((w) => (typeof w === "function" ? (w as (...a: string[]) => string)("SOL", "wallet", "0.1") : w)).join(" | ");
  assert.doesNotMatch(all, /used up|Change wallet|tap to copy/i, all);
  assert.match("This address is used up. Tap Change wallet for a new one.", /used up|Change wallet|tap to copy/i, "control: the old line is caught");
});

test("D127: Add's and Request's sheets never hand out a public address (the row's own, the Safe's account, a bridge's), never Plain", () => {
  for (const f of ["./AddSheet.tsx", "./AddressCard.tsx", "./RequestSheet.tsx", "./request-money.ts"]) assert.deepEqual(leaks(here(f)), [], f);
  // control: the old sheet's calls are caught
  assert.deepEqual(leaks(`bridge.call("spending.wallets"); bridge.call("ledger.depositAddress", {}); import { Receive } from "../screens/Receive.tsx";`).length, 3);
  assert.equal(leaks(`const mode = "Plain";`).length, 1);
  // and the one call they make is the core's one-time address
  assert.match(here("./AddSheet.tsx"), /"subwallet\.add\.quote"/);
  assert.match(here("./RequestSheet.tsx"), /"subwallet\.add\.quote"/);
});

test("Swap's list keeps its own rules (D115): our trading chains' coins and USDC/USDT on them, plus BNB (control: the switch on lists BTC)", () => {
  assert.equal(ADD_EVERY_COIN, false);
  const shown = swapCoins(LIST).map((x) => `${x.chain}:${x.symbol}`);
  assert.deepEqual(shown, ["sol:SOL", "hood:ETH", "near:NEAR", "bsc:BNB", "sol:USDC"]);
  for (const c of ["btc:BTC", "doge:DOGE", "eth:ETH", "xrp:XRP"]) assert.ok(!shown.includes(c), c);
  assert.ok(swapCoins(LIST, "", true).some((x) => x.chain === "btc"), "control: the switch on lists BTC");
  assert.ok(!swapCoins(LIST, "", true).some((x) => /IGNORE/.test(x.symbol)), "a symbol that is a sentence is never listed");
  assert.deepEqual(addCoins(LIST, "bitcoin", true).map((x) => x.symbol), ["BTC"]);
});

test("D115: Pay's Receive offers our trading chains only while the switch is off (control: the switch on offers them)", () => {
  const chains = ["near", "eth", "base", "sol", "btc", "arb", "bsc", "tron", "hood"].map((id) => ({ id }));
  assert.deepEqual(receiveChains(chains).map((c) => c.id), ["near", "sol", "hood"]);
  assert.equal(receiveChains(chains, true).length, chains.length, "control: every network with the switch on");
});

test("figures: dollars to the coin's units at a listed price; amounts never a long tail", () => {
  assert.equal(unitsFor(50, { priceUsd: "100000", decimals: 8 }), "50000");
  assert.equal(unitsFor(50, { decimals: 8 }), null, "no price, no ask");
  assert.equal(formatUnits("50000", 8), "0.0005");
  assert.equal(etaWords(600), "10 min");
  assert.equal(etaWords(undefined), null);
  assert.equal(networkName("hood"), "Robinhood Chain");
});

test("Add opened from Home's tab puts that wallet's row first, the Safe's from the Safe's tab; every row is always there; a wallet whose Add isn't open opens plain Add (control: no tab, the list's own order)", () => {
  const rows = addRows();
  const names = (x: { name: string }[]) => x.map((r) => r.name);
  const plain = addOrder(undefined, rows);
  assert.deepEqual([names(plain.rows), plain.safe?.name, plain.safeFirst], [["SOL", "ETH (RH)"], "SOL", true], "control: opened from All, the Safe first (HOME-VISUAL §3.8)");
  assert.equal(addOrder("sol", rows).safeFirst, false, "an open wallet's tab: its own row first, the Safe after");
  assert.deepEqual(names(addOrder("sol", rows).rows), ["SOL", "ETH (RH)"]);
  assert.deepEqual(names(addOrder("hood", rows).rows), ["ETH (RH)", "SOL"], "the ETH (RH) tab: its row first, the rest still there");
  const safe = addOrder("safe", rows);
  assert.deepEqual([names(safe.rows), safe.safe?.name, safe.safeFirst], [["SOL", "ETH (RH)"], "SOL", true]);
  // the NEAR tab's round Add while NEAR's Add isn't open: exactly what Add opened from nowhere is (no not-yet line)
  for (const w of ["near", "bsc"] as const) assert.deepEqual(addOrder(w, rows), plain, `${w}: plain Add`);
  assert.notDeepEqual(addOrder("hood", rows), plain, "control: an open wallet's tab puts its row first");
});

test("row 16: Home's address card keeps one key per wallet until Change wallet and a yes; never a new one on reopen, after money reached it or its time ran out; never the address itself (controls: each wallet its own; Change wallet gives a new one, kept at once)", () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  const now = Date.parse("2026-11-03T05:00:00Z");
  const first = cardKey(store, "sol", new Set(), now);
  keepCardKey(store, "sol", first, now + 86_400_000, "Fvphc0nyBXPtytRGGOFz9PsNyJSTDItVA9nxE9lKuag1");
  assert.equal(cardKey(store, "sol", new Set(), now + 60_000), first, "the same address when the tab opens again");
  assert.ok(!/Fvphc0ny/.test([...kept.values()].join()), "only the last 6 are kept, never the address");
  assert.notEqual(cardKey(store, "hood", new Set(), now), first, "control: each wallet its own");
  const safe = cardKey(store, "safe-sol", new Set(), now);
  assert.match(safe, /^add-sol-safe-/, "a key for the Safe's line");
  assert.notEqual(safe, first, "control: the Safe's line is not the wallet's");
  assert.equal(cardKey(store, "safe-sol", new Set(), now + 60_000), safe, "opening Add again: the same address");
  assert.equal(cardKey(store, "sol", new Set(["lKuag1"]), now), first, "money reached it: still the same, until Change wallet");
  assert.equal(cardKey(store, "sol", new Set(), now + 3 * 86_400_000), first, "its time ran out: still the same, until Change wallet");
  const changed = changeCardKey(store, "sol", now);
  assert.notEqual(changed, first, "Change wallet: a new one");
  assert.equal(cardKey(store, "sol", new Set(), now + 1000), changed, "kept at once: a reload after the yes shows the new one");
  assert.equal(cardKey(store, "safe-sol", new Set(), now + 1000), safe, "control: changing the SOL wallet leaves the Safe's line");
});

test("UI's rehearsal (3 Nov): Add opened with a coin (AgentZero's receive {coin: \"sol\"}) opens straight on that coin's address page, full screen, its ✕ back to Home; with no coin it stays the D138 list (controls: no coin, a Request, a coin not open yet)", () => {
  const rows = addRows({ sol: true, hood: true, near: false, bsc: false });
  const sol = rows.find((r) => r.chain === "sol")!, hood = rows.find((r) => r.chain === "hood")!;
  // the host gives `wallet: ask.wallet ?? ask.coin` and `coin: ask.coin` (MoneyHost)
  assert.deepEqual(addOpensOn("sol", "sol", false, rows), { row: sol, to: "wallet" }, "receive {coin: sol}: the SOL wallet's address page");
  assert.deepEqual(addOpensOn("hood", "hood", false, rows), { row: hood, to: "wallet" });
  assert.deepEqual(addOpensOn("sol", "safe", false, rows), { row: sol, to: "safe" }, "from the Safe: the Safe's address in that coin");
  assert.equal(addOpensOn(undefined, "sol", false, rows), null, "control: Home's own Add from the SOL tab (no coin): the list");
  assert.equal(addOpensOn(undefined, undefined, false, rows), null, "control: Home's Add: the list");
  assert.equal(addOpensOn("sol", undefined, true, rows), null, "control: a Request opens Request, not an address");
  assert.equal(addOpensOn("near", "near", false, rows), null, "control: a coin whose Add isn't open yet: the list, never a dead page");
  const sheet = here("./AddSheet.tsx"), host = here("./MoneyHost.tsx");
  const on = sheet.slice(sheet.indexOf("function AddOn("), sheet.indexOf("const QrGlyph"));
  assert.match(on, /const direct = addOpensOn\(coin, wallet, !!request, addRows\(\)\);\n\s+if \(direct && !asking && !ready\) return <Sheet [^\n]*\n\s+if \(direct && !asking\) return <CoinPage [^\n]*onClose=\{onClose\} \/>;/, "the coin page at once; its ✕ is Add's own Close (back to Home), not back to the list");
  assert.ok(on.indexOf("if (direct && !asking) return <CoinPage") < on.indexOf('data-testid="add-rows"'), "the page comes before the list is drawn");
  const page = sheet.slice(sheet.indexOf("function CoinPage("), sheet.indexOf("function QrPage("));
  assert.match(page, /<Sheet title=\{W\.title\} onClose=\{onClose\}>/, "one full-screen sheet (D135)");
  assert.match(page, /useOneTimeAddress\(bridge, row, to/, "the same one-time address a row asks for, checked and swapped the same way");
  assert.match(page, /<QrPage key=\{a\.depositAddress\} row=\{row\} to=\{to\} a=\{a\}/, "its address, Copy and QR");
  assert.doesNotMatch(page, /AddressRow|add-rows|setQr|W\.ask\b/, "no list, no rows, no Request line on the coin page");
  assert.match("<AddressRow bridge={bridge} />", /AddressRow|add-rows|setQr|W\.ask\b/, "control: a row on the page is caught");
  assert.match(host, /\{\.\.\.\(ask\.coin \? \{ coin: ask\.coin \} : \{\}\)\}/, "only an ask's own coin opens the page");
  assert.match(host, /onAdd=\{\(\) => setAsk\(\{ kind: "receive" \}\)\}/, "control: Home's own Add asks with no coin");
});

// Findings 39 and 44 (crawl, 4 Nov): the Safe's row said only "Tap to copy" and read as a lasting address a friend could
// pay later; "Copied" showed no address to check.
test("findings 39, 44 + the copy review's row spec (6 Nov): a row shows its address's 6+6 and Copy turns it to Copied; the QR sheet says who it is for", async () => {
  const { addressEnds } = await import("./add-coins.ts");
  assert.equal(ADD_WORDS.copied, "Copied");
  assert.equal(ADD_WORDS.copyAddress, "Copy address");
  // the copy review's ruling (5 Nov): 6+6, the core sheet's own form
  assert.equal(addressEnds("0xa517ef69CFE34782BeA95fda188ECb1464049f8C"), "0xa517ef…049f8C");  // generated sample
  assert.equal(addressEnds("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), "DezXAZ…pPB263");
  const { outsideShort } = await import("@zerofee/core/format");
  for (const a of ["0xa517ef69CFE34782BeA95fda188ECb1464049f8C", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", " DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 "]) assert.equal(addressEnds(a), outsideShort(a.trim()), "the same formatter as the core's sheet");
  assert.equal(addressEnds("alex.near"), "alex.near", "control: a short name whole");
  const qr = here("./AddSheet.tsx").slice(here("./AddSheet.tsx").indexOf("function QrPage("));
  assert.match(qr, /data-testid="qr-for-you">\{W\.forYou\}/);
  assert.match(ADD_WORDS.forYou, /^Only for you\./);
  assert.match(ADD_WORDS.forYou, /Ask someone to pay you/, "friends are sent to Request, which is the button below");
});

// Finding 55 (crawl, 4 Nov): Request's address tab read "Any ETH wallet" over "Send only ETH on Robinhood Chain": a
// friend on Ethereum would send there and the money would not arrive.
test("finding 55: Request's address tab names its network, and the line says other networks don't arrive", async () => {
  const { REQUEST_WORDS } = await import("./request-money.ts");
  assert.equal(REQUEST_WORDS.outside("Robinhood Chain"), "Robinhood Chain address");
  assert.doesNotMatch(REQUEST_WORDS.outside("Robinhood Chain"), /Any /);
  assert.equal(REQUEST_WORDS.onlyThis("ETH", "Robinhood Chain"), "Send only ETH on Robinhood Chain to this address. ETH sent on any other network won't arrive.");
  assert.match(here("./RequestSheet.tsx"), /label: W\.outside\(made\.row\.network\) \}/, "the tab is named by the row's network");
});

test("finding 56: a sample address is labelled on the row, the QR sheet and Request", () => {
  assert.match(ADD_WORDS.sample, /^Sample address\./);
  const sheet = here("./AddSheet.tsx"), req = here("./RequestSheet.tsx");
  assert.match(sheet.slice(sheet.indexOf("function QrPage(")), /a\.sample && <p/, "the QR sheet says it is a sample");
  assert.match(sheet, /\{a\.sample && <p [^>]*data-testid="qr-sample">\{W\.sample\}<\/p>\}/);
  assert.match(req, /\{made\.sample && <p [^>]*data-testid="request-sample">\{ADD_WORDS\.sample\}<\/p>\}/);
});

test("test, 4 Nov + S2: the least lives on the QR sheet (the copy review's row spec, 6 Nov: the row is its name and address only)", () => {
  // 1Click's FLEX_INPUT takes any deposit at or above its least (OpenAPI swapType); under it, it goes back to the NEAR
  // wallet (QA, 4 Nov: $2 sent to a $3 address). The QR sheet says it; the row's note went with the copy review's spec.
  assert.equal(ADD_WORDS.only("SOL", "Solana", "0.0293"), "Send only SOL on Solana, at least 0.0293 SOL.");
  const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet.slice(sheet.indexOf("function QrPage(")), /<p className="wl-qrfull__only">\{lines\.only\}<\/p>/, "the QR sheet says its least (qrLines)");
  assert.doesNotMatch(sheet.slice(sheet.indexOf("export function AddressRow("), sheet.indexOf("function useOneTimeAddress(")), /wl-addline__note/, "no third line on the row");
});

// the audit's MUST (6 Nov): money sent as another coin, on another chain or under the least can go astray, so a row and its Copy
// always carry the coin, the chain, the least (rounded UP) and the end. the copy review's words and form.
test("the audit's MUST + the copy review's words: the row's two lines and Copy's flash carry coin, chain, least (2 figures, rounded up) and end; the date form (controls: never rounded down, never tomorrow or PM)", () => {
  const ups: [string, number, string][] = [
    ["29300000", 9, "0.03"], ["29250001", 9, "0.03"], ["1510000000000000", 18, "0.0016"], ["1500000000000000", 18, "0.0015"],
    ["2000000000000000", 18, "0.002"], ["1001", 3, "1.1"], ["12", 0, "12"], ["123", 0, "130"], ["0", 9, "0"],
  ];
  for (const [u, d, want] of ups) assert.equal(leastTwoFigures(u, d), want, `${u}/10^${d}`);
  for (const [u, d] of [["29300000", 9], ["1510000000000000", 18], ["7777777", 6], ["1999", 2]] as const) {
    const shown = leastTwoFigures(u, d);
    const [w, f = ""] = shown.split(".");
    assert.ok(BigInt(w + f.padEnd(d, "0")) >= BigInt(u), `never under the least: ${shown}`);
  }
  assert.notEqual(leastTwoFigures("29300000", 9), "0.029", "control: rounding down is caught");
  // the date form, the phone's own time (this run: TZ=UTC)
  const at = new Date(2026, 10, 7, 15, 40).toISOString();
  assert.equal(untilDate(at), "7 Nov, 3:40 pm");
  assert.equal(untilDate(new Date(2026, 10, 7, 0, 5).toISOString()), "7 Nov, 12:05 am");
  assert.equal(untilDate(new Date(2026, 11, 31, 12, 0).toISOString()), "31 Dec, 12:00 pm");
  const sol = ADD_ROWS.find((r) => r.chain === "sol")!, hood = ADD_ROWS.find((r) => r.chain === "hood")!;
  const r = addRule({ minAmountIn: "29300000", decimals: 9, untilIso: at }, sol);
  assert.deepEqual(r, { only: "Only SOL on Solana, at least 0.03 SOL.", until: "Until 7 Nov, 3:40 pm." });
  assert.equal(addRule({ minAmountIn: "1510000000000000", decimals: 18, untilIso: at }, hood).only, "Only ETH on Robinhood Chain, at least 0.0016 ETH.");
  for (const line of [r.only]) for (const fact of ["SOL", "Solana", "0.03"]) assert.ok(line.includes(fact), `${line}: ${fact}`);
  assert.match(r.until, /7 Nov, 3:40 pm/, "the end");
  for (const line of Object.values(r)) assert.doesNotMatch(line, /·|tomorrow|PM|AM|may be lost/, line);
  assert.equal(ADD_WORDS.tapQr, "Tap QR for a new address.");
});

test("83 (auto-renew): every renewal is a NEW key, never one used before (control: the same slot read again keeps its key)", () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  const first = cardKey(store, "safe-sol");
  const seen = new Set([first]);
  for (let i = 0; i < 50; i++) {
    const k = changeCardKey(store, "safe-sol");
    assert.ok(!seen.has(k), "a new key every time");
    seen.add(k);
    assert.equal(cardKey(store, "safe-sol"), k, "control: kept at once");
  }
  const sheet = here("./AddSheet.tsx");
  const hook = sheet.slice(sheet.indexOf("function useOneTimeAddress("), sheet.indexOf("function useCopiedFades("));
  assert.match(hook, /setKey\(o\.slot \? changeCardKey\(store\(\), o\.slot\) : addKey\(row\.chain, to\)\)/, "renew draws a new key (changeCardKey / addKey: fresh random bytes)");
  assert.match(hook, /usedAgain\.current \? \(\(usedAgain\.current = false\), renew\(\)\)/, "after a renewed key was refused, the QR tap asks with a new key, never the refused one");
});

test("the copy review's grid (6 Nov): a row line wraps only at its commas; each phrase whole, never an orphan unit (control: a split at every space is caught)", () => {
  const at = new Date(2026, 10, 7, 22, 37).toISOString();
  const rows = ADD_ROWS.filter((r) => ["sol", "hood", "eth", "near"].includes(r.chain));
  assert.ok(rows.length >= 3);
  const table: [string, string[]][] = [
    ["Only SOL on Solana, at least 0.03 SOL.", ["Only SOL on Solana,", "at least 0.03 SOL."]],
    ["Copied.", ["Copied."]],
    ["Until 7 Nov, 10:37 pm.", ["Until 7 Nov,", "10:37 pm."]],
    ["Tap QR for a new address.", ["Tap QR for a new address."]],
  ];
  for (const [line, want] of table) assert.deepEqual(rulePhrases(line), want, line);
  const lines = rows.flatMap((row) => Object.values(addRule({ minAmountIn: "1510000000000000", decimals: 18, untilIso: at }, row)));
  for (const line of lines) {
    const ps = rulePhrases(line);
    assert.equal(ps.join(" "), line, "the phrases are the line");
    assert.equal(ps.length, (line.match(/,/g) ?? []).length + 1, `${line}: a break only at a comma`);
    for (const p of ps) assert.doesNotMatch(p, /\d$/, `${p}: a number never ends a phrase without its unit`);
  }
  assert.ok(lines.join(" ").split(" ").some((w) => /\d$/.test(w)), "control: a split at every space leaves a number alone");
});

test("QA (6 Nov): the row and its QR sheet say one least and one end for one address (control: the sheet's old forms, 0.0293 and \"10:35 PM tomorrow\", are caught)", () => {
  const sol = ADD_ROWS.find((r) => r.chain === "sol")!, hood = ADD_ROWS.find((r) => r.chain === "hood")!;
  const now = new Date(2026, 10, 6, 22, 35).getTime();
  const table: [Parameters<typeof addRule>[0], typeof sol, "safe" | "wallet"][] = [
    [{ minAmountIn: "29300000", decimals: 9, untilIso: new Date(2026, 10, 7, 22, 35).toISOString() }, sol, "wallet"],
    [{ minAmountIn: "29189188", decimals: 9, untilIso: new Date(2026, 10, 7, 9, 5).toISOString() }, sol, "safe"],
    [{ minAmountIn: "1265170000000000", decimals: 18, untilIso: new Date(2026, 11, 31, 0, 0).toISOString() }, hood, "wallet"],
  ];
  const least = (s: string) => /at least (\S+ \S+)$/.exec(s)?.[1];
  for (const [a, row, to] of table) {
    const r = addRule(a, row), q = qrLines(a, row, to);
    assert.ok(least(r.only), r.only);
    assert.equal(least(q.only), least(r.only), `${q.only} | ${r.only}`);
    assert.ok(q.until.endsWith(r.until), `${q.until} | ${r.until}`);
    assert.doesNotMatch(q.until, /tomorrow|PM|AM|Works/);
  }
  const [a0, row0] = table[0];
  const oldOnly = ADD_WORDS.only(row0.symbol, row0.network, leastWords(a0.minAmountIn, a0.decimals));
  assert.notEqual(least(oldOnly), least(addRule(a0, row0).only), "control: the old least is caught");
  assert.ok(!ADD_WORDS.until(untilWords(a0.untilIso, now), "wallet").endsWith(addRule(a0, row0).until), "control: the old end is caught");
  assert.equal(qrLines(a0, row0, "wallet").until, "Until 7 Nov, 10:35 pm.");
});

test("the copy review (6 Nov): Copy's flash adds no word and reserves no room: the rule line keeps its words, lit; the end's line reads \"Copied.\" (control: the old reserve is caught)", () => {
  assert.equal(ADD_WORDS.rowCopied, "Copied.");
  const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  const reserve = /data-room|attr\(data-room\)/;
  assert.doesNotMatch(sheet, reserve, "no hidden room on the row");
  assert.doesNotMatch(css, reserve, "no reserved band");
  assert.match('<span data-room={keptLine(rule.copied)}>', reserve, "control");
  assert.match(sheet, /useCopiedFades\(copied, setCopied, 2500\);/, "2.5 s, then the end comes back");
  assert.match(css, /\.wl-qrfull__sample \{ margin: 12px 0 0; \}/, "the QR sheet's sample line 12 px clear of the card");
});
