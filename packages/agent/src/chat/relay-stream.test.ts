// The hand-written reader of the relay's stream (relay-stream.ts) against the Anthropic SDK's own MessageStream, on the
// same recorded bytes, with the chunks cut at every byte boundary: same events, same final message, same meter lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { SseParser, sseStream } from "./relay-stream.ts";

const sse = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const ev = (type: string, data: object) => sse(type, { type, ...data });
const usage0 = { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 40 };

/** text (with multi-byte characters), thinking, a tool_use whose input comes in pieces, a ping, usage, the relay's meter. */
const SAMPLE =
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: usage0 } }) +
  ev("ping", {}) +
  ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Let me look. " } }) +
  ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Yes." } }) +
  ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-abc" } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: "Sure — I'll check " } }) +
  ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: "your wallet. 🙂 Café ¥5" } }) +
  ev("content_block_stop", { index: 1 }) +
  ev("content_block_start", { index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "read_meter", input: {} } }) +
  ev("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "" } }) +
  ev("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: '{"place": "ho' } }) +
  ev("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: 'me", "usd": 5.5, "note": "caf\\u00e9 \\"q\\"\\n"}' } }) +
  ev("content_block_stop", { index: 2 }) +
  ev("content_block_start", { index: 3, content_block: { type: "tool_use", id: "toolu_2", name: "service_status", input: {} } }) +
  ev("content_block_stop", { index: 3 }) +
  ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 57, input_tokens: 101, cache_read_input_tokens: 41 } }) +
  ev("message_stop", {}) +
  sse("zerofee", { allowance: { usedUsd: 1.25, limitUsd: 5 }, turnUsd: 0.02 }) +
  sse("zerofee_error", { line: "Claude took too long. Send it again." });

const bytes = (s: string) => new TextEncoder().encode(s);
const body = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(c) { for (const k of chunks) c.enqueue(k); c.close(); } });
const cutAt = (b: Uint8Array, ...at: number[]) => [0, ...at, b.length].slice(0, -1).map((s, i, a) => b.slice(s, [...a, b.length][i + 1])).filter((c) => c.length);

/** The old path: the relay's frames turned into the SDK's JSON lines, read by MessageStream. */
async function viaSdk(chunks: Uint8Array[]) {
  const dec = new TextDecoder();
  let buf = "";
  const aside: [string, string][] = [];
  const lines = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1]?.trim();
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!event || !data) continue;
        if (event.startsWith("zerofee")) aside.push([event, data]);
        else c.enqueue(bytes(`${data}\n`));
      }
    },
  });
  const s = MessageStream.fromReadableStream(body(chunks).pipeThrough(lines));
  const events: unknown[] = [];
  for await (const e of s) events.push(e);
  return { events, final: await s.finalMessage(), aside };
}
async function mine(chunks: Uint8Array[]) {
  const aside: [string, string][] = [];
  const s = sseStream(body(chunks), (e, d) => aside.push([e, d]));
  const events: unknown[] = [];
  for await (const e of s) events.push(e);
  return { events, final: await s.finalMessage(), aside };
}
// the SDK's final message holds a lazy `input`: read it into a plain copy (what chatTurn reads), then compare. The SDK
// also stamps `parsed_output: null` on the message (its structured-output helper); nothing in the chat reads it.
const plain = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "parsed_output" && v === null ? undefined : v)));

test("the recorded stream reads as the SDK reads it: events, final message (text, thinking, tool_use inputs, usage), meter lines", async () => {
  const all = [bytes(SAMPLE)];
  const a = await viaSdk(all);
  const b = await mine(all);
  assert.deepEqual(plain(b.events), plain(a.events));
  assert.deepEqual(plain(b.final), plain(a.final));
  assert.deepEqual(b.aside, a.aside);
  // and the sample really holds what it should
  const f = b.final as any;
  assert.equal(f.stop_reason, "tool_use");
  assert.deepEqual(f.content.map((x: any) => x.type), ["thinking", "text", "tool_use", "tool_use"]);
  assert.equal(f.content[0].thinking, "Let me look. Yes.");
  assert.equal(f.content[0].signature, "sig-abc");
  assert.equal(f.content[1].text, "Sure — I'll check your wallet. 🙂 Café ¥5");
  assert.deepEqual(f.content[2].input, { place: "home", usd: 5.5, note: 'café "q"\n' });
  assert.deepEqual(f.content[3].input, {}, "a tool with no input pieces has {}");
  assert.deepEqual(f.usage, { input_tokens: 101, output_tokens: 57, cache_creation_input_tokens: 0, cache_read_input_tokens: 41 });
  assert.equal(b.aside.length, 2);
  assert.equal(b.events.length, 20, "every Claude event (the ping too, it keeps the wait alive), none of the relay's own");
});

test("the same result for the chunks cut at EVERY byte boundary (UTF-8 characters, \\n\\n, and event lines split mid-way)", async () => {
  const all = bytes(SAMPLE);
  const want = await viaSdk([all]);
  const wantPlain = { events: plain(want.events), final: plain(want.final), aside: want.aside };
  for (let k = 1; k < all.length; k++) {
    const got = await mine(cutAt(all, k));
    assert.deepEqual({ events: plain(got.events), final: plain(got.final), aside: got.aside }, wantPlain, `cut at byte ${k}`);
  }
  // the SDK's own reading of the same bytes is whole at every cut too (the comparison's control)
  for (const k of [1, 7, 333, all.length - 2]) assert.deepEqual(plain((await viaSdk(cutAt(all, k))).final), wantPlain.final);
});

test("one byte at a time", async () => {
  const all = bytes(SAMPLE);
  const want = await viaSdk([all]);
  const got = await mine([...all].map((x) => new Uint8Array([x])));
  assert.deepEqual(plain(got.events), plain(want.events));
  assert.deepEqual(plain(got.final), plain(want.final));
});

test("CRLF lines, comments and a data line without the space read the same (SSE as the standard writes it)", async () => {
  const crlf = SAMPLE.replace(/\n/g, "\r\n").replace(/^event: ping/m, ": a comment\r\nevent: ping").replace(/^data:/gm, "data:").replaceAll("data: {", "data:{");
  const all = bytes(crlf);
  const want = plain((await viaSdk([bytes(SAMPLE)])).final);
  assert.deepEqual(plain((await mine([all])).final), want);
  for (const k of [1, 2, 50, all.length - 1]) assert.deepEqual(plain((await mine(cutAt(all, k))).final), want, `cut at ${k}`);
  // the CR of a CRLF at the end of a chunk
  const at = crlf.indexOf("\r\n\r\n") + 1;
  assert.deepEqual(plain((await mine(cutAt(bytes(crlf), at, at + 1, at + 2))).final), want);
});

test("a last event with no blank line after it is still read", async () => {
  const want = plain((await viaSdk([bytes(SAMPLE)])).final);
  const got = await mine([bytes(SAMPLE.replace(/\n\n$/, ""))]);
  assert.deepEqual(plain(got.final), want);
});

test("text-only answer: the streamed deltas and the final text", async () => {
  const s =
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: usage0 } }) +
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi" } }) +
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: " there" } }) +
    ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) +
    ev("message_stop", {});
  const want = await viaSdk([bytes(s)]);
  for (let k = 1; k < s.length; k += 3) {
    const got = await mine(cutAt(bytes(s), k));
    assert.deepEqual(plain(got.final), plain(want.final));
    assert.equal((got.final as any).content[0].text, "Hi there");
  }
});

test("a failure reaches the caller from the stream, as the SDK's did: an error event, a cut stream, a line that isn't JSON", async () => {
  const head = ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: usage0 } });
  // an error event: its own message, so chatTurn can tell "prompt is too long"
  await assert.rejects(mine([bytes(head + ev("error", { error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens" } }))]), /prompt is too long/);
  await assert.rejects(mine([bytes(head + ev("error", { error: {} }))]), /Claude didn't answer\./);
  // ended before message_stop: no whole message (finalMessage / the iteration says so)
  await assert.rejects(mine([bytes(head)]), /without producing a Message/);
  await assert.rejects(mine([]), /without sending any chunks/);
  await assert.rejects(viaSdk([bytes(head)]), /without producing a Message/);
  // not JSON, and an event before message_start
  await assert.rejects(mine([bytes("event: content_block_stop\ndata: {oops\n\n")]), SyntaxError);
  await assert.rejects(mine([bytes(ev("content_block_stop", { index: 0 }))]), /before "message_start"/);
});

test("finalMessage() alone reads the whole stream; abort() ends a stream that is waiting (a failed read, never a hang)", async () => {
  const s = sseStream(body([bytes(SAMPLE)]), () => undefined);
  assert.equal((await s.finalMessage()).stop_reason, "tool_use");
  let enqueue!: (b: Uint8Array) => void;
  const open = new ReadableStream<Uint8Array>({ start(c) { enqueue = (b) => c.enqueue(b); } });
  const t = sseStream(open, () => undefined);
  const seen: unknown[] = [];
  const reading = (async () => { for await (const e of t) seen.push(e); })();
  enqueue(bytes(SAMPLE.slice(0, SAMPLE.indexOf("event: ping"))));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.length, 1);
  t.abort!();
  await assert.rejects(reading, /aborted/);
  await assert.rejects(t.finalMessage(), /aborted/);
});

test("SseParser: frames, in order, whatever the chunks", () => {
  const p = new SseParser();
  const got = [...p.push("event: a\ndata: 1\n"), ...p.push("\nevent: b\nda"), ...p.push("ta: 2\ndata: 3\n\n: c\n\nevent: c\ndata:4\n\nevent: d")];
  assert.deepEqual(got, [{ event: "a", data: "1" }, { event: "b", data: "2\n3" }, { event: "c", data: "4" }]);
  assert.deepEqual(p.end(), [], "an event with no data is nothing");
});
