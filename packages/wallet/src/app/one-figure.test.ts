// One figure per Safe coin (product decision, 5 Nov; QA's QA re-check, item 9: the Safe's USDC read Home
// 1,290.60, Swap 1,225.50, Send 10 and its coin page 1,190.50 at one moment; its NEAR Home 326.9, Send 2). One selector,
// Home's own line (format.ts safeHeld): Home = Send = Swap = the coin page. What a flow can pay of it is its Max, said
// in one quiet line when less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeHeld, safeLines } from "./format.ts";
import { paysHere, ROW_USDC, SWAP_WORDS } from "./money/swap-corridor.ts";
import { sendSources } from "./money/send-sources.ts";
import { SEND_PART } from "./money/send-words.ts";
import type { Balance, PrivatePocket } from "../types.ts";

const row = (tokenId: string, symbol: string, amount: string, usd: string, held: Balance["held"], chain = "near"): Balance => ({ tokenId, symbol, name: symbol, icon: symbol.toLowerCase(), chain, amount, usd, bridged: chain !== "near", held, listed: true });
// the Sim's start (MockBridge BALANCES + hiddenStart): USDC on NEAR in NEAR Intents and on the account, bridged USDC from
// Solana, NEAR in NEAR Intents and on the account; Private's under it
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SAFE = [row(ROW_USDC, "USDC", "1240.5", "1240.5", "ledger"), row(ROW_USDC, "USDC", "60", "60", "account"), row(SOL_USDC, "USDC", "42.1", "42.1", "ledger", "sol"), row("nep141:wrap.near", "NEAR", "312.4", "1383.93", "ledger"), row("near", "NEAR", "12.5", "55.37", "account")];
const POCKET = [row(ROW_USDC, "USDC", "25", "25", "private"), row("nep141:wrap.near", "NEAR", "2", "8.86", "private")];
const pocket: PrivatePocket = { available: true, ready: true, rows: POCKET, defaultOn: false };
const home = (symbol: string) => safeLines(SAFE, pocket, []).lines.find((l) => l.symbol === symbol)!;

test("safeHeld is Home's line: every place the Safe holds the coin, bridged and Private counted (controls: unlisted, test, none)", () => {
  assert.deepEqual(safeHeld([...SAFE, ...POCKET], "USDC"), { amount: "1367.6", usd: home("USDC").usd });
  assert.equal(home("USDC").usd, "1367.60");
  assert.deepEqual(safeHeld([...SAFE, ...POCKET], "NEAR"), { amount: home("NEAR").amount, usd: home("NEAR").usd });
  assert.equal(home("NEAR").amount, "326.9");
  const staked = [{ poolId: "p", name: "P", amount: "10", usd: "44.30", state: "earning" as const }];
  assert.equal(safeHeld([...SAFE, ...POCKET], "NEAR", staked)?.amount, safeLines(SAFE, pocket, [], staked).lines.find((l) => l.symbol === "NEAR")!.amount, "NEAR's validators, as Home counts them");
  assert.equal(safeHeld([...SAFE, ...POCKET], "USDC", staked)?.usd, "1367.60", "control: staking is NEAR's alone");
  assert.equal(safeHeld([{ ...SAFE[0]!, listed: false }], "USDC"), null, "control: an unlisted look-alike is never counted");
  assert.equal(safeHeld([{ ...SAFE[0]!, test: true }], "USDC"), null, "control: a test row is never counted");
  assert.equal(safeHeld([], "USDC"), null, "control: none held");
});

test("Send's From shows Home's figure, Max is what it can pay, and one quiet line says why (control: all of it can go, no line)", () => {
  // the Safe's own route shut (send-open.ts): only Private's part goes
  const closed = sendSources([], SAFE, POCKET, false);
  const usdc = closed.filter((s) => s.symbol === "USDC");
  assert.equal(usdc.length, 1, "one row per Safe coin, never one per place");
  assert.deepEqual([usdc[0]!.amount, usdc[0]!.usd, usdc[0]!.max], ["1367.6", "1367.60", "25"]);
  // the copy review's ruling (5 Nov): sent from Private only, no standing line; the row carries Private's figure
  assert.deepEqual([usdc[0]!.part, usdc[0]!.line, usdc[0]!.privateOnly], [undefined, "USDC · $25.00 in Private", true]);
  const near = closed.find((s) => s.symbol === "NEAR")!;
  assert.deepEqual([near.amount, near.max, near.tokenId], ["326.9", "2", "nep141:wrap.near"], "Home 326.9, never Send 2");
  assert.equal(near.part, undefined, "no standing can't line");
  assert.match(near.line ?? "", /^NEAR · \$8\.\d\d in Private$/);
  // the fill open (Send from the Safe): one send is paid from ONE place: Private when it covers it, else the Safe pays
  // the whole of it through Private from one of its places (convert.ts routeFor: NEAR Intents or the account, never
  // both; safe-send.ts: Private's share stays put). So Max is the most of those, never their sum
  const open = sendSources([], SAFE, POCKET, true).find((s) => s.symbol === "USDC")!;
  assert.deepEqual([open.amount, open.max, open.tokenId], ["1367.6", "1240.5", ROW_USDC], "the Safe's 1,240.50 in NEAR Intents, not + its account's 60, not + Private's 25");
  assert.equal(open.part, SEND_PART(false, "$1,240.50"));
  const acct = sendSources([], [row(ROW_USDC, "USDC", "10", "10", "ledger"), row(ROW_USDC, "USDC", "60", "60", "account")], [row(ROW_USDC, "USDC", "25", "25", "private")], true)[0]!;
  assert.equal(acct.max, "60", "control: the account's 60 is the most one place holds");
  const split = sendSources([], [row(ROW_USDC, "USDC", "30", "30", "ledger")], [row(ROW_USDC, "USDC", "20", "20", "private")], true)[0]!;
  // one send is one place's (Max 30); no standing line for it (send-private-cap's ruling: no extra standing text), the
  // "at most" line says it only when the typed amount is over (finding 64)
  assert.deepEqual([split.amount, split.max, split.part], ["50", "30", undefined], "Safe 30 and Private 20: Max is one place's, no standing line");
  const whole = sendSources([], [row(ROW_USDC, "USDC", "50", "50", "ledger")], [], true)[0]!;
  assert.deepEqual([whole.amount, whole.max, whole.part], ["50", "50", undefined], "control: all of it can go, no line");
  const form = readFileSync(new URL("./money/SendForm.tsx", import.meta.url), "utf8");
  // the audit's filing: directly under the From row (its button), before any amount is typed
  assert.match(form, /data-testid="send-from" disabled=\{busy\}>[\s\S]{0,700}?<\/button>\s*\{\/\*[^}]*\*\/\}\s*\{source\.part && <p className="zf-small wl-send2__part" data-testid="send-part">\{source\.part\}<\/p>\}/);
  assert.doesNotMatch(form, /!maxLine && source\.part/, "control: never only after an amount, never hidden by Max's line");
});

test("Swap's You pay is the same figure as Send's and Home's; Max stays what one swap pays, with its line (control: no Private, short)", () => {
  const net = { networks: [], roomUsd: "5000" };
  const swap = paysHere({ ...net, safe: SAFE, pocket: POCKET }).find((p) => p.place === "safe-usdc")!;
  assert.equal(swap.usd.toFixed(2), home("USDC").usd);
  assert.equal(swap.most, 1240.5, "what one swap can pay now is unchanged: the largest part");
  assert.equal(swap.part, SWAP_WORDS.part("$1,240.50"));
  const near = paysHere({ ...net, safe: SAFE, pocket: POCKET }).find((p) => p.place === "safe-near")!;
  assert.equal(near.usd.toFixed(2), home("NEAR").usd, "Swap's Safe NEAR is Home's NEAR line");
  const one = paysHere({ ...net, safe: [row(ROW_USDC, "USDC", "40", "40", "ledger")] }).find((p) => p.place === "safe-usdc")!;
  assert.equal(one.part, undefined, "control: one part pays all of it, no line");
  const sheet = readFileSync(new URL("./money/SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /paysHere\(\{ networks: status\.networks, reserveUsd: status\.reserveUsd, roomUsd: status\.roomUsd, safe: balances, pocket: pocket\?\.available \? pocket\.rows : null, earning \}\)/);
  assert.match(sheet, /\{pay\.part && <p className="zf-small wl-sheet-lead" data-testid="swap-part">\{pay\.part\}<\/p>\}/);
});

test("the coin page shows the same figure (readSafeHeld), Sell keeps its own part with its line (control: no screen sums its own)", async () => {
  const { readSafeHeld } = await import("./balance-parts.ts");
  const calls: Record<string, unknown> = { "ledger.balances": SAFE, "ledger.tokens": [], "earn.positions": [], "ledger.private": pocket, "account.state": { kid: false } };
  const bridge = { call: async (m: string) => (m in calls ? { ok: calls[m] } : { problem: { code: "x" } }) } as never;
  assert.deepEqual(await readSafeHeld(bridge, ROW_USDC), { amount: "1367.6", usd: "1367.60", symbol: "USDC" });
  assert.equal((await readSafeHeld(bridge, "nep141:wrap.near"))?.amount, "326.9", "wrapped NEAR's page is NEAR's line");
  assert.equal(await readSafeHeld(bridge, "nep141:doge.omft.near"), null, "control: a coin the Safe doesn't hold");
  const page = readFileSync(new URL("../../../trade/src/native/NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /m\.readSafeHeld\(bridge, assetId\)/);
  assert.match(page, /W\.youHold\(trimAmount\(shownHeld\.amount\), symbol\)/);
  assert.match(page, /\{partOnly && <p className="zf-small nc-part" data-testid="native-part">\{W\.sellPart\(trimAmount\(held!\), symbol\)\}<\/p>\}/);
  assert.doesNotMatch(page, /usd\(heldN \* px\)/, "control: its own market-price figure is gone");
  assert.match(page, /<span>\{W\.paysFrom\}<\/span><span>\{W\.safeCash\}<\/span>/);
});

test("the copy review's ruling (5 Nov): Move lists Private as its own row, so the Safe's row leaves it out and the rows add up to the headline; Home's one big number still counts Private in the Safe (D128, control)", async () => {
  const { placesNow, today, totalOf } = await import("./screens/move-split.ts");
  // MoneyHost passes Home's Safe (safeLines: Private under it) as safeUsd; placesNow takes Private's part out of it
  const now = placesNow({ safeUsd: 5271.22, safeMostUsd: 100, privateUsd: 18.86, privateMostUsd: 18.86, networks: [], reserveUsd: "0" });
  const split = today(now);
  assert.equal(split.safe, 5252.36, "the Safe's row: its own part, never Private's twice");
  assert.equal(split.private, 18.86);
  const rows = Object.values(split).reduce((n, v) => n + (v ?? 0), 0);
  assert.equal(Math.round(rows * 100) / 100, totalOf(now), "the rows add up to the headline");
  // control: Home's big number is the Safe with Private in it (the same safeUsd MoneyHost hands Move)
  assert.equal(Math.round(((split.safe ?? 0) + (split.private ?? 0)) * 100) / 100, 5271.22, "control: Home's Safe unchanged");
  const sheet = readFileSync(new URL("./screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const said = \(o: Partial<Record<string, number>>\) => o\[x\.place\] \?\? 0;/);
  assert.doesNotMatch(sheet, /x\.place === "safe" \? o\.private \?\? 0 : 0/, "control: the old Safe + Private row is gone");
  assert.match(sheet, /<span className="wl-mv-usd" aria-label=\{`After \$\{usdShort\(shown\)\}`\}>\{usdShort\(shown\)\}<\/span>/);
  const host = readFileSync(new URL("./money/MoneyHost.tsx", import.meta.url), "utf8");
  assert.match(host, /const safeUsd = balances \? safeLines\(balances, pocket, chains, earning\)\.totalUsd : null;/);
  assert.match(host, /<MoveSheet status=\{status\} safeUsd=\{safeUsd\}/);
});

test("the audit's filing: held 1,319.50 with 19 can go says the line under From; held = can go says none (control)", () => {
  const usdc = (amount: string, held: Balance["held"]) => row(ROW_USDC, "USDC", amount, amount, held);
  const over = sendSources([], [usdc("1300.5", "ledger")], [usdc("19", "private")], false)[0]!;
  assert.deepEqual([over.amount, over.max], ["1319.5", "19"]);
  // the copy review's ruling (5 Nov): no standing can't line; the row carries Private's figure instead (send-private-cap.test.ts)
  assert.deepEqual([over.part, over.line], [undefined, "USDC · $19.00 in Private"]);
  const open = sendSources([], [usdc("1300.5", "ledger"), row(SOL_USDC, "USDC", "120", "120", "ledger", "sol")], [], true).find((s) => s.symbol === "USDC")!;
  assert.equal(open.part, "Up to $1,300.50 can go in one send.", "a part this send can't pay (bridged USDC): the send's own line");
  const same = sendSources([], [], [usdc("19", "private")], false)[0]!;
  assert.deepEqual([same.amount, same.max, same.part], ["19", "19", undefined], "control: held = can go, no line");
  assert.equal(SWAP_WORDS.part("$120.00"), "Up to $120.00 can go in one swap.");
});
