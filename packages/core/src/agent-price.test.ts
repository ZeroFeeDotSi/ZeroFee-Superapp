// D152's one price table (agent-price.ts): the phone pays by it, the chat's picker shows it, and the relay's own copy
// (apps/quotes/agentzero.mjs PRICES, costMicros) must say exactly the same for every reply. Control: a table that drifts
// by a cent of a million tokens, or a rounding that differs, goes red here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLY_MAX_OUTPUT, REPLY_PRICES, replyCost, replyMicros } from "./agent-price.ts";
import { MODEL_PRICE } from "../../agent/src/chat/model.ts";
// @ts-ignore: plain JS, deployed as is
import { PRICES, costMicros } from "../../../apps/quotes/agentzero.mjs";
// @ts-ignore: plain JS, deployed as is
import { CHAT_MAX_TOKENS } from "../../../apps/quotes/agentzero-chat.mjs";

test("the most output a reply can have is the relay's own max_tokens (SR3 M6)", () => {
  assert.equal(REPLY_MAX_OUTPUT, CHAT_MAX_TOKENS);
});

test("one table: the relay's PRICES and the chat's MODEL_PRICE are the phone's REPLY_PRICES, model for model", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PRICES)), JSON.parse(JSON.stringify(REPLY_PRICES)));
  assert.equal(MODEL_PRICE, REPLY_PRICES);
});

test("the phone's cost is the relay's cost for every reply shape (rounded up once, on the sum)", () => {
  const shapes = [
    { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { input_tokens: 7300, output_tokens: 170, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 12_345, cache_creation_input_tokens: 777 },
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 },
    { input_tokens: 18_000, output_tokens: 4000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 9_000 },
  ];
  for (const model of Object.keys(REPLY_PRICES)) for (const u of shapes) assert.equal(replyMicros(u, model), costMicros(u, PRICES[model]), `${model} ${JSON.stringify(u)}`);
  assert.equal(replyMicros(shapes[0], "gpt-5"), null);
  assert.equal(replyMicros({ ...shapes[0], output_tokens: -1 }, "claude-opus-5-5"), null);
});

test("a reply's cost on screen: plain, to the hundredth of a cent under 10 cents, never $0.00 for something paid", () => {
  assert.equal(replyCost(12_300), "$0.0123");
  assert.equal(replyCost(1), "under $0.0001");
  assert.equal(replyCost(100), "$0.0001");
  assert.equal(replyCost(150_000), "$0.15");
});
