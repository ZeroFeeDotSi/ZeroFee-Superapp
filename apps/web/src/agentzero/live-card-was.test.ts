// b18 (4a): an old browse card after a reload says what became of its run (from its Activity row), never Start again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardKey, cardWas, keepCardRun } from "./live-card-was.ts";
import { CLOSED_LINE } from "@zerofee/browser/agent/live";

const kv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("a card keeps only its row's id, under a hash of its task and site", () => {
  const s = kv();
  const key = cardKey("Find the price of the Blue mug on mugs.example.com", "https://mugs.example.com/");
  keepCardRun(key, 1700000000000, s);
  assert.equal(s.getItem(key), "az-browser-1700000000000");
  assert.ok(![...s.m.keys(), ...s.m.values()].some((x) => x.includes("mug")), "never the task's words");
  assert.notEqual(cardKey("a", "https://x.com/"), cardKey("b", "https://x.com/"));
  assert.notEqual(cardKey("a", "https://x.com/", "m1:1"), cardKey("a", "https://x.com/", "m2:1"), "two cards with the same words are two cards");
});

test("after a reload: done says the report and Took N s.; stopped says its line; a row cut off says ZeroFee closed", () => {
  const s = kv();
  const key = cardKey("t", "https://x.com/");
  keepCardRun(key, 1000, s);
  const done = cardWas(key, [{ id: "az-browser-1000", state: "done", startedAt: 1000, endedAt: 9000, detail: "AgentZero is done on x.com. Blue mug costs $12.00." }], s);
  assert.deepEqual(done, { line: "AgentZero is done on x.com. Blue mug costs $12.00.", chip: "Done", took: "Took 8 s." });
  assert.deepEqual(cardWas(key, [{ id: "az-browser-1000", state: "stopped", startedAt: 1000, endedAt: 2000, detail: "Stopped. Nothing was sent." }], s), { line: "Stopped. Nothing was sent.", chip: "Stopped", took: null });
  assert.deepEqual(cardWas(key, [{ id: "az-browser-1000", state: "pending", startedAt: 1000 }], s), { line: CLOSED_LINE, chip: "Stopped", took: null });
  assert.equal(cardWas(key, [], s), null, "its row is gone: a new card");
  assert.equal(cardWas(cardKey("other", null), [{ id: "az-browser-1000", state: "done", startedAt: 1, endedAt: 2 }], s), null, "another card's row is not this card's");
});

test("b18: the Sim's chat answers a task on a made-up site with the browse card; any other site keeps its line", async () => {
  const { simBrowse, simBrowseLine } = await import("./sim-chat.ts");
  const parts = simBrowse("Find the price of the Blue mug on mugs.example.com")!;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1], { type: "needs", why: "browse", sheet: { kind: "browse", task: "Find the price of the Blue mug on mugs.example.com", url: "https://mugs.example.com/" } });
  assert.equal(simBrowseLine("mugs.example.com"), "I can open mugs.example.com for you. It's a made-up site in the Sim. Tap Start to watch.");
  assert.equal(simBrowse("Find the price of shoes on shop.com"), null);
  assert.equal(simBrowse("Buy the blue mug on mugs.example.com"), null, "a money ask is never a browse");
});
