// The person's choice of Claude (model.ts, product decision, 3 Nov): only Opus 5.5 and Sonnet 5.5, Low · Medium · High; anything else
// is the default; the request carries the choice (own key and relay); it survives a reload; the key is never kept with it.
// Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { DEFAULT_CHOICE, DEFAULT_EFFORT, MODEL_KEY, MODEL_PRICE, TYPICAL_MESSAGE, aboutLine, claudeChoice, messageUsd, modelStore } from "./model.ts";
import { chatRequest, chatTurn, relayChoice, type ChatEvent, type ChatOptions } from "./turn.ts";

const OWN = "sk-ant-own-test-key-3333333333333333";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const textSse = (model: string, text: string) =>
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }) +
  ev("message_stop", {});

/** Records every request body; answers a short streamed reply. */
function recorder() {
  const bodies: any[] = [];
  const urls: string[] = [];
  const f = (async (input: any, init: any = {}) => {
    urls.push(String(input instanceof Request ? input.url : input));
    bodies.push(init.body ? JSON.parse(init.body) : null);
    return new Response(textSse("claude-opus-5-5", "Hi."), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { f, bodies, urls };
}
const hands = { receipts: async () => "none", meter: async () => "$20.00 of $20.00 left today." };
async function run(o: Partial<ChatOptions>) {
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], "hello", { relayBase: null, hands, ...o })) out.push(e);
  return out;
}

/** The phone's two stores on Maps: device.store (kept across a reload) and device.secret (the key's own). */
function phone(kept = new Map<string, string>(), secrets = new Map<string, string>()) {
  const calls: string[] = [];
  const bridge = {
    async call(method: string, p: { key: string; value?: string | null }) {
      calls.push(method);
      const m = method.startsWith("device.secret.") ? secrets : kept;
      if (method.endsWith(".get")) return { ok: { value: m.get(p.key) ?? null } };
      if (method.endsWith(".set")) return m.set(p.key, String(p.value)), { ok: { ok: true } };
      return { problem: { code: "unknown" } };
    },
  } as unknown as Bridge;
  return { kept, secrets, calls, bridge };
}

test("the allow-list: Opus 5.5 or Sonnet 5.5 at low, medium or high pass; any other id or effort falls back (control: every allowed pair passes unchanged)", () => {
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"] as const) for (const effort of ["low", "medium", "high"] as const) assert.deepEqual(claudeChoice({ model, effort }), { model, effort });
  // D158: Sonnet 5.5 at its own default effort (control: Opus 5.5 is still on the list, at its own default)
  assert.deepEqual(DEFAULT_CHOICE, { model: "claude-sonnet-5-5", effort: DEFAULT_EFFORT["claude-sonnet-5-5"] });
  assert.deepEqual(DEFAULT_CHOICE, { model: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(claudeChoice({ model: "claude-opus-5-5" }), { model: "claude-opus-5-5", effort: "medium" });
  // an unknown model: the whole default (never the unknown id, whatever its effort)
  for (const model of ["claude-fable-5-1", "claude-haiku-5-5", "claude-opus-5-5-20260401", "CLAUDE-OPUS-5-5", "", 5, null, undefined, { toString: () => "claude-opus-5-5" }]) assert.deepEqual(claudeChoice({ model, effort: "high" }), DEFAULT_CHOICE, String(model));
  // an effort off the meter: that model's own default
  for (const effort of ["max", "xhigh", "HIGH", "", 2, null]) {
    assert.deepEqual(claudeChoice({ model: "claude-sonnet-5-5", effort }), { model: "claude-sonnet-5-5", effort: "high" });
    assert.deepEqual(claudeChoice({ model: "claude-opus-5-5", effort }), { model: "claude-opus-5-5", effort: "medium" });
  }
  assert.deepEqual(DEFAULT_EFFORT, { "claude-opus-5-5": "medium", "claude-sonnet-5-5": "high" });
  for (const junk of [null, undefined, "claude-sonnet-5-5", [], 7]) assert.deepEqual(claudeChoice(junk), DEFAULT_CHOICE);
});

test("own key: the request carries the chosen model and effort; an id off the list sends the default (control: no choice is Sonnet 5.5 at high, D158)", async () => {
  const a = recorder();
  await run({ ownKey: OWN, anthropicFetch: a.f, model: "claude-sonnet-5-5", effort: "low" });
  assert.match(a.urls[0]!, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.deepEqual([a.bodies[0].model, a.bodies[0].output_config.effort, a.bodies[0].thinking.type], ["claude-sonnet-5-5", "low", "adaptive"]);
  assert.equal("budget_tokens" in a.bodies[0].thinking, false, "no thinking budget: effort is the only control");
  const b = recorder();
  await run({ ownKey: OWN, anthropicFetch: b.f, model: "claude-opus-5-5", effort: "high" });
  assert.deepEqual([b.bodies[0].model, b.bodies[0].output_config.effort], ["claude-opus-5-5", "high"]);
  // off the list: never passed on
  const c = recorder();
  await run({ ownKey: OWN, anthropicFetch: c.f, model: "claude-fable-5-1", effort: "max" });
  assert.deepEqual([c.bodies[0].model, c.bodies[0].output_config.effort], ["claude-sonnet-5-5", "high"]);
  // control: nothing chosen
  const d = recorder();
  await run({ ownKey: OWN, anthropicFetch: d.f });
  assert.deepEqual([d.bodies[0].model, d.bodies[0].output_config.effort], ["claude-sonnet-5-5", "high"]);
  assert.deepEqual([chatRequest([], new Date()).model, chatRequest([], new Date()).output_config.effort], ["claude-sonnet-5-5", "high"]);
});

test("free reading: the relay's body carries a chosen Sonnet and its effort; the default sends neither, so a relay from before reads it as ever (control)", async () => {
  const a = recorder();
  await run({ relayBase: "https://relay.test", token: "az1.x", fetch: a.f, model: "claude-sonnet-5-5", effort: "medium" });
  assert.equal(a.urls[0], "https://relay.test/v0/agentzero/chat");
  assert.deepEqual([a.bodies[0].model, a.bodies[0].effort], ["claude-sonnet-5-5", "medium"]);
  const b = recorder();
  await run({ relayBase: "https://relay.test", token: "az1.x", fetch: b.f, model: "claude-opus-5-5", effort: "low" });
  assert.deepEqual([b.bodies[0].model, b.bodies[0].effort], ["claude-opus-5-5", "low"]);
  // control: the default (or anything off the list) adds no field
  for (const o of [{}, { model: "claude-sonnet-5-5", effort: "high" }, { model: "gpt-5", effort: "high" }]) {
    const c = recorder();
    await run({ relayBase: "https://relay.test", token: "az1.x", fetch: c.f, ...o });
    assert.deepEqual(Object.keys(c.bodies[0]).sort(), ["messages", "today"], JSON.stringify(o));
  }
  assert.deepEqual(relayChoice(DEFAULT_CHOICE), {});
});

test("the choice survives a reload; a broken or foreign saved value reads as the default (control: a fresh phone reads the default)", async () => {
  const p = phone();
  assert.equal(modelStore(p.bridge).known(), undefined);
  assert.deepEqual(await modelStore(p.bridge).get(), DEFAULT_CHOICE, "control: nothing saved");
  const q = phone();
  await modelStore(q.bridge).set({ model: "claude-sonnet-5-5", effort: "low" });
  assert.deepEqual(modelStore(q.bridge).known(), { model: "claude-sonnet-5-5", effort: "low" }, "a send reads it without waiting");
  // a reload: a new bridge over the same kept store
  const again = phone(q.kept);
  assert.equal(modelStore(again.bridge).known(), undefined);
  assert.deepEqual(await modelStore(again.bridge).get(), { model: "claude-sonnet-5-5", effort: "low" });
  for (const bad of ["{not json", JSON.stringify({ model: "claude-haiku-5-5", effort: "low" }), JSON.stringify("claude-sonnet-5-5")]) {
    const r = phone(new Map([[MODEL_KEY, bad]]));
    assert.deepEqual(await modelStore(r.bridge).get(), DEFAULT_CHOICE, bad);
  }
  // set() checks too: an id off the list is never written
  const s = phone();
  await modelStore(s.bridge).set({ model: "claude-fable-5-1", effort: "max" } as never);
  assert.deepEqual(JSON.parse(s.kept.get(MODEL_KEY)!), DEFAULT_CHOICE);
});

test("the key is never kept with the choice: the setting is device.store's own entry of two fields (control: the key sits in device.secret)", async () => {
  const p = phone(new Map(), new Map([["agentzero.claude-key", OWN]]));
  await modelStore(p.bridge).set({ model: "claude-sonnet-5-5", effort: "high" });
  await modelStore(phone(p.kept, p.secrets).bridge).get();
  assert.deepEqual([...p.kept.keys()], [MODEL_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(p.kept.get(MODEL_KEY)!)).sort(), ["effort", "model"]);
  for (const v of p.kept.values()) assert.equal(/sk-ant-/.test(v), false);
  assert.equal(p.calls.some((m) => m.startsWith("device.secret.")), false, "the store never touches the key's store");
  assert.equal(p.secrets.get("agentzero.claude-key"), OWN, "control: the key is where it was");
});

test("a message's rough cost, from the measured message (7,300 in, 170 out) and Anthropic's prices: Sonnet is half Opus (control: the arithmetic by hand)", () => {
  assert.deepEqual(TYPICAL_MESSAGE, { input: 7_300, output: 170, cachedIn: 0 });
  assert.equal(messageUsd("claude-opus-5-5"), (7_300 * 4 + 170 * 20) / 1e6);
  assert.equal(messageUsd("claude-sonnet-5-5"), messageUsd("claude-opus-5-5") / 2);
  assert.equal(messageUsd("claude-opus-5-5", { input: 7_300, output: 170, cachedIn: 7_000 }), (300 * 4 + 7_000 * 0.2 + 170 * 20) / 1e6);
  assert.deepEqual(MODEL_PRICE["claude-sonnet-5-5"], { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
  assert.equal(aboutLine(messageUsd("claude-opus-5-5")), "About 3½¢ a message.");
  assert.equal(aboutLine(messageUsd("claude-sonnet-5-5")), "About 1½¢ a message.");
  assert.equal(aboutLine(0.03), "About 3¢ a message.");
  assert.equal(aboutLine(0.0098), "About 1¢ a message.");
  assert.equal(aboutLine(0.0049), "About ½¢ a message.");
  assert.equal(aboutLine(0.0001), "About ½¢ a message.", "never \"About 0¢\"");
});
