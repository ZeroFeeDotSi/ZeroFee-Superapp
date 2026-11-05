// AgentZero in the Sim (D157): a whole conversation on the REAL brain (chatTurn, its prompt, plans and tools) against the
// relay's Sim route, with Claude recorded, and every tool on the Sim's own bridge (the MockBridge with the sample money,
// Spending and Trade's reader routed as the Sim page routes them: gallery/Screens.tsx). No network.
//   "hi" → "what can you do" → "move $5 from my Safe to my SOL wallet" → Home's Move sheet, done on the Sim's money →
//   "what's my balance" reads the Sim's money (the $5 is in the SOL wallet) → "sign me up to a website" → one honest line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SAMPLE_OPENING } from "@zerofee/trade/demo-engine.ts";
import { forApps, routeBridge, type Bridge } from "@zerofee/core/bridge";
import { createTradeReader } from "@zerofee/trade/reader.ts";
import { hostSpending } from "@zerofee/trade/spending-host.ts";
import { skillHands } from "@zerofee/agent/chat/skills";
import { chatTurn, type ChatEvent, type ChatMessage } from "@zerofee/agent/chat/turn";
import { SIM_REAL_LINE, SIM_RESTED_LINE } from "@zerofee/agent/chat/sim";
import { createRelay } from "../../../quotes/relay.mjs";
import { memoryCounter, privateCounter } from "../../../quotes/guards.mjs";
import { PRICES, costMicros } from "../../../quotes/agentzero.mjs";
import { moneyReader } from "./money-reader.ts";
import { moneyAsk } from "./money-ask.ts";
import { SIM_STARTERS } from "./sim-chat.ts";

const WEB = "https://superapp.zerofee.si";
const RECORDED_USD: Record<string, number> = { sol: 101.67, bsc: 744.17, hood: 2347.2 };

/** The Sim page's bridges (gallery/Screens.tsx demoBridge, routedShell, forApps), started as Demo starts them. */
async function simBridges() {
  const mock = createMockBridge({ latencyMs: 0, tradeChains: ["sol", "hood", "bsc"], hiddenStart: { usdc: "25", near: "2" }, freshHistory: true, mainnetRules: {}, sampleLaptop: true, account: { accountId: "zf-account", network: "mainnet" }, float: { priceUsd: (c: string) => RECORDED_USD[c]!, opening: SAMPLE_OPENING, moveMs: 10 } } as never);
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  const apps = new Map<string, Bridge>();
  const spending = hostSpending(() => apps.get("trade")!, () => forApps(mock, "trade"));
  const shell = routeBridge(mock, { trade: createTradeReader(forApps(mock, "trade")), spending });
  for (const id of ["trade", "agent", "wallet"]) apps.set(id, forApps(shell, id));
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  const stop = spending.start();
  return { agent: apps.get("agent")!, wallet: apps.get("wallet")!, stop };
}

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
/** One recorded Claude reply: words, or one tool call. */
function reply(r: { text: string } | { tool: string; input: object }, usage = { input_tokens: 420, output_tokens: 48, cache_read_input_tokens: 6_100, cache_creation_input_tokens: 0 }) {
  const block = "text" in r
    ? ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: r.text } })
    : ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_${r.tool}`, name: r.tool, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(r.input) } });
  return ev("message_start", { message: { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }) +
    block + ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "text" in r ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }) + ev("message_stop", {});
}

test("a whole Sim conversation on the real brain: hi, what can you do, a Move on the Sim's own sheet and money, the balance read from the Sim's money, and one honest line for a sign-up", async () => {
  const sim = await simBridges();
  try {
    // Claude, recorded, one answer per call in order; each request kept as the relay sent it
    const script: Parameters<typeof reply>[0][] = [
      { text: "Hi! I'm AgentZero. Ask me about your pretend money, or to move some." },
      { text: "I can move money between your Safe and your wallets, send, swap, add, read your balance and what you spent. In the Sim it's all pretend money." },
      { tool: "move", input: { from: "safe", to: "sol", usd: 5 } },
      { tool: "read_holdings", input: {} },
      { text: "Your SOL wallet now has {{f502}}. Your Safe has {{f500}}." },
    ];
    const sent: { url: string; body: any; headers: Record<string, string> }[] = [];
    const fetchFn = async (input: any, init: any = {}) => {
      sent.push({ url: String(input instanceof Request ? input.url : input), body: JSON.parse(init.body), headers: Object.fromEntries(new Headers(init.headers).entries()) });
      const next = script[sent.length - 1];
      assert.ok(next, "no more recorded replies");
      return new Response(reply(next), { headers: { "content-type": "text/event-stream" } });
    };
    const relay = createRelay({ key: "k", secret: "s", origins: [WEB], anthropicKey: "sk-ant-sim-0000", counter: privateCounter({ ...memoryCounter(), shared: true }, "sim-conversation-store-key-0123456789abcdef"), fetchFn });
    const asked: { url: string; headers: Record<string, string> }[] = [];
    const tabFetch = (async (url: string, init: any) => {
      asked.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) });
      return relay(new Request(url, { ...init, headers: { ...init.headers, origin: WEB } }), "203.0.113.50");
    }) as unknown as typeof fetch;
    // the Sim's hands, as useChatTurn gives them (sim-chat.ts): the reader and the skills on the Sim's agent bridge
    let said = "";
    const hands = { receipts: async () => "none", meter: async () => "off", activity: moneyReader(sim.agent, () => said).activity, skills: skillHands({ bridge: sim.agent, relay: null }) };
    let history: ChatMessage[] = [];
    const say = async (words: string) => {
      said = words;
      const out: ChatEvent[] = [];
      for await (const e of chatTurn(history, words, { relayBase: "https://relay.test", fetch: tabFetch, hands, sim: true })) {
        out.push(e);
        if (e.kind === "done") history = e.history;
      }
      return { out, text: out.flatMap((e) => (e.kind === "text" ? [e.delta] : [])).join("") };
    };

    const hi = await say("hi");
    assert.equal(hi.text, "Hi! I'm AgentZero. Ask me about your pretend money, or to move some.");
    const can = await say("what can you do");
    assert.match(can.text, /^I can move money/);
    // the second request carried the first exchange (a real conversation, never one line at a time)
    assert.deepEqual(sent[1]!.body.messages.slice(0, 2).map((m: ChatMessage) => [m.role, typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : b.type)).join("")]), [["user", "hi"], ["assistant", "Hi! I'm AgentZero. Ask me about your pretend money, or to move some."]]);

    // the Move: Home's own Move sheet, filled in (the card the chat shows)
    const before = (await sim.agent.call<{ networks: { network: string; cashUsd: string }[] }>("spending.status")) as { ok: { networks: { network: string; cashUsd: string }[] } };
    const solBefore = Number(before.ok.networks.find((n) => n.network === "sol")!.cashUsd);
    const move = await say("move $5 from my Safe to my SOL wallet");
    const sheet = move.out.find((e) => e.kind === "needs-you") as Extract<ChatEvent, { kind: "needs-you" }> | undefined;
    assert.ok(sheet && sheet.sheet.kind === "home", "Home's sheet");
    const ask = (sheet.sheet as { ask: { kind: string; from: string; to: string; usd: string } }).ask;
    assert.deepEqual([ask.kind, ask.from, ask.to, Number(ask.usd)], ["move", "safe", "sol", 5]);
    // the card opens Home's own Move with Home's ask (money-ask.ts, the shell's openMoney), and the sheet's Move is
    // Spending's top-up of the SOL wallet on the Sim's bridge (packages/wallet MoveSheet: spending.topUp)
    assert.deepEqual(moneyAsk(ask as never), { kind: "move", from: "safe", to: "sol", usd: "5.00", wallet: "sol" });
    const went = await sim.wallet.call<{ id: string; status: string }>("spending.topUp", { usd: 5, legs: [{ network: "sol", usd: 5 }], key: "sim-chat-move-000001" });
    assert.ok("ok" in went, JSON.stringify(went));
    const t0 = Date.now();
    for (;;) {
      const a = await sim.agent.call<{ id: string; status: string }[]>("spending.activity");
      const row = "ok" in a ? a.ok.find((x) => x.id === went.ok.id) : undefined;
      if (row && row.status !== "on-its-way") {
        assert.equal(row.status, "done");
        break;
      }
      assert.ok(Date.now() - t0 < 20_000, "the Sim's move lands");
      await new Promise((r) => setTimeout(r, 100));
    }

    // the balance: read_holdings on the Sim's money, after the move
    const bal = await say("what's my balance");
    const facts = bal.out.flatMap((e) => (e.kind === "facts" ? e.facts : []));
    const solLine = (sent[4]!.body.messages as ChatMessage[]).flatMap((m) => (typeof m.content === "string" ? [] : m.content)).findLast((b) => b.type === "tool_result")! as { content: string };
    assert.match(solLine.content, /Your SOL wallet: \{\{f50\d\}\}/, "Claude saw marks, never the figures");
    const solMark = /Your SOL wallet: \{\{(f50\d)\}\}/.exec(solLine.content)![1]!;
    const solAfter = Number(facts.find((f) => f.mark === solMark)!.shown.replace(/[$,]/g, ""));
    assert.ok(solAfter >= solBefore + 4.5, `the SOL wallet holds the $5 that moved: ${solBefore} → ${solAfter}`);
    assert.equal(bal.text, "Your SOL wallet now has {{f502}}. Your Safe has {{f500}}.");
    // the Safe as Home counts it: its ledger and its private (Hidden) balance together
    const safeMark = /Your Safe: \{\{(f50\d)\}\}/.exec(solLine.content)![1]!;
    const sum = async (m: string) => { const r = await sim.agent.call<{ usd?: string }[] | { rows: { usd?: string }[] }>(m); const xs = "ok" in r ? (Array.isArray(r.ok) ? r.ok : r.ok.rows) : []; return xs.reduce((t, x) => t + Number(x.usd ?? 0), 0); };
    const home = (await sum("ledger.balances")) + (await sum("ledger.private"));
    assert.ok((await sum("ledger.private")) > 0, "the Sim's Safe holds a private balance");
    assert.equal(facts.find((f) => f.mark === safeMark)!.shown, `$${home.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    // a sign-up on a website: only the iPhone app does it for real; one honest line, and no Claude call for it
    const calls = sent.length;
    const signup = await say("sign me up to a website");
    assert.equal(signup.text, SIM_REAL_LINE);
    assert.equal(sent.length, calls);

    // every reply came from the relay's Sim route: no key, no sign-up, no token, Sonnet 5.5 with the Sim's tools
    assert.ok(asked.every((a) => a.url === "https://relay.test/v0/agentzero/sim" && !a.headers.authorization && !a.headers["x-api-key"]));
    assert.ok(sent.every((s) => s.body.model === "claude-sonnet-5-5" && s.body.max_tokens === 800 && !s.body.tools.some((t: { name: string }) => t.name === "browse" || t.name === "propose_job")));
    // never a canned line
    for (const t of [hi.text, can.text, move.text, bal.text, signup.text]) assert.doesNotMatch(t, /You said|sample answer|doesn't work/);
    // what one Sim reply costs at these recorded counts (Sonnet 5.5's published price): the report's figure
    const each = costMicros({ input_tokens: 420, output_tokens: 48, cache_read_input_tokens: 6_100 }, PRICES["claude-sonnet-5-5"]);
    assert.ok(each < 5_000, `about $${(each / 1e6).toFixed(4)} a call`);
  } finally {
    sim.stop();
  }
});

test("the Sim's AgentZero rests in one plain line when the relay has no Sim route, is off or used its day; never a key card (control: a Sim reply streams)", async () => {
  const hands = { receipts: async () => "", meter: async () => "" };
  const words = async (fetchFn: typeof fetch | null) => {
    const out: ChatEvent[] = [];
    for await (const e of chatTurn([], "hi", { relayBase: fetchFn ? "https://relay.test" : null, fetch: fetchFn ?? undefined, hands, sim: true })) out.push(e);
    return out;
  };
  const answer = (status: number, code: string) => (async () => new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  for (const f of [null, answer(503, "agentzero.sim.off"), answer(429, "agentzero.sim.rested"), answer(404, "quotes.route.unknown"), answer(502, "x"), (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch]) {
    const out = await words(f);
    assert.deepEqual(out.filter((e) => e.kind !== "done"), [{ kind: "say", line: SIM_RESTED_LINE }]);
    assert.ok(!out.some((e) => e.kind === "needs-key"));
  }
  assert.equal(SIM_RESTED_LINE, "AgentZero is off in the Sim right now. Use it in the ZeroFee iPhone app.");
  // a minute's limit is its own line (try again in a minute), not "rested"
  const busy = await words(answer(429, "quotes.rate.limited"));
  assert.deepEqual(busy.filter((e) => e.kind !== "done"), [{ kind: "fault", line: "Too many asks just now. Try again in a minute." }]);
  // control: a streamed Sim reply is Claude's words
  const ok = await words((async () => new Response(reply({ text: "Hello." }), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
  assert.equal(ok.flatMap((e) => (e.kind === "text" ? [e.delta] : [])).join(""), "Hello.");
});

test("the Sim's starters stay the three, and the Sim's chat makes its answers itself (the prepaid rule: no relay call)", () => {
  assert.deepEqual([...SIM_STARTERS], ["What can you do?", "Move $5 from my Safe to my SOL wallet", "What's my balance?"]);
  const src = readFileSync(new URL("./sim-chat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /useChatTurn|chatTurn|fetch\(/);
  const app = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /stubTurn|useStubChat|demo-money/);
  assert.doesNotMatch(readFileSync(new URL("./chat-events.ts", import.meta.url), "utf8"), /You said: /);
});

test("a card that landed is said to Claude as landed, never 'Activity shows when it lands' (D157 live walk); control: a card that only went still says so", async () => {
  const { cardSaw, cardRecord } = await import("@zerofee/agent/chat/use-chat-turn");
  const sheet = { kind: "home" as const, ask: { kind: "move" as const, from: "safe" as const, to: "sol" as const, usd: "5.00" }, line: "Move $5.00 from your Safe to your SOL wallet." };
  const items = [{ kind: "needs-you" as const, sheet: sheet as never, card: "k1" }];
  const went = cardSaw(items, "k1", { kind: "ended", went: true, movementId: "mv-1" });
  const r1 = cardRecord(went);
  assert.match(r1.text!, /Home's sheet said it went; Activity shows when it lands/);
  // it landed after it was said: said again, once, as landed
  const r2 = cardRecord(cardSaw(r1.items, "k1", { kind: "landed" }));
  assert.match(r2.text!, /Move \$5\.00 from your Safe to your SOL wallet\. \[it landed: ZeroFee read it in Activity\]/);
  assert.doesNotMatch(r2.text!, /Activity shows when it lands/);
  assert.equal(cardRecord(r2.items).text, null, "said once");
  // the card reads it landed and says so; in the Sim it looks every second and settles in 1.5 s (sample money lands at once)
  const card = readFileSync(new URL("./MoneyCard.tsx", import.meta.url), "utf8");
  assert.match(card, /if \(end\.kind === "landed"\) onCard\?\.\(\{ kind: "landed" \}\);/);
  assert.match(card, /const FOLLOW_MS = SIM \? 1_000 : 2_500;\nconst SETTLE = SIM \? 1_500 : SETTLE_MS;/);
});

test("the Sim never says Face ID (a browser tab has none): the tools' words, ZeroFee's own lines and the screen say approve (control: the phone's words keep Face ID)", async () => {
  const { simWords, SIM_VISITOR_LINE } = await import("@zerofee/agent/chat/sim");
  const { SHOWN } = await import("@zerofee/agent/chat/home-ask");
  const { CHAT_SYSTEM, CHAT_TOOLS } = await import("@zerofee/agent/chat/tools");
  const relay = await import("../../../quotes/agentzero-sim.mjs");
  const { JOB_SCHEMA } = await import("../../../quotes/agentzero.mjs");
  assert.match(SHOWN, /Face ID/, "control: the phone's own line");
  for (const t of [SHOWN, CHAT_SYSTEM, ...CHAT_TOOLS.map((x) => x.description), "Step 1 is below: tap Open, then Face ID.", "Move $5.00 (5.00 USDC) to your SOL wallet. Home's Send is ready for your Face ID."]) {
    const w = simWords(t);
    assert.doesNotMatch(w, /Face ID/, w);
    assert.equal(relay.simWords(t), w, "the relay's copy says the same");
  }
  assert.equal(simWords(SHOWN), "Shown to the person on Home's own sheet, filled in. Only their approval moves it. Say one short line; don't repeat the amount or address.");
  // the relay's Sim tools and line
  for (const t of relay.simTools(JOB_SCHEMA)) assert.doesNotMatch(t.description, /Face ID/, t.name);
  assert.match(relay.SIM_SYSTEM, /there is no Face ID/);
  // the screen: every line of a Sim reply (cards, ZeroFee's lines, Claude's words)
  const { simMessage } = await import("./sim-chat.ts");
  const shown = simMessage({ id: "a", role: "assistant", done: true, parts: [{ type: "text", text: "You always approve money steps with Face ID." }, { type: "needs", why: "plan", sheet: { kind: "home", line: "Step 1: tap Open, then Face ID." } }] });
  assert.doesNotMatch(JSON.stringify(shown), /Face ID/);
  assert.match(SIM_VISITOR_LINE, /^You used up today's free AgentZero replies here\./);
});

test("D158: a visitor's day spent says its own line (no button: the Sim has no app or extension link); the relay's day spent says it rested", async () => {
  const { SIM_VISITOR_LINE } = await import("@zerofee/agent/chat/sim");
  const hands = { receipts: async () => "", meter: async () => "" };
  const lineFor = async (code: string) => {
    const out: ChatEvent[] = [];
    for await (const e of chatTurn([], "hi", { relayBase: "https://relay.test", fetch: (async () => new Response(JSON.stringify({ code }), { status: 429 })) as unknown as typeof fetch, hands, sim: true })) out.push(e);
    return out.filter((e) => e.kind !== "done");
  };
  assert.deepEqual(await lineFor("agentzero.sim.visitor"), [{ kind: "say", line: SIM_VISITOR_LINE }]);
  assert.deepEqual(await lineFor("agentzero.sim.rested"), [{ kind: "say", line: SIM_RESTED_LINE }]);
  assert.equal(SIM_VISITOR_LINE, "You used up today's free AgentZero replies here. Come back tomorrow, or use the ZeroFee iPhone app.");
  // the relay's own words after a cap are the app's (agentzero-sim.mjs)
  const relay = await import("../../../quotes/agentzero-sim.mjs");
  assert.equal(relay.SIM_VISITOR_WORDS, SIM_VISITOR_LINE);
  assert.equal(relay.SIM_RESTED_WORDS, SIM_RESTED_LINE);
});

test("the chat's top edge fades, never cuts a bubble under the top bar (D157 walk); the thread at rest sits below the fade", () => {
  const css = readFileSync(new URL("./chat.css", import.meta.url), "utf8");
  assert.match(css, /\.azc-viewport \{ -webkit-mask-image: linear-gradient\(to bottom, transparent 0, black 20px\); mask-image: linear-gradient\(to bottom, transparent 0, black 20px\); \}/);
  assert.match(css, /\.azc-viewport \{ flex: 1; min-height: 0; overflow-y: auto; padding: 20px 0 16px;/);
});
