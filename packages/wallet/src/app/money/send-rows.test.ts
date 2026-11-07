// Home's Send FROM a wallet or the Safe (the Home plan §1.3, E3, E4, D128): the dropdown's sources, each wallet to any
// network Send reaches (never only its own chain), and a Safe coin that sits partly in the pocket paid from where it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Recipient } from "@zerofee/pay/send";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { coinLabel, rowChain, rowCoins, rowMax } from "./send-rows.ts";
import { maxSendLine } from "./send-sources.ts";
import { chainName } from "@zerofee/pay/chains";
import { sendNetworks } from "../../send-reach.ts";
import type { Balance } from "../../types.ts";

const status = (o: Partial<SpendingStatus> = {}) => ({ loaded: true, unread: false, networks: [
  { network: "sol", name: "Solana", cashUsd: "490.43", coinsUsd: "0.00", readyUsd: "480.00", nativeAmount: "4.82" },
  { network: "hood", name: "Robinhood Chain", cashUsd: "120.00", coinsUsd: "0.00", readyUsd: "110.00", nativeAmount: "0.05" },
  { network: "bsc", name: "BNB Chain", cashUsd: "10.00", coinsUsd: "0.00", readyUsd: "9.00", nativeAmount: "0.02" },
], ...o }) as unknown as SpendingStatus;
const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
const usdc = (amount: string, held: Balance["held"]): Balance => ({ tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount, usd: amount, bridged: false, held, listed: true });

test("the dropdown's wallets: your SOL wallet and your ETH (RH) wallet, their own amount and dollars; none unread; BNB not offered yet", () => {
  const rows = rowCoins(status());
  assert.deepEqual(rows.map((r) => [r.tokenId, r.name, r.symbol, r.amount, r.usd, r.chain]), [["row:sol", "SOL wallet", "SOL", "4.82", "490.43", "sol"], ["row:hood", "ETH (RH) wallet", "ETH", "0.05", "120.00", "hood"]]);
  assert.deepEqual(rowCoins(status({ unread: true } as never)), [], "unread: no wallet, never a $0 one");
  assert.deepEqual(rowCoins(null), []);
  assert.equal(rowChain({ tokenId: "nep141:sol.omft.near" }), null, "control: the Safe's SOL is not a wallet");
  assert.equal(rowMax("sol", "4.82"), "4.819", "Max keeps Solana's fee room");
  assert.equal(rowMax("hood", "0.00005"), "0", "never below zero");
});

test("bug 9: any wallet sends to any network Send reaches; a 0x address as Pay really reads it asks among four (Robinhood never assumed)", async () => {
  const { findRecipient } = await import("@zerofee/pay/send");
  const read = async (t: string) => {
    const f = (await findRecipient({ call: async () => ({ problem: { code: "x" } }), on: () => () => {} } as never, t)) as { ok?: { recipient: Recipient } };
    return f.ok!.recipient;
  };
  assert.deepEqual(sendNetworks(await read("0x7D06e272b5305a4b9D40e872C7950D3437547e3D")), ["hood", "bsc", "eth", "base", "arb", "op", "pol", "avax", "gnosis", "bera"]);
  assert.deepEqual(sendNetworks(await read("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK")), ["sol"], "from either wallet");
  assert.doesNotMatch(sheet, /rowSendRefusal|sends only to/, "control: the old own-chain-only stop is gone");
});

test("Hidden's coins counted under the Safe (D128): From shows the coin's one figure (product decision, 5 Nov), Max what can go (the figure the refusal names), with its line; the pocket's share now, the Safe's once its route is open", async () => {
  const { sendSources } = await import("./send-sources.ts");
  const closed = sendSources([], [usdc("30", "ledger")], [usdc("20", "private")], false);
  assert.deepEqual(closed.map((s) => [s.id, s.label, s.amount, s.max]), [["safe:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "USDC · Private", "50", "20"]], "one row, Home's figure; Max the $20 that can go now; it pays from Private, so it says Private (QA test, MUST 3: never \"your Safe\" for Private's coins)");
  assert.equal(closed[0]!.usd, "50.00", "its dollars are Home's");
  assert.deepEqual([closed[0]!.part, closed[0]!.line], [undefined, "USDC · $20.00 in Private"], "the copy review's ruling: no standing line, the row carries Private's figure");
  const open = sendSources([], [usdc("30", "ledger")], [usdc("20", "private")], true);
  assert.deepEqual([open[0]!.amount, open[0]!.max, open[0]!.usd, open[0]!.part, open[0]!.line], ["50", "30", "50.00", undefined, undefined], "control: the fill open, the Safe's one figure; one send is paid from one place (Private, or the Safe through Private), so its most is the bigger part; no standing line (said only when typed over)");
  assert.deepEqual([open[0]!.label, open[0]!.place], ["USDC · your Safe", "your Safe"], "control: the fill open, the row pays from the Safe through Private, so it is the Safe's");
  assert.deepEqual(sendSources([], [usdc("30", "ledger")], [], false), [], "all of it in the Safe and its route shut: not offered (D125)");
  // the wallets come first, each with its fee room kept
  const both = sendSources(rowCoins(status()), [usdc("30", "ledger")], [usdc("20", "private")], false);
  assert.deepEqual(both.map((s) => s.label), ["SOL · your SOL wallet", "ETH (RH) · your ETH (RH) wallet", "USDC · Private"], "the coin, then where it is");
  assert.deepEqual(both.map((s) => s.place), ["your SOL wallet", "your ETH (RH) wallet", "Private"], "the amount line's place: \"0.5 SOL from your SOL wallet\"");
  assert.ok(!both.some((s) => /\brow\b|ETH on Robinhood|Hidden|in your Safe/.test(s.label)), "control: never a row, ETH on Robinhood, Hidden, or \"USDC on NEAR in your Safe\"");
  // the Safe's share is the engine's: one call, which pays the pocket's part first and says the most it can (ledger.sendFromSafe)
  assert.match(sheet, /"ledger\.sendFromSafe", \{ tokenId: a\.source\.tokenId, to: payee, toTokenId,/);
  const { SAFE_SEND_OPEN } = await import("./send-sources.ts");
  const { SAFE_FILL_OPEN } = await import("@zerofee/core/safe-fill-open");
  assert.equal(SAFE_SEND_OPEN, SAFE_FILL_OPEN, "the Safe's share opens with its fill (Send asks with `fill`), never before");
  assert.match(sheet, /\.\.\.upTo, \.\.\.\(a\.source\.privateOnly \? \{\} : \{ fill: true \}\),/, "Send asks the ledger to fill Private from the Safe; a Private-only row (it pays from Private alone) never asks for the fill, so it is never refused as the Safe's shut Send");
});

test("E3 from the sheet: a wallet's Send asks the one-Approve private route with the payee on its network and what it lands as", async () => {
  const { payeeOf } = await import("./send-sources.ts");
  assert.deepEqual(payeeOf({ recipient: { kind: "address", chain: null, candidates: ["eth"], address: " 0xabc " }, network: "base" }), { kind: "chain", chain: "base", address: "0xabc" });
  assert.deepEqual(payeeOf({ recipient: { kind: "ledger", accountId: "bob.near" }, network: "near" }), { kind: "ledger", accountId: "bob.near" });
  assert.deepEqual(payeeOf({ recipient: { kind: "near-wallet", accountId: "sam.near" }, network: "near" }), { kind: "chain", chain: "near", address: "sam.near" });
  assert.match(sheet, /const toTokenId = a\.exactOut\?\.tokenId \?\? \(payee\.kind === "ledger" \|\| a\.network === "near" \? nearLandsAs\(a\.source\)\.tokenId : LANDS_AS\[a\.network\]\.tokenId\);/);
  assert.match(sheet, /"ledger\.hiddenFromRow", \{ chain: a\.source\.row, \.\.\.\(a\.source\.coin \? \{ coin: a\.source\.coin \} : \{\}\), to: payee, toTokenId, \.\.\.amount/);
  assert.match(sheet, /const amount = a\.exactOut && a\.source\.row \? \{ amountOut: a\.exactOut\.amount \} : a\.source\.row \? \{ amountIn: a\.amountIn \} : \{ amount: safeAmount\(a\) \};/, "what leaves the wallet, or exactly what a request asks; the Safe pays what leaves");
  const { safeAmount } = await import("./send-sources.ts");
  const src = { id: "safe:u", row: null, tokenId: "u", label: "USDC · your Safe", place: "your Safe", symbol: "USDC", chain: "near", amount: "50", usd: "50", max: "20" };
  assert.equal(safeAmount({ source: src, amountIn: "7.5", usd: 7.5 }), "7.5", "the form's amount as it is");
  assert.equal(safeAmount({ source: src, amountIn: "0", usd: 12.345678912, exactOut: { tokenId: "nep141:wrap.near", amount: "3", symbol: "wNEAR" } }), "12.345678", "a request's dollars in this coin, six places, down");
  assert.equal(safeAmount({ source: { ...src, usd: undefined }, amountIn: "0", usd: 12, exactOut: { tokenId: "x", amount: "3", symbol: "X" } }), "", "control: no price, nothing guessed");
});

test("every coin in Send's and Swap's pickers has its own name: the network where two could read the same (3 Nov e2e walk, 30/51)", async () => {
  const bridge = createMockBridge({ latencyMs: 0, tradeChains: ["sol", "hood"], float: { opening: { sol: "1000000000", hood: "100000000000000000" } } });
  const r = await bridge.call<Balance[]>("ledger.balances", {});
  assert.ok("ok" in r);
  const safe = r.ok;
  const all = [...rowCoins(status()), ...safe.filter((b) => b.listed !== false)];
  const names = all.map((b) => coinLabel(b, chainName));
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], `two coins read the same: ${names.join(", ")}`);
  for (const want of ["SOL wallet", "ETH (RH) wallet", "USDC on NEAR", "USDC on your account", "USDC on Solana", "USDC on Base", "NEAR", "NEAR on your account", "SOL", "ETH", "BTC"]) assert.ok(names.includes(want), `${want} in ${names.join(", ")}`);
  // control: the symbol alone (the walk's chips) reads four USDC and two NEAR the same
  const bare = all.map((b) => (isRowLike(b) ? b.name : b.symbol));
  assert.equal(bare.filter((n) => n === "USDC").length, 4);
  assert.equal(bare.filter((n) => n === "NEAR").length, 2);
  assert.equal(coinLabel({ tokenId: "nep141:base.omft.near", symbol: "ETH", name: "Ether", chain: "base", held: "ledger" }, chainName), "ETH on Base", "ETH on Base is never Ethereum's ETH");
});
const isRowLike = (b: Pick<Balance, "tokenId">) => b.tokenId.startsWith("row:");

test("Home's wallet preset: Send from a wallet's page opens on that wallet; a wallet Send can't send from opens on the first (control)", async () => {
  const { sendSources, startSource } = await import("./send-sources.ts");
  const all = sendSources(rowCoins(status()), [usdc("30", "ledger")], [usdc("20", "private")], false);
  assert.equal(startSource("hood", all), "row:hood");
  assert.equal(startSource("sol", all), "row:sol");
  assert.equal(startSource("safe", all), all.find((s) => s.row === null)!.id);
  // D70 (a web test): Home's own Send, and a wallet it can't send from, open on Private (the Safe's coin that can send most now)
  assert.equal(startSource("bsc", all), all.find((s) => s.row === null)!.id);
  assert.equal(startSource(undefined, all), all.find((s) => s.row === null)!.id);
  assert.notEqual(startSource(undefined, all), all[0]!.id, "control: the dropdown's first is a wallet");
  // the coin that can send the most dollars now, not the biggest coin: a big Safe coin with little in Private loses
  const two = sendSources([], [usdc("900", "ledger")], [usdc("5", "private"), { ...usdc("40", "private"), tokenId: "nep141:wrap.near", symbol: "NEAR", chain: "near", usd: "40" }], false);
  assert.equal(startSource(undefined, two), "safe:nep141:wrap.near");
  // nothing in Private: the dropdown's first, as before
  assert.equal(startSource(undefined, sendSources(rowCoins(status()), [usdc("30", "ledger")], [], false)), null);
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /sources\.find\(\(s\) => s\.id === sourceId\) \?\? sources\.find\(\(s\) => s\.id === start\) \?\? sources\[0\]/, "the person's own pick wins over the preset");
  assert.match(sheet, /start=\{startSource\(wallet, sources, coin\)\}/);
});

test("QA's Sim crawl (5 Nov): a coin page's Send opens From that coin, never the Safe's biggest (USDC); control: no coin asked is as before", async () => {
  const { sendSources, startSource } = await import("./send-sources.ts");
  const near = (amount: string, held: "ledger" | "private") => ({ ...usdc(amount, held), tokenId: "nep141:wrap.near", symbol: "NEAR", chain: "near", usd: amount });
  const all = sendSources(rowCoins(status()), [usdc("900", "ledger"), near("10", "ledger")], [usdc("50", "private"), near("4", "private")], true);
  assert.equal(startSource(undefined, all, "NEAR"), "safe:nep141:wrap.near", "the NEAR page's Send opens on NEAR");
  assert.equal(startSource("safe", all, "NEAR"), "safe:nep141:wrap.near", "the coin wins over the wallet preset");
  assert.notEqual(startSource(undefined, all), "safe:nep141:wrap.near", "control: Home's own Send opens on the coin that sends most (USDC)");
  assert.equal(startSource(undefined, all, "DOGE"), startSource(undefined, all), "a coin that can't go now: the old rule, never a dead From");
  const host = readFileSync(new URL("./MoneyHost.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(host, /<SendLater link=\{ask\.link\} wallet=\{ask\.wallet\} [^>]*\{\.\.\.\(ask\.coin \? \{ coin: ask\.coin \} : \{\}\)\}/);
  assert.match(app, /<Coin line=\{view\.line\} onSend=\{\(\) => shell\.openMoney\(\{ kind: "send", coin \}/);
  assert.doesNotMatch(app, /<Coin line=\{view\.line\} onSend=\{send\} \/>/, "control: the old Send with no coin");
});

test("audit H1 (fix #3): the Send sheet tells the ledger the most its source can send (upTo), from a wallet and from the Safe, so leg 1 can round its inflow up to the grid (control: the amount itself is as before)", () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const upTo = Number\(a\.source\.max\) > 0 \? \{ upTo: a\.source\.max \} : \{\};/);
  assert.equal((sheet.match(/\.\.\.amount, \.\.\.upTo, /g) ?? []).length, 2, "both ways: hiddenFromRow and sendFromSafe");
});

test("privacy audit (4 Nov, review): Max says exactly what goes to them and that the rest stays in Private, the same figures the Send pays (core maxSend); not Max, nothing said", () => {
  const sol = { max: "1.42", symbol: "SOL" };
  assert.equal(maxSendLine(sol, "1.42", 9), "1.3592 SOL goes to them. The rest stays in Private.", "at most 4 decimals, rounded down (QA, 5 Nov: never a raw 1.3592233)");
  assert.equal(maxSendLine({ max: "515", symbol: "USDC", pocket: "15" }, "515", 6), "485.4368 USDC goes to them. The rest stays in Private.", "the pocket's part counts inside the gap: the same total as with none");
  assert.equal(maxSendLine({ max: "1100", symbol: "USDC", pocket: "600" }, "1100", 6), "600 USDC goes to them. The rest stays in your Safe.", "the pocket alone fills the limit: all of it goes, the Safe's part stays");
  assert.equal(maxSendLine(sol, "1.4", 9), null, "control: not Max");
  assert.doesNotMatch(maxSendLine({ max: "747.572815", symbol: "USDC", pocket: "0" }, "747.572815", 6) ?? "", /\.\d{5,}/, "never a raw 6-decimal figure (the Sim walk read 689.320388 USDC)");
  assert.equal(maxSendLine({ max: "5", symbol: "USDC", pocket: "5" }, "5", 6), null, "all of it already private: nothing rounded, nothing said");
  assert.equal(maxSendLine(sol, "1.42", undefined), "Some of it stays in Private.");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /under\.max \? <p className="zf-small wl-send2__coins" data-testid="send-max-line">\{under\.max\}<\/p>/, "the sheet shows it, in the one slot (copy review, 6 Nov)");
});

test("QA's condition on D70's default: someone who expected their SOL wallet sees it's the Safe before any approval (control: a wallet preset still says its wallet)", async () => {
  const { sendSources, startSource } = await import("./send-sources.ts");
  const all = sendSources(rowCoins(status()), [usdc("30", "ledger")], [usdc("20", "private")], false);
  const opened = all.find((s) => s.id === startSource(undefined, all))!;
  assert.equal(opened.place, "Private", "the From row names where it really pays from (the fill shut: Private; QA test, MUST 3)");
  assert.equal(all.find((s) => s.id === startSource("sol", all))!.place, "your SOL wallet", "control");
  // the From row shows the source's place, in bold, before Hold to send (SendForm)
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /<span className="wl-send2__label">From<\/span>[\s\S]{0,900}<b>\{source\.place\}<\/b>/);
  // the check sheet says where it leaves from: the Sim's Send from the Safe, and the core's Safe sheet for a Swap's Move
  const mock = createMockBridge({ latencyMs: 0, hiddenStart: { usdc: "25", near: "2" }, freshHistory: true });
  let sheet: { title?: string; lines?: string[] } | null = null;
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (p) => { sheet = p.words; void mock.call("approval.answer", { id: p.id, approve: false }); });
  await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
  await mock.call("ledger.sendFromSafe", { app: "wallet", tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "5", to: { kind: "chain", chain: "sol", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } });
  assert.ok(sheet, "an approval sheet was shown");
  assert.ok((sheet as { lines?: string[] }).lines!.some((l) => /leaves Private on NEAR/.test(l)), JSON.stringify(sheet));
  assert.match(readFileSync(new URL("../../../../core/src/intents.ts", import.meta.url), "utf8"), /lines: \["From your Safe\."\]/);
});

test("Send every coin as itself (product decision, 5 Nov; the chat-pay builder's money-wrong): the Safe's USDC to a NEAR name lands as USDC, exact, and the line says so; control: NEAR and a wallet's SOL still land as NEAR", async () => {
  const { nearLandsAs, LANDS_AS } = await import("../../send-to.ts");
  const { routeLines } = await import("../../send-reach.ts");
  const { sendSources } = await import("./send-sources.ts");
  const [safeUsdc] = sendSources([], [], [usdc("20", "private")], false);
  assert.deepEqual(nearLandsAs(safeUsdc), { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", coin: "USDC" });
  assert.deepEqual(routeLines("near", nearLandsAs(safeUsdc).coin), ["Public on NEAR.", "Lands as USDC on NEAR."], "the coin that lands, after who sees it");
  // the copy review's pair walk (send-add-must 602b4c9af): 1Click delivers native NEAR to a NEAR account, so the line says NEAR
  const wrapped = { tokenId: LANDS_AS.near.tokenId, coin: "NEAR" };
  assert.deepEqual(nearLandsAs({ row: null, chain: "near", tokenId: "nep141:wrap.near", symbol: "wNEAR" }), wrapped, "control: the Safe's NEAR is NEAR");
  assert.deepEqual(nearLandsAs({ row: "sol", chain: "sol", tokenId: "row:sol", symbol: "SOL" }), wrapped, "control: a wallet's SOL to a NEAR name lands as NEAR");
  assert.deepEqual(nearLandsAs({ row: null, chain: "eth", tokenId: "nep141:eth.omft.near", symbol: "ETH" }), wrapped, "control: a coin from another chain lands as NEAR");
  assert.deepEqual(routeLines("near", nearLandsAs(null).coin), ["Public on NEAR."], "control: NEAR on NEAR is said once");
  assert.deepEqual(routeLines("sol", "USDC"), ["Public on Solana."], "control: another chain, its network line only");
  assert.match(readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8"), /routeLines\(network, nearLandsAs\(source\)\.coin, who\.recipient\.kind === "ledger"\)\.map\(/, "the form's lines, in the card under the payee (a16)");
});

test("UI's Home audit (5 Nov, the Sim): while the Safe's own route is shut (SAFE_SEND_OPEN, the real app's CONVERT_ROUTES.nearOrigin) Send's Max is what can go, the same figure the Sim's refusal names, so its button lights up to it; the From row is Home's figure (product decision, 5 Nov); control: with the route open Max is more", async () => {
  const { sendSources, SAFE_SEND_OPEN } = await import("./send-sources.ts");
  assert.equal(SAFE_SEND_OPEN, true, "the fill is open in every build (safe-fill-open.ts): Send offers the Safe's own part; below, the fill shut (false) is the control");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 1, hiddenStart: { usdc: "0", near: "2" } });
  const safe = (await mock.call("ledger.balances", {})) as { ok: import("../../types.ts").Balance[] };
  const priv = (await mock.call("ledger.private", {})) as { ok: { rows: import("../../types.ts").Balance[] } };
  const sources = sendSources([], safe.ok, priv.ok.rows.filter((r) => Number(r.amount) > 0), false);
  const near = sources.find((s) => s.tokenId === "nep141:wrap.near")!;
  assert.equal(near.max, "2", "Max: the 2 NEAR that can go");
  assert.ok(Number(near.amount) > 2, `the From row: Home's NEAR figure (${near.amount}), never a second figure`);
  const over = (await mock.call("ledger.sendFromSafe", { tokenId: "nep141:wrap.near", amount: "2.5", to: { kind: "chain", chain: "sol", address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" } })) as { problem?: { whatHappened: string } };
  assert.match(over.problem?.whatHappened ?? "", /^Up to 2 NEAR can go now\./, "the refusal names the row's own figure");
  const fits = (await mock.call("ledger.sendFromSafe", { tokenId: "nep141:wrap.near", amount: "2", to: { kind: "chain", chain: "sol", address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" } })) as { ok?: unknown[] };
  assert.ok(Array.isArray(fits.ok), "Max goes");
  const open = sendSources([], safe.ok, priv.ok.rows.filter((r) => Number(r.amount) > 0), true).find((s) => s.tokenId === "nep141:wrap.near")!;
  assert.ok(Number(open.max) > 2, `control: route open, the Safe's own NEAR can go too (${open.max})`);
});

test("product decision (5 Nov): Send's From shows each Safe coin whose fill works end to end (a coin native to NEAR) as the Safe's total, the most one send can be the bigger of its two places; a bridged coin's Safe part is left out, never a dead row (controls: its share in Private still shows; the fill shut, as before)", async () => {
  const { sendSources } = await import("./send-sources.ts");
  const btc = (amount: string, held: Balance["held"]): Balance => ({ tokenId: "nep141:btc.omft.near", symbol: "BTC", name: "Bitcoin", icon: "btc", chain: "btc", amount, usd: String(Number(amount) * 100000), bridged: true, held, listed: true });
  const open = sendSources([], [usdc("30", "ledger"), btc("0.01", "ledger")], [usdc("20", "private")], true);
  assert.deepEqual(open.map((s) => [s.symbol, s.amount, s.max]), [["USDC", "50", "30"]], "USDC: the Safe's total, the most one send; BTC's Safe part can't fill: no row (drop, don't degrade)");
  // a bridged coin can't fill: the copy review's Private-only row (send-private-cap's ruling, 5 Nov): one row, its figure in Private,
  // the keypad capped there, no standing line; its Safe part gets no row of its own and no excuse line
  const share = sendSources([], [btc("0.01", "ledger")], [btc("0.002", "private")], true);
  assert.deepEqual(share.map((s) => [s.label, s.max, s.privateOnly ?? null, s.line ?? null, s.cant ?? null, s.part ?? null]), [["BTC · Private", "0.002", true, "BTC · $200.00 in Private", null, null]], "one row: Private's share, its figure, capped there");
  assert.ok(!share.some((s) => /in Private can go|can't take/.test(`${s.part ?? ""} ${s.line ?? ""} ${s.cant ?? ""}`)), "control: no excuse line, never Private's figure under Your Safe");
  assert.deepEqual(sendSources([], [btc("0.01", "ledger")], [], true), [], "a Safe-only BTC: no row at all");
  const shut = sendSources([], [usdc("30", "ledger")], [usdc("20", "private")], false);
  assert.deepEqual(shut.map((s) => [s.amount, s.max]), [["50", "20"]], "control: the fill shut, only Private's share can go");
});
