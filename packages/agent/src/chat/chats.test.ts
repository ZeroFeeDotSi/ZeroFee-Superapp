// AgentZero's saved chats (chats.ts): save and reload, each chat its own context, delete, newest first, titles, no key
// ever kept, an old sheet never tapped through later, the store's size held. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { CHATS_KEY, CHAT_STORE_MAX, KEY_REMOVED, OLD_SHEET_LINE, chatJson, chatKey, chatStore, chatTitle, readChats } from "./chats.ts";
import { MEMORY_KEY, memoryStore } from "../zero/memory.ts";
import type { ChatItem } from "./use-chat-turn.ts";
import type { ChatMessage } from "./turn.ts";

/** The agent app's device.store on a Map (what the phone keeps across a reload). */
function phone() {
  const kept = new Map<string, string>();
  const bridge = {
    async call(method: string, p: { key: string; value?: string | null }) {
      if (method === "device.store.get") return { ok: { value: kept.get(p.key) ?? null } };
      if (method === "device.store.set") {
        if (p.value === null) kept.delete(p.key);
        else kept.set(p.key, String(p.value));
        return { ok: { ok: true } };
      }
      return { problem: { code: "unknown" } };
    },
  } as unknown as Bridge;
  return { kept, bridge };
}
const you = (text: string): ChatItem => ({ kind: "you", text });
const agent = (text: string): ChatItem => ({ kind: "agent", text });
const turn = (q: string, a: string): ChatMessage[] => [{ role: "user", content: q }, { role: "assistant", content: [{ type: "text", text: a }] }] as ChatMessage[];

test("a chat is saved, and comes back whole after a reload (control: a chat with none of the person's words isn't listed)", async () => {
  const p = phone();
  let t = 1000;
  await chatStore(p.bridge, () => t).save("c-a", { items: [you("What did I spend this week?"), agent("You spent $12.")], history: turn("What did I spend this week?", "You spent $12.") });
  // a reload: a new store on the same phone
  const again = chatStore(p.bridge, () => t);
  assert.deepEqual(await again.list(), [{ id: "c-a", title: "What did I spend this week?", atMs: 1000 }]);
  const c = await again.load("c-a");
  assert.deepEqual(c?.items, [you("What did I spend this week?"), agent("You spent $12.")]);
  assert.deepEqual(c?.history, turn("What did I spend this week?", "You spent $12."));
  // control: an empty new chat is not a chat yet
  t = 2000;
  assert.equal((await again.save("c-empty", { items: [{ kind: "note", line: "Claude is ready." }], history: [] })).length, 1);
  assert.equal(p.kept.has(chatKey("c-empty")), false);
});

test("each chat keeps its own context; memory is shared and never stored in a chat (control: the other chat's words aren't there)", async () => {
  const p = phone();
  let t = 1;
  const s = chatStore(p.bridge, () => t++);
  await s.save("c-one", { items: [you("Pay kim.near $5")], history: turn("Pay kim.near $5", "Review it below.") });
  await s.save("c-two", { items: [you("Copy a wallet on pump.fun")], history: turn("Copy a wallet on pump.fun", "Paste the wallet.") });
  await memoryStore(p.bridge).keep("payee", "kim.near is my sister");
  const one = await s.load("c-one"), two = await s.load("c-two");
  assert.equal(JSON.stringify(one).includes("pump.fun"), false, "chat one never carries chat two's thread");
  assert.equal(JSON.stringify(two).includes("kim.near"), false, "chat two never carries chat one's thread");
  assert.ok(JSON.stringify(one).includes("kim.near"), "control: chat one has its own");
  // newest first
  assert.deepEqual((await s.list()).map((c) => c.id), ["c-two", "c-one"]);
  // memory: one list for every chat, in its own place
  assert.equal((await memoryStore(p.bridge).list()).length, 1);
  assert.ok(p.kept.has(MEMORY_KEY));
  for (const k of [chatKey("c-one"), chatKey("c-two"), CHATS_KEY]) assert.equal(p.kept.get(k)!.includes("my sister"), false, k);
  // opened again and saved: it goes back to the top
  await s.save("c-one", { items: [you("Pay kim.near $5"), agent("Done.")], history: turn("Pay kim.near $5", "Done.") });
  assert.deepEqual((await s.list()).map((c) => c.id), ["c-one", "c-two"]);
});

test("a chat is deleted from the phone (control: the other chat stays)", async () => {
  const p = phone();
  const s = chatStore(p.bridge);
  await s.save("c-one", { items: [you("one")], history: [] });
  await s.save("c-two", { items: [you("two")], history: [] });
  assert.deepEqual((await s.remove("c-one")).map((c) => c.id), ["c-two"]);
  assert.equal(p.kept.has(chatKey("c-one")), false);
  assert.equal(await s.load("c-one"), null);
  assert.ok(await s.load("c-two"), "control");
  assert.deepEqual(readChats(p.kept.get(CHATS_KEY)!).map((c) => c.id), ["c-two"]);
});

test("no AI key is ever kept in a chat (control: the words around it are kept)", async () => {
  const p = phone();
  const key = `sk-ant-api03-${"A1b2C3d4".repeat(6)}`;
  await chatStore(p.bridge).save("c-k", { items: [you(`my key is ${key} ok`)], history: [{ role: "user", content: `my key is ${key} ok` }] as ChatMessage[] });
  const all = [...p.kept.values()].join("\n");
  assert.equal(all.includes(key.slice(0, 20)), false);
  assert.ok(all.includes(`my key is ${KEY_REMOVED} ok`), "control");
  assert.equal(chatTitle([you(`${key} what now`)]), `${KEY_REMOVED} what now`);
});

test("a sheet from before is a plain line, never tapped through later; the key card isn't kept (control: words are)", () => {
  const items: ChatItem[] = [you("Keep $50 ready in your SOL wallet"), { kind: "needs-you", sheet: { kind: "job", terms: { kind: "keep", keepUsd: 50, perDayUsd: 50 } } as never }, { kind: "needs-key", why: "off" } as ChatItem];
  const kept = JSON.parse(chatJson({ items, history: [] })).items;
  assert.deepEqual(kept, [you("Keep $50 ready in your SOL wallet"), { kind: "say", line: OLD_SHEET_LINE }]);
});

test("titles are the first words, cut at a word; a long chat is brought under the store's size, oldest first (control: a small one is whole)", () => {
  assert.equal(chatTitle([you("What did I spend this week?")]), "What did I spend this week?");
  assert.equal(chatTitle([you("Please copy the wallet that bought the most BONK this week on pump.fun")]), "Please copy the wallet that bought the…");
  assert.equal(chatTitle([]), "New chat");
  const big = "x".repeat(9_000);
  const items: ChatItem[] = Array.from({ length: 60 }, (_, i) => (i % 2 ? agent(`${i} ${big}`) : you(`${i} ${big}`)));
  const history = Array.from({ length: 30 }, (_, i) => turn(`${i * 2} ${big}`, `${i * 2 + 1} ${big}`)).flat();
  const json = chatJson({ items, history });
  assert.ok(json.length <= CHAT_STORE_MAX, String(json.length));
  const back = JSON.parse(json) as { items: ChatItem[]; history: ChatMessage[] };
  assert.ok(back.items.length < items.length && back.items.at(-1)!.kind === "agent" && (back.items.at(-1) as { text: string }).text.startsWith("59 "), "the newest stays");
  assert.ok(back.history.length && back.history[0]!.role === "user", "a whole turn first");
  const small = chatJson({ items: items.slice(0, 2), history: history.slice(0, 2) });
  assert.equal(JSON.parse(small).items.length, 2, "control");
});
