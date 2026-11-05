// AgentZero's read-only skills (skills.ts), with no network: CoinGecko and GeckoTerminal answer from a fake fetch and a
// fake Trade market; the wallets, services and the dry quote from a fake bridge. Each skill has a control: a wrong coin,
// a failure said plainly (never a guessed figure), and privacy (no address, NEAR name or person's name ever in an answer;
// the dry quote never carries a payable address). The chat-turn half (refusals, fencing, what reaches Claude) is at the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { CoinRow } from "@zerofee/trade/market/types.ts";
import { skillHands, tickerOf, usdText, type SkillDeps } from "./skills.ts";
import { chatTurn, firstSkillMark, markFigures, type ChatEvent, type ChatHands } from "./turn.ts";

const NOW = Date.UTC(2026, 10, 3, 7, 5);
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EVM_ADDR = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const LEAKS = [SOL_ADDR, EVM_ADDR, "kim.near", "alice.near", "lee@example.com", "Kim Lee"];
const noLeak = (s: string, what: string) => {
  for (const l of LEAKS) assert.equal(s.includes(l), false, `${what}: ${l} leaked`);
};

/** CoinGecko's simple/price, recorded in shape; `urls` keeps what was asked. */
function cg(status = 200) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(String(u));
    if (status !== 200) return new Response("{}", { status });
    return new Response(JSON.stringify({ solana: { usd: 162.4123, usd_24h_change: -4.234, last_updated_at: NOW / 1000 - 60 }, near: { usd: 2.5112, usd_24h_change: 1.06, last_updated_at: NOW / 1000 - 60 } }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, urls };
}
const row = (symbol: string, over: Partial<CoinRow> = {}): CoinRow => ({ chain: "sol", address: SOL_ADDR, symbol, name: symbol, priceUsd: 0.0000234567, change24hPct: 12.345, volume24hUsd: 1_234_567, liquidityUsd: 50_000, ...over });
const market = (o: { search?: CoinRow[]; trending?: CoinRow[] & { asOf?: number }; fail?: boolean } = {}) => async () => ({
  search: async () => (o.fail ? Promise.reject(new Error("gt down")) : (o.search ?? [])),
  trending: async () => (o.fail ? Promise.reject(new Error("gt down")) : (o.trending ?? [])),
  candles: async () => [0, 1, 2, 3, 4, 5, 6].map((i) => ({ t: NOW - (6 - i) * 86_400_000, o: 150 + i, h: 170 + i, l: 140 + i, c: 151 + i, v: 1 })),
});
const bridgeOf = (answers: Record<string, unknown>): Bridge & { calls: [string, unknown][] } => {
  const calls: [string, unknown][] = [];
  return {
    calls,
    call: async (m: string, p?: unknown) => {
      calls.push([m, p]);
      const a = answers[m];
      return (a === undefined ? { problem: { code: "x", whatHappened: "no" } } : typeof a === "function" ? a(p) : { ok: a }) as never;
    },
    on: () => () => {},
  } as never;
};
const hands = (o: Partial<SkillDeps> = {}) => skillHands({ bridge: bridgeOf({}), now: () => NOW, clock, fetch: cg().f, market: market(), probes: async () => ({}), ...o });

test("market_price: price, 24h change and the data's time through Trade's relay (/v0/market/cg); a range from Trade's candles; small round numbers", async () => {
  const c = cg();
  const t = await hands({ fetch: c.f, relay: "https://relay.test" }).prices({ coins: ["sol", "$NEAR"], range: "7d" });
  assert.match(c.urls[0]!, /^https:\/\/relay\.test\/v0\/market\/cg\/simple\/price\?ids=solana,near&vs_currencies=usd&include_24hr_change=true/);
  assert.match(t, /^SOL: \$162\.41, down 4\.2% in 24 hours \(CoinGecko, data from 07:04\); over 7 days: high \$176\.00, low \$140\.00, up 4\.7%$/m);
  assert.match(t, /^NEAR: \$2\.51, up 1\.1% in 24 hours/m);
  assert.ok(t.length < 400, "a small answer");
  // control: candles that end hours ago give no range figure (never old data as now)
  const stale = await hands({ market: async () => ({ ...(await market()()), candles: async () => [0, 1, 2].map((i) => ({ t: NOW - 18 * 3_600_000 - (2 - i) * 86_400_000, o: 1, h: 2, l: 1, c: 1, v: 1 })) }) }).prices({ coins: ["SOL"], range: "7d" });
  assert.match(stale, /; no 7-day figure for SOL here$/);
  // no relay: CoinGecko's public URL (Trade's own fallback)
  const pub = cg();
  await hands({ fetch: pub.f }).prices({ coins: ["SOL"] });
  assert.match(pub.urls[0]!, /^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price/);
});

test("market_price, controls: a failed fetch says so (no figure, never stale); a wrong coin is named as not found; another ticker is Trade's search, never its contract id", async () => {
  const fail = await hands({ fetch: cg(500).f }).prices({ coins: ["SOL"] });
  assert.equal(fail, "SOL: couldn't get its price right now.");
  assert.doesNotMatch(fail, /\$\d/);
  const none = await hands({ market: market({ search: [row("BONKY")] }) }).prices({ coins: ["BONK"] });
  assert.equal(none, "BONK: no coin with that ticker was found.");
  const found = await hands({ market: market({ search: [row("BONK", { liquidityUsd: 10 }), row("BONK", { priceUsd: 0.00002, change24hPct: -1 })] }) }).prices({ coins: ["BONK"] });
  assert.match(found, /^BONK \(on Solana\): \$0\.00002, down 1\.0% in 24 hours \(GeckoTerminal, data from 07:05\)$/);
  noLeak(found, "searched coin");
  const down = await hands({ market: market({ fail: true }) }).prices({ coins: ["BONK"] });
  assert.equal(down, "BONK: couldn't get its price right now.");
});

test("market_trending: top 5 by symbol, price, 24h and volume with the time; a coin named only by its address is left out (control: it was in the list); failure and an old list said plainly", async () => {
  const list = [row(SOL_ADDR), row("WIF"), row("BONK"), row("POPCAT"), row("MEW"), row("FARTCOIN"), row("SEVENTH")];
  const t = await hands({ market: market({ trending: list }) }).trending("solana");
  const lines = t.split("\n");
  assert.equal(lines[0], "Trending on Solana (GeckoTerminal, data from 07:05):");
  assert.deepEqual(lines.slice(1).map((l) => l.split(":")[0]), ["1. WIF", "2. BONK", "3. POPCAT", "4. MEW", "5. FARTCOIN"]);
  assert.match(lines[1]!, /^1\. WIF: \$0\.00002346, up 12\.3% in 24 hours, \$1\.2M traded in 24 hours$/);
  noLeak(t, "trending");
  assert.equal(tickerOf(SOL_ADDR), null, "control: the address is refused as a name");
  assert.equal(tickerOf("0x7D06…7e3D"), null);
  const old = await hands({ market: market({ trending: Object.assign([row("WIF")], { asOf: NOW - 3_600_000 }) }) }).trending("near");
  assert.match(old, /^Trending on NEAR \(GeckoTerminal, an older list, from 06:05/);
  assert.equal(await hands({ market: market({ fail: true }) }).trending("solana"), "Couldn't get what's trending on Solana right now.");
});

const STATUS = { loaded: true, totalUsd: "0", reserveUsd: "15.40", cashUsd: "0", coinsUsd: "0", capUsd: "500", roomUsd: "0", ready: true, onItsWay: [], firstTopUp: false, networks: [{ network: "sol", name: "Solana", cashUsd: "22.50", coinsUsd: "3.00", readyUsd: "20", nativeAmount: "0.1385" }, { network: "hood", name: "Robinhood", cashUsd: "4.10", coinsUsd: "0", readyUsd: "4", nativeAmount: "0.0018" }, { network: "bsc", name: "BNB", cashUsd: "0", coinsUsd: "0", readyUsd: "0", closed: true }] };
const WALLETS = {
  "ledger.balances": [{ tokenId: "a", symbol: "USDC", name: "USD Coin", chain: "near", amount: "1240.5", usd: "1240.5" }, { tokenId: "b", symbol: "USDC", name: "USD Coin", chain: "sol", amount: "42.1", usd: "42.1" }, { tokenId: "c", symbol: "NEAR", name: "NEAR", chain: "near", amount: "312.4", usd: "1383.93" }, { tokenId: "d", symbol: SOL_ADDR, name: "kim.near's coin", chain: "sol", amount: "5", usd: "1" }],
  "spending.status": STATUS,
  "trade.positions": [{ chain: "sol", address: SOL_ADDR, symbol: "BONK", amount: "1250000", usd: "29.10" }, { chain: "near", address: "alice.near", symbol: "QTC", amount: "0.5", usd: "35.10" }],
};

test("read_holdings: dollars and coin amounts per wallet in the product's words; no address, NEAR name or person's name (control: the bridge's answers hold them)", async () => {
  const t = await hands({ bridge: bridgeOf(WALLETS) }).holdings();
  assert.match(t, /^Your Safe: \$2,667\.53 \(312\.4 NEAR \$1,383\.93, 1282\.6 USDC \$1,282\.60, an unnamed coin \$1\.00\)$/m);
  assert.match(t, /^Your SOL wallet: \$51\.60 \(0\.1385 SOL\)\. Coins: 1250000 BONK \$29\.10\.$/m);
  assert.match(t, /^Your ETH \(RH\) wallet: \$4\.10 \(0\.0018 ETH\)\.$/m);
  assert.match(t, /^Your NEAR wallet: \$50\.50 \(cash \$15\.40 in USDC\)\. Coins: 0\.5 QTC \$35\.10\.$/m);
  assert.doesNotMatch(t, /BNB/, "a closed, empty BNB wallet isn't said");
  assert.doesNotMatch(t, /\b(?:Hidden|Trading|Spending)\b|row/);
  noLeak(t, "holdings");
  assert.ok(JSON.stringify(WALLETS).includes(SOL_ADDR) && JSON.stringify(WALLETS).includes("alice.near"), "control: the answers held them");
});

test("read_holdings, control: a wallet that can't be read is said so, never $0.00", async () => {
  const t = await hands({ bridge: bridgeOf({ "ledger.balances": WALLETS["ledger.balances"] }) }).holdings();
  assert.match(t, /^Your SOL wallet, your ETH \(RH\) wallet and your NEAR wallet: couldn't be read right now\.$/m);
  const none = await hands({ bridge: bridgeOf({}) }).holdings();
  assert.match(none, /^Your Safe: couldn't be read right now\.$/m);
  assert.doesNotMatch(none, /\$0\.00/);
});

test("quote_dry: the core's dry swapQuote, amounts only: no deposit address, nothing payable (control: the core's answer carried them)", async () => {
  const answer = { amountIn: "20000000", amountOut: "123000000", minAmountOut: "121770000", decimals: 9, symbol: "SOL", coinUsd: 162.4, etaSeconds: 20, depositAddress: EVM_ADDR, quoteId: "q-123", recipient: "alice.near", deadline: "2026-11-03T08:00:00Z" };
  const b = bridgeOf({ "subwallet.float.swapQuote": answer });
  const t = await hands({ bridge: b }).quote({ usd: 20, pay: "USDC", get: "sol" });
  assert.deepEqual(b.calls, [["subwallet.float.swapQuote", { side: "buy", coin: "nep141:sol.omft.near", amount: "20000000" }]]);
  assert.equal(t, "$20.00 of USDC gets about 0.123 SOL, at least 0.12177 SOL (worth about $19.98 at NEAR Intents' $162.40 per SOL); a swap takes about 20 s. Priced at 07:05; a real swap is priced again when it's done. Nothing moved.");
  noLeak(t, "quote");
  assert.doesNotMatch(t, /q-123|deposit|2026-11-03T08/);
  assert.ok(JSON.stringify(answer).includes(EVM_ADDR), "control: the answer held an address");
  // a sale: its coin amount from CoinGecko's price, USDC back
  const s = bridgeOf({ "subwallet.float.swapQuote": { amountOut: "19900000", minAmountOut: "19700000", decimals: 9, coinUsd: 162.4 } });
  const st = await hands({ bridge: s }).quote({ usd: 20, pay: "SOL", get: "USDC" });
  assert.equal((s.calls[0]![1] as { side: string }).side, "sell");
  assert.match(st, /^0\.123143 SOL \(about \$20\.00\) gets about \$19\.90 in USDC, at least \$19\.70\./);
});

test("quote_dry, controls: a wrong coin, two non-USDC coins and a failed quote are said plainly; nothing is asked of the core for them", async () => {
  const b = bridgeOf({});
  const h = hands({ bridge: b });
  assert.match(await h.quote({ usd: 20, pay: "USDC", get: "BNB" }), /^BNB can't be priced against USDC here yet\. Coins that can: SOL, ETH, BTC, NEAR\.$/);
  assert.equal(await h.quote({ usd: 20, pay: "SOL", get: "ETH" }), "Only a swap to or from USDC can be priced here.");
  assert.equal(b.calls.length, 0);
  assert.equal(await h.quote({ usd: 20, pay: "USDC", get: "SOL" }), "NEAR Intents gave no price for that swap right now. Nothing moved.");
});

test("quote_dry through the sample bridge as AgentZero: the dry price is allowed, a real swap is not (control: Pay may not price one)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const agent = forApps(mock, "agent");
  const q = await agent.call<Record<string, unknown>>("subwallet.float.swapQuote", { side: "buy", coin: "nep141:sol.omft.near", amount: "20000000" });
  assert.ok("ok" in q, JSON.stringify(q));
  assert.deepEqual(Object.keys(q.ok).filter((k) => /address|deposit|recipient|refund|id$/i.test(k)), [], "nothing payable in the core's answer");
  const swap = await agent.call("subwallet.float.swap", { side: "buy", coin: "nep141:sol.omft.near", amount: "20000000", atLeast: "1", key: "k1" });
  assert.ok("problem" in swap, "AgentZero can't swap through it");
  const pay = await forApps(mock, "pay").call("subwallet.float.swapQuote", { side: "buy", coin: "nep141:sol.omft.near", amount: "20000000" });
  assert.ok("problem" in pay, "control: another app is still refused");
  const t = await skillHands({ bridge: agent, now: () => NOW, clock, fetch: cg().f }).quote({ usd: 20, pay: "USDC", get: "SOL" });
  assert.match(t, /^\$20\.00 of USDC gets about [\d.]+ SOL/);
});

test("service_status: the core's own view names a failing service and since when; the chains' nodes answer live (control: a node that doesn't is said)", async () => {
  const b = bridgeOf({ "ledger.status": [{ service: "oneclick", state: "down", since: new Date(NOW - 600_000).toISOString() }] });
  const t = await skillHands({ bridge: b, now: () => NOW, clock, probes: async () => ({ near: async () => true, solana: async () => false, hood: async () => true }) }).services();
  const lines = t.split("\n");
  assert.equal(lines[0], "NEAR: answering.");
  assert.equal(lines[1], "Solana: not answering right now.");
  assert.equal(lines[2], "Robinhood Chain: answering.");
  assert.match(lines[3]!, /^NEAR Intents isn't answering since /, "53: \"1Click\" is never said on screen");
  assert.equal(lines.at(-1), "Checked at 07:05.");
  const fine = await skillHands({ bridge: bridgeOf({ "ledger.status": [] }), now: () => NOW, clock, probes: async () => ({ near: async () => true }) }).services();
  assert.match(fine, /NEAR Intents \(the swap service\): no problem seen by ZeroFee's own check\./);
  assert.match(fine, /Solana: couldn't be checked here\./);
  const hung = await skillHands({ bridge: bridgeOf({}), now: () => NOW, clock, probes: async () => ({ near: () => Promise.reject(new Error("x")) }) }).services();
  assert.match(hung, /NEAR: not answering right now\./);
  assert.match(hung, /NEAR Intents \(the swap service\): couldn't be checked right now\./, "control: an unread table is never 'fine'");
});

test("covered_coins: each wallet's coins, BNB's state, the swaps AgentZero may propose (never from the Safe) and the chains to add from", async () => {
  const t = await hands({ bridge: bridgeOf({ "spending.status": STATUS, "ledger.chains": [{ name: "Bitcoin" }, { name: "Ethereum" }, { name: "Solana" }, { name: "<b>x</b>" }] }) }).coins();
  assert.match(t, /your SOL wallet holds SOL; your ETH \(RH\) wallet holds ETH/);
  assert.match(t, /^BNB: not open yet\.$/m);
  assert.match(t, /^Swaps AgentZero can propose: .*SOL · your SOL wallet → USDC · your Safe/m);
  assert.doesNotMatch(t.split("\n").find((l) => l.startsWith("Swaps AgentZero"))!, /BNB|· your Safe →/);
  assert.match(t, /^From your Safe \(AgentZero opens Home's own Swap filled in; you approve it\): USDC · your Safe → SOL · your SOL wallet/m);
  assert.match(t, /Money can be added to your Safe from: Bitcoin, Ethereum, Solana, bxb\./);
  assert.doesNotMatch(t, /\b(?:Hidden|Trading|Spending)\b|\brows?\b/);
  const open = await hands({ bridge: bridgeOf({ "spending.status": { ...STATUS, networks: [...STATUS.networks.slice(0, 2), { ...STATUS.networks[2], closed: undefined }] } }) }).coins();
  assert.match(open, /^BNB: open\.$/m, "control: an open BNB wallet is said open");
  assert.match(open, /BNB · your BNB wallet → /);
});

// ---- the chat turn's half: input checked before the phone reads, every answer fenced and scrubbed

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const start = () => ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const end = (stop: string) => ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
const toolSse = (id: string, name: string, input: object) => start() + ev("content_block_start", { index: 0, content_block: { type: "tool_use", id, name, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + ev("content_block_stop", { index: 0 }) + end("tool_use");
const textSse = (t: string) => start() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) + end("end_turn");
function anthropic(answers: string[]) {
  const bodies: any[] = [];
  const f = (async (_u: unknown, init: any = {}) => (bodies.push(JSON.parse(init.body)), new Response(answers.shift() ?? textSse(""), { headers: { "content-type": "text/event-stream" } }))) as typeof fetch;
  return { f, bodies };
}
async function turn(tool: string, input: object, skills: ChatHands["skills"]) {
  const a = anthropic([toolSse("tu_1", tool, input), textSse("ok")]);
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], "a question?", { relayBase: null, ownKey: "sk-ant-test-0000000000000000", anthropicFetch: a.f, hands: { receipts: async () => "", meter: async () => "", skills } })) out.push(e);
  const step = out.filter((e) => e.kind === "step").at(-1) as { state: string; why?: string };
  return { step, sent: a.bodies.length > 1 ? JSON.stringify(a.bodies[1]) : "", calls: a.bodies.length, out };
}

test("in the turn: each skill is a read that loops back to Claude, fenced as data and scrubbed of any address or NEAR name (control: the hand's text held them)", async () => {
  const leaky = `Your SOL wallet: $5.00 (sent by kim.near from ${SOL_ADDR}, ${EVM_ADDR}, lee@example.com)`;
  for (const [tool, input, key] of [["read_holdings", {}, "holdings"], ["service_status", {}, "services"], ["covered_coins", {}, "coins"], ["market_trending", { chain: "near" }, "trending"], ["market_price", { coins: ["SOL"] }, "prices"], ["quote_dry", { usd: 20, pay: "USDC", get: "SOL" }, "quote"]] as const) {
    const r = await turn(tool, input, { [key]: async () => leaky });
    assert.equal(r.step.state, "done", tool);
    assert.equal(r.calls, 2, `${tool}: a read, so Claude answers after it`);
    assert.match(r.sent, /<data-[0-9a-f]+>/, `${tool}: fenced`);
    assert.match(r.sent, /Your SOL wallet: \{\{f500\}\}/, `${tool}: the figure goes as a mark`);
    assert.deepEqual(r.out.find((e) => e.kind === "facts"), { kind: "facts", facts: [{ mark: "f500", shown: "$5.00", rows: [] }] }, `${tool}: control, the phone keeps the figure for the screen`);
    for (const l of ["kim.near", SOL_ADDR, EVM_ADDR, "lee@example.com"]) assert.equal(r.sent.includes(l), false, `${tool}: ${l} leaked`);
  }
});

test("in the turn, controls: a malformed ask is refused before the phone reads; a hand that fails is said plainly; no hand: can't here", async () => {
  let read = 0;
  const skills = { prices: async () => (read++, "x"), quote: async () => (read++, "x"), trending: async () => (read++, "x") };
  assert.equal((await turn("market_price", { coins: [] }, skills)).step.why, "Those coins couldn't be read. Name up to 5 by symbol, like SOL.");
  assert.equal((await turn("market_price", { coins: ["SOL", "A", "B", "C", "D", "E"] }, skills)).step.why, "Those coins couldn't be read. Name up to 5 by symbol, like SOL.");
  assert.equal((await turn("market_price", { coins: ["SOL"], range: "1y" }, skills)).step.why, "The range is 7d or 30d.");
  assert.equal((await turn("market_price", { coins: [SOL_ADDR] }, skills)).step.why, "Those coins couldn't be read. Name up to 5 by symbol, like SOL.");
  assert.equal((await turn("quote_dry", { usd: -5, pay: "USDC", get: "SOL" }, skills)).step.why, "That amount couldn't be read. Say it in dollars, up to $10,000.");
  assert.equal((await turn("quote_dry", { usd: 50_000, pay: "USDC", get: "SOL" }, skills)).step.why, "That amount couldn't be read. Say it in dollars, up to $10,000.");
  assert.equal((await turn("market_trending", { chain: "ethereum" }, skills)).step.why, "The chain is solana or near.");
  assert.equal(read, 0, "none reached the phone's reads");
  const failed = await turn("market_price", { coins: ["SOL"] }, { prices: () => Promise.reject(new Error("x")) });
  assert.match(failed.sent, /Couldn't get prices right now\. Never guess them\./);
  assert.equal((await turn("read_holdings", {}, undefined)).step.why, "AgentZero can't read that here.");
  // never a sheet, never money: a skill's turn yields no needs-you
  assert.equal((await turn("quote_dry", { usd: 20, pay: "USDC", get: "SOL" }, skills)).out.some((e) => e.kind === "needs-you"), false);
});

test("usdText keeps answers small and round", () => {
  assert.deepEqual([usdText(162.4123), usdText(0.85123), usdText(0.0000234567), usdText(1234567.891)], ["$162.41", "$0.8512", "$0.00002346", "$1,234,567.89"]);
});

test("H-2 for the skills: every figure (dollars, percent, a coin amount, a time, seconds) becomes a mark the phone keeps; words, dates and list numbers stay (control: the marks count up past the chat's own)", () => {
  let n = 500;
  const m = markFigures("Your Safe: $2,667.53 (312.4 NEAR $1,383.93). SOL down 4.2% in 24 hours; about 20 s. 1. WIF. Read at 1:27 PM on 2026-11-03.", () => `f${n++}`);
  assert.equal(m.text, "Your Safe: {{f500}} ({{f501}} {{f502}}). SOL down {{f503}} in 24 hours; about {{f504}}. 1. WIF. Read at {{f505}} on 2026-11-03.");
  assert.deepEqual(m.facts.map((f) => f.shown), ["$2,667.53", "312.4 NEAR", "$1,383.93", "4.2%", "20 s", "1:27 PM"]);
  assert.ok(m.facts.every((f) => f.rows.length === 0));
  assert.equal(firstSkillMark([{ role: "user", content: "hi" }]), 500);
  assert.equal(firstSkillMark([{ role: "assistant", content: "You had {{f512}} and {{f3}}" }]), 513, "control: past a mark already in the chat");
  assert.equal(markFigures("$5", () => null).text, "$5", "past f999: the figure stays as it is");
});

test("read_holdings says the sites' own wallets, as Home counts them (QA 5 Nov: \"I only read your four wallets\" beside $50 in pump.fun's and GMGN's); control: none read, said so; an empty one isn't said", async () => {
  const sites = [
    { id: "s1", role: "site", site: "pump", network: "sol", address: SOL_ADDR, label: "pump.fun wallet", current: true, inCap: true, cashUsd: "25.00", coinsUsd: "2.47", keyExported: false },
    { id: "s2", role: "site", site: "gmgn", network: "sol", address: SOL_ADDR, label: "GMGN wallet", current: true, inCap: true, cashUsd: "25.00", coinsUsd: "0", keyExported: false },
    { id: "s3", role: "site", site: "axiom", network: "sol", address: SOL_ADDR, label: "Axiom wallet", current: true, inCap: true, cashUsd: "0", coinsUsd: "0", keyExported: false },
    { id: "h", role: "hub", network: "near", address: "x", label: "Spending", current: true, inCap: true, cashUsd: "15.40", keyExported: false },
    { id: "s4", role: "site", site: "pump", network: "sol", address: SOL_ADDR, label: "Older pump.fun wallet", current: false, inCap: false, cashUsd: "3.00", coinsUsd: "0", keyExported: false },
    { id: "s5", role: "site", site: "agentzero", network: "near", address: "y", label: "AgentZero wallet", current: true, inCap: false, cashUsd: "4.00", coinsUsd: "0", keyExported: false },
  ];
  const t = await hands({ bridge: bridgeOf({ ...WALLETS, "spending.wallets": sites }) }).holdings();
  assert.match(t, /^Your pump\.fun wallet: \$27\.47\. It pays only on its own site\.$/m);
  assert.match(t, /^Your GMGN wallet: \$25\.00\. It pays only on its own site\.$/m);
  assert.doesNotMatch(t, /Axiom|Spending:|Older|AgentZero wallet/, "an empty site wallet, the hub, an older wallet and AgentZero's own aren't said");
  noLeak(t, "holdings");
  const none = await hands({ bridge: bridgeOf(WALLETS) }).holdings();
  assert.match(none, /^Your sites' own wallets \(pump\.fun, GMGN\): couldn't be read right now\.$/m, "control: unread, said so");
});

test("read_holdings says AgentZero's own wallet, as Home's row counts it (QA 5 Nov: its $1.99 was in neither); control: no AgentZero wallet here, no line; unread, said so", async () => {
  const t = await hands({ bridge: bridgeOf({ ...WALLETS, "account.agent.balance": { usdcMicros: "1990000" } }) }).holdings();
  assert.match(t, /^AgentZero's own wallet: \$1\.99\. It pays for AgentZero's thinking\.$/m);
  noLeak(t, "holdings");
  const none = await hands({ bridge: bridgeOf({ ...WALLETS, "account.agent.balance": null }) }).holdings();
  assert.doesNotMatch(none, /AgentZero's own wallet/, "control: none on this phone");
  const refused = await hands({ bridge: bridgeOf({ ...WALLETS, "account.agent.balance": () => ({ problem: { code: "security.bridge.not-allowed" } }) }) }).holdings();
  assert.doesNotMatch(refused, /AgentZero's own wallet/, "control: not this app's to read");
  const down = await hands({ bridge: bridgeOf({ ...WALLETS, "account.agent.balance": () => ({ problem: { code: "security.nodes.unreachable" } }) }) }).holdings();
  assert.match(down, /^AgentZero's own wallet: couldn't be read right now\.$/m);
});
