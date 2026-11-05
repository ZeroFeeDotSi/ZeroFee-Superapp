// The inbox API (D80), node:http only. It hands out sealed mail and nothing else: the server holds no key that opens it.
//   POST   /v0/mail/register        {mailbox, publicKey, proof: {signingKey, timestamp, signature}}
//   GET    /v0/mail/:mailbox?since=<id>   header x-mail-proof → {messages: [{id, at, sealed}], more} oldest first, max 50
//   DELETE /v0/mail/:mailbox/:id          header x-mail-proof → {ok: true}
//   GET    /v0/mail/health          → {ok: true}
// Proofs: packages/agent/src/mail/keys.ts, bound to the method, this API's configured host, the mailbox and the id,
// and good once. Every refused proof is the same 401 whether or not the mailbox exists or is taken.
// It must be reached over TLS only: start.ts serves HTTPS itself or listens on loopback behind a TLS proxy.
import type { IncomingMessage, ServerResponse } from "node:http";
import { READ_WINDOW_MS, verifyRegister, verifyRequest } from "@zerofee/agent/mail/keys";
import { mailboxNameProblem } from "@zerofee/agent/mail/names";
import { Limiter, UsedProofs, ipKey } from "./limits.ts";
import { ID, type MailStore } from "./store.ts";

export interface HttpOptions {
  store: MailStore;
  domain: string;
  /** The host the phone signs into each proof ("mail.zerofee.si"). Defaults to mail.<domain>. */
  apiHost?: string;
  now?: () => number;
  /**
   * Proxies in front of this server that append to x-forwarded-for (0 or unset: use the socket's address). The
   * caller is the entry that many places from the right; entries further left are the caller's own claim and are
   * never used.
   */
  trustProxy?: number;
  /** Requests per minute from one address (all routes but health). Default 120. */
  perIp?: number;
  /** Authorised requests per minute for one mailbox. Default 60. */
  perMailbox?: number;
  /** Registrations per hour from one address. Default 20. */
  registerPerIp?: number;
}

const MAX_BODY = 8 * 1024;

/** The caller's address: the socket's, or the trusted proxy's view (rightmost entries), never the leftmost claim. */
export function callerAddress(socketAddress: string | undefined, forwardedFor: string | string[] | undefined, hops: number): string {
  const sock = socketAddress || "?";
  if (!hops || hops < 1) return sock;
  const list = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list[list.length - hops] ?? sock;
}

export function createHttpHandler(opts: HttpOptions) {
  const now = opts.now ?? Date.now;
  const host = opts.apiHost ?? `mail.${opts.domain}`;
  const ipLimit = new Limiter(opts.perIp ?? 120, 60_000, now);
  const boxLimit = new Limiter(opts.perMailbox ?? 60, 60_000, now);
  const regLimit = new Limiter(opts.registerPerIp ?? 20, 3_600_000, now);
  // A proof is accepted 30 s either side of its timestamp, so it is remembered a little over 60 s.
  const used = new UsedProofs(2 * READ_WINDOW_MS + 1000, now);

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      const chunks: Buffer[] = [];
      let n = 0;
      let over = false;
      req.on("data", (c: Buffer) => {
        n += c.length;
        if (n > MAX_BODY) over = true;
        else chunks.push(c);
      });
      req.on("end", () => {
        if (over) return resolve(undefined);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(undefined);
        }
      });
      req.on("error", () => resolve(undefined));
    });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost"); // a base for parsing the path only, never a host anything reaches
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v0" || parts[1] !== "mail") return send(res, 404, { error: "not-found" });

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, x-mail-proof",
        "access-control-max-age": "600",
      });
      return void res.end();
    }

    if (req.method === "GET" && parts.length === 3 && parts[2] === "health") return send(res, 200, { ok: true });

    const ip = ipKey(callerAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], opts.trustProxy ?? 0));
    if (!ipLimit.take(`ip:${ip}`)) return send(res, 429, { error: "slow-down" });

    if (req.method === "POST" && parts.length === 3 && parts[2] === "register") {
      if (!regLimit.take(`reg:${ip}`)) return send(res, 429, { error: "slow-down" });
      const body = await readBody(req);
      const name = (body as { mailbox?: unknown } | undefined)?.mailbox;
      const problem = mailboxNameProblem(name);
      if (problem === "bad-name") return send(res, 400, { error: "bad-name" });
      if (problem === "reserved") return send(res, 403, { error: "reserved" });
      const v = verifyRegister(body, now());
      if (!v.ok && (v.error === "bad-body" || v.error === "bad-key")) return send(res, 400, { error: v.error });
      // A bad proof, a stale one and a name held by another key all answer alike: nothing tells whether it is taken.
      if (!v.ok) return send(res, 401, { error: "refused" });
      const existing = opts.store.get(v.mailbox);
      if (existing && existing.signingKey !== v.signingKey) return send(res, 401, { error: "refused" });
      opts.store.register(v.mailbox, { publicKey: v.publicKey, signingKey: v.signingKey, at: existing?.at ?? now() });
      return send(res, 200, { ok: true, mailbox: v.mailbox, address: `${v.mailbox}@${opts.domain}` });
    }

    if ((req.method === "GET" && parts.length === 3) || (req.method === "DELETE" && parts.length === 4)) {
      const mailbox = parts[2]!;
      const method = req.method === "GET" ? "read" : "delete";
      const id = method === "delete" ? parts[3]! : "";
      const reg = mailboxNameProblem(mailbox) === null ? opts.store.get(mailbox) : undefined;
      const sig = reg ? verifyRequest(req.headers["x-mail-proof"], { method, host, mailbox, id }, reg.signingKey, now()) : null;
      if (!sig || !used.first(sig)) return send(res, 401, { error: "unauthorized" });
      if (!boxLimit.take(`box:${mailbox}`)) return send(res, 429, { error: "slow-down" });
      if (method === "read") {
        const since = url.searchParams.get("since") ?? undefined;
        if (since !== undefined && !ID.test(since)) return send(res, 400, { error: "bad-since" });
        return send(res, 200, opts.store.list(mailbox, since, 50));
      }
      if (!ID.test(id)) return send(res, 404, { error: "not-found" });
      return opts.store.remove(mailbox, id) ? send(res, 200, { ok: true }) : send(res, 404, { error: "not-found" });
    }

    return send(res, 404, { error: "not-found" });
  };
}
