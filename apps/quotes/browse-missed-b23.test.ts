// Builder 23, item 5 (audit 18, Quotes: "the browse route and the miss field live and checked"; audit 17 H8's relay
// follow-up): the browse route's done step carries `missed` when the run found nothing, set by Claude in the schema's
// own field, so the phone's "Didn't finish." needs no word-reading. Only a done step, only a real true. The route's 401
// (no token) and 404 (no such route) stay. Fails on main 5d80fde2e (no missed field, cleanStep drops it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { BROWSE_PROMPT, BROWSE_SCHEMA, cleanStep } from "./agentzero-browse.mjs";
import { AGENT_BROWSE_PROMPT } from "../../packages/agent/src/robot/think-shape.ts";
import { agentRobotService } from "../../packages/agent/src/robot/service.ts";
import type { Bridge } from "../../packages/core/src/bridge.ts";

const APP = "https://app.zerofee.si";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const stepSse = (step: object) =>
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: JSON.stringify(step) } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } }) +
  ev("message_stop", {});

function world(step: object) {
  const fetchFn = async () => new Response(stepSse(step), { headers: { "content-type": "text/event-stream" } });
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: "sk-ant-test-0000000000000000", agentZeroSecret: "token-secret", counter: { ...memoryCounter(), shared: true }, fetchFn });
  const answers: any[] = [];
  const phoneFetch = (async (url: string, init: any) => {
    const r = await relay(new Request(url, { ...init, headers: { ...init.headers, origin: APP } }), "10.0.9.1");
    answers.push(await r.clone().json().catch(() => null));
    return r;
  }) as unknown as typeof fetch;
  return { relay, phoneFetch, answers };
}
const saved: Record<string, unknown> = {};
const bridge: Bridge = {
  call: (async (method: string, p: any = {}) => (method === "device.secret.get" ? { ok: { value: (saved[p.key] as string | undefined) ?? null } } : method === "device.secret.set" ? (void (saved[p.key] = p.value), { ok: {} }) : { problem: { code: "x", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "Close" } } })) as Bridge["call"],
  on: () => () => {},
};
const payer = { account: () => null, bindFor: async () => null, settle: async () => true, owe: () => {}, cost: () => {} };
const page = { host: "news.example", lang: "en", elements: [{ id: "e1", kind: "heading", text: "Top stories" }], more: false };
const input = { partner: "news.example", goal: "Find the weather", guide: [], slots: [], page, history: [], task: "Find the weather on news.example", pageText: "Top stories." };
const next = async (step: object) => {
  const w = world(step);
  const r = await agentRobotService(bridge, { relayBase: "https://relay.test", fetch: w.phoneFetch, pay: () => payer }).call("agent.robot.next", { input, caller: "browser" });
  return { r, body: w.answers.find((a) => a && a.step) };
};

test("a done step that found nothing: the route says missed, and the phone has it without reading words", async () => {
  // words that the phone's MISSED words-rule would NOT catch: only the flag can say it
  const { r, body } = await next({ kind: "done", id: null, value: null, ms: null, text: "No weather here, only news.", missed: true });
  assert.equal(body.step.missed, true);
  assert.deepEqual(r, { ok: { kind: "done", summary: "No weather here, only news.", missed: true } });
});

test("a done step that found it, or any other step, carries no missed", async () => {
  const done = await next({ kind: "done", id: null, value: null, ms: null, text: "It's sunny.", missed: false });
  assert.equal("missed" in done.body.step, false);
  assert.deepEqual(done.r, { ok: { kind: "done", summary: "It's sunny." } });
  assert.equal("missed" in cleanStep({ kind: "click", id: "e1", value: null, ms: null, text: null, missed: true }), false, "only on done");
  assert.equal("missed" in cleanStep({ kind: "done", id: null, value: null, ms: null, text: "x", missed: "yes" }), false, "only a real true");
});

test("Claude is asked for it in the schema's own field; the prompt stays the app's word for word", () => {
  assert.equal(BROWSE_PROMPT, AGENT_BROWSE_PROMPT);
  assert.ok(BROWSE_SCHEMA.required.includes("missed"));
  assert.deepEqual((BROWSE_SCHEMA.properties as any).missed.anyOf, [{ type: "boolean" }, { type: "null" }]);
  assert.match((BROWSE_SCHEMA.properties as any).missed.description, /^Only on done: true when/);
});

test("the route's 401 and 404 stay", async () => {
  const { relay } = world({ kind: "done", id: null, value: null, ms: null, text: "x", missed: true });
  const body = JSON.stringify({ input: { task: "x", site: "news.example", history: [], page: { elements: [] }, words: "" } });
  const noToken = await relay(new Request("https://relay.test/v0/agentzero/browse", { method: "POST", body, headers: { origin: APP, "content-type": "application/json" } }), "10.0.9.2");
  assert.equal(noToken.status, 401);
  const nowhere = await relay(new Request("https://relay.test/v0/agentzero/nowhere", { method: "POST", body, headers: { origin: APP, "content-type": "application/json", authorization: "Bearer az1.x.y" } }), "10.0.9.3");
  assert.equal(nowhere.status, 404);
});
