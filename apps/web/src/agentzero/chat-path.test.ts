// AgentZero's chat path end to end, mocked (product decision, 4 Nov showed twice, nothing came back, and
// the meter stayed at $0.000). One relay that keeps the prepaid rules (sign-up, AgentZero's own USDC read before each
// reply, anything unpaid holds the next, the bind proof), one core that pays, and the chat's own pure pieces in the
// order live-chat.ts runs them: mayAsk → settle → chatTurn → the fold → the meter → pay → a receipt row. Every relay
// answer the chat can get is words on screen within 10 s; one tap is one bubble. Controls beside each.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatTurn, type ChatEvent, type ChatOptions, type ReplyOwed } from "@zerofee/agent/chat/turn";
import { CHAT_LINE } from "@zerofee/agent/chat/chat-lines";
import { addWords, foldChat, sendId, type ChatItem } from "@zerofee/agent/chat/use-chat-turn";
import { LIMITS, timedOutLine } from "@zerofee/agent/chat/wait";
import { REPLY_HOLD_MICROS } from "@zerofee/core/agent-price";
import { WATCH_MS, fromItems, quietLine } from "./chat-items.ts";
import { withMoney } from "./fail-line.ts";
import { mayAsk, memoFor, settleNow, walletState } from "./use-agent-wallet.ts";
import { heardMicros } from "./meter.ts";
import { replyReceipt } from "./az-tasks.ts";
import { receiptTitle } from "./wallet-words.ts";

const KEPT = { ...LIMITS };
beforeEach(() => Object.assign(LIMITS, KEPT));

// ── a Claude stream, as the relay passes it on ────────────────────────────────────────────────────────────────────
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const head = () => ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const textSse = (t: string) => head() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
const toolSse = (name: string, input: object) => head() + ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: `t${Math.random().toString(36).slice(2, 8)}`, name, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const hands = (extra: Partial<ChatOptions["hands"]> = {}): ChatOptions["hands"] => ({ receipts: async () => "No receipts yet.", meter: async () => "", ...extra });
const BASE = "https://relay.test";
const TOKEN = "az1.AAAAAAAAAAAAAAAAAAAAAA.sig";
const ACCOUNT = "a9".repeat(32);
const PROOF = "ab".repeat(64);

async function turn(words: string, o: Partial<ChatOptions>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], words, { relayBase: BASE, token: TOKEN, hands: hands(), ...o } as ChatOptions)) out.push(e);
  return out;
}
const refusing = (status: number, body: object | null) => (async (u: string) => (String(u).endsWith("/signup") ? json(200, { token: TOKEN }) : body ? json(status, body) : new Response("<html>bad gateway</html>", { status }))) as never;

// ── 1. every answer the relay can give, in words ─────────────────────────────────────────────────────────────────
test("every relay answer is words on screen (product decision, 4 Nov: a 402 this phone didn't know was a hidden card, so silence); Try again where it helps", async () => {
  const table: [number, string | null, string, boolean, string | undefined][] = [
    [402, "agentzero.reply.unfunded", CHAT_LINE.unfunded, false, "used-up"],
    [402, "agentzero.allowance.used", CHAT_LINE.unfunded, false, "used-up"],
    [402, "agentzero.reply.account-full", "AgentZero still has old replies to pay for. Nothing left AgentZero. Chat works again once one is paid.", false, undefined],
    [402, "agentzero.reply.unpaid", CHAT_LINE.stillPaying, true, undefined],
    [403, "agentzero.reply.account", "This phone named the wrong AgentZero wallet. Nothing was paid.", true, undefined],
    [409, "agentzero.reply.running", CHAT_LINE.running, true, undefined],
    [503, "agentzero.reply.unread", "NEAR didn't answer. Nothing was paid. Try again.", true, undefined],
    [503, "agentzero.model.off", CHAT_LINE.dayDone, false, undefined],
    [429, "agentzero.allowance.today", "Today's free reading is used up. Try again tomorrow.", false, undefined],
    [429, "quotes.rate.limited", "Too many asks just now. Try again in a minute.", true, undefined],
    [413, "quotes.request.too-large", CHAT_LINE.tooLarge, false, undefined],
    [502, "agentzero.model.unreachable", "Claude didn't answer.", true, undefined],
    [500, null, CHAT_LINE.down, true, "off"],
    [404, "quotes.route.unknown", CHAT_LINE.down, true, "off"],
    [418, "agentzero.something.new", CHAT_LINE.down, true, undefined],
  ];
  for (const [status, code, line, retry, needs] of table) {
    const out = await turn("Hey what can you do", { fetch: refusing(status, code ? { code, whatHappened: "x" } : null) });
    const fault = out.find((e): e is Extract<ChatEvent, { kind: "fault" }> => e.kind === "fault");
    assert.equal(fault?.line, line, `${status} ${code}`);
    assert.equal(!!fault?.retry, retry, `${status} ${code}: Try again`);
    assert.equal((out.find((e) => e.kind === "needs-key") as { why?: string } | undefined)?.why, needs, `${status} ${code}: the card's event`);
    assert.equal(out.at(-1)?.kind, "done");
    assert.ok(withMoney(line).length < 140 && /\.$/.test(withMoney(line)), line);
  }
  // no connection at all: its own line (it was the hidden key card)
  const offline = await turn("hi", { fetch: (async () => { throw new TypeError("Load failed"); }) as never });
  assert.deepEqual(offline.filter((e) => e.kind === "fault"), [{ kind: "fault", line: CHAT_LINE.offline, retry: true }]);
  // a stream that stops before its end: words, never a reply left open
  const cut = await turn("hi", { fetch: (async () => sse(head() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }))) as never });
  assert.deepEqual(cut.filter((e) => e.kind === "fault"), [{ kind: "fault", line: "Claude didn't answer.", retry: true }]);
  // the relay's own failure line mid-stream
  const said = await turn("hi", { fetch: (async () => sse(head() + `event: zerofee_error\ndata: {"line":"Claude took too long. Send it again."}\n\n`)) as never });
  assert.equal((said.find((e) => e.kind === "fault") as { line?: string }).line, "Claude took too long. Send it again.");
  // control: a reply streams, no fault
  const ok = await turn("hi", { fetch: (async () => sse(textSse("Hi."))) as never });
  assert.deepEqual([ok.some((e) => e.kind === "fault"), ok.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join("")], [false, "Hi."]);
});

test("a 401 (the relay no longer knows this sign-up) is words with Try again, never silence", async () => {
  const always = (async (u: string) => (String(u).endsWith("/signup") ? json(200, { token: TOKEN }) : json(401, { code: "agentzero.signup.needed" }))) as never;
  const out = await turn("hi", { fetch: always });
  assert.deepEqual(out.filter((e) => e.kind === "fault"), [{ kind: "fault", line: CHAT_LINE.signedOut, retry: true }]);
});

// ── 2. the watchdog: nothing within 10 s is a line and Try again ─────────────────────────────────────────────────
test("the watchdog: 10 s with nothing on screen says so with Try again; a turn that ends silent says so; an answer clears it (controls)", () => {
  assert.ok(WATCH_MS <= 10_000, "within 10 s of Send");
  const you: ChatItem = { kind: "you", text: "Hey what can you do", id: "m1" };
  assert.equal(quietLine([you], "m1", { running: true, slow: false }), null, "under 10 s: the mark turns, nothing more");
  assert.equal(quietLine([you], "m1", { running: true, slow: true }), CHAT_LINE.slow);
  assert.equal(quietLine([], "m1", { running: true, slow: true }), CHAT_LINE.slow, "still paying the last reply before it goes: the same line");
  assert.equal(quietLine([you, { kind: "needs-key", why: "used-up" }], "m1", { running: false, slow: false }), CHAT_LINE.silent, "a hidden card alone is silence: said");
  assert.equal(quietLine([you, { kind: "unpaid" }], "m1", { running: false, slow: true }), CHAT_LINE.stillPaying);
  assert.equal(quietLine([you, { kind: "cost", turnUsd: 0.01 }], "m1", { running: false, slow: false }), CHAT_LINE.silent, "a cost with no words is no answer");
  // controls: answered, faulted, stopped, another bubble, nothing awaited
  assert.equal(quietLine([you, { kind: "agent", text: "Hi" }], "m1", { running: true, slow: true }), null);
  assert.equal(quietLine([you, { kind: "fault", line: "x" }], "m1", { running: false, slow: true }), null);
  assert.equal(quietLine([you, { kind: "stopped" }], "m1", { running: false, slow: true }), null);
  assert.equal(quietLine([you], null, { running: false, slow: true }), null);
  assert.equal(quietLine([you], "m9", { running: false, slow: true }), null, "words refused before they went: back in the box, no line");
  // on screen: the line, with Try again on the last reply only (live-chat.ts) and its button (AgentZeroChat.tsx)
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const t = setTimeout\(\(\) => setSlowId\(waitId\), WATCH_MS\);/);
  assert.match(live, /const quiet = failedAt === null \? quietLine\(chat\.items, waitId, \{ running, slow: slowId !== null && slowId === waitId \}\) : null;/);
  const screen = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(p\.type === "fault" && p\.retry\) return <FaultLine line=\{p\.line\} fresh=\{!!p\.fresh\} \/>;/);
  assert.match(screen, /<RetryOpen\.Provider value=\{!running && chat\.retry \? chat\.retry : null\}>/, "no Try again while a turn runs");
});

test("a hung request: the watchdog's line at 10 s, then the turn's own limit ends it in words; nothing hangs", async () => {
  Object.assign(LIMITS, { firstByte: 200, read: 200, core: 200 });
  const hang = (async (u: string, init: RequestInit) => (String(u).endsWith("/signup") ? json(200, { token: TOKEN }) : new Promise((_, no) => init.signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError")))))) as never;
  const t0 = Date.now();
  const out = await turn("hi", { fetch: hang });
  assert.deepEqual(out.filter((e) => e.kind === "fault"), [{ kind: "fault", line: timedOutLine("Claude"), retry: true }]);
  assert.ok(Date.now() - t0 < LIMITS.firstByte + 1_000);
  // a slow first byte that does come: no fault, the words
  const slow = (async () => new Promise((ok) => setTimeout(() => ok(sse(textSse("Late but here."))), 50))) as never;
  assert.equal((await turn("hi", { fetch: slow })).filter((e) => e.kind === "fault").length, 0);
  // the 30 s hard limit stays; the watchdog speaks first, at 10 s
  assert.ok(WATCH_MS < KEPT.firstByte);
});

// ── 3. one tap, one bubble ──────────────────────────────────────────────────────────────────────────────────────
test("one tap is one bubble: the same id sent again (Try again, a held reply asked again) never adds a second; the failed try's lines go (controls)", () => {
  const id = sendId();
  let items = addWords([], "Hey what can you do", id);
  items = [...items, { kind: "unpaid" }, { kind: "fault", line: "x", retry: true }, { kind: "needs-key", why: "off" }, { kind: "cost", turnUsd: 0.01 }, { kind: "unpaid", stopped: true, turnUsd: 0.002 }];
  items = addWords(items, "Hey what can you do", id);
  assert.deepEqual(items.map((i) => i.kind), ["you", "cost", "unpaid"], "one bubble; a cost and a Stop's cost stay");
  const m = fromItems(items, true);
  assert.deepEqual(m.filter((x) => x.role === "user").map((x) => x.id), [id], "keyed by the phone's own id");
  assert.equal(m.at(-1)!.id, `r${id}`, "its reply too");
  // control: two sends are two bubbles, each its own id; a saved chat's old bubbles keep their place keys
  const two = addWords(addWords([], "a", sendId()), "a", sendId());
  assert.equal(two.filter((i) => i.kind === "you").length, 2);
  assert.notEqual(sendId(), sendId());
  assert.deepEqual(fromItems([{ kind: "you", text: "old" }], true).map((x) => x.id), ["u0", "a1"]);
  // the send button: locked from the tap until the send said whether it went (a same-frame second tap finds it locked)
  const screen = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(!words\.trim\(\) \|\| running \|\| sending\.current\) return;\n\s*sending\.current = true;/);
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /if \(queuedRef\.current \|\| chat\.busy\) return Promise\.resolve\(false\);/, "one send at a time");
  assert.match(live, /setQueued\(\{ id, text: w\.trim\(\) \}\);/, "the bubble shows while the last reply is paid");
  assert.match(live, /if \(ok\) go\(you\.text, id\);/, "a held reply goes again in its own bubble");
  assert.doesNotMatch(live, /go\(said\.current\)/, "never the old second bubble");
});

// ── 4. the whole path: sign-up → fund → three paid replies → three receipts → refusal at $0 ─────────────────────
/** A relay with the prepaid rules and a core that pays, both in memory. */
function world() {
  const s = { usdc: 0, signups: 0, chats: 0, batch: 0, replies: 0, usage: null as unknown, paid: [] as string[], script: [] as string[], memo: "" };
  const cost = 15_000; // about 1½¢ a reply
  const fetch = (async (u: string, init: RequestInit = {}) => {
    const url = String(u);
    if (url.endsWith("/v0/agentzero/signup")) return (s.signups++, json(200, { token: TOKEN }));
    const h = new Headers(init.headers);
    if (h.get("authorization") !== `Bearer ${TOKEN}`) return json(401, { code: "agentzero.signup.needed" });
    if (url.endsWith("/v0/agentzero/pay")) {
      const b = JSON.parse(String(init.body ?? "{}")) as { tx?: string };
      if (!b.tx) return json(200, s.batch ? { state: "owed", ...owedBody() } : { state: "paid", owedMicros: 0 });
      const micros = s.batch;
      s.paid.push(b.tx);
      s.batch = 0;
      s.replies = 0;
      return json(200, { state: "paid", micros, owedMicros: 0 });
    }
    s.chats++;
    if (s.batch > 0) return json(402, { code: "agentzero.reply.unpaid", ...owedBody() });
    if (h.get("x-zf-agent-account") !== ACCOUNT || h.get("x-zf-agent-bind") !== PROOF) return json(403, { code: "agentzero.reply.account" });
    if (s.usdc < REPLY_HOLD_MICROS) return json(402, { code: "agentzero.reply.unfunded", needMicros: REPLY_HOLD_MICROS });
    const answer = s.script.shift() ?? textSse("Hi.");
    s.batch += cost;
    s.replies++;
    s.usage = { input_tokens: 1000, output_tokens: 100 };
    return sse(answer + `event: zerofee\ndata: ${JSON.stringify({ allowance: { usedUsd: 0, limitUsd: 0 }, turnUsd: cost / 1e6, ...owedBody() })}\n\n`);
  }) as typeof globalThis.fetch;
  const owedBody = () => ({ owedMicros: s.batch, usage: s.usage, model: "claude-opus-5-5", byModel: { "claude-opus-5-5": s.usage }, replies: s.replies, paidMicros: 0, memo: s.memo, reply: `b${s.paid.length}` });
  let txN = 0;
  const call = (async (method: string, p: { do?: string; op?: string; owedMicros?: number }) => {
    if (method !== "account.agent.wallet") return { problem: { whatHappened: "no" } };
    if (p.op === "pending") return { ok: null };
    if (p.op === "reply") return (s.usdc -= p.owedMicros ?? 0, { ok: { tx: `tx${++txN}`.padEnd(44, "1"), from: ACCOUNT, micros: p.owedMicros } });
    if (p.op === "counted" || p.op === "forget") return { ok: {} };
    return { ok: { usdcMicros: String(s.usdc), address: ACCOUNT } };
  }) as never;
  return { s, fetch, call };
}

test("the whole chat path, mocked: sign-up → fund → three paid replies (prices, holdings, a swap sheet: five paid calls) → five receipts, the meter at their cost → refusal at $0 (phone and relay); send and move sheets prefilled; approved, said so", async () => {
  const w = world();
  w.s.memo = (await memoFor(TOKEN))!;
  // the phone's side, as live-chat.ts and use-agent-wallet.ts run it
  let token: string | null = null;
  let owed: ReplyOwed | null = null;
  let known = false;
  let used = 0;
  const receipts: string[] = [];
  const tasks = { publish: (t: { title: string }) => (receipts.push(t.title), true), update: () => true, end: () => undefined } as never;
  let items: ChatItem[] = [];
  const settle = async (): Promise<boolean> => {
    const { r, due } = await settleNow({ all: false, owed, walletUsd: w.s.usdc / 1e6, call: w.call, fetch: w.fetch, base: BASE, token });
    if (!("ok" in r)) return false;
    if (r.paidMicros) replyReceipt(tasks, r.paidMicros, receiptTitle(r.paidMicros));
    if (r.left !== undefined || due) (owed = r.left ?? null), (known = true);
    return true;
  };
  const send = async (words: string, skills: Partial<NonNullable<ChatOptions["hands"]["skills"]>> = {}): Promise<"refused" | "sent"> => {
    const total = Math.max(0, w.s.usdc - (owed?.owedMicros ?? 0)) / 1e6;
    if (mayAsk(walletState({ walletUsd: total, month: null, loaded: true, owes: !!owed }), total)) return "refused";
    if (!(await settle())) return "refused";
    const id = sendId();
    items = addWords(items, words, id);
    for await (const e of chatTurn([], words, { relayBase: BASE, token, fetch: w.fetch, account: ACCOUNT, bindFor: async () => PROOF, saveToken: async (t) => void (token = t), beforeCall: settle, hands: hands({ skills: skills as never }) })) {
      if (e.kind === "allowance") {
        // the meter: the relay's own figure for each paid reply (owe → heard), then paid at once (owe → settle)
        if (e.owed) {
          used += heardMicros(owed, known, e.owed, e.owed.turnMicros ?? 0, 0);
          owed = e.owed;
          known = true;
          await settle();
        } else if (e.turnUsd) used += Math.round(e.turnUsd * 1e6);
      } else if (e.kind !== "done" && e.kind !== "refused" && e.kind !== "stand-ins" && e.kind !== "unpaid") items = foldChat(items, e);
    }
    return "sent";
  };
  // never funded: refused before anything is asked (no sign-up, no chat call), the words back in the box
  assert.equal(await send("Hey"), "refused");
  assert.deepEqual([w.s.signups, w.s.chats, items.length], [0, 0, 0]);
  // fund $5; then three paid replies along the real journeys
  w.s.usdc = 5_000_000;
  w.s.script.push(toolSse("market_price", { coins: ["SOL"] }), textSse("SOL is $150."));
  assert.equal(await send("What's SOL at?", { prices: async () => "SOL $150.00 (+2.1% in 24h), at 17:20 UTC" }), "sent");
  w.s.script.push(toolSse("read_holdings", {}), textSse("You have $20 in your Safe."));
  assert.equal(await send("What do I have?", { holdings: async () => "Your Safe: $20.00" }), "sent");
  w.s.script.push(toolSse("swap", { from: "USDC", to: "SOL", usd: 10 }));
  assert.equal(await send("swap $10 of USDC to SOL"), "sent");
  assert.equal(w.s.signups, 1, "signed up once, on the first message");
  // five paid calls (two tool loops of two, one sheet), each paid before the next and once at the end: five receipts
  assert.deepEqual([w.s.chats, w.s.paid.length, receipts.length], [5, 5, 5]);
  assert.ok(receipts.every((r) => r === "AgentZero paid 1.5¢ for a reply"), receipts.join());
  assert.equal(used, 5 * 15_000, "the meter: each paid reply's own cost, from the relay's figure");
  assert.equal(w.s.usdc, 5_000_000 - 5 * 15_000);
  const shown = fromItems(items, false);
  assert.deepEqual(shown.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant"], "one bubble per tap, one reply under each");
  assert.match(JSON.stringify(shown[1]), /SOL is \$150\./);
  assert.match(JSON.stringify(shown[3]), /You have \$20 in your Safe\./);
  const swap = items.find((i): i is Extract<ChatItem, { kind: "needs-you" }> => i.kind === "needs-you");
  assert.deepEqual((swap?.sheet as { ask?: unknown }).ask, { kind: "swap", from: "USDC", to: "SOL", usd: "10.00", wallet: "safe" }, "Home's Swap, filled in");
  // a send is read by our own code: Home's Send filled in, no Claude call, nothing paid
  const before = w.s.chats;
  assert.equal(await send("Send $5 to kim.near"), "sent");
  const sendCard = items.filter((i): i is Extract<ChatItem, { kind: "needs-you" }> => i.kind === "needs-you").at(-1)!;
  assert.deepEqual([(sendCard.sheet as { ask?: { kind?: string; usd?: string } }).ask?.kind, (sendCard.sheet as { ask?: { usd?: string } }).ask?.usd, w.s.chats], ["send", "5.00", before]);
  // a move sheet from Claude's tool, then the person's approval on Home's sheet is said back to Claude next turn
  w.s.script.push(toolSse("move", { from: "safe", to: "sol", usd: 20 }));
  assert.equal(await send("move $20 from my Safe to my SOL wallet"), "sent");
  const moveCard = items.filter((i): i is Extract<ChatItem, { kind: "needs-you" }> => i.kind === "needs-you").at(-1)!;
  assert.deepEqual((moveCard.sheet as { ask?: unknown }).ask, { kind: "move", from: "safe", to: "sol", usd: "20.00" });
  const { cardSaw, cardRecord } = await import("@zerofee/agent/chat/use-chat-turn");
  const approved = cardRecord(cardSaw(items, moveCard.card!, { kind: "ended", went: true, movementId: "mv1" }));
  assert.match(approved.text ?? "", /Move \$20\.00 from your Safe to your SOL wallet\. \[Home's sheet said it went/);
  // refusal at $0: the phone refuses before asking; a relay that reads $0 refuses in words with Add money (never silence)
  w.s.usdc = 0;
  owed = null;
  assert.equal(await send("Hey what can you do"), "refused");
  const chatsAt0 = w.s.chats;
  const out = await turn("Hey what can you do", { fetch: w.fetch, account: ACCOUNT, bindFor: async () => PROOF });
  assert.deepEqual([out.filter((e) => e.kind === "fault"), (out.find((e) => e.kind === "needs-key") as { why?: string }).why, w.s.chats], [[{ kind: "fault", line: CHAT_LINE.unfunded }], "used-up", chatsAt0 + 1]);
  assert.ok(!out.some((e) => e.kind === "text"), "no reply at $0");
  // control: the old phone (no account, no proof) gets the relay's refusal in words too, never a reply
  w.s.usdc = 5_000_000;
  const old = await turn("Hey what can you do", { fetch: w.fetch });
  assert.deepEqual(old.filter((e) => e.kind === "fault").map((e) => (e as { line: string }).line), ["This phone named the wrong AgentZero wallet. Nothing was paid."]);
});

test("the meter moves after every paid reply, from the relay's own cost, also when its closing line has no batch figure (product decision, 4 Nov)", () => {
  const hook = readFileSync(new URL("../../../../packages/agent/src/chat/use-chat-turn.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(e\.owed\) o\.onOwed\?\.\(e\.owed\);\n\s*else if \(e\.turnUsd !== undefined && e\.turnUsd > 0\) o\.onCost\?\.\(Math\.round\(e\.turnUsd \* 1e6\)\);/);
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const onCost = useMemo\(\(\) => \(wallet \? \(micros: number\) => walletRef\.current\?\.cost\(micros\) : undefined\)/);
  const wallet = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(wallet, /const cost = useCallback\(\(micros: number\) => \{\n\s*if \(!\(micros > 0\)\) return;[\s\S]*?setLiveMicros\(0\);\n\s*bump\(micros\);/);
});

test("QA (5 Nov): the relay can't read this phone's sign-in any more (agentzero.signup.again): its line, and \"Sign in and send\" forgets the dead sign-in first, then sends the same bubble (control: a passing 401 is Try again, the sign-in kept)", async () => {
  const out = await turn("hi", { fetch: refusing(401, { code: "agentzero.signup.again" }) });
  assert.deepEqual(out.filter((e) => e.kind === "fault"), [{ kind: "fault", line: CHAT_LINE.signInAgain, retry: true, fresh: true }]);
  assert.equal(CHAT_LINE.signInSend, "Sign in and send");
  const passing = await turn("hi", { fetch: refusing(401, { code: "agentzero.signup.needed" }) });
  assert.deepEqual(passing.filter((e) => e.kind === "fault"), [{ kind: "fault", line: CHAT_LINE.signedOut, retry: true }]);
  // the fold and the screen carry it to the button
  const items = foldChat(addWords([], "hi", "m1"), out.find((e) => e.kind === "fault")!);
  assert.deepEqual(fromItems(items, false).at(-1)!.parts, [{ type: "fault", line: CHAT_LINE.signInAgain, retry: true, fresh: true }]);
  const screen = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(screen, /onClick=\{\(\) => retry\(fresh \? \{ fresh: true \} : undefined\)\}>\{fresh \? CHAT_LINE\.signInSend : RETRY_LABEL\}/);
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /if \(!o\?\.fresh\) return again\(\);\n\s*void bridge\.call\("device\.secret\.set", \{ key: CHAT_SECRETS\.token, value: null \}\)\.then\(again, again\);/, "the dead sign-in forgotten, then the same words on a new one");
});

test("QA (5 Nov): NEAR didn't answer the relay's money read once: asked again inside the turn, the answer comes, no words of failure (control: twice, its line with Try again)", async () => {
  let asks = 0;
  const hiccup = (async (u: string) => {
    if (String(u).endsWith("/signup")) return json(200, { token: TOKEN });
    return ++asks === 1 ? json(503, { code: "agentzero.reply.unread" }) : sse(textSse("Hi."));
  }) as never;
  const out = await turn("hi", { fetch: hiccup });
  assert.equal(asks, 2, "asked once more");
  assert.equal(out.filter((e) => e.kind === "fault").length, 0, "no failure said");
  assert.ok(out.some((e) => e.kind === "agent" || e.kind === "say" || (e.kind as string) === "text"), JSON.stringify(out.map((e) => e.kind)));
  let twice = 0;
  const down = (async (u: string) => (String(u).endsWith("/signup") ? json(200, { token: TOKEN }) : (twice++, json(503, { code: "agentzero.reply.unread" })))) as never;
  const no = await turn("hi", { fetch: down });
  assert.equal(twice, 2, "control: once more only");
  assert.deepEqual(no.filter((e) => e.kind === "fault"), [{ kind: "fault", line: "NEAR didn't answer. Nothing was paid. Try again.", retry: true }]);
});
