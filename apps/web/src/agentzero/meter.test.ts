// Product decision, 4 Nov: the cost meter on top ("$0.034 used") rises while a reply streams and snaps to the reply's exact cost
// when it ends; no cost line under replies; it starts again at local midnight; the wallet's sheet says used, paid and
// owed today and that AgentZero pays ZeroFee in one go at $0.25. Rendered from the real components (vite SSR) with a
// mocked relay stream through the real chatTurn and the chat's own fold. Each with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { chatTurn, type ReplyOwed } from "@zerofee/agent/chat/turn";
import { foldChat, type ChatItem } from "@zerofee/agent/chat/use-chat-turn";
import { dayOf, heardMicros, monthShown, readMeter, streamMicros, untilMidnight } from "./meter.ts";

let server: ViteDevServer;
let WalletChip: ComponentType<{ w: unknown; onOpen: () => void }>;
let WalletSheet: ComponentType<{ w: unknown; chatUsd?: number; onClose: () => void }>;
let WalletLine: ComponentType<{ w: unknown; onSheet: () => void; model?: string }>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ WalletChip, WalletSheet, WalletLine } = await server.ssrLoadModule("./AgentWallet.tsx"));
});
after(async () => server?.close());

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const wallet = (o: Record<string, unknown> = {}) => ({ state: "ok", walletUsd: 4.25, totalUsd: 4.21, usedUsd: 0, paidUsd: 0, owedUsd: 0, liveUsd: 0, feesNear: 0.09, month: { capUsd: 20, spentUsd: 1.5, endsAtIso: null }, nearUsd: 40, paused: false, problem: null, ...o });
const chip = (w: unknown) => text(renderToStaticMarkup(createElement(WalletChip, { w, onOpen: () => undefined })));

/** The relay's stream for one reply: its words in small pieces, then its closing line with the exact cost. */
const WORDS = "You spent about forty dollars this week, mostly on two payments to kim.near and a small swap into SOL. Nothing is waiting on you.";
const EXACT = { input_tokens: 2_000, output_tokens: 215 };
const EXACT_MICROS = 2_000 * 4 + 215 * 20;
function relayReply(): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const pieces = WORDS.match(/.{1,12}/g)!;
  return [
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2_000, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...pieces.map((t) => ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } })),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 215 } }),
    ev("message_stop", {}),
    `event: zerofee\ndata: ${JSON.stringify({ allowance: { usedUsd: 0, limitUsd: 0 }, turnUsd: EXACT_MICROS / 1e6, owedMicros: 34_000 + EXACT_MICROS, usage: EXACT, model: "claude-opus-5-5", byModel: { "claude-opus-5-5": EXACT }, replies: 3, paidMicros: 0, memo: `agentzero ${"ab".repeat(16)}`, reply: "0123456789abcdef" })}\n\n`,
  ].join("");
}

test("product decision, 4 Nov: the meter rises while a reply streams (a mocked stream through the real turn) and snaps to the reply's exact cost when it ends", async () => {
  const fetch = (async () => new Response(relayReply(), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof globalThis.fetch;
  // the day so far: $0.034 used over two replies, all of it still owed
  let usedMicros = 34_000;
  let prev: ReplyOwed | null = { owedMicros: 34_000, usage: {}, model: "claude-opus-5-5", memo: "", reply: "0123456789abcdef", replies: 2, paidMicros: 0 };
  let items: ChatItem[] = [{ kind: "you", text: "What did I spend this week?" }];
  const seen: string[] = [];
  const live: number[] = [];
  for await (const e of chatTurn([], "What did I spend this week?", { relayBase: "https://relay.test", token: "az1.t", fetch, hands: { receipts: async () => "", meter: async () => "" } })) {
    if (e.kind === "allowance") {
      // the hook's own arithmetic (use-agent-wallet.ts owe → heard): this reply's exact cost takes the estimate's place
      usedMicros += heardMicros(prev, true, e.owed!, e.owed!.turnMicros!, 0);
      prev = e.owed!;
      items = [...items, { kind: "cost", turnUsd: e.turnUsd! }];
    } else items = foldChat(items, e);
    if (e.kind !== "text" && e.kind !== "allowance") continue;
    const est = streamMicros(items, true, "claude-opus-5-5");
    live.push(est);
    seen.push(chip(wallet({ usedUsd: usedMicros / 1e6, liveUsd: est / 1e6 })));
  }
  const rising = live.slice(0, -1);
  assert.ok(rising.length >= 8, "many pieces streamed");
  for (let i = 1; i < rising.length; i++) assert.ok(rising[i]! >= rising[i - 1]!, "the estimate never goes down while it streams");
  assert.ok(rising.at(-1)! > rising[0]!, "it rose");
  // on screen: "$0.034 used" at the first words, more by the end of them
  assert.equal(seen[0], "$0.034 used");
  const mid = seen[Math.floor(rising.length / 2)]!;
  assert.match(mid, /^\$0\.03[4-9] used$/);
  assert.notEqual(seen[rising.length - 1], seen[0], "the meter moved while it streamed");
  // the end: the estimate is gone and the exact cost is in: $0.034 + $0.0123 = $0.0463
  assert.equal(live.at(-1), 0, "no estimate left once the exact figure came");
  assert.equal(usedMicros, 34_000 + EXACT_MICROS);
  assert.equal(seen.at(-1), "$0.046 used");
  // control: no cost line under the reply
  assert.doesNotMatch(seen.join(" "), /This reply cost/);
});

test("the meter's second line says what AgentZero has left only when it is low or empty (Add money to keep going stays above the box); the tap's label says both", () => {
  assert.equal(chip(wallet({ usedUsd: 0.034, state: "low", totalUsd: 0.84 })), "$0.034 used $0.840 left");
  assert.equal(chip(wallet({ usedUsd: 0.034, state: "empty", totalUsd: 0 })), "$0.034 used $0.000 left");
  assert.equal(chip(wallet({ usedUsd: 0.034 })), "$0.034 used", "control: ok, one quiet line");
  assert.match(renderToStaticMarkup(createElement(WalletChip, { w: wallet({ usedUsd: 0.034 }), onOpen: () => undefined })), /aria-label="AgentZero used \$0\.034 today and has \$4\.21 left\. Open its wallet"/);
});

test("the wallet's sheet: what AgentZero has, used · paid today, how it pays ZeroFee, the chat's cost, fees, the month, the limit, Add money and Move all", () => {
  const sheet = text(renderToStaticMarkup(createElement(WalletSheet, { w: wallet({ usedUsd: 0.034, paidUsd: 0, owedUsd: 0.034 }), chatUsd: 0.0246, onClose: () => undefined })));
  for (const line of ["$4.21", "Used today $0.034 · paid $0.000", "Pays after each reply, at Anthropic's price. ZeroFee passes it on and takes nothing.", "This chat cost $0.025 · Claude's price, nothing added", "This month $1.50 of $20", "Monthly limit $20 a month", "Fees for sending 0.090 NEAR", "Add money", "Move all to my Safe", "Payments for thinking are public on NEAR. They never name your Safe."]) assert.ok(sheet.includes(line), `${line} in: ${sheet}`);
  assert.ok(sheet.indexOf("$4.21") < sheet.indexOf("Used today"), "what AgentZero has comes first");
});

test("the sheet's month counts what was used (paid + owed), so it agrees with the Used today line; one rule for money: \"$0.037\" everywhere, never \"$0.0369\" (product decision, 4 Nov)", () => {
  // the walk's state after three replies: the core's month counts payments only (none yet), $0.0369 is owed
  const raw = { capUsd: 20, spentUsd: 0, endsAtIso: null };
  const w = wallet({ totalUsd: 4.96, usedUsd: 0.0369, paidUsd: 0, owedUsd: 0.0369, month: monthShown(raw, 0.0369) });
  const sheet = text(renderToStaticMarkup(createElement(WalletSheet, { w, chatUsd: 0.0369, onClose: () => undefined })));
  assert.match(sheet, /Used today \$0\.037 · paid \$0\.000/);
  assert.doesNotMatch(sheet, /owed/, "D37: no credit, no \"owed\"");
  assert.match(sheet, /This month \$0\.037 of \$20/, "paid + owed = used: the two lines agree");
  assert.match(sheet, /This chat cost \$0\.037 · Claude's price/, "one precision for all of it");
  assert.doesNotMatch(sheet, /\$0\.0369|\$0\.00 of/, "never 4 decimals, never a month under what is owed");
  // control (the old code: the core's month as it is): the sheet disagrees with itself
  const old = text(renderToStaticMarkup(createElement(WalletSheet, { w: wallet({ usedUsd: 0.0369, paidUsd: 0, owedUsd: 0.0369, month: raw }), chatUsd: 0.0369, onClose: () => undefined })));
  assert.match(old, /This month \$0\.000 of \$20/);
  assert.notEqual(old, sheet);
  // paid money is in the core's month already: paid + owed, never twice
  assert.deepEqual(monthShown({ capUsd: 20, spentUsd: 0.257, endsAtIso: "x" }, 0.012), { capUsd: 20, spentUsd: 0.269, endsAtIso: "x" });
  assert.equal(monthShown({ capUsd: 20, spentUsd: 3.1, endsAtIso: null }, 0)?.spentUsd, 3.1, "control: nothing owed, the core's figure as it is");
  assert.equal(monthShown(null, 0.04), null, "no month read: no row");
  // the hook hands the screen the shown month (the core's raw month is only the base)
  const hook = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(hook, /shownMonth = useMemo\(\(\) => monthShown\(month, owedUsd\)/);
  assert.match(hook, /month: shownMonth/);
});

test("the meter is a chip seated above the thread, not laid over it (product decision, 4 Nov: a reply ran through it)", () => {
  const html = renderToStaticMarkup(createElement(WalletChip, { w: wallet({ usedUsd: 0.037 }), onOpen: () => undefined }));
  assert.match(html, /class="zf-chip azw-meter"/, "the design system's chip");
  const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  const rule = /\.azc \.azw-meter \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(rule, "the meter's rule");
  assert.doesNotMatch(rule, /position:\s*absolute|all:\s*unset/, "in the column, so the thread starts below it; the chip's own look and focus ring stay");
  assert.match(rule, /flex:\s*none/);
});

test("a Stop's estimate stays on the meter until the relay's next figure says that reply's cost exactly; the meter starts again at local midnight", () => {
  const batch = (owed: number, replies: number, paid = 0, reply = "0123456789abcdef"): ReplyOwed => ({ owedMicros: owed, usage: {}, model: "claude-opus-5-5", memo: "", reply, replies, paidMicros: paid });
  // $0.010 owed; a Stop put $0.002 on the meter (its words so far); the relay counted it at $0.0065 (its input too);
  // the next reply's own cost is $0.005: the meter takes $0.005 + $0.0065 - $0.002
  assert.equal(heardMicros(batch(10_000, 1), true, batch(21_500, 3), 5_000, 2_000), 5_000 + 6_500 - 2_000);
  // control: no Stop, nothing unheard: just the reply's cost
  assert.equal(heardMicros(batch(10_000, 1), true, batch(15_000, 2), 5_000, 0), 5_000);
  // a new batch (the last one paid): everything in it is new
  assert.equal(heardMicros(null, true, batch(5_000, 1, 0, "fedcba9876543210"), 5_000, 0), 5_000);
  // part of a batch paid while a reply settled: the paid part isn't new
  assert.equal(heardMicros(batch(20_000, 2), true, batch(12_000, 3, 20_000), 12_000, 0), 12_000);
  // the batch closed (paid) with nothing more said: a Stop's estimate on the meter stays (never taken back unheard)
  assert.equal(heardMicros(batch(10_000, 1), true, null, 0, 2_000), 0);
  // where the batch stood isn't known (the relay couldn't be asked): only the reply's own cost, never a guess
  assert.equal(heardMicros(null, false, batch(90_000, 5), 5_000, 0), 5_000);
  // the day: yesterday's figures read as nothing used yet
  const kept = JSON.stringify({ day: "2026-11-03", usedMicros: 34_000, paidMicros: 250_000 });
  assert.deepEqual(readMeter(kept, "2026-11-04"), { day: "2026-11-04", usedMicros: 0, paidMicros: 0 });
  assert.deepEqual(readMeter(kept, "2026-11-03"), { day: "2026-11-03", usedMicros: 34_000, paidMicros: 250_000 }, "control: today's stay");
  assert.equal(dayOf(new Date(2026, 10, 4, 23, 59)), "2026-11-04");
  assert.equal(dayOf(new Date(2026, 10, 5, 0, 0)), "2026-11-05", "local midnight, not UTC");
  assert.equal(untilMidnight(new Date(2026, 10, 4, 23, 59)), 60_000);
  // between replies there is no estimate
  assert.equal(streamMicros([{ kind: "you", text: "hi" }, { kind: "agent", text: "Hello there" }], false, "claude-opus-5-5"), 0);
  assert.equal(streamMicros([{ kind: "you", text: "hi" }, { kind: "agent", text: "Hello there" }], true, "claude-sonnet-5-5"), 4 * 10, "11 characters, 4 tokens at Sonnet's $10/M");
});

test("QA 4 Nov: the idle chat shows what a message costs under every line above the box, the core's own words too", () => {
  const line = (o: Record<string, unknown>) => text(renderToStaticMarkup(createElement(WalletLine, { w: wallet({ refused: null, ...o }), onSheet: () => undefined, model: "claude-sonnet-5-5" })));
  const price = "One message costs up to 3½¢.";
  // the test's idle screen: the core's refusal from paying, on an empty wallet
  assert.equal(line({ state: "empty", totalUsd: 0, problem: "AgentZero's wallet has no money yet." }), `AgentZero's wallet has no money yet. ${price}`);
  for (const o of [{}, { state: "low", totalUsd: 0.5 }, { state: "empty", totalUsd: 0 }, { refused: "money" }, { refused: "unread" }, { paused: true, problem: "Paused." }]) {
    assert.ok(line(o).endsWith(price), JSON.stringify(o));
  }
  // QA (5 Nov, real test): after the reply, the receipt's figure; mid-reply the upper one (control)
  const after = (busy: boolean) => text(renderToStaticMarkup(createElement(WalletLine, { w: wallet({ refused: null, turnPaidUsd: 0.022 }), onSheet: () => undefined, model: "claude-sonnet-5-5", busy })));
  assert.equal(after(false), "This message cost 2.2¢.");
  assert.equal(after(true), price);
});
