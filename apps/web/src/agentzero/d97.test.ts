// D97 (QA, L2): the person's OWN Claude key goes from this device straight to api.anthropic.com and never to ZeroFee's
// relay; ZeroFee's free reading goes through the relay. Driven as the app drives it (useChatTurn passes neither `fetch`
// nor `anthropicFetch`: both are the page's own fetch), with that fetch replaced by one that records every host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, type ChatEvent } from "@zerofee/agent/chat/turn";

const OWN = "sk-ant-own-test-key-3333333333333333";
const RELAY = "https://relay.zerofee.test";
const sse = (text: string) => {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return ev("message_start", { message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) +
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) + ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
};

/** One turn with the page's fetch recording hosts; every host answers a short stream. */
async function hostsOf(ownKey: string | null, status = 200): Promise<{ hosts: string[]; events: ChatEvent[] }> {
  const hosts: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    hosts.push(new URL(String(input instanceof Request ? input.url : input)).host);
    if (status !== 200) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "no" } }), { status, headers: { "content-type": "application/json" } });
    return new Response(sse("Hi."), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const events: ChatEvent[] = [];
  try {
    for await (const e of chatTurn([], "hello", { relayBase: RELAY, ownKey, token: "t", hands: { receipts: async () => "", meter: async () => "" } })) events.push(e);
  } finally {
    globalThis.fetch = real;
  }
  return { hosts, events };
}

/** The rule itself: with the person's own key, every request went to Anthropic and none to the relay. */
const ownKeyWentDirect = (hosts: string[]) => hosts.length > 0 && hosts.every((h) => h === "api.anthropic.com");

test("D97: the person's own key goes straight to api.anthropic.com, never to ZeroFee's relay", async () => {
  const { hosts, events } = await hostsOf(OWN);
  assert.ok(ownKeyWentDirect(hosts), `hosts: ${hosts.join(", ")}`);
  assert.equal(events.at(-1)?.kind, "done");
});

test("D97 control: ZeroFee's free reading goes through the relay; the rule fails on any relay host", async () => {
  const { hosts } = await hostsOf(null);
  assert.ok(hosts.includes(new URL(RELAY).host), `hosts: ${hosts.join(", ")}`);
  assert.ok(!hosts.includes("api.anthropic.com"));
  // the rule must be able to fail: an own-key turn routed through the relay is caught
  assert.equal(ownKeyWentDirect(hosts), false);
  assert.equal(ownKeyWentDirect(["api.anthropic.com", new URL(RELAY).host]), false);
});

test("D97: when Anthropic refuses the own key (401) or fails (500), nothing falls back to the relay", async () => {
  for (const status of [401, 500]) {
    const { hosts, events } = await hostsOf(OWN, status);
    assert.ok(ownKeyWentDirect(hosts), `${status}: hosts ${hosts.join(", ")}`);
    assert.ok(events.some((e) => e.kind === "fault"), `${status}: said as a fault`);
  }
});
