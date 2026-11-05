// The test real run, 3 Nov: after a reload AgentZero said "This was a sheet from before… Nothing moved." about a
// sheet whose money had moved; and "did it go?" after a closed sheet was answered from other moves in Activity. A money
// card's own news is kept, said to Claude once, and a restored card never claims "nothing moved" unread.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendSheet, moveSheet, type HomeSheet } from "./home-ask.ts";
import { cardRecord, cardSaw, foldChat, type ChatItem } from "./use-chat-turn.ts";
import { keptItems, OLD_SHEET_LINE, readChat, chatJson } from "./chats.ts";
import { chatTurn, type ChatEvent } from "./turn.ts";

const SEND3 = sendSheet({ to: "kim.near", usd: 3 }, "send $3 to kim.near") as HomeSheet;
const card = (items: ChatItem[]) => (items.find((i) => i.kind === "needs-you") as { card: string }).card;

test("a money card's news is kept, said to Claude once (closed: nothing moved; went: Home said so), never for a card still open (controls)", () => {
  let items = foldChat([], { kind: "needs-you", why: "home", sheet: { kind: "home", ...SEND3 } });
  const id = card(items);
  assert.match(id, /^k/);
  assert.equal(cardRecord(items).text, null, "control: an unopened card has no news");
  items = cardSaw(items, id, { kind: "opened" }, 1000);
  assert.equal(cardRecord(items).text, null, "control: open, not ended: nothing said");
  items = cardSaw(items, id, { kind: "ended", went: false });
  const r = cardRecord(items);
  assert.match(r.text!, /Send \$3\.00 to kim\.near\. \[closed before it went; nothing moved\]/);
  assert.equal(cardRecord(r.items).text, null, "said once");
  // went: Home's sheet said so, Activity shows when it lands
  let w = foldChat([], { kind: "needs-you", why: "home", sheet: { kind: "home", ...SEND3 } });
  w = cardSaw(w, card(w), { kind: "ended", went: true, movementId: "mv-9" });
  assert.match(cardRecord(w).text!, /\[Home's sheet said it went; Activity shows when it lands\]/);
});

test("\"did it go?\" after a closed sheet: ZeroFee's record goes to Claude with the words, as data (control: none without news)", async () => {
  const bodies: { messages: { role: string; content: unknown }[] }[] = [];
  const sse = (t: string) => `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })}\n\nevent: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
  const f = (async (_u: unknown, init: { body?: string } = {}) => (bodies.push(JSON.parse(init.body ?? "{}")), new Response(sse("No, it didn't go."), { headers: { "content-type": "text/event-stream" } }))) as typeof fetch;
  const run = async (cards: string | null) => { const out: ChatEvent[] = []; for await (const e of chatTurn([], "Did it go?", { relayBase: null, ownKey: "sk-ant-own-test-key-6666666666666666", anthropicFetch: f, ...(cards ? { cards } : {}), hands: { receipts: async () => "", meter: async () => "" } })) out.push(e); return out; };
  let items = foldChat([], { kind: "needs-you", why: "home", sheet: { kind: "home", ...SEND3 } });
  items = cardSaw(items, card(items), { kind: "ended", went: false });
  await run(cardRecord(items).text);
  assert.match(JSON.stringify(bodies[0]!.messages), /ZeroFee's record of this chat's money sheets.*closed before it went; nothing moved/);
  await run(null);
  assert.equal(JSON.stringify(bodies[1]!.messages).includes("money sheets"), false);
});

test("a saved chat keeps a money card's news; any other sheet's old line claims nothing about money (control: no \"Nothing moved\" in it)", () => {
  let items = foldChat([], { kind: "needs-you", why: "home", sheet: { kind: "home", ...SEND3 } });
  items = cardSaw(items, card(items), { kind: "ended", went: true, movementId: "mv-1" });
  const kept = keptItems([...items, { kind: "needs-you", sheet: { kind: "memory", memory: "fact", text: "x" } }]);
  assert.deepEqual(kept[0], { kind: "old-sheet", line: "Send $3.00 to kim.near.", was: { went: true, closed: false, told: false, movementId: "mv-1" } });
  assert.deepEqual(kept[1], { kind: "say", line: OLD_SHEET_LINE });
  assert.doesNotMatch(OLD_SHEET_LINE, /nothing moved/i);
  assert.deepEqual(readChat(chatJson({ items: [{ kind: "you", text: "hi" }, ...items], history: [] }))!.items[1], kept[0]);
});

test("\"move everything\" asks Home's Move for all of it (all: true)", () => {
  const all = moveSheet({ from: "sol", to: "safe", all: true }, "move everything from my SOL wallet to my Safe") as HomeSheet;
  assert.deepEqual(all.ask, { kind: "move", from: "sol", to: "safe", all: true });
  // control: an amount is not all
  assert.equal((moveSheet({ from: "sol", to: "safe", usd: 5 }, "move $5 from my SOL wallet to my Safe") as HomeSheet & { ask: { all?: true } }).ask.all, undefined);
});
