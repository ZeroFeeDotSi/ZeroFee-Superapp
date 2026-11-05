// A small Nostr relay for ZeroFee Chat's tests on this computer (D55): NIP-01's EVENT, REQ and CLOSE over a plain
// WebSocket, events kept in memory, every event checked (id and signature, core nostr.ts) before it is kept or passed
// on. No dependency: the WebSocket framing (RFC 6455, text frames) is written here. Never for anything but 127.0.0.1.
//
//   node tools/chat/relay.ts [port]          listens on ws://127.0.0.1:<port> (default 7777) until stopped
//
// Two web pages with ?chatrelay=ws://127.0.0.1:7777 talk through it (packages/chat relays.ts localRelay).
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { verifyEvent, type NostrEvent } from "../../packages/core/src/nostr.ts";

interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function matches(e: NostrEvent, f: Filter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith("#") || !Array.isArray(v)) continue;
    const name = k.slice(1);
    if (!e.tags.some((t) => t[0] === name && v.includes(t[1]!))) return false;
  }
  return true;
}

/** One client: frames in, frames out (text only; ping answered; close closed). */
class Client {
  private buf = Buffer.alloc(0);
  private parts: Buffer[] = [];
  subs = new Map<string, Filter[]>();
  private readonly socket: Duplex;
  private readonly onText: (c: Client, text: string) => void;
  constructor(socket: Duplex, onText: (c: Client, text: string) => void, onGone: (c: Client) => void) {
    this.socket = socket;
    this.onText = onText;
    socket.on("data", (d: Buffer) => this.read(d));
    socket.on("close", () => onGone(this));
    socket.on("error", () => this.socket.destroy());
  }
  send(value: unknown): void {
    const body = Buffer.from(JSON.stringify(value));
    const head = body.length < 126 ? Buffer.from([0x81, body.length]) : body.length < 65536 ? Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(body.length)); return b; })()]);
    if (!this.socket.destroyed) this.socket.write(Buffer.concat([head, body]));
  }
  close(): void {
    if (!this.socket.destroyed) this.socket.end(Buffer.from([0x88, 0]));
  }
  private read(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = (this.buf[0]! & 0x80) !== 0;
      const op = this.buf[0]! & 0x0f;
      const masked = (this.buf[1]! & 0x80) !== 0;
      let len = this.buf[1]! & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        at = 10;
      }
      if (len > 1024 * 1024) return this.close();
      const need = at + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      const mask = masked ? this.buf.subarray(at, at + 4) : null;
      const payload = Buffer.from(this.buf.subarray(at + (masked ? 4 : 0), need));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
      this.buf = this.buf.subarray(need);
      if (op === 0x8) return this.close();
      if (op === 0x9) {
        if (!this.socket.destroyed) this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (op === 0x1 || op === 0x0) {
        this.parts.push(payload);
        if (fin) {
          const text = Buffer.concat(this.parts).toString("utf8");
          this.parts = [];
          this.onText(this, text);
        }
      }
    }
  }
}

export interface LocalRelay {
  url: string;
  port: number;
  /** Every event it kept, oldest first. */
  events: NostrEvent[];
  close(): Promise<void>;
}

/** Starts the relay on 127.0.0.1 (`port` 0: any free port). */
export function startRelay(port = 7777): Promise<LocalRelay> {
  const events: NostrEvent[] = [];
  const clients = new Set<Client>();
  const onText = (c: Client, text: string) => {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return c.send(["NOTICE", "not JSON"]);
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === "EVENT") {
      const e = msg[1] as NostrEvent;
      if (!verifyEvent(e)) return c.send(["OK", (e as { id?: string })?.id ?? "", false, "invalid: id or signature"]);
      if (!events.some((x) => x.id === e.id)) {
        events.push(e);
        for (const other of clients) for (const [id, filters] of other.subs) if (filters.some((f) => matches(e, f))) other.send(["EVENT", id, e]);
      }
      return c.send(["OK", e.id, true, ""]);
    }
    if (msg[0] === "REQ" && typeof msg[1] === "string") {
      const filters = msg.slice(2) as Filter[];
      c.subs.set(msg[1], filters);
      for (const f of filters) {
        const hit = events.filter((e) => matches(e, f));
        for (const e of hit.slice(-(f.limit ?? 500))) c.send(["EVENT", msg[1], e]);
      }
      return c.send(["EOSE", msg[1]]);
    }
    if (msg[0] === "CLOSE" && typeof msg[1] === "string") c.subs.delete(msg[1]);
  };
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ZeroFee Chat's local Nostr relay (tests only)\n");
  });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") return socket.destroy();
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const c = new Client(socket, onText, (gone) => clients.delete(gone));
    clients.add(c);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const p = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `ws://127.0.0.1:${p}`,
        port: p,
        events,
        close: () => new Promise((done) => {
          for (const c of clients) c.close();
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const relay = await startRelay(Number(process.argv[2] ?? 7777));
  console.log(`ZeroFee Chat test relay on ${relay.url}`);
}
