// AgentZero's own wallet on screen (L9, design $ZEROFEE_HOME/AGENTZERO-WALLET.md §5): every §5 line word for word, the
// state the screen shows from the numbers, each paid reply's cost, a tool loop paused for want of money, and OFF exactly
// as before (AGENTZERO_WALLET false: no wallet call, no wallet line, the key chip and card as they were).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENTZERO_WALLET } from "@zerofee/core/agent-route";
import { chatTurn, type ChatEvent } from "@zerofee/agent/chat/turn";
import { fromItems } from "./chat-items.ts";
import { walletFlag } from "./wallet-flag.ts";
import { OWN_KEY_ON } from "@zerofee/agent/chat/own-key";
import { FILL_READ_MS, FILL_READS, autoSettleNow, batchKey, creditDue, fillLanded, fillSettled, mayAsk, memoFor, payNow, payOwed, settleNow, walletState } from "./use-agent-wallet.ts";
import { REPLY_HOLD_MICROS } from "@zerofee/core/agent-price";
import * as W from "./wallet-words.ts";

test("§5's lines, word for word", () => {
  assert.equal(`${W.FUND_TITLE} ${W.FUND_BODY}`, "Fund AgentZero to start. It spends only what you put here. Your wallets stay yours.");
  assert.deepEqual([...W.FUND_AMOUNTS.map((a) => W.limit(a)), W.OTHER], ["$5", "$20", "$50", "Other"]);
  assert.equal(W.doneLine(20), "Done. AgentZero has $20.");
  assert.equal(W.doneLine(21.4), "Done. AgentZero has $21.40.");
  assert.equal(W.OWN_KEY_LINK, "Use your own Claude key instead");
  // product decision, 4 Nov: the chip on top is the cost meter, what AgentZero used today; no cost line under replies
  assert.equal(W.usedChip(0.034), "$0.034 used");
  assert.equal(W.usedChip(0), "$0.000 used");
  assert.equal(W.usedChip(0.0005), "$0.001 used", "to the tenth of a cent");
  assert.equal(W.usedChip(1.274), "$1.27 used", "a dollar or more to the cent");
  assert.equal(W.leftChip(0.84), "$0.840 left", "under a dollar: the one rule, 3 decimals");
  assert.equal(W.meterLabel(0.034, 4.21), "AgentZero used $0.034 today and has $4.21 left. Open its wallet");
  assert.equal(W.meterLabel(0.034, 0.84), "AgentZero used $0.034 today and has $0.840 left. Open its wallet");
  assert.equal(W.meterLabel(0.034, null), "AgentZero used $0.034 today. Open its wallet");
  assert.equal(W.todayLine(0.034, 0), "Used today $0.034 · paid $0.000", "D37: no \"owed\"");
  assert.equal(W.SETTLE_LINE, "Pays Anthropic after each reply, at Anthropic's price. ZeroFee takes nothing.");
  assert.equal(W.REFUSE_LINE, "AgentZero needs more money to answer.");
  assert.equal(W.receiptTitle(12_000), "AgentZero paid 1.2¢ for a reply");
  assert.deepEqual([W.cents(20_000), W.cents(6_000), W.cents(123_456), W.cents(400), W.cents(1_500_000), W.cents(0)], ["2¢", "0.6¢", "12¢", "under 0.1¢", "$1.50", "0¢"]);
  assert.equal(W.chatCostLine(0.0712), "This chat cost $0.071", "3 decimals, like every AgentZero figure under $1");
  assert.equal(W.chatCostLine(0.0369), "This chat cost $0.037", "the sheet's \"$0.037 used\" and this line agree");
  assert.equal(W.chatCostLine(1.274), "This chat cost $1.27", "a dollar or more to the cent");
  assert.equal(W.chatCostLine(0.0002), "This chat cost under $0.001");
  assert.equal(W.chatCostLine(0), "This chat cost $0.000", "one rule, like the meter's \"$0.000 used\"");
  assert.equal(`${W.FEES_ROW}: ${W.feesLine(0.0123)}`, "Fees for sending: 0.012 NEAR");
  assert.equal(W.FEES_LOW_LINE, "AgentZero needs a little NEAR for fees. Add money to keep going.");
  assert.equal(W.PRICE_LINE, "Claude's price, nothing added");
  assert.equal(W.monthLine(3.1, 20), "$3.10 of $20");
  assert.equal(W.monthLine(0.037, 20), "$0.037 of $20");
  assert.equal(`${W.lowLine(0.8)} ${W.ADD_MONEY}`, "AgentZero has $0.800 left. Add money");
  assert.equal(`${W.EMPTY_LINE} ${W.ADD}`, "Add money to keep going. Add");
  assert.equal(W.capLine(20, "2026-12-03T10:00:00.000Z"), "AgentZero has used this month's $20 for thinking. Raise the limit or wait until Dec 3.");
  assert.equal(W.PAUSED_LINE, "Paused. Add money to AgentZero to finish this.");
  assert.equal(W.CONTINUE, "Continue");
  assert.equal(W.MOVE_ALL, "Move all to my Safe");
  assert.equal(W.OR_FUND, "Or fund AgentZero");
  // nothing a person reads holds an id, a unit or a blob (product decision, 2 Nov)
  const all = Object.values(W).flatMap((v) => (typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (a: number, b: number) => string)(1.5, 2))] : []));
  for (const line of all) assert.doesNotMatch(line, /micros|usdc|nep141|0x|[0-9a-f]{16}|undefined|NaN/i, line);
});

test("one rule for AgentZero's money: under $1 to the tenth of a cent, $1 and over to the cent (product decision, 4 Nov)", () => {
  for (const [usd, said] of [[0, "$0.000"], [0.0369, "$0.037"], [0.5, "$0.500"], [0.9994, "$0.999"], [0.9996, "$1.00"], [1, "$1.00"], [4.96, "$4.96"], [4.961, "$4.96"], [20, "$20.00"], [-1, "$0.000"], [Number.NaN, "$0.000"]] as const) {
    assert.equal(W.money(usd), said, String(usd));
    assert.equal(W.usd3(usd), said, `${usd}: the meter's figure is the same rule`);
  }
  // the old rule (cents under a dollar, 4 decimals for a chat) would fail these: "$0.04", "$0.0369"
  assert.notEqual(W.money(0.0369), "$0.04");
  assert.doesNotMatch(W.chatCostLine(0.0369), /\d\.\d{4}/, "never 4 decimals");
});

test("the state the screen shows (D152): first run, ok, low, empty at $0, fees, the month's cap", () => {
  const month = (spentUsd: number, capUsd = 20) => ({ spentUsd, capUsd, endsAtIso: null });
  assert.equal(walletState({ walletUsd: null, month: null, loaded: false }), "loading");
  assert.equal(walletState({ walletUsd: 0, month: month(0), loaded: true }), "fresh", "never funded: the first run");
  assert.equal(walletState({ walletUsd: 4.21, month: month(3), loaded: true }), "ok");
  assert.equal(walletState({ walletUsd: 0.8, month: month(3), loaded: true }), "low", "under $1");
  assert.equal(walletState({ walletUsd: 0, month: month(3), loaded: true }), "empty", "$0 after spending: Add money to keep going");
  assert.equal(walletState({ walletUsd: 4.21, feesLow: true, month: month(3), loaded: true }), "fees", "USDC but no NEAR for the fee");
  assert.equal(walletState({ walletUsd: 4, month: month(20), loaded: true }), "cap", "the month's $20 spent");
  assert.equal(walletState({ walletUsd: null, month: month(0), loaded: true }), "unread", "can't read the wallet: never \"empty\", never the first run's offer");
});

test("each reply keeps what its calls cost together, exactly (for the sheet's chat line), with no line under it; a paused reply says so; a held reply is no line", () => {
  const m = fromItems([
    { kind: "you", text: "hi" },
    { kind: "agent", text: "Hello." },
    { kind: "cost", turnUsd: 0.0123 },
    { kind: "you", text: "check my receipts" },
    { kind: "step", id: "t1", tool: "read_receipts", line: "Reading receipts", state: "done" },
    { kind: "cost", turnUsd: 0.02 },
    { kind: "agent", text: "Here they are." },
    { kind: "cost", turnUsd: 0.015 },
    { kind: "you", text: "and copy that wallet" },
    { kind: "cost", turnUsd: 0.03 },
    { kind: "paused" },
    { kind: "you", text: "again" },
    { kind: "unpaid" },
  ] as never, false);
  const replies = m.filter((x) => x.role === "assistant");
  // kept with each reply for the sheet's "This chat cost …" (product decision, 4 Nov: never a line under the reply itself)
  assert.deepEqual(replies.slice(0, 3).map((r) => r.cost && Math.round(r.cost.turnUsd * 1e6)), [12_300, 35_000, 30_000]);
  const screen = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /costLine|azc-cost|This reply cost/, "no cost line under any reply");
  assert.match(screen, /const chatUsd = thread\.reduce\(\(s, m\) => s \+ \(m\.cost\?\.turnUsd \?\? 0\), 0\);/, "control: the chat's total still reaches the sheet");
  assert.equal(replies[2]!.paused, true);
  assert.ok(replies.every((r) => !r.parts.some((p) => p.type === "fault")), "cost, pause and a held reply are never fault lines");
  // a free or own-key reply has no cost line
  assert.equal(fromItems([{ kind: "you", text: "hi" }, { kind: "agent", text: "Hello." }] as never, false).at(-1)!.cost, undefined);
});

/** The relay's stream for one call: Claude asks a read tool (so the loop would call again), then the relay's meter line. */
const relayCall = () => {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "t1", name: "read_receipts", input: {} } }),
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } }),
    ev("message_stop", {}),
    `event: zerofee\ndata: ${JSON.stringify({ allowance: { usedUsd: 0, limitUsd: 0 }, turnUsd: 0.0042, owedMicros: 4200, usage: { input_tokens: 900, output_tokens: 30 }, model: "claude-opus-5-5", memo: `agentzero ${"ab".repeat(16)}`, reply: "0123456789abcdef" })}\n\n`,
  ].join("");
};
async function loop(beforeCall?: () => Promise<boolean>) {
  let relay = 0;
  let asked = 0;
  const fetch = (async () => (relay++, new Response(relayCall(), { headers: { "content-type": "text/event-stream" } }))) as unknown as typeof globalThis.fetch;
  const out: ChatEvent[] = [];
  const hook = beforeCall ? async () => (asked++, beforeCall()) : undefined;
  for await (const e of chatTurn([], "check my receipts", { relayBase: "https://relay.test", token: "az1.t", fetch, hands: { receipts: async () => "No receipts yet.", meter: async () => "x" }, ...(hook ? { beforeCall: hook } : {}) })) out.push(e);
  return { out, relay, asked };
}

test("a tool loop asks the wallet before each FURTHER call: no money pauses it (its first call is the send's own check); money lets it carry on", async () => {
  const paused = await loop(async () => false);
  assert.equal(paused.relay, 1, "the next call never went");
  assert.equal(paused.asked, 1, "asked once: before the second call, never before the first");
  const kinds = paused.out.map((e) => e.kind);
  assert.deepEqual(kinds.slice(-2), ["paused", "done"]);
  assert.ok(paused.out.some((e) => e.kind === "allowance" && e.turnUsd === 0.0042 && e.owed?.owedMicros === 4200 && e.owed.model === "claude-opus-5-5"), "the paid call's cost, and what it owes, came first");
  const done = paused.out.at(-1) as Extract<ChatEvent, { kind: "done" }>;
  assert.equal(done.history.at(-1)!.role, "user", "what it did so far is kept (the tool's answer), so Continue carries on");
  const going = await loop(async () => true);
  assert.ok(going.relay >= 2, "with money it calls again");
  assert.ok(!going.out.some((e) => e.kind === "paused"));
  const none = await loop();
  assert.ok(none.relay >= 2 && !none.out.some((e) => e.kind === "paused"), "no wallet (off): the loop is as before");
});

test("ON by default (product decision, 3 Nov): the wallet hook runs; no free try, no key for people; first run is the fund card alone", () => {
  assert.equal(AGENTZERO_WALLET, true);
  assert.equal(walletFlag.on, true);
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /export const FREE_TRY = false;/, "funded wallet only: no free try");
  // D152: the last reply is paid before the next call, and the next send
  assert.match(live, /const ok = await withinOr\(w\.settle\(\), LIMITS\.core \+ 20_000, "AgentZero's wallet", false\);/);
  // product decision, 4 Nov: the words' bubble shows while it pays; paid or not, nothing goes unless it paid
  assert.match(live, /const ok = await withinOr\(wallet\.settle\(\), LIMITS\.core \+ 20_000, "AgentZero's wallet", false\);\n\s*\/\/ Stopped while it paid[^\n]*\n\s*if \(queuedRef\.current\?\.id !== id\) return false;\n\s*setQueued\(null\);\n\s*if \(!ok\) \{\n\s*setWait\(null\);\n\s*return false;/);
  assert.match(live, /keyController\(bridge, \{ relayBase: relayBase\(\), ownKey: OWN_KEY_ON \}\)/, "a saved key is never looked at unless the developer switch is on");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /<FundCard keys=\{keys\?\.own \? keys : undefined\}/, "no 'Use your own Claude key' link for people");
  assert.match(chat, /\{!card && !\(fundFirst && !keys\?\.own\) && <form className="azc-composer"/, "first run: the fund card and nothing else");
  const sheet = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{keys\?\.own && <button type="button" className="azc-link azw-link" onClick=\{\(\) => setPane\("key"\)\}>/, "the wallet's sheet offers a key only in a developer build");
  assert.match(sheet, /\{keys\?\.model && <ModelPick model=\{keys\.model\} \/>\}/, "the Model and Effort picker sits in the wallet's sheet");
  // control: the developer switch reads as off here (node), and never in the public build
  assert.equal(OWN_KEY_ON, false);
  assert.match(readFileSync(new URL("../../../../packages/agent/src/chat/own-key.ts", import.meta.url), "utf8"), /VITE_AGENTZERO_OWN_KEY === "1" && \(import\.meta as [^)]*\)\.env\?\.VITE_ZEROFEE_PUBLIC !== "1"/);
});

test("control, explicitly off (walletFlag.on = false): no wallet call, the old send; the key chip and card only with the developer setting (no-key.test.ts)", () => {
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const wallet = \(walletFlag\.on \? useAgentWallet : noWallet\)\(bridge\);/, "off: the wallet hook never runs (no account.agent.wallet call)");
  assert.match(live, /if \(!wallet \|\| ownKey\) return go\(w, id\);/, "off: a send is exactly the old send");
  assert.match(live, /\.\.\.\(wallet \? \{ wallet, resume \} : \{\}\)/);
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  // D152: off or on, no key of the person's own never asks for one (key-gate.ts; phone test, 3 Nov)
  assert.match(chat, /const gate = keyGate\(\{ keys, wallet: !!chat\.wallet, running \}\);/);
  assert.match(chat, /const card = gate\.card;/);
  assert.match(chat, /: chat\.note && <p className="zf-small azc-note">\{chat\.note\}<\/p>\}/, "off: the free reading's note as before");
  assert.match(chat, /\{\.\.\.\(chat\.wallet \? \{ onFund: \(\) => setWalletSheet\(\{ start: "fill" \}\) \} : \{\}\)\}/, "off: the Claude chip's sheet has no fund link");
  // the wallet's screens are their own lazy chunk: nothing of them in the chat's first load
  assert.doesNotMatch(chat, /^import .*AgentWallet/m);
  assert.match(chat, /lazy\(\(\) => import\("\.\/AgentWallet\.tsx"\)/);
});


test("D152 payOwed: the core pays its own figure, the relay is told; a kept payment is counted first; a used hash is counted; NEAR not knowing it asks the core to forget it (only if it can't land)", async () => {
  const TOKEN = `az1.${"A".repeat(22)}.${"b".repeat(43)}`;
  const OWED = { owedMicros: 5000, usage: { input_tokens: 1000, output_tokens: 50 }, model: "claude-opus-5-5", memo: (await memoFor(TOKEN))!, reply: "0123456789abcdef" };
  const run = async (o: { kept?: unknown; pay?: unknown; relay?: Response | Error; owed?: typeof OWED }) => {
    const calls: Record<string, unknown>[] = [];
    const asked: { url: string; body: unknown }[] = [];
    const r = await payOwed({
      call: (async (_m: string, p: Record<string, unknown>) => {
        calls.push(p);
        if (p.op === "pending") return { ok: o.kept ?? null };
        if (p.op === "reply") return o.pay ?? { ok: { tx: "TX1", from: "a9".repeat(32), micros: 5000 } };
        return { ok: { ok: true } };
      }) as never,
      fetch: (async (url: string, init: RequestInit) => {
        asked.push({ url, body: JSON.parse(String(init.body)) });
        if (o.relay instanceof Error) throw o.relay;
        return o.relay ?? new Response(JSON.stringify({ state: "paid", micros: 5000 }), { status: 200 });
      }) as never,
      base: "https://relay.test", token: TOKEN, owed: o.owed ?? OWED,
    });
    return { r, calls, asked };
  };
  const paid = await run({});
  assert.deepEqual(paid.r, { ok: true, paidMicros: 5000, tx: "TX1" });
  assert.deepEqual(paid.calls.map((c) => c.op), ["pending", "reply", "counted"]);
  assert.deepEqual(paid.calls[1], { do: "pay", op: "reply", ...OWED });
  assert.deepEqual(paid.asked, [{ url: "https://relay.test/v0/agentzero/pay", body: { tx: "TX1", from: "a9".repeat(32) } }]);
  // a payment kept from before: counted first, never a second one
  const kept = await run({ kept: { tx: "TX0", from: "a9".repeat(32), micros: 4000 } });
  assert.deepEqual(kept.calls.map((c) => c.op), ["pending", "counted"]);
  assert.deepEqual(kept.asked[0]!.body, { tx: "TX0", from: "a9".repeat(32) });
  // the relay already counted it (its answer was lost): counted
  assert.deepEqual((await run({ relay: new Response(JSON.stringify({ code: "agentzero.pay.used" }), { status: 409 }) })).r, { ok: true });
  // NEAR doesn't know it yet: kept (the core forgets it only when it provably can't land); the line says it's on its way
  const unknown = await run({ relay: new Response(JSON.stringify({ code: "agentzero.pay.unverified", why: "NEAR doesn't know that payment" }), { status: 402 }) });
  assert.deepEqual(unknown.r, { line: "AgentZero's payment is on its way. Try again in a moment." });
  assert.deepEqual(unknown.calls.map((c) => c.op), ["pending", "reply", "forget"]);
  // the core refused (an empty wallet): its own words, nothing asked of the relay
  const empty = await run({ pay: { problem: { code: "agentzero.pay.empty", whatHappened: "AgentZero's wallet is empty. Add money to keep going." } } });
  assert.deepEqual(empty.r, { line: "AgentZero's wallet is empty. Add money to keep going.", code: "agentzero.pay.empty" });
  assert.equal(empty.asked.length, 0);
  // SR3 L8: a memo that isn't this phone's own id's: nothing paid, the core never asked to pay
  const other = await run({ owed: { ...OWED, memo: `agentzero ${"cd".repeat(16)}` } });
  assert.deepEqual(other.r, { line: "That payment's note isn't this phone's. Nothing was paid." });
  assert.deepEqual(other.calls.map((c) => c.op), ["pending"]);
  // nothing owed and nothing kept: nothing at all
  const none = await payOwed({ call: (async () => ({ ok: null })) as never, fetch: (async () => { throw new Error("never"); }) as never, base: "https://relay.test", token: "az1.t", owed: null });
  assert.deepEqual(none, { ok: true });
  // the phone's memo is the relay's own memoOf for the same id
  const { memoOf } = await import("../../../quotes/agentzero-pay.mjs");
  assert.equal(await memoFor(TOKEN), memoOf("A".repeat(22)));
});

test("D37: the wallet pays each reply in ONE go, at once (no credit); Move all asks the relay's own figure and pays it first, whatever its size", async () => {
  const TOKEN = `az1.${"A".repeat(22)}.${"b".repeat(43)}`;
  const memo = (await memoFor(TOKEN))!;
  const batch = (micros: number, paid = 0) => ({ owedMicros: micros, usage: { input_tokens: 1 }, model: "claude-opus-5-5", byModel: { "claude-opus-5-5": { input_tokens: 70_000, output_tokens: 3_000 }, "claude-sonnet-5-5": { input_tokens: 9_000 } }, replies: 4, paidMicros: paid, memo, reply: "0123456789abcdef" });
  const go = async (o: { all?: boolean; owed: ReturnType<typeof batch> | null; walletUsd: number | null; relayOwes?: ReturnType<typeof batch> | null }) => {
    const calls: Record<string, unknown>[] = [];
    const asked: unknown[] = [];
    const out = await settleNow({
      all: !!o.all, owed: o.owed, walletUsd: o.walletUsd, base: "https://relay.test", token: TOKEN,
      call: (async (_m: string, p: Record<string, unknown>) => {
        calls.push(p);
        if (p.op === "pending") return { ok: null };
        if (p.op === "reply") return { ok: { tx: "TX1", from: "a9".repeat(32), micros: p.owedMicros } };
        return { ok: { ok: true } };
      }) as never,
      fetch: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        asked.push(body);
        if (!body.tx) return new Response(JSON.stringify(o.relayOwes ? { state: "owed", ...o.relayOwes } : { state: "paid", micros: 0, owedMicros: 0 }), { status: 200 });
        return new Response(JSON.stringify({ state: "paid", micros: calls.find((c) => c.op === "reply")?.owedMicros, owedMicros: 0 }), { status: 200 });
      }) as never,
    });
    return { ...out, pays: calls.filter((c) => c.op === "reply"), asked };
  };
  // D37: no credit: what a reply cost is paid at once, ONE payment, its usage per model and its replies passed for the
  // core's own figure
  const at = await go({ owed: batch(10_000), walletUsd: 5 });
  assert.equal(at.pays.length, 1);
  assert.deepEqual(at.pays[0], { do: "pay", op: "reply", owedMicros: 10_000, usage: { input_tokens: 1 }, model: "claude-opus-5-5", memo, reply: "0123456789abcdef", byModel: batch(0).byModel, replies: 4, paidMicros: 0 });
  assert.deepEqual(at.r, { ok: true, paidMicros: 10_000, tx: "TX1", left: null });
  assert.equal(payNow(batch(1) as never, 5), true, "a millionth of a dollar is paid at once");
  assert.equal(payNow(batch(1) as never, null), true, "also with the wallet unread (the core refuses what it can't pay)");
  assert.equal(payNow(null, 5), false, "control: nothing owed, nothing paid");
  // Move all (all): the relay's own figure first (a Stop's cost the phone never heard), paid whatever its size
  const all = await go({ all: true, owed: batch(50_000), walletUsd: 5, relayOwes: batch(70_000) });
  assert.deepEqual(all.asked[0], {}, "asked what is owed now");
  assert.equal(all.pays[0]!.owedMicros, 70_000, "the relay's figure, never the stale one");
  assert.equal(all.asked.length, 2);
  // Move all with nothing owed: nothing paid
  const none = await go({ all: true, owed: null, walletUsd: 5, relayOwes: null });
  assert.deepEqual([none.pays.length, none.asked], [0, [{}]]);
  assert.equal(none.asked.length, 1);
  // the hook: Move all settles everything owed BEFORE the core's move, and stops if it can't
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  const empty = hook.slice(hook.indexOf("const empty = useCallback("));
  assert.ok(empty.indexOf("await settleFor(true)") >= 0 && empty.indexOf("await settleFor(true)") < empty.indexOf('do: "empty"'), "paid first, then the move");
  assert.match(empty, /if \(!\("ok" in paid\)\) \{\s*walletTask\(tasksRef\.current, "empty", null, \{ line: paid\.line \}\);\s*return \{ line: paid\.line \};/, "nothing moves while something is owed and can't be paid");
});

test("product decision, 4 Nov: what AgentZero has is its USDC less what it owes: low and empty read that (Add money to keep going), and it is not a new wallet while it owes", () => {
  const month = { spentUsd: 0, capUsd: 20, endsAtIso: null };
  assert.equal(walletState({ walletUsd: 0, month, loaded: true }), "fresh");
  assert.equal(walletState({ walletUsd: 0, month, loaded: true, owes: true }), "empty", "used but never paid yet: Add money to keep going");
  assert.equal(walletState({ walletUsd: 0.6, month, loaded: true, owes: true }), "low");
});

test("D37 (QA 4 Nov: a $0 wallet got three paid replies): a message goes only when AgentZero's own money covers a reply's most; never funded, $0, no NEAR for fees, the cap, unread or loading are refused before Claude is asked (control: ok and low with enough go)", () => {
  for (const [st, usd] of [["fresh", 0], ["empty", 0], ["fees", 5], ["cap", 5]] as const) assert.equal(mayAsk(st, usd), "money", st);
  assert.equal(mayAsk("ok", 0.15), "money", "under a reply's most");
  assert.equal(mayAsk("low", (REPLY_HOLD_MICROS - 1) / 1e6), "money");
  for (const st of ["loading", "unread"] as const) assert.equal(mayAsk(st, null), "unread", st);
  assert.equal(mayAsk("ok", null), "unread", "no number: never sent on hope");
  assert.equal(mayAsk("ok", 4.21), null);
  assert.equal(mayAsk("low", 0.5), null);
  assert.equal(mayAsk("low", REPLY_HOLD_MICROS / 1e6), null, "control: exactly a reply's most goes");
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const no = mayAsk\(wallet\.state, wallet\.totalUsd\);\s*if \(no\) \{\s*wallet\.setRefused\(no\);[\s\S]*?return Promise\.resolve\(false\);/);
  const paidThenSent = live.indexOf("const ok = await withinOr(wallet.settle(), LIMITS.core + 20_000, \"AgentZero's wallet\", false);");
  assert.ok(paidThenSent > 0 && live.indexOf("mayAsk(wallet.state") < paidThenSent, "checked before anything is sent");
  assert.doesNotMatch(live, /NO_MONEY/, "the old list that let unread and loading through is gone");
});

test("D37: Add money picks an amount the NEAR wallet can pay, or none (QA 4 Nov: $20 preselected on a $0 wallet)", () => {
  assert.equal(W.firstPick(0), null, "$0: none");
  assert.equal(W.firstPick(null), null, "unread: none");
  assert.equal(W.firstPick(4.99), null, "under the smallest: none");
  assert.equal(W.firstPick(7), 5);
  assert.equal(W.firstPick(20), 20);
  assert.equal(W.firstPick(80), 20, "control: $20 when it can");
  const sheet = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /useState<number \| "other" \| null>\(otherFirst \? "other" : \(amount \?\? firstPick\(w\.nearUsd\)\)\)/);
});

test("D37: each paid reply is a receipt row in Activity (QA 4 Nov: no AgentZero rows); control: nothing paid, no row", async () => {
  const { replyReceipt } = await import("./az-tasks.ts");
  const rows: { id: string; title: string; ended?: string }[] = [];
  const tasks = { publish: (t: { id: string; title: string }) => (rows.push({ id: t.id, title: t.title }), true), update: () => true, end: (id: string, s: string) => void (rows.find((r) => r.id === id)!.ended = s) } as never;
  replyReceipt(tasks, 12_000, W.receiptTitle(12_000), () => 1);
  assert.deepEqual(rows.map((r) => [r.title, r.ended]), [["AgentZero paid 1.2¢ for a reply", "done"]]);
  replyReceipt(tasks, 0, W.receiptTitle(0), () => 2);
  assert.equal(rows.length, 1, "control: nothing paid, no row");
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(r\.paidMicros\) replyReceipt\(tasksRef\.current, r\.paidMicros, receiptTitle\(r\.paidMicros\), Date\.now, r\.tx, turnId\.current \? \{ id: turnId\.current, titleOf: receiptTitle \} : undefined\);/, "every payment the relay counted makes its row, with its transaction");
});

test("SR3 L14 on screen: the sheet says payments for thinking are public and never name the Safe; a stopped reply has no cost line (product decision, 4 Nov: the meter takes its estimate)", () => {
  assert.equal(W.PUBLIC_LINE, "Payments for thinking are public on NEAR. They never name your Safe.");
  assert.match(readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8"), /<p className="zf-small azw-quiet">\{PUBLIC_LINE\}<\/p>/);
  assert.equal((W as Record<string, unknown>).costLine, undefined, "no \"This reply cost …\", stopped or not");
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /if \(wallet && !ownKey\) wallet\.stopped\(liveRef\.current\);/, "a Stop puts the streamed estimate on the meter");
});

test("D143 on the web: Add money fills only from the person's own trusted tap on the button marked with its amount (main's fill asked with no ticket, so the core refused every one)", () => {
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /await fillOnTap\(bridge, tap, String\(Math\.round\(usd \* 1e6\)\), moveKey\("agent-fill"\)\)/);
  assert.doesNotMatch(hook, /do: "ticket"/, "only wallet-fill.ts asks for a ticket");
  const sheet = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /data-agentzero-fill=\{ok \? String\(Math\.round\(usd \* 1e6\)\) : undefined\} onClick=\{\(e\) => void go\(e\.nativeEvent\)\}/);
});

test("D37: each chat call names AgentZero's own account for the relay's balance read; the relay's refusal for money shows as Add money, never a reply (control: no account, no header)", async () => {
  const seen: (string | null)[] = [];
  const refusing = (async (_u: string, init: RequestInit) => {
    seen.push(new Headers(init.headers).get("x-zf-agent-account"));
    return new Response(JSON.stringify({ code: "agentzero.reply.unfunded", needMicros: 152_000 }), { status: 402 });
  }) as never;
  const ACCOUNT = "a9".repeat(32);
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], "hi", { relayBase: "https://relay.test", token: "az1.t", account: ACCOUNT, fetch: refusing, hands: { receipts: async () => "", meter: async () => "" } })) out.push(e);
  assert.deepEqual(seen, [ACCOUNT]);
  assert.ok(out.some((e) => e.kind === "needs-key" && e.why === "used-up"), "the screen's refusal line (WalletLine \"refused\")");
  assert.ok(!out.some((e) => e.kind === "text"), "no reply");
  for await (const _e of chatTurn([], "hi", { relayBase: "https://relay.test", token: "az1.t", account: "bob.near", fetch: refusing, hands: { receipts: async () => "", meter: async () => "" } })) void _e;
  assert.deepEqual(seen, [ACCOUNT, null], "control: anything but 64 hex is never sent");
});

test("QA: with AgentZero's account, the chat call carries its key's proof for the sign-up's id (asked of the wallet with the token); a proof that isn't 128 hex is never sent", async () => {
  const sent: (string | null)[] = [];
  const asked: string[] = [];
  const refusing = (async (_u: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get("x-zf-agent-bind"));
    return new Response(JSON.stringify({ code: "agentzero.reply.account" }), { status: 403 });
  }) as never;
  const run = async (proof: string) => {
    const out: ChatEvent[] = [];
    for await (const e of chatTurn([], "hi", { relayBase: "https://relay.test", token: "az1.t", account: "a9".repeat(32), bindFor: async (t) => (asked.push(t), proof), fetch: refusing, hands: { receipts: async () => "", meter: async () => "" } })) out.push(e);
    return out;
  };
  const out = await run("ab".repeat(64));
  assert.deepEqual([sent, asked], [["ab".repeat(64)], ["az1.t"]]);
  assert.ok(out.some((e) => e.kind === "fault" && e.line === "This phone named the wrong AgentZero wallet. Nothing was paid."), "the relay's refusal said");
  await run("junk");
  assert.deepEqual(sent, ["ab".repeat(64), null], "control: a malformed proof isn't sent");
});

test("QA 4 Nov: the $0.045 taken on credit before prepaid is paid from the first money that lands, with its Activity row; never at $0 (control)", async () => {
  const TOKEN = `az1.${"C".repeat(22)}.${"d".repeat(43)}`;
  const memo = (await memoFor(TOKEN))!;
  // the test's three replies on credit: $0.045, still owed
  const credit = { owedMicros: 45_000, usage: { input_tokens: 1 }, model: "claude-opus-5-5", byModel: { "claude-opus-5-5": { input_tokens: 9_000, output_tokens: 600 } }, replies: 3, paidMicros: 0, memo, reply: "fedcba9876543210" };
  assert.equal(creditDue(0, 45_000), false, "control: $0 in AgentZero's wallet, nothing is asked of it");
  assert.equal(creditDue(null, 45_000), false, "control: unread, nothing paid on hope");
  assert.equal(creditDue(2.6, 0), false, "control: nothing owed");
  assert.equal(creditDue(0.045, 45_000), true, "exactly covered");
  assert.equal(creditDue(2.6, 45_000), true, "the first fill's $2.60 landed");
  const pays: Record<string, unknown>[] = [];
  const out = await settleNow({
    all: false, owed: credit, walletUsd: 2.6, base: "https://relay.test", token: TOKEN,
    call: (async (_m: string, p: Record<string, unknown>) => (p.op === "pending" ? { ok: null } : p.op === "reply" ? (pays.push(p), { ok: { tx: "TXC", from: "b8".repeat(32), micros: p.owedMicros } }) : { ok: { ok: true } })) as never,
    fetch: (async () => new Response(JSON.stringify({ state: "paid", micros: 45_000, owedMicros: 0 }), { status: 200 })) as never,
  });
  assert.equal(pays.length, 1);
  assert.deepEqual(out.r, { ok: true, paidMicros: 45_000, tx: "TXC", left: null });
  assert.equal(W.receiptTitle(45_000), "AgentZero paid 4.5¢ for a reply", "its row in Activity");
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /useEffect\(\(\) => \{\s*if \(autoSettleNow\(autoLast\.current, \{ walletUsd, owed: owed\.current, inFlight: !!paying\.current \}\)\) void settle\(\);\s*\}, \[walletUsd, owedMicros, settle\]\);/, "paid as soon as the wallet covers it, once per figure");
  assert.match(hook, /if \(r\.paidMicros\) replyReceipt\(tasksRef\.current, r\.paidMicros, receiptTitle\(r\.paidMicros\), Date\.now, r\.tx, turnId\.current \? \{ id: turnId\.current, titleOf: receiptTitle \} : undefined\);/, "through run(): its receipt row");
});

test("QA 4 Nov: after Add money the wallet is read again until the money lands, and a message refused for money reads it again (a landed fill never stays $0)", () => {
  assert.equal(fillLanded(0, 0), false);
  assert.equal(fillLanded(null, null), false, "control: unread is not landed");
  assert.equal(fillLanded(0, 2.6), true);
  assert.equal(fillLanded(1, 1), false, "control: the same as before");
  assert.ok(FILL_READ_MS * FILL_READS >= 3 * 60_000, "reads for at least 3 minutes (the test's fill took 2 min 45 s to show)");
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  const fund = hook.slice(hook.indexOf("const fund = useCallback("), hook.indexOf("const empty = useCallback("));
  assert.match(fund, /walletTask\(tasksRef\.current, "fill", usd, \{ ok: true \}\);[\s\S]*refresh\(\);\s*watchFill\(walletNow\.current, feesWereLow\);/, "a fill that went through watches for its money");
  assert.doesNotMatch(fund.slice(0, fund.indexOf('{ ok: true });')), /watchFill/, "control: a refused or declined fill watches nothing");
  assert.match(hook, /setRefusedNow\(r\);\s*if \(r === "money"\) refresh\(\);/);
});

test("QA MUST: the credit's auto-settle never pays twice: paid, the relay still answering 45,000 for the same batch, the balance changing → exactly ONE payment; a new batch figure pays once (control)", async () => {
  const TOKEN = `az1.${"E".repeat(22)}.${"f".repeat(43)}`;
  const memo = (await memoFor(TOKEN))!;
  const batch = (reply: string, owedMicros: number, paidMicros = 0) => ({ owedMicros, usage: { input_tokens: 1 }, model: "claude-opus-5-5", byModel: { "claude-opus-5-5": { input_tokens: 9_000, output_tokens: 600 } }, replies: 3, paidMicros, memo, reply });
  const credit = batch("fedcba9876543210", 45_000);
  let relaySays = credit; // a slow relay: after the payment it still answers the same 45,000
  const pays: Record<string, unknown>[] = [];
  const last = { key: null as string | null };
  // the hook's loop, as the effect runs it: the gate, then one settle; the relay's answer is what is owed next
  let owed: ReturnType<typeof batch> | null = credit;
  let inFlight = false;
  const tick = async (walletUsd: number) => {
    if (!autoSettleNow(last, { walletUsd, owed: owed as never, inFlight })) return;
    inFlight = true;
    const out = await settleNow({
      all: false, owed: owed as never, walletUsd, base: "https://relay.test", token: TOKEN,
      call: (async (_m: string, p: Record<string, unknown>) => (p.op === "pending" ? { ok: null } : p.op === "reply" ? (pays.push(p), { ok: { tx: `TX${pays.length}`, from: "c7".repeat(32), micros: p.owedMicros } }) : { ok: { ok: true } })) as never,
      fetch: (async () => new Response(JSON.stringify({ state: "paid", micros: 45_000, ...relaySays }), { status: 200 })) as never,
    });
    inFlight = false;
    if ("ok" in out.r && out.r.left !== undefined) owed = out.r.left as never;
  };
  await tick(2.6);
  assert.equal(pays.length, 1, "the credit paid once");
  assert.equal(batchKey(owed as never), batchKey(credit as never), "the relay still says 45,000 for the same batch");
  for (const usd of [2.567, 2.5, 2.567, 3]) await tick(usd);
  assert.equal(pays.length, 1, "the balance moving under the same figure pays nothing more");
  // never while a settle runs
  assert.equal(autoSettleNow({ key: null }, { walletUsd: 5, owed: credit as never, inFlight: true }), false);
  // control: the relay's batch changes (a new reply owed), the next due figure pays once, then not again
  relaySays = batch("0011223344556677", 12_000) as never;
  owed = relaySays;
  await tick(2.5);
  await tick(2.488);
  assert.equal(pays.length, 2);
  assert.equal(pays[1]!.owedMicros, 12_000);
  // the hook marks a figure paid by any settle (a Send's too), so the effect never pays it again
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(r\.paidMicros\) autoLast\.current\.key = batchKey\(asked \?\? was\);/);
});

test("QA 4 Nov: a paid reply's Activity row is its receipt: its dollars, where they came from, and the payment's NEAR transaction (control: no transaction known, no proof)", async () => {
  const { replyReceipt, RECEIPT_WHERE } = await import("./az-tasks.ts");
  const rows: Record<string, unknown>[] = [];
  const tasks = { publish: (t: Record<string, unknown>) => (rows.push(t), true), update: () => true, end: () => true } as never;
  replyReceipt(tasks, 45_000, W.receiptTitle(45_000), () => 1, "8kN3vRz7Qe1fT6yW2pLm9sJc4bXaHdUq5oGiEtYwZr7A");
  assert.deepEqual([rows[0]!.usd, rows[0]!.where, rows[0]!.proof], ["$0.045", RECEIPT_WHERE, [{ chain: "near", hash: "8kN3vRz7Qe1fT6yW2pLm9sJc4bXaHdUq5oGiEtYwZr7A" }]]);
  replyReceipt(tasks, 1_250_000, W.receiptTitle(1_250_000), () => 2);
  assert.equal(rows[1]!.usd, "$1.25", "a dollar or more to the cent");
  assert.equal(rows[1]!.proof, undefined, "control: no transaction, no proof");
  // the payment's transaction comes back from payOwed with what the relay counted
  const TOKEN = `az1.${"G".repeat(22)}.${"h".repeat(43)}`;
  const memo = (await memoFor(TOKEN))!;
  const r = await payOwed({ base: "https://relay.test", token: TOKEN, owed: { owedMicros: 45_000, usage: { input_tokens: 1 }, model: "claude-opus-5-5", memo, reply: "0123456789abcdef" },
    call: (async (_m: string, p: Record<string, unknown>) => (p.op === "pending" ? { ok: null } : p.op === "reply" ? { ok: { tx: "TXR", from: "d6".repeat(32), micros: 45_000 } } : { ok: { ok: true } })) as never,
    fetch: (async () => new Response(JSON.stringify({ state: "paid", micros: 45_000, owedMicros: 0 }), { status: 200 })) as never });
  assert.deepEqual(r, { ok: true, paidMicros: 45_000, tx: "TXR", left: null });
});

test("QA 4 Nov: after Add money the sheet waits for AgentZero's balance as read, never before + amount ($0.30 kept for fees and the swap's cost come off); late, two quiet lines", () => {
  assert.equal(W.fillShows(0, 0), false);
  assert.equal(W.fillShows(0, null), false, "control: unread is not landed");
  assert.equal(W.fillShows(0, 2.56), true);
  assert.equal(W.doneLine(2.56), "Done. AgentZero has $2.56.");
  assert.equal(W.FILL_ON_WAY, "Your money is on its way to AgentZero. It takes a minute or two.");
  assert.deepEqual(W.FILL_LATE, ["Your money is safe. It's still on its way to AgentZero.", "You can close this. It lands on its own."]);
  const sheet = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{landed \? <p className="azw-big azw-done" role="status">\{doneLine\(w\.walletUsd!\)\}<\/p> : \(\n\s+<div className="zf-receipt zf-receipt--job" data-state="away"[^]*?\{JOB_WORDS\.created\}[^]*?\{late && FILL_LATE\.map/, "the balance it read; until then the job's receipt (bug report, 5 Nov)");
  assert.match(sheet, /const landed = done !== null && fillShows\(done, w\.walletUsd\);/);
  assert.doesNotMatch(sheet, /doneLine\(done\)|setDone\(before \+ usd\)/, "control: never the amount asked as the balance");
});

test("QA 5 Nov: after a fill that carried AgentZero's fees, the wallet is read until the fees landed too, so \"needs a little NEAR for fees\" goes (control: a fill with no fees part stops at its USDC)", () => {
  assert.equal(fillSettled(0, 1.99, true, true), false, "USDC in, fees not yet: read again");
  assert.equal(fillSettled(0, 1.99, true, false), true, "both in: done");
  assert.equal(fillSettled(0, 1.99, false, true), true, "control: no fees in this fill, the USDC is all");
  assert.equal(fillSettled(0, 0, true, false), false, "control: no USDC yet");
  // the screen's line follows the read: fees low, the fees line; fees in, none
  assert.equal(walletState({ walletUsd: 1.99, feesLow: true, month: null, loaded: true }), "fees");
  assert.equal(walletState({ walletUsd: 1.99, feesLow: false, month: null, loaded: true }), "ok");
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(\+\+n > FILL_READS \|\| fillSettled\(before, walletNow\.current, feesWereLow, feesLowNow\.current\)\)/, "the watch stops only when both landed");
  assert.match(hook, /feesLowNow\.current = "ok" in w && !!w\.ok\?\.feesLow;\s*setFeesLow\(feesLowNow\.current\);/, "every read sets what the watch checks");
});

test("QA 5 Nov: the fill sheet's floor is the core's own, said up front ($2.30 with $0.30 for fees); no second copy of it here (control: no fees part, $2.00)", () => {
  assert.equal(W.fillFloor(2.3, 0.3), "Least you can add: $2.30. $0.30 of it turns into NEAR for AgentZero's sending fees.");
  assert.equal(W.fillFloor(2, 0), "Least you can add: $2.00. Less would mostly go on fees.");
  assert.equal((W as Record<string, unknown>).FILL_MIN_USD, undefined, "no copy of the core's floor in the words");
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /const min = "ok" in w \? num\(w\.ok\?\.fillMinMicros\) : null, fees = "ok" in w \? num\(w\.ok\?\.fillFeesMicros\) : null;/, "read from the core's answer");
  assert.match(hook, /fillMinUsd: fillMin\.min, fillFeesUsd: fillMin\.fees/);
  assert.doesNotMatch(hook, /FILL_MIN_USD/);
  const sheet = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const ok = Number\.isFinite\(usd\) && usd > 0 && \(w\.fillMinUsd === null \|\| usd >= w\.fillMinUsd - 1e-9\);/, "the button holds to it");
  assert.match(sheet, /\{w\.fillMinUsd !== null && <p className="zf-small azw-quiet" [^>]*>\{fillFloor\(w\.fillMinUsd, w\.fillFeesUsd\)\}<\/p>\}/, "shown up front, before any amount is typed");
  assert.doesNotMatch(sheet, /FILL_MIN_USD|fillTooSmall/);
});
