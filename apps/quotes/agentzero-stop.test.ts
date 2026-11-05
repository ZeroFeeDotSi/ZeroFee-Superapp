// A paid AgentZero reply that stops mid-thinking is charged what was really used, never the whole output allowance
// (product decision, 5 Nov; QA's SHOULD on fix/zero-fee-words). streamTurn with Anthropic's
// stream faked in process; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MAX_TOKENS, streamTurn } from "./agentzero-chat.mjs";

type Ev = Record<string, unknown> & { type: string };
const START: Ev = { type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 1 } } };
const THINK: Ev = { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } };
const said = (thinking: string): Ev => ({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } });

/** One turn: the events stream; with `stopAfter`, the person's Stop (the request aborts) right after that many. */
async function turn(events: Ev[], { stopAfter, final }: { stopAfter?: number; final?: Record<string, number> } = {}) {
  const request = new AbortController();
  const settled: { usage: any; opts: any }[] = [];
  const client = () => ({
    messages: {
      stream: (_u: unknown, { signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < events.length; i++) {
            if (signal.aborted) return;
            yield events[i];
            if (stopAfter !== undefined && i + 1 === stopAfter) request.abort();
          }
        },
        finalMessage: async () => ({ usage: final }),
      }),
    },
  });
  const settle = async (usage: any, opts: any = {}) => { settled.push({ usage, opts }); return { used: 0, extra: 0 }; };
  const body = streamTurn({ request: { signal: request.signal }, stream: (b: ReadableStream) => b, client, upstream: {}, settle, paid: true, price: {}, model: "claude-sonnet-5-5", deadlineMs: 60_000, closing: () => ({}) }) as ReadableStream;
  const reader = body.getReader();
  while (!(await reader.read()).done);
  return settled.filter((s) => s.usage !== null);
}

test("a Stop mid-thinking is charged the measured output, never CHAT_MAX_TOKENS", async () => {
  const s = await turn([START, THINK, said("a".repeat(30)), said("b".repeat(30)), { type: "content_block_stop", index: 0 }], { stopAfter: 4 });
  assert.equal(s.length, 1);
  assert.equal(s[0]!.opts.stopped, true);
  assert.equal(s[0]!.usage.input_tokens, 900, "Anthropic's own input count");
  assert.equal(s[0]!.usage.output_tokens, 20, "60 plain characters streamed: 20 tokens");
  assert.notEqual(s[0]!.usage.output_tokens, CHAT_MAX_TOKENS);
});

test("a Stop after thinking with no words streamed (omitted thinking) is charged the lower bound, not the allowance", async () => {
  const s = await turn([START, THINK, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }, { type: "content_block_stop", index: 0 }], { stopAfter: 3 });
  assert.equal(s[0]!.usage.output_tokens, 0);
});

test("control: Anthropic's own count wins whenever it came, on a Stop and on a whole reply", async () => {
  const delta: Ev = { type: "message_delta", delta: { stop_reason: null }, usage: { output_tokens: 57 } };
  const stopped = await turn([START, THINK, said("a".repeat(30)), delta, said("b".repeat(300))], { stopAfter: 4 });
  assert.equal(stopped[0]!.usage.output_tokens, 57, "the last streamed usage");
  const usage = { input_tokens: 900, output_tokens: 1234, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 };
  const whole = await turn([START, THINK, said("a".repeat(30)), { type: "message_stop" }], { final: usage });
  assert.equal(whole.length, 1);
  assert.deepEqual(whole[0]!.usage, usage, "a stream with usage is charged exactly that");
  assert.notEqual(whole[0]!.opts.stopped, true);
});
