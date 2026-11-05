// The tray's MCP server: Streamable HTTP, JSON-RPC 2.0, hand-written (no SDK), plain JSON answers (no SSE). Bound to
// 127.0.0.1 only, and every request is checked again: a peer that isn't this machine is refused (403) even with the
// right bearer; so is a Host that isn't this machine's (DNS rebinding) and any web page's Origin. The bearer token is
// compared in constant time. Only POST /mcp.
// One resource, the meter (zerofee://budget). Plain JSON answers keep no stream open, so the server can't push
// notifications/resources/updated: it says so in initialize (subscribe: false), and a client reads the line again.
import { createServer, type Server } from "node:http";
import { sameHash } from "./store.ts";
import { BUDGET_RESOURCE, BUDGET_URI, TOOLS, type Meter, type ToolResult } from "./tools.ts";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const BODY_MAX = 64 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface HttpIn {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  /** The socket's peer address (never a header). */
  remoteAddress: string | undefined;
  body: string;
}
export interface HttpOut {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Run once the answer has gone out (the stop tool). */
  after?: () => void;
}

export interface McpDeps {
  bearer: string;
  port: number;
  tools: { call(name: string, args: Record<string, unknown>): Promise<ToolResult | null>; meter(): Promise<Meter> };
  /** After the stop tool's answer is sent. */
  onStop: () => void;
  log: (line: string) => void;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): HttpOut => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra }, body: JSON.stringify(body) });
const plain = (status: number, line: string, extra: Record<string, string> = {}): HttpOut => ({ status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra }, body: `${line}\n` });
const rpcError = (id: unknown, code: number, message: string) => json(200, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => json(200, { jsonrpc: "2.0", id, result });

export function createMcpHandler(d: McpDeps) {
  const hosts = new Set([`127.0.0.1:${d.port}`, `localhost:${d.port}`, `[::1]:${d.port}`]);
  const want = `Bearer ${d.bearer}`;

  return async function handle(req: HttpIn): Promise<HttpOut> {
    if (!LOOPBACK.has(req.remoteAddress ?? "")) {
      d.log("tray: refused a peer that isn't this computer");
      return plain(403, "Only this computer can talk to AgentZero.");
    }
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) return plain(403, "Only this computer can talk to AgentZero.");
    if (req.headers.origin !== undefined) return plain(403, "Web pages can't talk to AgentZero.");
    if (req.url.split("?")[0] !== "/mcp") return plain(404, "There's nothing here.");
    if (!sameHash(req.headers.authorization ?? "", want)) {
      d.log("tray: refused a request without the right token");
      return plain(401, "AgentZero needs its token.", { "www-authenticate": 'Bearer realm="agentzero"' });
    }
    if (req.method !== "POST") return plain(405, "Only POST.", { allow: "POST" });
    let msg: unknown;
    try {
      msg = JSON.parse(req.body);
    } catch {
      return rpcError(null, -32700, "That isn't JSON.");
    }
    if (Array.isArray(msg)) return rpcError(null, -32600, "One message at a time.");
    if (!msg || typeof msg !== "object" || (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0") return rpcError(null, -32600, "That isn't JSON-RPC 2.0.");
    const m = msg as { id?: unknown; method?: unknown; params?: unknown };
    // A notification or a response from the client: accepted, nothing to answer.
    if (!("id" in m) || typeof m.method !== "string") return { status: 202, headers: { "cache-control": "no-store" }, body: "" };
    const id = m.id;
    if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "That request has no usable id.");
    const params = (m.params && typeof m.params === "object" && !Array.isArray(m.params) ? m.params : {}) as Record<string, unknown>;
    switch (m.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const version = typeof asked === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion: version,
          capabilities: { tools: {}, resources: { subscribe: false, listChanged: false } },
          serverInfo: { name: "agentzero", title: "AgentZero (ZeroFee)", version: "0.1.0" },
          instructions: "AgentZero pays people on the account's list, privately, at most $5 a call, within today's limit. Anything new is asked on the phone.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "resources/list":
        return rpcResult(id, { resources: [BUDGET_RESOURCE] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "resources/read": {
        const uri = params.uri;
        if (typeof uri !== "string") return rpcError(id, -32602, "Say which resource.");
        // MCP's code for a resource that isn't there.
        if (uri !== BUDGET_URI) return rpcError(id, -32002, `There's no resource called ${uri.slice(0, 40)}.`);
        const m = await d.tools.meter().catch((): Meter => ({ line: "NEAR didn't answer.", state: "down" }));
        return rpcResult(id, { contents: [{ uri: BUDGET_URI, mimeType: "text/plain", text: m.line }] });
      }
      case "tools/call": {
        const name = params.name;
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
        if (typeof name !== "string") return rpcError(id, -32602, "Say which tool.");
        const out = await d.tools.call(name, args).catch(() => ({ text: "The tray couldn't finish this. Nothing was sent.", isError: true }) as ToolResult);
        if (!out) return rpcError(id, -32602, `There's no tool called ${name.slice(0, 40)}.`);
        const res = rpcResult(id, { content: [{ type: "text", text: out.text }], isError: out.isError });
        return out.stop ? { ...res, after: d.onStop } : res;
      }
      default:
        return rpcError(id, -32601, "AgentZero doesn't do that.");
    }
  };
}

/** The HTTP server on 127.0.0.1 only. Resolves once listening (`port` 0: any free port, for tests). */
export function startMcpServer(handle: (req: HttpIn) => Promise<HttpOut>, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX) {
        over = true;
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      if (over) return;
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
      handle({ method: req.method ?? "GET", url: req.url ?? "/", headers, remoteAddress: req.socket.remoteAddress, body: Buffer.concat(parts).toString("utf8") })
        .catch((): HttpOut => plain(500, "The tray couldn't answer this request."))
        .then((out) => {
          res.writeHead(out.status, { ...out.headers, "x-content-type-options": "nosniff" });
          res.end(out.body, () => out.after?.());
        });
    });
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
