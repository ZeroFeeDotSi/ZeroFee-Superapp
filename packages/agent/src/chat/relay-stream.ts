// The relay's event stream (text/event-stream) read by hand: no Anthropic SDK, so the public web build carries no
// SDK code (and none of its "x-api-key" / "api.anthropic.com" marks) for the funded-wallet path. It yields the same
// events the SDK's MessageStream yielded for the same bytes, and builds the same final message (relay-stream.test.ts
// holds the two equal at every byte boundary of a recorded stream).
import type Anthropic from "@anthropic-ai/sdk";

type Ev = Anthropic.MessageStreamEvent;

/** What chatTurn reads of a model stream: events as they come, then the whole message. */
export type Stream = AsyncIterable<Ev> & { finalMessage(): Promise<Anthropic.Message>; abort?(): void };

export interface Frame { event: string | undefined; data: string }

/** SSE framing: events end on a blank line; `event:` names one, `data:` lines (joined by a newline) carry it; lines
 *  starting with ":" are comments; CRLF, LF and CR all end a line; a chunk may end anywhere (mid-line, mid-character). */
export class SseParser {
  private buf = "";
  private heldCr = false;
  push(text: string): Frame[] {
    // a CR at the end of a chunk may be half of a CRLF: wait for the next chunk to know
    let s = (this.heldCr ? "\r" : "") + text;
    this.heldCr = s.endsWith("\r");
    if (this.heldCr) s = s.slice(0, -1);
    this.buf += s.replace(/\r\n?/g, "\n");
    const out: Frame[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const f = parseFrame(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 2);
      if (f) out.push(f);
    }
    return out;
  }
  /** The body ended: a last event with no closing blank line is still an event. */
  end(): Frame[] {
    if (this.heldCr) (this.buf += "\n"), (this.heldCr = false);
    const f = parseFrame(this.buf.replace(/\n+$/, ""));
    this.buf = "";
    return f ? [f] : [];
  }
}

function parseFrame(text: string): Frame | null {
  if (!text) return null;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const c = line.indexOf(":");
    const field = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? "" : line.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value.trim();
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

type Block = Record<string, unknown> & { type: string };

/** A tool's input as the stream's JSON pieces spell it (nothing yet: {}). A cut-off piece reads as nothing. */
const inputOf = (buf: string): unknown => {
  if (!buf) return {};
  try {
    return JSON.parse(buf);
  } catch {
    return {};
  }
};
const tracksInput = (b: Block | undefined): b is Block => !!b && (b.type === "tool_use" || b.type === "server_tool_use");

/** The message the events add up to (Anthropic's own rules for it). */
class Message {
  snap: Anthropic.Message | undefined;
  done = false;
  private json = new Map<number, string>();
  add(ev: Ev): void {
    if (ev.type === "message_start") {
      if (this.snap) throw new Error(`Unexpected event order, got ${ev.type} before "message_stop"`);
      this.snap = ev.message;
      return;
    }
    const m = this.snap;
    if (!m) throw new Error(`Unexpected event order, got ${ev.type} before "message_start"`);
    const content = m.content as unknown as Block[];
    switch (ev.type) {
      case "message_stop":
        this.done = true;
        return;
      case "message_delta": {
        const d = ev.delta as unknown as Record<string, unknown>;
        const u = ev.usage as unknown as Record<string, unknown>;
        const mu = m.usage as unknown as Record<string, unknown>;
        const mm = m as unknown as Record<string, unknown>;
        mm.stop_reason = d.stop_reason;
        mm.stop_sequence = d.stop_sequence;
        mm.stop_details = d.stop_details;
        mu.output_tokens = u.output_tokens;
        if (d.container != null) mm.container = d.container;
        // the other counters are whole-message totals, left out when they don't apply: set when present, never added
        for (const k of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "server_tool_use", "output_tokens_details"]) if (u[k] != null) mu[k] = u[k];
        return;
      }
      case "content_block_start":
        content.push({ ...(ev.content_block as unknown as Block) });
        return;
      case "content_block_delta": {
        const b = content.at(ev.index);
        const d = ev.delta as unknown as Record<string, string | undefined> & { citation?: unknown };
        if (d.type === "text_delta" && b?.type === "text") content[ev.index] = { ...b, text: ((b.text as string) || "") + d.text };
        else if (d.type === "citations_delta" && b?.type === "text") content[ev.index] = { ...b, citations: [...((b.citations as unknown[]) ?? []), d.citation] };
        else if (d.type === "input_json_delta" && tracksInput(b)) this.json.set(ev.index, (this.json.get(ev.index) ?? "") + d.partial_json);
        else if (d.type === "thinking_delta" && b?.type === "thinking") content[ev.index] = { ...b, thinking: (b.thinking as string) + d.thinking };
        else if (d.type === "signature_delta" && b?.type === "thinking") content[ev.index] = { ...b, signature: d.signature };
        return;
      }
      case "content_block_stop": {
        const b = content.at(ev.index);
        if (tracksInput(b) && this.json.has(ev.index)) b.input = inputOf(this.json.get(ev.index)!);
        return;
      }
    }
  }
  /** A tool's input still being spelled when the stream ended (never a stop for it): read as far as it goes. */
  finish(): Anthropic.Message {
    const m = this.snap!;
    for (const [i, buf] of this.json) {
      const b = (m.content as unknown as Block[]).at(i);
      if (tracksInput(b)) b.input = inputOf(buf);
    }
    this.json.clear();
    return m;
  }
}

/**
 * The relay's body as a model stream. `aside` gets every event the relay adds of its own (`event: zerofee…`, the
 * meter and the relay's failure line); everything else is a Claude event, in order, as the SDK would have yielded it.
 * Errors thrown here (an `error` event, a line that isn't JSON, a stream that ends with no whole message) reach the
 * caller the way the SDK's did: from the iteration, or from finalMessage().
 */
export function sseStream(body: ReadableStream<Uint8Array>, aside: (event: string, data: string) => void): Stream {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const parser = new SseParser();
  const msg = new Message();
  let aborted = false;
  let started = false;
  let settle!: { ok: (m: Anthropic.Message) => void; fail: (e: unknown) => void };
  const finished = new Promise<Anthropic.Message>((ok, fail) => (settle = { ok, fail }));
  finished.catch(() => undefined); // read by finalMessage(); never an unhandled rejection of its own

  function* take(frames: Frame[]): Generator<Ev> {
    for (const f of frames) {
      if (f.event?.startsWith("zerofee")) {
        aside(f.event, f.data);
        continue;
      }
      const ev = JSON.parse(f.data) as Ev;
      if ((ev as { type?: string }).type === "error") {
        const e = (ev as unknown as { error?: { message?: unknown } }).error;
        throw new Error(typeof e?.message === "string" && e.message ? e.message : "Claude didn't answer.");
      }
      msg.add(ev);
      yield ev;
    }
  }

  async function* events(): AsyncGenerator<Ev, void> {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        yield* take(parser.push(dec.decode(r.value, { stream: true })));
      }
      yield* take(parser.push(dec.decode()));
      yield* take(parser.end());
      if (aborted) throw new Error("Request was aborted.");
      if (!msg.done) throw new Error(msg.snap ? "stream ended without producing a Message with role=assistant" : "request ended without sending any chunks");
      settle.ok(msg.finish());
    } catch (e) {
      settle.fail(e);
      throw e;
    } finally {
      // a consumer that stops early (or an error) lets go of the body: the relay's request is not left open
      settle.fail(new Error("stream stopped before its end")); // no-op when it already ended
      void reader.cancel().catch(() => undefined);
    }
  }

  const it = events();
  return {
    [Symbol.asyncIterator]() {
      if (started) throw new Error("Cannot iterate over a consumed stream.");
      started = true;
      return it;
    },
    async finalMessage() {
      if (!started) {
        started = true;
        for await (const _ of it) void _;
      }
      return finished;
    },
    abort() {
      aborted = true;
      void reader.cancel().catch(() => undefined);
    },
  };
}
