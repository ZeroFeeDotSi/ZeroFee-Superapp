// The receive-only SMTP side (D80), on node:net and node:tls alone (no SMTP library: the QA supply-chain rule ruled
// out every smtp-server release with a clean nodemailer, so the small receive subset is written here).
//
// Commands: EHLO, HELO, STARTTLS (only when a key and certificate are given), MAIL, RCPT, DATA, RSET, NOOP, VRFY (252),
// QUIT. AUTH and everything else answer 502. Mail is taken only for a registered mailbox on our domain; every other
// recipient gets 550 at RCPT, so it never relays. Nothing is ever sent out. Logs: counts and errors only.
//
// Memory, per connection, is bounded at all times: reading pauses while a mail is being stored or while more than
// 64 KB of replies wait unread, and resumes on drain; unread input is capped (a command line at 2 KB, 500 and closed);
// DATA goes into one buffer of the size cap, made once per mail. Only CRLF.CRLF ends DATA, never a bare LF.
//
// Floods: an address (an IPv6 address by its /64) may hold 5 connections at once; that is checked first, and a refused
// connection is answered 421 and dropped at once, never counted. Only accepted sessions count toward the 200 in all.
// Each session is closed after 2 minutes whatever it is doing, besides the 60 s idle timeout.
// Arrivals are charged when a mail is complete (after DATA), never at RCPT, so strangers can't use up a mailbox by
// naming it: 10 a minute per sender address and mailbox, 30 a minute per mailbox, 300 a minute per sender address
// (big senders like Privy's mail service share addresses across all our people); over a limit, 451, and a real sender
// tries again later. RCPT itself is limited per address: 100 a minute, and after 10 unknown names in 10 minutes every
// RCPT from it answers 450, so a prober can't tell a real mailbox from a missing one.
import net, { type AddressInfo, type Socket } from "node:net";
import tls from "node:tls";
import { checkDkim, type DkimOptions } from "./dkim.ts";
import { Limiter, ipKey } from "./limits.ts";
import { MAX_BYTES, mailboxOf, receive } from "./receive.ts";
import type { MailStore } from "./store.ts";

export interface SmtpLimits {
  /** Connections at once from one address (IPv6: one /64). Default 5. */
  perIpConnections?: number;
  /** Accepted sessions at once in all. Default 200. */
  maxConnections?: number;
  /** The longest one connection may last, ms. Default 2 minutes. */
  maxSessionMs?: number;
  /** The longest a connection may sit idle, ms. Default 60 s. */
  idleMs?: number;
  /** Mails a minute for one sender address and mailbox. Default 10. */
  perIpMailbox?: number;
  /** Mails a minute for one mailbox. Default 30. */
  perMailbox?: number;
  /** Mails a minute from one sender address. Default 300. */
  perIp?: number;
  /** RCPT commands a minute from one sender address. Default 100. */
  rcptPerIp?: number;
  /** Unknown recipients from one address in 10 minutes before every RCPT answers 450. Default 10. */
  unknownPerIp?: number;
}

export interface SmtpOptions {
  store: MailStore;
  domain: string;
  /** The largest mail in bytes; defaults to 256 KB. */
  size?: number;
  /** The most recipients in one mail; defaults to 10. */
  maxRecipients?: number;
  /** With both, STARTTLS is offered. */
  key?: string | Buffer;
  cert?: string | Buffer;
  limits?: SmtpLimits;
  /** DKIM on arrival (dkim.ts): on by default with node's DNS; "off" only for tests on this machine (startMail refuses it
   *  beyond loopback). */
  dkim?: DkimOptions | "off";
  now?: () => number;
  /** Counts only: how many sealed copies one mail made. */
  onStored?: (copies: number) => void;
  onError?: (what: string) => void;
}

export interface MailSmtp {
  server: net.Server;
  listen(port: number, host: string): Promise<void>;
  address(): AddressInfo;
  close(): Promise<void>;
  /** Serves one accepted socket; `remote` overrides its address (the tests use it to stand in for other senders). */
  handle(socket: Socket, remote?: string): void;
}

/** The longest command line taken (RFC 5321 says 512; a little room for parameters). */
const MAX_LINE = 2048;
/** The longest line inside DATA before the mail counts as too big. */
const MAX_DATA_LINE = 64 * 1024;
/** Unread replies at which reading pauses until the client drains them. */
const HIGH_WATER = 64 * 1024;
/** Unprocessed input ever held for one connection. */
const MAX_INPUT = 128 * 1024;
const MAX_BAD_COMMANDS = 10;
const CRLF = Buffer.from("\r\n");
const LF = Buffer.from("\n");

const plainAddress = (a: string | undefined) => (a ?? "?").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

export function createSmtp(opts: SmtpOptions): MailSmtp {
  const size = opts.size ?? MAX_BYTES;
  const maxRecipients = opts.maxRecipients ?? 10;
  const l = opts.limits ?? {};
  const now = opts.now ?? Date.now;
  const perIpConnections = l.perIpConnections ?? 5;
  const maxConnections = l.maxConnections ?? 200;
  const maxSessionMs = l.maxSessionMs ?? 120_000;
  const idleMs = l.idleMs ?? 60_000;
  const ipBox = new Limiter(l.perIpMailbox ?? 10, 60_000, now);
  const box = new Limiter(l.perMailbox ?? 30, 60_000, now);
  const ipMail = new Limiter(l.perIp ?? 300, 60_000, now);
  const rcptIp = new Limiter(l.rcptPerIp ?? 100, 60_000, now);
  const unknown = new Limiter(l.unknownPerIp ?? 10, 600_000, now);
  const secureContext = opts.key && opts.cert ? tls.createSecureContext({ key: opts.key, cert: opts.cert, minVersion: "TLSv1.2" }) : null;
  const open = new Map<string, number>();
  const sessions = new Set<Socket>();
  const name = opts.domain;

  /** Refuses a connection at once: one line, then gone, never counted anywhere. */
  const refuse = (raw: Socket, line: string) => {
    raw.on("error", () => {});
    raw.end(`${line}\r\n`);
    raw.destroySoon();
    setTimeout(() => raw.destroy(), 200).unref();
  };

  function handle(raw: Socket, remote?: string): void {
    const addr = ipKey(remote ?? plainAddress(raw.remoteAddress));
    // The per-address limit first, so one address can never fill the global count.
    if ((open.get(addr) ?? 0) >= perIpConnections) return refuse(raw, "421 4.7.0 Too many connections from your address");
    if (sessions.size >= maxConnections) return refuse(raw, "421 4.7.0 Too busy, try again later");
    open.set(addr, (open.get(addr) ?? 0) + 1);
    sessions.add(raw);
    raw.on("error", () => {});

    let sock: Socket = raw;
    let closed = false;
    const lifetime = setTimeout(() => {
      if (!closed) write("421 4.4.2 Session too long, closing");
      closed = true;
      raw.destroy();
    }, maxSessionMs);
    lifetime.unref();
    raw.once("close", () => {
      closed = true;
      sessions.delete(raw);
      clearTimeout(lifetime);
      if (data) data.fill(0);
      data = null;
      buf = Buffer.alloc(0);
      const n = (open.get(addr) ?? 1) - 1;
      if (n <= 0) open.delete(addr);
      else open.set(addr, n);
    });

    // Session state.
    let secure = false;
    let greeted = false;
    let from: string | null = null;
    let rcpts: string[] = [];
    let inData = false;
    let data: Buffer | null = null;
    let dataLen = 0;
    let prevCRLF = true;
    let tooBig = false;
    let droppingLine = false;
    let bad = 0;
    let busy = false;
    let paused = false;
    let upgrading = false;
    let buf: Buffer = Buffer.alloc(0);

    function write(line: string) {
      if (!closed && !sock.destroyed) sock.write(`${line}\r\n`);
    }
    const bye = (line: string) => {
      write(line);
      closed = true;
      sock.end();
      setTimeout(() => raw.destroy(), 1000).unref();
    };

    // While upgrading, the clear-text input is already thrown away and nothing reads it; the TLS socket is never paused
    // before its handshake.
    const blocked = () => busy || (!upgrading && sock.writableLength > HIGH_WATER);
    /** Reads only while nothing is waiting on us and the client is reading its replies. */
    const flow = () => {
      if (closed) return;
      if (blocked()) {
        if (!paused) {
          paused = true;
          sock.pause();
        }
      } else if (paused) {
        paused = false;
        sock.resume();
      }
    };

    const reset = () => {
      from = null;
      rcpts = [];
      inData = false;
      if (data) data.fill(0, 0, dataLen);
      data = null;
      dataLen = 0;
      prevCRLF = true;
      tooBig = false;
      droppingLine = false;
    };

    const onData = (chunk: Buffer) => {
      if (closed) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      pump();
      if (!closed && buf.length > MAX_INPUT) bye("500 5.5.6 Too much unread input, closing");
    };

    const attach = (s: Socket) => {
      s.setTimeout(idleMs, () => {
        if (!closed) bye("421 4.4.2 Idle too long, closing");
        setTimeout(() => raw.destroy(), 200).unref();
      });
      s.on("data", onData);
      s.on("drain", () => pump());
    };

    function pump() {
      while (!closed && !blocked()) {
        const nl = buf.indexOf(10);
        if (nl < 0) {
          if (inData) {
            if (buf.length > MAX_DATA_LINE) {
              // A huge line inside DATA: the mail is too big; drop what we have, keep reading to its end.
              tooBig = true;
              droppingLine = true;
              buf = Buffer.alloc(0);
            }
          } else if (buf.length > MAX_LINE) {
            return bye("500 5.5.6 Line too long, closing");
          }
          break;
        }
        const hadCR = nl > 0 && buf[nl - 1] === 13;
        const line = buf.subarray(0, hadCR ? nl - 1 : nl);
        buf = buf.subarray(nl + 1);
        if (inData) dataLine(line, hadCR);
        else if (line.length > MAX_LINE) return bye("500 5.5.6 Line too long, closing");
        else command(line.toString("latin1"));
      }
      flow();
    }

    const dataLine = (line: Buffer, hadCR: boolean) => {
      const startsLine = prevCRLF;
      prevCRLF = hadCR;
      if (droppingLine) {
        droppingLine = false;
        return;
      }
      // Only CRLF "." CRLF ends the mail; a bare LF on either side is just text.
      if (startsLine && hadCR && line.length === 1 && line[0] === 46) return finishData();
      const body = line.length && line[0] === 46 ? line.subarray(1) : line;
      const end = hadCR ? CRLF : LF;
      if (tooBig || !data || dataLen + body.length + end.length > size) {
        tooBig = true;
        return;
      }
      body.copy(data, dataLen);
      dataLen += body.length;
      end.copy(data, dataLen);
      dataLen += end.length;
    };

    const finishData = () => {
      inData = false;
      if (tooBig || !data) {
        reset();
        return write("552 5.3.4 Message too big");
      }
      const boxes = [...new Set(rcpts.map((r) => mailboxOf(r, opts.domain)).filter((m): m is string => m !== null))];
      // Charged now, for a complete mail, and all or nothing so a partly refused mail stores nothing twice on retry.
      if (ipMail.spent(`i:${addr}`) || boxes.some((b) => ipBox.spent(`ib:${addr}:${b}`) || box.spent(`b:${b}`))) {
        reset();
        return write("451 4.7.1 Too much mail, try again later");
      }
      ipMail.take(`i:${addr}`);
      for (const b of boxes) {
        ipBox.take(`ib:${addr}:${b}`);
        box.take(`b:${b}`);
      }
      const mail = data.subarray(0, dataLen);
      const to = rcpts;
      const held = data;
      data = null;
      reset();
      busy = true;
      flow();
      // DKIM first (dkim.ts): unsigned, failing or not the From domain's own is refused and never sealed.
      const signed =
        opts.dkim === "off"
          ? Promise.resolve()
          : checkDkim(mail, opts.dkim).then((v) => {
              if (!v.ok) throw Object.assign(new Error("dkim"), { name: "Dkim", responseCode: v.temporary ? 451 : 550 });
            });
      signed
        .then(() => receive(mail, to, opts.store, opts.domain))
        .then(
          (copies) => {
            opts.onStored?.(copies);
            write("250 2.0.0 Stored");
          },
          (err: { responseCode?: number; name?: string }) => {
            opts.onError?.(`receive failed (${err?.name ?? "Error"})`);
            write(
              err?.responseCode === 552
                ? "552 5.3.4 Message too big"
                : err?.name === "Dkim" && err.responseCode === 550
                  ? "550 5.7.20 No passing DKIM signature from the sender's domain"
                  : "451 4.3.0 Try again later",
            );
          },
        )
        .finally(() => {
          held.fill(0);
          busy = false;
          pump();
        });
    };

    const badCommand = (line: string) => {
      if (++bad >= MAX_BAD_COMMANDS) return bye("421 4.7.0 Too many errors, closing");
      write(line);
    };

    const command = (line: string) => {
      const verb = (/^\s*([A-Za-z]+)/.exec(line)?.[1] ?? "").toUpperCase();
      const rest = line.slice(line.toUpperCase().indexOf(verb) + verb.length);
      switch (verb) {
        case "EHLO":
        case "HELO": {
          if (!rest.trim()) return badCommand(`501 5.5.4 ${verb} needs a name`);
          reset();
          greeted = true;
          if (verb === "HELO") return write(`250 ${name}`);
          const ext = [`SIZE ${size}`, "8BITMIME", "ENHANCEDSTATUSCODES", ...(secureContext && !secure ? ["STARTTLS"] : [])];
          return write([`250-${name} receive only`, ...ext.map((e, i) => `250${i === ext.length - 1 ? " " : "-"}${e}`)].join("\r\n"));
        }
        case "STARTTLS": {
          if (!secureContext || secure) return badCommand("502 5.5.1 Not available");
          write("220 2.0.0 Ready to start TLS");
          // Anything the client sent after STARTTLS in the clear is thrown away (no command injection across it).
          buf = Buffer.alloc(0);
          upgrading = true;
          raw.removeListener("data", onData);
          raw.setTimeout(0);
          const t = new tls.TLSSocket(raw, { isServer: true, secureContext });
          t.on("error", () => raw.destroy());
          t.once("secure", () => {
            secure = true;
            greeted = false;
            upgrading = false;
            reset();
            pump();
          });
          sock = t;
          paused = false;
          attach(t);
          return;
        }
        case "MAIL": {
          if (!greeted) return badCommand("503 5.5.1 Say EHLO first");
          if (from !== null) return badCommand("503 5.5.1 Sender already given");
          const m = /^\s+FROM:\s*<([^<>]*)>\s*(.*)$/i.exec(rest);
          if (!m) return badCommand("501 5.5.4 Syntax: MAIL FROM:<address>");
          const sizeParam = /(?:^|\s)SIZE=(\d+)/i.exec(m[2] ?? "");
          if (sizeParam && Number(sizeParam[1]) > size) return write(`552 5.3.4 Message too big, the limit is ${size}`);
          from = m[1] ?? "";
          return write("250 2.1.0 OK");
        }
        case "RCPT": {
          if (from === null) return badCommand("503 5.5.1 Say MAIL first");
          const m = /^\s+TO:\s*<([^<>]*)>/i.exec(rest);
          if (!m) return badCommand("501 5.5.4 Syntax: RCPT TO:<address>");
          // A prober past its budget learns nothing more: every answer is the same "later".
          if (unknown.spent(`u:${addr}`) || !rcptIp.take(`r:${addr}`)) return write("450 4.7.1 Try again later");
          const address = (m[1] ?? "").replace(/^@[^:]*:/, "");
          const mailbox = mailboxOf(address, opts.domain);
          if (!mailbox || !opts.store.get(mailbox)) {
            unknown.take(`u:${addr}`);
            return write("550 5.1.1 No such mailbox here");
          }
          if (rcpts.length >= maxRecipients) return write("452 4.5.3 Too many recipients");
          rcpts.push(address);
          return write("250 2.1.5 OK");
        }
        case "DATA": {
          if (rest.trim()) return badCommand("501 5.5.4 DATA takes nothing");
          if (rcpts.length === 0) return badCommand("503 5.5.1 Say RCPT first");
          inData = true;
          data = Buffer.allocUnsafeSlow(size);
          dataLen = 0;
          prevCRLF = true;
          tooBig = false;
          return write("354 End data with <CR><LF>.<CR><LF>");
        }
        case "RSET":
          reset();
          return write("250 2.0.0 OK");
        case "NOOP":
          return write("250 2.0.0 OK");
        case "VRFY":
          return write("252 2.5.2 Cannot verify");
        case "QUIT":
          return bye("221 2.0.0 Bye");
        default:
          return badCommand("502 5.5.1 Not available");
      }
    };

    attach(raw);
    write(`220 ${name} ESMTP receive only`);
  }

  const server = net.createServer((s) => handle(s));
  server.on("error", (err: { code?: string }) => opts.onError?.(`smtp error (${err?.code ?? "Error"})`));
  return {
    server,
    handle,
    listen: (port, host) =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      }),
    address: () => server.address() as AddressInfo,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sessions) s.destroy();
        server.close(() => resolve());
      }),
  };
}
