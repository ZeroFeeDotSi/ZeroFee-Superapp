// QA (L2): people never burn credits: Stop ends the stream. After Stop no more of the answer is read. The fake
// Anthropic stream gives one piece per read and counts the reads; the control (a Stop that only hides, as L2 was
// before, still reading the turn to its end) keeps reading and is caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn } from "@zerofee/agent/chat/turn";

const OWN = "sk-ant-own-test-key-4444444444444444";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const head = ev("message_start", { message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
const PIECES = 40;

/** Anthropic, one piece per read, counting the reads; `cancelled` when the reader let go. */
function slowAnthropic() {
  const seen = { reads: 0, cancelled: false, signal: null as AbortSignal | null };
  const f = (async (_input: unknown, init: { signal?: AbortSignal } = {}) => {
    seen.signal = init.signal ?? null;
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(head)); },
      async pull(c) {
        if (init.signal?.aborted) return c.error(new DOMException("aborted", "AbortError"));
        seen.reads += 1;
        await new Promise((r) => setTimeout(r, 2));
        if (i < PIECES) c.enqueue(enc.encode(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: `w${i++} ` } })));
        else { c.enqueue(enc.encode(ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: PIECES } }) + ev("message_stop", {}))); c.close(); }
      },
      cancel() { seen.cancelled = true; },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

const hands = { receipts: async () => "", meter: async () => "" };

async function turnStoppedAfter(texts: number, honourStop: boolean) {
  const a = slowAnthropic();
  const ac = new AbortController();
  let got = 0;
  let readsAtStop = -1;
  for await (const e of chatTurn([], "hello", { relayBase: null, ownKey: OWN, anthropicFetch: a.f, hands, ...(honourStop ? { signal: ac.signal } : {}) })) {
    if (e.kind === "text" && ++got === texts) {
      ac.abort();
      readsAtStop = a.seen.reads;
      if (honourStop) continue; // the turn ends by itself on the abort
    }
  }
  await new Promise((r) => setTimeout(r, 50));
  return { after: a.seen.reads - readsAtStop, seen: a.seen };
}

test("Stop: after Stop no more of the answer is read (the stream is let go)", async () => {
  const { after, seen } = await turnStoppedAfter(3, true);
  assert.ok(after <= 1, `reads after Stop: ${after}`);
  assert.equal(seen.signal?.aborted, true, "the request itself was aborted (let go), not only left unread");
});

test("Stop control: a Stop that only hides the answer keeps reading it to the end, and is caught", async () => {
  const { after, seen } = await turnStoppedAfter(3, false);
  assert.ok(after > 10, `the control kept reading (${after} reads after Stop)`);
  assert.notEqual(seen.signal?.aborted, true, "the control's request was never aborted");
});
